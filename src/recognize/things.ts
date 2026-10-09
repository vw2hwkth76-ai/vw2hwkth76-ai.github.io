import { dptMainNumber } from "../ets/dpt-id.ts";
import type { Direction } from "../graph/direction.ts";
import { type Aspect, ASPECTS, isTrade, type Trade } from "./lexicon.ts";
import type { GaRecognition, Recognition, ThingDraft } from "./recognize.ts";

/**
 * Thing-Typen und Rollen. Wo die KNX einen Funktionstyp normiert
 * (knx_master.xml, FT-x), tragen Typ und Rollen dessen Namen; Ergaenzungen
 * fuer Faelle ohne Norm sind als solche erkennbar (kein FT).
 */

export type ThingType =
  | "SwitchableLight"
  | "DimmableLight"
  | "SunProtection"
  | "Heating"
  | "Ventilation"
  | "Socket"
  | "WindowContact"
  | "Alarm"
  | "Presence"
  | "Weather"
  | "Scene"
  | "Meter"
  | "System"
  | "Generic";

export const THING_FUNCTION_TYPE: Readonly<Partial<Record<ThingType, string>>> = {
  SwitchableLight: "FT-1",
  DimmableLight: "FT-6",
  SunProtection: "FT-7",
  Heating: "FT-9",
  Socket: "FT-10",
};

export interface Thing {
  readonly draft: ThingDraft;
  readonly type: ThingType;
  readonly functionType: string | undefined;
  /** GA-Id auf Rolle, z. B. "SwitchOnOff" oder "InfoOnOff". */
  readonly roles: ReadonlyMap<string, string>;
}

/** marked: Der Name traegt ein Rueckmelde-Kennwort ("Status_Valve"). */
type RoleRule = (direction: Direction | undefined, main: number | undefined, marked: boolean) => string | undefined;

const BY_DIRECTION = (command: string, status: string): RoleRule => (direction) =>
  direction === "status" ? status : direction === "command" ? command : undefined;

/**
 * Haupttypen, die eine Rolle zulaesst. Passt der entschiedene DPT nicht,
 * ist der Begriff im Namen etwas anderes ("Power_Status" mit 1 Bit ist
 * keine Leistung), und die naechste Deutung kommt zum Zug.
 */
const ROLE_MAINS: Readonly<Record<string, readonly number[]>> = {
  SwitchOnOff: [1],
  InfoOnOff: [1],
  DimmingControl: [3],
  DimmingValue: [5],
  InfoDimmingValue: [5],
  MoveUpDown: [1],
  StopStepUpDown: [1],
  AbsolutePositionBlindsPercentage: [5],
  CurrentAbsolutePositionBlindsPercentage: [5],
  AbsolutePositionSlatPercentage: [5],
  CurrentAbsolutePositionSlatPercentage: [5],
  TempRoom: [9, 14],
  TempRoomSetpoint: [9, 14, 6, 1],
  InfoTempRoomSetpoint: [9, 14],
  HVACMode: [20],
  ComfortMode: [1],
  NightMode: [1],
  FrostProtectionMode: [1],
  StandbyMode: [1],
  ValvePosition: [5],
  ActualValvePosition: [5],
  ValveSwitch: [1],
  HeatingStatus: [1],
  DamperPosition: [5],
  AirQuality: [9, 5],
  WindowStatus: [1],
  Presence: [1],
  PresenceTrigger: [1],
  Alarm: [1, 5],
  ForcedPosition: [1, 2],
  SummerMode: [1],
  HeatCoolMode: [1],
  TempOutside: [9, 14],
  TextMessage: [16],
  SetpointShift: [9, 6, 1, 14],
  HeatingDemand: [1, 5],
  CoolingDemand: [1, 5],
  MeterReading: [7, 8, 12, 13, 14],
  WindAlarm: [1],
  WindSpeed: [9, 14],
  RainAlarm: [1],
  Illuminance: [9],
  Time: [10, 19],
  Date: [11, 19],
  OperatingStatus: [1],
  Reset: [1],
  Lock: [1],
  SceneControl: [17, 18],
  InfoScene: [17],
  Energy: [12, 13, 14],
  Power: [9, 14],
};

function fitsRole(role: string, main: number | undefined): boolean {
  const mains = ROLE_MAINS[role];
  return main === undefined || mains === undefined || mains.includes(main);
}

