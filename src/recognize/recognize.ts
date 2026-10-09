import { isActuatorLink, isNeutral } from "../graph/direction.ts";
import type { ProjectGraph } from "../graph/evidence-graph.ts";
import { type AnalyzeOptions, analyzeGroupAddress, type GaAnalysis, isCabinet } from "./analyze.ts";
import { type Claim, type ClaimDimension, type Decision, decide } from "./claims.ts";
import type { Aspect } from "./lexicon.ts";
import { RoomMatcher } from "./rooms.ts";

export const DECISION_DIMENSIONS: readonly ClaimDimension[] = ["room", "trade", "direction", "dpt"];

export type BundleSource = "ets-function" | "channel" | "family" | "single";

export interface ThingDraft {
  readonly key: string;
  readonly label: string;
  readonly source: BundleSource;
  readonly groupAddressIds: readonly string[];
  readonly trade: string | undefined;
  readonly roomId: string | undefined;
  readonly central: boolean;
  /** Alle Datenpunkte liegen in stillgelegten Bereichen; nicht fuer den Export gedacht. */
  readonly outOfUse: boolean;
}

export interface GaRecognition {
  readonly analysis: GaAnalysis;
  readonly decisions: Readonly<Record<ClaimDimension, Decision>>;
  readonly thingKey: string;
}

export interface Recognition {
  readonly graph: ProjectGraph;
  readonly groupAddresses: readonly GaRecognition[];
  readonly byGroupAddressId: ReadonlyMap<string, GaRecognition>;
  readonly things: readonly ThingDraft[];
}

const STRONG_CHANNEL_SOURCES = new Set(["ets-channel", "manufacturer-channel", "text-parameter"]);

