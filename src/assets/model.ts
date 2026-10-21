import { dptDotted, dptMainNumber } from "../ets/dpt-id.ts";
import type { DptField } from "../ets/master-data.ts";
import type { ProjectGraph } from "../graph/evidence-graph.ts";
import type { ProjectAnalysis } from "../recognize/pipeline.ts";
import type { Thing, ThingType } from "../recognize/things.ts";
import { uuidV5 } from "../td/ids.ts";
import { type PlannedAffordance, type PlannedThing, planThings } from "../td/plan.ts";
import { ROLE_SPECS } from "../td/vocabulary.ts";
import type { AssetProfile, Subtype, TypeDef, UpperLevel } from "./profile.ts";

/**
 * Asset-Modell aus der Erkennung: ein Ortsbaum (Land, Region, Standort, dann Gebaeude, Etagen und Raeume der ETS),
 * darin ein Asset je Thing, je Asset ein Typ aus dem Zielprofil und je Datenpunkt ein Attribut mit den
 * Gruppenadressen. Befehl und Rueckmeldung bleiben gepaart wie in den Thing Descriptions.
 *
 * Was nicht passt, wird nicht verbogen: Der Export legt eigene Typen und Attribute an und fuehrt jede solche Stelle
 * als Luecke. Die Lueckenliste ist ein Ergebnis, kein Fehlerprotokoll.
 */

export const ASSET_MODEL_FORMAT = "knx-asset-model-1";

export interface SiteInput {
  readonly country?: string;
  readonly region?: string;
  readonly site?: string;
  /** Praefix der lesbaren Asset-Kennung, z. B. "VILLA". */
  readonly codePrefix?: string;
}

export type AttributeOrigin = "profile" | "extension" | "generated";

export interface ModelAttribute {
  readonly name: string;
  readonly subtype: Subtype;
  readonly quantity?: string;
  readonly unit?: string;
  /** Datenpunkttyp der KNX, gepunktet ("9.001"); fehlt bei Attributen ohne Bindung. */
  readonly dpt?: string;
  /** Wertetabelle aus dem DPT ({"0": "Off", "1": "On"}). */
  readonly map?: Readonly<Record<string, string>>;
  readonly origin: AttributeOrigin;
}

export interface ModelType {
  readonly key: string;
  readonly class: string;
  readonly label: Readonly<Record<string, string>>;
  /** profile: Typ des Zielprofils; generated: vom Export angelegt. */
  readonly origin: "profile" | "generated";
  /** Ein Profiltyp, dem der Export Attribute hinzufuegen musste. */
  readonly extended: boolean;
  readonly attributes: readonly ModelAttribute[];
  readonly tags: readonly string[];
  readonly assets: number;
}

export interface Binding {
  readonly attribute: string;
  readonly subtype: Subtype;
  /** Gruppenadresse fuer Befehle. */
  readonly write?: string;
  /** Gruppenadresse, auf der der Zustand zurueckkommt; fehlt sie, meldet der Befehl selbst. */
  readonly feedback?: string;
  readonly dpt?: string;
  /** Zustand per Lesetelegramm abfragbar; undefined ohne Herstellerdaten. */
  readonly readable?: boolean;
  readonly role?: string;
  readonly gaNames: readonly string[];
}

export type AssetKind = UpperLevel | "space" | "equipment";

export interface ModelAsset {
  readonly id: string;
  /** Lesbare Kennung, eindeutig im Export ("VILLA-WOHNZIMMER-LIGHT-01"). */
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly kind: AssetKind;
  /** Eltern im Ortsbaum und im Funktionsbaum, als Asset-Id. */
  readonly parent: { readonly location: string | null; readonly function: string | null };
  readonly tags: readonly string[];
  readonly bindings: readonly Binding[];
  readonly source: { readonly ets?: string; readonly spaceType?: string; readonly thingType?: ThingType; readonly functionType?: string; readonly openQuestions?: number };
}

export type GapAction = "extend-model" | "generated" | "review" | "info";

export interface Gap {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly action: GapAction;
  readonly count: number;
  readonly examples: readonly string[];
}

