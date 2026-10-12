import { beforeAll, describe, expect, it } from "vitest";
import { loadKnxProject } from "../src/ets/load.ts";
import type { Space } from "../src/ets/model.ts";
import { buildGraph, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { decide } from "../src/recognize/claims.ts";
import { analyzeProject } from "../src/recognize/pipeline.ts";
import { compileProfile, PROFILE_FORMAT_V2, parseProfile, profileJson } from "../src/recognize/profile.ts";
import { compileSchema, matchSchema, parseSchema, schemaCoverage } from "../src/recognize/schema.ts";
import { buildSchemaPrompt, extractJson } from "../src/recognize/schema-prompt.ts";
import { readFixture } from "./helpers.ts";

const space = (id: string, name: string, type = "Room", parentId?: string): Space => ({
  id,
  name,
  type,
  usage: undefined,
  number: undefined,
  description: "",
  parentId,
  deviceIds: [],
});

/** Buerogebaeude mit Schema "Etage.Raum.Gewerk-Art-Funktion-Kanal" und zwei gleichnamigen Technikraeumen. */
const SPACES = [
  space("b", "Office", "Building"),
  space("f1", "First Floor", "Floor", "b"),
  space("f2", "Second Floor", "Floor", "b"),
  space("o1", "Office1", "Room", "f1"),
  space("o2", "Office2", "Room", "f1"),
  space("t1", "Plant", "Room", "f1"),
  space("t2", "Plant", "Room", "f2"),
];

const OFFICE = {
  format: PROFILE_FORMAT_V2,
  name: "Buero",
  aufbau: "Etage.Raum.Gewerk-Art-Funktion[-Kanal]",
  patterns: [{ regex: "^(?<floor>[^.]+)\\.(?<room>[^.]+)\\.(?<trade>[A-Z])-(?<kind>[A-Z]+)-(?<function>.+?)(?:-(?<channel>Ch[A-Z]))?$", thing: ["room", "trade", "channel"] }],
  values: {
    trade: { L: { trade: "lighting", label: "Licht" }, T: { trade: "hvac", label: "Raumregler" }, M: { trade: "hvac", thing: "T" } },
    kind: { SET: { direction: "command" }, STA: { direction: "status" }, SETPT: { direction: "command" } },
    function: { Dim: { aspect: "dim" } },
  },
  rules: [{ match: "SETPT-Current", direction: "status", why: "aktueller Sollwert wird gemeldet" }],
};

function compiled(json: unknown = OFFICE) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schema = parseSchema(json as Record<string, unknown>, errors, warnings);
  expect(errors).toEqual([]);
  return { schema: compileSchema(schema, SPACES), warnings };
}

