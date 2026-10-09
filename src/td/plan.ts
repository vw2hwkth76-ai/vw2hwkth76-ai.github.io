import { dptMainNumber } from "../ets/dpt-id.ts";
import type { FunctionType } from "../ets/master-data.ts";
import type { ClaimSource, Decision } from "../recognize/claims.ts";
import type { ProjectAnalysis } from "../recognize/pipeline.ts";
import type { BundleSource, GaRecognition } from "../recognize/recognize.ts";
import type { Thing, ThingType } from "../recognize/things.ts";
import { camelKey } from "./json.ts";
import { type AffordanceKind, ROLE_SPECS, type RoleSpec, THING_CLASS } from "./vocabulary.ts";

/**
 * Vom erkannten Thing zur Affordance: welche GA wird mit welcher Operation
 * angesprochen. Befehl und Rueckmeldung derselben Groesse werden eine
 * Property mit zwei Forms; in der Variante "action" wird der Befehl eine
 * Action und die Rueckmeldung eine lesbare Property.
 */

export type Operation = "readproperty" | "writeproperty" | "observeproperty" | "invokeaction";
export type CommandStyle = "property" | "action";

export interface PlanOptions {
  readonly commands: CommandStyle;
  /** Nur GAs, deren Richtung und DPT bestaetigt oder fest belegt sind. */
  readonly strict: boolean;
}

export interface Evidence {
  readonly dimension: "direction" | "dpt";
  readonly source: ClaimSource;
  readonly confidence: number;
  readonly conflict: string | undefined;
}

export interface PlannedForm {
  readonly gaId: string | undefined;
  readonly ga: string | undefined;
  readonly gaName: string | undefined;
  readonly ops: readonly Operation[];
  readonly dpt: string | undefined;
  /** false, wenn gelesen wird, ohne dass Herstellerdaten das Lese-Flag belegen. */
  readonly readVerified: boolean | undefined;
  readonly evidence: readonly Evidence[];
  readonly openQuestion: boolean;
}

export interface PlannedAffordance {
  readonly key: string;
  readonly kind: AffordanceKind;
  readonly role: string | undefined;
  readonly titleDe: string;
  readonly titleEn: string;
  readonly types: readonly string[];
  readonly schemaDpt: string | undefined;
  readonly readOnly: boolean;
  readonly writeOnly: boolean;
  readonly observable: boolean;
  readonly forms: readonly PlannedForm[];
}

export interface PlannedThing {
  readonly key: string;
  /** Grundlage der stabilen ID: ETS-Funktion, Aktorkanal oder kleinste GA-ID. */
  readonly stableKey: string;
  readonly title: string;
  readonly type: ThingType;
  readonly functionType: string | undefined;
  readonly thingClass: string;
  readonly roomId: string | undefined;
  readonly bundling: BundleSource;
  readonly central: boolean;
  readonly openQuestions: number;
  readonly affordances: readonly PlannedAffordance[];
  readonly excluded: readonly { readonly gaId: string; readonly ga: string; readonly reason: string }[];
}

export interface TdPlan {
  readonly things: readonly PlannedThing[];
  readonly skipped: readonly { readonly key: string; readonly title: string; readonly reason: string }[];
  /** Ausgeschlossene GAs, auch die uebersprungener Things. */
  readonly excludedCount: number;
}

type Side = "command" | "status" | "open";

interface Member {
  readonly entry: GaRecognition | undefined;
  readonly role: string | undefined;
  readonly spec: RoleSpec | undefined;
  readonly side: Side;
  readonly dpt: string | undefined;
  readonly address: number;
}

/** Fest heisst: bestaetigt, oder Konfidenz ab 0,85 ohne Widerspruch (wie "fester Beleg" in der Werkstatt). */
function firm(decision: Decision): boolean {
  const winner = decision.winner;
  if (!winner || decision.conflict) return false;
  return winner.source === "review" || winner.confidence >= 0.85;
}

function sideOf(entry: GaRecognition): Side {
  const value = entry.decisions.direction.winner?.value;
  if (value === "command") return "command";
  if (value === "status" || value === "alarm") return "status";
  return "open";
}

function evidenceOf(entry: GaRecognition): Evidence[] {
  const result: Evidence[] = [];
  for (const dimension of ["direction", "dpt"] as const) {
    const { winner, conflict } = entry.decisions[dimension];
    if (!winner) continue;
    result.push({ dimension, source: winner.source, confidence: Math.round(winner.confidence * 100) / 100, conflict: conflict?.value });
  }
  return result;
}

