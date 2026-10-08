import { dptDotted, dptMainNumber } from "../ets/dpt-id.ts";
import type { DptField, MasterData } from "../ets/master-data.ts";
import { camelKey, compact, type Json, type JsonObject } from "./json.ts";
import { qudtUnit } from "./units.ts";

/**
 * Datenschema einer TD aus dem Datenpunkttyp. Grundlage sind die Felder aus
 * knx_master.xml (Breite, Koeffizient, Grenzen, Einheit, Aufzaehlung); fuer
 * Haupttypen ohne Felder gilt der Wertebereich der Kodierung. Die Werte im
 * Schema sind Anwendungswerte (5.001 als 0 bis 100 Prozent), keine Rohwerte.
 */

/** Feldnamen, die knx_master.xml nicht vergibt. */
const UNNAMED_FIELDS: Readonly<Record<number, readonly (string | undefined)[]>> = {
  2: ["control", "value"],
  3: ["control", "stepCode"],
  18: ["learn", "sceneNumber"],
};

/** Wertebereich der Kodierung je Haupttyp, wenn Felder fehlen. */
const MAIN_FALLBACK: Readonly<Record<number, JsonObject>> = {
  1: { type: "boolean" },
  2: {
    type: "object",
    properties: { control: { type: "boolean" }, value: { type: "boolean" } },
    required: ["control", "value"],
  },
  3: {
    type: "object",
    properties: { control: { type: "boolean" }, stepCode: { type: "integer", minimum: 0, maximum: 7 } },
    required: ["control", "stepCode"],
  },
  4: { type: "string", maxLength: 1 },
  5: { type: "integer", minimum: 0, maximum: 255 },
  6: { type: "integer", minimum: -128, maximum: 127 },
  7: { type: "integer", minimum: 0, maximum: 65535 },
  8: { type: "integer", minimum: -32768, maximum: 32767 },
  9: { type: "number", minimum: -671088.64, maximum: 670760.96 },
  12: { type: "integer", minimum: 0, maximum: 4294967295 },
  13: { type: "integer", minimum: -2147483648, maximum: 2147483647 },
  14: { type: "number" },
  16: { type: "string", maxLength: 14 },
  17: { type: "integer", minimum: 0, maximum: 63 },
  20: { type: "integer", minimum: 0, maximum: 255 },
};

const FLOAT16_RANGE = { minimum: -671088.64, maximum: 670760.96 };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function fieldSchema(field: Exclude<DptField, { kind: "reserved" }>): JsonObject {
  switch (field.kind) {
    case "bit":
      return {
        type: "boolean",
        oneOf: [
          { const: false, title: field.cleared },
          { const: true, title: field.set },
        ],
      };
    case "unsigned":
    case "signed": {
      const rawMin = field.kind === "unsigned" ? 0 : -(2 ** (field.width - 1));
      const rawMax = field.kind === "unsigned" ? 2 ** field.width - 1 : 2 ** (field.width - 1) - 1;
      const coefficient = field.coefficient ?? 1;
      const scaled = coefficient !== 1;
      const minimum = field.min ?? round(rawMin * coefficient);
      const maximum = field.max ?? round(rawMax * coefficient);
      const integral = !scaled || (Number.isInteger(coefficient) && Number.isInteger(minimum) && Number.isInteger(maximum));
      return compact({ type: integral ? "integer" : "number", minimum, maximum, unit: qudtUnit(field.unit) });
    }
    case "float": {
      const half = field.width === 16;
      return compact({
        type: "number",
        minimum: field.min ?? (half ? FLOAT16_RANGE.minimum : undefined),
        maximum: field.max ?? (half ? FLOAT16_RANGE.maximum : undefined),
        unit: qudtUnit(field.unit),
      });
    }
    case "enum":
      return { type: "integer", oneOf: field.values.map((entry) => ({ const: entry.value, title: entry.text })) };
    case "string":
      return { type: "string", maxLength: Math.floor(field.width / 8) };
  }
}

function fieldName(field: Exclude<DptField, { kind: "reserved" }>, index: number, main: number | undefined): string {
  const preset = main === undefined ? undefined : UNNAMED_FIELDS[main]?.[index];
  if (field.name !== undefined && field.name.trim() !== "") return camelKey(field.name);
  if (preset !== undefined) return preset;
  // Datumsfelder tragen ihren Namen im Einheitentext ("Day of month").
  if ((field.kind === "unsigned" || field.kind === "signed") && field.unit && /^[A-Za-z ]+$/.test(field.unit)) return camelKey(field.unit);
  return `field${index + 1}`;
}

/** Schema fuer einen DPT wie "DPST-9-1"; undefined, wenn weder Stammdaten noch Haupttyp etwas hergeben. */
export function dptSchema(dpt: string | undefined, master: MasterData): JsonObject | undefined {
  if (dpt === undefined) return undefined;
  const main = dptMainNumber(dpt);
  const fields = (master.dpts.get(dpt)?.fields ?? []).filter((field): field is Exclude<DptField, { kind: "reserved" }> => field.kind !== "reserved");
  if (fields.length === 0) return main === undefined ? undefined : MAIN_FALLBACK[main];
  if (fields.length === 1 && fields[0]) return fieldSchema(fields[0]);

  const properties: Record<string, Json> = {};
  fields.forEach((field, index) => {
    let name = fieldName(field, index, main);
    while (name in properties) name = `${name}${index + 1}`;
    properties[name] = fieldSchema(field);
  });
  return { type: "object", properties, required: Object.keys(properties) };
}

/** "9.001" fuer die Form-Annotation; Haupttypen als "9". */
export function dptAnnotation(dpt: string | undefined): string | undefined {
  return dpt === undefined ? undefined : dptDotted(dpt);
}
