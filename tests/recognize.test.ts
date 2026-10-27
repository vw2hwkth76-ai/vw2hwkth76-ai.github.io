import { beforeAll, describe, expect, it } from "vitest";
import { parseGold } from "../src/bench/gold.ts";
import { RECOGNITION_PREDICTORS } from "../src/bench/recognition-predictor.ts";
import { readiness } from "../src/bench/readiness.ts";
import { accuracy, score } from "../src/bench/score.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph, type GaNode, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { analyzeGroupAddress, type GaAnalysis } from "../src/recognize/analyze.ts";
import { decide } from "../src/recognize/claims.ts";
import { compileProfile, parseProfile } from "../src/recognize/profile.ts";
import { RoomMatcher } from "../src/recognize/rooms.ts";
import { analyzeProject, type ProjectAnalysis } from "../src/recognize/pipeline.ts";
import { byQuantity, type Thing, thingType } from "../src/recognize/things.ts";
import { hasFixture, readFixture } from "./helpers.ts";

const [WITH_ETS, WITHOUT_ETS] = RECOGNITION_PREDICTORS as [(typeof RECOGNITION_PREDICTORS)[0], (typeof RECOGNITION_PREDICTORS)[0]];
const gold = (name: string) => parseGold(JSON.parse(new TextDecoder().decode(readFixture(name))) as unknown);
const graphOf = async (name: string): Promise<ProjectGraph> => buildGraph(await loadKnxProject(readFixture(name)));

let demo: ProjectGraph;
let style: ProjectGraph;

beforeAll(async () => {
  demo = await graphOf("oeffentlich/demoprojekt.knxproj");
  style = await graphOf("oeffentlich/style3.knxproj");
});

function thingOf(analysis: ProjectAnalysis, graph: ProjectGraph, text: string): Thing {
  const id = graph.groupAddresses.find((node) => node.ga.text === text)?.ga.id;
  const thing = analysis.things.find((candidate) => id !== undefined && candidate.draft.groupAddressIds.includes(id));
  if (!thing) throw new Error(`kein Thing fuer ${text}`);
  return thing;
}

const roles = (thing: Thing, graph: ProjectGraph): Record<string, string> =>
  Object.fromEntries([...thing.roles].map(([id, role]) => [graph.byGroupAddressId.get(id)?.ga.text ?? id, role]));