export interface AssetModel {
  readonly format: typeof ASSET_MODEL_FORMAT;
  readonly generator: string;
  readonly profile: string;
  readonly site: SiteInput;
  readonly types: readonly ModelType[];
  readonly assets: readonly ModelAsset[];
  readonly gaps: readonly Gap[];
  readonly stats: {
    readonly assets: number;
    readonly equipment: number;
    readonly spaces: number;
    readonly bindings: number;
    readonly groupAddresses: number;
    readonly typesFromProfile: number;
    readonly typesGenerated: number;
    readonly typesExtended: number;
  };
}

/** Rollen, deren Wert gemessen wird; ohne Befehl sind sie input, nicht status. */
const MEASURED_ROLES = new Set([
  "TempRoom",
  "TempOutside",
  "Illuminance",
  "WindSpeed",
  "Power",
  "Energy",
  "MeterReading",
  "AirQuality",
  "Presence",
  "PresenceTrigger",
  "WindowStatus",
  "ActualValvePosition",
]);

/** Befehle ohne Zustand: Sie loesen etwas aus, haben aber keinen Wert, den ein Attribut halten koennte. */
const STATELESS_ROLES = new Set(["DimmingControl", "MoveUpDown", "StopStepUpDown", "Reset", "SceneControl"]);

/** Klassen fuer vom Export angelegte Raumtypen; Namen aus RealEstateCore. */
const SPACE_CLASS: Readonly<Record<string, string>> = { Building: "Building", BuildingPart: "Building", Floor: "Level", Room: "Room" };
const UPPER_CLASS: Readonly<Partial<Record<UpperLevel, string>>> = { site: "Site" };
const UPPER_LABEL: Readonly<Record<UpperLevel, Readonly<Record<string, string>>>> = { country: { en: "Country", de: "Land" }, region: { en: "Region", de: "Region" }, site: { en: "Site", de: "Standort" } };

const snake = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "value";

const slug = (text: string, max = 12): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "SS")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, max) || "X";

class GapCollector {
  readonly #gaps = new Map<string, { title: string; detail: string; action: GapAction; count: number; examples: string[] }>();

  add(id: string, title: string, detail: string, action: GapAction, example?: string, weight = 1): void {
    const entry = this.#gaps.get(id) ?? { title, detail, action, count: 0, examples: [] };
    entry.count += weight;
    if (example && entry.examples.length < 8 && !entry.examples.includes(example)) entry.examples.push(example);
    this.#gaps.set(id, entry);
  }

  list(): Gap[] {
    const order: Readonly<Record<GapAction, number>> = { "extend-model": 0, generated: 1, review: 2, info: 3 };
    return [...this.#gaps]
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => order[a.action] - order[b.action] || b.count - a.count || a.id.localeCompare(b.id));
  }
}

interface TypeDraft {
  key: string;
  class: string;
  label: Record<string, string>;
  origin: "profile" | "generated";
  extended: boolean;
  attributes: Map<string, ModelAttribute>;
  tags: string[];
  assets: number;
}

function draftFromProfile(def: TypeDef): TypeDraft {
  return {
    key: def.key,
    class: def.class,
    label: { ...(def.label ?? {}) },
    origin: "profile",
    extended: false,
    attributes: new Map(def.attributes.map((attribute) => [attribute.name, { ...attribute, origin: "profile" as const }])),
    tags: [...(def.tags ?? [])],
    assets: 0,
  };
}

function writes(affordance: PlannedAffordance): boolean {
  return affordance.forms.some((form) => form.ops.includes("writeproperty") || form.ops.includes("invokeaction"));
}

function inferSubtype(affordance: PlannedAffordance): Subtype {
  if (writes(affordance)) return "output";
  return affordance.role && MEASURED_ROLES.has(affordance.role) ? "input" : "status";
}

/** Einheit und Wertetabelle aus dem einzigen Feld eines DPT; mehrteilige DPTs haben keinen skalaren Wert. */
function dptDetails(dpt: string | undefined, graph: ProjectGraph): { unit?: string; map?: Record<string, string>; fields: number } {
  if (!dpt) return { fields: 0 };
  const fields = (graph.loaded.master.dpts.get(dpt)?.fields ?? []).filter((field): field is Exclude<DptField, { kind: "reserved" }> => field.kind !== "reserved");
  const field = fields.length === 1 ? fields[0] : undefined;
  if (!field) return { fields: fields.length };
  if (field.kind === "bit") return { map: { "0": field.cleared, "1": field.set }, fields: 1 };
  if (field.kind === "enum") return { map: Object.fromEntries(field.values.map((entry) => [String(entry.value), entry.text])), fields: 1 };
  if ((field.kind === "unsigned" || field.kind === "signed" || field.kind === "float") && field.unit) return { unit: field.unit, fields: 1 };
  return { fields: 1 };
}

