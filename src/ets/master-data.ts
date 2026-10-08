import type { EtsArchive } from "../archive/ets-archive.ts";
import { type Attributes, parseXml } from "../xml/sax.ts";
import { normalizeDpt } from "./dpt-id.ts";

export type DptField =
  | { readonly kind: "bit"; readonly name: string | undefined; readonly cleared: string; readonly set: string }
  | {
      readonly kind: "unsigned" | "signed";
      readonly name: string | undefined;
      readonly width: number;
      readonly unit: string | undefined;
      readonly coefficient: number | undefined;
      readonly min: number | undefined;
      readonly max: number | undefined;
    }
  | {
      readonly kind: "float";
      readonly name: string | undefined;
      readonly width: number;
      readonly unit: string | undefined;
      readonly min: number | undefined;
      readonly max: number | undefined;
    }
  | {
      readonly kind: "enum";
      readonly name: string | undefined;
      readonly width: number;
      readonly values: readonly { readonly value: number; readonly text: string }[];
    }
  | { readonly kind: "string"; readonly name: string | undefined; readonly width: number; readonly encoding: string }
  | { readonly kind: "reserved"; readonly width: number };

export interface DptDefinition {
  /** "DPST-9-1" oder "DPT-9". */
  readonly id: string;
  readonly mainId: string;
  /** Technischer Name, z. B. "DPT_Value_Temp". */
  readonly name: string;
  readonly text: string;
  readonly textDe: string | undefined;
  readonly sizeInBit: number;
  /** Felder in Uebertragungsreihenfolge; bei Haupttypen leer. */
  readonly fields: readonly DptField[];
}

export interface FunctionPoint {
  readonly id: string;
  readonly text: string;
  readonly dpt: string | undefined;
  /** Rollenname, z. B. "SwitchOnOff". */
  readonly role: string;
  /** "central" (Befehl, auch zentral nutzbar), "shared" (von mehreren Funktionen genutzt) oder leer. */
  readonly characteristics: string | undefined;
}

export interface FunctionType {
  readonly id: string;
  readonly text: string;
  readonly textDe: string | undefined;
  readonly deprecated: boolean;
  readonly points: readonly FunctionPoint[];
}

export interface SpaceUsage {
  readonly id: string;
  readonly text: string;
  readonly textDe: string | undefined;
}

export interface MasterData {
  readonly schemaVersion: number | undefined;
  readonly dpts: ReadonlyMap<string, DptDefinition>;
  readonly functionTypes: ReadonlyMap<string, FunctionType>;
  readonly spaceUsages: ReadonlyMap<string, SpaceUsage>;
  /** "DR-1" auf "SwitchOnOff". */
  readonly datapointRoles: ReadonlyMap<string, string>;
}

export const EMPTY_MASTER_DATA: MasterData = {
  schemaVersion: undefined,
  dpts: new Map(),
  functionTypes: new Map(),
  spaceUsages: new Map(),
  datapointRoles: new Map(),
};

const FIELD_ELEMENTS = new Set(["Bit", "UnsignedInteger", "SignedInteger", "Float", "Enumeration", "String", "Reserved", "RefType"]);
const TRANSLATION_LANGUAGE = /^de(-|$)/i;

type RawField = DptField | { readonly kind: "ref"; readonly refId: string };

interface RawDpt {
  id: string;
  mainId: string;
  name: string;
  text: string;
  sizeInBit: number;
  fields: RawField[];
}

export async function readMasterData(archive: EtsArchive): Promise<MasterData> {
  if (!archive.hasMasterXml) return { ...EMPTY_MASTER_DATA, schemaVersion: archive.schemaVersion };
  return parseMasterData(await archive.readMasterXml(), archive.schemaVersion);
}