export function recognize(graph: ProjectGraph, options: AnalyzeOptions = { useEtsFunctions: true }): Recognition {
  const matcher = new RoomMatcher(graph.loaded.project.spaces);
  const analyses = graph.groupAddresses.map((node) => analyzeGroupAddress(node, graph, matcher, options));

  applyPairs(analyses);
  applyCentralDirection(analyses);

  // Erste Entscheidung, damit Familien Raum und Gewerk kennen.
  const first = new Map(analyses.map((analysis) => [analysis.node.ga.id, decideAll(analysis.claims)]));
  const families = new UnionFind<string>();
  const familyKey = (analysis: GaAnalysis): string => {
    const decided = first.get(analysis.node.ga.id);
    const trade = decided?.trade.winner?.value;
    const tokens = (placeTrade(trade) ? analysis.name.placeTokens : analysis.name.labelTokens)
      .filter((token) => !(trade === "hvac" && analysis.name.hits.some((hit) => hit.tokens.includes(token.index) && hit.info.trade === "hvac")))
      .map((token) => token.norm);
    return [
      analysis.node.ranges[0]?.id ?? "",
      // Licht und Heizung desselben Raums mit leerem Restnamen sind verschiedene Things, ebenso Heizung und Lueftung.
      trade === "hvac" ? `hvac:${climateSide(analysis)}` : (trade ?? ""),
      decided?.room.winner?.value ?? "",
      analysis.central ? "zentral" : "",
      analysis.outOfUse ? "stillgelegt" : "",
      // Meldungen bilden eigene Things, auch wenn ihr Name sonst leer bliebe ("Wind alert").
      analysis.name.markers.has("alarm") ? `alarm:${analysis.name.aspects.join(",")}` : "",
      tokens.join(" "),
    ].join("|");
  };

  const groups = new Map<string, string[]>();
  for (const analysis of analyses) {
    const id = analysis.node.ga.id;
    families.add(id);
    const fn = options.useEtsFunctions ? analysis.node.functions[0]?.function.id : undefined;
    const key = fn ? `fn:${fn}` : `fam:${familyKey(analysis)}`;
    const list = groups.get(key) ?? [];
    list.push(id);
    groups.set(key, list);
  }
  for (const members of groups.values()) for (const id of members.slice(1)) families.union(members[0] ?? id, id);

  // Aktorkanal: GAs am selben Ausgang gehoeren zu einem Thing, auch wenn die Namen auseinanderlaufen.
  const byChannel = new Map<string, string[]>();
  for (const analysis of analyses) {
    if (options.useEtsFunctions && analysis.node.functions.length > 0) continue;
    for (const link of analysis.node.links) {
      const channel = link.comObject.channel;
      if (!channel || !STRONG_CHANNEL_SOURCES.has(channel.source) || !isCabinet(link, graph)) continue;
      const list = byChannel.get(channel.key) ?? [];
      list.push(analysis.node.ga.id);
      byChannel.set(channel.key, list);
    }
  }
  for (const members of byChannel.values()) {
    const tradeOf = (id: string): string | undefined => first.get(id)?.trade.winner?.value;
    for (const id of members.slice(1)) {
      const head = members[0] ?? id;
      const a = tradeOf(head);
      const b = tradeOf(id);
      if (a === undefined || b === undefined || a === b) families.union(head, id);
    }
  }

  // Raumgeraet: Heizungs- und Lueftungs-GAs eines Raums am selben Regler oder Antrieb im Raum gehoeren zu einem Thing,
  // auch wenn die Namen nur die Einzelfunktion nennen ("Summer_Mode", "Basic_Setpoint").
  const byRoomDevice = new Map<string, string[]>();
  for (const analysis of analyses) {
    if (options.useEtsFunctions && analysis.node.functions.length > 0) continue;
    const decided = first.get(analysis.node.ga.id);
    const room = decided?.room.winner?.value;
    if (decided?.trade.winner?.value !== "hvac" || !room || !ROOM_TYPES.has(graph.spaces.get(room)?.space.type ?? "")) continue;
    for (const link of analysis.node.links) {
      if (isCabinet(link, graph) || isNeutral(link)) continue;
      const key = `${link.device.device.id}|${room}|${climateSide(analysis)}`;
      byRoomDevice.set(key, [...(byRoomDevice.get(key) ?? []), analysis.node.ga.id]);
    }
  }
  for (const members of byRoomDevice.values()) for (const id of members.slice(1)) families.union(members[0] ?? id, id);
  // GAs, die als Raumklima eines Raums gebuendelt sind; ihr Thing heisst nach Raum und Teilsystem.
  const climate = new Set<string>();
  for (const members of byRoomDevice.values()) if (members.length > 1) for (const id of members) climate.add(id);
  bundleRoomClimate(analyses, families, first, graph, options, climate);

  propagateWithinFamilies(analyses, families, first);

  const recognitions = analyses.map((analysis) => ({
    analysis,
    decisions: decideAll(analysis.claims),
    thingKey: families.find(analysis.node.ga.id),
  }));
  const byGa = new Map(recognitions.map((entry) => [entry.analysis.node.ga.id, entry]));
  const things = buildThings(recognitions, byChannel, options, climate, graph);
  return { graph, groupAddresses: recognitions, byGroupAddressId: byGa, things };
}

function decideAll(claims: readonly Claim[]): Record<ClaimDimension, Decision> {
  return {
    room: decide(claims, "room"),
    trade: decide(claims, "trade"),
    direction: decide(claims, "direction"),
    dpt: decide(claims, "dpt"),
  };
}

/**
 * Projektkonvention: Gibt es zu "Licht A RM" ein gleichnamiges "Licht A",
 * ist das eine die Rueckmeldung und das andere der Befehl. Datentyp und
 * Raum gelten fuer beide.
 */
