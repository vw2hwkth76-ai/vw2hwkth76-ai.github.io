import { beforeAll, describe, expect, it } from "vitest";
import { type AssetModel, buildAssetModel } from "../src/assets/model.ts";
import { ASSET_PROFILE_FORMAT, type AssetProfile, EMPTY_ASSET_PROFILE, parseAssetProfile } from "../src/assets/profile.ts";
import { applyMappingAnswer, buildMappingPrompt, needsMapping } from "../src/assets/prompt.ts";
import { assetFiles, gapsMarkdown, locationTreeMarkdown, templateLibraryMarkdown } from "../src/assets/render.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { NO_EXCLUSION } from "../src/graph/scope.ts";
import { analyzeProject, type ProjectAnalysis } from "../src/recognize/pipeline.ts";
import { hasFixture, readFixture } from "./helpers.ts";

let demo: ProjectGraph;
let analysis: ProjectAnalysis;
let style: ProjectAnalysis;

beforeAll(async () => {
  demo = buildGraph(await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj")));
  analysis = analyzeProject(demo, { useEtsFunctions: true });
  style = analyzeProject(buildGraph(await loadKnxProject(readFixture("oeffentlich/style3.knxproj"))), { useEtsFunctions: true });
});

/** Neutrales Testprofil: zwei Raumtypen, ein Lichttyp ohne Helligkeit, ein Jalousietyp mit Lamellenwinkel in Grad. */
const PROFILE_JSON = {
  format: ASSET_PROFILE_FORMAT,
  name: "Testprofil",
  types: [
    { key: "site", class: "Site", attributes: [] },
    { key: "building", class: "Building", attributes: [] },
    { key: "floor", class: "Level", attributes: [] },
    { key: "room", class: "Room", attributes: [] },
    { key: "light", class: "Lighting_System", label: { en: "Light" }, attributes: [{ name: "on_off", subtype: "output" }], tags: ["usage:lighting"] },
    {
      key: "shade",
      class: "Shading_Equipment",
      attributes: [
        { name: "position", subtype: "output", unit: "%" },
        { name: "slat_angle", subtype: "output", unit: "°" },
      ],
    },
    { key: "room_controller", class: "Thermostat", attributes: [{ name: "temp", subtype: "input", unit: "°C" }, { name: "setpoint", subtype: "input" }] },
  ],
  spaces: { Building: "building", Floor: "floor", Room: "room" },
  upper: { site: "site" },
  things: [
    { match: { thingType: ["SwitchableLight", "DimmableLight"] }, type: "light" },
    { match: { thingType: ["SunProtection"] }, type: "shade" },
    { match: { thingType: ["Heating"] }, type: "room_controller" },
  ],
  attributes: [
    { roles: ["SwitchOnOff", "InfoOnOff"], attribute: "on_off" },
    { roles: ["AbsolutePositionBlindsPercentage", "CurrentAbsolutePositionBlindsPercentage"], attribute: "position" },
    { roles: ["AbsolutePositionSlatPercentage", "CurrentAbsolutePositionSlatPercentage"], attribute: "slat_angle" },
    { roles: ["TempRoom"], attribute: "temp" },
    { roles: ["TempRoomSetpoint", "InfoTempRoomSetpoint"], attribute: "setpoint" },
  ],
};

function profile(json: unknown = PROFILE_JSON): AssetProfile {
  const parsed = parseAssetProfile(json);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.profile;
}

const SITE = { country: "Germany", region: "Baden-Württemberg", site: "Villa Nord", codePrefix: "Villa" };

function checkIntegrity(model: AssetModel, graph: ProjectGraph): void {
  const ids = new Set(model.assets.map((asset) => asset.id));
  expect(ids.size).toBe(model.assets.length);
  expect(new Set(model.assets.map((asset) => asset.code)).size).toBe(model.assets.length);
  const roots = model.assets.filter((asset) => asset.parent.location === null);
  expect(roots.length).toBe(1);
  for (const asset of model.assets) if (asset.parent.location !== null) expect(ids.has(asset.parent.location)).toBe(true);
  const types = new Map(model.types.map((type) => [type.key, type]));
  const addresses = new Set(graph.groupAddresses.map((node) => node.ga.text));
  for (const asset of model.assets) {
    const type = types.get(asset.type);
    expect(type, asset.type).toBeDefined();
    for (const binding of asset.bindings) {
      expect(type?.attributes.some((attribute) => attribute.name === binding.attribute && attribute.subtype === binding.subtype), `${asset.type}.${binding.attribute}`).toBe(true);
      if (binding.write) expect(addresses.has(binding.write)).toBe(true);
      if (binding.feedback) expect(addresses.has(binding.feedback)).toBe(true);
      expect(binding.write ?? binding.feedback).toBeDefined();
    }
    // Ein Attribut je Asset hoechstens einmal gebunden.
    expect(new Set(asset.bindings.map((binding) => binding.attribute)).size).toBe(asset.bindings.length);
  }
  expect(model.types.reduce((sum, type) => sum + type.assets, 0)).toBe(model.assets.length);
  // Funktionsbaum: jedes Geraete-Asset hat einen Platz, Eltern sind Systeme oder Zentralfunktionen, keine Kreise.
  const byId = new Map(model.assets.map((asset) => [asset.id, asset]));
  for (const asset of model.assets) {
    if (asset.kind === "equipment") expect(asset.parent.function, asset.name).not.toBeNull();
    if (asset.kind === "system") expect(asset.parent.function).toBeNull();
    if (asset.kind !== "equipment" && asset.kind !== "system") expect(asset.parent.function).toBeNull();
    const seen = new Set<string>();
    for (let current = asset.parent.function; current !== null; current = byId.get(current)?.parent.function ?? null) {
      expect(seen.has(current)).toBe(false);
      seen.add(current);
      expect(["system", "equipment"]).toContain(byId.get(current)?.kind);
    }
  }
}

describe("Zielprofil", () => {
  it("liest ein gueltiges Profil", () => {
    const parsed = parseAssetProfile(PROFILE_JSON);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.types.length).toBe(7);
    expect(parsed.profile.spaces["Room"]).toBe("room");
    expect(parsed.warnings).toEqual([]);
  });

  it("lehnt falsches Format, unbekannte Typen und doppelte Schluessel ab", () => {
    expect(parseAssetProfile({ ...PROFILE_JSON, format: "x" }).ok).toBe(false);
    expect(parseAssetProfile(null).ok).toBe(false);
    const unknown = parseAssetProfile({ ...PROFILE_JSON, things: [{ match: {}, type: "missing" }] });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.join(" ")).toContain("missing");
    expect(parseAssetProfile({ ...PROFILE_JSON, types: [...PROFILE_JSON.types, { key: "light", class: "X", attributes: [] }] }).ok).toBe(false);
    expect(parseAssetProfile({ ...PROFILE_JSON, spaces: { Room: "nope" } }).ok).toBe(false);
    expect(parseAssetProfile({ ...PROFILE_JSON, types: [{ key: "bad key!", class: "X", attributes: [] }] }).ok).toBe(false);
  });

  it("lehnt Regeln ohne Bedingung und unbekannte Thing-Typen ab, warnt bei unbekannten Rollen", () => {
    const empty = parseAssetProfile({ ...PROFILE_JSON, things: [{ match: { anyRole: [] }, type: "light" }] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.join(" ")).toContain("mindestens eine Bedingung");
    expect(parseAssetProfile({ ...PROFILE_JSON, things: [{ match: { thingType: ["Lamp"] }, type: "light" }] }).ok).toBe(false);
    const role = parseAssetProfile({ ...PROFILE_JSON, attributes: [{ roles: ["OnOffSwitch"], attribute: "on_off" }] });
    expect(role.ok).toBe(true);
    if (role.ok) expect(role.warnings.join(" ")).toContain("OnOffSwitch");
    expect(parseAssetProfile({ ...PROFILE_JSON, things: [{ match: { central: true }, type: "light" }] }).ok).toBe(true);
  });

  it("ignoriert unbrauchbare Attribute mit Hinweis", () => {
    const parsed = parseAssetProfile({
      ...PROFILE_JSON,
      types: [...PROFILE_JSON.types, { key: "odd", class: "X", attributes: [{ name: "a", subtype: "weird" }, { name: "b", subtype: "input" }, { name: "b", subtype: "input" }, "x"] }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.types.find((type) => type.key === "odd")?.attributes.map((attribute) => attribute.name)).toEqual(["b"]);
    expect(parsed.warnings.length).toBe(3);
  });
});

describe("Asset-Modell ohne Zielprofil", () => {
  it("baut einen geschlossenen Ortsbaum mit Land, Region und Standort ueber dem Gebaeude", async () => {
    const model = await buildAssetModel(analysis, EMPTY_ASSET_PROFILE, SITE, "test");
    checkIntegrity(model, demo);
    const [country] = model.assets;
    expect(country).toMatchObject({ kind: "country", name: "Germany", parent: { location: null } });
    const region = model.assets.find((asset) => asset.kind === "region");
    const site = model.assets.find((asset) => asset.kind === "site");
    expect(region?.parent.location).toBe(country?.id);
    expect(site?.parent.location).toBe(region?.id);
    expect(model.assets.filter((asset) => asset.kind === "space").length).toBe(demo.spaces.size);
    expect(model.types.every((type) => type.origin === "generated")).toBe(true);
    expect(model.stats.equipment).toBeGreaterThan(0);
    expect(model.gaps.map((gap) => gap.id)).toEqual(expect.arrayContaining(["upper-country", "upper-region", "command-feedback", "functional-tree"]));
    // Ohne Profil sind fehlende Typen keine Luecke, sondern der Normalfall.
    expect(model.gaps.some((gap) => gap.id.startsWith("thing-") || gap.id.startsWith("space-"))).toBe(false);
  });

  it("laesst Land und Region weg, wenn sie fehlen, und vergibt Kennungen mit Praefix", async () => {
    const model = await buildAssetModel(analysis, EMPTY_ASSET_PROFILE, { codePrefix: "Häus 1" }, "test");
    checkIntegrity(model, demo);
    expect(model.assets[0]?.kind).toBe("site");
    expect(model.assets.every((asset) => asset.code.startsWith("HAUS1-"))).toBe(true);
    expect(model.gaps.some((gap) => gap.id === "upper-country")).toBe(false);
  });

  it("ist reproduzierbar", async () => {
    const a = await buildAssetModel(analysis, EMPTY_ASSET_PROFILE, SITE, "test");
    const b = await buildAssetModel(analysis, EMPTY_ASSET_PROFILE, SITE, "test");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("bindet Befehl und Rueckmeldung an dasselbe Attribut", async () => {
    const model = await buildAssetModel(style, EMPTY_ASSET_PROFILE, SITE, "test");
    const paired = model.assets.flatMap((asset) => asset.bindings).filter((binding) => binding.write && binding.feedback);
    expect(paired.length).toBeGreaterThan(10);
    expect(model.gaps.find((gap) => gap.id === "command-feedback")?.count).toBe(paired.length);
    expect(model.gaps.find((gap) => gap.id === "central-function")?.count).toBeGreaterThan(0);
  });
});

describe("Asset-Modell mit Zielprofil", () => {
  it("nutzt Profiltypen und fuehrt fehlende Attribute als Erweiterung", async () => {
    const model = await buildAssetModel(style, profile(), SITE, "test");
    const light = model.types.find((type) => type.key === "light");
    expect(light).toMatchObject({ origin: "profile", class: "Lighting_System", tags: ["usage:lighting"] });
    // Dimmbare Lichter bringen Helligkeit und relatives Dimmen mit, die der Testtyp nicht hat.
    expect(light?.extended).toBe(true);
    expect(light?.attributes.find((attribute) => attribute.name === "on_off")).toMatchObject({ origin: "profile", dpt: "1.001", map: { "0": "Off", "1": "On" } });
    expect(light?.attributes.some((attribute) => attribute.origin === "extension")).toBe(true);
    const missing = model.gaps.find((gap) => gap.id === "missing-attributes-light");
    expect(missing?.action).toBe("extend-model");
    expect(missing?.examples.some((example) => example.startsWith("brightness"))).toBe(true);
    // Gezaehlt werden Bindungen auf ergaenzte Attribute, nicht Attribute.
    const extended = new Set(light?.attributes.filter((attribute) => attribute.origin === "extension").map((attribute) => attribute.name));
    const onExtensions = model.assets.filter((asset) => asset.type === "light").flatMap((asset) => asset.bindings).filter((binding) => extended.has(binding.attribute));
    expect(missing?.count).toBe(onExtensions.length);
    const lamp = model.assets.find((asset) => asset.type === "light");
    expect(lamp?.tags).toEqual(["usage:lighting"]);
    expect(lamp?.bindings.find((binding) => binding.attribute === "on_off")?.write).toBeDefined();
    // Raeume aus dem Profil, Standort aus "upper".
    expect(model.assets.filter((asset) => asset.type === "room").length).toBeGreaterThan(5);
    expect(model.assets.find((asset) => asset.kind === "site")?.type).toBe("site");
  });

  it("legt Schrittbefehle nicht auf die Groesse selbst", async () => {
    const model = await buildAssetModel(analysis, profile(), SITE, "test");
    const controller = model.assets.find((asset) => asset.type === "room_controller");
    expect(controller).toBeDefined();
    const step = controller?.bindings.find((binding) => binding.dpt === "1.007");
    expect(step?.attribute).toBe("setpoint_step");
    expect(controller?.bindings.find((binding) => binding.attribute === "setpoint")?.dpt).toBe("9.001");
    expect(model.gaps.some((gap) => gap.id === "duplicate-attribute")).toBe(false);
  });

  it("meldet Einheitenkonflikte und Schreibzugriffe auf Eingaenge", async () => {
    const model = await buildAssetModel(style, profile(), SITE, "test");
    const ids = model.gaps.map((gap) => gap.id);
    // Sollwert ist im Testtyp input, KNX schreibt ihn aber.
    expect(ids).toContain("subtype-room_controller-setpoint");
    checkIntegrity(model, buildGraph(await loadKnxProject(readFixture("oeffentlich/style3.knxproj"))));
  });

  it("legt fuer Things ohne Regel eigene Typen an und fuehrt sie als Luecke", async () => {
    const model = await buildAssetModel(analysis, profile(), SITE, "test");
    const generated = model.types.filter((type) => type.origin === "generated" && model.assets.some((asset) => asset.type === type.key && asset.kind === "equipment"));
    expect(generated.length).toBeGreaterThan(0);
    for (const type of generated) expect(type.key.startsWith("knx_")).toBe(true);
    expect(model.gaps.some((gap) => gap.id.startsWith("thing-") && gap.action === "generated")).toBe(true);
    // ETS-Raumtypen ohne Profiltyp (Gebaeudeteil, Verteiler) sind ebenfalls Luecken.
    expect(model.gaps.some((gap) => gap.id === "space-distribution_board")).toBe(true);
  });

  it("nimmt ausgeschlossene GAs nicht auf", async () => {
    const first = demo.groupAddresses[0];
    expect(first).toBeDefined();
    if (!first) return;
    const reduced = analyzeProject(demo, { useEtsFunctions: true, exclude: { ...NO_EXCLUSION, gas: [first.ga.id] } });
    const model = await buildAssetModel(reduced, profile(), SITE, "test");
    const bound = model.assets.flatMap((asset) => asset.bindings).flatMap((binding) => [binding.write, binding.feedback]);
    expect(bound).not.toContain(first.ga.text);
    expect(model.gaps.find((gap) => gap.id === "excluded")?.count).toBe(1);
  });
});

describe("Funktionsbaum", () => {
  it("haengt Assets unter ihr System und unter die Zentralfunktion, die sie schaltet", async () => {
    const model = await buildAssetModel(style, profile(), SITE, "test");
    const byId = new Map(model.assets.map((asset) => [asset.id, asset]));
    const systems = model.assets.filter((asset) => asset.kind === "system");
    expect(systems.map((asset) => asset.name)).toEqual(expect.arrayContaining(["Lighting", "Shading", "Heating and climate"]));
    // Systeme stehen im Ortsbaum unter dem Gebaeude.
    for (const system of systems) expect(byId.get(system.parent.location ?? "")?.source.spaceType).toBe("Building");
    // Style3 hat keine Geraete: Zentralfunktionen haengen ohne Mitglieder unter ihrem System.
    const centrals = model.assets.filter((asset) => asset.source.central === true);
    expect(centrals.length).toBeGreaterThan(0);
    for (const central of centrals) expect(byId.get(central.parent.function ?? "")?.kind).toBe("system");
    expect(model.gaps.find((gap) => gap.id === "central-unlinked")?.count).toBe(centrals.length);
    expect(model.gaps.some((gap) => gap.id === "system-type" && gap.action === "generated")).toBe(true);
  });

  it("findet die Mitglieder einer Zentralfunktion ueber den Aktorkanal", async () => {
    // Eine Zentral-GA, die auf denselben Aktorkanal geht wie das Licht im Demoprojekt.
    const light = demo.groupAddresses.find((node) => node.ga.text === "0/0/1");
    expect(light?.links.some((link) => link.comObject.channel)).toBe(true);
    if (!light) return;
    const central = { ...light, functions: [], ga: { ...light.ga, id: "ga-zentral", address: 7 * 2048, text: "0/7/0", name: "Zentral Licht aus" } };
    const graph: ProjectGraph = {
      ...demo,
      groupAddresses: [...demo.groupAddresses, central],
      byGroupAddressId: new Map([...demo.byGroupAddressId, [central.ga.id, central]]),
    };
    const model = await buildAssetModel(analyzeProject(graph, { useEtsFunctions: true }), profile(), SITE, "test");
    checkIntegrity(model, graph);
    const byId = new Map(model.assets.map((asset) => [asset.id, asset]));
    const centralAsset = model.assets.find((asset) => asset.source.central === true);
    expect(centralAsset).toBeDefined();
    expect(byId.get(centralAsset?.parent.function ?? "")?.kind).toBe("system");
    const members = model.assets.filter((asset) => asset.parent.function === centralAsset?.id);
    expect(members.map((asset) => asset.name)).toContain("Light");
    expect(model.gaps.find((gap) => gap.id === "central-function")?.detail).toContain("1 of 1 linked");
  });

  it("nimmt Systemtypen aus dem Profil, wenn es sie nennt", async () => {
    const json = { ...PROFILE_JSON, types: [...PROFILE_JSON.types, { key: "lighting_system", class: "System", attributes: [] }], systems: { lighting: "lighting_system" } };
    const model = await buildAssetModel(style, profile(json), SITE, "test");
    expect(model.assets.find((asset) => asset.kind === "system" && asset.name === "Lighting")?.type).toBe("lighting_system");
    expect(parseAssetProfile({ ...PROFILE_JSON, systems: { lighting: "missing" } }).ok).toBe(false);
  });
});

describe("Eindeutige Kennungen", () => {
  // Mehrere Things am selben Aktorkanal teilten frueher dieselbe stabile ID (privates Projekt D).
  const fixtures = ["oeffentlich/demoprojekt.knxproj", "oeffentlich/style3.knxproj", "privat/projekt-c.zip", "privat/projekt-d.zip", "privat/projekt-e.knxproj", "privat/schule.knxproj"];
  for (const fixture of fixtures) {
    it.runIf(hasFixture(fixture))(`vergibt jede ID nur einmal: ${fixture}`, async () => {
      const graph = buildGraph(await loadKnxProject(readFixture(fixture)));
      const result = analyzeProject(graph, { useEtsFunctions: true });
      const model = await buildAssetModel(result, profile(), SITE, "test");
      checkIntegrity(model, graph);
    });
  }

  it("verkraftet Raumtypen, die wie Objekt-Eigenschaften heissen", async () => {
    const spaces = new Map(demo.spaces);
    const first = [...spaces.values()][0];
    expect(first).toBeDefined();
    if (!first) return;
    const odd = { ...first, space: { ...first.space, id: "odd-space", type: "constructor", parentId: undefined } };
    spaces.set("odd-space", odd);
    const graph: ProjectGraph = { ...demo, spaces };
    const model = await buildAssetModel(analyzeProject(graph, { useEtsFunctions: true }), profile(), SITE, "test");
    const asset = model.assets.find((entry) => entry.source.ets === "odd-space");
    expect(typeof asset?.type).toBe("string");
    expect(asset?.type).toBe("knx_constructor");
    expect(() => structuredClone(model)).not.toThrow();
  });
});

describe("KI-Zuordnung", () => {
  it("fragt nur nach, was offen ist, und uebernimmt gepruefte Regeln", async () => {
    const base = profile();
    const model = await buildAssetModel(analysis, base, SITE, "test");
    expect(needsMapping(model)).toBe(true);
    const prompt = buildMappingPrompt(model, base);
    expect(prompt).toBeDefined();
    expect(prompt).toContain("light | Lighting_System | output:on_off");
    expect(prompt).toContain("Generic");
    expect(buildMappingPrompt(model, EMPTY_ASSET_PROFILE)).toBeUndefined();

    const rejected = applyMappingAnswer(base, { things: [{ match: { thingType: ["Generic"] }, type: "invented" }] });
    expect(rejected.ok).toBe(false);
    const accepted = applyMappingAnswer(base, { things: [{ match: { thingType: ["Generic"] }, type: "light" }], attributes: [] });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const after = await buildAssetModel(analysis, accepted.profile, SITE, "test");
    expect(after.types.some((type) => type.key === "knx_generic")).toBe(false);
    expect(after.gaps.some((gap) => gap.id === "thing-generic")).toBe(false);
  });
});

describe("Dateien", () => {
  it("schreibt Modell, Vorlagenbibliothek, Luecken und Ortsbaum", async () => {
    const model = await buildAssetModel(style, profile(), SITE, "test");
    const files = assetFiles(model, "prompt");
    expect(files.map((file) => file.path)).toEqual(["asset-model.json", "template-library.md", "gaps.md", "location-tree.md", "function-tree.md", "mapping-prompt.md"]);
    expect(JSON.parse(files[0]?.text ?? "{}")).toMatchObject({ format: "knx-asset-model-1", stats: model.stats });
    const gaps = gapsMarkdown(model);
    for (const gap of model.gaps) expect(gaps).toContain(gap.title);
    const library = templateLibraryMarkdown(model);
    for (const type of model.types) expect(library).toContain(`## ${type.key}`);
    expect(library).toContain("**extension**");
    const tree = locationTreeMarkdown(model);
    expect(tree).toContain("- **Germany**");
    expect(tree.split("\n").filter((line) => line.trimStart().startsWith("- ")).length).toBe(model.assets.length);
  });
});
