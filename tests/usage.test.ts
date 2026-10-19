import { beforeAll, describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/app/snapshot.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { gaUsage, looksLikeTemplate, summarizeUsage, usedShare, type UsageSummary } from "../src/graph/usage.ts";
import { analyzeProject } from "../src/recognize/pipeline.ts";
import { readFixture } from "./helpers.ts";

let demo: ProjectGraph;

beforeAll(async () => {
  demo = buildGraph(await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj")));
});

const summary = (active: number, idle: number, reserve: number, hasDevices = true): UsageSummary => ({ active, idle, reserve, hasDevices });

describe("Nutzung der Gruppenadressen", () => {
  it("klassifiziert jede GA genau einmal", () => {
    const counts = summarizeUsage(demo);
    expect(counts.active + counts.idle + counts.reserve).toBe(demo.groupAddresses.length);
    expect(counts.hasDevices).toBe(true);
    for (const node of demo.groupAddresses) {
      if (node.links.length === 0) expect(gaUsage(node)).toBe("reserve");
    }
  });

  it("erkennt ein Vorlagenprojekt am kleinen Anteil wirksamer GAs, nicht ohne Geraete", () => {
    expect(usedShare(summary(7, 3, 90))).toBeCloseTo(0.07);
    expect(looksLikeTemplate(summary(7, 3, 90))).toBe(true);
    expect(looksLikeTemplate(summary(60, 0, 40))).toBe(false);
    expect(looksLikeTemplate(summary(0, 0, 100, false))).toBe(false);
    expect(usedShare(summary(0, 0, 0))).toBe(1);
  });
});

describe("Bereich der Auswertung", () => {
  it("merkt sich den gewaehlten Bereich", () => {
    expect(analyzeProject(demo).scope).toBe("all");
    expect(analyzeProject(demo, { useEtsFunctions: true, scope: "used" }).scope).toBe("used");
  });

  it("legt Vorrat still, wenn nur die benutzten GAs gelten sollen", () => {
    const stripped: ProjectGraph = {
      ...demo,
      groupAddresses: demo.groupAddresses.map((node, index) => (index < 5 ? node : { ...node, links: [] })),
    };
    const all = analyzeProject(stripped, { useEtsFunctions: false });
    const used = analyzeProject(stripped, { useEtsFunctions: false, scope: "used" });
    const reserve = used.recognition.groupAddresses.filter(({ analysis }) => analysis.usage === "reserve");
    expect(reserve.length).toBe(demo.groupAddresses.length - 5);
    expect(reserve.every(({ analysis }) => analysis.outOfUse)).toBe(true);
    const keptAll = all.recognition.groupAddresses.filter(({ analysis }) => analysis.usage === "reserve");
    expect(keptAll.every(({ analysis }) => !analysis.outOfUse)).toBe(true);
    const silent = new Set(reserve.map(({ analysis }) => analysis.node.ga.id));
    const touched = (analysis: typeof all) => analysis.things.filter((thing) => thing.draft.groupAddressIds.some((id) => silent.has(id)));
    expect(touched(used).length).toBeGreaterThan(0);
    expect(touched(used).every((thing) => thing.draft.outOfUse)).toBe(true);
    expect(touched(all).some((thing) => thing.draft.outOfUse)).toBe(false);
    expect(used.questions.filter((question) => question.groupAddressIds?.some((id) => silent.has(id))).length).toBe(0);
    expect(buildSnapshot(used).usage).toMatchObject({ scope: "used", reserve: demo.groupAddresses.length - 5 });
  });
});