function applyPairs(analyses: readonly GaAnalysis[]): void {
  const keyed = new Map<string, GaAnalysis[]>();
  const keyOf = (analysis: GaAnalysis): string => {
    const statusTokens = new Set(
      analysis.name.hits.filter((hit) => hit.info.marker === "status").flatMap((hit) => hit.tokens),
    );
    const rest = analysis.name.tokens.filter((token) => !statusTokens.has(token.index)).map((token) => token.norm);
    return `${analysis.node.ranges[analysis.node.ranges.length - 1]?.id ?? ""}|${rest.join(" ")}`;
  };
  for (const analysis of analyses) {
    const key = keyOf(analysis);
    const list = keyed.get(key) ?? [];
    list.push(analysis);
    keyed.set(key, list);
  }
  for (const members of keyed.values()) {
    const statuses = members.filter((member) => member.name.markers.has("status"));
    const commands = members.filter((member) => !member.name.markers.has("status") && !member.name.markers.has("alarm"));
    if (statuses.length === 0 || commands.length !== 1) continue;
    const command = commands[0];
    if (!command) continue;
    command.claims.push({
      dimension: "direction",
      value: "command",
      source: "pairing",
      confidence: 0.85,
      evidence: `Gegenstück zur Rückmeldung "${statuses[0]?.node.ga.name ?? ""}"`,
    });
    for (const status of statuses) {
      status.claims.push({
        dimension: "direction",
        value: "status",
        source: "pairing",
        confidence: 0.85,
        evidence: `Rückmeldung zu "${command.node.ga.name}"`,
      });
      share(command, status, "dpt", 0.75);
      share(status, command, "dpt", 0.75);
      share(command, status, "room", 0.7);
      share(status, command, "room", 0.7);
    }
  }
}

function share(from: GaAnalysis, to: GaAnalysis, dimension: ClaimDimension, confidence: number): void {
  const best = decide(from.claims, dimension).winner;
  if (!best || best.source === "pairing" || best.source === "family") return;
  to.claims.push({
    dimension,
    value: best.value,
    source: "pairing",
    confidence: Math.min(confidence, best.confidence),
    evidence: `übernommen vom Gegenstück "${from.node.ga.name}" (${best.evidence})`,
  });
}

/** Zentralfunktionen sind Befehle, solange kein Kennwort etwas anderes sagt. */
function applyCentralDirection(analyses: readonly GaAnalysis[]): void {
  for (const analysis of analyses) {
    if (!analysis.central || analysis.name.markers.has("status") || analysis.name.markers.has("alarm")) continue;
    analysis.claims.push({ dimension: "direction", value: "command", source: "name", confidence: 0.7, evidence: "Zentralfunktion" });
  }
}

/** Raum und Gewerk gelten fuer alle Mitglieder einer Familie, sofern sich die Mitglieder einig sind. */
function propagateWithinFamilies(
  analyses: readonly GaAnalysis[],
  families: UnionFind<string>,
  first: ReadonlyMap<string, Record<ClaimDimension, Decision>>,
): void {
  const members = new Map<string, GaAnalysis[]>();
  for (const analysis of analyses) {
    const root = families.find(analysis.node.ga.id);
    const list = members.get(root) ?? [];
    list.push(analysis);
    members.set(root, list);
  }
  for (const group of members.values()) {
    if (group.length < 2) continue;
    for (const dimension of ["room", "trade"] as const) {
      const values = new Map<string, Claim>();
      for (const member of group) {
        const winner = first.get(member.node.ga.id)?.[dimension].winner;
        if (winner && winner.confidence >= 0.6) values.set(winner.value, winner);
      }
      if (values.size !== 1) continue;
      const [value, source] = [...values.entries()][0] ?? [];
      if (value === undefined || !source) continue;
      for (const member of group) {
        if (first.get(member.node.ga.id)?.[dimension].winner) continue;
        member.claims.push({
          dimension,
          value,
          source: "family",
          confidence: 0.6,
          evidence: `wie die übrigen Datenpunkte derselben Funktion (${source.evidence})`,
        });
      }
    }
  }
}