function bindingOf(affordance: PlannedAffordance, attribute: string, subtype: Subtype, graph: ProjectGraph): Binding {
  const write = affordance.forms.find((form) => form.ops.includes("writeproperty") || form.ops.includes("invokeaction"));
  const feedback = affordance.forms.find((form) => form !== write && !form.ops.includes("writeproperty") && !form.ops.includes("invokeaction"));
  const state = feedback ?? write;
  // Lesbar laut Herstellerdaten; ohne sie unbekannt, nicht "nein".
  const readable = state?.gaId ? graph.byGroupAddressId.get(state.gaId)?.readable : undefined;
  return {
    attribute,
    subtype,
    ...(write?.ga ? { write: write.ga } : {}),
    ...(feedback?.ga ? { feedback: feedback.ga } : {}),
    ...(affordance.schemaDpt ? { dpt: dptDotted(affordance.schemaDpt) } : {}),
    ...(readable === undefined ? {} : { readable }),
    ...(affordance.role ? { role: affordance.role } : {}),
    gaNames: affordance.forms.map((form) => `${form.ga ?? "?"} ${form.gaName ?? ""}`.trim()),
  };
}

function matches(rule: AssetProfile["things"][number], thing: Thing, roles: ReadonlySet<string>): boolean {
  const { thingType, trade, anyRole, central } = rule.match;
  if (thingType && !thingType.includes(thing.type)) return false;
  if (trade && !trade.includes(thing.draft.trade ?? "")) return false;
  if (anyRole && !anyRole.some((role) => roles.has(role))) return false;
  if (central !== undefined && central !== thing.draft.central) return false;
  return true;
}

/** Geraete, die nach Produkt oder Applikation Logik ausfuehren; ihre Logik selbst steht nicht im Projekt. */
const LOGIC = /logi[ck]|logic controller|logikmodul|logikbaustein/i;