const ROLES: Readonly<Partial<Record<Trade | "any", Partial<Record<Aspect, RoleRule>>>>> = {
  lighting: {
    switch: BY_DIRECTION("SwitchOnOff", "InfoOnOff"),
    dim: () => "DimmingControl",
    // "Brightness" als Messwert in Lux ist ein Helligkeitssensor, kein Dimmwert.
    value: (direction, main, marked) => (main === 9 ? "Illuminance" : BY_DIRECTION("DimmingValue", "InfoDimmingValue")(direction, main, marked)),
    presence: () => "Presence",
  },
  socket: { switch: BY_DIRECTION("SwitchOnOff", "InfoOnOff") },
  shading: {
    move: () => "MoveUpDown",
    step: () => "StopStepUpDown",
    position: BY_DIRECTION("AbsolutePositionBlindsPercentage", "CurrentAbsolutePositionBlindsPercentage"),
    slat: BY_DIRECTION("AbsolutePositionSlatPercentage", "CurrentAbsolutePositionSlatPercentage"),
    wind: () => "WindAlarm",
    rain: () => "RainAlarm",
  },
  hvac: {
    // Eine Temperatur, die gesetzt wird, ist ein Sollwert ("Soll-Temp").
    temperature: BY_DIRECTION("TempRoomSetpoint", "TempRoom"),
    setpoint: BY_DIRECTION("TempRoomSetpoint", "InfoTempRoomSetpoint"),
    mode: () => "HVACMode",
    modeComfort: () => "ComfortMode",
    modeNight: () => "NightMode",
    modeFrost: () => "FrostProtectionMode",
    modeStandby: () => "StandbyMode",
    // Die Stellgroesse kommt vom Regler, die Ist-Stellung meldet der Antrieb zurueck.
    valve: (_direction, _main, marked) => (marked ? "ActualValvePosition" : "ValvePosition"),
    heat: () => "ValveSwitch",
    window: () => "WindowStatus",
    damper: () => "DamperPosition",
    airQuality: () => "AirQuality",
    summer: () => "SummerMode",
    heatCool: () => "HeatCoolMode",
    setpointShift: () => "SetpointShift",
    heatingDemand: () => "HeatingDemand",
    coolingDemand: () => "CoolingDemand",
  },
  monitoring: {
    // Temperatur einer Wetterstation ist die Aussentemperatur.
    temperature: () => "TempOutside",
  },
  any: {
    window: () => "WindowStatus",
    presence: () => "Presence",
    alarm: () => "Alarm",
    wind: (_direction, main) => (main === 9 || main === 14 ? "WindSpeed" : "WindAlarm"),
    rain: () => "RainAlarm",
    value: (_direction, main) => (main === 9 ? "Illuminance" : undefined),
    damper: () => "DamperPosition",
    airQuality: () => "AirQuality",
    forced: () => "ForcedPosition",
    summer: () => "SummerMode",
    heatCool: () => "HeatCoolMode",
    text: () => "TextMessage",
    counter: () => "MeterReading",
    lux: () => "Illuminance",
    trigger: () => "PresenceTrigger",
    errorCode: () => "ErrorCode",
    setpointShift: () => "SetpointShift",
    time: () => "Time",
    date: () => "Date",
    operating: () => "OperatingStatus",
    reset: () => "Reset",
    lock: () => "Lock",
    scene: BY_DIRECTION("SceneControl", "InfoScene"),
    energy: () => "Energy",
    power: () => "Power",
    switch: BY_DIRECTION("SwitchOnOff", "InfoOnOff"),
  },
};

/** Aspekt aus dem Datenpunkttyp, wenn weder Name noch Gruppenbereich einen nennen. */
const DPT_ASPECT: Readonly<Record<string, Aspect>> = {
  "DPST-1-1": "switch",
  "DPST-1-8": "move",
  "DPST-1-7": "step",
  "DPST-3-7": "dim",
  "DPST-9-1": "temperature",
  "DPST-20-102": "mode",
  "DPST-1-19": "window",
  "DPST-10-1": "time",
  "DPST-11-1": "date",
  "DPST-1-5": "alarm",
  "DPST-1-18": "presence",
  "DPST-1-100": "heatCool",
  "DPST-16-0": "text",
  "DPST-16-1": "text",
  "DPST-12-1": "counter",
  "DPST-13-10": "energy",
  "DPST-13-13": "energy",
};

/** Begriffe, die im Licht einen Ort meinen ("Fensterreihe", "Window_Switch"), keine Funktion. */
const LOCATION_ASPECTS: Readonly<Partial<Record<Trade, ReadonlySet<Aspect>>>> = {
  lighting: new Set<Aspect>(["window"]),
  socket: new Set<Aspect>(["window"]),
};
const NO_ASPECTS: ReadonlySet<Aspect> = new Set();

/**
 * Moegliche Aspekte einer GA, beste zuerst: aus dem Namen, den Texten der
 * verknuepften Objekte, dem Gruppenbereich und zuletzt dem DPT; je Quelle der
 * mit dem entschiedenen Untertyp vor dem mit gleichem Haupttyp ("PIRDisable"
 * mit 1.003 ist eine Sperre, keine Praesenz).
 */
