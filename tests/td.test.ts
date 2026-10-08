import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { analyzeProject } from "../src/recognize/pipeline.ts";
import type { Json, JsonObject } from "../src/td/json.ts";
import { buildThingDescriptions, DEFAULT_TD_OPTIONS, type TdBundle, type TdOptions } from "../src/td/render.ts";
import { TD2_CONTEXT } from "../src/td/vocabulary.ts";
import { readFixture } from "./helpers.ts";

let demo: ProjectGraph;
let style: ProjectGraph;
let validateTd: ValidateFunction;
let validateTm: ValidateFunction;
let validateTd2: ValidateFunction;
let validateTm2: ValidateFunction;

const schema = (name: string): object => JSON.parse(readFileSync(new URL(`./schemas/${name}`, import.meta.url), "utf8")) as object;

beforeAll(async () => {
  demo = buildGraph(await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj")));
  style = buildGraph(await loadKnxProject(readFixture("oeffentlich/style3.knxproj")));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  validateTd = ajv.compile(schema("td-1.1.schema.json"));
  validateTm = ajv.compile(schema("tm-1.1.schema.json"));
  validateTd2 = ajv.compile(schema("td-2.0-draft.schema.json"));
  validateTm2 = ajv.compile(schema("tm-2.0-draft.schema.json"));
});

async function bundle(graph: ProjectGraph, options: Partial<TdOptions> = {}, useEtsFunctions = true): Promise<TdBundle> {
  return buildThingDescriptions(analyzeProject(graph, { useEtsFunctions }), { ...DEFAULT_TD_OPTIONS, ...options }, "0.1.0");
}

function file(result: TdBundle, predicate: (path: string) => boolean): JsonObject {
  const found = result.files.find((entry) => predicate(entry.path));
  if (!found) throw new Error("Datei fehlt");
  return found.json;
}

function object(value: Json | undefined): JsonObject {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("kein Objekt");
  return value as JsonObject;
}

function list(value: Json | undefined): readonly Json[] {
  if (!Array.isArray(value)) throw new Error("keine Liste");
  return value;
}

function formsOf(td: JsonObject, kind: "properties" | "actions", key: string): JsonObject[] {
  return list(object(object(td[kind])[key])["forms"]).map(object);
}

function ops(form: JsonObject): string[] {
  const value = form["op"];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

describe("Gueltigkeit gegen die W3C-Schemas (TD 1.1)", () => {
  it.each([
    ["Demoprojekt", () => demo, {}, true],
    ["Demoprojekt, Befehle als Action", () => demo, { commands: "action" as const }, true],
    ["Demoprojekt, nur fest belegt", () => demo, { strict: true }, true],
    ["Demoprojekt ohne ETS-Funktionen", () => demo, {}, false],
    ["Style3", () => style, {}, false],
  ])("%s", async (_name, graph, options, ets) => {
    const result = await bundle(graph(), options, ets);
    expect(result.things.length).toBeGreaterThan(0);
    for (const entry of result.files) {
      if (entry.path.endsWith(".tm.json")) {
        expect(validateTm(entry.json), `${entry.path}: ${JSON.stringify(validateTm.errors)}`).toBe(true);
      } else if (entry.path.endsWith(".td.json")) {
        expect(validateTd(entry.json), `${entry.path}: ${JSON.stringify(validateTd.errors)}`).toBe(true);
      }
    }
  });
});

describe("Gueltigkeit gegen die Entwurfs-Schemas (TD 2.0)", () => {
  it("Demoprojekt", async () => {
    const result = await bundle(demo, { version: "2.0" });
    for (const entry of result.files) {
      if (entry.path.endsWith(".tm.json")) expect(validateTm2(entry.json), `${entry.path}: ${JSON.stringify(validateTm2.errors)}`).toBe(true);
      else if (entry.path.endsWith(".td.json")) expect(validateTd2(entry.json), `${entry.path}: ${JSON.stringify(validateTd2.errors)}`).toBe(true);
    }
  });
});

describe("Feld-TD", () => {
  it("schaltet ueber eine Property mit Schreib- und Lese-Form, Richtung aus der Verdrahtung", async () => {
    const result = await bundle(demo);
    const light = file(result, (path) => path.startsWith("things/light-") && !path.includes("platform"));
    const forms = formsOf(light, "properties", "on");
    expect(forms.map((form) => [form["href"], ops(form)])).toEqual([
      ["0/0/1", ["writeproperty"]],
      ["0/0/2", ["readproperty", "observeproperty"]],
    ]);
    expect(light["base"]).toBe("knx://gateway/");
    expect(forms[0]?.["kb:dpt"]).toBe("1.001");
  });

  it("folgt bei vertauschten ETS-Rollen der Verdrahtung und markiert den Widerspruch", async () => {
    const result = await bundle(demo);
    const dimmer = file(result, (path) => path.startsWith("things/dimmable-light-") && !path.includes("platform"));
    const forms = formsOf(dimmer, "properties", "brightness");
    expect(forms.map((form) => [form["href"], ops(form)])).toEqual([
      ["0/0/6", ["writeproperty"]],
      ["0/0/7", ["readproperty", "observeproperty"]],
    ]);
    expect(forms[0]?.["kb:openQuestion"]).toBe(true);
    expect(JSON.stringify(forms[0]?.["kb:evidence"])).toContain('"kb:conflict":"status"');
  });

  it("liest nur, wenn ein Objekt Lesetelegramme beantwortet", async () => {
    const result = await bundle(demo);
    const shutter = file(result, (path) => path.startsWith("things/rollershutter-") && !path.includes("platform"));
    expect(ops(formsOf(shutter, "properties", "position")[0] ?? {})).toEqual(["observeproperty"]);
  });

  it("paart nur gleiche Groessen: Sollwert verschieben wird eine eigene Action", async () => {
    const result = await bundle(demo);
    const heating = file(result, (path) => path.startsWith("things/heating-") && !path.includes("platform"));
    expect(object(object(heating["properties"])["setpoint"])["type"]).toBe("number");
    expect(formsOf(heating, "actions", "setpointStep").map((form) => form["href"])).toEqual(["0/0/15"]);
  });

  it("macht in der Variante 'action' aus dem Befehl eine Action und aus der Rueckmeldung eine lesbare Property", async () => {
    const result = await bundle(demo, { commands: "action" });
    const light = file(result, (path) => path.startsWith("things/light-") && !path.includes("platform"));
    expect(formsOf(light, "actions", "switch").map((form) => [form["href"], ops(form)])).toEqual([["0/0/1", ["invokeaction"]]]);
    expect(object(object(light["properties"])["on"])["readOnly"]).toBe(true);
  });

  it("verweist per proxy-to auf die Plattform-TD und per type auf das Thing Model", async () => {
    const result = await bundle(demo);
    const light = file(result, (path) => path.startsWith("things/light-") && !path.includes("platform"));
    const links = list(light["links"]).map(object);
    expect(links.find((link) => link["rel"] === "proxy-to")?.["href"]).toMatch(/^https:\/\/plattform\.example\/things\/[0-9a-f-]{36}\/$/);
    expect(links.find((link) => link["rel"] === "type")?.["href"]).toBe("../models/ft-1.tm.json");
  });
});

describe("Plattform-TD", () => {
  it("bietet HTTP-Forms und beobachtet per Server-Sent Events", async () => {
    const result = await bundle(demo);
    const light = file(result, (path) => path.startsWith("things/light-") && path.includes("platform"));
    expect(formsOf(light, "properties", "on")).toEqual([
      { href: "properties/on", op: "readproperty", contentType: "application/json" },
      { href: "properties/on", op: "writeproperty", contentType: "application/json" },
      { href: "properties/on/observe", op: "observeproperty", contentType: "application/json", subprotocol: "sse" },
    ]);
    expect(JSON.stringify(light)).not.toContain("kb:evidence");
  });
});

describe("Stabile IDs und Varianten", () => {
  it("vergibt bei gleicher Eingabe dieselben IDs", async () => {
    const first = await bundle(demo);
    const second = await bundle(demo);
    expect(first.things.map((thing) => thing.id)).toEqual(second.things.map((thing) => thing.id));
    expect(new Set(first.things.map((thing) => thing.id)).size).toBe(first.things.length);
  });

  it("laesst im strengen Modus schwach belegte GAs weg und zaehlt sie", async () => {
    const loose = await bundle(demo);
    const strict = await bundle(demo, { strict: true });
    expect(strict.excludedGroupAddresses).toBeGreaterThan(0);
    const affordances = (result: TdBundle): number => result.things.reduce((sum, thing) => sum + thing.properties + thing.actions, 0);
    expect(affordances(strict)).toBeLessThan(affordances(loose));
  });

  it("schreibt TD 2.0 mit vorlaeufigem Kontext und expliziten HTTP-Methoden", async () => {
    const result = await bundle(demo, { version: "2.0" });
    const light = file(result, (path) => path.startsWith("things/light-") && path.includes("platform"));
    expect(list(light["@context"])[0]).toBe(TD2_CONTEXT);
    expect(formsOf(light, "properties", "on").map((form) => form["htv:methodName"])).toEqual(["GET", "PUT", "GET"]);
  });

  it("legt den Binding-Kontext als JSON-LD bei", async () => {
    const result = await bundle(demo);
    const context = object(file(result, (path) => path === "knx-binding.jsonld")["@context"]);
    expect(context["kb"]).toBe("https://vw2hwkth76-ai.github.io/ns/knx-binding#");
    expect(object(context["groupAddress"])["@id"]).toBe("kb:groupAddress");
  });
});
