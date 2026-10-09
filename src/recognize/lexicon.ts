import type { Direction } from "../graph/direction.ts";
import type { Token } from "./text.ts";

/**
 * Fachvokabular fuer KNX-Namen, deutsch und englisch, in Vergleichsform
 * (klein, Umlaute ausgeschrieben). Bewusst klein gehalten: Was hier steht,
 * ist an echten Projekten beobachtet oder Standardbegriff der Gewerke.
 */

export type Trade = "lighting" | "shading" | "hvac" | "monitoring" | "metering" | "system" | "scene" | "socket";

export type Aspect =
  | "switch"
  | "dim"
  | "value"
  | "move"
  | "step"
  | "position"
  | "slat"
  | "temperature"
  | "setpoint"
  | "mode"
  | "modeComfort"
  | "modeNight"
  | "modeFrost"
  | "modeStandby"
  | "heat"
  | "valve"
  | "window"
  | "presence"
  | "alarm"
  | "wind"
  | "rain"
  | "time"
  | "date"
  | "operating"
  | "reset"
  | "lock"
  | "scene"
  | "energy"
  | "power"
  | "damper"
  | "airQuality"
  | "forced"
  | "summer"
  | "heatCool"
  | "text"
  | "counter"
  | "lux"
  | "setpointShift"
  | "errorCode"
  | "trigger"
  | "heatingDemand"
  | "coolingDemand";

export type Marker = "status" | "command" | "alarm" | "central" | "outOfUse" | "outdoor";

export const TRADES: readonly Trade[] = ["lighting", "shading", "hvac", "monitoring", "metering", "system", "scene", "socket"];
export const MARKERS: readonly Marker[] = ["status", "command", "alarm", "central", "outOfUse", "outdoor"];

export function isTrade(value: unknown): value is Trade {
  return typeof value === "string" && (TRADES as readonly string[]).includes(value);
}

export function isMarker(value: unknown): value is Marker {
  return typeof value === "string" && (MARKERS as readonly string[]).includes(value);
}

export interface WordInfo {
  readonly trade?: Trade;
  readonly aspect?: Aspect;
  readonly marker?: Marker;
}

export interface AspectInfo {
  /** Richtung, wenn kein Marker etwas anderes sagt; undefined bei mehrdeutigen Begriffen. */
  readonly direction: Direction | undefined;
  readonly dpt: string | undefined;
  readonly trade: Trade | undefined;
}

export const ASPECTS: Readonly<Record<Aspect, AspectInfo>> = {
  switch: { direction: "command", dpt: "DPST-1-1", trade: undefined },
  dim: { direction: "command", dpt: "DPST-3-7", trade: "lighting" },
  value: { direction: undefined, dpt: "DPST-5-1", trade: undefined },
  move: { direction: "command", dpt: "DPST-1-8", trade: "shading" },
  step: { direction: "command", dpt: "DPST-1-7", trade: "shading" },
  position: { direction: undefined, dpt: "DPST-5-1", trade: "shading" },
  slat: { direction: undefined, dpt: "DPST-5-1", trade: "shading" },
  temperature: { direction: "status", dpt: "DPST-9-1", trade: "hvac" },
  setpoint: { direction: "command", dpt: "DPST-9-1", trade: "hvac" },
  mode: { direction: "command", dpt: "DPST-20-102", trade: "hvac" },
  modeComfort: { direction: "command", dpt: undefined, trade: "hvac" },
  modeNight: { direction: "command", dpt: undefined, trade: "hvac" },
  modeFrost: { direction: "command", dpt: undefined, trade: "hvac" },
  modeStandby: { direction: "command", dpt: undefined, trade: "hvac" },
  heat: { direction: "command", dpt: undefined, trade: "hvac" },
  valve: { direction: "status", dpt: "DPST-5-1", trade: "hvac" },
  window: { direction: "status", dpt: "DPST-1-19", trade: undefined },
  presence: { direction: "status", dpt: "DPST-1-18", trade: "monitoring" },
  alarm: { direction: "alarm", dpt: "DPST-1-5", trade: "monitoring" },
  wind: { direction: "status", dpt: undefined, trade: "monitoring" },
  rain: { direction: "status", dpt: undefined, trade: "monitoring" },
  time: { direction: "status", dpt: "DPST-10-1", trade: "system" },
  date: { direction: "status", dpt: "DPST-11-1", trade: "system" },
  operating: { direction: "status", dpt: "DPST-1-2", trade: "system" },
  reset: { direction: "command", dpt: "DPST-1-15", trade: "system" },
  lock: { direction: "command", dpt: "DPST-1-3", trade: undefined },
  scene: { direction: "command", dpt: undefined, trade: "scene" },
  energy: { direction: "status", dpt: "DPST-13-13", trade: "metering" },
  power: { direction: "status", dpt: "DPST-14-56", trade: "metering" },
  damper: { direction: "command", dpt: "DPST-5-1", trade: "hvac" },
  airQuality: { direction: "status", dpt: "DPST-9-8", trade: "hvac" },
  forced: { direction: "command", dpt: undefined, trade: undefined },
  summer: { direction: "command", dpt: "DPST-1-1", trade: "hvac" },
  heatCool: { direction: "command", dpt: "DPST-1-100", trade: "hvac" },
  text: { direction: "status", dpt: "DPST-16-0", trade: undefined },
  counter: { direction: "status", dpt: "DPST-12-1", trade: "metering" },
  lux: { direction: "status", dpt: "DPST-9-4", trade: "lighting" },
  errorCode: { direction: "status", dpt: undefined, trade: undefined },
  trigger: { direction: "status", dpt: "DPT-1", trade: undefined },
  heatingDemand: { direction: undefined, dpt: undefined, trade: "hvac" },
  coolingDemand: { direction: undefined, dpt: undefined, trade: "hvac" },
  setpointShift: { direction: "command", dpt: "DPST-9-2", trade: "hvac" },
};