describe("Namensschema mit Aufbau", () => {
  it("liest Raum, Gewerk, Richtung und Thing aus dem Muster", () => {
    const { schema } = compiled();
    const dim = matchSchema(schema, "First Floor.Office1.L-SET-Dim-ChA");
    expect(dim).toMatchObject({ roomId: "o1", trade: "lighting", direction: "command", aspects: ["dim"], thingLabel: "Licht ChA" });
    const status = matchSchema(schema, "First Floor.Office1.L-STA-Switch-ChA");
    expect(status?.direction).toBe("status");
    expect(status?.thingKey).toBe(dim?.thingKey);
    expect(matchSchema(schema, "First Floor.Office1.L-SET-Switch-ChB")?.thingKey).not.toBe(dim?.thingKey);
  });

  it("bildet mit 'thing' ein gemeinsames Thing und laesst Regeln den Werten vorgehen", () => {
    const { schema } = compiled();
    const mode = matchSchema(schema, "First Floor.Office2.M-SET-Occ");
    const setpoint = matchSchema(schema, "First Floor.Office2.T-SETPT-Current-Heating");
    expect(mode?.thingKey).toBe(setpoint?.thingKey);
    expect(mode?.thingLabel).toBe("Raumregler");
    expect(setpoint?.direction).toBe("status");
    expect(matchSchema(schema, "First Floor.Office2.T-SETPT-BaseSetpoint")?.direction).toBe("command");
  });

  it("entscheidet gleichnamige Raeume ueber die Etage und meldet unbekannte", () => {
    const { schema } = compiled();
    expect(matchSchema(schema, "Second Floor.Plant.T-STA-Valve")?.roomId).toBe("t2");
    expect(matchSchema(schema, "Ground Floor.Plant.T-STA-Valve")?.roomId).toBeUndefined();
    const coverage = schemaCoverage(schema, ["First Floor.Office1.L-SET-Dim-ChA", "First Floor.Lobby.L-SET-Switch", "Zentral Aus"]);
    expect(coverage).toMatchObject({ perPattern: [2], unmatched: 1, unmatchedExamples: ["Zentral Aus"], unknownRooms: ["Lobby"], things: 2 });
  });

  it("ordnet Raumkuerzel ueber die Werte zu", () => {
    const { schema } = compiled({
      patterns: [{ regex: "^(?<room>[A-Z]{2}) (?<trade>L|R) (?<function>.+)$", thing: ["room", "trade"] }],
      values: { room: { WZ: { room: "Office2" } }, trade: { L: { trade: "lighting" } } },
    });
    expect(matchSchema(schema, "WZ L Decke")?.roomId).toBe("o2");
  });

  it("lehnt kaputte Muster ab und laesst unbekannte Begriffe mit Hinweis weg", () => {
    expect(parseProfile({ format: PROFILE_FORMAT_V2, patterns: [{ regex: "^(?<a>[" }] }).ok).toBe(false);
    expect(parseProfile({ format: PROFILE_FORMAT_V2, patterns: [{ regex: "^(.+)$" }] }).ok).toBe(false);
    expect(parseProfile({ format: PROFILE_FORMAT_V2 }).ok).toBe(false);
    const parsed = parseProfile({ ...OFFICE, values: { ...OFFICE.values, function: { Value: { aspect: "brightness", label: "Helligkeit" } } } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual(['Wert "function=Value": unbekannter Begriff "brightness" ignoriert.']);
    expect(parsed.profile.schema.values["function"]?.["Value"]).toEqual({ label: "Helligkeit" });
  });

  it("lehnt Muster ab, die den Browser blockieren koennten", () => {
    const result = parseProfile({ format: PROFILE_FORMAT_V2, patterns: [{ regex: "^(?<room>(a+)+)$" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/verschachtelte Wiederholung/);
  });

  it("schreibt das gepruefte Schema so, dass es sich unveraendert wieder liest", () => {
    const first = parseProfile(OFFICE);
    if (!first.ok) throw new Error(first.errors.join("; "));
    const json = profileJson(first.profile);
    expect(json["format"]).toBe(PROFILE_FORMAT_V2);
    const second = parseProfile(json);
    expect(second.ok && second.profile).toEqual(first.profile);
    // Eine reine Kuerzeltabelle bleibt Format 1.
    const table = parseProfile({ format: "knx-td-namensschema-1", name: "t", entries: [{ token: "L", trade: "lighting" }] });
    expect(table.ok && profileJson(table.profile)["format"]).toBe("knx-td-namensschema-1");
  });

  it("holt das JSON aus einer Antwort mit Codezaun", () => {
    expect(extractJson('Hier ist das Schema:\n```json\n{"format": "x"}\n```\nViel Erfolg')).toEqual({ format: "x" });
    expect(() => extractJson("keine Ahnung")).toThrow(/kein JSON/);
  });
});

describe("Namensschema mit Aufbau im Projekt", () => {
  let demo: ProjectGraph;
  beforeAll(async () => {
    demo = buildGraph(await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj")));
  });

  const DEMO = {
    format: PROFILE_FORMAT_V2,
    name: "Demo",
    patterns: [{ regex: "^(?<trade>LD|L|R|H) (?<room>LR) (?<function>.+)$", thing: ["room", "trade"] }],
    values: {
      trade: { L: { trade: "lighting", label: "Light" }, LD: { trade: "lighting", label: "Dimmable light" }, R: { trade: "shading", label: "Blinds" }, H: { trade: "hvac", label: "Heating" } },
      room: { LR: { room: "Living room" } },
    },
    rules: [{ match: " Status$", direction: "status" }],
  };

  it("buendelt nach dem Schema, setzt den Raum fest und laesst ungedeckte GAs der Heuristik", () => {
    const parsed = parseProfile(DEMO);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const analysis = analyzeProject(demo, { useEtsFunctions: false, profile: compileProfile(parsed.profile, demo.loaded.project.spaces) });
    const schemaThings = analysis.things.filter((thing) => thing.draft.source === "schema");
    expect(schemaThings.map((thing) => [thing.draft.label, thing.draft.groupAddressIds.length]).sort()).toEqual([
      ["Living room Blinds", 6],
      ["Living room Dimmable light", 5],
      ["Living room Heating", 4],
      ["Living room Light", 2],
    ]);
    const status = analysis.recognition.groupAddresses.find((entry) => entry.analysis.node.ga.text === "0/0/2");
    expect(status && decide(status.analysis.claims, "room").winner).toMatchObject({ source: "schema", confidence: 0.92 });
    // "Switching" und "Status" ohne Gewerk und Raum deckt das Muster nicht; sie bleiben bei der Heuristik.
    expect(analysis.recognition.groupAddresses.filter((entry) => !entry.analysis.schema).map((entry) => entry.analysis.node.ga.text)).toEqual(["0/0/19", "0/0/20"]);
  });

  it("baut den Prompt ohne Projektdaten und ersetzt Personennamen", () => {
    const named = { ...demo, groupAddresses: demo.groupAddresses.map((node, index) => (index === 0 ? { ...node, ga: { ...node.ga, name: "L Behandlung Dr. Meier" } } : node)) };
    const prompt = buildSchemaPrompt(named);
    expect(prompt.text).toContain("Room: Living room");
    expect(prompt.text).toContain("0/0/5 | New main group / New middle group | LD LR Dimming | DPST-3-7 |");
    expect(prompt.text).toContain("L Behandlung Dr. [Name]");
    expect(prompt.text).not.toContain("Meier");
    expect(prompt.masked).toBe(1);
    expect(prompt.included).toBe(demo.groupAddresses.length);
    // Grosse Projekte: nur Beispiele je Namensform.
    const small = buildSchemaPrompt(demo, { maxGroupAddresses: 5 });
    expect(small.included).toBeLessThan(demo.groupAddresses.length);
    expect(small.included).toBe(5);
    expect(small.text).toMatch(/Weitere 14 GAs sind nicht aufgeführt/);
  });
});
