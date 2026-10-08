import type { EtsArchive } from "../archive/ets-archive.ts";
import { type Diagnostic, diagnostic } from "../diagnostics.ts";
import { type Attributes, parseXml } from "../xml/sax.ts";
import { parseDptList } from "./dpt-id.ts";
import type {
  ChannelNode,
  ComObjectFlag,
  ComObjectInstance,
  Device,
  EtsFunction,
  EtsProject,
  FunctionLink,
  GroupAddress,
  GroupRange,
  Space,
  Trade,
} from "./model.ts";

const FLAG_ATTRIBUTES: Readonly<Record<string, ComObjectFlag>> = {
  CommunicationFlag: "communication",
  ReadFlag: "read",
  WriteFlag: "write",
  TransmitFlag: "transmit",
  UpdateFlag: "update",
  ReadOnInitFlag: "readOnInit",
};

export function formatGroupAddress(address: number, style: string): string {
  if (style === "ThreeLevel") return `${address >>> 11}/${(address >>> 8) & 0x7}/${address & 0xff}`;
  if (style === "TwoLevel") return `${address >>> 11}/${address & 0x7ff}`;
  return String(address);
}

interface ProjectInfo {
  id: string;
  name: string;
  guid: string | undefined;
  groupAddressStyle: string;
  createdBy: string;
  toolVersion: string;
}

/** Liest project.xml und alle Installationsdateien. */
export async function readEtsProject(archive: EtsArchive): Promise<EtsProject> {
  const info = readProjectInfo(await archive.readProjectFile(archive.projectXml), archive.projectXml);
  const reader = new InstallationReader(info.groupAddressStyle);
  for (const name of archive.installationXmls) {
    parseXml(await archive.readProjectFile(name), reader, name);
  }
  if (archive.installationXmls.length === 0) {
    reader.diagnostics.push(diagnostic("project.no-installation", "error", "Keine Installationsdatei (0.xml) im Projekt."));
  }
  return { ...info, schemaVersion: archive.schemaVersion, ...reader.result() };
}