export function isAspect(value: unknown): value is Aspect {
  return typeof value === "string" && Object.hasOwn(ASPECTS, value);
}

const words = new Map<string, WordInfo>();
/** Stammformen, die auch als Wortanfang in Komposita zaehlen ("Rollladensteuerung"). */
const prefixes = new Map<string, WordInfo>();
/** Grundwoerter, die als Wortende in Komposita zaehlen ("Kuechenfenster"). */
const suffixes = new Map<string, WordInfo>();

function add(info: WordInfo, list: string, mode: "word" | "prefix" | "suffix" | "both" = "word"): void {
  for (const word of list.split(" ")) {
    words.set(word, info);
    if (mode === "prefix" || mode === "both") prefixes.set(word, info);
    if (mode === "suffix" || mode === "both") suffixes.set(word, info);
  }
}

add({ marker: "status" }, "rm rueckmeldung rueckm rueck status stat sta feedback fb state info ist istwert actual current aktuell aktueller aktuelle zustand messwert");
add({ marker: "command" }, "soll cmd befehl set");
add({ marker: "alarm" }, "alarm alarme alert alerts warnung warning feuer fire brand rauch smoke stoerung stoer fault failure fehler error ueberlast overload ausgeloest sabotage leckage leck einbruch panik ausfall kurzschluss");
add({ marker: "alarm" }, "fault", "suffix");
add({ marker: "status", aspect: "errorCode" }, "fehlercode errorcode");
add({ aspect: "heatingDemand", trade: "hvac" }, "heizanforderung waermeanforderung");
add({ aspect: "coolingDemand", trade: "hvac" }, "kuehlanforderung");
add({ marker: "alarm" }, "alarm stoermeldung", "suffix");
add({ marker: "central" }, "zentral central zentrale gesamt global");
add({ marker: "outOfUse" }, "unbenutzt stillgelegt unused spare reserve dummy");
add({ marker: "outdoor" }, "aussen outdoor outside aussenanlage aussenbereich", "prefix");

add({ trade: "lighting" }, "licht light lights leuchte leuchten lampe lamp beleuchtung lighting spot spots downlight led dali dimmer stripe", "both");
add({ trade: "shading" }, "rollladen rolladen rollo jalousie jalousien raffstore raffstoren markise markiese beschattung sonnenschutz blind blinds shutter shutters shade shading awning vorhang behang", "both");
add({ trade: "hvac" }, "heizung heating hzg kuehlen kuehlung cooling klima hvac lueftung ventilation luefter fan radiator heizkoerper fussbodenheizung fbh thermostat rtr rtc extract abluft zuluft exhaust fume", "both");
add({ trade: "hvac", aspect: "heat" }, "heizen heat heiz", "prefix");
add({ trade: "monitoring" }, "ueberwachung monitoring sicherheit security wetter weather melder", "both");
add({ trade: "metering" }, "zaehler zaehlerstand verbrauch meter metering kwh", "both");
add({ trade: "system" }, "system diagnose sonderfunktionen bus spannung voltage sv");
add({ trade: "socket" }, "steckdose steckdosen socket sockets outlet", "both");

