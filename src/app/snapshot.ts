import type { Severity } from "../diagnostics.ts";
import type { LoadedProject } from "../ets/load.ts";
import type { ComObjectFlag } from "../ets/model.ts";
import type { ProjectGraph } from "../graph/evidence-graph.ts";
import type { Claim, ClaimDimension, ClaimSource, Decision } from "../recognize/claims.ts";
import type { ProjectAnalysis } from "../recognize/pipeline.ts";
import type { QuestionKind } from "../recognize/questions.ts";
import type { GaRecognition } from "../recognize/recognize.ts";
import { isTrade } from "../recognize/lexicon.ts";
import { DIRECTION_LABEL, dptLabel, THING_TYPE_LABEL, TRADE_LABEL } from "./labels.ts";

/**
 * Serialisierbare Sicht auf eine Analyse fuer die Oberflaeche. Laeuft im
 * Worker; die Oberflaeche bekommt nur reine Daten, keine Maps.
 */

export const DIMENSIONS: readonly ClaimDimension[] = ["room", "trade", "direction", "dpt"];

export interface ValueView {
  readonly value: string;
  readonly display: string;
}

export interface DecisionView extends ValueView {
  readonly source: ClaimSource;
  readonly confidence: number;
  readonly evidence: string;
  readonly conflict: (ValueView & { readonly source: ClaimSource; readonly evidence: string }) | undefined;
}

export interface GaView {
  readonly id: string;
  readonly address: number;
  readonly text: string;
  readonly name: string;
  readonly ranges: readonly string[];
  readonly decisions: Readonly<Partial<Record<ClaimDimension, DecisionView>>>;
  readonly thingKey: string;
  readonly thingLabel: string;
  readonly role: string | undefined;
  readonly central: boolean;
  readonly outOfUse: boolean;
  readonly linked: number;
  readonly readable: boolean | undefined;
  readonly questionIds: readonly string[];
}

export interface ThingView {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly functionType: string | undefined;
  readonly room: string | undefined;
  readonly trade: string | undefined;
  readonly source: string;
  readonly central: boolean;
  readonly outOfUse: boolean;
  readonly members: readonly { readonly id: string; readonly text: string; readonly name: string; readonly role: string | undefined }[];
}

export interface QuestionView {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly dimension: ClaimDimension | "role";
  readonly gaId: string | undefined;
  readonly gaText: string | undefined;
  readonly thingKey: string | undefined;
  readonly message: string;
  readonly suggestions: readonly (ValueView & { readonly evidence: string })[];
}

export interface DiagnosticSummary {
  readonly code: string;
  readonly severity: Severity;
  readonly count: number;
  readonly example: string;
}

export interface Snapshot {
  readonly project: {
    readonly name: string;
    readonly key: string;
    readonly createdBy: string;
    readonly toolVersion: string;
    readonly schemaVersion: number | undefined;
    readonly groupAddressStyle: string;
    readonly passwordProtected: boolean;
    readonly counts: {
      readonly groupAddresses: number;
      readonly devices: number;
      readonly devicesWithManufacturerData: number;
      readonly etsFunctions: number;
      readonly spaces: number;
    };
  };
  readonly spaces: readonly { readonly id: string; readonly name: string; readonly type: string; readonly path: string }[];
  readonly dpts: readonly ValueView[];
  readonly gas: readonly GaView[];
  readonly things: readonly ThingView[];
  readonly questions: readonly QuestionView[];
  readonly unknownCodes: ProjectAnalysis["unknownCodes"];
  readonly diagnostics: readonly DiagnosticSummary[];
  readonly coverage: Readonly<Record<ClaimDimension, { readonly decided: number; readonly bySource: Readonly<Partial<Record<ClaimSource, number>>> }>>;
  readonly profileWarnings: readonly string[];
}

export interface ClaimView extends ValueView {
  readonly dimension: ClaimDimension;
  readonly source: ClaimSource;
  readonly confidence: number;
  readonly evidence: string;
  readonly winner: boolean;
}

export interface LinkView {
  readonly device: string;
  readonly product: string | undefined;
  readonly location: string | undefined;
  readonly cabinet: boolean;
  readonly comObject: string;
  readonly flags: string;
  readonly sends: boolean;
  readonly receives: boolean;
  readonly answersRead: boolean;
  readonly dpts: readonly string[];
  readonly size: string | undefined;
  readonly channel: string | undefined;
}