export function parseMasterData(data: Uint8Array, schemaVersion: number | undefined): MasterData {
  const raw: RawDpt[] = [];
  const fieldsById = new Map<string, RawField>();
  const functionTypes: { id: string; text: string; deprecated: boolean; points: FunctionPoint[] }[] = [];
  const spaceUsages: { id: string; text: string }[] = [];
  const roles = new Map<string, string>();
  const translations = new Map<string, string>();

  let mainType: { id: string; sizeInBit: number } | undefined;
  let subtype: RawDpt | undefined;
  let inFormat = false;
  let enumeration: { name: string | undefined; width: number; values: { value: number; text: string }[]; id: string | undefined } | undefined;
  let functionType: (typeof functionTypes)[number] | undefined;
  let language: string | undefined;
  let translationRef: string | undefined;

  parseXml(
    data,
    {
      open(name, a) {
        switch (name) {
          case "DatapointType": {
            const id = a["Id"] ?? "";
            mainType = { id, sizeInBit: Number(a["SizeInBit"] ?? 0) };
            raw.push({ id, mainId: id, name: a["Name"] ?? "", text: a["Text"] ?? "", sizeInBit: mainType.sizeInBit, fields: [] });
            return;
          }
          case "DatapointSubtype":
            if (!mainType) return;
            subtype = {
              id: a["Id"] ?? "",
              mainId: mainType.id,
              name: a["Name"] ?? "",
              text: a["Text"] ?? "",
              sizeInBit: mainType.sizeInBit,
              fields: [],
            };
            raw.push(subtype);
            return;
          case "Format":
            inFormat = subtype !== undefined;
            return;
          case "EnumValue":
            enumeration?.values.push({ value: Number(a["Value"] ?? 0), text: a["Text"] ?? "" });
            return;
          case "FunctionType":
            functionType = { id: a["Id"] ?? "", text: a["Text"] ?? "", deprecated: a["Status"] === "deprecated", points: [] };
            functionTypes.push(functionType);
            return;
          case "FunctionPoint":
            functionType?.points.push({
              id: a["Id"] ?? "",
              text: a["Text"] ?? "",
              dpt: normalizeDpt(a["DatapointType"] ?? ""),
              role: a["Role"] ?? "",
              characteristics: a["Characteristics"],
            });
            return;
          case "SpaceUsage":
            spaceUsages.push({ id: a["Id"] ?? "", text: a["Text"] ?? "" });
            return;
          case "DatapointRole":
            if (a["Id"] !== undefined) roles.set(a["Id"], a["Name"] ?? "");
            return;
          case "Language":
            language = a["Identifier"];
            return;
          case "TranslationElement":
            translationRef = language !== undefined && TRANSLATION_LANGUAGE.test(language) ? a["RefId"] : undefined;
            return;
          case "Translation":
            if (translationRef !== undefined && a["AttributeName"] === "Text" && a["Text"] !== undefined) {
              if (!translations.has(translationRef) || language === "de-DE") translations.set(translationRef, a["Text"]);
            }
            return;
          default:
            if (inFormat && subtype && FIELD_ELEMENTS.has(name)) {
              const field = readField(name, a);
              if (field.kind === "enum") {
                enumeration = { name: field.name, width: field.width, values: [], id: a["Id"] };
              } else {
                subtype.fields.push(field);
                if (a["Id"] !== undefined) fieldsById.set(a["Id"], field);
              }
            }
        }
      },
      close(name) {
        switch (name) {
          case "DatapointType":
            mainType = undefined;
            return;
          case "DatapointSubtype":
            subtype = undefined;
            return;
          case "Format":
            inFormat = false;
            return;
          case "Enumeration":
            if (enumeration && subtype) {
              const field: DptField = { kind: "enum", name: enumeration.name, width: enumeration.width, values: enumeration.values };
              subtype.fields.push(field);
              if (enumeration.id !== undefined) fieldsById.set(enumeration.id, field);
            }
            enumeration = undefined;
            return;
          case "FunctionType":
            functionType = undefined;
            return;
          case "Language":
            language = undefined;
            return;
          default:
            return;
        }
      },
    },
    "knx_master.xml",
  );

  const resolve = (field: RawField, depth = 0): DptField | undefined => {
    if (field.kind !== "ref") return field;
    const target = fieldsById.get(field.refId);
    return target === undefined || depth > 4 ? undefined : resolve(target, depth + 1);
  };

  const dpts = new Map<string, DptDefinition>();
  for (const dpt of raw) {
    dpts.set(dpt.id, {
      id: dpt.id,
      mainId: dpt.mainId,
      name: dpt.name,
      text: dpt.text,
      textDe: translations.get(dpt.id),
      sizeInBit: dpt.sizeInBit,
      fields: dpt.fields.map((field) => resolve(field)).filter((field) => field !== undefined),
    });
  }

  return {
    schemaVersion,
    dpts,
    functionTypes: new Map(
      functionTypes.map((type) => [
        type.id,
        { ...type, textDe: translations.get(type.id), points: type.points.map((point) => ({ ...point, role: roles.get(point.role) ?? point.role })) },
      ]),
    ),
    spaceUsages: new Map(spaceUsages.map((usage) => [usage.id, { ...usage, textDe: translations.get(usage.id) }])),
    datapointRoles: roles,
  };
}

function readField(element: string, a: Attributes): RawField {
  const name = a["Name"];
  const width = Number(a["Width"] ?? 0);
  switch (element) {
    case "Bit":
      return { kind: "bit", name, cleared: a["Cleared"] ?? "0", set: a["Set"] ?? "1" };
    case "UnsignedInteger":
    case "SignedInteger":
      return {
        kind: element === "UnsignedInteger" ? "unsigned" : "signed",
        name,
        width,
        unit: a["Unit"],
        coefficient: optionalNumber(a["Coefficient"]),
        min: optionalNumber(a["MinInclusive"] ?? a["MinValue"]),
        max: optionalNumber(a["MaxInclusive"] ?? a["MaxValue"]),
      };
    case "Float":
      return {
        kind: "float",
        name,
        width,
        unit: a["Unit"],
        min: optionalNumber(a["MinInclusive"] ?? a["MinValue"]),
        max: optionalNumber(a["MaxInclusive"] ?? a["MaxValue"]),
      };
    case "Enumeration":
      return { kind: "enum", name, width, values: [] };
    case "String":
      return { kind: "string", name, width, encoding: a["Encoding"] ?? "" };
    case "RefType":
      return { kind: "ref", refId: a["RefId"] ?? "" };
    default:
      return { kind: "reserved", width };
  }
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