describe("Erkennung ohne ETS-Funktionen", () => {
  it("haelt die Werte am englischen Style-Projekt (ets2td b-pur: 97,6 / 72,8 / 74,0 %)", () => {
    const result = score(style, gold("oeffentlich/style.gold.json"), WITHOUT_ETS);
    expect(accuracy(result.dimensions.room)).toBeGreaterThanOrEqual(0.99);
    expect(accuracy(result.dimensions.function)).toBeGreaterThanOrEqual(0.76);
    expect(accuracy(result.dimensions.direction)).toBeGreaterThanOrEqual(0.92);
    expect(result.dimensions.direction.wrong).toBe(0);
    expect(accuracy(result.dimensions.dpt)).toBe(1);
  });

  it("findet Raumkuerzel aus Initialen und raet bei mehrdeutiger Position nicht (Demoprojekt)", () => {
    const result = score(demo, gold("oeffentlich/demoprojekt.gold.json"), WITHOUT_ETS);
    expect(accuracy(result.dimensions.room)).toBe(1);
    // 0/0/12 entscheidet der Objekttext ("Status der Jalousie fuer Anzeige"), 0/0/13 hat keine Verknuepfung.
    expect(result.dimensions.direction.correct).toBe(16);
    expect(result.dimensions.direction.wrong).toBe(0);
  });

  it.skipIf(!hasFixture("privat/schule.knxproj"))("haelt die Werte am Schulprojekt ohne DPT-Angaben (nur lokal)", async () => {
    const graph = await graphOf("privat/schule.knxproj");
    const result = score(graph, gold("privat/schule.gold.json"), WITH_ETS);
    expect(accuracy(result.dimensions.room)).toBeGreaterThanOrEqual(0.97);
    expect(accuracy(result.dimensions.direction)).toBeGreaterThanOrEqual(0.98);
    expect(accuracy(result.dimensions.dpt)).toBeGreaterThanOrEqual(0.99);
    expect(result.dimensions.dpt.wrong).toBe(0);
    const ready = readiness(analyzeProject(graph, { useEtsFunctions: true }), gold("privat/schule.gold.json"));
    expect(ready.ready / ready.groupAddresses).toBeGreaterThanOrEqual(0.95);
    expect(ready.bundling?.precision).toBeGreaterThanOrEqual(0.97);
    expect(ready.bundling?.recall).toBeGreaterThanOrEqual(0.9);
  });

  it.skipIf(!hasFixture("privat/projekt-c.zip"))("haelt die Werte am Projekt mit Raumnummern und kaum Verknuepfungen (nur lokal)", async () => {
    const graph = await graphOf("privat/projekt-c.zip");
    const goldC = gold("privat/projekt-c.gold.json");
    const result = score(graph, goldC, WITH_ETS);
    expect(accuracy(result.dimensions.room)).toBe(1);
    expect(result.dimensions.direction.wrong).toBe(0);
    expect(result.dimensions.dpt.wrong).toBe(0);
    expect(accuracy(result.dimensions.direction)).toBeGreaterThanOrEqual(0.97);
    expect(accuracy(result.dimensions.dpt)).toBeGreaterThanOrEqual(0.97);
    const analysis = analyzeProject(graph, { useEtsFunctions: true });
    const ready = readiness(analysis, goldC);
    expect(ready.ready / ready.groupAddresses).toBeGreaterThanOrEqual(0.72);
    expect(ready.bundling?.precision).toBe(1);
    expect(ready.bundling?.recall).toBeGreaterThanOrEqual(0.99);
    // Eine Frage je Funktion statt je GA.
    expect(analysis.questions.length).toBeLessThanOrEqual(30);
    expect(analysis.questions.some((question) => question.groupAddressIds.length >= 49)).toBe(true);
  });

  it.skipIf(!hasFixture("privat/projekt-d.zip"))("haelt die Werte am Projekt mit Platzhaltern und Etagen als Ort (nur lokal)", async () => {
    const graph = await graphOf("privat/projekt-d.zip");
    const goldD = gold("privat/projekt-d.gold.json");
    const result = score(graph, goldD, WITH_ETS);
    expect(accuracy(result.dimensions.room)).toBe(1);
    expect(result.dimensions.direction.wrong).toBe(0);
    expect(accuracy(result.dimensions.direction)).toBeGreaterThanOrEqual(0.98);
    expect(accuracy(result.dimensions.dpt)).toBe(1);
    const analysis = analyzeProject(graph, { useEtsFunctions: true });
    const ready = readiness(analysis, goldD);
    // Platzhalter (".", "Reserva") zaehlen nicht mit.
    expect(ready.outOfUse).toBeGreaterThanOrEqual(130);
    expect(ready.ready / ready.groupAddresses).toBeGreaterThanOrEqual(0.97);
    // Zentral-GAs auf mehreren Kanaelen kleben die Kanaele nicht zusammen.
    expect(ready.bundling?.precision).toBe(1);
    expect(ready.bundling?.recall).toBeGreaterThanOrEqual(0.93);
    expect(analysis.questions.length).toBeLessThanOrEqual(12);
  });

  it.skipIf(!hasFixture("privat/projekt-e.knxproj"))("findet Raeume hinter der Etage und laesst Ersatzregeln nicht gegen Kennwoerter gewinnen (nur lokal)", async () => {
    const graph = await graphOf("privat/projekt-e.knxproj");
    const goldE = gold("privat/projekt-e.gold.json");
    const result = score(graph, goldE, WITH_ETS);
    // Blind: 0,5 % Raum (Etage statt Buero), 23 falsche Richtungen.
    expect(accuracy(result.dimensions.room)).toBe(1);
    expect(result.dimensions.direction.wrong).toBeLessThanOrEqual(11);
    expect(result.dimensions.dpt.wrong).toBe(0);
    const ready = readiness(analyzeProject(graph, { useEtsFunctions: true }), goldE);
    expect(ready.readyWrong).toBeLessThanOrEqual(3);
  });

  it.skipIf(!hasFixture("privat/projekt-e.namensschema.json"))("liest mit bestaetigtem Schema alles fest und buendelt wie der Errichter (nur lokal)", async () => {
    const graph = await graphOf("privat/projekt-e.knxproj");
    const goldE = gold("privat/projekt-e.gold.json");
    const parsed = parseProfile(JSON.parse(new TextDecoder().decode(readFixture("privat/projekt-e.namensschema.json"))) as unknown);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const options = { useEtsFunctions: true, profile: compileProfile(parsed.profile, graph.loaded.project.spaces) };
    const analysis = analyzeProject(graph, options);
    const ready = readiness(analysis, goldE);
    expect(ready.readyWrong).toBe(0);
    expect(ready.ready / ready.groupAddresses).toBeGreaterThanOrEqual(0.96);
    expect(ready.firm / ready.groupAddresses).toBeGreaterThanOrEqual(0.85);
    expect(ready.bundling).toEqual({ precision: 1, recall: 1 });
    expect(analysis.things).toHaveLength(33);
    expect(analysis.questions.length).toBeLessThanOrEqual(4);
  });

  it.skipIf(!hasFixture("privat/musterprojekt-ets6.knxproj"))("haelt die Werte am Musterprojekt (Trainingsprojekt, ets2td: 85 / 92 / 71 / 68 %)", async () => {
    const graph = await graphOf("privat/musterprojekt-ets6.knxproj");
    const result = score(graph, gold("privat/musterprojekt-ets6.gold.json"), WITHOUT_ETS);
    expect(accuracy(result.dimensions.room)).toBe(1);
    expect(accuracy(result.dimensions.direction)).toBe(1);
    expect(accuracy(result.dimensions.dpt)).toBe(1);
    expect(result.dimensions.function.correct).toBeGreaterThanOrEqual(64);

    const analysis = analyzeProject(graph, { useEtsFunctions: false });
    const living = roles(thingOf(analysis, graph, "3/2/7"), graph);
    expect(living).toEqual({
      "3/2/1": "ValveSwitch",
      "3/2/2": "HeatingStatus",
      "3/2/3": "ComfortMode",
      "3/2/5": "NightMode",
      "3/2/6": "FrostProtectionMode",
      "3/2/7": "TempRoom",
      "3/2/8": "TempRoomSetpoint",
    });
    expect(thingOf(analysis, graph, "3/5/8").draft.roomId).toBe(thingOf(analysis, graph, "3/5/13").draft.roomId);
    // Unverknuepfte Heizungs-GAs ("Betriebsm. Kompf.", "heizen") sind Bits, keine offene Frage.
    const ready = readiness(analysis, gold("privat/musterprojekt-ets6.gold.json"));
    expect(ready.ready / ready.groupAddresses).toBeGreaterThanOrEqual(0.95);
    expect(analysis.questions.length).toBeLessThanOrEqual(8);
  });
});

