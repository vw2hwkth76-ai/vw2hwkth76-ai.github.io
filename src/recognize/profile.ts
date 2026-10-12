import type { Space } from "../ets/model.ts";
import { isRecord } from "../util/guards.ts";
import { type Aspect, isAspect, isMarker, isTrade, type Marker, type Trade } from "./lexicon.ts";
import { type CompiledSchema, compileSchema, EMPTY_SCHEMA, type NamingSchema, parseSchema, schemaJson } from "./schema.ts";
import { normalizeText } from "./text.ts";

/**
 * Namensschema eines Integrators: projektuebergreifende Kuerzeltabelle.
 * Eine bestaetigte Regel; sie steht unter ETS-Angaben und Verdrahtung,
 * aber ueber jeder Namensheuristik.
 */

export const PROFILE_FORMAT = "knx-td-namensschema-1";
/** Mit Aufbau: Muster, Bedeutung der Gruppenwerte, Regeln; die Kuerzeltabelle bleibt Teil davon. */
export const PROFILE_FORMAT_V2 = "knx-td-namensschema-2";

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
  readonly format: typeof PROFILE_FORMAT | typeof PROFILE_FORMAT_V2;
  readonly name: string;
  readonly entries: readonly ProfileEntry[];
  readonly schema: NamingSchema;
}

export interface CompiledEntry {
  readonly entry: ProfileEntry;
  readonly roomId: string | undefined;
}

export interface CompiledProfile {
  readonly name: string;
  readonly tokens: ReadonlyMap<string, CompiledEntry>;
  /** Muster des Schemas; fehlt bei einer reinen Kuerzeltabelle. */
  readonly schema: CompiledSchema | undefined;
  readonly warnings: readonly string[];
}

const MAX_ENTRIES = 2000;
const MAX_TEXT = 80;

export type ProfileResult = { ok: true; profile: NamingProfile; warnings: string[] } | { ok: false; errors: string[] };

/** Prueft ein Profil aus einer Datei oder einem KI-Vorschlag; nichts wird stillschweigend uebernommen. */
export function parseProfile(json: unknown): ProfileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(json)) return { ok: false, errors: ["Profil: erwartet ein JSON-Objekt."] };
  const format = json["format"];
  const v2 = format === PROFILE_FORMAT_V2;
  if (format !== PROFILE_FORMAT && !v2) errors.push(`Profil: Feld "format" muss "${PROFILE_FORMAT}" oder "${PROFILE_FORMAT_V2}" sein.`);
  const name = typeof json["name"] === "string" ? json["name"].slice(0, MAX_TEXT) : "";
  // Im Format 2 ist die Kuerzeltabelle optional; das Muster allein kann genuegen.
  const raw = json["entries"] ?? (v2 ? [] : undefined);
  if (!Array.isArray(raw)) return { ok: false, errors: [...errors, 'Profil: Feld "entries" fehlt oder ist keine Liste.'] };
  const schema = v2 ? parseSchema(json, errors, warnings) : EMPTY_SCHEMA;
  if (v2 && schema.patterns.length === 0 && raw.length === 0 && errors.length === 0) errors.push("Schema: weder Muster noch Kürzel.");
  if (raw.length > MAX_ENTRIES) errors.push(`Profil: höchstens ${MAX_ENTRIES} Einträge.`);

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
  return errors.length > 0 ? { ok: false, errors } : { ok: true, profile: { format: v2 ? PROFILE_FORMAT_V2 : PROFILE_FORMAT, name, entries, schema }, warnings };
}

/** Dateiform eines geprueften Profils; parseProfile liest sie unveraendert wieder. */
export function profileJson(profile: NamingProfile): Record<string, unknown> {
  const withSchema = profile.schema.patterns.length > 0;
  return {
    format: withSchema ? PROFILE_FORMAT_V2 : PROFILE_FORMAT,
    name: profile.name,
    ...(withSchema ? schemaJson(profile.schema) : {}),
    entries: profile.entries,
  };
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
      if (roomId === undefined) warnings.push(`Profil "${profile.name}": Raum "${entry.room}" für "${entry.token}" gibt es in diesem Projekt nicht.`);
    }
    tokens.set(normalizeText(entry.token), { entry, roomId });
  }
  const schema = profile.schema.patterns.length > 0 ? compileSchema(profile.schema, spaces) : undefined;
  return { name: profile.name, tokens, schema, warnings };
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
