import { type Diagnostic, diagnostic } from "../diagnostics.ts";
import { dptMainNumber } from "../ets/dpt-id.ts";
import type { LoadedProject } from "../ets/load.ts";
import type { EtsFunction, GroupAddress, GroupRange, Space, Trade } from "../ets/model.ts";
import type { ResolvedComObject, ResolvedDevice } from "../ets/resolve.ts";

/**
 * Was das Projekt ueber eine GA explizit weiss, ohne Namensheuristik:
 * Gruppenbereiche, ETS-Funktionen, verknuepfte Kommunikationsobjekte mit
 * Flags und Geraeten, Einbauort und Gewerk der Geraete.
 */

/** Wie ein verknuepftes Objekt an dieser GA beteiligt ist. */
export interface GaLink {
  readonly comObject: ResolvedComObject;
  readonly device: ResolvedDevice;
  /** Das Objekt sendet auf dieser GA: Uebertragen-Flag und sendende GA des Objekts. */
  readonly sends: boolean;
  /** Das Objekt nimmt Werte dieser GA an: Schreiben- oder Aktualisieren-Flag. */
  readonly receives: boolean;
  /** Das Objekt beantwortet Lesetelegramme: Lesen-Flag und sendende GA. */
  readonly answersRead: boolean;
  /** Flags vollstaendig bekannt (Herstellerdaten vorhanden). */
  readonly flagsKnown: boolean;
}

export interface FunctionMembership {
  readonly function: EtsFunction;
  readonly role: string;
  readonly space: Space | undefined;
}