function capitalize(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function form(member: Member, ops: Operation[], openQuestions: ReadonlySet<string>): PlannedForm {
  const node = member.entry?.analysis.node;
  const reads = ops.includes("readproperty");
  return {
    gaId: node?.ga.id,
    ga: node?.ga.text,
    gaName: node?.ga.name,
    ops,
    dpt: member.dpt,
    readVerified: reads ? node?.readable === true : undefined,
    evidence: member.entry ? evidenceOf(member.entry) : [],
    openQuestion: node ? openQuestions.has(node.ga.id) : false,
  };
}

/** Lesen nur, wenn ein Objekt antwortet; ohne Herstellerdaten bei Rueckmeldungen mit Vermerk. */
function statusOps(member: Member): Operation[] {
  const readable = member.entry ? member.entry.analysis.node.readable : true;
  return readable === false ? ["observeproperty"] : ["readproperty", "observeproperty"];
}

function commandReadable(member: Member): boolean {
  return member.entry ? member.entry.analysis.node.readable === true : false;
}

function affordance(
  key: string,
  kind: AffordanceKind,
  spec: RoleSpec | undefined,
  role: string | undefined,
  forms: PlannedForm[],
  fallbackTitle: string,
): PlannedAffordance {
  const ops = new Set(forms.flatMap((entry) => entry.ops));
  const writes = ops.has("writeproperty") || ops.has("invokeaction");
  const reads = ops.has("readproperty") || ops.has("observeproperty");
  const types = new Set<string>();
  const commandForm = forms.find((entry) => entry.ops.includes("writeproperty") || entry.ops.includes("invokeaction"));
  if (spec?.command && writes) types.add(spec.command);
  if (spec?.status && reads) types.add(spec.status);
  if (types.size === 0) types.add(writes ? "brick:Command" : "brick:Status");
  return {
    key,
    kind,
    role,
    titleDe: spec?.de ?? fallbackTitle,
    titleEn: spec?.en ?? fallbackTitle,
    types: [...types],
    schemaDpt: (commandForm ?? forms[0])?.dpt,
    readOnly: kind === "property" && !writes,
    writeOnly: kind === "property" && !reads,
    observable: ops.has("observeproperty"),
    forms,
  };
}

/** Baut Properties und Actions aus Mitgliedern; gemeinsam fuer TDs (mit GAs) und Thing Models (ohne). */
function assemble(members: readonly Member[], options: PlanOptions, openQuestions: ReadonlySet<string>): PlannedAffordance[] {
  const groups = new Map<string, Member[]>();
  for (const member of members) {
    const name = member.entry?.analysis.node.ga.name ?? "";
    const key = member.spec?.key ?? (camelKey(name) === "x" ? "value" : camelKey(name));
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }

  const used = new Set<string>();
  const unique = (key: string): string => {
    let candidate = key;
    for (let index = 2; used.has(candidate); index++) candidate = `${key}${index}`;
    used.add(candidate);
    return candidate;
  };

  const result: PlannedAffordance[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.address - b.address);
    const spec = sorted.find((member) => member.spec)?.spec;
    const role = (side: Side): string | undefined => sorted.find((member) => member.side === side)?.role ?? sorted[0]?.role;
    const fallback = sorted[0]?.entry?.analysis.node.ga.name || key;
    const statuses = sorted.filter((member) => member.side === "status");
    const open = sorted.filter((member) => member.side === "open");
    // Gepaart wird nur, was dieselbe Groesse traegt: "Sollwert verschieben" (1.007) ist kein Sollwert (9.001).
    const statusMains = new Set(statuses.map((member) => (member.dpt ? dptMainNumber(member.dpt) : undefined)));
    const fits = (member: Member): boolean => {
      const main = member.dpt ? dptMainNumber(member.dpt) : undefined;
      return statuses.length === 0 || main === undefined || statusMains.has(main) || statusMains.has(undefined);
    };
    const commands = sorted.filter((member) => member.side === "command" && fits(member));
    for (const member of sorted.filter((candidate) => candidate.side === "command" && !fits(candidate))) {
      const main = member.dpt ? dptMainNumber(member.dpt) : undefined;
      const stepping = member.dpt === "DPST-1-7" || main === 3;
      const name = stepping ? `${key}Step` : `${key}Command`;
      const title = spec ? `${spec.de} ${stepping ? "Schritt" : "Befehl"}` : fallback;
      result.push(
        affordance(unique(name), stepping ? "action" : "property", stepping ? undefined : spec, member.role, [form(member, stepping ? ["invokeaction"] : ["writeproperty"], openQuestions)], title),
      );
    }

    if (spec?.kind === "action") {
      for (const member of [...commands, ...open]) result.push(affordance(unique(key), "action", spec, member.role, [form(member, ["invokeaction"], openQuestions)], fallback));
      for (const member of statuses) result.push(affordance(unique(`${key}Status`), "property", undefined, member.role, [form(member, statusOps(member), openQuestions)], `${spec.de} Status`));
      continue;
    }

    const pairs = Math.max(commands.length, statuses.length);
    for (let index = 0; index < pairs; index++) {
      const command = commands[index];
      const status = statuses[index];
      if (options.commands === "action" && command) {
        const actionKey = key === "on" ? "switch" : `set${capitalize(key)}`;
        result.push(affordance(unique(actionKey), "action", spec, command.role, [form(command, ["invokeaction"], openQuestions)], fallback));
        if (status) result.push(affordance(unique(key), "property", spec, status.role, [form(status, statusOps(status), openQuestions)], fallback));
        continue;
      }
      const forms: PlannedForm[] = [];
      if (command) {
        const ops: Operation[] = ["writeproperty"];
        // Ohne Rueckmeldung bleibt der Befehl selbst die beste Zustandsquelle.
        if (!status) {
          if (commandReadable(command)) ops.push("readproperty");
          ops.push("observeproperty");
        }
        forms.push(form(command, ops, openQuestions));
      }
      if (status) forms.push(form(status, statusOps(status), openQuestions));
      result.push(affordance(unique(key), "property", spec, role(command ? "command" : "status"), forms, fallback));
    }
    for (const member of open) {
      const ops: Operation[] = ["writeproperty", "observeproperty"];
      if (commandReadable(member)) ops.splice(1, 0, "readproperty");
      result.push(affordance(unique(key), "property", spec, member.role, [form(member, ops, openQuestions)], fallback));
    }
  }
  return result;
}

