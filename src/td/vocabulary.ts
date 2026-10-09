import type { ThingType } from "../recognize/things.ts";
import type { JsonObject } from "./json.ts";
import { QUDT_UNIT_NAMESPACE } from "./units.ts";

/**
 * Namensraeume und Zuordnungen fuer die TD-Ausgabe.
 *
 * - TD 1.1 ist die Hauptausgabe; TD 2.0 folgt dem Working Draft vom
 *   4.11.2025, dessen Kontext-IRI dort ausdruecklich vorlaeufig ist.
 * - @type aus Brick 1.4 (Klassen gegen Brick.ttl 1.4.2 geprueft), KNX-eigene
 *   Begriffe aus den Namensraeumen, die die ETS6 im Semantikexport verwendet.
 * - Fuer das KNX-Binding gibt es bei W3C kein Vokabular; die Form-Begriffe
 *   stehen deshalb in einem eigenen, herstellerneutralen Namensraum.
 */

export const TD11_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1";
export const TD2_CONTEXT = "https://www.w3.org/ns/wot-next/td";

export const BINDING_BASE = "https://vw2hwkth76-ai.github.io/ns/";
export const BINDING_NAMESPACE = `${BINDING_BASE}knx-binding#`;
export const BINDING_CONTEXT_FILE = "knx-binding.jsonld";

export const PREFIXES: Readonly<Record<string, string>> = {
  kb: BINDING_NAMESPACE,
  brick: "https://brickschema.org/schema/Brick#",
  knx: "http://schema.knx.org/2020/ontology/knx#",
  unit: QUDT_UNIT_NAMESPACE,
};

/** TD 2.0 hat das HTTP-Binding aus dem Kern genommen; sein Vokabular muss dort mit in den Kontext. */
export const HTTP_PREFIX = { htv: "http://www.w3.org/2011/http#" } as const;

/** Begriffe des KNX-Bindings; daraus entstehen Kontextdatei und Begriffsseite. */
export const BINDING_TERMS: readonly { readonly name: string; readonly type: string; readonly de: string }[] = [
  { name: "groupAddress", type: "xsd:string", de: "Gruppenadresse der Form, wie in der ETS geschrieben (\"1/2/3\")." },
  { name: "dpt", type: "xsd:string", de: "Datenpunkttyp der Gruppenadresse, gepunktet (\"9.001\")." },
  { name: "functionType", type: "xsd:string", de: "KNX-Funktionstyp aus knx_master.xml (\"FT-6\"), Grundlage des Thing Models." },
  { name: "readVerified", type: "xsd:boolean", de: "false, wenn gelesen wird, ohne dass Herstellerdaten das Lese-Flag belegen." },
  { name: "evidence", type: "@set", de: "Belege der Erkennung für diese Form, je Dimension." },
  { name: "dimension", type: "xsd:string", de: "Dimension eines Belegs: direction oder dpt." },
  { name: "source", type: "xsd:string", de: "Quelle des Belegs, etwa ets-wiring, ets-function, name, review." },
  { name: "confidence", type: "xsd:decimal", de: "Konfidenz des Belegs; ordnet Belege, ist keine Wahrscheinlichkeit." },
  { name: "reviewed", type: "xsd:boolean", de: "true, wenn der Wert von Hand bestätigt ist." },
  { name: "conflict", type: "xsd:string", de: "Gegenwert, der zu nah am gewählten Wert liegt und eine Rückfrage auslöst." },
  { name: "openQuestion", type: "xsd:boolean", de: "true, wenn zu dieser Gruppenadresse eine Rückfrage offen ist." },
  { name: "openQuestions", type: "xsd:integer", de: "Anzahl offener Rückfragen eines Things." },
  { name: "bundling", type: "xsd:string", de: "Wie die Gruppenadressen gebündelt wurden: ets-function, channel, family, single." },
  { name: "tool", type: "xsd:string", de: "Erzeugendes Werkzeug mit Version." },
];

/**
 * JSON-LD-Kontext des KNX-Bindings, als eigene Datei veroeffentlicht. Die TDs
 * tragen die Praefixe zusaetzlich inline, damit sie ohne Netz expandieren.
 */
export const BINDING_CONTEXT: JsonObject = {
  "@context": {
    "@version": 1.1,
    kb: BINDING_NAMESPACE,
    xsd: "http://www.w3.org/2001/XMLSchema#",
    ...Object.fromEntries(
      BINDING_TERMS.map((term) => [term.name, term.type === "@set" ? { "@id": `kb:${term.name}`, "@container": "@set" } : { "@id": `kb:${term.name}`, "@type": term.type }]),
    ),
  },
};

export type AffordanceKind = "property" | "action";

