import type { Claim, ClaimDimension } from "./claims.ts";
import { ASPECTS } from "./lexicon.ts";
import type { GaRecognition, Recognition } from "./recognize.ts";
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
  readonly groupAddressId: string | undefined;
  readonly thingKey: string | undefined;
  readonly message: string;
  readonly suggestions: readonly Suggestion[];
}

const LABELS: Readonly<Record<ClaimDimension, string>> = {
  room: "Raum",
  trade: "Gewerk",
  direction: "Befehl oder Rueckmeldung",
  dpt: "Datenpunkttyp",
};
const ORDER: Readonly<Record<QuestionKind, number>> = { conflict: 0, ambiguous: 1, missing: 2, structure: 3 };

export function collectQuestions(recognition: Recognition, things: readonly Thing[]): Question[] {
  const questions: Question[] = [];
  const spaceName = (id: string): string => recognition.graph.spaces.get(id)?.space.name ?? id;
  const show = (claim: Claim): string => (claim.dimension === "room" ? spaceName(claim.value) : claim.value);

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
          thingKey: entry.thingKey,
          message: `${label}: ${LABELS[dimension]} widerspruechlich, ${show(decision.winner)} oder ${show(decision.conflict)}?`,
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
        thingKey: entry.thingKey,
        message: multi ? `${label}: Name oder Gruppenbereich nennen mehrere Raeume.` : `${label}: kein Raum erkennbar.`,
        suggestions: [...new Set(candidates.map((match) => match.spaceId))].map((id) => ({ value: id, evidence: `genannt: ${spaceName(id)}` })),
      });
    }
    if (!decisions.direction.winner) {
      questions.push({
        id: `${ga.id}:direction`,
        kind: "missing",
        dimension: "direction",
        groupAddressId: ga.id,
        thingKey: entry.thingKey,
        message: `${label}: Befehl oder Rueckmeldung? Der Name sagt es nicht eindeutig.`,
        suggestions: [
          { value: "command", evidence: "wird geschaltet oder gesetzt" },
          { value: "status", evidence: "meldet einen Zustand oder Messwert" },
        ],
      });
    }
    if (!decisions.dpt.winner) questions.push(dptQuestion(entry, label));
  }

  for (const thing of things) {
    const byRole = new Map<string, string[]>();
    for (const [gaId, role] of thing.roles) byRole.set(role, [...(byRole.get(role) ?? []), gaId]);
    for (const [role, gaIds] of byRole) {
      if (gaIds.length < 2) continue;
      questions.push({
        id: `${thing.draft.key}:${role}`,
        kind: "structure",
        dimension: "role",
        groupAddressId: undefined,
        thingKey: thing.draft.key,
        message: `"${thing.draft.label}": ${gaIds.length} GAs mit der Rolle ${role}. Gehoeren sie zu verschiedenen Things?`,
        suggestions: [],
      });
    }
  }
  return questions.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.id.localeCompare(b.id));
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
    thingKey: entry.thingKey,
    message: `${label}: Datenpunkttyp fehlt${sizes.length === 1 ? ` (verknuepfte Objekte: ${sizes[0]} Bit)` : ""}.`,
    suggestions: suggested ? [{ value: suggested, evidence: `typisch fuer "${aspect}"` }] : [],
  };
}
