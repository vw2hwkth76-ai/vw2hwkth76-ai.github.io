import type { GaNode, ProjectGraph } from "./evidence-graph.ts";
import { gaUsage } from "./usage.ts";

/**
 * Welche GAs in die Auswertung gehen. Ausgeschlossene GAs werden vor der Erkennung aus dem Graphen genommen:
 * Sie bekommen keine Belege, keinen Schema-Treffer, bilden keine Things, stellen keine Rueckfragen, stehen
 * nicht im Prompt fuer das Namensschema und gehen nicht in die Thing Descriptions. "Stillgelegt" ist etwas
 * anderes: Eine stillgelegte GA wird erkannt und nur nicht gezaehlt.
 *
 * Rangfolge, von stark nach schwach: einzeln zurueckgeholt, einzeln ausgeschlossen, Hauptgruppe, Vorrat.
 */
export interface Exclusion {
  /** GAs ohne wirksames Geraet ausschliessen (Vorlagenprojekt); wirkt nur in Projekten mit Geraeten. */
  readonly reserve: boolean;
  /** Ids der Hauptgruppen (oberste Gruppenbereiche), die ausgeschlossen sind. */
  readonly ranges: readonly string[];
  /** Einzeln ausgeschlossene GAs. */
  readonly gas: readonly string[];
  /** Einzeln zurueckgeholte GAs; gehen allen anderen Regeln vor. */
  readonly include: readonly string[];
}

export const NO_EXCLUSION: Exclusion = { reserve: false, ranges: [], gas: [], include: [] };

/**
 * Ausschluss aus einem gespeicherten Projektstand. Aeltere Staende kannten nur den Umfang `scope: "used"`
 * (nur GAs in Benutzung); das ist der Ausschluss des Vorrats.
 */
export function exclusionFromState(state: Readonly<Record<string, unknown>>): Exclusion | undefined {
  // "all" war eine ausdrueckliche Wahl: nichts ausschliessen, auch nicht bei einer Vorlage.
  return parseExclusion(state["exclude"]) ?? (state["scope"] === "used" ? { ...NO_EXCLUSION, reserve: true } : state["scope"] === "all" ? NO_EXCLUSION : undefined);
}

export function isEmptyExclusion(exclusion: Exclusion): boolean {
  return !exclusion.reserve && exclusion.ranges.length === 0 && exclusion.gas.length === 0 && exclusion.include.length === 0;
}

const MAX_IDS = 50_000;
const MAX_ID_LENGTH = 200;

function idList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= MAX_ID_LENGTH);
  return [...new Set(ids)].slice(0, MAX_IDS);
}

/** Liest einen gespeicherten Ausschluss; Unbrauchbares wird verworfen. `undefined`, wenn nichts Brauchbares dasteht. */
export function parseExclusion(json: unknown): Exclusion | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;
  const record = json as Record<string, unknown>;
  const gas = new Set(idList(record["gas"]));
  const include = idList(record["include"]).filter((id) => !gas.has(id));
  return { reserve: record["reserve"] === true, ranges: idList(record["ranges"]), gas: [...gas], include };
}

export type ExcludeReason = "reserve" | "group" | "single";

/** Schluessel fuer GAs, die in keinem Gruppenbereich liegen (freie Ebenen). */
export const NO_GROUP = "~ohne-bereich";

export function mainGroupId(node: GaNode): string {
  return node.ranges[0]?.id ?? NO_GROUP;
}

export function mainGroupName(node: GaNode): string {
  return node.ranges[0]?.name.trim() || "(ohne Bereich)";
}

/** Vorrat: kein Geraet sendet oder empfaengt darauf. Ohne Geraete im Projekt sagt das nichts. */
export function isReserve(node: GaNode, graph: ProjectGraph): boolean {
  return graph.loaded.project.devices.length > 0 && gaUsage(node) !== "active";
}

/** Grund des Ausschlusses je GA-Id; nicht aufgefuehrt heisst: geht in die Auswertung. */
export function excludedReasons(graph: ProjectGraph, exclusion: Exclusion): ReadonlyMap<string, ExcludeReason> {
  const included = new Set(exclusion.include);
  const single = new Set(exclusion.gas);
  const groups = new Set(exclusion.ranges);
  const reasons = new Map<string, ExcludeReason>();
  for (const node of graph.groupAddresses) {
    const id = node.ga.id;
    if (included.has(id)) continue;
    if (single.has(id)) reasons.set(id, "single");
    else if (groups.has(mainGroupId(node))) reasons.set(id, "group");
    else if (exclusion.reserve && isReserve(node, graph)) reasons.set(id, "reserve");
  }
  return reasons;
}