describe("Einzelne GA ohne verknuepfte Objekte", () => {
  /** Unverknuepfte GA des Demoprojekts mit anderem Namen und Gruppenbereich. */
  const analyze = (name: string, range?: string): GaAnalysis => {
    const base = demo.groupAddresses.find((entry) => entry.ga.text === "0/0/10");
    if (!base) throw new Error("0/0/10 fehlt");
    const template = base.ranges[0];
    const node: GaNode = {
      ...base,
      ga: { ...base.ga, name, dpts: [] },
      ranges: range && template ? [{ ...template, name: range }] : [],
      functions: [],
      links: [],
      comObjectDpts: new Map(),
      comObjectSizes: new Set(),
    };
    return analyzeGroupAddress(node, demo, new RoomMatcher(demo.loaded.project.spaces), { useEtsFunctions: false });
  };
  const dpt = (analysis: GaAnalysis) => decide(analysis.claims, "dpt");

  it("liest einen Betriebsmodus oder Heizen allein als Bit", () => {
    expect(dpt(analyze("Betriebsm. Kompf.")).winner?.value).toBe("DPT-1");
    expect(dpt(analyze("heizen")).winner?.value).toBe("DPT-1");
    expect(dpt(analyze("Szene Abend")).winner?.value).toBe("DPST-17-1");
    // Unter "Heizen" ist eine Rueckmeldung ohne weiteren Begriff ebenfalls ein Bit, aber nur schwach belegt.
    expect(dpt(analyze("Status", "Heizen")).winner).toMatchObject({ value: "DPT-1", source: "hierarchy" });
  });

  it("laesst einen Begriff mit eigenem Datenpunkttyp vorgehen, ohne Widerspruch", () => {
    const valve = dpt(analyze("Heizen Stellwert"));
    expect(valve.winner?.value).toBe("DPST-5-1");
    expect(valve.conflict).toBeUndefined();
    expect(dpt(analyze("Ist-Temperatur", "Heizen")).winner?.value).toBe("DPST-9-1");
  });

  it("legt Platzhalter und Reserve still", () => {
    expect(analyze(".").outOfUse).toBe(true);
    expect(analyze("--").outOfUse).toBe(true);
    expect(analyze("Reserva 3").outOfUse).toBe(true);
    expect(analyze("Reserve").outOfUse).toBe(true);
    expect(analyze("Luz sala").outOfUse).toBe(false);
  });
});

