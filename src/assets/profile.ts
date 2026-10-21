import { isThingType, ROLE_NAMES, type ThingType } from "../recognize/things.ts";
import { isRecord } from "../util/guards.ts";

/**
 * Zielprofil fuer den Asset-Export: welche Asset-Typen die Zielplattform kennt, welche Klasse sie tragen, welche
 * Attribute sie haben und wie Things, Rollen und Raeume der Werkstatt darauf abgebildet werden.
 *
 * Das Profil ist Daten, kein Code: Ein plattformspezifischer Katalog bleibt eine private Datei des Nutzers und wird
 * zur Laufzeit geladen, wie das Namensschema. Ohne Profil entstehen alle Typen aus der Erkennung.
 */

export const ASSET_PROFILE_FORMAT = "knx-asset-profile-1";

export const SUBTYPES = ["input", "output", "status", "info", "property"] as const;
export type Subtype = (typeof SUBTYPES)[number];

/** Ebenen ueber dem ersten Gebaeude der ETS; die ETS kennt sie nicht, sie kommen aus der Eingabe. */
export const UPPER_LEVELS = ["country", "region", "site"] as const;
export type UpperLevel = (typeof UPPER_LEVELS)[number];

export interface AttributeDef {
  readonly name: string;
  readonly subtype: Subtype;
  /** Physikalische Groesse der Zielplattform ("temperature"), frei. */
  readonly quantity?: string;
  readonly unit?: string;
}

export interface TypeDef {
  readonly key: string;
  /** Semantische Klasse, z. B. RealEstateCore oder Brick ("Lighting_System"). */
  readonly class: string;
  readonly label?: Readonly<Record<string, string>>;
  readonly attributes: readonly AttributeDef[];
  /** Tags, die jedes Asset dieses Typs bekommt, "kategorie:wert" oder frei. */
  readonly tags?: readonly string[];
}

export interface ThingRule {
  readonly match: {
    readonly thingType?: readonly ThingType[];
    readonly trade?: readonly string[];
    /** Mindestens eine dieser Rollen kommt im Thing vor. */
    readonly anyRole?: readonly string[];
    readonly central?: boolean;
  };
  readonly type: string;
}

export interface AttributeRule {
  /** Rollen der Werkstatt ("SwitchOnOff"); Befehl und Rueckmeldung derselben Groesse teilen sich eine Regel. */
  readonly roles: readonly string[];
  /** Nur in diesem Typ; ohne Angabe in jedem Typ, der das Attribut hat. */
  readonly type?: string;
  readonly attribute: string;
}

export interface AssetProfile {
  readonly format: typeof ASSET_PROFILE_FORMAT;
  readonly name: string;
  readonly types: readonly TypeDef[];
  /** ETS-Raumtyp ("Building", "Floor", "Room", "DistributionBoard") auf Typ-Schluessel. */
  readonly spaces: Readonly<Record<string, string>>;
  /** Typen der Ebenen ueber dem Gebaeude. */
  readonly upper: Readonly<Partial<Record<UpperLevel, string>>>;
  readonly things: readonly ThingRule[];
  readonly attributes: readonly AttributeRule[];
  /** Klasse und Praefix fuer Typen, die der Export selbst anlegt. */
  readonly generated: { readonly prefix: string; readonly class: string };
}

export const EMPTY_ASSET_PROFILE: AssetProfile = {
  format: ASSET_PROFILE_FORMAT,
  name: "Ohne Zielprofil",
  types: [],
  spaces: {},
  upper: {},
  things: [],
  attributes: [],
  generated: { prefix: "knx_", class: "Unclassified" },
};

export type AssetProfileResult = { readonly ok: true; readonly profile: AssetProfile; readonly warnings: readonly string[] } | { readonly ok: false; readonly errors: readonly string[] };

const MAX_TYPES = 500;
const MAX_RULES = 2000;
const MAX_TEXT = 120;
const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" && value.length <= MAX_TEXT ? value.trim() : undefined);

