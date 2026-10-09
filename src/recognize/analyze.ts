import { dptMainNumber } from "../ets/dpt-id.ts";
import { objectDpt } from "./object-dpt.ts";
import { directionEvidence, isActuatorLink, isNeutral, objectText } from "../graph/direction.ts";
import type { Space } from "../ets/model.ts";
import type { GaLink, GaNode, ProjectGraph } from "../graph/evidence-graph.ts";
import type { Claim, ClaimDimension, ClaimSource } from "./claims.ts";
import { type Aspect, ASPECTS, findWords, type Marker, type Trade, type WordHit } from "./lexicon.ts";
import type { CompiledProfile } from "./profile.ts";
import { type RoomFinding, type RoomMatchKind, RoomMatcher } from "./rooms.ts";
import { labelOf, type Token, tokenize } from "./text.ts";

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
  /** Anzeigename aus den verbleibenden Woertern, Profilkuerzel durch ihren Namen ersetzt. */
  readonly label: string;
  /**
   * Wie labelTokens und label, aber mit Ortsbegriffen: Im Licht meint
   * "Window" die Fensterreihe und unterscheidet Things, bei der Heizung den
   * Fensterkontakt, der zum Raum-Thing gehoert.
   */
  readonly placeTokens: readonly Token[];
  readonly placeLabel: string;
  /** Treffer aus dem Namensschema des Integrators. */
  readonly profile: {
    readonly trades: readonly Trade[];
    readonly aspects: readonly Aspect[];
    readonly markers: readonly Marker[];
    readonly roomIds: readonly string[];
    readonly tokens: readonly number[];
  };
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
  /** Aspekte aus den Texten der verknuepften Objekte, Aktorobjekte zuerst; Rueckfall, wenn der Name nichts sagt. */
  readonly objectAspects: readonly Aspect[];
  readonly claims: Claim[];
}

/** Von Hand bestaetigte Werte je GA und Dimension. */
export type Reviews = ReadonlyMap<string, Readonly<Partial<Record<ClaimDimension, string>>>>;

export interface AnalyzeOptions {
  /** false misst die Heuristik so, als gaebe es keine ETS-Funktionen. */
  readonly useEtsFunctions: boolean;
  readonly reviews?: Reviews;
  /** Bestaetigtes Namensschema; seine Kuerzel gehen dem allgemeinen Vokabular vor. */
  readonly profile?: CompiledProfile;
}

const REVIEW_DIMENSIONS: readonly ClaimDimension[] = ["room", "trade", "direction", "dpt"];
const ROOM_CONFIDENCE: Readonly<Record<RoomMatchKind, number>> = {
  full: 0.85,
  sequence: 0.85,
  loose: 0.8,
  mismatch: 0.65,
  abbreviation: 0.75,
  compound: 0.75,
  initials: 0.7,
  partial: 0.65,
};
const RANGE_PENALTY = 0.15;
const MULTI_ROOM_CONFIDENCE = 0.75;
const AREA_PENALTY = 0.15;
const BUILDING_FALLBACK_CONFIDENCE = 0.4;
const ROOM_LIKE = new Set(["Room", "Corridor", "Stairway", "Stairs", "Space"]);
const ALARM_DPT = "DPST-1-5";
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
/** Aspekte, die im Licht einen Ort nennen. */
const PLACE_ASPECTS = new Set<Aspect>(["window"]);
const LABEL_MARKERS = new Set<Marker>(["status", "command", "alarm", "central", "outOfUse", "outdoor"]);

