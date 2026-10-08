import { dptMainNumber } from "../ets/dpt-id.ts";
import type { ProjectGraph } from "../graph/evidence-graph.ts";
import type { AnalyzeOptions } from "./analyze.ts";
import { type UnknownCode, unknownCodes } from "./profile.ts";
import { collectQuestions, type Question } from "./questions.ts";
import { type Recognition, recognize } from "./recognize.ts";
import { type Thing, typeThings } from "./things.ts";

export interface ProjectAnalysis {
  readonly recognition: Recognition;
  readonly things: readonly Thing[];
  readonly questions: readonly Question[];
  /** Haeufige Kuerzel ohne Bedeutung, Kandidaten fuer das Namensschema. */
  readonly unknownCodes: readonly UnknownCode[];
}

export function analyzeProject(graph: ProjectGraph, options: AnalyzeOptions = { useEtsFunctions: true }): ProjectAnalysis {
  const recognition = recognize(graph, options);
  const things = typeThings(recognition);
  const codes = unknownCodes(
    recognition.groupAddresses.map(({ analysis, decisions }) => {
      const explained = new Set<number>([
        ...analysis.name.hits.flatMap((hit) => hit.tokens),
        ...analysis.name.rooms.matches.flatMap((match) => match.tokens),
        ...analysis.name.profile.tokens,
      ]);
      const dpt = decisions.dpt.winner?.value;
      return { name: analysis.node.ga.name, tokens: analysis.name.tokens, explained, dptMain: dpt ? dptMainNumber(dpt) : undefined };
    }),
  );
  return { recognition, things, questions: collectQuestions(recognition, things), unknownCodes: codes };
}