export interface GaDetail {
  readonly id: string;
  readonly description: string;
  readonly ranges: readonly string[];
  readonly etsFunctions: readonly string[];
  readonly claims: readonly ClaimView[];
  readonly links: readonly LinkView[];
  readonly diagnostics: readonly string[];
}

const FLAG_LETTERS: readonly [ComObjectFlag, string][] = [
  ["communication", "K"],
  ["read", "L"],
  ["write", "S"],
  ["transmit", "Ü"],
  ["update", "A"],
  ["readOnInit", "I"],
];

export function displayValue(dimension: ClaimDimension, value: string, graph: ProjectGraph): string {
  switch (dimension) {
    case "room":
      return graph.spaces.get(value)?.space.name ?? value;
    case "trade":
      return isTrade(value) ? TRADE_LABEL[value] : value;
    case "direction":
      return DIRECTION_LABEL[value] ?? value;
    case "dpt":
      return dptLabel(value, graph.loaded.master);
  }
}

function decisionView(decision: Decision, dimension: ClaimDimension, graph: ProjectGraph): DecisionView | undefined {
  const { winner, conflict } = decision;
  if (!winner) return undefined;
  return {
    value: winner.value,
    display: displayValue(dimension, winner.value, graph),
    source: winner.source,
    confidence: winner.confidence,
    evidence: winner.evidence,
    conflict: conflict
      ? { value: conflict.value, display: displayValue(dimension, conflict.value, graph), source: conflict.source, evidence: conflict.evidence }
      : undefined,
  };
}

export function projectKey(loaded: LoadedProject): string {
  return loaded.project.guid ?? `${loaded.project.id}:${loaded.project.name}`;
}

export function buildSnapshot(analysis: ProjectAnalysis, profileWarnings: readonly string[] = []): Snapshot {
  const { recognition } = analysis;
  const graph = recognition.graph;
  const { project, devices, master } = graph.loaded;
  const roleOf = new Map<string, string>();
  const thingByKey = new Map(analysis.things.map((thing) => [thing.draft.key, thing]));
  for (const thing of analysis.things) for (const [gaId, role] of thing.roles) roleOf.set(gaId, role);
  const questionsByGa = new Map<string, string[]>();
  for (const question of analysis.questions) {
    if (!question.groupAddressId) continue;
    questionsByGa.set(question.groupAddressId, [...(questionsByGa.get(question.groupAddressId) ?? []), question.id]);
  }
  const gaText = new Map(project.groupAddresses.map((ga) => [ga.id, ga]));

  const gas: GaView[] = recognition.groupAddresses.map((entry) => {
    const ga = entry.analysis.node.ga;
    const decisions: Partial<Record<ClaimDimension, DecisionView>> = {};
    for (const dimension of DIMENSIONS) {
      const view = decisionView(entry.decisions[dimension], dimension, graph);
      if (view) decisions[dimension] = view;
    }
    return {
      id: ga.id,
      address: ga.address,
      text: ga.text,
      name: ga.name,
      ranges: entry.analysis.node.ranges.map((range) => range.name),
      decisions,
      thingKey: entry.thingKey,
      thingLabel: thingByKey.get(entry.thingKey)?.draft.label ?? "",
      role: roleOf.get(ga.id),
      central: entry.analysis.central,
      outOfUse: entry.analysis.outOfUse,
      linked: entry.analysis.node.links.length,
      readable: entry.analysis.node.readable,
      questionIds: questionsByGa.get(ga.id) ?? [],
    };
  });

  const coverageOf = (dimension: ClaimDimension): Snapshot["coverage"][ClaimDimension] => {
    const bySource: Partial<Record<ClaimSource, number>> = {};
    let decided = 0;
    for (const entry of recognition.groupAddresses) {
      const winner = entry.decisions[dimension].winner;
      if (!winner) continue;
      decided++;
      bySource[winner.source] = (bySource[winner.source] ?? 0) + 1;
    }
    return { decided, bySource };
  };
  const coverage: Snapshot["coverage"] = {
    room: coverageOf("room"),
    trade: coverageOf("trade"),
    direction: coverageOf("direction"),
    dpt: coverageOf("dpt"),
  };

  const grouped = new Map<string, DiagnosticSummary>();
  for (const item of graph.diagnostics) {
    const current = grouped.get(item.code);
    grouped.set(item.code, { code: item.code, severity: item.severity, count: (current?.count ?? 0) + 1, example: current?.example ?? item.message });
  }

  const usedDpts = new Set(project.groupAddresses.flatMap((ga) => ga.dpts));
  const dpts = [...master.dpts.values()]
    .filter((definition) => definition.id.startsWith("DPST-") || usedDpts.has(definition.id))
    .map((definition) => ({ value: definition.id, display: dptLabel(definition.id, master) }));

  return {
    project: {
      name: project.name,
      key: projectKey(graph.loaded),
      createdBy: project.createdBy,
      toolVersion: project.toolVersion,
      schemaVersion: project.schemaVersion,
      groupAddressStyle: project.groupAddressStyle,
      passwordProtected: graph.loaded.passwordProtected,
      counts: {
        groupAddresses: project.groupAddresses.length,
        devices: devices.length,
        devicesWithManufacturerData: devices.filter((device) => device.applicationId !== undefined).length,
        etsFunctions: project.functions.length,
        spaces: project.spaces.length,
      },
    },
    spaces: [...graph.spaces.values()].map((node) => ({
      id: node.space.id,
      name: node.space.name,
      type: node.space.type,
      path: node.path.map((space) => space.name).join(" / "),
    })),
    dpts,
    gas,
    things: analysis.things.map((thing) => ({
      key: thing.draft.key,
      label: thing.draft.label,
      type: thing.type,
      typeLabel: THING_TYPE_LABEL[thing.type],
      functionType: thing.functionType,
      room: thing.draft.roomId ? graph.spaces.get(thing.draft.roomId)?.space.name : undefined,
      trade: thing.draft.trade ? displayValue("trade", thing.draft.trade, graph) : undefined,
      source: thing.draft.source,
      central: thing.draft.central,
      outOfUse: thing.draft.outOfUse,
      members: thing.draft.groupAddressIds.map((id) => ({
        id,
        text: gaText.get(id)?.text ?? id,
        name: gaText.get(id)?.name ?? "",
        role: thing.roles.get(id),
      })),
    })),
    questions: analysis.questions.map((question) => ({
      id: question.id,
      kind: question.kind,
      dimension: question.dimension,
      gaId: question.groupAddressId,
      gaText: question.groupAddressId ? gaText.get(question.groupAddressId)?.text : undefined,
      thingKey: question.thingKey,
      message: question.message,
      suggestions: question.suggestions.map((suggestion) => ({
        value: suggestion.value,
        display: question.dimension === "role" ? suggestion.value : displayValue(question.dimension, suggestion.value, graph),
        evidence: suggestion.evidence,
      })),
    })),
    unknownCodes: analysis.unknownCodes,
    diagnostics: [...grouped.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count),
    coverage,
    profileWarnings,
  };
}

