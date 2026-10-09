import { describe, expect, it } from "vitest";
import { type ObjectInfo, objectDpt } from "../src/recognize/object-dpt.ts";

const sensor = (text: string): ObjectInfo => ({ text, label: text, actuator: false });
const actuator = (text: string): ObjectInfo => ({ text, label: text, actuator: true });
const value = (bits: number, objects: readonly ObjectInfo[], hints: readonly string[] = []): string | undefined =>
  objectDpt(new Set([bits]), objects, hints)?.value;

describe("DPT aus Objektgroesse und Objekttext", () => {
  it("liest den Untertyp aus dem Objekttext, passend zur Groesse", () => {
    expect(value(1, [actuator("output presence / switching")])).toBe("DPST-1-18");
    expect(value(1, [sensor("failure of actuating value / signal failure")])).toBe("DPST-1-5");
    expect(value(1, [actuator("outputs light a,b / disable / enable")])).toBe("DPST-1-3");
    expect(value(8, [actuator("dimming value status / 8-bit value")])).toBe("DPST-5-1");
    expect(value(16, [sensor("wind speed / physical value")])).toBe("DPST-9-5");
    expect(value(32, [sensor("input a / telegr. counter value 4 bytes")])).toBe("DPST-12-1");
    expect(value(112, [sensor("text indication / display alarm indication")])).toBe("DPST-16-0");
  });

  it("wendet einen Text nie gegen die Groesse an", () => {
    // "error" bei 1 Byte ist kein Alarm-Bit, sondern ein Fehlerstatus-Byte.
    expect(value(8, [actuator("ecg error status / lamp/ecg error")])).toBe("DPT-5");
    expect(value(16, [sensor("output light a / switching")])).toBeUndefined();
  });

  it("nutzt EIS-Bezeichnungen alter Herstellerdaten", () => {
    expect(value(24, [sensor("time / time, eis 3")])).toBe("DPST-10-1");
    expect(value(16, [sensor("value / eis 5")])).toBe("DPT-9");
  });

  it("laesst Aktorobjekte vor Tastern entscheiden", () => {
    const objects = [sensor("trigger object / presence block"), actuator("output a / switch"), actuator("switching, lab1 / on / off")];
    expect(value(1, objects)).toBe("DPST-1-1");
  });

  it("nimmt bei allgemeinem Objekttext den Untertyp aus dem Namen", () => {
    // Ein Binaereingang "schaltet" auch, wenn er eine Stoerung meldet.
    expect(value(1, [sensor("channel b, switch sensor / switch")], ["DPST-1-5"])).toBe("DPST-1-5");
    expect(value(1, [sensor("channel b, switch sensor / switch")])).toBe("DPST-1-1");
  });

  it("schliesst aus der Groesse allein nur auf eindeutige Haupttypen", () => {
    expect(value(1, [sensor("1 bit (3) / 1 bit")])).toBe("DPT-1");
    expect(value(1, [sensor("1 bit (3) / 1 bit")], ["DPST-1-19"])).toBe("DPST-1-19");
    expect(value(4, [])).toBe("DPT-3");
    expect(value(16, [sensor("2 byte (1) / 2 byte")])).toBeUndefined();
    expect(objectDpt(new Set([8]), [sensor("1 byte (2) / 1 byte")], [])?.confidence).toBeLessThan(0.6);
    // Unterschiedliche Groessen an einer GA: kein Schluss.
    expect(objectDpt(new Set([1, 8]), [sensor("switching")], [])).toBeUndefined();
  });
});
