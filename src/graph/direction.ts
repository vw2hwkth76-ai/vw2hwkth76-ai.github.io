import { type Diagnostic, diagnostic } from "../diagnostics.ts";
import type { GaLink, GaNode, ProjectGraph } from "./evidence-graph.ts";

/** Befehl an ein Geraet, Zustand oder Messwert, spontane Meldung mit Alarmcharakter. */
export type Direction = "command" | "status" | "alarm";

export type DirectionSource = "ets-function-role" | "ets-wiring";

export interface DirectionEvidence {
  readonly value: Direction;
  readonly source: DirectionSource;
  readonly detail: string;
}

/** Richtung der normativen KNX-Datenpunktrollen; Konvention wie im Vorgaenger ets2td. */
export const ETS_ROLE_DIRECTION: Readonly<Record<string, Direction>> = {
  SwitchOnOff: "command",
  InfoOnOff: "status",
  RelativeSetvalueControl: "command",
  ActualDimmingValue: "status",
  DimmingControl: "command",
  DimmingValue: "command",
  InfoDimmingValue: "status",
  MoveUpDown: "command",
  StopStepUpDown: "command",
  CurrentAbsolutePositionBlindsPercentage: "status",
  CurrentAbsolutePositionSlatPercentage: "status",
  WindAlarm: "alarm",
  RainAlarm: "alarm",
  HVACMode: "command",
  ValvePosition: "status",
  TempRoom: "status",
  TempRoomSetpoint: "command",
  WindowStatus: "status",
};

/**
 * Richtungsbelege einer GA. Die Verdrahtung ist objektiv: Ein Aktor im
 * Verteiler, der auf der GA nur empfaengt, wird gesteuert; sendet er, ist
 * es seine Rueckmeldung. Ohne Aktor gilt nur ein lesbarer Sender als
 * Messwert, alles andere bleibt offen.
 */
export function directionEvidence(node: GaNode, graph: ProjectGraph): DirectionEvidence[] {
  const evidence: DirectionEvidence[] = [];
  for (const membership of node.functions) {
    const value = ETS_ROLE_DIRECTION[membership.role];
    if (value !== undefined) {
      evidence.push({
        value,
        source: "ets-function-role",
        detail: `ETS-Funktion "${membership.function.name}", Rolle ${membership.role}`,
      });
    }
  }
  const wiring = wiringDirection(node, graph);
  if (wiring) evidence.push(wiring);
  return evidence;
}

/** Text eines Kommunikationsobjekts, deutsch und englisch, klein geschrieben. */
export function objectText(link: GaLink): string {
  const co = link.comObject;
  return [co.text, co.functionText, co.textDe, co.functionTextDe].filter((part) => part !== undefined && part !== "").join(" / ").toLowerCase();
}

/** Platzhalterobjekte ohne Bedeutung ("1 byte (3)/1 byte"), etwa einer Visualisierungsattrappe. */
export function isNeutral(link: GaLink): boolean {
  const co = link.comObject;
  const parts = [co.text, co.functionText].filter((part) => part !== undefined && part !== "");
  return parts.length > 0 && parts.every((part) => /^\s*\d+\s*(bit|bits|byte|bytes)\b[\s\d()]*$/i.test(part ?? ""));
}

/** Meldet einen Zustand oder Messwert. */
const STATUS_WORDS =
  /\b(status|actual|measured|indicat\w*|feedback|report|surveillance|counter value|physical value|sensor|input|output presence|presence output|occupancy|trigger|eingang|anwesenheit|meldung)\b|(r(ü|ue)ckmeld|istwert|messwert|z(ä|ae)hlerstand)/;
/** Meldet eine Stoerung. */
const ALARM_WORDS = /\b(failure|fault|error|alarm|short circuit|mains failure|st(ö|oe)rung|fehler|kurzschluss|netzausfall)\b/;
/** Stellgroesse eines Reglers: ein berechneter Zustand, kein Bedienbefehl. */
const CONTROLLER_WORDS = /(control value|continuous variable|continous|actuating value|control circuit|stellgr(ö|oe)(ss|ß)e|stellwert)/;
/** Bediengeraet, das Befehle sendet. */
const OPERATOR_WORDS = /\b(push button|taster|value transmitter|wertgeber|switch object|switching|schalten|dimming|dimmen|output light|brighter|darker|heller|dunkler)\b/;
const ACTUATOR_PRODUCT = /(actuator|aktor|drive|antrieb|dali|gateway|dimmer|i\/o unit)/i;

/** Aktor: Reiheneinbau, im Verteiler oder dem Produktnamen nach. */
export function isActuatorLink(link: GaLink, graph: ProjectGraph): boolean {
  return (
    link.device.product?.isRailMounted === true ||
    graph.deviceSpace.get(link.device.device.id)?.space.type === "DistributionBoard" ||
    ACTUATOR_PRODUCT.test(link.device.product?.text ?? "")
  );
}