function buildThings(
  recognitions: readonly GaRecognition[],
  byChannel: ReadonlyMap<string, readonly string[]>,
  options: AnalyzeOptions,
  climate: ReadonlySet<string>,
  graph: ProjectGraph,
): ThingDraft[] {
  const language = namingLanguage(recognitions);
  const groups = new Map<string, GaRecognition[]>();
  for (const entry of recognitions) {
    const list = groups.get(entry.thingKey) ?? [];
    list.push(entry);
    groups.set(entry.thingKey, list);
  }
  const channelMembers = new Set([...byChannel.values()].filter((list) => list.length > 1).flat());
  const things: ThingDraft[] = [];
  for (const [key, members] of groups) {
    const etsFunction = options.useEtsFunctions ? members.find((member) => member.analysis.node.functions[0])?.analysis.node.functions[0]?.function : undefined;
    const source: BundleSource = etsFunction
      ? "ets-function"
      : members.length === 1
        ? "single"
        : members.some((member) => channelMembers.has(member.analysis.node.ga.id))
          ? "channel"
          : "family";
    const roomId = mostCommon(members.map((member) => member.decisions.room.winner?.value).filter((value) => value !== undefined));
    const roomName = roomId ? graph.spaces.get(roomId)?.space.name.trim() : undefined;
    const air = members.some((member) => climateSide(member.analysis) === "air");
    const climateLabel =
      members.length > 1 && roomName && members.every((member) => climate.has(member.analysis.node.ga.id))
        ? `${roomName} ${CLIMATE_WORDS[language][air ? "air" : "water"]}`
        : undefined;
    things.push({
      key,
      label: etsFunction?.name ?? climateLabel ?? familyLabel(members) ?? members[0]?.analysis.node.ga.name ?? key,
      source,
      groupAddressIds: members.map((member) => member.analysis.node.ga.id),
      trade: mostCommon(members.map((member) => member.decisions.trade.winner?.value).filter((value) => value !== undefined)),
      roomId,
      central: members.every((member) => member.analysis.central),
      outOfUse: members.every((member) => member.analysis.outOfUse),
    });
  }
  return things;
}

/** Generische Gewerkbegriffe verlieren gegen konkrete Bezeichnungen ("Radiator" vor "heating"). */
const GENERIC_LABELS = new Set(["heating", "heizung", "heizen", "hvac", "licht", "light", "lighting", "beleuchtung", "beschattung", "shading", "rolladen", "rollladen"]);

/**
 * Schema "Ort / Gewerk" ("Ground Floor / Heating"): Nennt die Hauptgruppe
 * kein Gewerk, eine tiefere aber schon, ist das Klima eines Raums darin ein
 * Thing, je Heizung und Lueftung. Die Namen nennen dann nur Einzelfunktionen
 * ("Damper_Text", "Airquality Sensor"). Bei "Gewerk / Funktion" (Style) und
 * "Gewerk / Raum" greift das nicht; dort unterscheiden die Namen die Things.
 * Haben zwei Aktorausgaenge dieselbe Aufgabe, sind es zwei Kreise und es
 * bleibt bei den Familien.
 */
function bundleRoomClimate(
  analyses: readonly GaAnalysis[],
  families: UnionFind<string>,
  first: ReadonlyMap<string, Record<ClaimDimension, Decision>>,
  graph: ProjectGraph,
  options: AnalyzeOptions,
  climate: Set<string>,
): void {
  const groups = new Map<string, GaAnalysis[]>();
  for (const analysis of analyses) {
    if (options.useEtsFunctions && analysis.node.functions.length > 0) continue;
    const decided = first.get(analysis.node.ga.id);
    const room = decided?.room.winner?.value;
    if (decided?.trade.winner?.value !== "hvac" || !room) continue;
    // Nur echte Raeume: Zentralbefehle auf Gebaeude- oder Bereichsebene sind eigene Things.
    if (!ROOM_TYPES.has(graph.spaces.get(room)?.space.type ?? "")) continue;
    const [top, ...deeper] = analysis.ranges;
    if (!top || top.trades.length > 0) continue;
    const scope = [...deeper].reverse().findIndex((range) => range.trades.length > 0);
    if (scope < 0) continue;
    const rangeId = analysis.node.ranges[analysis.node.ranges.length - 1 - scope]?.id ?? "";
    const key = `${rangeId}|${room}|${climateSide(analysis)}`;
    groups.set(key, [...(groups.get(key) ?? []), analysis]);
  }
  for (const members of groups.values()) {
    // Dieselbe Aufgabe in zwei Familien an gleichartigen Geraeten (zwei Aktorausgaenge, zwei Fuehler) heisst zwei Kreise.
    const seen = new Map<string, string>();
    let clash = false;
    for (const member of members) {
      const aspect = member.name.aspects[0] ?? member.objectAspects[0];
      if (!aspect) continue;
      const key = `${aspect}|${linkProfile(member, graph)}`;
      const family = families.find(member.node.ga.id);
      const other = seen.get(key);
      if (other !== undefined && other !== family) clash = true;
      seen.set(key, family);
    }
    if (clash) continue;
    const head = members[0]?.node.ga.id;
    for (const member of members) {
      if (head) families.union(head, member.node.ga.id);
      climate.add(member.node.ga.id);
    }
  }
}