add({ aspect: "switch" }, "schalten schalt switching switch onoff");
add({ aspect: "dim" }, "dimmen dimming dim");
add({ aspect: "value", trade: "lighting" }, "helligkeit brightness dimmwert");
add({ aspect: "value" }, "wert value absolut");
add({ aspect: "move" }, "lang langzeit langzeitbetrieb fahren movement move updown aufab");
add({ aspect: "step" }, "kurz kurzzeit kurzzeitbetrieb step stop stopp schritt");
add({ aspect: "position" }, "position pos hoehe height behangposition");
add({ aspect: "slat" }, "lamelle lamellen slat slats lamellenposition");
add({ aspect: "temperature" }, "temperatur temperature temp raumtemperatur", "both");
add({ aspect: "setpoint" }, "sollwert setpoint solltemperatur", "suffix");
add({ aspect: "setpointShift" }, "sollwertverschiebung setpointshift");
add({ aspect: "lux" }, "lux luxlevel beleuchtungsstaerke illuminance");
add({ aspect: "mode" }, "betriebsart betriebsmodus betriebsm modus mode");
add({ aspect: "modeComfort" }, "komfort kompf comfort");
add({ aspect: "modeNight" }, "nacht night nachtabsenkung");
add({ aspect: "modeFrost" }, "frost frostschutz");
add({ aspect: "modeStandby" }, "standby eco economy");
add({ aspect: "valve" }, "stellwert stellgroesse variable ventil valve");
add({ aspect: "window" }, "fenster fensterkontakt window kontakt contact", "suffix");
add({ aspect: "presence" }, "praesenz presence anwesenheit bewegung motion belegung occupancy occupied occ pir", "both");
// "Trigger" eines Praesenzmelders koppelt Master und Slave; er meldet nicht die Belegung des Raums.
add({ aspect: "trigger" }, "trigger");
add({ aspect: "damper", trade: "hvac" }, "damper klappe luftklappe", "suffix");
add({ aspect: "forced" }, "forced zwang zwangsstellung zwangsposition zwangsfuehrung override", "prefix");
add({ aspect: "summer", trade: "hvac" }, "summer sommer sommerbetrieb", "prefix");
add({ aspect: "text" }, "text textmeldung");
add({ aspect: "counter", trade: "metering" }, "counter zaehlerwert impulse impulszaehler");
add({ aspect: "airQuality", trade: "hvac" }, "airquality luftqualitaet co2 voc mischgas", "both");
add({ aspect: "wind" }, "wind windgeschwindigkeit", "prefix");
add({ aspect: "rain" }, "regen rain");
add({ aspect: "time" }, "uhrzeit", "suffix");
add({ aspect: "time" }, "zeit time clock");
add({ aspect: "date" }, "datum date");
add({ aspect: "reset" }, "reset ausloesen");
add({ aspect: "lock" }, "sperre sperren sperrobjekt lock disable freigabe enable");
add({ aspect: "scene", trade: "scene" }, "szene szenen scene scenes stimmung", "both");
add({ aspect: "energy", trade: "metering" }, "energie energy");
add({ aspect: "power", trade: "metering" }, "leistung power watt");

