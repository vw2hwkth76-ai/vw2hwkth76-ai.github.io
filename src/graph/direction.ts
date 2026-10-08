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

function wiringDirection(node: GaNode, graph: ProjectGraph): DirectionEvidence | undefined {
  const links = node.links.filter((link) => link.flagsKnown);
  if (links.length === 0 || links.length !== node.links.length) return undefined;

  const cabinet = (link: GaLink): boolean | undefined =>
    link.device.product?.isRailMounted ?? (graph.deviceSpace.get(link.device.device.id)?.space.type === "DistributionBoard" ? true : undefined);

  const cabinetSenders = links.filter((link) => cabinet(link) === true && link.sends);
  const cabinetPureReceivers = links.filter((link) => cabinet(link) === true && link.receives && !link.sends);
  const describe = (link: GaLink): string =>
    `${link.device.device.individualAddress ?? link.device.device.id} "${link.comObject.functionText ?? link.comObject.text ?? link.comObject.refId}"`;

  if (cabinetSenders.length > 0 && cabinetPureReceivers.length === 0) {
    return { value: "status", source: "ets-wiring", detail: `Aktor sendet auf der GA: ${cabinetSenders.map(describe).join(", ")}` };
  }
  if (cabinetPureReceivers.length > 0 && cabinetSenders.length === 0) {
    return {
      value: "command",
      source: "ets-wiring",
      detail: `Aktor empfaengt nur (Schreiben-Flag): ${cabinetPureReceivers.map(describe).join(", ")}`,
    };
  }
  if (cabinetSenders.length > 0 || links.some((link) => cabinet(link) !== false)) return undefined;

  const readableSenders = links.filter((link) => link.sends && link.answersRead);
  if (readableSenders.length > 0) {
    return { value: "status", source: "ets-wiring", detail: `lesbarer Sender ohne Aktor: ${readableSenders.map(describe).join(", ")}` };
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
