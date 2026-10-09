import { dptMainNumber } from "../ets/dpt-id.ts";
import type { ProjectGraph } from "../graph/evidence-graph.ts";
import type { Predictor } from "./baseline.ts";
import { DIMENSIONS, type Dimension, type GoldStandard } from "./gold.ts";
import { normalizeText } from "./normalize.ts";

export interface DimensionScore {
  rated: number;
  correct: number;
  partial: number;
  wrong: number;
  missing: number;
  /** Zugeordnete Werte je Quelle, auch ausserhalb des Gold-Standards. */
  bySource: Record<string, number>;
}

export interface ScoreError {
  readonly address: string;
  readonly name: string;
  readonly dimension: Dimension;
  readonly expected: string;
  readonly actual: string;
  readonly source: string;
}

export interface Score {
  readonly predictor: string;
  readonly project: string;
  readonly groupAddresses: number;
  readonly dimensions: Readonly<Record<Dimension, DimensionScore>>;
  readonly errors: readonly ScoreError[];
}

export function accuracy(score: DimensionScore): number {
  return score.rated === 0 ? 0 : score.correct / score.rated;
}

function equal(dimension: Dimension, expected: string, actual: string): boolean {
  // Ein Haupttyp im Gold ("DPT-1") bewertet nur den Haupttyp; der Untertyp ist dort offen.
  if (dimension === "dpt" && /^DPT-\d+$/i.test(expected)) return dptMainNumber(expected) === dptMainNumber(actual);
  if (dimension === "dpt" || dimension === "direction") return expected.toUpperCase() === actual.toUpperCase();
  return normalizeText(expected) === normalizeText(actual);
}

/** Haupttyp beim DPT, Teilbezeichnung bei der Funktion (Konvention aus ets2td). */
function partial(dimension: Dimension, expected: string, actual: string): boolean {
  if (dimension === "dpt") {
    const main = dptMainNumber(expected);
    return main !== undefined && main === dptMainNumber(actual);
  }
  if (dimension === "function") {
    const left = normalizeText(expected);
    const right = normalizeText(actual);
    return left !== "" && right !== "" && (left.includes(right) || right.includes(left));
  }
  return false;
}

export function score(graph: ProjectGraph, gold: GoldStandard, predictor: Predictor): Score {
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, { rated: 0, correct: 0, partial: 0, wrong: 0, missing: 0, bySource: {} }]),
  ) as Record<Dimension, DimensionScore>;
  const errors: ScoreError[] = [];

  for (const node of graph.groupAddresses) {
    const predictions = predictor.predict(node, graph);
    const entry = gold.entries.get(node.ga.address);
    for (const dimension of DIMENSIONS) {
      const prediction = predictions[dimension];
      const result = dimensions[dimension];
      if (prediction) result.bySource[prediction.source] = (result.bySource[prediction.source] ?? 0) + 1;
      const expected = entry?.[dimension];
      if (expected === undefined) continue;
      result.rated++;
      if (!prediction) {
        result.missing++;
      } else if (equal(dimension, expected, prediction.value)) {
        result.correct++;
      } else if (partial(dimension, expected, prediction.value)) {
        result.partial++;
      } else {
        result.wrong++;
        errors.push({
          address: node.ga.text,
          name: node.ga.name,
          dimension,
          expected,
          actual: prediction.value,
          source: prediction.source,
        });
      }
    }
  }
  return { predictor: predictor.id, project: gold.project, groupAddresses: graph.groupAddresses.length, dimensions, errors };
}

export function formatScores(scores: readonly Score[]): string {
  const lines = ["| Projekt | Verfahren | Dimension | bewertet | korrekt | teils | falsch | fehlt | Quote |", "|---|---|---|---|---|---|---|---|---|"];
  for (const result of scores) {
    for (const dimension of DIMENSIONS) {
      const s = result.dimensions[dimension];
      if (s.rated === 0) continue;
      lines.push(
        `| ${result.project} | ${result.predictor} | ${dimension} | ${s.rated} | ${s.correct} | ${s.partial} | ${s.wrong} | ${s.missing} | ${(accuracy(s) * 100).toFixed(1)} % |`,
      );
    }
  }
  return lines.join("\n");
}