function severityRank(severity: Severity): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

export function buildDetail(entry: GaRecognition, graph: ProjectGraph): GaDetail {
  const { node, claims } = entry.analysis;
  const winners = new Set(DIMENSIONS.map((dimension) => entry.decisions[dimension].winner).filter((claim): claim is Claim => claim !== undefined));
  return {
    id: node.ga.id,
    description: node.ga.description,
    ranges: node.ranges.map((range) => range.name),
    etsFunctions: node.functions.map((membership) => `${membership.function.name} (${membership.role || "ohne Rolle"})`),
    claims: [...claims]
      .sort((a, b) => DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension) || b.confidence - a.confidence)
      .map((claim) => ({
        dimension: claim.dimension,
        value: claim.value,
        display: displayValue(claim.dimension, claim.value, graph),
        source: claim.source,
        confidence: claim.confidence,
        evidence: claim.evidence,
        winner: winners.has(claim),
      })),
    links: node.links.map((link) => {
      const space = graph.deviceSpace.get(link.device.device.id)?.space;
      const co = link.comObject;
      return {
        device: link.device.device.individualAddress ?? link.device.device.id,
        product: link.device.product?.textDe ?? link.device.product?.text,
        location: space?.name,
        cabinet: link.device.product?.isRailMounted ?? space?.type === "DistributionBoard",
        comObject: [co.number !== undefined ? `${co.number}:` : "", co.textDe ?? co.text ?? co.refId, co.functionTextDe ?? co.functionText ?? ""]
          .filter((part) => part !== "")
          .join(" "),
        flags: FLAG_LETTERS.filter(([flag]) => co.flags[flag] === true).map(([, letter]) => letter).join(""),
        sends: link.sends,
        receives: link.receives,
        answersRead: link.answersRead,
        dpts: co.dpts,
        size: co.objectSize,
        channel: co.channel?.label,
      };
    }),
    diagnostics: node.diagnostics.map((item) => item.message),
  };
}