function readProjectInfo(data: Uint8Array, fileName: string): ProjectInfo {
  const info: ProjectInfo = {
    id: "",
    name: "",
    guid: undefined,
    groupAddressStyle: "ThreeLevel",
    createdBy: "",
    toolVersion: "",
  };
  parseXml(
    data,
    {
      open(name, attributes) {
        if (name === "KNX") {
          info.createdBy = attributes["CreatedBy"] ?? "";
          info.toolVersion = attributes["ToolVersion"] ?? "";
        } else if (name === "Project") {
          info.id = attributes["Id"] ?? "";
        } else if (name === "ProjectInformation") {
          info.name = attributes["Name"] ?? "";
          info.guid = attributes["Guid"];
          info.groupAddressStyle = attributes["GroupAddressStyle"] ?? "ThreeLevel";
        }
      },
    },
    fileName,
  );
  return info;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

class InstallationReader {
  readonly diagnostics: Diagnostic[] = [];
  readonly #style: string;
  readonly #stack: string[] = [];
  #installation = -1;

  readonly #ranges: GroupRange[] = [];
  readonly #rangeStack: string[] = [];
  readonly #addresses: GroupAddress[] = [];

  readonly #spaces: Mutable<Space>[] = [];
  readonly #spaceStack: Mutable<Space>[] = [];
  readonly #functions: Mutable<EtsFunction>[] = [];
  #currentFunction: Mutable<EtsFunction> | undefined;

  readonly #trades: Mutable<Trade>[] = [];
  readonly #tradeStack: Mutable<Trade>[] = [];

  readonly #devices: Mutable<Device>[] = [];
  #device: (Mutable<Device> & { parameters: Record<string, string> }) | undefined;
  #comObject: Mutable<ComObjectInstance> | undefined;
  #area: string | undefined;
  #line: string | undefined;

  constructor(style: string) {
    this.#style = style;
  }

  open(name: string, a: Attributes): void {
    const parent = this.#stack[this.#stack.length - 1];
    this.#stack.push(name);
    switch (name) {
      case "Installation":
        this.#installation++;
        return;
      case "Area":
        if (this.#inside("Topology")) this.#area = a["Address"];
        return;
      case "Line":
        if (this.#inside("Topology")) this.#line = a["Address"];
        return;
      case "GroupRange":
        this.#openRange(a);
        return;
      case "GroupAddress":
        this.#openGroupAddress(a);
        return;
      case "Space":
      case "BuildingPart":
        if (this.#inside("Locations") || this.#inside("Buildings")) this.#openSpace(name, a);
        return;
      case "Function":
        this.#openFunction(a);
        return;
      case "GroupAddressRef":
        this.#openFunctionLink(a);
        return;
      case "Trade":
        if (this.#inside("Trades")) this.#openTrade(a);
        return;
      case "DeviceInstanceRef":
        this.#openDeviceRef(a);
        return;
      case "DeviceInstance":
        if (this.#inside("Topology")) this.#openDevice(a);
        return;
      case "ParameterInstanceRef":
        if (this.#device && a["RefId"] !== undefined) this.#device.parameters[a["RefId"]] = a["Value"] ?? "";
        return;
      case "ComObjectInstanceRef":
        this.#openComObject(a);
        return;
      case "Send":
      case "Receive":
        if (parent === "Connectors") this.#openConnector(name, a);
        return;
      case "Node":
        this.#openChannelNode(a);
        return;
      default:
        return;
    }
  }

  close(name: string): void {
    this.#stack.pop();
    switch (name) {
      case "GroupRange":
        if (this.#inside("GroupAddresses")) this.#rangeStack.pop();
        return;
      case "Space":
      case "BuildingPart":
        if (this.#inside("Locations") || this.#inside("Buildings")) this.#spaceStack.pop();
        return;
      case "Function":
        this.#currentFunction = undefined;
        return;
      case "Trade":
        if (this.#inside("Trades")) this.#tradeStack.pop();
        return;
      case "DeviceInstance":
        this.#device = undefined;
        return;
      case "ComObjectInstanceRef":
        this.#comObject = undefined;
        return;
      case "Area":
        this.#area = undefined;
        return;
      case "Line":
        this.#line = undefined;
        return;
      default:
        return;
    }
  }

  result(): Omit<EtsProject, keyof ProjectInfo | "schemaVersion"> {
    const knownAddresses = new Set(this.#addresses.map((ga) => ga.id));
    for (const device of this.#devices) {
      for (const co of device.comObjects) {
        for (const gaId of co.groupAddressIds) {
          if (!knownAddresses.has(gaId)) {
            this.diagnostics.push(
              diagnostic(
                "link.unknown-group-address",
                "warning",
                `Kommunikationsobjekt ${co.refId} verweist auf die unbekannte Gruppenadresse ${gaId}.`,
                { device: device.id, comObject: co.refId },
              ),
            );
          }
        }
      }
    }
    return {
      groupRanges: this.#ranges,
      groupAddresses: this.#addresses,
      spaces: this.#spaces,
      functions: this.#functions,
      trades: this.#trades,
      devices: this.#devices,
      diagnostics: this.diagnostics,
    };
  }

  #inside(name: string): boolean {
    return this.#stack.includes(name);
  }

  #openRange(a: Attributes): void {
    if (!this.#inside("GroupAddresses")) return;
    const id = a["Id"] ?? `range-${this.#ranges.length}`;
    this.#ranges.push({
      id,
      name: a["Name"] ?? "",
      start: Number(a["RangeStart"] ?? 0),
      end: Number(a["RangeEnd"] ?? 0),
      parentId: this.#rangeStack[this.#rangeStack.length - 1],
    });
    this.#rangeStack.push(id);
  }

  #openGroupAddress(a: Attributes): void {
    // AdditionalGroupAddresses an Geraeten sind keine Projekt-GAs.
    if (!this.#inside("GroupAddresses") || this.#inside("DeviceInstance")) return;
    const id = a["Id"];
    const raw = a["Address"];
    if (id === undefined || raw === undefined) return;
    const address = Number(raw);
    this.#addresses.push({
      id,
      address,
      text: formatGroupAddress(address, this.#style),
      name: a["Name"] ?? "",
      description: a["Description"] ?? "",
      comment: a["Comment"] ?? "",
      dpts: parseDptList(a["DatapointType"]),
      central: a["Central"] === "true",
      unfiltered: a["Unfiltered"] === "true",
      security: a["Security"],
      rangeIds: [...this.#rangeStack],
      installation: this.#installation,
    });
  }

  #openSpace(element: string, a: Attributes): void {
    const parent = this.#spaceStack[this.#spaceStack.length - 1];
    const space: Mutable<Space> = {
      id: a["Id"] ?? `space-${this.#spaces.length}`,
      name: a["Name"] ?? "",
      type: a["Type"] ?? (element === "BuildingPart" ? "BuildingPart" : "Space"),
      usage: a["Usage"],
      number: a["Number"],
      description: a["Description"] ?? "",
      parentId: parent?.id,
      deviceIds: [],
    };
    this.#spaces.push(space);
    this.#spaceStack.push(space);
  }

  #openFunction(a: Attributes): void {
    const space = this.#spaceStack[this.#spaceStack.length - 1];
    if (!space) return;
    const fn: Mutable<EtsFunction> = {
      id: a["Id"] ?? `function-${this.#functions.length}`,
      name: a["Name"] ?? "",
      type: a["Type"] ?? "",
      number: a["Number"] ?? "",
      comment: a["Comment"] ?? "",
      spaceId: space.id,
      links: [],
    };
    this.#functions.push(fn);
    this.#currentFunction = fn;
  }

  #openFunctionLink(a: Attributes): void {
    const fn = this.#currentFunction;
    const gaId = a["RefId"];
    if (!fn || gaId === undefined) return;
    const link: FunctionLink = { groupAddressId: gaId, role: a["Role"] ?? "", name: a["Name"] ?? "" };
    fn.links.push(link);
  }

  #openTrade(a: Attributes): void {
    const parent = this.#tradeStack[this.#tradeStack.length - 1];
    const trade: Mutable<Trade> = {
      id: a["Id"] ?? `trade-${this.#trades.length}`,
      name: a["Name"] ?? "",
      number: a["Number"],
      parentId: parent?.id,
      deviceIds: [],
    };
    this.#trades.push(trade);
    this.#tradeStack.push(trade);
  }

  #openDeviceRef(a: Attributes): void {
    const ref = a["RefId"];
    if (ref === undefined) return;
    if (this.#inside("Trades")) {
      this.#tradeStack[this.#tradeStack.length - 1]?.deviceIds.push(ref);
    } else {
      this.#spaceStack[this.#spaceStack.length - 1]?.deviceIds.push(ref);
    }
  }

  #openDevice(a: Attributes): void {
    const address = a["Address"];
    const individualAddress =
      address !== undefined && this.#area !== undefined && this.#line !== undefined
        ? `${this.#area}.${this.#line}.${address}`
        : undefined;
    const device = {
      id: a["Id"] ?? `device-${this.#devices.length}`,
      name: a["Name"] ?? "",
      description: a["Description"] ?? "",
      comment: a["Comment"] ?? "",
      individualAddress,
      productRefId: a["ProductRefId"] ?? "",
      hardware2ProgramRefId: a["Hardware2ProgramRefId"] ?? "",
      comObjects: [],
      parameters: {},
      channelNodes: [],
    };
    this.#devices.push(device);
    this.#device = device;
  }

  #openComObject(a: Attributes): void {
    const device = this.#device;
    const refId = a["RefId"];
    if (!device || refId === undefined) return;
    const flags: Partial<Record<ComObjectFlag, boolean>> = {};
    for (const [attribute, flag] of Object.entries(FLAG_ATTRIBUTES)) {
      const value = a[attribute];
      if (value !== undefined) flags[flag] = value === "Enabled";
    }
    const links = (a["Links"] ?? "")
      .split(/\s+/)
      .filter((link) => link !== "")
      .map((link) => fullGroupAddressId(device.id, link));
    const co: Mutable<ComObjectInstance> = {
      refId,
      text: a["Text"],
      functionText: a["FunctionText"],
      description: a["Description"],
      dpts: parseDptList(a["DatapointType"]),
      flags,
      channelId: a["ChannelId"],
      isActive: a["IsActive"] === undefined ? undefined : a["IsActive"] === "true",
      groupAddressIds: links,
      sendingGroupAddressId: links[0],
    };
    device.comObjects.push(co);
    this.#comObject = co;
  }

  /** Altes Format bis ETS5.6: Connectors/Send und Connectors/Receive mit voller GA-Id. */
  #openConnector(kind: string, a: Attributes): void {
    const co = this.#comObject;
    const device = this.#device;
    const ref = a["GroupAddressRefId"];
    if (!co || !device || ref === undefined) return;
    const gaId = fullGroupAddressId(device.id, ref);
    if (kind === "Send") {
      co.sendingGroupAddressId = gaId;
      co.groupAddressIds = [gaId, ...co.groupAddressIds.filter((id) => id !== gaId)];
    } else if (!co.groupAddressIds.includes(gaId)) {
      co.groupAddressIds.push(gaId);
    }
  }

  #openChannelNode(a: Attributes): void {
    const device = this.#device;
    if (!device || !this.#inside("GroupObjectTree") || a["Type"] !== "Channel" || a["RefId"] === undefined) return;
    const node: ChannelNode = {
      channelId: a["RefId"],
      comObjectRefIds: (a["GroupObjectInstances"] ?? "").split(/\s+/).filter((id) => id !== ""),
    };
    device.channelNodes.push(node);
  }
}

/** "GA-3" am Geraet "P-045C-0_DI-1" wird zu "P-045C-0_GA-3". */
function fullGroupAddressId(deviceId: string, link: string): string {
  if (link.includes("_")) return link;
  const prefix = deviceId.slice(0, deviceId.lastIndexOf("_"));
  return prefix === "" ? link : `${prefix}_${link}`;
}
