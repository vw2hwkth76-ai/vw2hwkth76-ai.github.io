import { dptDotted } from "../ets/dpt-id.ts";
import type { MasterData } from "../ets/master-data.ts";
import type { ClaimDimension, ClaimSource } from "../recognize/claims.ts";
import type { Aspect, Marker, Trade } from "../recognize/lexicon.ts";
import type { ThingType } from "../recognize/things.ts";

/** Deutsche Anzeigetexte; die Werte im Modell bleiben englische Schluessel. */

export const SOURCE_LABEL: Readonly<Record<ClaimSource, string>> = {
  review: "Bestätigt",
  "ets-function": "ETS-Funktion",
  "ets-ga": "ETS-GA",
  "ets-wiring": "Verdrahtung",
  manufacturer: "Herstellerdaten",
  profile: "Namensschema",
  name: "Name",
  hierarchy: "Gruppenbereich",
  "device-location": "Gerätestandort",
  pairing: "Paar",
  family: "Familie",
  default: "Annahme",
};

export const DIMENSION_LABEL: Readonly<Record<ClaimDimension, string>> = {
  room: "Raum",
  trade: "Gewerk",
  direction: "Richtung",
  dpt: "Datenpunkttyp",
};

export const DIRECTION_LABEL: Readonly<Record<string, string>> = {
  command: "Befehl",
  status: "Rückmeldung",
  alarm: "Meldung",
};

export const TRADE_LABEL: Readonly<Record<Trade, string>> = {
  lighting: "Licht",
  shading: "Beschattung",
  hvac: "Heizung und Klima",
  monitoring: "Überwachung",
  metering: "Zähler",
  system: "System",
  scene: "Szene",
  socket: "Steckdose",
};

export const ASPECT_LABEL: Readonly<Record<Aspect, string>> = {
  switch: "Schalten",
  dim: "Dimmen relativ",
  value: "Wert",
  move: "Fahren",
  step: "Schritt/Stopp",
  position: "Position",
  slat: "Lamelle",
  temperature: "Temperatur",
  setpoint: "Sollwert",
  mode: "Betriebsart",
  modeComfort: "Komfort",
  modeNight: "Nacht",
  modeFrost: "Frostschutz",
  modeStandby: "Standby",
  heat: "Heizen",
  valve: "Stellgröße",
  window: "Fenster",
  presence: "Präsenz",
  alarm: "Alarm",
  wind: "Wind",
  rain: "Regen",
  time: "Uhrzeit",
  date: "Datum",
  operating: "In Betrieb",
  reset: "Reset",
  lock: "Sperre",
  scene: "Szene",
  energy: "Energie",
  power: "Leistung",
};

export const MARKER_LABEL: Readonly<Record<Marker, string>> = {
  status: "Rückmeldung",
  command: "Befehl",
  alarm: "Meldung",
  central: "Zentral",
  outOfUse: "Stillgelegt",
  outdoor: "Außen",
};

export const THING_TYPE_LABEL: Readonly<Record<ThingType, string>> = {
  SwitchableLight: "Licht schaltbar",
  DimmableLight: "Licht dimmbar",
  SunProtection: "Sonnenschutz",
  Heating: "Heizung",
  Socket: "Steckdose",
  WindowContact: "Fensterkontakt",
  Alarm: "Meldung",
  Presence: "Präsenz",
  Weather: "Wetter",
  Scene: "Szene",
  Meter: "Zähler",
  System: "System",
  Generic: "Allgemein",
};

/** "9.001 Temperatur (°C)" aus den Stammdaten, sonst nur die Nummer. */
export function dptLabel(dpt: string, master: MasterData): string {
  const definition = master.dpts.get(dpt);
  const text = definition?.textDe ?? definition?.text;
  return text ? `${dptDotted(dpt)} ${text}` : dptDotted(dpt);
}

export const BUNDLE_LABEL: Readonly<Record<string, string>> = {
  "ets-function": "ETS-Funktion",
  channel: "Aktorkanal",
  family: "Namensfamilie",
  single: "Einzelne GA",
};

export const QUESTION_KIND_LABEL: Readonly<Record<string, string>> = {
  conflict: "Widerspruch",
  ambiguous: "Mehrdeutig",
  missing: "Fehlt",
  structure: "Struktur",
};

export const SEVERITY_LABEL: Readonly<Record<string, string>> = {
  error: "Fehler",
  warning: "Warnung",
  info: "Hinweis",
};
