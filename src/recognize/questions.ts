import { dptDotted } from "../ets/dpt-id.ts";
import type { Claim, ClaimDimension } from "./claims.ts";
import { ASPECTS } from "./lexicon.ts";
import { functionKey, type GaRecognition, linkProfile, type Recognition } from "./recognize.ts";
import { aspectOf, type Thing } from "./things.ts";

export type QuestionKind = "conflict" | "missing" | "ambiguous" | "structure";

export interface Suggestion {
  readonly value: string;
  readonly evidence: string;
}

/** Offene Frage an den Menschen; nichts davon wird automatisch entschieden. */
export interface Question {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly dimension: ClaimDimension | "role";
  /** Erste betroffene GA; bei einer Frage je Funktion stehen alle in groupAddressIds. */
  readonly groupAddressId: string | undefined;
  readonly groupAddressIds: readonly string[];
  readonly thingKey: string | undefined;
  readonly message: string;
  readonly suggestions: readonly Suggestion[];
}

const LABELS: Readonly<Record<ClaimDimension, string>> = {
  room: "Raum",
  trade: "Gewerk",
  direction: "Richtung",
  dpt: "Datenpunkttyp",
};
const DIRECTION_TEXT: Readonly<Record<string, string>> = { command: "Befehl", status: "Rückmeldung", alarm: "Meldung" };
/** Rollen, die ein Thing mehrfach tragen darf: ein Raumregler meldet Heiz- und Kuehlstoerung. */
const MULTI_ROLES = new Set(["Alarm", "TextMessage"]);
const ORDER: Readonly<Record<QuestionKind, number>> = { conflict: 0, ambiguous: 1, missing: 2, structure: 3 };

export function collectQuestions(recognition: Recognition, things: readonly Thing[]): Question[] {
  const questions: Question[] = [];
  const spaceName = (id: string): string => recognition.graph.spaces.get(id)?.space.name ?? id;
  const show = (claim: Claim): string => {
    if (claim.dimension === "room") return spaceName(claim.value);
    if (claim.dimension === "direction") return DIRECTION_TEXT[claim.value] ?? claim.value;
    if (claim.dimension === "dpt") return dptDotted(claim.value);
    return claim.value;
  };

  for (const entry of recognition.groupAddresses) {
    const { analysis, decisions } = entry;
    const ga = analysis.node.ga;
    if (analysis.outOfUse) continue;
    const label = `${ga.text} "${ga.name}"`;
    for (const dimension of ["room", "direction", "dpt"] as const) {
      const decision = decisions[dimension];
      if (decision.winner && decision.conflict) {
        questions.push({
          id: `${ga.id}:${dimension}:conflict`,
          kind: "conflict",
          dimension,
          groupAddressId: ga.id,
          groupAddressIds: [ga.id],
          thingKey: entry.thingKey,
          message: `${label}: ${LABELS[dimension]} widersprüchlich, ${show(decision.winner)} oder ${show(decision.conflict)}?`,
          suggestions: [decision.winner, decision.conflict].map((claim) => ({ value: claim.value, evidence: claim.evidence })),
        });
      }
    }
    if (!decisions.room.winner && !analysis.outdoor) {
      const multi = analysis.multiRoomName || analysis.multiRoomRange;
      const candidates = [...analysis.name.rooms.matches, ...analysis.ranges.flatMap((range) => range.rooms.matches)];
      questions.push({
        id: `${ga.id}:room`,
        kind: multi ? "ambiguous" : "missing",
        dimension: "room",
        groupAddressId: ga.id,
        groupAddressIds: [ga.id],
        thingKey: entry.thingKey,
        message: multi ? `${label}: Name oder Gruppenbereich nennen mehrere Räume.` : `${label}: kein Raum erkennbar.`,
        suggestions: [...new Set(candidates.map((match) => match.spaceId))].map((id) => ({ value: id, evidence: `genannt: ${spaceName(id)}` })),
      });
    }
    if (!decisions.direction.winner) {
      questions.push({
        id: `${ga.id}:direction`,
        kind: "missing",
        dimension: "direction",
        groupAddressId: ga.id,
        groupAddressIds: [ga.id],
        thingKey: entry.thingKey,
        message: `${label}: Befehl oder Rückmeldung? Der Name sagt es nicht eindeutig.`,
        suggestions: [
          { value: "command", evidence: "wird geschaltet oder gesetzt" },
          { value: "status", evidence: "meldet einen Zustand oder Messwert" },
        ],
      });
    }
    if (!decisions.dpt.winner) questions.push(dptQuestion(entry, label));
  }

  for (const thing of things) {
    // Befehl und Rueckmeldung derselben Rolle sind ein Paar; nur gleiche Rolle mit gleicher Richtung ist verdaechtig.
    const byRole = new Map<string, string[]>();
    for (const [gaId, role] of thing.roles) {
      if (MULTI_ROLES.has(role)) continue;
      const entry = recognition.byGroupAddressId.get(gaId);
      const side = entry?.decisions.direction.winner?.value === "command" ? "command" : "status";
      byRole.set(`${role}|${side}`, [...(byRole.get(`${role}|${side}`) ?? []), gaId]);
    }
    for (const [roleKey, gaIds] of byRole) {
      const role = roleKey.split("|")[0] ?? roleKey;
      if (gaIds.length < 2) continue;
      // Ein Wert vom Bediengeraet und derselbe Wert am Aktor sind zwei Zugaenge zu einer Funktion, kein zweites Thing.
      const profiles = gaIds.map((id) => {
        const entry = recognition.byGroupAddressId.get(id);
        return entry ? linkProfile(entry.analysis, recognition.graph) : "none";
      });
      if (new Set(profiles).size === profiles.length) continue;
      questions.push({
        id: `${thing.draft.key}:${role}`,
        kind: "structure",
        dimension: "role",
        groupAddressId: undefined,
        groupAddressIds: [],
        thingKey: thing.draft.key,
        message: `"${thing.draft.label}": ${gaIds.length} GAs mit der Rolle ${role}. Gehören sie zu verschiedenen Things?`,
        suggestions: [],
      });
    }
  }
  return groupByFunction(questions, recognition).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.id.localeCompare(b.id));
}