function wiringDirection(node: GaNode, graph: ProjectGraph): DirectionEvidence | undefined {
  const known = node.links.filter((link) => link.flagsKnown);
  if (known.length === 0 || known.length !== node.links.length) return undefined;
  const links = known.filter((link) => !isNeutral(link));
  if (links.length === 0) return undefined;

  const actuator = (link: GaLink): boolean => isActuatorLink(link, graph);
  const describe = (link: GaLink): string =>
    `${link.device.device.individualAddress ?? link.device.device.id} "${link.comObject.functionText ?? link.comObject.text ?? link.comObject.refId}"`;
  const result = (value: Direction, detail: string, sources: readonly GaLink[]): DirectionEvidence => {
    // Eine Meldung ist ein Bit; ein Fehlercode in 4 Byte ist ein gemeldeter Wert.
    const alarm =
      value === "status" &&
      sources.some((link) => ALARM_WORDS.test(objectText(link)) && (link.comObject.objectSizeBits === undefined || link.comObject.objectSizeBits <= 1));
    return { value: alarm ? "alarm" : value, source: "ets-wiring", detail: alarm ? `${detail}; Störung laut Objekttext` : detail };
  };

  const reportsState = (link: GaLink): boolean => STATUS_WORDS.test(objectText(link)) || ALARM_WORDS.test(objectText(link));
  // Aktorobjekte: reine Sender melden Zustaende, Eingaenge ebenfalls; Ausgaenge mit Schreib-Flag werden gesteuert,
  // auch wenn sie zusaetzlich senden (Rueckmeldung ueber dasselbe Objekt).
  const actuatorLinks = links.filter(actuator);
  const sources = actuatorLinks.filter((link) => link.sends && (!link.receives || reportsState(link)));
  const targets = actuatorLinks.filter((link) => link.receives && !reportsState(link));
  const controllers = links.filter((link) => link.sends && !actuator(link) && CONTROLLER_WORDS.test(objectText(link)));

  if (controllers.length > 0 && targets.length > 0) {
    return result("status", `Stellgröße eines Reglers: ${controllers.map(describe).join(", ")}`, controllers);
  }
  // Ein Sensor, dessen Messwert ein Aktor verwertet (Raumtemperatur an den Heizungsaktor), bleibt ein Zustand.
  const sensors = links.filter((link) => link.sends && !actuator(link) && reportsState(link) && !OPERATOR_WORDS.test(objectText(link)));
  if (sensors.length > 0 && targets.length > 0 && sources.length === 0) {
    return result("status", `Sensor meldet, Aktor verwertet: ${sensors.map(describe).join(", ")}`, sensors);
  }
  if (sources.length > 0 && targets.length === 0) return result("status", `Aktor meldet auf der GA: ${sources.map(describe).join(", ")}`, sources);
  if (targets.length > 0 && sources.length === 0) return result("command", `Aktor wird gesteuert: ${targets.map(describe).join(", ")}`, targets);
  if (actuatorLinks.length > 0) return undefined;

  // Ohne Aktor: Was Sensoren und Bediengeraete senden, sagt ihr Objekttext.
  const senders = links.filter((link) => link.sends);
  const reporting = senders.filter(reportsState);
  if (reporting.length > 0) return result("status", `Sensor meldet: ${reporting.map(describe).join(", ")}`, reporting);
  const operating = senders.filter((link) => OPERATOR_WORDS.test(objectText(link)));
  if (operating.length > 0) return result("command", `Bediengerät sendet: ${operating.map(describe).join(", ")}`, operating);
  const readable = senders.filter((link) => link.answersRead);
  if (readable.length > 0) return result("status", `lesbarer Sender ohne Aktor: ${readable.map(describe).join(", ")}`, readable);
  const receivers = links.filter((link) => link.receives);
  if (senders.length === 0 && receivers.length > 0) {
    return result("command", `nur Empfänger, der Wert kommt von außen: ${receivers.map(describe).join(", ")}`, receivers);
  }
  return undefined;
}

/** Widersprueche zwischen ETS-Funktionsrolle und Verdrahtung; die Verdrahtung ist der staerkere Beleg. */
export function directionConflicts(graph: ProjectGraph): Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const node of graph.groupAddresses) {
    const evidence = directionEvidence(node, graph);
    const wiring = evidence.find((entry) => entry.source === "ets-wiring");
    const role = evidence.find((entry) => entry.source === "ets-function-role" && entry.value !== "alarm");
    if (wiring && role && wiring.value !== role.value) {
      result.push(
        diagnostic(
          "ga.direction-conflict",
          "warning",
          `${node.ga.text} "${node.ga.name}": ${role.detail} meint ${role.value}, die Verdrahtung zeigt ${wiring.value} (${wiring.detail}).`,
          { groupAddress: node.ga.id },
        ),
      );
    }
  }
  return result;
}
