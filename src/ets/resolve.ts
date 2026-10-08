import { type Diagnostic, diagnostic } from "../diagnostics.ts";
import type { ApplicationProgram, ManufacturerData, Product } from "./manufacturer.ts";
import type { ComObjectFlag, ComObjectInstance, Device, EtsProject, FlagSet } from "./model.ts";

export type ChannelSource = "ets-channel" | "manufacturer-channel" | "text-parameter" | "text-label";

export interface ChannelRef {
  /** Eindeutig je Projekt: Geraet plus Kanalkennung. */
  readonly key: string;
  readonly label: string | undefined;
  readonly source: ChannelSource;
}

/** Kommunikationsobjekt mit den Angaben aus Projekt und Herstellerdaten, Instanz vor Ref vor Objekt. */
export interface ResolvedComObject {
  readonly key: string;
  readonly deviceId: string;
  readonly refId: string;
  readonly comObjectRefId: string | undefined;
  readonly number: number | undefined;
  readonly name: string | undefined;
  readonly text: string | undefined;
  readonly textDe: string | undefined;
  readonly functionText: string | undefined;
  readonly functionTextDe: string | undefined;
  readonly objectSize: string | undefined;
  readonly objectSizeBits: number | undefined;
  readonly dpts: readonly string[];
  readonly flags: FlagSet;
  /** true, wenn die Flags vollstaendig aus Herstellerdaten plus Projekt stammen. */
  readonly flagsComplete: boolean;
  readonly channel: ChannelRef | undefined;
  readonly groupAddressIds: readonly string[];
  readonly sendingGroupAddressId: string | undefined;
  readonly resolved: boolean;
}

export interface ResolvedDevice {
  readonly device: Device;
  readonly product: Product | undefined;
  readonly applicationId: string | undefined;
  readonly applicationName: string | undefined;
  readonly comObjects: readonly ResolvedComObject[];
}

const ALL_FLAGS: readonly ComObjectFlag[] = ["communication", "read", "write", "transmit", "update", "readOnInit"];
const MODULE_INSTANCE = /_(?:S?M)-\d+_MI-\d+/g;
const TEMPLATE = /\{\{(\d+)(?::([^}]*))?\}\}/g;
const LABEL_PREFIX = /^\s*([A-Z]|\d{1,2})\s*:/;
const LABEL_WORD = /\b(?:kanal|channel|ausgang|output|ch)\s*([A-Z]|\d{1,2})\b/i;

export function objectSizeBits(size: string | undefined): number | undefined {
  if (size === undefined) return undefined;
  const match = /^(\d+)\s*(bit|bits|byte|bytes)$/i.exec(size.trim());
  if (!match?.[1] || !match[2]) return undefined;
  const count = Number(match[1]);
  return match[2].toLowerCase().startsWith("bit") ? count : count * 8;
}

export function fillTextTemplate(template: string, value: string | undefined): string {
  return template.replace(TEMPLATE, (_, _index: string, fallback: string | undefined) =>
    value !== undefined && value !== "" ? value : (fallback ?? ""),
  );
}

