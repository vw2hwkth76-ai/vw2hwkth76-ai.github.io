import type { GaNode, ProjectGraph } from "../graph/evidence-graph.ts";
import type { AnalyzeOptions } from "../recognize/analyze.ts";
import { type Recognition, recognize } from "../recognize/recognize.ts";
import type { Prediction, Predictions, Predictor } from "./baseline.ts";

function cached(options: (graph: ProjectGraph) => AnalyzeOptions): (graph: ProjectGraph) => Recognition {
  const cache = new WeakMap<ProjectGraph, Recognition>();
  return (graph) => {
    let result = cache.get(graph);
    if (!result) {
      result = recognize(graph, options(graph));
      cache.set(graph, result);
    }
    return result;
  };
}

export function recognitionPredictor(id: string, label: string, options: (graph: ProjectGraph) => AnalyzeOptions): Predictor {
  const get = cached(options);
  return {
    id,
    label,
    predict(node: GaNode, graph: ProjectGraph): Predictions {
      const recognition = get(graph);
      const entry = recognition.byGroupAddressId.get(node.ga.id);
      if (!entry) return {};
      const result: { room?: Prediction; function?: Prediction; direction?: Prediction; dpt?: Prediction } = {};
      const room = entry.decisions.room.winner;
      const space = room ? graph.spaces.get(room.value)?.space : undefined;
      if (room && space) result.room = { value: space.name, source: room.source };
      const thing = recognition.things.find((candidate) => candidate.key === entry.thingKey);
      if (thing) result.function = { value: thing.label, source: thing.source };
      const direction = entry.decisions.direction.winner;
      if (direction) result.direction = { value: direction.value, source: direction.source };
      const dpt = entry.decisions.dpt.winner;
      if (dpt) result.dpt = { value: dpt.value, source: dpt.source };
      return result;
    },
  };
}

export const RECOGNITION_PREDICTORS: readonly Predictor[] = [
  recognitionPredictor("erkennung", "Erkennung mit allen Belegen", () => ({ useEtsFunctions: true })),
  recognitionPredictor("erkennung-ohne-ets", "Erkennung ohne ETS-Funktionen (wie b-pur)", () => ({ useEtsFunctions: false })),
];
