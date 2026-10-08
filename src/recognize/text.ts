import { normalizeText } from "../bench/normalize.ts";

export { normalizeText };

/** Ein Wort aus einem Namen mit Position, Originalschreibweise und Vergleichsform. */
export interface Token {
  readonly index: number;
  readonly raw: string;
  readonly norm: string;
  /** Zeichenbereich im Originaltext. */
  readonly start: number;
  readonly end: number;
}

const WORD_RUN = /[\p{L}\p{N}]+/gu;
/** Grenzen innerhalb eines Wortlaufs: Binnenmajuskel ("SollTemp"), Buchstabe/Ziffer ("Licht1"). */
const INNER_BOUNDARY = /(?<=[a-zäöüß])(?=[A-ZÄÖÜ])|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u;

/** Zerlegt einen Namen in Woerter und behaelt die Originalpositionen. */
export function tokenize(text: string): Token[] {
  const source = text.normalize("NFC");
  const result: Token[] = [];
  for (const run of source.matchAll(WORD_RUN)) {
    let offset = run.index;
    for (const part of run[0].split(INNER_BOUNDARY)) {
      const norm = normalizeText(part);
      if (norm !== "") result.push({ index: result.length, raw: part, norm, start: offset, end: offset + part.length });
      offset += part.length;
    }
  }
  return result;
}

/** Originaltext der verbleibenden Woerter; zusammenhaengende Woerter behalten ihre Satzzeichen ("Ground/Upper"). */
export function textOf(text: string, tokens: readonly Token[]): string {
  const source = text.normalize("NFC");
  const segments: string[] = [];
  let runStart: Token | undefined;
  let previous: Token | undefined;
  for (const token of tokens) {
    if (runStart && previous && token.index !== previous.index + 1) {
      segments.push(source.slice(runStart.start, previous.end));
      runStart = undefined;
    }
    runStart ??= token;
    previous = token;
  }
  if (runStart && previous) segments.push(source.slice(runStart.start, previous.end));
  return segments.join(" ").replace(/\s+/g, " ").trim();
}
