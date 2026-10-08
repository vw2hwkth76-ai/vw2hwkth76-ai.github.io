import type { ProjectGraph } from "../graph/evidence-graph.ts";
import type { AnalyzeOptions } from "./analyze.ts";
import { collectQuestions, type Question } from "./questions.ts";
import { type Recognition, recognize } from "./recognize.ts";
import { type Thing, typeThings } from "./things.ts";

export interface ProjectAnalysis {
  readonly recognition: Recognition;
  readonly things: readonly Thing[];
  readonly questions: readonly Question[];
}

export function analyzeProject(graph: ProjectGraph, options: AnalyzeOptions = { useEtsFunctions: true }): ProjectAnalysis {
  const recognition = recognize(graph, options);
  const things = typeThings(recognition);
  return { recognition, things, questions: collectQuestions(recognition, things) };
}