/** Mehrwortbegriffe, die als Ganzes etwas anderes bedeuten als ihre Teile. */
const PHRASES: readonly { readonly words: readonly string[]; readonly info: WordInfo }[] = [
  { words: ["in", "betrieb"], info: { aspect: "operating" } },
  { words: ["out", "of", "use"], info: { marker: "outOfUse" } },
  { words: ["nicht", "benutzt"], info: { marker: "outOfUse" } },
  { words: ["sun", "protection"], info: { trade: "shading" } },
  { words: ["operation", "mode"], info: { aspect: "mode" } },
  { words: ["window", "contact"], info: { aspect: "window" } },
  { words: ["auf", "ab"], info: { aspect: "move" } },
  { words: ["up", "down"], info: { aspect: "move" } },
  { words: ["ein", "aus"], info: { aspect: "switch" } },
  { words: ["on", "off"], info: { aspect: "switch" } },
  { words: ["building", "protection"], info: { aspect: "modeFrost" } },
  { words: ["short", "circuit"], info: { marker: "alarm" } },
  // Ein Fehlercode ist ein Wert, den das Geraet meldet, kein Alarmbit.
  { words: ["error", "code"], info: { marker: "status", aspect: "errorCode" } },
  { words: ["fehler", "code"], info: { marker: "status", aspect: "errorCode" } },
  { words: ["heating", "demand"], info: { aspect: "heatingDemand", trade: "hvac" } },
  { words: ["cooling", "demand"], info: { aspect: "coolingDemand", trade: "hvac" } },
  { words: ["heating", "mode"], info: { aspect: "heatCool", trade: "hvac" } },
  { words: ["occupancy", "mode"], info: { aspect: "mode", trade: "hvac" } },
  { words: ["lux", "level"], info: { aspect: "lux" } },
  { words: ["shift", "setpoint"], info: { aspect: "setpointShift" } },
  { words: ["setpoint", "shift"], info: { aspect: "setpointShift" } },
  { words: ["setpoint", "offset"], info: { aspect: "setpointShift" } },
  { words: ["heating", "cooling"], info: { aspect: "heatCool", trade: "hvac" } },
  { words: ["heizen", "kuehlen"], info: { aspect: "heatCool", trade: "hvac" } },
  { words: ["air", "quality"], info: { aspect: "airQuality", trade: "hvac" } },
];

export interface WordHit {
  /** Tokenpositionen, die der Treffer abdeckt. */
  readonly tokens: readonly number[];
  readonly info: WordInfo;
  readonly how: "word" | "phrase" | "prefix" | "suffix";
}

const MIN_COMPOUND_PART = 4;

/** Findet Fachbegriffe in einer Tokenfolge, Mehrwortbegriffe zuerst. */
/** Woerter ohne eigene Bedeutung im Funktionsnamen ("_Input", "Test"); sie trennen weder Things noch Paare. */
export const FILLER_WORDS: ReadonlySet<string> = new Set(["input", "eingang", "test"]);

/**
 * Zerlegt klein zusammengeschriebene Fachwoerter ("valuelights", "currentsetpoint"),
 * wenn beide Teile im Vokabular stehen. Liefert die Teile oder undefined.
 */
export function splitKnown(word: string): readonly [string, string] | undefined {
  if (word.length < 7 || words.has(word)) return undefined;
  for (let cut = 3; cut <= word.length - 3; cut++) {
    const head = word.slice(0, cut);
    const tail = word.slice(cut);
    if (words.has(head) && words.has(tail)) return [head, tail];
  }
  return undefined;
}

export function findWords(tokens: readonly Token[]): WordHit[] {
  const hits: WordHit[] = [];
  const used = new Set<number>();
  for (const phrase of PHRASES) {
    for (let start = 0; start + phrase.words.length <= tokens.length; start++) {
      const range = phrase.words.map((_, offset) => start + offset);
      if (range.some((index) => used.has(index))) continue;
      if (phrase.words.every((word, offset) => tokens[start + offset]?.norm === word)) {
        hits.push({ tokens: range, info: phrase.info, how: "phrase" });
        for (const index of range) used.add(index);
      }
    }
  }
  for (const token of tokens) {
    if (used.has(token.index)) continue;
    const exact = words.get(token.norm);
    if (exact) {
      hits.push({ tokens: [token.index], info: exact, how: "word" });
      continue;
    }
    const compound = compoundHit(token.norm);
    if (compound) hits.push({ tokens: [token.index], info: compound.info, how: compound.how });
  }
  return hits;
}

/** Grund- und Bestimmungswort eines Kompositums; beide Treffer werden zusammengefuehrt. */
function compoundHit(word: string): { info: WordInfo; how: "prefix" | "suffix" } | undefined {
  const longest = (parts: ReadonlyMap<string, WordInfo>, test: (part: string) => boolean): [string, WordInfo] | undefined => {
    let best: [string, WordInfo] | undefined;
    for (const entry of parts) {
      const part = entry[0];
      if (part.length >= MIN_COMPOUND_PART && word.length > part.length && test(part) && part.length > (best?.[0].length ?? 0)) best = entry;
    }
    return best;
  };
  const suffix = longest(suffixes, (part) => word.endsWith(part));
  const prefix = longest(prefixes, (part) => word.startsWith(part));
  if (!suffix && !prefix) return undefined;
  return { info: { ...prefix?.[1], ...suffix?.[1] }, how: suffix ? "suffix" : "prefix" };
}