export async function buildAssetModel(analysis: ProjectAnalysis, profile: AssetProfile, site: SiteInput, generator: string): Promise<AssetModel> {
  const graph = analysis.recognition.graph;
  const projectId = graph.loaded.project.guid ?? graph.loaded.project.id;
  const gaps = new GapCollector();
  const profileTypes = new Map(profile.types.map((def) => [def.key, def]));
  const types = new Map<string, TypeDraft>();
  const hasProfile = profile.types.length > 0;
  const usedCodes = new Set<string>();
  const prefix = slug(site.codePrefix ?? "", 16) === "X" ? "KNX" : slug(site.codePrefix ?? "", 16);
  const code = (...parts: string[]): string => {
    const base = [prefix, ...parts.map((part) => slug(part))].join("-");
    let candidate = base;
    for (let index = 2; usedCodes.has(candidate); index++) candidate = `${base}-${index}`;
    usedCodes.add(candidate);
    return candidate;
  };
  const own = <T,>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

  const typeFor = (key: string, fallback: () => Omit<TypeDraft, "assets">): TypeDraft => {
    const existing = types.get(key);
    if (existing) return existing;
    const def = profileTypes.get(key);
    const draft = def ? draftFromProfile(def) : { ...fallback(), assets: 0 };
    types.set(key, draft);
    return draft;
  };
  const generatedType = (key: string, cls: string, en: string, de: string): TypeDraft =>
    typeFor(key, () => ({ key, class: cls, label: { en, de }, origin: "generated", extended: false, attributes: new Map(), tags: [] }));

  const assets: ModelAsset[] = [];
  const push = (asset: ModelAsset, type: TypeDraft): ModelAsset => {
    type.assets++;
    assets.push(asset);
    return asset;
  };

  // Ebenen ueber dem Gebaeude: nur, was eingegeben ist; der Standort gibt es immer.
  let upperParent: string | null = null;
  for (const level of ["country", "region", "site"] as const) {
    const name = site[level]?.trim();
    if (!name && level !== "site") continue;
    const key = own(profile.upper, level);
    const upperClass = UPPER_CLASS[level] ?? profile.generated.class;
    const type = key
      ? typeFor(key, () => ({ key, class: upperClass, label: { ...UPPER_LABEL[level] }, origin: "generated", extended: false, attributes: new Map(), tags: [] }))
      : generatedType(`${profile.generated.prefix}${level}`, upperClass, UPPER_LABEL[level]["en"] ?? level, UPPER_LABEL[level]["de"] ?? level);
    if (!key && level !== "site")
      gaps.add(
        `upper-${level}`,
        `No asset type for the ${level} level`,
        `The location tree starts above the building with country and region, but the target profile has no type for "${level}". The export creates "${type.key}" and places it above the site. Either the model gets a type for this level, or ${level} becomes a property or tag of the site.`,
        "extend-model",
        name,
      );
    if (!key && level === "site" && hasProfile) gaps.add("upper-site", "No asset type for the site", 'The target profile defines no "upper.site" type; the export creates one.', "generated", name ?? "Site");
    const id = await uuidV5(`${projectId}|upper|${level}`);
    push({ id, code: code(name ?? level), name: name ?? "Site", type: type.key, kind: level, parent: { location: upperParent, function: null }, tags: [...type.tags], bindings: [], source: {} }, type);
    upperParent = id;
  }
  const siteId = upperParent;

  // Gebaeudestruktur der ETS, von aussen nach innen.
  const spaceAsset = new Map<string, ModelAsset>();
  const nodes = [...graph.spaces.values()].sort((a, b) => a.path.length - b.path.length);
  for (const node of nodes) {
    const space = node.space;
    // Raumtypen kommen aus der Projektdatei; nur eigene Schluessel zaehlen, nichts aus dem Prototyp.
    const key = own(profile.spaces, space.type);
    const type = key
      ? typeFor(key, () => ({ key, class: profile.generated.class, label: { en: space.type }, origin: "generated", extended: false, attributes: new Map(), tags: [] }))
      : generatedType(`${profile.generated.prefix}${snake(space.type)}`, own(SPACE_CLASS, space.type) ?? "Space", space.type, space.type);
    if (!key && hasProfile)
      gaps.add(
        `space-${snake(space.type)}`,
        `ETS space type "${space.type}" has no target type`,
        `The target profile maps no type to the ETS space type "${space.type}". The export creates "${type.key}".`,
        "generated",
        space.name,
      );
    const parent = space.parentId ? spaceAsset.get(space.parentId)?.id ?? siteId : siteId;
    const asset = push(
      {
        id: await uuidV5(`${projectId}|space|${space.id}`),
        code: code(...node.path.slice(-2).map((entry) => entry.number ?? entry.name)),
        name: space.name,
        type: type.key,
        kind: "space",
        parent: { location: parent, function: null },
        tags: [...type.tags],
        bindings: [],
        source: { ets: space.id, spaceType: space.type },
      },
      type,
    );
    spaceAsset.set(space.id, asset);
  }
  if (!nodes.some((node) => node.space.type === "Building"))
    gaps.add("no-building", "ETS project without building", "The ETS project has no building in its building structure; equipment hangs directly below the site.", "review");

  // Things werden Assets.
  const plan = planThings(analysis, { commands: "property", strict: false });
  const thingByKey = new Map(analysis.things.map((thing) => [thing.draft.key, thing]));
  const counters = new Map<string, number>();
  let bindingCount = 0;
  const groupAddresses = new Set<string>();

  for (const planned of plan.things) {
    const thing = thingByKey.get(planned.key);
    if (!thing) continue;
    const roles = new Set(planned.affordances.map((affordance) => affordance.role).filter((role): role is string => role !== undefined));
    const rule = profile.things.find((candidate) => matches(candidate, thing, roles));
    const type = rule
      ? typeFor(rule.type, () => ({ key: rule.type, class: profile.generated.class, label: {}, origin: "generated", extended: false, attributes: new Map(), tags: [] }))
      : generatedType(
          `${profile.generated.prefix}${snake(thing.type)}${thing.draft.central ? "_central" : ""}`,
          profile.generated.class,
          `KNX ${snake(thing.type).replace(/_/g, " ")}${thing.draft.central ? " (central)" : ""}`,
          `KNX ${thing.type}${thing.draft.central ? " (zentral)" : ""}`,
        );
    if (!rule && hasProfile)
      gaps.add(
        `thing-${snake(thing.type)}${thing.draft.central ? "-central" : ""}`,
        `No target type for KNX ${thing.type}${thing.draft.central ? " (central function)" : ""}`,
        `Recognized things of type ${thing.type}${thing.functionType ? ` (${thing.functionType})` : ""} match no rule of the target profile. The export creates "${type.key}" with the attributes it finds.`,
        "generated",
        planned.title,
      );
    const bindings = attach(planned, type, profile, graph, gaps);
    for (const binding of bindings) {
      bindingCount++;
      if (binding.write) groupAddresses.add(binding.write);
      if (binding.feedback) groupAddresses.add(binding.feedback);
    }
    const room = planned.roomId ? spaceAsset.get(planned.roomId) : undefined;
    if (!room) gaps.add("no-room", "Equipment without room", "The recognition found no room for these things; they hang below the site.", "review", planned.title);
    if (thing.draft.central)
      gaps.add(
        "central-function",
        "Central functions act on many assets",
        "A KNX central group address (all lights off, all blinds up) addresses many actuators at once. In the asset model an attribute belongs to exactly one asset; the export keeps each central function as an asset of its own, without a link to the assets it controls.",
        "extend-model",
        planned.title,
      );
    const roomKey = room?.name ?? "SITE";
    const counterKey = `${roomKey}|${type.key}`;
    const number = (counters.get(counterKey) ?? 0) + 1;
    counters.set(counterKey, number);
    push(
      {
        id: await uuidV5(`${projectId}|thing|${planned.stableKey}`),
        code: code(roomKey, type.key.replace(profile.generated.prefix, ""), String(number).padStart(2, "0")),
        name: planned.title,
        type: type.key,
        kind: "equipment",
        parent: { location: room?.id ?? siteId, function: null },
        tags: [...type.tags],
        bindings,
        source: { thingType: thing.type, ...(thing.functionType ? { functionType: thing.functionType } : {}), ...(planned.openQuestions > 0 ? { openQuestions: planned.openQuestions } : {}) },
      },
      type,
    );
    if (planned.openQuestions > 0)
      gaps.add("open-questions", "Assets with open questions", "Some group addresses of these assets still carry an open question in the workshop; their attribute assignment may change.", "review", planned.title);
  }
  for (const skipped of plan.skipped) gaps.add("skipped-thing", "Things without usable group address", "These recognized things have no group address left to bind (all out of use).", "info", skipped.title);

  detectProjectGaps(graph, analysis, gaps);
  gaps.add(
    "functional-tree",
    "No functional hierarchy in KNX",
    "KNX projects describe group addresses, devices and a building structure, but no plants or systems. The functional tree stays empty; ETS functions and actuator channels bundle group addresses into things, not into systems.",
    "info",
  );

  const modelTypes: ModelType[] = [...types.values()]
    .filter((type) => type.assets > 0)
    .map((type) => ({ key: type.key, class: type.class, label: type.label, origin: type.origin, extended: type.extended, attributes: [...type.attributes.values()], tags: type.tags, assets: type.assets }));
  return {
    format: ASSET_MODEL_FORMAT,
    generator,
    profile: profile.name,
    site,
    types: modelTypes,
    assets,
    gaps: gaps.list(),
    stats: {
      assets: assets.length,
      equipment: assets.filter((asset) => asset.kind === "equipment").length,
      spaces: assets.filter((asset) => asset.kind === "space").length,
      bindings: bindingCount,
      groupAddresses: groupAddresses.size,
      typesFromProfile: modelTypes.filter((type) => type.origin === "profile").length,
      typesGenerated: modelTypes.filter((type) => type.origin === "generated").length,
      typesExtended: modelTypes.filter((type) => type.extended).length,
    },
  };
}

