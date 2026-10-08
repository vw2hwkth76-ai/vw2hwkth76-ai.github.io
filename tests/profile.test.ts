import { beforeAll, describe, expect, it } from "vitest";
import { parseGold } from "../src/bench/gold.ts";
import { recognitionPredictor } from "../src/bench/recognition-predictor.ts";
import { score } from "../src/bench/score.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { analyzeProject } from "../src/recognize/pipeline.ts";
import { compileProfile, PROFILE_FORMAT, parseProfile } from "../src/recognize/profile.ts";
import { readFixture } from "./helpers.ts";

const json = (name: string): unknown => JSON.parse(new TextDecoder().decode(readFixture(name)));
let demo: ProjectGraph;

beforeAll(async () => {
  demo = buildGraph(await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj")));
});

describe("parseProfile", () => {
  it("nimmt ein gueltiges Profil an", () => {
    const result = parseProfile(json("oeffentlich/demoprojekt.namensschema.json"));
    expect(result.ok && result.profile.entries.map((entry) => entry.token)).toEqual(["L", "LD", "R", "H", "LR"]);
  });

  it("weist Ungueltiges mit verstaendlicher Meldung ab", () => {
    const result = parseProfile({
      format: PROFILE_FORMAT,
      name: "kaputt",
      entries: [
        { token: "L", trade: "licht" },
        { token: "zwei Woerter", trade: "lighting" },
        { token: "X" },
        { token: "rm", marker: "status" },
        { token: "RM", marker: "status" },
        "kein Objekt",
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        'Eintrag 1: unbekanntes Gewerk "licht".',
        'Eintrag 2: "token" muss ein einzelnes Wort sein.',
        'Eintrag 3: "X" hat keine Bedeutung.',
        'Eintrag 5: "RM" ist schon in Eintrag 4 belegt.',
        "Eintrag 6: kein Objekt.",
      ]);
    }
    expect(parseProfile({ format: "anderes", entries: [] }).ok).toBe(false);
    expect(parseProfile([]).ok).toBe(false);
  });

  it("meldet Raeume, die es im Projekt nicht gibt", () => {
    const parsed = parseProfile({ format: PROFILE_FORMAT, name: "p", entries: [{ token: "KU", room: "Kueche" }, { token: "LR", room: "living room" }] });
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const compiled = compileProfile(parsed.profile, demo.loaded.project.spaces);
    expect(compiled.warnings).toEqual(['Profil "p": Raum "Kueche" für "KU" gibt es in diesem Projekt nicht.']);
    expect(compiled.tokens.get("lr")?.roomId).toBeDefined();
  });
});

describe("Namensschema in der Erkennung", () => {
  it("loest Kurzcodes ohne neue Fehler auf (Demoprojekt)", () => {
    const parsed = parseProfile(json("oeffentlich/demoprojekt.namensschema.json"));
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const profile = compileProfile(parsed.profile, demo.loaded.project.spaces);
    const gold = parseGold(json("oeffentlich/demoprojekt.gold.json"));
    const without = score(demo, gold, recognitionPredictor("ohne", "", () => ({ useEtsFunctions: false })));
    const withProfile = score(demo, gold, recognitionPredictor("mit", "", () => ({ useEtsFunctions: false, profile })));
    expect(without.dimensions.function.correct).toBe(0);
    expect(withProfile.dimensions.function.correct).toBeGreaterThanOrEqual(12);
    expect(withProfile.dimensions.function.wrong).toBe(0);
    expect(withProfile.dimensions.direction.wrong).toBe(0);

    const analysis = analyzeProject(demo, { useEtsFunctions: false, profile });
    const light = analysis.things.find((thing) => thing.draft.label === "Dimmable light");
    expect(light?.type).toBe("DimmableLight");
    expect(analysis.unknownCodes).toEqual([]);
  });

  it("listet unbekannte Kuerzel mit Beispielen und DPT-Hinweisen", () => {
    const codes = analyzeProject(demo, { useEtsFunctions: false }).unknownCodes;
    expect(codes.map((code) => [code.token, code.count])).toEqual([
      ["R", 6],
      ["LD", 5],
      ["H", 4],
      ["L", 2],
    ]);
    expect(codes.find((code) => code.token === "LD")?.dptMains).toEqual([1, 3, 5]);
  });
});
