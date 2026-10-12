import { beforeAll, describe, expect, it } from "vitest";
import { BASELINE_PREDICTORS } from "../src/bench/baseline.ts";
import { parseGold } from "../src/bench/gold.ts";
import { accuracy, score } from "../src/bench/score.ts";
import { normalizeText } from "../src/bench/normalize.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { directionConflicts, directionEvidence } from "../src/graph/direction.ts";
import { buildGraph, type GaLink, type GaNode, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { hasFixture, readFixture } from "./helpers.ts";

let demo: ProjectGraph;

beforeAll(async () => {
  demo = buildGraph(await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj")));
});

function node(graph: ProjectGraph, text: string): GaNode {
  const found = graph.groupAddresses.find((entry) => entry.ga.text === text);
  if (!found) throw new Error(`${text} fehlt`);
  return found;
}

const gold = (name: string) => parseGold(JSON.parse(new TextDecoder().decode(readFixture(name))) as unknown);

describe("Evidenz-Graph", () => {
  it("verknuepft Sender und Empfaenger mit Flags, Geraet und Einbauort", () => {
    const command = node(demo, "0/0/3");
    const actuator = command.links.find((link) => link.device.product?.isRailMounted);
    expect(actuator?.receives).toBe(true);
    expect(actuator?.sends).toBe(false);
    expect(demo.deviceSpace.get(actuator?.device.device.id ?? "")?.space.name).toBe("Switchboard");
    expect(command.links.find((link) => !link.device.product?.isRailMounted)?.sends).toBe(true);
    expect(command.comObjectSizes).toEqual(new Set([1]));
  });

  it("erkennt, ob eine GA Lesetelegramme beantwortet", () => {
    expect(node(demo, "0/0/4").readable).toBe(true);
    expect(node(demo, "0/0/3").readable).toBe(false);
    expect(node(demo, "0/0/10").readable).toBeUndefined();
    expect(node(demo, "0/0/3").diagnostics.map((entry) => entry.code)).toContain("ga.not-readable");
  });

  it("meldet unverknuepfte GAs nur, wenn das Projekt Geraete hat", async () => {
    expect(node(demo, "0/0/10").diagnostics.map((entry) => entry.code)).toContain("ga.unlinked");
    const style = buildGraph(await loadKnxProject(readFixture("oeffentlich/style3.knxproj")));
    expect(style.diagnostics.filter((entry) => entry.code === "ga.unlinked")).toEqual([]);
  });

  it("leitet die Richtung aus der Verdrahtung ab", () => {
    const value = (text: string) => directionEvidence(node(demo, text), demo).find((entry) => entry.source === "ets-wiring")?.value;
    expect(value("0/0/1")).toBe("command");
    expect(value("0/0/2")).toBe("status");
    // Raumtemperatur: Der Taster misst, der Heizungsaktor verwertet nur.
    expect(value("0/0/14")).toBe("status");
    // Anzeigeobjekt eines Tasters ohne Aktor auf der GA: der Objekttext entscheidet.
    expect(value("0/0/12")).toBe("status");
    expect(value("0/0/16")).toBe("status");
    expect(value("0/0/17")).toBe("command");
    expect(value("0/0/10")).toBeUndefined();
  });

  describe("Objekttexte ohne Aktor auf der GA", () => {
    // Taster aus 0/0/3 als Vorlage fuer Geraete, die kein Aktor sind.
    const panel = (): GaLink => {
      const link = node(demo, "0/0/3").links.find((entry) => !entry.device.product?.isRailMounted);
      if (!link) throw new Error("Taster fehlt");
      return link;
    };
    const object = (text: string, sends: boolean, receives: boolean): GaLink => ({
      ...panel(),
      sends,
      receives,
      answersRead: false,
      flagsKnown: true,
      comObject: { ...panel().comObject, text, functionText: undefined, textDe: undefined, functionTextDe: undefined },
    });
    const wiring = (...links: GaLink[]) => directionEvidence({ ...node(demo, "0/0/3"), functions: [], links }, demo).find((entry) => entry.source === "ets-wiring");

    it("liest einen Eingangskanal als Sensor, auch mit Schreib-Flag", () => {
      expect(wiring(object("Voltage, Input A", true, true))?.value).toBe("status");
      expect(wiring(object("Eingang 3", true, true))?.value).toBe("status");
    });

    it("sieht im Eingang eines empfangenden Geraets ein Befehlsziel", () => {
      expect(wiring(object("Operating mode input", false, true), object("Measured temperature", true, false))?.value).toBe("status");
      expect(wiring(object("Operating mode input", false, true), object("Switching", true, false))?.value).toBe("command");
    });

    it("liest einen Automatik-Eingang am Aktor als verwerteten Zustand", () => {
      const rail = node(demo, "0/0/3").links.find((entry) => entry.device.product?.isRailMounted);
      if (!rail) throw new Error("Aktor fehlt");
      const input = { ...rail, sends: false, receives: true, answersRead: false, flagsKnown: true, comObject: { ...rail.comObject, text: "Output A", functionText: "Presence", textDe: undefined, functionTextDe: undefined } };
      const evidence = wiring(input, object("P4: movement (master)", true, false));
      expect(evidence?.value).toBe("status");
      expect(evidence?.detail).toMatch(/verwertet den Zustand/);
      // Ohne Sender bleibt es offen: Der Aktor allein sagt nicht, woher der Wert kommt.
      expect(wiring(input)?.value).toBeUndefined();
    });

    it("kennzeichnet Ersatzregeln als schwach", () => {
      expect(wiring(object("Status byte", false, true))).toMatchObject({ value: "command", weak: true });
      expect(wiring(object("Voltage, Input A", true, true))?.weak).toBeUndefined();
    });

    it("haelt die Beschriftung Ausgang/Eingang nicht fuer einen Eingang", () => {
      // Ein Messwert an einem Objekt "Output/Input" ist kein Sensor, dessen Wert ein Aktor verwertet.
      const evidence = wiring(object("Output/Input", true, true), object("Measured temperature", true, false));
      expect(evidence?.detail ?? "").not.toMatch(/Aktor verwertet/);
    });
  });

  it("meldet, wo ETS-Funktionsrolle und Verdrahtung sich widersprechen", () => {
    const conflicts = directionConflicts(demo).map((entry) => entry.refs.groupAddress);
    expect(conflicts.sort()).toEqual(["P-045C-0_GA-6", "P-045C-0_GA-7"]);
  });
});

describe("Benchmark", () => {
  it("normalisiert Namen fuer den Vergleich", () => {
    expect(normalizeText("Büro/ Flur")).toBe("buero flur");
    expect(normalizeText("Küche")).toBe("kueche");
  });

  it("liest die ETS-Angaben verlustfrei (Gold-Standards aus ETS-Funktionen)", async () => {
    const style = buildGraph(await loadKnxProject(readFixture("oeffentlich/style3.knxproj")));
    const result = score(style, gold("oeffentlich/style.gold.json"), BASELINE_PREDICTORS[0]!);
    for (const dimension of ["room", "function", "direction", "dpt"] as const) {
      expect(accuracy(result.dimensions[dimension])).toBe(1);
    }
  });

  it("trifft am korrigierten Demoprojekt jede Richtung, die ETS-Rolle allein verfehlt zwei", () => {
    const corrected = gold("oeffentlich/demoprojekt.gold.json");
    expect(score(demo, corrected, BASELINE_PREDICTORS[1]!).errors).toEqual([]);
    const roleOnly = score(demo, corrected, BASELINE_PREDICTORS[0]!);
    expect(roleOnly.errors.map((error) => error.address)).toEqual(["0/0/6", "0/0/7"]);
  });

  it.skipIf(!hasFixture("privat/musterprojekt-ets6.knxproj"))("haelt die explizite Basislinie am Musterprojekt fest", async () => {
    const graph = buildGraph(await loadKnxProject(readFixture("privat/musterprojekt-ets6.knxproj")));
    const result = score(graph, gold("privat/musterprojekt-ets6.gold.json"), BASELINE_PREDICTORS[1]!);
    expect(result.dimensions.dpt.correct).toBe(31);
    expect(result.dimensions.dpt.wrong).toBe(0);
    expect(result.dimensions.room.correct).toBe(0);
  });
});