export interface GaNode {
  readonly ga: GroupAddress;
  readonly ranges: readonly GroupRange[];
  readonly functions: readonly FunctionMembership[];
  readonly links: readonly GaLink[];
  /** DPTs der verknuepften Objekte, je Objekt-Key. */
  readonly comObjectDpts: ReadonlyMap<string, readonly string[]>;
  /** Objektgroessen der verknuepften Objekte in Bit. */
  readonly comObjectSizes: ReadonlySet<number>;
  /** Mindestens ein Objekt beantwortet Lesetelegramme; undefined, wenn ohne Herstellerdaten unbekannt. */
  readonly readable: boolean | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

export interface SpaceNode {
  readonly space: Space;
  /** Von aussen nach innen, inklusive des Raums selbst. */
  readonly path: readonly Space[];
  readonly usageText: string | undefined;
}

export interface ProjectGraph {
  readonly loaded: LoadedProject;
  readonly groupAddresses: readonly GaNode[];
  readonly byGroupAddressId: ReadonlyMap<string, GaNode>;
  readonly spaces: ReadonlyMap<string, SpaceNode>;
  /** Einbauort je Geraet laut Gebaeudestruktur. */
  readonly deviceSpace: ReadonlyMap<string, SpaceNode>;
  readonly deviceTrades: ReadonlyMap<string, readonly Trade[]>;
  readonly diagnostics: readonly Diagnostic[];
}

export function buildGraph(loaded: LoadedProject): ProjectGraph {
  const { project } = loaded;
  const ranges = new Map(project.groupRanges.map((range) => [range.id, range]));
  const spaces = buildSpaces(project.spaces, loaded);
  const deviceSpace = new Map<string, SpaceNode>();
  for (const node of spaces.values()) {
    for (const deviceId of node.space.deviceIds) deviceSpace.set(deviceId, node);
  }
  const deviceTrades = new Map<string, Trade[]>();
  for (const trade of project.trades) {
    for (const deviceId of trade.deviceIds) {
      const list = deviceTrades.get(deviceId) ?? [];
      list.push(trade);
      deviceTrades.set(deviceId, list);
    }
  }

  const memberships = new Map<string, FunctionMembership[]>();
  for (const fn of project.functions) {
    for (const link of fn.links) {
      const list = memberships.get(link.groupAddressId) ?? [];
      list.push({ function: fn, role: link.role, space: spaces.get(fn.spaceId)?.space });
      memberships.set(link.groupAddressId, list);
    }
  }

  const linksByGa = new Map<string, GaLink[]>();
  for (const device of loaded.devices) {
    for (const co of device.comObjects) {
      for (const gaId of co.groupAddressIds) {
        const sendingGa = co.sendingGroupAddressId === gaId;
        const link: GaLink = {
          comObject: co,
          device,
          sends: sendingGa && co.flags.transmit === true,
          receives: co.flags.write === true || co.flags.update === true,
          answersRead: sendingGa && co.flags.read === true,
          flagsKnown: co.flagsComplete,
        };
        const list = linksByGa.get(gaId) ?? [];
        list.push(link);
        linksByGa.set(gaId, list);
      }
    }
  }

  const hasDevices = loaded.devices.length > 0;
  const nodes = project.groupAddresses.map((ga) =>
    buildNode(ga, ranges, memberships.get(ga.id) ?? [], linksByGa.get(ga.id) ?? [], hasDevices, loaded),
  );
  return {
    loaded,
    groupAddresses: nodes,
    byGroupAddressId: new Map(nodes.map((node) => [node.ga.id, node])),
    spaces,
    deviceSpace,
    deviceTrades,
    diagnostics: [...loaded.diagnostics, ...nodes.flatMap((node) => node.diagnostics)],
  };
}

function buildSpaces(list: readonly Space[], loaded: LoadedProject): Map<string, SpaceNode> {
  const byId = new Map(list.map((space) => [space.id, space]));
  const result = new Map<string, SpaceNode>();
  for (const space of list) {
    const path: Space[] = [];
    let current: Space | undefined = space;
    while (current && path.length < 32) {
      path.unshift(current);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    const usage = space.usage === undefined ? undefined : loaded.master.spaceUsages.get(space.usage);
    result.set(space.id, { space, path, usageText: usage?.textDe ?? usage?.text });
  }
  return result;
}

function buildNode(
  ga: GroupAddress,
  ranges: ReadonlyMap<string, GroupRange>,
  functions: FunctionMembership[],
  links: GaLink[],
  hasDevices: boolean,
  loaded: LoadedProject,
): GaNode {
  const diagnostics: Diagnostic[] = [];
  const refs = { groupAddress: ga.id };
  const label = `${ga.text} "${ga.name}"`;

  const comObjectDpts = new Map<string, readonly string[]>();
  const sizes = new Set<number>();
  for (const link of links) {
    if (link.comObject.dpts.length > 0) comObjectDpts.set(link.comObject.key, link.comObject.dpts);
    if (link.comObject.objectSizeBits !== undefined) sizes.add(link.comObject.objectSizeBits);
  }

  if (hasDevices && links.length === 0) {
    diagnostics.push(diagnostic("ga.unlinked", "info", `${label} ist mit keinem Kommunikationsobjekt verknuepft.`, refs));
  }
  if (ga.dpts.length === 0 && comObjectDpts.size === 0) {
    diagnostics.push(diagnostic("ga.dpt-missing", "warning", `${label} hat keinen Datenpunkttyp, weder an der GA noch an verknuepften Objekten.`, refs));
  }

  const mains = new Set<number>();
  for (const dpt of [...ga.dpts, ...[...comObjectDpts.values()].flat()]) {
    const main = dptMainNumber(dpt);
    if (main !== undefined) mains.add(main);
  }
  if (mains.size > 1) {
    diagnostics.push(
      diagnostic("ga.dpt-conflict", "error", `${label}: verknuepfte Objekte und GA nennen unterschiedliche DPT-Haupttypen (${[...mains].sort((a, b) => a - b).join(", ")}).`, refs),
    );
  }
  if (sizes.size > 1) {
    diagnostics.push(
      diagnostic("ga.size-conflict", "error", `${label}: verknuepfte Objekte haben unterschiedliche Groessen (${[...sizes].sort((a, b) => a - b).join(", ")} Bit).`, refs),
    );
  }
  for (const dpt of ga.dpts) {
    const definition = loaded.master.dpts.get(dpt);
    if (definition && sizes.size === 1 && !sizes.has(definition.sizeInBit)) {
      diagnostics.push(
        diagnostic("ga.dpt-size-mismatch", "error", `${label}: DPT ${dpt} hat ${definition.sizeInBit} Bit, die verknuepften Objekte ${[...sizes][0]} Bit.`, refs),
      );
    }
  }

  const flagsKnown = links.length > 0 && links.every((link) => link.flagsKnown);
  const receivers = links.filter((link) => link.receives);
  const senders = links.filter((link) => link.sends);
  if (flagsKnown && receivers.length > 0 && senders.length === 0) {
    diagnostics.push(
      diagnostic("ga.no-sender", "info", `${label}: kein verknuepftes Objekt sendet auf dieser GA; Werte kommen nur von aussen (Visualisierung, Gateway).`, refs),
    );
  }
  const readable = links.some((link) => link.answersRead) ? true : flagsKnown ? false : undefined;
  if (readable === false) {
    diagnostics.push(
      diagnostic("ga.not-readable", "info", `${label}: kein Objekt beantwortet Lesetelegramme; ein Lesezugriff bleibt ohne Antwort.`, refs),
    );
  }

  const distinctFunctions = new Set(functions.map((entry) => entry.function.id));
  if (distinctFunctions.size > 1) {
    diagnostics.push(
      diagnostic("ga.multiple-functions", "warning", `${label} ist in ${distinctFunctions.size} ETS-Funktionen verlinkt; die Zuordnung ist nicht eindeutig.`, refs),
    );
  }

  return {
    ga,
    ranges: ga.rangeIds.map((id) => ranges.get(id)).filter((range) => range !== undefined),
    functions,
    links,
    comObjectDpts,
    comObjectSizes: sizes,
    readable,
    diagnostics,
  };
}
