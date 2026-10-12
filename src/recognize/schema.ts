import type { Space } from "../ets/model.ts";
import type { Direction } from "../graph/direction.ts";
import { isRecord } from "../util/guards.ts";
import { type Aspect, isAspect, isTrade, type Trade } from "./lexicon.ts";
import { normalizeText } from "./text.ts";

/**
 * Namensschema mit Aufbau (Format 2): Muster mit benannten Gruppen lesen den
 * ganzen GA-Namen ("Etage.Raum.Gewerk-Art-Funktion-Kanal"), eine Tabelle sagt,
 * was die Werte der Gruppen bedeuten, Regeln fassen Ausnahmen. Die Gruppe "room"
 * nennt den ETS-Raum; "thing" nennt die Gruppen, die zusammen ein Thing bestimmen.
 *
 * Meist schlaegt ein LLM das Schema vor; es gilt erst, wenn der Errichter es
 * bestaetigt. Fehler im Aufbau lehnen das Schema ab, einzelne unbekannte Begriffe
 * fallen mit Hinweis weg.
 */

export interface SchemaMeaning {
  readonly trade?: Trade;
  readonly direction?: Direction;
  readonly aspect?: Aspect;
  readonly label?: string;
  /** Anderer Wert derselben Gruppe, mit dem dieser ein Thing bildet ("M" zum Raumregler "T"). */
  readonly thing?: string;
  /** Raumname laut ETS fuer ein Raumkuerzel ("WZ" fuer "Wohnzimmer"). */
  readonly room?: string;
}

export interface SchemaPattern {
  readonly regex: string;
  readonly ignoreCase: boolean;
  readonly thing: readonly string[];
}

export interface SchemaRule extends SchemaMeaning {
  readonly match: string;
  readonly why?: string;
}

export interface NamingSchema {
  /** Aufbau in Worten, fuer Menschen. */
  readonly description: string;
  readonly patterns: readonly SchemaPattern[];
  readonly values: Readonly<Record<string, Readonly<Record<string, SchemaMeaning>>>>;
  readonly rules: readonly SchemaRule[];
}

export const EMPTY_SCHEMA: NamingSchema = { description: "", patterns: [], values: {}, rules: [] };

const DIRECTIONS: readonly Direction[] = ["command", "status", "alarm"];
export const ROOM_GROUPS: ReadonlySet<string> = new Set(["room", "raum"]);
const FLOOR_GROUPS: ReadonlySet<string> = new Set(["floor", "etage", "geschoss", "building", "gebaeude"]);
const MAX_PATTERNS = 20;
const MAX_REGEX = 2000;
const MAX_RULES = 200;
const MAX_VALUES = 2000;
const MAX_TEXT = 80;
const MAX_DESCRIPTION = 1000;

/**
 * Wiederholte Gruppe, die selbst auf eine Wiederholung endet ("(a+)+", "(\\w*)*"): Ursache
 * katastrophalen Backtrackings. Die Analyse laeuft im Browser; ein solches Muster wuerde sie einfrieren.
 */
