import { beforeAll, describe, expect, it } from "vitest";
import { type LoadedProject, loadKnxProject } from "../src/ets/load.ts";
import { fillTextTemplate, objectSizeBits, type ResolvedComObject } from "../src/ets/resolve.ts";
import { hasFixture, readFixture } from "./helpers.ts";

let demo: LoadedProject;

beforeAll(async () => {
  demo = await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj"));
});

function comObject(deviceId: string, refId: string): ResolvedComObject {
  const found = demo.devices.find((entry) => entry.device.id === deviceId)?.comObjects.find((co) => co.refId === refId);
  if (!found) throw new Error(`${deviceId} ${refId} fehlt`);
  return found;
}

describe("Hilfsfunktionen", () => {
  it("liest Objektgroessen", () => {
    expect(objectSizeBits("1 Bit")).toBe(1);
    expect(objectSizeBits("4 Bit")).toBe(4);
    expect(objectSizeBits("2 Bytes")).toBe(16);
    expect(objectSizeBits("14 Bytes")).toBe(112);
    expect(objectSizeBits("Legacy")).toBeUndefined();
  });

  it("fuellt Textvorlagen mit Parameterwert oder Vorgabe", () => {
    expect(fillTextTemplate("A: {{0:Channel A}}", "Decke Kueche")).toBe("A: Decke Kueche");
    expect(fillTextTemplate("A: {{0:Channel A}}", "")).toBe("A: Channel A");
    expect(fillTextTemplate("{{0}}", undefined)).toBe("");
  });
});

describe("Stammdaten", () => {
  it("liest DPTs mit Feldern, Einheiten, Bereichen und deutschen Texten", () => {
    const temperature = demo.master.dpts.get("DPST-9-1");
    expect(temperature?.sizeInBit).toBe(16);
    expect(temperature?.textDe).toBe("Temperatur (°C)");
    expect(temperature?.fields[0]).toMatchObject({ kind: "float", unit: "°C", min: -273 });

    const dimming = demo.master.dpts.get("DPST-3-7");
    expect(dimming?.fields.map((field) => field.kind)).toEqual(["bit", "unsigned"]);
    expect(dimming?.fields[0]).toMatchObject({ cleared: "Decrease", set: "Increase" });

    const hvac = demo.master.dpts.get("DPST-20-102")?.fields[0];
    expect(hvac?.kind === "enum" && hvac.values.map((value) => value.value)).toEqual([0, 1, 2, 3, 4]);
    expect(demo.master.dpts.get("DPT-9")?.fields).toEqual([]);
  });

  it("liest die normativen Funktionstypen der KNX mit Rollen", () => {
    const dimmable = demo.master.functionTypes.get("FT-6");
    expect(dimmable?.deprecated).toBe(false);
    expect(dimmable?.points.map((point) => [point.role, point.dpt])).toEqual([
      ["SwitchOnOff", "DPST-1-1"],
      ["DimmingControl", "DPST-3-7"],
      ["DimmingValue", "DPST-5-1"],
      ["InfoOnOff", "DPST-1-1"],
      ["InfoDimmingValue", "DPST-5-1"],
    ]);
    expect(demo.master.functionTypes.get("FT-2")?.deprecated).toBe(true);
    expect(demo.master.spaceUsages.get("SU-1")?.text).toBe("Kitchen");
  });
});

describe("Herstellerdaten und KO-Aufloesung", () => {
  it("loest Objektgroesse, Flags, Texte und DPT eines Aktorkanals auf", () => {
    const switching = comObject("P-045C-0_DI-1", "O-0_R-24");
    expect(switching.resolved).toBe(true);
    expect(switching.objectSizeBits).toBe(1);
    expect(switching.functionText).toBe("Switch");
    expect(switching.functionTextDe).toBe("Schalten");
    expect(switching.flags).toMatchObject({ communication: true, write: true, transmit: false, read: false });
    expect(switching.flagsComplete).toBe(true);

    const status = comObject("P-045C-0_DI-1", "O-6_R-18");
    expect(status.flags).toMatchObject({ read: true, transmit: true, write: false });
    expect(status.dpts).toEqual(["DPST-1-11"]);
    expect(comObject("P-045C-0_DI-1", "O-4_R-16").objectSizeBits).toBe(4);
  });

  it("ordnet alle Objekte eines Aktorausgangs demselben Kanal zu, andere Ausgaenge nicht", () => {
    const channelA = ["O-0_R-24", "O-6_R-18", "O-7_R-19", "O-4_R-16", "O-5_R-17"].map(
      (refId) => comObject("P-045C-0_DI-1", refId).channel?.key,
    );
    expect(new Set(channelA).size).toBe(1);
    expect(channelA[0]).toBeDefined();
    expect(comObject("P-045C-0_DI-1", "O-32_R-72").channel?.key).not.toBe(channelA[0]);
    expect(comObject("P-045C-0_DI-1", "O-0_R-24").channel?.label).toBe("Channel A");
  });

  it("nutzt die ChannelId des Projekts als staerkste Kanalquelle", () => {
    const temperature = comObject("P-045C-0_DI-4", "O-108_R-1932");
    expect(temperature.channel?.source).toBe("ets-channel");
    expect(temperature.channel?.label).toBe("Temperature measurement");
  });

  it("kennt Produkte samt Hutschienenmontage", () => {
    const actuator = demo.devices.find((entry) => entry.device.id === "P-045C-0_DI-1");
    expect(actuator?.product?.isRailMounted).toBe(true);
    expect(actuator?.product?.textDe).toContain("Dimmaktor");
    expect(demo.devices.find((entry) => entry.device.id === "P-045C-0_DI-4")?.product?.isRailMounted).toBe(false);
  });

  it("liest nur benutzte Applikationen und meldet keine unaufgeloesten Objekte", () => {
    expect(demo.manufacturer.applications.size).toBe(5);
    expect(demo.diagnostics.filter((entry) => entry.code.startsWith("manufacturer."))).toEqual([]);
  });

  it.skipIf(!hasFixture("privat/musterprojekt-ets6.knxproj"))(
    "meldet fehlende Herstellerdaten als Hinweis statt Fehler (privates Musterprojekt)",
    async () => {
      const muster = await loadKnxProject(readFixture("privat/musterprojekt-ets6.knxproj"));
      expect(muster.manufacturer.applications.size).toBe(0);
      const unresolved = muster.diagnostics.filter((entry) => entry.code === "manufacturer.unresolved-device");
      expect(unresolved.length).toBeGreaterThan(0);
      expect(unresolved.every((entry) => entry.severity === "info")).toBe(true);
      const withChannel = muster.devices.flatMap((device) => device.comObjects).filter((co) => co.channel?.source === "ets-channel");
      expect(withChannel.length).toBeGreaterThan(0);
    },
  );
});
