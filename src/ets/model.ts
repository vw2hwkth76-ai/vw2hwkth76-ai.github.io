import type { Diagnostic } from "../diagnostics.ts";

/** Datenmodell eines ETS-Projekts, so wie es in project.xml und 0.xml steht. Nichts ist abgeleitet. */

export type ComObjectFlag = "communication" | "read" | "write" | "transmit" | "update" | "readOnInit";
export type FlagSet = Readonly<Partial<Record<ComObjectFlag, boolean>>>;

export interface GroupRange {
  readonly id: string;
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly parentId: string | undefined;
}

export interface GroupAddress {
  readonly id: string;
  /** 16-Bit-Wert, in allen GA-Stilen identisch. */
  readonly address: number;
  /** Darstellung im Stil des Projekts, z. B. "1/1/1". */
  readonly text: string;
  readonly name: string;
  readonly description: string;
  readonly comment: string;
  /** DatapointType wie in der ETS gepflegt, normalisiert, z. B. "DPST-1-1" oder "DPT-9". */
  readonly dpts: readonly string[];
  readonly central: boolean;
  readonly unfiltered: boolean;
  readonly security: string | undefined;
  /** Gruppenbereiche von aussen nach innen. */
  readonly rangeIds: readonly string[];
  readonly installation: number;
}

export interface Space {
  readonly id: string;
  readonly name: string;
  /** Building, BuildingPart, Floor, Room, Corridor, Stairway, DistributionBoard, ... */
  readonly type: string;
  readonly usage: string | undefined;
  readonly number: string | undefined;
  readonly description: string;
  readonly parentId: string | undefined;
  readonly deviceIds: readonly string[];
}

export interface FunctionLink {
  readonly groupAddressId: string;
  /** ETS-Rolle, z. B. "SwitchOnOff", bei benutzerdefinierten Funktionen auch eine GUID. */
  readonly role: string;
  readonly name: string;
}

export interface EtsFunction {
  readonly id: string;
  readonly name: string;
  /** Funktionstyp aus knx_master.xml, z. B. "FT-1". */
  readonly type: string;
  readonly number: string;
  readonly comment: string;
  readonly spaceId: string;
  readonly links: readonly FunctionLink[];
}

export interface Trade {
  readonly id: string;
  readonly name: string;
  readonly number: string | undefined;
  readonly parentId: string | undefined;
  readonly deviceIds: readonly string[];
}

export interface ComObjectInstance {
  /** RefId wie im Projekt, kurz ("O-0_R-24") oder mit Modulpfad ("MD-1_M-1_MI-1_O-3-0_R-1"). */
  readonly refId: string;
  readonly text: string | undefined;
  readonly functionText: string | undefined;
  readonly description: string | undefined;
  readonly dpts: readonly string[];
  /** Nur die am Projekt gesetzten Flags; der Rest kommt aus den Herstellerdaten. */
  readonly flags: FlagSet;
  readonly channelId: string | undefined;
  readonly isActive: boolean | undefined;
  /** Verknuepfte GAs als volle Id, die sendende zuerst. */
  readonly groupAddressIds: readonly string[];
  /** Explizit sendende GA (altes Connectors-Format) oder die erste aus Links. */
  readonly sendingGroupAddressId: string | undefined;
}

export interface ChannelNode {
  readonly channelId: string;
  readonly comObjectRefIds: readonly string[];
}

export interface Device {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly comment: string;
  readonly individualAddress: string | undefined;
  readonly productRefId: string;
  readonly hardware2ProgramRefId: string;
  readonly comObjects: readonly ComObjectInstance[];
  /** ParameterInstanceRef: RefId (kurz oder voll) auf Wert. */
  readonly parameters: Readonly<Record<string, string>>;
  /** ETS6: Kanalknoten aus dem GroupObjectTree. */
  readonly channelNodes: readonly ChannelNode[];
}

export interface EtsProject {
  readonly id: string;
  readonly name: string;
  readonly guid: string | undefined;
  readonly groupAddressStyle: string;
  readonly createdBy: string;
  readonly toolVersion: string;
  readonly schemaVersion: number | undefined;
  readonly groupRanges: readonly GroupRange[];
  readonly groupAddresses: readonly GroupAddress[];
  readonly spaces: readonly Space[];
  readonly functions: readonly EtsFunction[];
  readonly trades: readonly Trade[];
  readonly devices: readonly Device[];
  readonly diagnostics: readonly Diagnostic[];
}