describe("Erkennung mit ETS-Funktionen", () => {
  it("laesst die Verdrahtung vertauschte ETS-Rollen schlagen", () => {
    const result = score(demo, gold("oeffentlich/demoprojekt.gold.json"), WITH_ETS);
    for (const dimension of ["room", "function", "direction", "dpt"] as const) {
      expect(accuracy(result.dimensions[dimension])).toBe(1);
    }
    const analysis = analyzeProject(demo);
    const conflicts = analysis.questions.filter((question) => question.kind === "conflict" && question.dimension === "direction");
    expect(conflicts.map((question) => question.groupAddressId).sort()).toEqual(["P-045C-0_GA-6", "P-045C-0_GA-7"]);
  });
});

describe("Things", () => {
  it("buendelt einen Dimmkanal ueber den Aktorkanal und vergibt die KNX-Rollen", () => {
    const analysis = analyzeProject(demo, { useEtsFunctions: false });
    const light = thingOf(analysis, demo, "0/0/3");
    expect(light.type).toBe("DimmableLight");
    expect(light.functionType).toBe("FT-6");
    expect(light.draft.source).toBe("channel");
    expect(roles(light, demo)).toEqual({
      "0/0/3": "SwitchOnOff",
      "0/0/4": "InfoOnOff",
      "0/0/5": "DimmingControl",
      "0/0/6": "DimmingValue",
      "0/0/7": "InfoDimmingValue",
    });
    const heating = thingOf(analysis, demo, "0/0/14");
    expect(heating.type).toBe("Heating");
    expect(roles(heating, demo)["0/0/16"]).toBe("InfoTempRoomSetpoint");
  });

  it("stellt fuer mehrdeutige Positionen eine Rueckfrage statt zu raten", () => {
    const analysis = analyzeProject(demo, { useEtsFunctions: false });
    const open = analysis.questions.filter((question) => question.dimension === "direction").map((question) => question.groupAddressId);
    expect(open.sort()).toEqual(["P-045C-0_GA-13"]);
  });

  it("trennt Meldungen von Zentralbefehlen (Style)", () => {
    const analysis = analyzeProject(style, { useEtsFunctions: false });
    expect(thingOf(analysis, style, "2/0/1").draft.key).not.toBe(thingOf(analysis, style, "2/0/0").draft.key);
    expect(thingOf(analysis, style, "1/1/66").draft.label).toBe("Bed");
  });
});

describe("Rolle nach Groesse und Wetter-Typ", () => {
  it("trennt Leistung von Energie nach dem Datenpunkttyp, nicht nach dem Namen", () => {
    expect(byQuantity("Energy", "DPST-14-56")).toBe("Power");
    expect(byQuantity("Energy", "DPST-9-24")).toBe("Power");
    expect(byQuantity("Power", "DPST-13-10")).toBe("Energy");
    expect(byQuantity("Power", "DPST-14-56")).toBe("Power");
    expect(byQuantity("Energy", "DPST-13-13")).toBe("Energy");
    expect(byQuantity("Energy", undefined)).toBe("Energy");
    expect(byQuantity("SwitchOnOff", "DPST-1-1")).toBe("SwitchOnOff");
  });

  it("erkennt Wetter-Rohwerte ohne Rolle am Namen, andere Meldungen bleiben Meldungen", () => {
    expect(thingType("monitoring", new Set(), ["Wetter Wind Rohwert"])).toBe("Weather");
    expect(thingType("monitoring", new Set(["TempOutside"]), ["Aussentemperatur"])).toBe("Weather");
    expect(thingType("monitoring", new Set(["WindAlarm"]), ["Windalarm"])).toBe("Weather");
    expect(thingType("monitoring", new Set(["Alarm"]), ["KG Technikraum Wassermelder"])).toBe("Alarm");
    expect(thingType("monitoring", new Set(["WindowStatus"]), ["Wetter Fenster"])).toBe("WindowContact");
  });
});
