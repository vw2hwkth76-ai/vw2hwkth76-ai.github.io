import { dptMainNumber } from "../ets/dpt-id.ts";
import { directionEvidence } from "../graph/direction.ts";
import type { GaNode, ProjectGraph } from "../graph/evidence-graph.ts";
import type { Dimension } from "./gold.ts";

export interface Prediction {
  readonly value: string;
  readonly source: string;
}

export type Predictions = Partial<Record<Dimension, Prediction>>;

/** Ein Vorhersageverfahren: je GA hoechstens ein Wert pro Dimension. */
export interface Predictor {
  readonly id: string;
  readonly label: string;
  predict(node: GaNode, graph: ProjectGraph): Predictions;
}

function etsFunction(node: GaNode): Predictions {
  const first = node.functions[0];
  if (!first) return {};
  const result: { room?: Prediction; function?: Prediction } = { function: { value: first.function.name, source: "ets-function" } };
  if (first.space) result.room = { value: first.space.name, source: "ets-function" };
  return result;
}

function gaDpt(node: GaNode): Prediction | undefined {
  const dpt = node.ga.dpts[0];
  return dpt === undefined ? undefined : { value: dpt, source: "ets-ga" };
}

/** Einheitlicher DPT der verknuepften Objekte; bei abweichenden Untertypen nur der gemeinsame Haupttyp. */
function comObjectDpt(node: GaNode): Prediction | undefined {
  const all = [...node.comObjectDpts.values()].flat();
  if (all.length === 0) return undefined;
  const subtypes = new Set(all.filter((dpt) => dpt.startsWith("DPST-")));
  if (subtypes.size === 1) return { value: [...subtypes][0] ?? "", source: "manufacturer" };
  const mains = new Set(all.map(dptMainNumber).filter((main) => main !== undefined));
  if (mains.size === 1) return { value: `DPT-${[...mains][0]}`, source: "manufacturer" };
  return undefined;
}

function direction(node: GaNode, graph: ProjectGraph, source: string): Prediction | undefined {
  const evidence = directionEvidence(node, graph).find((entry) => entry.source === source);
  return evidence === undefined ? undefined : { value: evidence.value, source };
}

export const BASELINE_PREDICTORS: readonly Predictor[] = [
  {
    id: "ets",
    label: "nur ETS-Angaben (GA-Attribute, ETS-Funktionen)",
    predict(node, graph) {
      const dpt = gaDpt(node);
      const dir = direction(node, graph, "ets-function-role");
      return { ...etsFunction(node), ...(dpt && { dpt }), ...(dir && { direction: dir }) };
    },
  },
  {
    id: "explizit",
    label: "ETS plus Herstellerdaten und Verdrahtung, ohne Namensheuristik",
    predict(node, graph) {
      const dpt = gaDpt(node) ?? comObjectDpt(node);
      const dir = direction(node, graph, "ets-wiring") ?? direction(node, graph, "ets-function-role");
      return { ...etsFunction(node), ...(dpt && { dpt }), ...(dir && { direction: dir }) };
    },
  },
];