/** Bindet die Affordances eines Things an Attribute seines Typs; was fehlt, wird ergaenzt und als Luecke gefuehrt. */
function attach(planned: PlannedThing, type: TypeDraft, profile: AssetProfile, graph: ProjectGraph, gaps: GapCollector): Binding[] {
  const bindings: Binding[] = [];
  const taken = new Set<string>();
  for (const affordance of planned.affordances) {
    // Ein Befehl, der nicht die Groesse selbst setzt ("Sollwert Schritt" mit 1.007), ist nicht deren Attribut.
    const variant = affordance.role !== undefined && ROLE_SPECS[affordance.role]?.key !== affordance.key.replace(/\d+$/, "");
    const role = variant ? undefined : affordance.role;
    const details = dptDetails(affordance.schemaDpt, graph);
    const rule = role ? profile.attributes.find((candidate) => candidate.roles.includes(role) && (candidate.type === undefined || candidate.type === type.key) && (type.origin === "generated" || type.attributes.has(candidate.attribute))) : undefined;
    const ruleElsewhere = role && !rule ? profile.attributes.find((candidate) => candidate.roles.includes(role) && (candidate.type === undefined || candidate.type === type.key)) : undefined;
    let name = rule?.attribute ?? ruleElsewhere?.attribute ?? (role || variant ? snake(affordance.key.replace(/\d+$/, "")) : fallbackName(affordance, planned, graph));
    let attribute = type.attributes.get(name);

    if (attribute && taken.has(name)) {
      // Zweite GA derselben Groesse im selben Thing ("Licht" und "Licht 2"); das Attribut gibt es nur einmal.
      gaps.add(
        "duplicate-attribute",
        "Several group addresses for one attribute",
        "One thing carries the same function twice (two switch objects, two setpoints). An asset has each attribute once; the export adds numbered attributes to the type.",
        "extend-model",
        `${planned.title}: ${name}`,
      );
      let index = 2;
      while (type.attributes.has(`${name}_${index}`) && taken.has(`${name}_${index}`)) index++;
      name = `${name}_${index}`;
      attribute = type.attributes.get(name);
    }

    if (!attribute) {
      const added: ModelAttribute = {
        name,
        subtype: inferSubtype(affordance),
        ...(details.unit ? { unit: details.unit } : {}),
        ...(affordance.schemaDpt ? { dpt: dptDotted(affordance.schemaDpt) } : {}),
        ...(details.map ? { map: details.map } : {}),
        origin: type.origin === "profile" ? "extension" : "generated",
      };
      type.attributes.set(name, added);
      attribute = added;
      if (type.origin === "profile") type.extended = true;
      if (!role && !variant)
        gaps.add(
          "unknown-role",
          "Group addresses without a recognized role",
          "The recognition bundled these group addresses into a thing but could not name their function; the attribute name comes from the group address name.",
          "review",
          `${planned.title}: ${affordance.forms[0]?.gaName ?? affordance.key}`,
        );
    } else if (attribute.origin === "profile") {
      if (!attribute.dpt || !attribute.map) {
        // Profilattribute erfahren DPT und Wertetabelle aus dem Projekt, ohne dass der Typ als erweitert gilt.
        type.attributes.set(name, { ...attribute, ...(affordance.schemaDpt && !attribute.dpt ? { dpt: dptDotted(affordance.schemaDpt) } : {}), ...(details.map && !attribute.map ? { map: details.map } : {}) });
      }
      if (attribute.unit && details.unit && normalizeUnit(attribute.unit) !== normalizeUnit(details.unit))
        gaps.add(
          `unit-${type.key}-${name}`,
          `Unit mismatch on "${type.key}.${name}"`,
          `The target type expects "${attribute.unit}", KNX delivers "${details.unit}" (DPT ${affordance.schemaDpt ? dptDotted(affordance.schemaDpt) : "?"}). A conversion or another attribute is needed.`,
          "extend-model",
          planned.title,
        );
      if (writes(affordance) && attribute.subtype !== "output")
        gaps.add(
          `subtype-${type.key}-${name}`,
          `KNX writes to "${type.key}.${name}", which is not an output`,
          `The attribute is "${attribute.subtype}" in the target type, but KNX can set this value (for example a setpoint or mode that a room controller also accepts by telegram).`,
          "extend-model",
          planned.title,
        );
    }
    taken.add(name);
    if (attribute.origin === "extension")
      gaps.add(
        `missing-attributes-${type.key}`,
        `Type "${type.key}" lacks attributes that KNX delivers`,
        `Assets of type "${type.key}" carry KNX data points for which the type has no attribute. The export adds them to the type (marked as extension in the template library); the examples name attribute, subtype, KNX role and DPT. The count is the number of bindings on added attributes.`,
        "extend-model",
        `${name} (${attribute.subtype}${affordance.role ? `, ${affordance.role}` : ""}${attribute.dpt ? `, DPT ${attribute.dpt}` : ""})`,
      );
    const binding = bindingOf(affordance, name, attribute.subtype, graph);
    bindings.push(binding);

    if (binding.write && binding.feedback)
      gaps.add(
        "command-feedback",
        "Command and feedback are two group addresses",
        "KNX sends a command on one group address and reports the resulting state on another. The asset model has one attribute per value; the export keeps both addresses in the binding (write and feedback), the target needs a way to express that.",
        "extend-model",
        `${planned.title}: ${name}`,
      );
    if (role && STATELESS_ROLES.has(role))
      gaps.add(
        "stateless-command",
        "Commands without a state value",
        "Relative dimming, step and stop, move up and down, scene recall and reset trigger an action but hold no value. As an output attribute the last written value has no meaning.",
        "extend-model",
        `${planned.title}: ${name} (${role})`,
      );
    if (details.fields > 1)
      gaps.add(
        "structured-dpt",
        "Structured data point types",
        "Some KNX data point types carry several fields in one telegram (priority control 2.x, relative dimming 3.x, scene learn 18.x, date and time 19.x, RGB 232.x). An attribute holds one scalar value; the fields need either one attribute each or a structured value.",
        "extend-model",
        `${planned.title}: ${name} (DPT ${affordance.schemaDpt ? dptDotted(affordance.schemaDpt) : "?"})`,
      );
    if (role === "SceneControl" || role === "InfoScene")
      gaps.add(
        "scene",
        "Scenes",
        "KNX scenes are numbers on a group address that actuators interpret on their own. There is no asset that owns a scene, and the scene content lives in device parameters.",
        "extend-model",
        planned.title,
      );
    if (binding.readable === false && !binding.feedback)
      gaps.add("not-readable", "State cannot be read back", "No device answers read requests on these group addresses; after a restart the value is unknown until the next telegram.", "info", `${planned.title}: ${name}`);
  }
  return bindings;
}

