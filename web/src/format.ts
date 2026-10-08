import type { ClaimSource } from "../../src/recognize/claims.ts";

const NUMBER = new Intl.NumberFormat("de-DE");
const PERCENT = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });

export function count(value: number): string {
  return NUMBER.format(value);
}

export function share(part: number, total: number): string {
  return PERCENT.format(total === 0 ? 0 : part / total);
}

export function ratio(value: number): string {
  return PERCENT.format(value);
}

/**
 * Belegstaerke fuer die Anzeige: 4 bestaetigt, 3 fest (ab 0,85), 2 mittel
 * (ab 0,65), 1 schwach. Die Konfidenz ordnet Belege, sie ist keine
 * Wahrscheinlichkeit; die Stufen sind deshalb grob.
 */
export type Strength = 1 | 2 | 3 | 4;

export function strengthOf(source: ClaimSource, confidence: number): Strength {
  if (source === "review") return 4;
  if (confidence >= 0.85) return 3;
  if (confidence >= 0.65) return 2;
  return 1;
}

export const STRENGTH_LABEL: Readonly<Record<Strength, string>> = {
  4: "bestätigt",
  3: "fester Beleg",
  2: "mittlerer Beleg",
  1: "schwacher Beleg",
};

export function confidence(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function today(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Dateiname ohne Zeichen, die Betriebssysteme ablehnen. */
export function fileStem(name: string): string {
  return (
    name
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "projekt"
  );
}
