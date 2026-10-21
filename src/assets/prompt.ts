import { PERSON_PATTERN } from "../recognize/schema-prompt.ts";
import { isRecord } from "../util/guards.ts";
import type { AssetModel } from "./model.ts";
import { ASSET_PROFILE_FORMAT, type AssetProfile, type AssetProfileResult, parseAssetProfile } from "./profile.ts";

/**
 * Prompt fuer die KI-Zuordnung: Things, fuer die das Zielprofil keinen Typ kennt, und Rollen, fuer die ein Typ kein
 * Attribut hat. Das LLM schlaegt Regeln vor; die App prueft sie wie ein Profil, nichts wird ungeprueft uebernommen.
 * Wie beim Namensschema schickt die App nichts weg.
 */

const MAX_EXAMPLES = 4;

const mask = (text: string): string => text.replace(PERSON_PATTERN, (_, title: string) => `${title}. [Name]`);

export function needsMapping(model: AssetModel): boolean {
  return model.types.some((type) => type.origin === "generated" && model.assets.some((asset) => asset.type === type.key && asset.kind === "equipment")) || model.types.some((type) => type.extended);
}

export function buildMappingPrompt(model: AssetModel, profile: AssetProfile): string | undefined {
  if (profile.types.length === 0 || !needsMapping(model)) return undefined;
  const lines = [
    "You map recognized KNX functions onto the asset types of a building platform. Answer only with JSON, no text before or after it.",
    "",
    "Goal: for every open item below, pick the best existing target type and attribute. Do not invent types or attributes; if nothing fits, leave the item out, it stays a documented gap.",
    "",
    "Answer format:",
    "{",
    '  "things": [ { "match": { "thingType": ["<KNX thing type>"], "anyRole": ["<optional role>"] }, "type": "<target type key>" } ],',
    '  "attributes": [ { "roles": ["<KNX role>"], "type": "<target type key>", "attribute": "<attribute name of that type>" } ]',
    "}",
    "",
    "Rules:",
    '- "type" and "attribute" must be spelled exactly as in the target list.',
    "- A command and its feedback share one attribute; list both roles in the same rule (for example SwitchOnOff and InfoOnOff).",
    "- Prefer the type whose class describes the equipment, not the room.",
    "",
    "Target types (key | class | attributes as subtype:name):",
    ...profile.types.map((type) => `${type.key} | ${type.class} | ${type.attributes.map((attribute) => `${attribute.subtype}:${attribute.name}`).join(", ") || "-"}`),
    "",
    "Open items: KNX things without a target type (KNX thing type | roles with their attribute guess | example names):",
  ];
  for (const type of model.types.filter((entry) => entry.origin === "generated")) {
    const assets = model.assets.filter((asset) => asset.type === type.key && asset.kind === "equipment");
    if (assets.length === 0) continue;
    const thingTypes = [...new Set(assets.map((asset) => asset.source.thingType).filter((value) => value !== undefined))];
    const roles = [...new Set(assets.flatMap((asset) => asset.bindings.map((binding) => `${binding.role ?? "unknown"}→${binding.attribute}`)))];
    lines.push(`${thingTypes.join(", ")} | ${roles.join(", ") || "-"} | ${assets.slice(0, MAX_EXAMPLES).map((asset) => mask(asset.name)).join("; ")}`);
  }
  const extensions = model.types.filter((type) => type.extended);
  if (extensions.length > 0) {
    lines.push("", "Open items: attributes the export had to add to a target type (type | added attribute | KNX roles):");
    for (const type of extensions) {
      for (const attribute of type.attributes.filter((entry) => entry.origin === "extension")) {
        const roles = [...new Set(model.assets.filter((asset) => asset.type === type.key).flatMap((asset) => asset.bindings.filter((binding) => binding.attribute === attribute.name).map((binding) => binding.role ?? "unknown")))];
        lines.push(`${type.key} | ${attribute.subtype}:${attribute.name}${attribute.dpt ? ` (DPT ${attribute.dpt})` : ""} | ${roles.join(", ")}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Uebernimmt die Regeln einer LLM-Antwort vor die Regeln des Profils und prueft das Ergebnis als Ganzes. */
export function applyMappingAnswer(profile: AssetProfile, answer: unknown): AssetProfileResult {
  if (!isRecord(answer)) return { ok: false, errors: ["Antwort: erwartet ein JSON-Objekt mit \"things\" und \"attributes\"."] };
  const things = Array.isArray(answer["things"]) ? answer["things"] : [];
  const attributes = Array.isArray(answer["attributes"]) ? answer["attributes"] : [];
  if (things.length === 0 && attributes.length === 0) return { ok: false, errors: ["Antwort: weder \"things\" noch \"attributes\" enthalten Regeln."] };
  return parseAssetProfile({ ...profile, format: ASSET_PROFILE_FORMAT, things: [...things, ...profile.things], attributes: [...attributes, ...profile.attributes] });
}