export function analyzeName(text: string, matcher: RoomMatcher, profile?: CompiledProfile): NameAnalysis {
  const tokens = tokenize(text);
  const profileHits = new Map(
    tokens.flatMap((token) => {
      const entry = profile?.tokens.get(token.norm);
      return entry ? [[token.index, entry] as const] : [];
    }),
  );
  const fromProfile = (indices: readonly number[]): boolean => indices.some((index) => profileHits.has(index));
  const hits = findWords(tokens).filter((hit) => !fromProfile(hit.tokens));
  const found = matcher.findRooms(tokens);
  const rooms: RoomFinding = { ...found, matches: found.matches.filter((match) => !fromProfile(match.tokens)) };
  const markers = new Set<Marker>();
  const aspects: Aspect[] = [];
  const trades: Trade[] = [];
  const consumed = new Set<number>();
  const places = new Set<number>();
  const replacements = new Map<number, string>();
  for (const match of rooms.matches) for (const index of match.tokens) consumed.add(index);
  for (const hit of hits) {
    const { marker, aspect, trade } = hit.info;
    if (marker) markers.add(marker);
    if (aspect) aspects.push(aspect);
    if (trade) trades.push(trade);
    // Gewerkwoerter bleiben im Funktionsnamen ("Licht A"), Marker und Aspekte nicht.
    const labelRelevant = (marker !== undefined && LABEL_MARKERS.has(marker)) || aspect !== undefined;
    if (labelRelevant) for (const index of hit.tokens) consumed.add(index);
    if (aspect && PLACE_ASPECTS.has(aspect) && !marker) for (const index of hit.tokens) places.add(index);
  }
  const fromSchema = { trades: [] as Trade[], aspects: [] as Aspect[], markers: [] as Marker[], roomIds: [] as string[], tokens: [...profileHits.keys()] };
  for (const [index, { entry, roomId }] of profileHits) {
    if (entry.trade) fromSchema.trades.push(entry.trade);
    if (entry.aspect) fromSchema.aspects.push(entry.aspect);
    if (entry.marker) fromSchema.markers.push(entry.marker);
    if (roomId) fromSchema.roomIds.push(roomId);
    if (entry.label !== undefined) replacements.set(index, entry.label);
    else if (roomId || entry.aspect || (entry.marker && LABEL_MARKERS.has(entry.marker))) consumed.add(index);
  }
  for (const marker of fromSchema.markers) markers.add(marker);
  aspects.unshift(...fromSchema.aspects);
  trades.unshift(...fromSchema.trades);
  const controlAspects = aspects.filter((aspect) => !WEAK_ASPECTS.has(aspect));
  const labelTokens = tokens.filter((token) => !consumed.has(token.index));
  const placeTokens = tokens.filter((token) => !consumed.has(token.index) || places.has(token.index));
  return {
    text,
    tokens,
    hits,
    rooms,
    markers,
    aspects: controlAspects.length > 0 ? controlAspects : aspects,
    trades,
    labelTokens,
    label: labelOf(text, labelTokens, replacements),
    placeTokens,
    placeLabel: labelOf(text, placeTokens, replacements),
    profile: fromSchema,
  };
}

