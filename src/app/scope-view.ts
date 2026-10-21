import type { GaNode, ProjectGraph } from "../graph/evidence-graph.ts";
import type { ProjectAnalysis } from "../recognize/pipeline.ts";
import {
  countExclusion,
  type ExcludeReason,
  type Exclusion,
  type ExclusionCounts,
  excludedReasons,
  mainGroupName,
  type MainGroup,
  mainGroups,
} from "../graph/scope.ts";
import { gaUsage, looksLikeTemplate, summarizeUsage, type Usage, type UsageSummary } from "../graph/usage.ts";

/**
 * Sicht auf den Umfang der Auswertung fuer Assistent, Uebersicht und Bericht: wie viele GAs es gibt, wie viele
 * davon benutzt werden, welche Hauptgruppen es gibt und was der Ausschluss davon uebrig laesst.
 */
export interface ScopeOverview extends UsageSummary, ExclusionCounts {
  /** Das Projekt sieht nach einer Vorlage aus: Geraete vorhanden, weniger als die Haelfte der GAs in Benutzung. */
  readonly template: boolean;
  readonly total: number;
  readonly groups: readonly (MainGroup & { readonly excluded: boolean })[];
  readonly exclusion: Exclusion;
}

export function buildScopeOverview(graph: ProjectGraph, exclusion: Exclusion): ScopeOverview {
  const summary = summarizeUsage(graph);
  const reasons = excludedReasons(graph, exclusion);
  const excludedGroups = new Set(exclusion.ranges);
  return {
    ...summary,
    ...countExclusion(graph.groupAddresses.length, reasons),
    template: looksLikeTemplate(summary),
    total: graph.groupAddresses.length,
    groups: mainGroups(graph).map((group) => ({ ...group, excluded: excludedGroups.has(group.id) })),
    exclusion,
  };
}

export interface ScopeRow {
  readonly id: string;
  readonly text: string;
  readonly name: string;
  readonly range: string;
  readonly usage: Usage;
  readonly excluded: ExcludeReason | undefined;
}

export interface ScopeSearch {
  /** Alle Treffer, nicht nur die angezeigten. */
  readonly total: number;
  readonly ids: readonly string[];
  /** Davon ausgeschlossen. */
  readonly excluded: number;
  readonly rows: readonly ScopeRow[];
}

const normalize = (text: string): string => text.toLocaleLowerCase("de").normalize("NFKD").replace(/\p{M}/gu, "");

/** Sucht in Adresse, Name und Gruppenbereichen; alle Woerter muessen vorkommen. */
export function searchScope(graph: ProjectGraph, exclusion: Exclusion, query: string, limit: number): ScopeSearch {
  const words = normalize(query).split(/\s+/).filter((word) => word !== "");
  const reasons = excludedReasons(graph, exclusion);
  const matches: GaNode[] = [];
  if (words.length > 0) {
    for (const node of graph.groupAddresses) {
      const haystack = normalize([node.ga.text, node.ga.name, ...node.ranges.map((range) => range.name)].join(" "));
      if (words.every((word) => haystack.includes(word))) matches.push(node);
    }
  }
  return {
    total: matches.length,
    ids: matches.map((node) => node.ga.id),
    excluded: matches.filter((node) => reasons.has(node.ga.id)).length,
    rows: matches.slice(0, limit).map((node) => ({
      id: node.ga.id,
      text: node.ga.text,
      name: node.ga.name,
      range: node.ranges.length > 0 ? node.ranges.map((range) => range.name.trim()).join(" / ") : mainGroupName(node),
      usage: gaUsage(node),
      excluded: reasons.get(node.ga.id),
    })),
  };
}

export interface SplitThings {
  /** Things der Erkennung ohne Ausschluss, von denen ein Teil der GAs ausgeschlossen ist und ein Teil nicht. */
  readonly count: number;
  readonly examples: readonly { readonly thing: string; readonly kept: readonly string[]; readonly dropped: readonly string[] }[];
}

/**
 * Things, die der Ausschluss auseinanderreisst: Bleibt der Befehl drin und die Rueckmeldung draussen, hat das Thing
 * keine Rueckmeldung mehr. `full` ist eine Analyse ohne Ausschluss.
 */
export function splitThings(full: ProjectAnalysis, excluded: ReadonlySet<string>, limit = 5): SplitThings {
  const nameOf = new Map(full.recognition.groupAddresses.map((entry) => [entry.analysis.node.ga.id, `${entry.analysis.node.ga.text} ${entry.analysis.node.ga.name}`.trim()]));
  const examples: { thing: string; kept: string[]; dropped: string[] }[] = [];
  let count = 0;
  for (const thing of full.things) {
    const ids = thing.draft.groupAddressIds;
    const dropped = ids.filter((id) => excluded.has(id));
    if (dropped.length === 0 || dropped.length === ids.length) continue;
    count++;
    if (examples.length < limit) {
      examples.push({
        thing: thing.draft.label,
        kept: ids.filter((id) => !excluded.has(id)).slice(0, 3).map((id) => nameOf.get(id) ?? id),
        dropped: dropped.slice(0, 3).map((id) => nameOf.get(id) ?? id),
      });
    }
  }
  return { count, examples };
}
