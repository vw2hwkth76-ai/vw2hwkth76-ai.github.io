import { beforeAll, describe, expect, it } from "vitest";
import { loadKnxProject } from "../src/ets/load.ts";
import type { MasterData } from "../src/ets/master-data.ts";
import { dptSchema } from "../src/td/dpt-schema.ts";
import { camelKey } from "../src/td/json.ts";
import { qudtUnit } from "../src/td/units.ts";
import { readFixture } from "./helpers.ts";

let master: MasterData;

beforeAll(async () => {
  master = (await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj"))).master;
});

describe("Datenschema aus dem DPT", () => {
  it("bildet Schalten als boolean mit benannten Zustaenden ab", () => {
    expect(dptSchema("DPST-1-1", master)).toEqual({
      type: "boolean",
      oneOf: [
        { const: false, title: "Off" },
        { const: true, title: "On" },
      ],
    });
  });

  it("rechnet Koeffizienten in Anwendungswerte um", () => {
    expect(dptSchema("DPST-5-1", master)).toEqual({ type: "number", minimum: 0, maximum: 100, unit: "unit:PERCENT" });
    expect(dptSchema("DPST-7-3", master)).toEqual({ type: "integer", minimum: 0, maximum: 655350, unit: "unit:MilliSEC" });
  });

  it("uebernimmt Grenzen und Einheit der Gleitkommawerte", () => {
    expect(dptSchema("DPST-9-1", master)).toEqual({ type: "number", minimum: -273, maximum: 670760, unit: "unit:DEG_C" });
    expect(dptSchema("DPST-14-56", master)).toEqual({ type: "number", unit: "unit:W" });
  });

  it("macht Aufzaehlungen zu oneOf mit Titeln", () => {
    const schema = dptSchema("DPST-20-102", master);
    expect(schema?.["type"]).toBe("integer");
    expect(schema?.["oneOf"]).toContainEqual({ const: 1, title: "Comfort" });
  });

  it("macht mehrteilige DPTs zu Objekten mit sprechenden Feldnamen", () => {
    expect(dptSchema("DPST-3-7", master)).toEqual({
      type: "object",
      properties: {
        control: { type: "boolean", oneOf: [{ const: false, title: "Decrease" }, { const: true, title: "Increase" }] },
        stepCode: { type: "integer", minimum: 0, maximum: 7 },
      },
      required: ["control", "stepCode"],
    });
    expect(Object.keys((dptSchema("DPST-232-600", master)?.["properties"] ?? {}) as object)).toEqual(["r", "g", "b"]);
    expect(Object.keys((dptSchema("DPST-11-1", master)?.["properties"] ?? {}) as object)).toEqual(["dayOfMonth", "month", "year"]);
    expect(dptSchema("DPST-17-1", master)).toEqual({ type: "integer", minimum: 0, maximum: 63 });
  });

  it("faellt bei Haupttypen auf den Wertebereich der Kodierung zurueck", () => {
    expect(dptSchema("DPT-1", master)).toEqual({ type: "boolean" });
    expect(dptSchema("DPT-9", master)).toEqual({ type: "number", minimum: -671088.64, maximum: 670760.96 });
    expect(dptSchema(undefined, master)).toBeUndefined();
  });

  it("liefert fuer jeden DPT der Stammdaten ein gueltiges Schema oder nichts", () => {
    for (const id of master.dpts.keys()) {
      const schema = dptSchema(id, master);
      if (schema === undefined) continue;
      expect(["boolean", "integer", "number", "string", "object"]).toContain(schema["type"]);
      expect(() => JSON.stringify(schema)).not.toThrow();
    }
  });
});

describe("Einheiten", () => {
  it("nennt QUDT nur, wenn die Einheit dort existiert", () => {
    expect(qudtUnit("°C")).toBe("unit:DEG_C");
    expect(qudtUnit("kWh")).toBe("unit:KiloW-HR");
    expect(qudtUnit("l/m²")).toBeUndefined();
    expect(qudtUnit("fan stage")).toBeUndefined();
    expect(qudtUnit(undefined)).toBeUndefined();
  });
});

describe("Schluessel", () => {
  it("bildet camelCase aus Feld- und Rollennamen", () => {
    expect(camelKey("Scene number")).toBe("sceneNumber");
    expect(camelKey("HVACMode")).toBe("hvacMode");
    expect(camelKey("Day of month")).toBe("dayOfMonth");
    expect(camelKey("Größe")).toBe("grosse");
    expect(camelKey("1. Stufe")).toBe("x1Stufe");
  });
});

describe("Stabile IDs", () => {
  it("erzeugt UUID v5 nach RFC 9562", async () => {
    const { uuidV5 } = await import("../src/td/ids.ts");
    // Referenzwert aus RFC 9562, Anhang A.4: DNS-Namensraum, "www.example.com".
    expect(await uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(await uuidV5("projekt|fn:F-1")).toBe(await uuidV5("projekt|fn:F-1"));
    expect(await uuidV5("projekt|fn:F-1")).not.toBe(await uuidV5("projekt|fn:F-2"));
  });
});
