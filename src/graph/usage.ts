import { isNeutral } from "./direction.ts";
import type { GaNode, ProjectGraph } from "./evidence-graph.ts";

/**
 * Wofuer eine GA im Projekt tatsaechlich benutzt wird.
 *
 * Vorlagenprojekte legen alle GAs vorab an und verknuepfen nur, was gebraucht wird: Bei vielen
 * Errichtern ist das Verfahren, und unverknuepfte GAs sind darin legitim, kein Fehler. Fuer eine
 * Thing Description zaehlt trotzdem, ob hinter einer GA ein Geraet etwas sendet oder empfaengt.
 *
 * - active: mindestens ein Objekt eines Geraets sendet oder empfaengt auf der GA; ohne Herstellerdaten
 *   (Flags unbekannt) genuegt die Verknuepfung.
 * - idle: verknuepft, aber nur mit Platzhalterobjekten ("1 Bit", Attrappe) oder mit Objekten, die weder
 *   senden noch empfangen.
 * - reserve: mit nichts verknuepft.
 */
export type Usage = "active" | "idle" | "reserve";

export function gaUsage(node: GaNode): Usage {
  if (node.links.length === 0) return "reserve";
  const real = node.links.filter((link) => !isNeutral(link));
  if (real.length === 0) return "idle";
  return real.some((link) => !link.flagsKnown || link.sends || link.receives) ? "active" : "idle";
}

export interface UsageSummary {
  readonly active: number;
  readonly idle: number;
  readonly reserve: number;
  /** Das Projekt hat Geraete; sonst sagt "unverknuepft" nichts (Projekte nur aus Gruppenadressen). */
  readonly hasDevices: boolean;
}

export function summarizeUsage(graph: ProjectGraph): UsageSummary {
  const counts = { active: 0, idle: 0, reserve: 0 };
  for (const node of graph.groupAddresses) counts[gaUsage(node)]++;
  return { ...counts, hasDevices: graph.loaded.project.devices.length > 0 };
}

/** Anteil der GAs, die in Benutzung sind; fuer die Frage, ob das Projekt eine Vorlage ist. */
export function usedShare(summary: UsageSummary): number {
  const total = summary.active + summary.idle + summary.reserve;
  return total === 0 ? 1 : summary.active / total;
}

/** Hat das Projekt Geraete und ist weniger als die Haelfte der GAs in Benutzung, ist es sehr wahrscheinlich eine Vorlage. */
export const TEMPLATE_THRESHOLD = 0.5;

export function looksLikeTemplate(summary: UsageSummary): boolean {
  return summary.hasDevices && usedShare(summary) < TEMPLATE_THRESHOLD;
}
