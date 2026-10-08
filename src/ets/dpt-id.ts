const DPST = /^DPST-(\d+)-(\d+)$/i;
const DPT = /^DPT-(\d+)$/i;
const DOTTED = /^(?:DPT\s*)?(\d+)\.(\d+)$/i;

/**
 * Normalisiert ETS-Kennungen auf "DPST-<Haupt>-<Unter>" oder "DPT-<Haupt>".
 * Ein Attribut kann mehrere, durch Leerzeichen getrennte Werte tragen.
 */
export function parseDptList(value: string | undefined): string[] {
  if (value === undefined) return [];
  const result: string[] = [];
  for (const token of value.split(/\s+/)) {
    const normalized = normalizeDpt(token);
    if (normalized !== undefined && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

export function normalizeDpt(token: string): string | undefined {
  const trimmed = token.trim();
  if (trimmed === "") return undefined;
  const sub = DPST.exec(trimmed);
  if (sub) return `DPST-${Number(sub[1])}-${Number(sub[2])}`;
  const main = DPT.exec(trimmed);
  if (main) return `DPT-${Number(main[1])}`;
  const dotted = DOTTED.exec(trimmed);
  if (dotted) return `DPST-${Number(dotted[1])}-${Number(dotted[2])}`;
  return undefined;
}

export function dptMainNumber(dpt: string): number | undefined {
  const match = /^DPS?T-(\d+)/.exec(dpt);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** Schreibweise wie in Datenblaettern, z. B. "9.001"; Haupttypen als "9.*". */
export function dptDotted(dpt: string): string {
  const sub = DPST.exec(dpt);
  if (sub) return `${Number(sub[1])}.${String(Number(sub[2])).padStart(3, "0")}`;
  const main = DPT.exec(dpt);
  return main ? `${Number(main[1])}.*` : dpt;
}