const NESTED_QUANTIFIER = /[+*]\)[+*{]/;

/** Namen der benannten Gruppen eines Musters, in Reihenfolge. */
export function groupNames(source: string): string[] {
  return [...source.matchAll(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g)].map((match) => match[1] ?? "");
}

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

function compiles(source: string, flags: string): string | undefined {
  try {
    new RegExp(source, flags);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function parseMeaning(item: Record<string, unknown>, at: string, warnings: string[]): { -readonly [K in keyof SchemaMeaning]: SchemaMeaning[K] } {
  const meaning: { -readonly [K in keyof SchemaMeaning]: SchemaMeaning[K] } = {};
  const trade = item["trade"];
  if (trade !== undefined) {
    if (isTrade(trade)) meaning.trade = trade;
    else warnings.push(`${at}: unbekanntes Gewerk "${String(trade)}" ignoriert.`);
  }
  const direction = item["direction"];
  if (direction !== undefined) {
    if (isDirection(direction)) meaning.direction = direction;
    else warnings.push(`${at}: unbekannte Richtung "${String(direction)}" ignoriert.`);
  }
  const aspect = item["aspect"];
  if (aspect !== undefined) {
    if (isAspect(aspect)) meaning.aspect = aspect;
    else warnings.push(`${at}: unbekannter Begriff "${String(aspect)}" ignoriert.`);
  }
  for (const key of ["label", "thing", "room"] as const) {
    const value = item[key];
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim() !== "" && value.length <= MAX_TEXT) meaning[key] = value.trim();
    else warnings.push(`${at}: "${key}" muss ein kurzer Text sein, ignoriert.`);
  }
  return meaning;
}

/** Liest den Aufbau-Teil eines Profils im Format 2. Strukturfehler landen in errors, Einzelheiten in warnings. */
export function parseSchema(json: Record<string, unknown>, errors: string[], warnings: string[]): NamingSchema {
  const rawDescription = json["aufbau"] ?? json["description"];
  const description = typeof rawDescription === "string" ? rawDescription.slice(0, MAX_DESCRIPTION) : "";

  const patterns: SchemaPattern[] = [];
  const known = new Set<string>();
  const rawPatterns = json["patterns"] ?? [];
  if (!Array.isArray(rawPatterns)) errors.push('Schema: Feld "patterns" muss eine Liste sein.');
  else {
    if (rawPatterns.length > MAX_PATTERNS) errors.push(`Schema: höchstens ${MAX_PATTERNS} Muster.`);
    rawPatterns.slice(0, MAX_PATTERNS).forEach((item: unknown, index) => {
      const at = `Muster ${index + 1}`;
      if (!isRecord(item) || typeof item["regex"] !== "string") {
        errors.push(`${at}: erwartet ein Objekt mit "regex".`);
        return;
      }
      const regex = item["regex"];
      const ignoreCase = item["ignoreCase"] === true || item["flags"] === "i";
      if (regex.length > MAX_REGEX) {
        errors.push(`${at}: Regex länger als ${MAX_REGEX} Zeichen.`);
        return;
      }
      const problem = compiles(regex, ignoreCase ? "i" : "");
      if (problem) {
        errors.push(`${at}: Regex ungültig (${problem}).`);
        return;
      }
      if (NESTED_QUANTIFIER.test(regex)) {
        errors.push(`${at}: verschachtelte Wiederholung wie "(a+)+"; solche Muster können die Analyse sehr lange blockieren.`);
        return;
      }
      const groups = groupNames(regex);
      if (groups.length === 0) {
        errors.push(`${at}: Regex ohne benannte Gruppen.`);
        return;
      }
      for (const group of groups) known.add(group);
      const rawThing = Array.isArray(item["thing"]) ? item["thing"] : [];
      const thing = rawThing.filter((name): name is string => typeof name === "string");
      const missing = thing.filter((name) => !groups.includes(name));
      if (missing.length > 0) warnings.push(`${at}: Gruppen ${missing.map((name) => `"${name}"`).join(", ")} für das Thing gibt es im Regex nicht.`);
      patterns.push({ regex, ignoreCase, thing: thing.filter((name) => groups.includes(name)) });
    });
  }

  const values: Record<string, Record<string, SchemaMeaning>> = {};
  const rawValues = json["values"] ?? {};
  let valueCount = 0;
  if (!isRecord(rawValues)) errors.push('Schema: Feld "values" muss ein Objekt sein.');
  else {
    for (const [group, table] of Object.entries(rawValues)) {
      if (!isRecord(table)) {
        warnings.push(`Werte "${group}": kein Objekt, ignoriert.`);
        continue;
      }
      if (!known.has(group)) warnings.push(`Werte "${group}": Gruppe kommt in keinem Muster vor.`);
      const entries: Record<string, SchemaMeaning> = {};
      for (const [value, item] of Object.entries(table)) {
        if (++valueCount > MAX_VALUES) break;
        if (!isRecord(item)) {
          warnings.push(`Wert "${group}=${value}": kein Objekt, ignoriert.`);
          continue;
        }
        const meaning = parseMeaning(item, `Wert "${group}=${value}"`, warnings);
        if (Object.keys(meaning).length > 0) entries[value] = meaning;
      }
      values[group] = entries;
    }
    if (valueCount > MAX_VALUES) errors.push(`Schema: höchstens ${MAX_VALUES} Werte.`);
  }

  const rules: SchemaRule[] = [];
  const rawRules = json["rules"] ?? [];
  if (!Array.isArray(rawRules)) errors.push('Schema: Feld "rules" muss eine Liste sein.');
  else {
    if (rawRules.length > MAX_RULES) errors.push(`Schema: höchstens ${MAX_RULES} Regeln.`);
    rawRules.slice(0, MAX_RULES).forEach((item: unknown, index) => {
      const at = `Regel ${index + 1}`;
      if (!isRecord(item) || typeof item["match"] !== "string" || item["match"].length > MAX_REGEX) {
        errors.push(`${at}: erwartet ein Objekt mit "match".`);
        return;
      }
      const problem = compiles(item["match"], "");
      if (problem || NESTED_QUANTIFIER.test(item["match"])) {
        errors.push(`${at}: Regex ungültig (${problem ?? "verschachtelte Wiederholung"}).`);
        return;
      }
      const meaning = parseMeaning(item, at, warnings);
      if (Object.keys(meaning).length === 0) {
        warnings.push(`${at}: ohne Wirkung, ignoriert.`);
        return;
      }
      const why = typeof item["why"] === "string" ? item["why"].slice(0, MAX_TEXT * 2) : undefined;
      rules.push({ match: item["match"], ...meaning, ...(why ? { why } : {}) });
    });
  }
  return { description, patterns, values, rules };
}

interface CompiledPattern {
  readonly regex: RegExp;
  readonly groups: readonly string[];
  readonly thing: readonly string[];
}

export interface CompiledSchema {
  readonly patterns: readonly CompiledPattern[];
  /** Je Gruppe die Bedeutung der Werte, Werte klein geschrieben. */
  readonly values: ReadonlyMap<string, ReadonlyMap<string, SchemaMeaning>>;
  readonly rules: readonly { readonly regex: RegExp; readonly rule: SchemaRule }[];
  readonly resolveRoom: (raw: string, floor: string | undefined) => string | undefined;
}

export interface SchemaMatch {
  readonly pattern: number;
  readonly groups: Readonly<Record<string, string>>;
  readonly roomId: string | undefined;
  readonly trade: Trade | undefined;
  readonly direction: Direction | undefined;
  readonly aspects: readonly Aspect[];
  /** Gleicher Schluessel, gleiches Thing. */
  readonly thingKey: string;
  /** Titel des Things ohne Raum ("Licht ChA"). */
  readonly thingLabel: string;
  /** Was das Muster gelesen hat, fuer die Begruendung. */
  readonly detail: string;
}

const PLACE_TYPES = new Set(["Floor", "Building", "BuildingPart"]);
const compact = (text: string): string => normalizeText(text).replace(/\s+/g, "");

/** Raum zum Gruppenwert: exakter Name, bei gleichnamigen Raeumen entscheidet die Etage aus dem Muster. */
function roomResolver(spaces: readonly Space[]): CompiledSchema["resolveRoom"] {
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const byName = new Map<string, Space[]>();
  for (const space of spaces) byName.set(compact(space.name), [...(byName.get(compact(space.name)) ?? []), space]);
  const ancestors = (space: Space): Space[] => {
    const chain: Space[] = [];
    let current = space.parentId ? byId.get(space.parentId) : undefined;
    while (current && chain.length < 20) {
      chain.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return chain;
  };
  return (raw, floor) => {
    const all = byName.get(compact(raw)) ?? [];
    const rooms = all.filter((space) => !PLACE_TYPES.has(space.type));
    let candidates = rooms.length > 0 ? rooms : all;
    if (candidates.length > 1 && floor) {
      const wanted = compact(floor);
      candidates = candidates.filter((space) => ancestors(space).some((ancestor) => compact(ancestor.name) === wanted));
    }
    return candidates.length === 1 ? candidates[0]?.id : undefined;
  };
}

export function compileSchema(schema: NamingSchema, spaces: readonly Space[]): CompiledSchema {
  const patterns = schema.patterns.map((pattern) => ({
    regex: new RegExp(pattern.regex, pattern.ignoreCase ? "i" : ""),
    groups: groupNames(pattern.regex),
    thing: pattern.thing,
  }));
  const values = new Map<string, Map<string, SchemaMeaning>>();
  for (const [group, table] of Object.entries(schema.values)) {
    values.set(group, new Map(Object.entries(table).map(([value, meaning]) => [value.trim().toLowerCase(), meaning])));
  }
  const rules = schema.rules.map((rule) => ({ regex: new RegExp(rule.match), rule }));
  return { patterns, values, rules, resolveRoom: roomResolver(spaces) };
}

export function matchSchema(schema: CompiledSchema, name: string): SchemaMatch | undefined {
  const text = name.trim();
  for (const [index, pattern] of schema.patterns.entries()) {
    const found = pattern.regex.exec(text);
    if (!found?.groups) continue;
    const groups: Record<string, string> = {};
    for (const group of pattern.groups) {
      const value = found.groups[group];
      if (value !== undefined && value.trim() !== "") groups[group] = value.trim();
    }
    const meaningOf = (group: string, value: string | undefined): SchemaMeaning | undefined =>
      value === undefined ? undefined : schema.values.get(group)?.get(value.toLowerCase());

    let trade: Trade | undefined;
    let direction: Direction | undefined;
    const aspects: Aspect[] = [];
    for (const group of pattern.groups) {
      const meaning = meaningOf(group, groups[group]);
      if (!meaning) continue;
      trade = meaning.trade ?? trade;
      direction = meaning.direction ?? direction;
      if (meaning.aspect && !aspects.includes(meaning.aspect)) aspects.push(meaning.aspect);
    }
    // Regeln sind Ausnahmen: Sie gehen den Werten vor, spaetere vor frueheren.
    for (const { regex, rule } of schema.rules) {
      if (!regex.test(text)) continue;
      trade = rule.trade ?? trade;
      direction = rule.direction ?? direction;
      if (rule.aspect && !aspects.includes(rule.aspect)) aspects.unshift(rule.aspect);
    }

    const roomGroup = pattern.groups.find((group) => ROOM_GROUPS.has(group));
    const floorGroup = pattern.groups.find((group) => FLOOR_GROUPS.has(group));
    const rawRoom = roomGroup ? groups[roomGroup] : undefined;
    const roomName = roomGroup ? (meaningOf(roomGroup, rawRoom)?.room ?? rawRoom) : undefined;
    const roomId = roomName ? schema.resolveRoom(roomName, floorGroup ? groups[floorGroup] : undefined) : undefined;

    const parts: string[] = [];
    const labels: string[] = [];
    for (const group of pattern.thing) {
      const value = groups[group];
      if (ROOM_GROUPS.has(group)) {
        parts.push(roomId ?? (value ?? "").toLowerCase());
        continue;
      }
      const alias = meaningOf(group, value)?.thing;
      const target = alias ?? value;
      parts.push((target ?? "").toLowerCase());
      if (target === undefined || FLOOR_GROUPS.has(group)) continue;
      labels.push(meaningOf(group, target)?.label ?? target);
    }
    return {
      pattern: index,
      groups,
      roomId,
      trade,
      direction,
      aspects,
      thingKey: `schema:${index}|${parts.join("|")}`,
      thingLabel: labels.join(" "),
      detail: Object.entries(groups)
        .map(([group, value]) => `${group}=${value}`)
        .join(", "),
    };
  }
  return undefined;
}

export interface SchemaCoverage {
  /** Treffer je Muster. */
  readonly perPattern: readonly number[];
  readonly unmatched: number;
  readonly unmatchedExamples: readonly string[];
  /** Raumwerte aus den Mustern ohne passenden ETS-Raum. */
  readonly unknownRooms: readonly string[];
  readonly things: number;
}

/** Wie viel eines Projekts das Schema liest; Grundlage fuer die Pruefung vor der Bestaetigung. */
export function schemaCoverage(schema: CompiledSchema, names: readonly string[]): SchemaCoverage {
  const perPattern = schema.patterns.map(() => 0);
  const unmatchedExamples: string[] = [];
  const unknownRooms = new Set<string>();
  const things = new Set<string>();
  let unmatched = 0;
  for (const name of names) {
    const found = matchSchema(schema, name);
    if (!found) {
      unmatched++;
      if (unmatchedExamples.length < 10) unmatchedExamples.push(name);
      continue;
    }
    perPattern[found.pattern] = (perPattern[found.pattern] ?? 0) + 1;
    things.add(found.thingKey);
    const room = Object.entries(found.groups).find(([group]) => ROOM_GROUPS.has(group))?.[1];
    if (room && !found.roomId) unknownRooms.add(room);
  }
  return { perPattern, unmatched, unmatchedExamples, unknownRooms: [...unknownRooms].slice(0, 20), things: things.size };
}

/** Dateiform des Aufbau-Teils, wie ihn parseSchema wieder liest. */
export function schemaJson(schema: NamingSchema): Record<string, unknown> {
  return {
    ...(schema.description ? { aufbau: schema.description } : {}),
    patterns: schema.patterns.map((pattern) => ({ regex: pattern.regex, ...(pattern.ignoreCase ? { ignoreCase: true } : {}), thing: pattern.thing })),
    values: schema.values,
    rules: schema.rules,
  };
}
