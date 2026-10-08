import type { EtsArchive } from "../archive/ets-archive.ts";
import { type Diagnostic, diagnostic } from "../diagnostics.ts";
import { type Attributes, parseXml } from "../xml/sax.ts";
import { parseDptList } from "./dpt-id.ts";
import type { ComObjectFlag, FlagSet } from "./model.ts";

export interface Product {
  readonly id: string;
  readonly text: string;
  readonly textDe: string | undefined;
  readonly orderNumber: string;
  readonly isRailMounted: boolean | undefined;
  readonly hardwareName: string;
}

export interface ManufacturerComObject {
  readonly id: string;
  readonly number: number | undefined;
  readonly name: string | undefined;
  readonly text: string | undefined;
  readonly functionText: string | undefined;
  readonly objectSize: string | undefined;
  readonly dpts: readonly string[];
  readonly flags: FlagSet;
}

export interface ManufacturerComObjectRef {
  readonly id: string;
  readonly refId: string;
  readonly text: string | undefined;
  readonly functionText: string | undefined;
  readonly objectSize: string | undefined;
  readonly dpts: readonly string[];
  readonly flags: FlagSet;
  readonly textParameterRefId: string | undefined;
}

export interface ManufacturerChannel {
  readonly id: string;
  readonly name: string | undefined;
  readonly text: string | undefined;
  readonly number: string | undefined;
  readonly textParameterRefId: string | undefined;
}