export interface RoleSpec {
  /** Schluessel der Affordance, z. B. "on". */
  readonly key: string;
  readonly kind: AffordanceKind;
  readonly de: string;
  readonly en: string;
  /** Brick-Klasse fuer die Befehlsseite und die Zustandsseite. */
  readonly command: string | undefined;
  readonly status: string | undefined;
}

/**
 * Rollen aus den KNX-Funktionstypen und deren Ergaenzungen. Befehl und
 * Rueckmeldung derselben Groesse teilen sich einen Schluessel und werden zu
 * einer Property mit zwei Forms.
 */
export const ROLE_SPECS: Readonly<Record<string, RoleSpec>> = {
  SwitchOnOff: { key: "on", kind: "property", de: "Ein/Aus", en: "On/Off", command: "brick:On_Off_Command", status: "brick:On_Off_Status" },
  InfoOnOff: { key: "on", kind: "property", de: "Ein/Aus", en: "On/Off", command: "brick:On_Off_Command", status: "brick:On_Off_Status" },
  DimmingValue: { key: "brightness", kind: "property", de: "Helligkeit", en: "Brightness", command: "brick:Lighting_Level_Command", status: "brick:Status" },
  InfoDimmingValue: { key: "brightness", kind: "property", de: "Helligkeit", en: "Brightness", command: "brick:Lighting_Level_Command", status: "brick:Status" },
  DimmingControl: { key: "dimRelative", kind: "action", de: "Dimmen relativ", en: "Dim relative", command: "brick:Command", status: undefined },
  MoveUpDown: { key: "moveUpDown", kind: "action", de: "Auf/Ab fahren", en: "Move up/down", command: "brick:Command", status: undefined },
  StopStepUpDown: { key: "stepStop", kind: "action", de: "Schritt/Stopp", en: "Step/Stop", command: "brick:Command", status: undefined },
  AbsolutePositionBlindsPercentage: { key: "position", kind: "property", de: "Position", en: "Position", command: "brick:Position_Command", status: "brick:Position_Sensor" },
  CurrentAbsolutePositionBlindsPercentage: { key: "position", kind: "property", de: "Position", en: "Position", command: "brick:Position_Command", status: "brick:Position_Sensor" },
  AbsolutePositionSlatPercentage: { key: "slatPosition", kind: "property", de: "Lamellenposition", en: "Slat position", command: "brick:Position_Command", status: "brick:Position_Sensor" },
  CurrentAbsolutePositionSlatPercentage: { key: "slatPosition", kind: "property", de: "Lamellenposition", en: "Slat position", command: "brick:Position_Command", status: "brick:Position_Sensor" },
  WindAlarm: { key: "windAlarm", kind: "property", de: "Windalarm", en: "Wind alarm", command: undefined, status: "brick:Alarm" },
  WindSpeed: { key: "windSpeed", kind: "property", de: "Windgeschwindigkeit", en: "Wind speed", command: undefined, status: "brick:Wind_Speed_Sensor" },
  Illuminance: { key: "illuminance", kind: "property", de: "Helligkeit", en: "Illuminance", command: undefined, status: "brick:Illuminance_Sensor" },
  RainAlarm: { key: "rainAlarm", kind: "property", de: "Regenalarm", en: "Rain alarm", command: undefined, status: "brick:Alarm" },
  TempRoom: { key: "temperature", kind: "property", de: "Raumtemperatur", en: "Room temperature", command: undefined, status: "brick:Zone_Air_Temperature_Sensor" },
  TempRoomSetpoint: { key: "setpoint", kind: "property", de: "Sollwert", en: "Setpoint", command: "brick:Zone_Air_Temperature_Setpoint", status: "brick:Zone_Air_Temperature_Setpoint" },
  InfoTempRoomSetpoint: { key: "setpoint", kind: "property", de: "Sollwert", en: "Setpoint", command: "brick:Zone_Air_Temperature_Setpoint", status: "brick:Zone_Air_Temperature_Setpoint" },
  ValvePosition: { key: "valvePosition", kind: "property", de: "Stellgröße", en: "Valve position", command: "brick:Valve_Position_Command", status: "brick:Valve_Position_Sensor" },
  ActualValvePosition: { key: "actualValvePosition", kind: "property", de: "Ventilstellung", en: "Actual valve position", command: undefined, status: "brick:Valve_Position_Sensor" },
  DamperPosition: { key: "damperPosition", kind: "property", de: "Klappenstellung", en: "Damper position", command: "brick:Damper_Position_Command", status: "brick:Damper_Position_Sensor" },
  AirQuality: { key: "airQuality", kind: "property", de: "Luftqualität", en: "Air quality", command: undefined, status: "brick:Air_Quality_Sensor" },
  ForcedPosition: { key: "forcedPosition", kind: "property", de: "Zwangsstellung", en: "Forced position", command: "brick:Override_Command", status: "brick:Status" },
  SummerMode: { key: "summerMode", kind: "property", de: "Sommerbetrieb", en: "Summer mode", command: "brick:Mode_Command", status: "brick:Mode_Status" },
  HeatCoolMode: { key: "heatCool", kind: "property", de: "Heizen/Kühlen", en: "Heat/Cool", command: "brick:Mode_Command", status: "brick:Mode_Status" },
  TempOutside: { key: "outsideTemperature", kind: "property", de: "Außentemperatur", en: "Outside temperature", command: undefined, status: "brick:Outside_Air_Temperature_Sensor" },
  ValveSwitch: { key: "heating", kind: "property", de: "Heizen", en: "Heating", command: "brick:Heating_Command", status: "brick:Valve_Status" },
  HeatingStatus: { key: "heatingStatus", kind: "property", de: "Heizstatus", en: "Heating status", command: undefined, status: "brick:Status" },
  HVACMode: { key: "hvacMode", kind: "property", de: "Betriebsart", en: "Operating mode", command: "brick:Mode_Command", status: "brick:Mode_Status" },
  ComfortMode: { key: "comfortMode", kind: "property", de: "Komfortbetrieb", en: "Comfort mode", command: "brick:Mode_Command", status: "brick:Mode_Status" },
  NightMode: { key: "nightMode", kind: "property", de: "Nachtbetrieb", en: "Night mode", command: "brick:Mode_Command", status: "brick:Mode_Status" },
  FrostProtectionMode: { key: "frostProtection", kind: "property", de: "Frostschutz", en: "Frost protection", command: "brick:Mode_Command", status: "brick:Mode_Status" },
  StandbyMode: { key: "standbyMode", kind: "property", de: "Standby", en: "Standby", command: "brick:Mode_Command", status: "brick:Mode_Status" },
  WindowStatus: { key: "window", kind: "property", de: "Fenster", en: "Window", command: undefined, status: "brick:Contact_Sensor" },
  Presence: { key: "presence", kind: "property", de: "Präsenz", en: "Presence", command: undefined, status: "brick:Occupancy_Sensor" },
  Alarm: { key: "alarm", kind: "property", de: "Meldung", en: "Alarm", command: undefined, status: "brick:Alarm" },
  OperatingStatus: { key: "operating", kind: "property", de: "In Betrieb", en: "Operating", command: undefined, status: "brick:Status" },
  Lock: { key: "lock", kind: "property", de: "Sperre", en: "Lock", command: "brick:Disable_Command", status: "brick:Lockout_Status" },
  Reset: { key: "reset", kind: "action", de: "Zurücksetzen", en: "Reset", command: "brick:Command", status: undefined },
  SceneControl: { key: "recallScene", kind: "action", de: "Szene abrufen", en: "Recall scene", command: "brick:Command", status: undefined },
  InfoScene: { key: "scene", kind: "property", de: "Szene", en: "Scene", command: undefined, status: "brick:Status" },
  TextMessage: { key: "text", kind: "property", de: "Textmeldung", en: "Text message", command: undefined, status: "brick:Status" },
  MeterReading: { key: "meterReading", kind: "property", de: "Zählerstand", en: "Meter reading", command: undefined, status: "brick:Usage_Sensor" },
  Energy: { key: "energy", kind: "property", de: "Energie", en: "Energy", command: undefined, status: "brick:Energy_Sensor" },
  Power: { key: "power", kind: "property", de: "Leistung", en: "Power", command: undefined, status: "brick:Power_Sensor" },
  Time: { key: "time", kind: "property", de: "Uhrzeit", en: "Time", command: "brick:Time_Parameter", status: "brick:Time_Parameter" },
  Date: { key: "date", kind: "property", de: "Datum", en: "Date", command: "brick:Parameter", status: "brick:Parameter" },
};

/** Brick-Klasse des Things je Typ. */
export const THING_CLASS: Readonly<Record<ThingType, string>> = {
  SwitchableLight: "brick:Luminaire",
  DimmableLight: "brick:Luminaire",
  SunProtection: "brick:Blind",
  Heating: "brick:Radiator",
  Ventilation: "brick:Ventilation_Air_System",
  Socket: "brick:Electrical_Equipment",
  WindowContact: "brick:Sensor_Equipment",
  Alarm: "brick:Equipment",
  Presence: "brick:Occupancy_Sensor_Equipment",
  Weather: "brick:Weather_Station",
  Scene: "brick:Equipment",
  Meter: "brick:Meter",
  System: "brick:Equipment",
  Generic: "brick:Equipment",
};

/** Brick-Klasse eines Raums der Gebaeudestruktur. */
export const SPACE_CLASS: Readonly<Record<string, string>> = {
  Building: "brick:Building",
  BuildingPart: "brick:Building",
  Floor: "brick:Floor",
  Room: "brick:Room",
  Corridor: "brick:Space",
  Stairway: "brick:Space",
  DistributionBoard: "brick:Space",
};
