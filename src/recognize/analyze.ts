import { dptMainNumber } from "../ets/dpt-id.ts";
import { directionEvidence } from "../graph/direction.ts";
import type { GaLink, GaNode, ProjectGraph } from "../graph/evidence-graph.ts";
import type { Claim, ClaimSource } from "./claims.ts";
import { type Aspect, ASPECTS, findWords, type Marker, type Trade, type WordHit } from "./lexicon.ts";
import { type RoomFinding, type RoomMatchKind, RoomMatcher } from "./rooms.ts";
import { textOf, type Token, tokenize } from "./text.ts";

export interface NameAnalysis {
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly hits: readonly WordHit[];
  readonly rooms: RoomFinding;
  readonly markers: ReadonlySet<Marker>;
  readonly aspects: readonly Aspect[];
  readonly trades: readonly Trade[];
  /** Woerter ohne Raum, Marker und Aspekt: der eigentliche Funktionsname. */
  readonly labelTokens: readonly Token[];
}

export interface GaAnalysis {
  readonly node: GaNode;
  readonly name: NameAnalysis;
  /** Gruppenbereiche von aussen nach innen. */
  readonly ranges: readonly NameAnalysis[];
  readonly central: boolean;
  readonly outOfUse: boolean;
  readonly outdoor: boolean;
  readonly multiRoomName: boolean;
  readonly multiRoomRange: boolean;
  readonly label: string;
  readonly claims: Claim[];
}

export interface AnalyzeOptions {
  /** false misst die Heuristik so, als gaebe es keine ETS-Funktionen. */
  readonly useEtsFunctions: boolean;
}

const ROOM_CONFIDENCE: Readonly<Record<RoomMatchKind, number>> = { full: 0.85, abbreviation: 0.75, compound: 0.75, initials: 0.7, partial: 0.65 };
const RANGE_PENALTY = 0.15;
const FUNCTION_TYPE_TRADE: Readonly<Record<string, Trade>> = {
  "FT-1": "lighting",
  "FT-2": "lighting",
  "FT-6": "lighting",
  "FT-3": "shading",
  "FT-7": "shading",
  "FT-4": "hvac",
  "FT-5": "hvac",
  "FT-8": "hvac",
  "FT-9": "hvac",
  "FT-10": "socket",
};
const PRODUCT_TRADE: readonly [RegExp, Trade][] = [
  [/dimm/i, "lighting"],
  [/jalousie|rolll?aden|blind|shutter|raffstore|markise/i, "shading"],
  [/heiz|heating|ventil|valve|klima|fan ?coil|thermostat/i, "hvac"],
];
const DPT_TRADE: Readonly<Record<string, Trade>> = {
  "DPST-1-8": "shading",
  "DPST-1-7": "shading",
  "DPST-3-7": "lighting",
  "DPST-9-1": "hvac",
  "DPST-20-102": "hvac",
};
const DIRECTION_MARKERS: readonly Marker[] = ["alarm", "status", "command"];
/**
 * Objekt- und Sammelwoerter ("Fenster", "heiz", "Betriebsart") zaehlen nur, wenn kein spezifischerer
 * Aspekt im Namen steht: "Window 1 movement" ist ein Fahrbefehl, "heiz_Frost" und "Betriebsm. Kompf."
 * sind Befehle fuer einen bestimmten Betriebsmodus.
 */
const WEAK_ASPECTS = new Set<Aspect>(["window", "heat", "mode"]);
const LABEL_MARKERS = new Set<Marker>(["status", "command", "alarm", "central", "outOfUse", "outdoor"]);

export function analyzeName(text: string, matcher: RoomMatcher): NameAnalysis {
  const tokens = tokenize(text);
  const hits = findWords(tokens);
  const rooms = matcher.findRooms(tokens);
  const markers = new Set<Marker>();
  const aspects: Aspect[] = [];
  const trades: Trade[] = [];
  const consumed = new Set<number>();
  for (const match of rooms.matches) for (const index of match.tokens) consumed.add(index);
  for (const hit of hits) {
    const { marker, aspect, trade } = hit.info;
    if (marker) markers.add(marker);
    if (aspect) aspects.push(aspect);
    if (trade) trades.push(trade);
    // Gewerkwoerter bleiben im Funktionsnamen ("Licht A"), Marker und Aspekte nicht.
    const labelRelevant = (marker !== undefined && LABEL_MARKERS.has(marker)) || aspect !== undefined;
    if (labelRelevant) for (const index of hit.tokens) consumed.add(index);
  }
  const controlAspects = aspects.filter((aspect) => !WEAK_ASPECTS.has(aspect));
  return {
    text,
    tokens,
    hits,
    rooms,
    markers,
    aspects: controlAspects.length > 0 ? controlAspects : aspects,
    trades,
    labelTokens: tokens.filter((token) => !consumed.has(token.index)),
  };
}