function stableKey(thing: Thing, members: readonly GaRecognition[]): string {
  if (thing.draft.source === "ets-function") {
    const fn = members.find((entry) => entry.analysis.node.functions[0])?.analysis.node.functions[0]?.function.id;
    if (fn) return `fn:${fn}`;
  }
  if (thing.draft.source === "channel") {
    const counts = new Map<string, number>();
    for (const entry of members) for (const link of entry.analysis.node.links) {
      const key = link.comObject.channel?.key;
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (best) return `ch:${best}`;
  }
  return `ga:${[...thing.draft.groupAddressIds].sort()[0] ?? thing.draft.key}`;
}

export function planThings(analysis: ProjectAnalysis, options: PlanOptions): TdPlan {
  const { recognition } = analysis;
  const openQuestions = new Set(analysis.questions.flatMap((question) => (question.groupAddressId ? [question.groupAddressId] : [])));
  const things: PlannedThing[] = [];
  const skipped: { key: string; title: string; reason: string }[] = [];
  let excludedCount = 0;

  for (const thing of analysis.things) {
    const entries = thing.draft.groupAddressIds.map((id) => recognition.byGroupAddressId.get(id)).filter((entry) => entry !== undefined);
    const excluded: { gaId: string; ga: string; reason: string }[] = [];
    const members: Member[] = [];
    for (const entry of entries) {
      const ga = entry.analysis.node.ga;
      if (entry.analysis.outOfUse) {
        excluded.push({ gaId: ga.id, ga: ga.text, reason: "stillgelegt" });
        continue;
      }
      if (options.strict && (!firm(entry.decisions.direction) || !firm(entry.decisions.dpt))) {
        excluded.push({ gaId: ga.id, ga: ga.text, reason: !firm(entry.decisions.direction) ? "Richtung nicht fest belegt" : "DPT nicht fest belegt" });
        continue;
      }
      const role = thing.roles.get(ga.id);
      members.push({
        entry,
        role,
        spec: role ? ROLE_SPECS[role] : undefined,
        side: sideOf(entry),
        dpt: entry.decisions.dpt.winner?.value,
        address: ga.address,
      });
    }
    const affordances = assemble(members, options, openQuestions);
    excludedCount += excluded.length;
    if (affordances.length === 0) {
      skipped.push({ key: thing.draft.key, title: thing.draft.label, reason: excluded.length > 0 ? `alle GAs ausgeschlossen (${excluded[0]?.reason})` : "keine GA" });
      continue;
    }
    const memberIds = new Set(thing.draft.groupAddressIds);
    things.push({
      key: thing.draft.key,
      stableKey: stableKey(thing, entries),
      title: thing.draft.label,
      type: thing.type,
      functionType: thing.functionType,
      thingClass: THING_CLASS[thing.type],
      roomId: thing.draft.roomId,
      bundling: thing.draft.source,
      central: thing.draft.central,
      openQuestions: analysis.questions.filter((question) => (question.groupAddressId ? memberIds.has(question.groupAddressId) : question.thingKey === thing.draft.key)).length,
      affordances,
      excluded,
    });
  }
  return { things, skipped, excludedCount };
}

const STATUS_ROLES = new Set(["ValvePosition", "ActualValvePosition", "ValveSwitch"]);

/** Affordances eines normierten KNX-Funktionstyps, ohne GAs; Grundlage der Thing Models. */
export function planFunctionType(functionType: FunctionType, options: Pick<PlanOptions, "commands">): PlannedAffordance[] {
  const members: Member[] = functionType.points.map((point, index) => {
    const spec = ROLE_SPECS[point.role];
    const status = STATUS_ROLES.has(point.role) || /^(Info|Current)/.test(point.role) || (spec !== undefined && spec.command === undefined);
    return { entry: undefined, role: point.role, spec, side: status ? "status" : "command", dpt: point.dpt, address: index };
  });
  return assemble(members, { commands: options.commands, strict: false }, new Set());
}