/** Erste Belege einer GA aus Projekt, Verdrahtung, Herstellerdaten, Namen, Hierarchie und Geraetestandorten. */
export function analyzeGroupAddress(
  node: GaNode,
  graph: ProjectGraph,
  matcher: RoomMatcher,
  options: AnalyzeOptions,
): GaAnalysis {
  const name = analyzeName(node.ga.name, matcher, options.profile);
  const ranges = node.ranges.map((range) => analyzeName(range.name, matcher, options.profile));
  const anyMarker = (marker: Marker) => name.markers.has(marker) || ranges.some((range) => range.markers.has(marker));
  const claims: Claim[] = [];
  const claim = (dimension: Claim["dimension"], value: string, source: ClaimSource, confidence: number, evidence: string): void => {
    claims.push({ dimension, value, source, confidence, evidence });
  };
  const functions = options.useEtsFunctions ? node.functions : [];
  const sizes = node.comObjectSizes;
  const fitsSize = (dpt: string): boolean => {
    const size = graph.loaded.master.dpts.get(dpt)?.sizeInBit;
    return sizes.size !== 1 || size === undefined || sizes.has(size);
  };
  // Ein Begriff, dessen typische Groesse der Objektgroesse widerspricht, meint etwas anderes ("Power_Status" mit 1 Bit).
  const sized = (aspects: readonly Aspect[]): Aspect[] =>
    aspects.filter((aspect) => {
      const dpt = ASPECTS[aspect].dpt;
      return dpt === undefined || fitsSize(dpt);
    });
  const nameAspects = sized(name.aspects);

  // Bestaetigte Antworten
  const review = options.reviews?.get(node.ga.id);
  for (const dimension of REVIEW_DIMENSIONS) {
    const value = review?.[dimension];
    if (value !== undefined && value !== "") claim(dimension, value, "review", 1, "von Hand bestätigt");
  }

  // Namensschema des Integrators
  const schemaName = options.profile?.name ?? "Namensschema";
  for (const source of [name, ...ranges]) {
    const where = source === name ? "im Namen" : `im Gruppenbereich "${source.text}"`;
    const weight = source === name ? 0 : 0.05;
    for (const trade of source.profile.trades) claim("trade", trade, "profile", 0.88 - weight, `${schemaName}: Kürzel ${where}`);
    const rooms = [...new Set(source.profile.roomIds)];
    if (rooms.length === 1 && rooms[0]) claim("room", rooms[0], "profile", 0.88 - weight, `${schemaName}: Raumkürzel ${where}`);
    const marker = DIRECTION_MARKERS.find((entry) => source.profile.markers.includes(entry));
    if (marker) claim("direction", marker, "profile", 0.88 - weight, `${schemaName}: Kennwort ${where}`);
    for (const aspect of source.profile.aspects) {
      const info = ASPECTS[aspect];
      if (info.direction && !marker) claim("direction", info.direction, "profile", 0.8 - weight, `${schemaName}: Aspekt "${aspect}" ${where}`);
      if (info.dpt) claim("dpt", info.dpt, "profile", 0.75 - weight, `${schemaName}: Aspekt "${aspect}" ${where}`);
    }
  }

  // Gewerk
  for (const membership of functions) {
    const trade = FUNCTION_TYPE_TRADE[membership.function.type];
    if (trade) claim("trade", trade, "ets-function", 0.9, `ETS-Funktion "${membership.function.name}" (${membership.function.type})`);
  }
  const nameTrade = name.trades[0];
  if (nameTrade) claim("trade", nameTrade, "name", 0.8, `Wort im Namen "${node.ga.name}"`);
  for (const aspect of nameAspects) {
    const trade = ASPECTS[aspect].trade;
    if (trade) claim("trade", trade, "name", 0.65, `Begriff "${aspect}" im Namen`);
  }
  for (const range of ranges) {
    const rangeTrade = range.trades[0];
    if (rangeTrade) claim("trade", rangeTrade, "hierarchy", 0.75, `Gruppenbereich "${range.text}"`);
    // Der Gruppenbereich nennt das Thema aller seiner GAs; die Objektgroesse einer einzelnen GA spricht nicht dagegen.
    for (const aspect of range.aspects) {
      const trade = ASPECTS[aspect].trade;
      if (trade) claim("trade", trade, "hierarchy", 0.55, `Begriff "${aspect}" im Gruppenbereich "${range.text}"`);
    }
  }
  for (const link of node.links.filter((entry) => isCabinet(entry, graph))) {
    const text = `${link.device.product?.text ?? ""} ${link.device.applicationName ?? ""}`;
    const match = PRODUCT_TRADE.find(([pattern]) => pattern.test(text));
    if (match) claim("trade", match[1], "manufacturer", 0.6, `verknüpfter Aktor "${link.device.product?.text ?? link.device.device.id}"`);
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
    // "Alarm" sagt, was transportiert wird, nicht wohin; gegen die Verdrahtung (ein Aktor wird gesteuert) traegt es nicht.
    claim("direction", nameMarker, "name", nameMarker === "status" ? 0.8 : 0.75, `Kennwort im Namen "${node.ga.name}"`);
  } else {
    const aspectDirection = nameAspects.map((aspect) => ASPECTS[aspect].direction).find((direction) => direction !== undefined);
    if (aspectDirection) claim("direction", aspectDirection, "name", 0.6, `Begriff im Namen "${node.ga.name}"`);
    for (const range of [...ranges].reverse()) {
      const rangeMarker = DIRECTION_MARKERS.find((marker) => range.markers.has(marker));
      if (rangeMarker) {
        claim("direction", rangeMarker, "hierarchy", 0.65, `Gruppenbereich "${range.text}"`);
        break;
      }
      const rangeDirection = sized(range.aspects).map((aspect) => ASPECTS[aspect].direction).find((direction) => direction !== undefined);
      if (rangeDirection) {
        claim("direction", rangeDirection, "hierarchy", 0.55, `Gruppenbereich "${range.text}"`);
        break;
      }
    }
  }

  // DPT
  const gaDpt = node.ga.dpts[0];
  if (gaDpt) claim("dpt", gaDpt, "ets-ga", 0.95, "DatapointType an der GA");
  const coDpt = comObjectDpt(node);
  if (coDpt) claim("dpt", coDpt, "manufacturer", 0.9, "DPT der verknüpften Kommunikationsobjekte");
  for (const aspect of nameAspects) {
    const dpt = ASPECTS[aspect].dpt;
    if (dpt) claim("dpt", dpt, "name", 0.6, `Begriff "${aspect}" im Namen`);
  }
  // Eine Stoermeldung ohne weiteren Begriff ist ein Alarmbit.
  if (name.markers.has("alarm") && !nameAspects.some((aspect) => ASPECTS[aspect].dpt !== undefined) && fitsSize(ALARM_DPT)) {
    claim("dpt", ALARM_DPT, "name", 0.6, `Störmeldung im Namen "${node.ga.name}"`);
  }
  for (const range of ranges) {
    for (const aspect of range.aspects) {
      const dpt = ASPECTS[aspect].dpt;
      if (dpt && fitsSize(dpt)) claim("dpt", dpt, "hierarchy", 0.5, `Begriff "${aspect}" im Gruppenbereich "${range.text}"`);
    }
  }
  if (!gaDpt && !coDpt) {
    const hints = claims
      .filter((entry) => entry.dimension === "dpt")
      .sort((a, b) => b.confidence - a.confidence)
      .map((entry) => entry.value);
    const objects = node.links.map((link) => ({
      text: objectText(link),
      label: link.comObject.functionText ?? link.comObject.text ?? link.comObject.refId,
      actuator: isActuatorLink(link, graph),
    }));
    const inferred = objectDpt(node.comObjectSizes, objects, hints);
    if (inferred) claim("dpt", inferred.value, "manufacturer", inferred.confidence, inferred.evidence);
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
  // "PhysicsLab 5&6": zwei Raeume im Namen, die Funktion gehoert zum gemeinsamen Bereich, solange das nicht das ganze Gebaeude ist.
  const common = multiRoomName ? commonSpace(nameRooms, graph) : undefined;
  if (common && common.type !== "Building") {
    claim("room", common.id, "name", MULTI_ROOM_CONFIDENCE, `mehrere Räume im Namen "${node.ga.name}", gemeinsamer Bereich "${common.name}"`);
  }
  let multiRoomRange = false;
  for (const range of [...ranges].reverse()) {
    const rangeRooms = distinct(range.rooms.matches.map((match) => match.spaceId));
    const first = range.rooms.matches[0];
    if (rangeRooms.length === 1 && first) {
      // Ein Bereich statt eines Raums ("Circulation Ground & Upper") ist nur ein grober Rahmen und ueberstimmt keinen Raum im Namen.
      const area = !ROOM_LIKE.has(graph.spaces.get(first.spaceId)?.space.type ?? "");
      claim("room", first.spaceId, "hierarchy", ROOM_CONFIDENCE[first.kind] - RANGE_PENALTY - (area ? AREA_PENALTY : 0), `Gruppenbereich "${range.text}"`);
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
    // Raumregler sitzen meist im geregelten Raum, Taster oft nebenan; ein Raum im Namen wiegt schwerer.
    const confidence = tradeGuess === "hvac" ? 0.7 : 0.5;
    claim("room", deviceRoom, "device-location", confidence, "Einbauort der verknüpften Bedien- und Sensorgeräte");
  }
  const central = anyMarker("central");
  const buildings = graph.loaded.project.spaces.filter((space) => space.type === "Building");
  const building = buildings.length === 1 ? buildings[0] : undefined;
  if (central && building && !claims.some((entry) => entry.dimension === "room" && entry.source !== "hierarchy")) {
    claim("room", building.id, "name", 0.6, "Zentralfunktion, gilt für das Gebäude");
  }
  // Ohne jeden Raumhinweis liegt das Thing auf Gebaeudeebene; das ist weniger genau, aber nicht falsch und braucht keine Rueckfrage.
  if (building && !outdoor && !claims.some((entry) => entry.dimension === "room")) {
    claim("room", building.id, "default", BUILDING_FALLBACK_CONFIDENCE, "kein Raum in Name, Gruppenbereich oder Einbauort; gilt für das Gebäude");
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
    label: name.label,
    objectAspects: objectAspects(node, graph),
    claims,
  };
}

/** Funktionstexte der Herstellerobjekte, die eine Aufgabe eindeutig benennen; Sperre vor Praesenz ("Presence block"). */
const OBJECT_ASPECTS: readonly (readonly [RegExp, Aspect])[] = [
  [/(disable|enable|block|sperr|freigab)/, "lock"],
  [/(presence|pr(ä|ae)senz|occupan|anwesenheit)/, "presence"],
  [/(actuating value|continuous variable|control value|stellgr(ö|oe)|stellwert)/, "valve"],
  [/(forced|zwang)/, "forced"],
  [/(summer|sommer)/, "summer"],
  [/(text indication|textmeldung|text message)/, "text"],
  [/(counter|z(ä|ae)hlerstand|impulsz(ä|ae)hler)/, "counter"],
];

function objectAspects(node: GaNode, graph: ProjectGraph): Aspect[] {
  const links = node.links.filter((link) => !isNeutral(link));
  const ordered = [...links.filter((link) => isActuatorLink(link, graph)), ...links.filter((link) => !isActuatorLink(link, graph))];
  const result: Aspect[] = [];
  for (const link of ordered) {
    const text = objectText(link);
    const hit = OBJECT_ASPECTS.find(([pattern]) => pattern.test(text));
    if (hit && !result.includes(hit[1])) result.push(hit[1]);
  }
  return result;
}

/** Naechster gemeinsamer Vorfahr mehrerer Raeume in der Gebaeudestruktur. */
function commonSpace(ids: readonly string[], graph: ProjectGraph): Space | undefined {
  const chain = (id: string): Space[] => {
    const result: Space[] = [];
    let current = graph.spaces.get(id)?.space;
    while (current) {
      result.push(current);
      current = current.parentId ? graph.spaces.get(current.parentId)?.space : undefined;
    }
    return result;
  };
  const [head, ...rest] = ids.map(chain);
  if (!head) return undefined;
  // Der Raum selbst zaehlt nicht: Liegt einer im anderen, ist der aeussere der gemeinsame Bereich.
  return head.find((space) => rest.every((other) => other.some((entry) => entry.id === space.id)));
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
