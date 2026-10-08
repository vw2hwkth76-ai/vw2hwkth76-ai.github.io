import { existsSync, readFileSync } from "node:fs";
import { BASELINE_PREDICTORS } from "../src/bench/baseline.ts";
import { parseGold } from "../src/bench/gold.ts";
import { RECOGNITION_PREDICTORS, recognitionPredictor } from "../src/bench/recognition-predictor.ts";
import { compileProfile, parseProfile } from "../src/recognize/profile.ts";
import { formatScores, type Score, score } from "../src/bench/score.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph } from "../src/graph/evidence-graph.ts";

/** Projekte mit Gold-Standard. Private Projekte laufen nur, wenn sie lokal vorliegen. */
const CASES: readonly { project: string; gold: string; profile?: string }[] = [
  { project: "fixtures/oeffentlich/style3.knxproj", gold: "fixtures/oeffentlich/style.gold.json" },
  {
    project: "fixtures/oeffentlich/demoprojekt.knxproj",
    gold: "fixtures/oeffentlich/demoprojekt.gold.json",
    profile: "fixtures/oeffentlich/demoprojekt.namensschema.json",
  },
  { project: "fixtures/privat/musterprojekt-ets6.knxproj", gold: "fixtures/privat/musterprojekt-ets6.gold.json" },
];

const showErrors = process.argv.includes("--fehler");
const scores: Score[] = [];
for (const entry of CASES) {
  if (!existsSync(entry.project) || !existsSync(entry.gold)) {
    console.log(`uebersprungen (nicht vorhanden): ${entry.project}`);
    continue;
  }
  const graph = buildGraph(await loadKnxProject(readFileSync(entry.project)));
  const gold = parseGold(JSON.parse(readFileSync(entry.gold, "utf-8")) as unknown);
  const predictors = [...BASELINE_PREDICTORS, ...RECOGNITION_PREDICTORS];
  if (entry.profile !== undefined) {
    const parsed = parseProfile(JSON.parse(readFileSync(entry.profile, "utf-8")) as unknown);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const profile = compileProfile(parsed.profile, graph.loaded.project.spaces);
    predictors.push(recognitionPredictor("profil-ohne-ets", "Erkennung mit Namensschema, ohne ETS-Funktionen", () => ({ useEtsFunctions: false, profile })));
  }
  for (const predictor of predictors) scores.push(score(graph, gold, predictor));
}

console.log(formatScores(scores));
if (showErrors) {
  for (const result of scores) {
    for (const error of result.errors) {
      console.log(`${result.project} ${result.predictor} ${error.address} "${error.name}" ${error.dimension}: erwartet ${error.expected}, erhalten ${error.actual} (${error.source})`);
    }
  }
}