/** Schliesst GAs einzeln aus; was ohnehin ausgeschlossen ist, bleibt ohne eigenen Eintrag. */
export function excludeIds(graph: ProjectGraph, exclusion: Exclusion, ids: readonly string[]): Exclusion {
  const drop = new Set(ids);
  const base: Exclusion = { ...exclusion, gas: exclusion.gas.filter((id) => !drop.has(id)), include: exclusion.include.filter((id) => !drop.has(id)) };
  const reasons = excludedReasons(graph, base);
  return { ...base, gas: [...base.gas, ...ids.filter((id) => !reasons.has(id))] };
}

/** Holt GAs in die Auswertung zurueck; ein Eintrag entsteht nur, wo eine Regel sie sonst ausschlosse. */
export function includeIds(graph: ProjectGraph, exclusion: Exclusion, ids: readonly string[]): Exclusion {
  const take = new Set(ids);
  const base: Exclusion = { ...exclusion, gas: exclusion.gas.filter((id) => !take.has(id)), include: exclusion.include.filter((id) => !take.has(id)) };
  const reasons = excludedReasons(graph, base);
  return { ...base, include: [...base.include, ...ids.filter((id) => reasons.has(id))] };
}

/** Graph ohne die ausgeschlossenen GAs; Verwandtes (Raeume, Geraete) bleibt, Diagnosen folgen den GAs. */
export function restrictGraph(graph: ProjectGraph, excluded: ReadonlyMap<string, ExcludeReason>): ProjectGraph {
  if (excluded.size === 0) return graph;
  const groupAddresses = graph.groupAddresses.filter((node) => !excluded.has(node.ga.id));
  const byGroupAddressId = new Map(groupAddresses.map((node) => [node.ga.id, node]));
  return {
    ...graph,
    groupAddresses,
    byGroupAddressId,
    diagnostics: [...graph.loaded.diagnostics, ...groupAddresses.flatMap((node) => node.diagnostics)],
  };
}

export interface ExclusionCounts {
  readonly included: number;
  readonly excluded: number;
  readonly byReason: Readonly<Record<ExcludeReason, number>>;
}

export function countExclusion(total: number, excluded: ReadonlyMap<string, ExcludeReason>): ExclusionCounts {
  const byReason: Record<ExcludeReason, number> = { reserve: 0, group: 0, single: 0 };
  for (const reason of excluded.values()) byReason[reason]++;
  return { included: total - excluded.size, excluded: excluded.size, byReason };
}

export interface MainGroup {
  readonly id: string;
  readonly name: string;
  readonly total: number;
  /** Davon mit wirksamem Geraet. */
  readonly active: number;
}

/** Hauptgruppen mit Anzahl, in der Reihenfolge der Adressen; Namen gleicher Gruppen mit anderer Id bleiben getrennt. */
export function mainGroups(graph: ProjectGraph): readonly MainGroup[] {
  const groups = new Map<string, { name: string; total: number; active: number }>();
  for (const node of graph.groupAddresses) {
    const id = mainGroupId(node);
    const entry = groups.get(id) ?? { name: mainGroupName(node), total: 0, active: 0 };
    entry.total++;
    if (gaUsage(node) === "active") entry.active++;
    groups.set(id, entry);
  }
  return [...groups].map(([id, entry]) => ({ id, ...entry }));
}

/**
 * Namen der Mittelgruppen, die nur im ausgeschlossenen Vorrat vorkommen; Vokabular fuer den Prompt, ohne einzelne
 * GAs. Bewusst abgewaehlte Hauptgruppen und einzelne GAs zaehlen nicht, sie sollen das Schema nicht beeinflussen.
 */
export function reserveOnlyMiddleGroups(graph: ProjectGraph, excluded: ReadonlyMap<string, ExcludeReason>): readonly string[] {
  const used = new Set<string>();
  const dropped = new Set<string>();
  for (const node of graph.groupAddresses) {
    const name = node.ranges[1]?.name.trim();
    if (!name) continue;
    const reason = excluded.get(node.ga.id);
    if (reason === undefined) used.add(name);
    else if (reason === "reserve") dropped.add(name);
  }
  return [...dropped].filter((name) => !used.has(name)).sort((a, b) => a.localeCompare(b, "de"));
}