export function resolveDevices(
  project: EtsProject,
  manufacturer: ManufacturerData,
): { devices: ResolvedDevice[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const devices = project.devices.map((device) => {
    const appIds = manufacturer.hardware2Programs.get(device.hardware2ProgramRefId) ?? [];
    const app = appIds.map((id) => manufacturer.applications.get(id)).find((entry) => entry !== undefined);
    if (device.comObjects.length > 0 && app === undefined) {
      diagnostics.push(
        diagnostic(
          "manufacturer.unresolved-device",
          "info",
          `Fuer Geraet ${device.individualAddress ?? device.id} fehlen Herstellerdaten; Objektgroessen und Standardflags sind unbekannt.`,
          { device: device.id },
        ),
      );
    }
    const comObjects = device.comObjects.map((co) => resolveComObject(device, co, app, diagnostics));
    return {
      device,
      product: manufacturer.products.get(device.productRefId),
      applicationId: app?.id,
      applicationName: app?.name,
      comObjects,
    };
  });
  return { devices, diagnostics };
}

function resolveComObject(
  device: Device,
  co: ComObjectInstance,
  app: ApplicationProgram | undefined,
  diagnostics: Diagnostic[],
): ResolvedComObject {
  const refId = app ? qualify(app.id, co.refId) : undefined;
  const ref = refId ? app?.comObjectRefs.get(refId) : undefined;
  const object = ref ? app?.comObjects.get(ref.refId) : undefined;
  if (app && !ref) {
    diagnostics.push(
      diagnostic(
        "manufacturer.unresolved-comobject",
        "warning",
        `Kommunikationsobjekt ${co.refId} ist in ${app.id} nicht zu finden.`,
        { device: device.id, comObject: co.refId },
      ),
    );
  }

  const textParameterValue = ref?.textParameterRefId
    ? (device.parameters[ref.textParameterRefId] ?? device.parameters[shortParameterId(app?.id, ref.textParameterRefId)] ?? app?.parameterDefaults.get(ref.textParameterRefId))
    : undefined;
  const templateText = ref?.text ?? object?.text;
  const text = co.text ?? (templateText !== undefined ? fillTextTemplate(templateText, textParameterValue) : undefined);
  const translatedTemplate = (ref && app?.translations.get(ref.id)?.get("Text")) ?? (object && app?.translations.get(object.id)?.get("Text"));
  const textDe = translatedTemplate !== undefined ? fillTextTemplate(translatedTemplate, textParameterValue) : undefined;
  const functionText = co.functionText ?? ref?.functionText ?? object?.functionText;
  const functionTextDe =
    (ref && app?.translations.get(ref.id)?.get("FunctionText")) ?? (object && app?.translations.get(object.id)?.get("FunctionText"));
  const objectSize = ref?.objectSize ?? object?.objectSize;

  const flags: Partial<Record<ComObjectFlag, boolean>> = { ...object?.flags, ...ref?.flags, ...co.flags };
  const flagsComplete = object !== undefined && ALL_FLAGS.every((flag) => flags[flag] !== undefined);

  const dpts = co.dpts.length > 0 ? co.dpts : ref && ref.dpts.length > 0 ? ref.dpts : (object?.dpts ?? []);

  return {
    key: `${device.id}|${co.refId}`,
    deviceId: device.id,
    refId: co.refId,
    comObjectRefId: ref?.id,
    number: object?.number,
    name: object?.name,
    text,
    textDe,
    functionText,
    functionTextDe,
    objectSize,
    objectSizeBits: objectSizeBits(objectSize),
    dpts,
    flags,
    flagsComplete,
    channel: resolveChannel(device, co, app, ref?.id, ref?.textParameterRefId, textParameterValue, templateText, text),
    groupAddressIds: co.groupAddressIds,
    sendingGroupAddressId: co.sendingGroupAddressId,
    resolved: ref !== undefined,
  };
}

function resolveChannel(
  device: Device,
  co: ComObjectInstance,
  app: ApplicationProgram | undefined,
  refId: string | undefined,
  textParameterRefId: string | undefined,
  textParameterValue: string | undefined,
  templateText: string | undefined,
  text: string | undefined,
): ChannelRef | undefined {
  const channelId = co.channelId ?? device.channelNodes.find((node) => node.comObjectRefIds.includes(co.refId))?.channelId;
  if (channelId !== undefined) {
    const channel = app?.channels.get(qualify(app.id, channelId));
    return { key: `${device.id}#${channelId}`, label: channel?.text || channel?.name, source: "ets-channel" };
  }

  if (app && refId) {
    const appChannelId = app.channelOfRef.get(refId);
    const channel = appChannelId ? app.channels.get(appChannelId) : undefined;
    // Ein einziger Sammelkanal ("Generic") sagt nichts ueber die Ausgaenge.
    if (channel && !(app.channels.size === 1 && (channel.text ?? "") === "")) {
      return { key: `${device.id}#${channel.id.slice(app.id.length + 1)}`, label: channel.text || channel.name, source: "manufacturer-channel" };
    }
  }

  if (textParameterRefId !== undefined) {
    const label = textParameterValue || (templateText ? fillTextTemplate(templateText, undefined).replace(LABEL_PREFIX, "").trim() : undefined);
    return { key: `${device.id}#tp:${textParameterRefId}`, label: label || undefined, source: "text-parameter" };
  }

  if (text !== undefined) {
    const match = LABEL_PREFIX.exec(text) ?? LABEL_WORD.exec(text);
    if (match?.[1]) return { key: `${device.id}#label:${match[1].toUpperCase()}`, label: text, source: "text-label" };
  }
  return undefined;
}

/** "O-0_R-24" wird zu "<App>_O-0_R-24", Modulinstanzen fallen auf die Moduldefinition zurueck. */
function qualify(appId: string, refId: string): string {
  const withoutInstance = refId.replace(MODULE_INSTANCE, "");
  return withoutInstance.startsWith(`${appId}_`) ? withoutInstance : `${appId}_${withoutInstance}`;
}

function shortParameterId(appId: string | undefined, id: string): string {
  return appId !== undefined && id.startsWith(`${appId}_`) ? id.slice(appId.length + 1) : id;
}
