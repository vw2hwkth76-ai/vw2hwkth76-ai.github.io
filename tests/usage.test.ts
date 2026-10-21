import { beforeAll, describe, expect, it } from "vitest";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { gaUsage, looksLikeTemplate, summarizeUsage, usedShare, type UsageSummary } from "../src/graph/usage.ts";
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
