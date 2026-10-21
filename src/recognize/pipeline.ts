import { dptMainNumber } from "../ets/dpt-id.ts";
import type { ProjectGraph } from "../graph/evidence-graph.ts";
import { type ExcludeReason, type Exclusion, excludedReasons, NO_EXCLUSION, restrictGraph } from "../graph/scope.ts";
import type { AnalyzeOptions } from "./analyze.ts";
import { type UnknownCode, unknownCodes } from "./profile.ts";
import { collectQuestions, type Question } from "./questions.ts";
import { type Recognition, recognize } from "./recognize.ts";
import { type Thing, typeThings } from "./things.ts";

export interface PipelineOptions extends AnalyzeOptions {
  /** Welche GAs gar nicht erst ausgewertet werden; Standard: alle gelten. */
  readonly exclude?: Exclusion;
}

export interface ProjectAnalysis {
  /** Erkennung nur ueber die eingeschlossenen GAs; `recognition.graph` ist der eingeschraenkte Graph. */
  readonly recognition: Recognition;
  /** Der Graph mit allen GAs, auch den ausgeschlossenen. */
  readonly full: ProjectGraph;
  readonly exclusion: Exclusion;
  /** Ausgeschlossene GA-Ids mit Grund. */
  readonly excluded: ReadonlyMap<string, ExcludeReason>;
  readonly things: readonly Thing[];
  readonly questions: readonly Question[];
  /** Haeufige Kuerzel ohne Bedeutung, Kandidaten fuer das Namensschema. */
  readonly unknownCodes: readonly UnknownCode[];
}

export function analyzeProject(full: ProjectGraph, options: PipelineOptions = { useEtsFunctions: true }): ProjectAnalysis {
  const exclusion = options.exclude ?? NO_EXCLUSION;
  const excluded = excludedReasons(full, exclusion);
  const recognition = recognize(restrictGraph(full, excluded), options);
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
  return { recognition, full, exclusion, excluded, things, questions: collectQuestions(recognition, things), unknownCodes: codes };
}