function textList(value: unknown, where: string, warnings: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${where}: erwartet eine Liste, ignoriert.`);
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    const item = text(entry);
    if (item) result.push(item);
    else warnings.push(`${where}: Eintrag ${JSON.stringify(entry)?.slice(0, 40)} ist kein Text, ignoriert.`);
  }
  return result;
}

function isSubtype(value: unknown): value is Subtype {
  return typeof value === "string" && (SUBTYPES as readonly string[]).includes(value);
}

function parseType(json: unknown, index: number, errors: string[], warnings: string[]): TypeDef | undefined {
  const where = `types[${index}]`;
  if (!isRecord(json)) {
    errors.push(`${where}: erwartet ein Objekt.`);
    return undefined;
  }
  const key = text(json["key"]);
  if (!key || !KEY.test(key)) {
    errors.push(`${where}: "key" fehlt oder enthält unzulässige Zeichen (Buchstaben, Ziffern, _ . -).`);
    return undefined;
  }
  const cls = text(json["class"]) ?? EMPTY_ASSET_PROFILE.generated.class;
  if (json["class"] === undefined) warnings.push(`${where} (${key}): ohne "class", gilt als ${EMPTY_ASSET_PROFILE.generated.class}.`);
  const attributes: AttributeDef[] = [];
  const seen = new Set<string>();
  const rawAttributes = json["attributes"] ?? [];
  if (!Array.isArray(rawAttributes)) errors.push(`${where} (${key}): "attributes" muss eine Liste sein.`);
  else
    rawAttributes.forEach((raw, position) => {
      const at = `${where}.attributes[${position}]`;
      if (!isRecord(raw)) return void warnings.push(`${at}: kein Objekt, ignoriert.`);
      const name = text(raw["name"]);
      if (!name || !KEY.test(name)) return void warnings.push(`${at}: "name" fehlt oder ist unzulässig, ignoriert.`);
      if (!isSubtype(raw["subtype"])) return void warnings.push(`${at} (${name}): "subtype" muss einer von ${SUBTYPES.join(", ")} sein, ignoriert.`);
      if (seen.has(name)) return void warnings.push(`${at}: "${name}" doppelt, ignoriert.`);
      seen.add(name);
      const quantity = text(raw["quantity"]);
      const unit = text(raw["unit"]);
      attributes.push({ name, subtype: raw["subtype"], ...(quantity ? { quantity } : {}), ...(unit ? { unit } : {}) });
    });
  const labelRaw = json["label"];
  const label = isRecord(labelRaw) ? Object.fromEntries(Object.entries(labelRaw).flatMap(([lang, value]) => (text(value) ? [[lang, text(value) ?? ""]] : []))) : undefined;
  const tags = textList(json["tags"], `${where}.tags`, warnings);
  return { key, class: cls, attributes, ...(label && Object.keys(label).length > 0 ? { label } : {}), ...(tags.length > 0 ? { tags } : {}) };
}

/** Prueft ein Zielprofil; Fehler verhindern die Nutzung, Hinweise nennen Ignoriertes. */
export function parseAssetProfile(json: unknown): AssetProfileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(json)) return { ok: false, errors: ["Zielprofil: erwartet ein JSON-Objekt."] };
  if (json["format"] !== ASSET_PROFILE_FORMAT) return { ok: false, errors: [`Zielprofil: "format" muss "${ASSET_PROFILE_FORMAT}" sein.`] };
  const name = text(json["name"]) ?? "Zielprofil";

  const rawTypes = json["types"] ?? [];
  if (!Array.isArray(rawTypes)) return { ok: false, errors: ['Zielprofil: "types" muss eine Liste sein.'] };
  if (rawTypes.length > MAX_TYPES) return { ok: false, errors: [`Zielprofil: höchstens ${MAX_TYPES} Typen.`] };
  const types: TypeDef[] = [];
  const keys = new Set<string>();
  rawTypes.forEach((raw, index) => {
    const type = parseType(raw, index, errors, warnings);
    if (!type) return;
    if (keys.has(type.key)) return void errors.push(`types[${index}]: Typ "${type.key}" doppelt.`);
    keys.add(type.key);
    types.push(type);
  });
  const known = (key: string, where: string): boolean => {
    if (keys.has(key)) return true;
    errors.push(`${where}: Typ "${key}" steht nicht unter "types".`);
    return false;
  };

  const spaces: Record<string, string> = {};
  const rawSpaces = json["spaces"] ?? {};
  if (!isRecord(rawSpaces)) errors.push('Zielprofil: "spaces" muss ein Objekt sein ("Room": "<typ>").');
  else
    for (const [spaceType, value] of Object.entries(rawSpaces)) {
      const key = text(value);
      if (key && known(key, `spaces.${spaceType}`)) spaces[spaceType] = key;
    }

  const upper: Partial<Record<UpperLevel, string>> = {};
  const rawUpper = json["upper"] ?? {};
  if (!isRecord(rawUpper)) errors.push('Zielprofil: "upper" muss ein Objekt sein ("country", "region", "site").');
  else
    for (const [level, value] of Object.entries(rawUpper)) {
      if (!(UPPER_LEVELS as readonly string[]).includes(level)) {
        warnings.push(`upper.${level}: unbekannte Ebene, ignoriert (${UPPER_LEVELS.join(", ")}).`);
        continue;
      }
      const key = text(value);
      if (key && known(key, `upper.${level}`)) upper[level as UpperLevel] = key;
    }

  const rules = parseRules(json, known, errors, warnings);
  const rawGenerated = isRecord(json["generated"]) ? json["generated"] : {};
  const prefix = text(rawGenerated["prefix"]) ?? EMPTY_ASSET_PROFILE.generated.prefix;
  const generated = { prefix: KEY.test(`${prefix}x`) ? prefix : EMPTY_ASSET_PROFILE.generated.prefix, class: text(rawGenerated["class"]) ?? EMPTY_ASSET_PROFILE.generated.class };

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, profile: { format: ASSET_PROFILE_FORMAT, name, types, spaces, upper, ...rules, generated }, warnings };
}

function parseRules(
  json: Record<string, unknown>,
  known: (key: string, where: string) => boolean,
  errors: string[],
  warnings: string[],
): { things: ThingRule[]; attributes: AttributeRule[] } {
  const things: ThingRule[] = [];
  const rawThings = json["things"] ?? [];
  if (!Array.isArray(rawThings) || rawThings.length > MAX_RULES) errors.push(`Zielprofil: "things" muss eine Liste mit höchstens ${MAX_RULES} Regeln sein.`);
  else
    rawThings.forEach((raw, index) => {
      const where = `things[${index}]`;
      if (!isRecord(raw) || !isRecord(raw["match"])) return void errors.push(`${where}: erwartet { "match": {...}, "type": "..." }.`);
      const type = text(raw["type"]);
      if (!type || !known(type, where)) return;
      const match = raw["match"];
      const thingTypes = textList(match["thingType"], `${where}.match.thingType`, warnings);
      const unknownTypes = thingTypes.filter((value) => !isThingType(value));
      if (unknownTypes.length > 0) return void errors.push(`${where}: unbekannter Thing-Typ ${unknownTypes.map((value) => `"${value}"`).join(", ")}.`);
      const thingType = thingTypes.filter(isThingType);
      const trade = textList(match["trade"], `${where}.match.trade`, warnings);
      const anyRole = textList(match["anyRole"], `${where}.match.anyRole`, warnings);
      for (const role of anyRole) if (!ROLE_NAMES.has(role)) warnings.push(`${where}: Rolle "${role}" kennt die Erkennung nicht; die Bedingung trifft dann nie.`);
      const central = typeof match["central"] === "boolean" ? match["central"] : undefined;
      // Eine Regel ohne Bedingung traefe jedes Thing; sie steht vorn und verdeckte alle anderen.
      if (thingType.length === 0 && trade.length === 0 && anyRole.length === 0 && central === undefined) return void errors.push(`${where}: "match" braucht mindestens eine Bedingung.`);
      things.push({
        type,
        match: {
          ...(thingType.length > 0 ? { thingType } : {}),
          ...(trade.length > 0 ? { trade } : {}),
          ...(anyRole.length > 0 ? { anyRole } : {}),
          ...(central === undefined ? {} : { central }),
        },
      });
    });

  const attributes: AttributeRule[] = [];
  const rawAttributes = json["attributes"] ?? [];
  if (!Array.isArray(rawAttributes) || rawAttributes.length > MAX_RULES) errors.push(`Zielprofil: "attributes" muss eine Liste mit höchstens ${MAX_RULES} Regeln sein.`);
  else
    rawAttributes.forEach((raw, index) => {
      const where = `attributes[${index}]`;
      if (!isRecord(raw)) return void errors.push(`${where}: erwartet ein Objekt.`);
      const roles = textList(raw["roles"], `${where}.roles`, warnings);
      const attribute = text(raw["attribute"]);
      const type = text(raw["type"]);
      if (roles.length === 0 || !attribute) return void errors.push(`${where}: "roles" und "attribute" sind Pflicht.`);
      for (const role of roles) if (!ROLE_NAMES.has(role)) warnings.push(`${where}: Rolle "${role}" kennt die Erkennung nicht; die Regel trifft dann nie.`);
      if (type && !known(type, where)) return;
      attributes.push({ roles, attribute, ...(type ? { type } : {}) });
    });
  return { things, attributes };
}

/** Uebernimmt Regeln aus einem KI-Vorschlag in ein Profil; neue Regeln stehen vor den alten. */
export function mergeRules(profile: AssetProfile, addition: { readonly things: readonly ThingRule[]; readonly attributes: readonly AttributeRule[] }): AssetProfile {
  return { ...profile, things: [...addition.things, ...profile.things], attributes: [...addition.attributes, ...profile.attributes] };
}

/** Dateiform eines Profils, wie es gespeichert und wieder geladen wird. */
export function assetProfileJson(profile: AssetProfile): Record<string, unknown> {
  return { ...profile };
}