/**
 * Fehlt derselbe Wert bei GAs gleicher Funktion ("<Raum>_EmLamp1Test" in 26 Raeumen),
 * ist das eine Entscheidung, keine 26. Die Antwort gilt dann fuer alle.
 */
function groupByFunction(questions: readonly Question[], recognition: Recognition): Question[] {
  const result: Question[] = [];
  const groups = new Map<string, Question[]>();
  for (const question of questions) {
    const entry = question.groupAddressId ? recognition.byGroupAddressId.get(question.groupAddressId) : undefined;
    const key = entry && question.kind === "missing" && question.dimension !== "room" ? functionKey(entry.analysis) : undefined;
    if (!key) {
      result.push(question);
      continue;
    }
    const groupKey = `${question.dimension}|${key}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), question]);
  }
  for (const [key, members] of groups) {
    const head = members[0];
    if (!head || members.length === 1) {
      result.push(...members);
      continue;
    }
    const ids = members.flatMap((member) => member.groupAddressIds);
    const sizes = new Set(ids.flatMap((id) => [...(recognition.byGroupAddressId.get(id)?.analysis.node.comObjectSizes ?? [])]));
    const example = recognition.byGroupAddressId.get(ids[0] ?? "")?.analysis.node.ga;
    const what = head.dimension === "dpt" ? `Datenpunkttyp fehlt${sizes.size === 1 ? ` (verknüpfte Objekte: ${[...sizes][0]} Bit)` : ""}` : "Befehl oder Rückmeldung?";
    result.push({
      ...head,
      id: `funktion:${key}`,
      groupAddressIds: ids,
      thingKey: undefined,
      message: `${ids.length} GAs gleicher Funktion wie ${example?.text ?? ""} "${example?.name ?? ""}": ${what}${what.endsWith("?") ? "" : "."} Die Antwort gilt für alle.`,
    });
  }
  return result;
}

function dptQuestion(entry: GaRecognition, label: string): Question {
  const aspect = aspectOf(entry);
  const suggested = aspect ? ASPECTS[aspect].dpt : undefined;
  const sizes = [...entry.analysis.node.comObjectSizes];
  return {
    id: `${entry.analysis.node.ga.id}:dpt`,
    kind: "missing",
    dimension: "dpt",
    groupAddressId: entry.analysis.node.ga.id,
    groupAddressIds: [entry.analysis.node.ga.id],
    thingKey: entry.thingKey,
    message: `${label}: Datenpunkttyp fehlt${sizes.length === 1 ? ` (verknüpfte Objekte: ${sizes[0]} Bit)` : ""}.`,
    suggestions: suggested ? [{ value: suggested, evidence: `typisch für "${aspect}"` }] : [],
  };
}
