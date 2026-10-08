import { dptMainNumber } from "../ets/dpt-id.ts";
import type { Reviews } from "../recognize/analyze.ts";
import type { ClaimDimension, ClaimSource } from "../recognize/claims.ts";
import type { ProjectAnalysis } from "../recognize/pipeline.ts";
import { DIMENSIONS, displayValue, type ValueView } from "./snapshot.ts";

/**
 * Vergleicht die Erkennung ohne Antworten mit den bestaetigten Antworten.
 * Jede Bestaetigung ist damit ein Gold-Wert: so misst sich die Erkennung an
 * echten Projekten, ohne dass jemand einen Gold-Standard von Hand schreibt.
 */

export type CheckResult = "correct" | "partial" | "wrong" | "missing";

export interface ReviewCheckEntry {
  readonly gaId: string;
  readonly ga: string;
  readonly name: string;
  readonly dimension: ClaimDimension;
  readonly confirmed: ValueView;
  readonly predicted: (ValueView & { readonly source: ClaimSource; readonly confidence: number; readonly evidence: string }) | undefined;
  readonly result: CheckResult;
}

export interface CheckTally {
  readonly rated: number;
  readonly correct: number;
  readonly partial: number;
  readonly wrong: number;
  readonly missing: number;
}

export interface ReviewCheck {
  readonly entries: readonly ReviewCheckEntry[];
  readonly byDimension: Readonly<Record<ClaimDimension, CheckTally>>;
}

function compare(dimension: ClaimDimension, confirmed: string, predicted: string | undefined): CheckResult {
  if (predicted === undefined) return "missing";
  if (confirmed === predicted) return "correct";
  if (dimension === "dpt") {
    const main = dptMainNumber(confirmed);
    if (main !== undefined && main === dptMainNumber(predicted)) return "partial";
  }
  return "wrong";
}

/** `baseline` muss ohne Antworten, aber mit denselben uebrigen Optionen erkannt sein. */
export function checkReviews(baseline: ProjectAnalysis, reviews: Reviews): ReviewCheck {
  const graph = baseline.recognition.graph;
  const entries: ReviewCheckEntry[] = [];
  const tally = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, { rated: 0, correct: 0, partial: 0, wrong: 0, missing: 0 }])) as Record<
    ClaimDimension,
    { rated: number; correct: number; partial: number; wrong: number; missing: number }
  >;
  for (const entry of baseline.recognition.groupAddresses) {
    const ga = entry.analysis.node.ga;
    const review = reviews.get(ga.id);
    if (!review) continue;
    for (const dimension of DIMENSIONS) {
      const confirmed = review[dimension];
      if (confirmed === undefined || confirmed === "") continue;
      const winner = entry.decisions[dimension].winner;
      const result = compare(dimension, confirmed, winner?.value);
      tally[dimension].rated++;
      tally[dimension][result]++;
      entries.push({
        gaId: ga.id,
        ga: ga.text,
        name: ga.name,
        dimension,
        confirmed: { value: confirmed, display: displayValue(dimension, confirmed, graph) },
        predicted: winner
          ? {
              value: winner.value,
              display: displayValue(dimension, winner.value, graph),
              source: winner.source,
              confidence: winner.confidence,
              evidence: winner.evidence,
            }
          : undefined,
        result,
      });
    }
  }
  return { entries, byDimension: tally };
}

export function checkAccuracy(tally: CheckTally): number | undefined {
  return tally.rated === 0 ? undefined : tally.correct / tally.rated;
}