function aspectCandidates(entry: GaRecognition, ignore: ReadonlySet<Aspect>): Aspect[] {
  const { name, ranges } = entry.analysis;
  const dpt = entry.decisions.dpt.winner?.value;
  const main = dpt ? dptMainNumber(dpt) : undefined;
  const rank = (aspect: Aspect): number => {
    const typical = ASPECTS[aspect].dpt;
    if (typical !== undefined && typical === dpt) return 0;
    if (typical !== undefined && main !== undefined && dptMainNumber(typical) === main) return 1;
    return 2;
  };
  const ordered = (aspects: readonly Aspect[]): Aspect[] =>
    aspects.filter((aspect) => !ignore.has(aspect)).map((aspect, index) => ({ aspect, index })).sort((a, b) => rank(a.aspect) - rank(b.aspect) || a.index - b.index).map((item) => item.aspect);
  const fromRanges = [...ranges].reverse().flatMap((range) => ordered(range.aspects));
  const fromDpt = dpt ? DPT_ASPECT[dpt] : undefined;
  return [...new Set([...ordered(name.aspects), ...ordered(entry.analysis.objectAspects), ...fromRanges, ...(fromDpt ? [fromDpt] : [])])];
}

/** Aspekt einer GA; bei mehreren der, dessen typischer DPT zum entschiedenen passt ("Dimming value" mit 5.001). */
export function aspectOf(entry: GaRecognition): Aspect | undefined {
  return aspectCandidates(entry, NO_ASPECTS)[0];
}


export function directionOf(entry: GaRecognition): Direction | undefined {
  const value = entry.decisions.direction.winner?.value;
  return value === "command" || value === "status" || value === "alarm" ? value : undefined;
}

/** Rolle eines blossen "Status" ohne weiteren Begriff, nach Gewerk und Haupttyp. */
function statusRole(trade: string | undefined, main: number | undefined): string | undefined {
  if (trade === "hvac") return main === 5 ? "ValvePosition" : main === undefined || main === 1 ? "HeatingStatus" : undefined;
  if (trade === "lighting") return main === 5 ? "InfoDimmingValue" : main === undefined || main === 1 ? "InfoOnOff" : undefined;
  if (trade === "socket") return main === undefined || main === 1 ? "InfoOnOff" : undefined;
  return undefined;
}

export function roleOf(entry: GaRecognition, trade: string | undefined): string | undefined {
  const direction = directionOf(entry);
  const dpt = entry.decisions.dpt.winner?.value;
  const main = dpt ? dptMainNumber(dpt) : undefined;
  const ignore = (isTrade(trade) ? LOCATION_ASPECTS[trade] : undefined) ?? NO_ASPECTS;
  const bare = entry.analysis.name.aspects.every((aspect) => ignore.has(aspect));
  // Eine Meldung ohne weiteren Begriff ("AlarmHeatingState") ist eine Meldung, kein Heizstatus.
  if (entry.analysis.name.markers.has("alarm") && bare && fitsRole("Alarm", main)) return "Alarm";
  // Ein blosses Kennwort im Namen ("Status") geht vor dem Aspekt des Gruppenbereichs ("Heizen").
  if (entry.analysis.name.markers.has("status") && bare) {
    const role = statusRole(trade, main);
    if (role) return role;
  }
  for (const aspect of aspectCandidates(entry, ignore)) {
    const rules = [isTrade(trade) ? ROLES[trade]?.[aspect] : undefined, ROLES.any?.[aspect]];
    for (const rule of rules) {
      const role = rule?.(direction, main, entry.analysis.name.markers.has("status"));
      if (role && fitsRole(role, main)) return role;
    }
  }
  return undefined;
}

export function typeThings(recognition: Recognition): Thing[] {
  return recognition.things.map((draft) => {
    const members = draft.groupAddressIds
      .map((id) => recognition.byGroupAddressId.get(id))
      .filter((entry) => entry !== undefined);
    const roles = new Map<string, string>();
    for (const member of members) {
      const role = roleOf(member, draft.trade);
      if (role) roles.set(member.analysis.node.ga.id, role);
    }
    const type = thingType(draft.trade, new Set(roles.values()));
    return { draft, type, functionType: THING_FUNCTION_TYPE[type], roles };
  });
}

function thingType(trade: string | undefined, roles: ReadonlySet<string>): ThingType {
  switch (trade) {
    case "lighting":
      return [...roles].some((role) => role.startsWith("Dimming") || role.includes("DimmingValue")) ? "DimmableLight" : "SwitchableLight";
    case "shading":
      return "SunProtection";
    case "hvac": {
      if (roles.has("WindowStatus") && roles.size === 1) return "WindowContact";
      const airside = [...roles].some((role) => role === "DamperPosition" || role === "AirQuality");
      const waterside = [...roles].some((role) => /Temp|Valve|Heating|Mode$/.test(role) && role !== "SummerMode");
      return airside && !waterside ? "Ventilation" : "Heating";
    }
    case "socket":
      return "Socket";
    case "scene":
      return "Scene";
    case "metering":
      return "Meter";
    case "system":
      return "System";
    case "monitoring":
      if (roles.has("WindowStatus")) return "WindowContact";
      if (roles.has("Presence") || roles.has("PresenceTrigger")) return "Presence";
      if (roles.has("WindAlarm") || roles.has("RainAlarm")) return "Weather";
      return "Alarm";
    default:
      return "Generic";
  }
}