export interface ApplicationProgram {
  readonly id: string;
  readonly name: string;
  readonly defaultLanguage: string | undefined;
  readonly comObjects: ReadonlyMap<string, ManufacturerComObject>;
  readonly comObjectRefs: ReadonlyMap<string, ManufacturerComObjectRef>;
  /** ParameterRef-Id auf Vorgabewert (aus Ref oder Parameter). */
  readonly parameterDefaults: ReadonlyMap<string, string>;
  readonly channels: ReadonlyMap<string, ManufacturerChannel>;
  /** ComObjectRef-Id auf Kanal-Id laut Dynamic-Bereich. */
  readonly channelOfRef: ReadonlyMap<string, string>;
  /** Deutsche Uebersetzungen: Element-Id auf Attributname auf Text. */
  readonly translations: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export interface ManufacturerData {
  readonly products: ReadonlyMap<string, Product>;
  /** Hardware2Program-Id auf Applikations-Ids. */
  readonly hardware2Programs: ReadonlyMap<string, readonly string[]>;
  readonly applications: ReadonlyMap<string, ApplicationProgram>;
  readonly diagnostics: readonly Diagnostic[];
}

const FLAG_ATTRIBUTES: Readonly<Record<string, ComObjectFlag>> = {
  CommunicationFlag: "communication",
  ReadFlag: "read",
  WriteFlag: "write",
  TransmitFlag: "transmit",
  UpdateFlag: "update",
  ReadOnInitFlag: "readOnInit",
};
const GERMAN = /^de(-|$)/i;

export function readFlags(a: Attributes): FlagSet {
  const flags: Partial<Record<ComObjectFlag, boolean>> = {};
  for (const [attribute, flag] of Object.entries(FLAG_ATTRIBUTES)) {
    const value = a[attribute];
    if (value !== undefined) flags[flag] = value === "Enabled";
  }
  return flags;
}

/**
 * Liest Hardware.xml aller Hersteller und die Applikationsprogramme der
 * angegebenen Hardware2Program-Ids. Nicht benutzte Applikationen bleiben
 * ungelesen, weil sie bis zu dreistellige Megabyte gross sein koennen.
 */
export async function readManufacturerData(
  archive: EtsArchive,
  usedHardware2ProgramIds: Iterable<string>,
): Promise<ManufacturerData> {
  const diagnostics: Diagnostic[] = [];
  const products = new Map<string, Product>();
  const hardware2Programs = new Map<string, string[]>();

  for (const file of archive.manufacturerXmls.filter((name) => /\/Hardware\.xml$/i.test(name))) {
    readHardware(await archive.readManufacturerFile(file), file, products, hardware2Programs);
  }

  const neededApps = new Set<string>();
  for (const id of usedHardware2ProgramIds) {
    for (const app of hardware2Programs.get(id) ?? []) neededApps.add(app);
  }

  const applications = new Map<string, ApplicationProgram>();
  for (const appId of [...neededApps].sort()) {
    const file = findApplicationFile(archive.manufacturerXmls, appId);
    if (file === undefined) {
      diagnostics.push(
        diagnostic("manufacturer.application-missing", "warning", `Applikationsprogramm ${appId} fehlt in den Herstellerdaten.`, {
          file: appId,
        }),
      );
      continue;
    }
    const app = readApplication(await archive.readManufacturerFile(file), file, appId);
    if (app === undefined) {
      diagnostics.push(
        diagnostic("manufacturer.application-empty", "warning", `${file} enthält das Applikationsprogramm ${appId} nicht.`, { file }),
      );
      continue;
    }
    applications.set(appId, app);
  }
  return { products, hardware2Programs, applications, diagnostics };
}

function findApplicationFile(files: readonly string[], appId: string): string | undefined {
  const manufacturer = appId.slice(0, appId.indexOf("_"));
  const exact = `${manufacturer}/${appId}.xml`.toLowerCase();
  return files.find((name) => name.toLowerCase() === exact) ?? files.find((name) => name.includes(appId));
}

function readHardware(
  data: Uint8Array,
  file: string,
  products: Map<string, Product>,
  hardware2Programs: Map<string, string[]>,
): void {
  let hardwareName = "";
  let program: string[] | undefined;
  let language: string | undefined;
  let translationRef: string | undefined;
  const pending: Product[] = [];
  const productTranslations = new Map<string, string>();
  parseXml(
    data,
    {
      open(name, a) {
        switch (name) {
          case "Hardware":
            hardwareName = a["Name"] ?? "";
            return;
          case "Product": {
            const id = a["Id"];
            if (id === undefined) return;
            const rail = a["IsRailMounted"];
            pending.push({
              id,
              text: a["Text"] ?? "",
              textDe: undefined,
              orderNumber: a["OrderNumber"] ?? "",
              isRailMounted: rail === undefined ? undefined : rail === "true" || rail === "1",
              hardwareName,
            });
            return;
          }
          case "Hardware2Program": {
            const id = a["Id"];
            if (id === undefined) return;
            program = [];
            hardware2Programs.set(id, program);
            return;
          }
          case "ApplicationProgramRef":
            if (program && a["RefId"] !== undefined) program.push(a["RefId"]);
            return;
          case "Language":
            language = a["Identifier"];
            return;
          case "TranslationElement":
            translationRef = language !== undefined && GERMAN.test(language) ? a["RefId"] : undefined;
            return;
          case "Translation":
            if (translationRef !== undefined && a["AttributeName"] === "Text" && a["Text"] !== undefined) {
              productTranslations.set(translationRef, a["Text"]);
            }
            return;
          default:
            return;
        }
      },
      close(name) {
        if (name === "Hardware2Program") program = undefined;
      },
    },
    file,
  );
  for (const product of pending) {
    products.set(product.id, { ...product, textDe: productTranslations.get(product.id) });
  }
}

function readApplication(data: Uint8Array, file: string, appId: string): ApplicationProgram | undefined {
  let found: { name: string; defaultLanguage: string | undefined } | undefined;
  const comObjects = new Map<string, ManufacturerComObject>();
  const comObjectRefs = new Map<string, ManufacturerComObjectRef>();
  const parameterValues = new Map<string, string>();
  const parameterRefs = new Map<string, { refId: string; value: string | undefined }>();
  const channels = new Map<string, ManufacturerChannel>();
  const channelOfRef = new Map<string, string>();
  const translations = new Map<string, Map<string, string>>();
  const channelStack: string[] = [];
  let depth = 0;
  const channelDepths: number[] = [];
  let language: string | undefined;
  let translationRef: string | undefined;

  parseXml(
    data,
    {
      open(name, a) {
        depth++;
        switch (name) {
          case "ApplicationProgram":
            if (a["Id"] === appId) found = { name: a["Name"] ?? "", defaultLanguage: a["DefaultLanguage"] };
            return;
          case "ComObject": {
            const id = a["Id"];
            if (id === undefined) return;
            const number = a["Number"];
            comObjects.set(id, {
              id,
              number: number === undefined ? undefined : Number(number),
              name: a["Name"],
              text: a["Text"],
              functionText: a["FunctionText"],
              objectSize: a["ObjectSize"],
              dpts: parseDptList(a["DatapointType"]),
              flags: readFlags(a),
            });
            return;
          }
          case "ComObjectRef": {
            const id = a["Id"];
            const refId = a["RefId"];
            if (id === undefined || refId === undefined) return;
            comObjectRefs.set(id, {
              id,
              refId,
              text: a["Text"],
              functionText: a["FunctionText"],
              objectSize: a["ObjectSize"],
              dpts: parseDptList(a["DatapointType"]),
              flags: readFlags(a),
              textParameterRefId: a["TextParameterRefId"],
            });
            return;
          }
          case "Parameter":
            if (a["Id"] !== undefined && a["Value"] !== undefined) parameterValues.set(a["Id"], a["Value"]);
            return;
          case "ParameterRef":
            if (a["Id"] !== undefined && a["RefId"] !== undefined) {
              parameterRefs.set(a["Id"], { refId: a["RefId"], value: a["Value"] });
            }
            return;
          case "Channel": {
            const id = a["Id"];
            if (id === undefined) return;
            channels.set(id, {
              id,
              name: a["Name"],
              text: a["Text"],
              number: a["Number"],
              textParameterRefId: a["TextParameterRefId"],
            });
            channelStack.push(id);
            channelDepths.push(depth);
            return;
          }
          case "ComObjectRefRef": {
            const channel = channelStack[channelStack.length - 1];
            const ref = a["RefId"];
            if (channel !== undefined && ref !== undefined && !channelOfRef.has(ref)) channelOfRef.set(ref, channel);
            return;
          }
          case "Language":
            language = a["Identifier"];
            return;
          case "TranslationElement": {
            const ref = a["RefId"];
            const relevant = ref !== undefined && (ref.includes("_O-") || ref.includes("_CH-") || ref === appId);
            translationRef = relevant && language !== undefined && GERMAN.test(language) ? ref : undefined;
            return;
          }
          case "Translation":
            if (translationRef !== undefined && a["AttributeName"] !== undefined && a["Text"] !== undefined) {
              let entry = translations.get(translationRef);
              if (!entry) translations.set(translationRef, (entry = new Map()));
              entry.set(a["AttributeName"], a["Text"]);
            }
            return;
          default:
            return;
        }
      },
      close(name) {
        if (name === "Channel" && channelDepths[channelDepths.length - 1] === depth) {
          channelStack.pop();
          channelDepths.pop();
        }
        if (name === "Language") language = undefined;
        depth--;
      },
    },
    file,
  );

  if (found === undefined) return undefined;
  const parameterDefaults = new Map<string, string>();
  for (const [id, ref] of parameterRefs) {
    const value = ref.value ?? parameterValues.get(ref.refId);
    if (value !== undefined) parameterDefaults.set(id, value);
  }
  return {
    id: appId,
    name: found.name,
    defaultLanguage: found.defaultLanguage,
    comObjects,
    comObjectRefs,
    parameterDefaults,
    channels,
    channelOfRef,
    translations,
  };
}
