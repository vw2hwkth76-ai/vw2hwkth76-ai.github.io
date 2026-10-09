import type { ProjectAnalysis } from "../recognize/pipeline.ts";
import type { GoldStandard } from "./gold.ts";

/**
 * Wie viel eines Projekts ohne Rueckfrage in Thing Descriptions geht, und
 * wie gut die Buendelung zur Soll-Buendelung passt. Zielgroesse ist der
 * Anteil "TD-fertig": GA in einem Thing, Richtung und DPT entschieden,
 * keine offene Rueckfrage zu dieser GA.
 */

export interface Readiness {
  readonly groupAddresses: number;
  /** Nicht stillgelegt, Richtung und DPT entschieden, keine Rueckfrage. */
  readonly ready: number;
  /** Wie ready, zusaetzlich Richtung und DPT mit Konfidenz ab 0,85 oder bestaetigt. */
  readonly firm: number;
  readonly things: number;
  readonly singleThings: number;
  /** Paarweise Genauigkeit und Vollstaendigkeit der Buendelung gegen den Gold-Standard. */
  readonly bundling: { readonly precision: number; readonly recall: number } | undefined;
}

export function readiness(analysis: ProjectAnalysis, gold?: GoldStandard): Readiness {
  const asked = new Set(analysis.questions.flatMap((question) => (question.groupAddressId ? [question.groupAddressId] : [])));
  let ready = 0;
  let firm = 0;
  const entries = analysis.recognition.groupAddresses;
  for (const entry of entries) {
    if (entry.analysis.outOfUse || asked.has(entry.analysis.node.ga.id)) continue;
    const direction = entry.decisions.direction.winner;
    const dpt = entry.decisions.dpt.winner;
    if (!direction || !dpt) continue;
    ready++;
    const strong = (claim: { source: string; confidence: number }): boolean => claim.source === "review" || claim.confidence >= 0.85;
    if (strong(direction) && strong(dpt)) firm++;
  }

  let bundling: Readiness["bundling"];
  if (gold && [...gold.entries.values()].some((entry) => entry.thing !== undefined)) {
    const rated = entries.map((entry) => ({ address: entry.analysis.node.ga.address, predicted: entry.thingKey })).filter((item) => gold.entries.has(item.address));
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < rated.length; i++) {
      for (let j = i + 1; j < rated.length; j++) {
        const a = rated[i];
        const b = rated[j];
        if (!a || !b) continue;
        const goldA = gold.entries.get(a.address)?.thing;
        const goldB = gold.entries.get(b.address)?.thing;
        const same = goldA !== undefined && goldA === goldB;
        const predicted = a.predicted === b.predicted;
        if (same && predicted) tp++;
        else if (!same && predicted) fp++;
        else if (same && !predicted) fn++;
      }
    }
    bundling = { precision: tp + fp === 0 ? 1 : tp / (tp + fp), recall: tp + fn === 0 ? 1 : tp / (tp + fn) };
  }

  return {
    groupAddresses: entries.length,
    ready,
    firm,
    things: analysis.things.length,
    singleThings: analysis.things.filter((thing) => thing.draft.groupAddressIds.length === 1).length,
    bundling,
  };
}

export function formatReadiness(rows: readonly { readonly project: string; readonly predictor: string; readonly result: Readiness }[]): string {
  const percent = (value: number, total: number): string => `${total === 0 ? 0 : ((value / total) * 100).toFixed(1)} %`;
  const lines = [
    "| Projekt | Verfahren | GAs | TD-fertig ohne Rückfrage | davon fest belegt | Things | davon mit 1 GA | Bündelung Präzision | Bündelung Vollständigkeit |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { project, predictor, result } of rows) {
    lines.push(
      `| ${project} | ${predictor} | ${result.groupAddresses} | ${percent(result.ready, result.groupAddresses)} | ${percent(result.firm, result.groupAddresses)} | ${result.things} | ${result.singleThings} | ${result.bundling ? percent(result.bundling.precision, 1) : "–"} | ${result.bundling ? percent(result.bundling.recall, 1) : "–"} |`,
    );
  }
  return lines.join("\n");
}