/** Woran eine GA haengt: Aktorausgang, Bediengeraet oder nichts Verwertbares. */
export function linkProfile(analysis: GaAnalysis, graph: ProjectGraph): "actuator" | "device" | "none" {
  const links = analysis.node.links.filter((link) => !isNeutral(link));
  if (links.some((link) => isActuatorLink(link, graph))) return "actuator";
  return links.length > 0 ? "device" : "none";
}

const CLIMATE_WORDS = { de: { air: "Lüftung", water: "Heizung" }, en: { air: "Ventilation", water: "Heating" } } as const;
const GERMAN_HINTS = new Set(["licht", "leuchte", "heizung", "heizen", "rollladen", "rolladen", "jalousie", "lueftung", "kueche", "wohnzimmer", "schlafzimmer", "flur", "zentral", "schalten", "dimmen", "sollwert", "istwert", "rueckmeldung"]);
const ENGLISH_HINTS = new Set(["light", "lights", "lighting", "heating", "blind", "blinds", "shutter", "ventilation", "kitchen", "living", "bedroom", "central", "switching", "switch", "dimming", "setpoint", "status", "temperature"]);

/** Sprache der Projektbenennung, damit erzeugte Titel nicht Deutsch und Englisch mischen. */
function namingLanguage(recognitions: readonly GaRecognition[]): "de" | "en" {
  let german = 0;
  let english = 0;
  for (const entry of recognitions) {
    for (const token of entry.analysis.name.tokens) {
      if (GERMAN_HINTS.has(token.norm)) german++;
      if (ENGLISH_HINTS.has(token.norm)) english++;
    }
  }
  return english > german ? "en" : "de";
}

const ROOM_TYPES = new Set(["Room", "Corridor", "Stairway", "Stairs", "Space"]);

/** Luftseitige Begriffe: Klappen und Luftqualitaet gehoeren zur Lueftung, nicht zur Heizung des Raums. */
const AIR_ASPECTS = new Set<Aspect>(["damper", "airQuality"]);

function climateSide(analysis: GaAnalysis): "air" | "water" {
  return [analysis.name, ...analysis.ranges].some((name) => name.aspects.some((aspect) => AIR_ASPECTS.has(aspect))) ? "air" : "water";
}

/** Gewerke, in denen Ortsbegriffe wie "Window" Things unterscheiden. */
function placeTrade(trade: string | undefined): boolean {
  return trade === "lighting" || trade === "socket";
}

function familyLabel(members: readonly GaRecognition[]): string | undefined {
  const labels = members
    .map((member) => (placeTrade(member.decisions.trade.winner?.value) ? member.analysis.name.placeLabel : member.analysis.label))
    .filter((label) => label !== "");
  const specific = labels.filter((label) => !GENERIC_LABELS.has(label.toLowerCase()));
  return mostCommon(specific.length > 0 ? specific : labels);
}

function mostCommon(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: [string, number] | undefined;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best?.[0];
}

class UnionFind<T> {
  readonly #parent = new Map<T, T>();

  add(value: T): void {
    if (!this.#parent.has(value)) this.#parent.set(value, value);
  }

  find(value: T): T {
    this.add(value);
    let root = value;
    while (this.#parent.get(root) !== root) root = this.#parent.get(root) ?? root;
    let current = value;
    while (current !== root) {
      const next = this.#parent.get(current) ?? root;
      this.#parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: T, b: T): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.#parent.set(rootB, rootA);
  }
}
