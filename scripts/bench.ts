import { existsSync, readFileSync } from "node:fs";
import { BASELINE_PREDICTORS } from "../src/bench/baseline.ts";
import { parseGold } from "../src/bench/gold.ts";
import { RECOGNITION_PREDICTORS } from "../src/bench/recognition-predictor.ts";
import { formatScores, type Score, score } from "../src/bench/score.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph } from "../src/graph/evidence-graph.ts";

/** Projekte mit Gold-Standard. Private Projekte laufen nur, wenn sie lokal vorliegen. */
const CASES = [
  { project: "fixtures/oeffentlich/style3.knxproj", gold: "fixtures/oeffentlich/style.gold.json" },
  { project: "fixtures/oeffentlich/demoprojekt.knxproj", gold: "fixtures/oeffentlich/demoprojekt.gold.json" },
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
  for (const predictor of [...BASELINE_PREDICTORS, ...RECOGNITION_PREDICTORS]) scores.push(score(graph, gold, predictor));
}

console.log(formatScores(scores));
if (showErrors) {
  for (const result of scores) {
    for (const error of result.errors) {
      console.log(`${result.project} ${result.predictor} ${error.address} "${error.name}" ${error.dimension}: erwartet ${error.expected}, erhalten ${error.actual} (${error.source})`);
    }
  }
}
