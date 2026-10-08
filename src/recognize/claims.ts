/**
 * Ein Beleg fuer genau einen Wert einer Dimension. Die Konfidenz ordnet
 * Belege, sie ist keine kalibrierte Wahrscheinlichkeit.
 */

export type ClaimDimension = "room" | "trade" | "direction" | "dpt";

export type ClaimSource =
  | "ets-function"
  | "ets-ga"
  | "ets-wiring"
  | "manufacturer"
  | "name"
  | "hierarchy"
  | "device-location"
  | "pairing"
  | "family"
  | "default";

export interface Claim {
  readonly dimension: ClaimDimension;
  readonly value: string;
  readonly source: ClaimSource;
  readonly confidence: number;
  /** Lesbare Begruendung fuer Menschen, deutsch. */
  readonly evidence: string;
}

/** Bei gleicher Konfidenz entscheidet die Quelle: explizit vor abgeleitet. */
const SOURCE_RANK: Readonly<Record<ClaimSource, number>> = {
  "ets-function": 9,
  "ets-ga": 9,
  "ets-wiring": 8,
  manufacturer: 8,
  pairing: 7,
  name: 6,
  "device-location": 5,
  hierarchy: 4,
  family: 3,
  default: 1,
};

/** Ab diesem Abstand gilt der zweitbeste Beleg als ueberstimmt statt als Widerspruch. */
const CONFLICT_MARGIN = 0.15;
const CONFLICT_FLOOR = 0.6;

export interface Decision {
  readonly winner: Claim | undefined;
  /** Gegenbeleg, der zu nah am Gewinner liegt, um ihn stillschweigend zu verwerfen. */
  readonly conflict: Claim | undefined;
}

export function compareClaims(a: Claim, b: Claim): number {
  return b.confidence - a.confidence || SOURCE_RANK[b.source] - SOURCE_RANK[a.source];
}

export function decide(claims: readonly Claim[], dimension: ClaimDimension): Decision {
  const relevant = claims.filter((claim) => claim.dimension === dimension).sort(compareClaims);
  const winner = relevant[0];
  if (!winner) return { winner: undefined, conflict: undefined };
  const conflict = relevant.find(
    (claim) =>
      !sameValue(dimension, claim.value, winner.value) &&
      claim.confidence >= CONFLICT_FLOOR &&
      winner.confidence - claim.confidence < CONFLICT_MARGIN,
  );
  return { winner, conflict };
}

function sameValue(dimension: ClaimDimension, a: string, b: string): boolean {
  if (dimension !== "dpt") return a === b;
  // Gleicher Haupttyp heisst gleiche Kodierung; der Untertyp der GA gewinnt ohnehin.
  const main = (dpt: string): string => dpt.replace(/^DPST-(\d+)-\d+$/, "DPT-$1");
  return main(a) === main(b);
}