const words = (text: string): string[] =>
  text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");

/** Attributname aus dem GA-Namen, ohne die Woerter, die nur den Ort nennen ("Erdgeschoss Buero 1"). */
function fallbackName(affordance: PlannedAffordance, planned: PlannedThing, graph: ProjectGraph): string {
  const gaName = affordance.forms[0]?.gaName ?? affordance.key;
  const place = new Set<string>();
  const room = planned.roomId ? graph.spaces.get(planned.roomId) : undefined;
  for (const space of room?.path ?? []) for (const word of words(space.name)) place.add(word);
  // Reine Zahlen unterscheiden Kanaele, keine Funktion; doppelte Namen nummeriert der Aufrufer.
  const kept = words(gaName).filter((word) => !place.has(word) && !/^\d+$/.test(word));
  return snake(kept.slice(-4).join("_")).replace(/^[\d_]+/, "") || "value";
}

function normalizeUnit(unit: string): string {
  return unit.replace(/\s+/g, "").replace("°", "deg").toLowerCase();
}

function detectProjectGaps(graph: ProjectGraph, analysis: ProjectAnalysis, gaps: GapCollector): void {
  const devices = graph.loaded.devices;
  for (const device of devices) {
    const text = [device.product?.textDe, device.product?.text, device.applicationName].filter(Boolean).join(" ");
    if (LOGIC.test(text))
      gaps.add(
        "logic",
        "Logic functions are not part of the model",
        "Logic controllers and logic modules evaluate and combine group addresses inside the device. The project only shows their communication objects and parameters, not the logic itself. In the asset model there is neither a type for a logic block nor a place for its rules.",
        "extend-model",
        `${device.device.individualAddress ?? device.device.id} ${device.product?.textDe ?? device.product?.text ?? ""}`.trim(),
      );
  }
  if (devices.length > 0)
    gaps.add(
      "topology",
      "KNX topology has no place in the trees",
      "Areas, lines and individual addresses of the devices form the KNX topology. Neither the location nor the functional tree holds it; the devices themselves are not assets in this export, only their functions are.",
      "info",
      `${devices.length} devices`,
    );
  const parameterised = devices.filter((device) => device.applicationId !== undefined).length;
  if (parameterised > 0)
    gaps.add(
      "parameters",
      "Device parameters are not exported",
      "Staircase timers, dimming curves, behaviour on bus voltage recovery and similar settings are device parameters. They are configuration, not live data; the model could hold some as info or property attributes, but there is no rule yet which ones matter.",
      "info",
      `${parameterised} devices with application parameters`,
    );
  const excluded = analysis.excluded.size;
  if (excluded > 0) gaps.add("excluded", "Group addresses excluded from the export", "These group addresses were excluded in the workshop (reserve, main groups or single exclusions) and appear in no asset.", "info", `${excluded} group addresses`, excluded);
}

