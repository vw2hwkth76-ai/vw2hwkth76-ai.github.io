import type { Space } from "../ets/model.ts";
import { isRecord } from "../util/guards.ts";
import { type Aspect, isAspect, isMarker, isTrade, type Marker, type Trade } from "./lexicon.ts";
import { normalizeText } from "./text.ts";

/**
 * Namensschema eines Integrators: projektuebergreifende Kuerzeltabelle.
 * Eine bestaetigte Regel; sie steht unter ETS-Angaben und Verdrahtung,
 * aber ueber jeder Namensheuristik.
 */

export const PROFILE_FORMAT = "knx-td-namensschema-1";

export interface ProfileEntry {
  /** Kuerzel wie geschrieben, verglichen ohne Gross/Klein und Umlaute: "L", "LD", "LR", "RM". */
  readonly token: string;
  readonly trade?: Trade;
  readonly aspect?: Aspect;
  readonly marker?: Marker;
  /** Raumname wie in der ETS-Gebaeudestruktur. */
  readonly room?: string;
  /** Anzeigename statt des Kuerzels, z. B. "Licht dimmbar". */
  readonly label?: string;
}

export interface NamingProfile {
  readonly format: typeof PROFILE_FORMAT;
  readonly name: string;
  readonly entries: readonly ProfileEntry[];
}

export interface CompiledEntry {
  readonly entry: ProfileEntry;
  readonly roomId: string | undefined;
}

export interface CompiledProfile {
  readonly name: string;
  readonly tokens: ReadonlyMap<string, CompiledEntry>;
  readonly warnings: readonly string[];
}

const MAX_ENTRIES = 2000;
const MAX_TEXT = 80;

export type ProfileResult = { ok: true; profile: NamingProfile } | { ok: false; errors: string[] };

/** Prueft ein Profil aus einer Datei oder einem KI-Vorschlag; nichts wird stillschweigend uebernommen. */
export function parseProfile(json: unknown): ProfileResult {
  const errors: string[] = [];
  if (!isRecord(json)) return { ok: false, errors: ["Profil: erwartet ein JSON-Objekt."] };
  if (json["format"] !== PROFILE_FORMAT) errors.push(`Profil: Feld "format" muss "${PROFILE_FORMAT}" sein.`);
  const name = typeof json["name"] === "string" ? json["name"].slice(0, MAX_TEXT) : "";
  const raw = json["entries"];
  if (!Array.isArray(raw)) return { ok: false, errors: [...errors, 'Profil: Feld "entries" fehlt oder ist keine Liste.'] };
  if (raw.length > MAX_ENTRIES) errors.push(`Profil: hoechstens ${MAX_ENTRIES} Eintraege.`);

  const entries: ProfileEntry[] = [];
  const seen = new Map<string, number>();
  raw.slice(0, MAX_ENTRIES).forEach((item: unknown, index) => {
    const at = `Eintrag ${index + 1}`;
    if (!isRecord(item)) {
      errors.push(`${at}: kein Objekt.`);
      return;
    }
    const token = item["token"];
    if (typeof token !== "string" || normalizeText(token) === "" || token.length > MAX_TEXT || normalizeText(token).includes(" ")) {
      errors.push(`${at}: "token" muss ein einzelnes Wort sein.`);
      return;
    }
    const entry: { -readonly [K in keyof ProfileEntry]: ProfileEntry[K] } = { token };
    const trade = item["trade"];
    if (trade !== undefined) {
      if (isTrade(trade)) entry.trade = trade;
      else errors.push(`${at}: unbekanntes Gewerk "${String(trade)}".`);
    }
    const aspect = item["aspect"];
    if (aspect !== undefined) {
      if (isAspect(aspect)) entry.aspect = aspect;
      else errors.push(`${at}: unbekannter Aspekt "${String(aspect)}".`);
    }
    const marker = item["marker"];
    if (marker !== undefined) {
      if (isMarker(marker)) entry.marker = marker;
      else errors.push(`${at}: unbekanntes Kennwort "${String(marker)}".`);
    }
    for (const key of ["room", "label"] as const) {
      const value = item[key];
      if (value === undefined) continue;
      if (typeof value === "string" && value.trim() !== "" && value.length <= MAX_TEXT) entry[key] = value.trim();
      else errors.push(`${at}: "${key}" muss ein kurzer Text sein.`);
    }
    const declared = ["trade", "aspect", "marker", "room", "label"].some((key) => item[key] !== undefined);
    if (!declared) {
      errors.push(`${at}: "${token}" hat keine Bedeutung.`);
      return;
    }
    const key = normalizeText(token);
    const previous = seen.get(key);
    if (previous !== undefined) errors.push(`${at}: "${token}" ist schon in Eintrag ${previous + 1} belegt.`);
    seen.set(key, index);
    entries.push(entry);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, profile: { format: PROFILE_FORMAT, name, entries } };
}

/** Bindet Raumnamen an die Raeume des Projekts. Unbekannte Raeume werden gemeldet, nicht geraten. */
export function compileProfile(profile: NamingProfile, spaces: readonly Space[]): CompiledProfile {
  const byName = new Map(spaces.map((space) => [normalizeText(space.name), space.id]));
  const warnings: string[] = [];
  const tokens = new Map<string, CompiledEntry>();
  for (const entry of profile.entries) {
    let roomId: string | undefined;
    if (entry.room !== undefined) {
      roomId = byName.get(normalizeText(entry.room));
      if (roomId === undefined) warnings.push(`Profil "${profile.name}": Raum "${entry.room}" fuer "${entry.token}" gibt es in diesem Projekt nicht.`);
    }
    tokens.set(normalizeText(entry.token), { entry, roomId });
  }
  return { name: profile.name, tokens, warnings };
}

export interface UnknownCode {
  readonly token: string;
  readonly count: number;
  readonly examples: readonly string[];
  /** DPT-Haupttypen der GAs, in denen das Kuerzel vorkommt; Hinweis auf die Bedeutung. */
  readonly dptMains: readonly number[];
}

export interface CodeSource {
  readonly name: string;
  readonly tokens: readonly { readonly index: number; readonly raw: string; readonly norm: string }[];
  /** Tokenpositionen, die Vokabular, Raumabgleich oder Profil schon erklaeren. */
  readonly explained: ReadonlySet<number>;
  readonly dptMain: number | undefined;
}

/**
 * Kurze, wiederkehrende Kuerzel ohne bekannte Bedeutung ("L", "LD", "HZ").
 * Ausgangspunkt fuer Rueckfragen und fuer den KI-Vorschlag eines Namensschemas.
 */
export function unknownCodes(sources: readonly CodeSource[], minCount = 2): UnknownCode[] {
  const found = new Map<string, { raw: string; count: number; examples: string[]; mains: Set<number> }>();
  for (const source of sources) {
    for (const token of source.tokens) {
      if (source.explained.has(token.index) || /^\d+$/.test(token.norm) || token.norm.length > 4) continue;
      const looksLikeCode = token.raw.length <= 2 || token.raw === token.raw.toUpperCase();
      if (!looksLikeCode) continue;
      const entry = found.get(token.norm) ?? { raw: token.raw, count: 0, examples: [], mains: new Set<number>() };
      entry.count++;
      if (entry.examples.length < 3 && !entry.examples.includes(source.name)) entry.examples.push(source.name);
      if (source.dptMain !== undefined) entry.mains.add(source.dptMain);
      found.set(token.norm, entry);
    }
  }
  return [...found.values()]
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw))
    .map((entry) => ({ token: entry.raw, count: entry.count, examples: entry.examples, dptMains: [...entry.mains].sort((a, b) => a - b) }));
}