/** Erste Belege einer GA aus Projekt, Verdrahtung, Herstellerdaten, Namen, Hierarchie und Geraetestandorten. */
export function analyzeGroupAddress(
  node: GaNode,
  graph: ProjectGraph,
  matcher: RoomMatcher,
  options: AnalyzeOptions,
): GaAnalysis {
  const name = analyzeName(node.ga.name, matcher);
  const ranges = node.ranges.map((range) => analyzeName(range.name, matcher));
  const anyMarker = (marker: Marker) => name.markers.has(marker) || ranges.some((range) => range.markers.has(marker));
  const claims: Claim[] = [];
  const claim = (dimension: Claim["dimension"], value: string, source: ClaimSource, confidence: number, evidence: string): void => {
    claims.push({ dimension, value, source, confidence, evidence });
  };
  const functions = options.useEtsFunctions ? node.functions : [];

  // Gewerk
  for (const membership of functions) {
    const trade = FUNCTION_TYPE_TRADE[membership.function.type];
    if (trade) claim("trade", trade, "ets-function", 0.9, `ETS-Funktion "${membership.function.name}" (${membership.function.type})`);
  }
  const nameTrade = name.trades[0];
  if (nameTrade) claim("trade", nameTrade, "name", 0.8, `Wort im Namen "${node.ga.name}"`);
  for (const aspect of name.aspects) {
    const trade = ASPECTS[aspect].trade;
    if (trade) claim("trade", trade, "name", 0.65, `Begriff "${aspect}" im Namen`);
  }
  for (const range of ranges) {
    const rangeTrade = range.trades[0];
    if (rangeTrade) claim("trade", rangeTrade, "hierarchy", 0.75, `Gruppenbereich "${range.text}"`);
    for (const aspect of range.aspects) {
      const trade = ASPECTS[aspect].trade;
      if (trade) claim("trade", trade, "hierarchy", 0.55, `Begriff "${aspect}" im Gruppenbereich "${range.text}"`);
    }
  }
  for (const link of node.links.filter((entry) => isCabinet(entry, graph))) {
    const text = `${link.device.product?.text ?? ""} ${link.device.applicationName ?? ""}`;
    const match = PRODUCT_TRADE.find(([pattern]) => pattern.test(text));
    if (match) claim("trade", match[1], "manufacturer", 0.6, `verknuepfter Aktor "${link.device.product?.text ?? link.device.device.id}"`);
  }

  // Richtung
  for (const evidence of directionEvidence(node, graph)) {
    if (evidence.source === "ets-function-role" && !options.useEtsFunctions) continue;
    const wiring = evidence.source === "ets-wiring";
    // Die Verdrahtung ist funktional, die ETS-Rolle eine Zuordnung von Hand; bei Widerspruch gewinnt die Verdrahtung.
    claim("direction", evidence.value, wiring ? "ets-wiring" : "ets-function", wiring ? 0.93 : 0.9, evidence.detail);
  }
  const nameMarker = DIRECTION_MARKERS.find((marker) => name.markers.has(marker));
  if (nameMarker) {
    claim("direction", nameMarker, "name", nameMarker === "command" ? 0.75 : 0.8, `Kennwort im Namen "${node.ga.name}"`);
  } else {
    const aspectDirection = name.aspects.map((aspect) => ASPECTS[aspect].direction).find((direction) => direction !== undefined);
    if (aspectDirection) claim("direction", aspectDirection, "name", 0.6, `Begriff im Namen "${node.ga.name}"`);
    for (const range of [...ranges].reverse()) {
      const rangeMarker = DIRECTION_MARKERS.find((marker) => range.markers.has(marker));
      if (rangeMarker) {
        claim("direction", rangeMarker, "hierarchy", 0.65, `Gruppenbereich "${range.text}"`);
        break;
      }
      const rangeDirection = range.aspects.map((aspect) => ASPECTS[aspect].direction).find((direction) => direction !== undefined);
      if (rangeDirection) {
        claim("direction", rangeDirection, "hierarchy", 0.55, `Gruppenbereich "${range.text}"`);
        break;
      }
    }
  }

  // DPT
  const sizes = node.comObjectSizes;
  const fitsSize = (dpt: string): boolean => {
    const size = graph.loaded.master.dpts.get(dpt)?.sizeInBit;
    return sizes.size !== 1 || size === undefined || sizes.has(size);
  };
  const gaDpt = node.ga.dpts[0];
  if (gaDpt) claim("dpt", gaDpt, "ets-ga", 0.95, "DatapointType an der GA");
  const coDpt = comObjectDpt(node);
  if (coDpt) claim("dpt", coDpt, "manufacturer", 0.9, "DPT der verknuepften Kommunikationsobjekte");
  for (const aspect of name.aspects) {
    const dpt = ASPECTS[aspect].dpt;
    if (dpt && fitsSize(dpt)) claim("dpt", dpt, "name", 0.6, `Begriff "${aspect}" im Namen`);
  }
  for (const range of ranges) {
    for (const aspect of range.aspects) {
      const dpt = ASPECTS[aspect].dpt;
      if (dpt && fitsSize(dpt)) claim("dpt", dpt, "hierarchy", 0.5, `Begriff "${aspect}" im Gruppenbereich "${range.text}"`);
    }
  }
  for (const dpt of [gaDpt, coDpt]) {
    const trade = dpt ? DPT_TRADE[dpt] : undefined;
    if (trade) claim("trade", trade, dpt === gaDpt ? "ets-ga" : "manufacturer", 0.55, `Datenpunkttyp ${dpt}`);
  }

  // Raum
  for (const membership of functions) {
    if (membership.space) claim("room", membership.space.id, "ets-function", 0.95, `ETS-Funktion "${membership.function.name}" im Raum "${membership.space.name}"`);
  }
  const nameRooms = distinct(name.rooms.matches.map((match) => match.spaceId));
  const multiRoomName = nameRooms.length > 1;
  const nameRoom = name.rooms.matches[0];
  if (nameRooms.length === 1 && nameRoom) {
    claim("room", nameRoom.spaceId, "name", ROOM_CONFIDENCE[nameRoom.kind], `Raum im Namen "${node.ga.name}"`);
  }
  let multiRoomRange = false;
  for (const range of [...ranges].reverse()) {
    const rangeRooms = distinct(range.rooms.matches.map((match) => match.spaceId));
    const first = range.rooms.matches[0];
    if (rangeRooms.length === 1 && first) {
      claim("room", first.spaceId, "hierarchy", ROOM_CONFIDENCE[first.kind] - RANGE_PENALTY, `Gruppenbereich "${range.text}"`);
      break;
    }
    if (rangeRooms.length > 1) {
      multiRoomRange = true;
      break;
    }
  }
  const tradeGuess = [...claims].filter((entry) => entry.dimension === "trade").sort((a, b) => b.confidence - a.confidence)[0]?.value;
  const deviceRooms = distinct(
    node.links
      .filter((link) => !isCabinet(link, graph))
      .map((link) => graph.deviceSpace.get(link.device.device.id)?.space)
      .filter((space) => space !== undefined && space.type !== "DistributionBoard" && space.type !== "Building" && space.type !== "Floor")
      .map((space) => space?.id ?? ""),
  );
  const deviceRoom = deviceRooms[0];
  const outdoor = anyMarker("outdoor");
  if (deviceRooms.length === 1 && deviceRoom && !outdoor) {
    // Raumregler sitzen im geregelten Raum, Taster oft nebenan.
    const confidence = tradeGuess === "hvac" ? 0.8 : 0.5;
    claim("room", deviceRoom, "device-location", confidence, "Einbauort der verknuepften Bedien- und Sensorgeraete");
  }
  const central = anyMarker("central");
  if (central && !claims.some((entry) => entry.dimension === "room" && entry.source !== "hierarchy")) {
    const buildings = graph.loaded.project.spaces.filter((space) => space.type === "Building");
    if (buildings.length === 1 && buildings[0]) claim("room", buildings[0].id, "name", 0.6, "Zentralfunktion, gilt fuer das Gebaeude");
  }

  return {
    node,
    name,
    ranges,
    central,
    outOfUse: anyMarker("outOfUse"),
    outdoor,
    multiRoomName,
    multiRoomRange,
    label: textOf(node.ga.name, name.labelTokens),
    claims,
  };
}

export function isCabinet(link: GaLink, graph: ProjectGraph): boolean {
  return link.device.product?.isRailMounted ?? graph.deviceSpace.get(link.device.device.id)?.space.type === "DistributionBoard";
}

function comObjectDpt(node: GaNode): string | undefined {
  const all = [...node.comObjectDpts.values()].flat();
  if (all.length === 0) return undefined;
  const subtypes = new Set(all.filter((dpt) => dpt.startsWith("DPST-")));
  if (subtypes.size === 1) return [...subtypes][0];
  const mains = new Set(all.map(dptMainNumber).filter((main) => main !== undefined));
  return mains.size === 1 ? `DPT-${[...mains][0]}` : undefined;
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}
