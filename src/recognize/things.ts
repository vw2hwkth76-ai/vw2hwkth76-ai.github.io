import { dptMainNumber } from "../ets/dpt-id.ts";
import type { Direction } from "../graph/direction.ts";
import { type Aspect, ASPECTS, type Trade } from "./lexicon.ts";
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

type RoleRule = (direction: Direction | undefined) => string | undefined;

const BY_DIRECTION = (command: string, status: string): RoleRule => (direction) =>
  direction === "status" ? status : direction === "command" ? command : undefined;

const ROLES: Readonly<Partial<Record<Trade | "any", Partial<Record<Aspect, RoleRule>>>>> = {
  lighting: {
    switch: BY_DIRECTION("SwitchOnOff", "InfoOnOff"),
    dim: () => "DimmingControl",
    value: BY_DIRECTION("DimmingValue", "InfoDimmingValue"),
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
    valve: () => "ValvePosition",
    heat: () => "ValveSwitch",
    window: () => "WindowStatus",
  },
  any: {
    window: () => "WindowStatus",
    presence: () => "Presence",
    alarm: () => "Alarm",
    wind: () => "WindAlarm",
    rain: () => "RainAlarm",
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
};

/** Aspekt einer GA; bei mehreren der, dessen typischer DPT zum entschiedenen passt ("Dimming value" mit 5.001). */
export function aspectOf(entry: GaRecognition): Aspect | undefined {
  const { name, ranges } = entry.analysis;
  const dpt = entry.decisions.dpt.winner?.value;
  const main = dpt ? dptMainNumber(dpt) : undefined;
  const fitting = (aspects: readonly Aspect[]): Aspect | undefined => {
    const typed = ASPECTS;
    return aspects.find((aspect) => {
      const typical = typed[aspect].dpt;
      return main !== undefined && typical !== undefined && dptMainNumber(typical) === main;
    }) ?? aspects[0];
  };
  const fromRange = [...ranges].reverse().find((range) => range.aspects.length > 0)?.aspects;
  return fitting(name.aspects) ?? (fromRange ? fitting(fromRange) : undefined) ?? (dpt ? DPT_ASPECT[dpt] : undefined);
}

const TRADES = new Set<string>(["lighting", "shading", "hvac", "monitoring", "metering", "system", "scene", "socket"]);
const isTrade = (value: string | undefined): value is Trade => value !== undefined && TRADES.has(value);

export function directionOf(entry: GaRecognition): Direction | undefined {
  const value = entry.decisions.direction.winner?.value;
  return value === "command" || value === "status" || value === "alarm" ? value : undefined;
}

export function roleOf(entry: GaRecognition, trade: string | undefined): string | undefined {
  const direction = directionOf(entry);
  // Ein blosses Kennwort im Namen ("Status") geht vor dem Aspekt des Gruppenbereichs ("Heizen").
  if (entry.analysis.name.markers.has("status") && entry.analysis.name.aspects.length === 0) {
    if (trade === "hvac") return "HeatingStatus";
    if (trade === "lighting" || trade === "socket") return "InfoOnOff";
  }
  const aspect = aspectOf(entry);
  if (!aspect) return undefined;
  const specific = isTrade(trade) ? ROLES[trade]?.[aspect] : undefined;
  return (specific ?? ROLES.any?.[aspect])?.(direction);
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
    case "hvac":
      return roles.has("WindowStatus") && roles.size === 1 ? "WindowContact" : "Heating";
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
      if (roles.has("Presence")) return "Presence";
      if (roles.has("WindAlarm") || roles.has("RainAlarm")) return "Weather";
      return "Alarm";
    default:
      return "Generic";
  }
}
