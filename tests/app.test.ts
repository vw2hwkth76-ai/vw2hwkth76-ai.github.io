import { beforeAll, describe, expect, it } from "vitest";
import { buildGold, buildReport, formatLink, REPORT_FORMAT, reportSummary } from "../src/app/report.ts";
import { checkAccuracy, checkReviews } from "../src/app/review-check.ts";
import { parseGold } from "../src/bench/gold.ts";
import { buildDetail, buildSnapshot } from "../src/app/snapshot.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { analyzeProject } from "../src/recognize/pipeline.ts";
import { readFixture } from "./helpers.ts";

let demo: ProjectGraph;

beforeAll(async () => {
  demo = buildGraph(await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj")));
});

const idOf = (text: string): string => demo.groupAddresses.find((node) => node.ga.text === text)?.ga.id ?? "";

describe("Bestaetigte Antworten", () => {
  it("gewinnen gegen jede Heuristik und loesen den Widerspruch auf", () => {
    const before = analyzeProject(demo);
    expect(before.questions.some((question) => question.groupAddressId === idOf("0/0/6") && question.kind === "conflict")).toBe(true);
    const reviews = new Map([[idOf("0/0/6"), { direction: "status" }]]);
    const after = analyzeProject(demo, { useEtsFunctions: true, reviews });
    const entry = after.recognition.byGroupAddressId.get(idOf("0/0/6"));
    expect(entry?.decisions.direction.winner).toMatchObject({ value: "status", source: "review" });
    expect(entry?.decisions.direction.conflict).toBeUndefined();
    expect(after.questions.some((question) => question.groupAddressId === idOf("0/0/6") && question.kind === "conflict")).toBe(false);
  });

  it("beantworten offene Fragen", () => {
    const reviews = new Map([[idOf("0/0/12"), { direction: "status" }]]);
    const analysis = analyzeProject(demo, { useEtsFunctions: false, reviews });
    expect(analysis.questions.filter((question) => question.dimension === "direction").map((question) => question.groupAddressId)).toEqual([idOf("0/0/13")]);
  });
});

describe("Snapshot", () => {
  it("liefert reine Daten mit deutschen Anzeigetexten", () => {
    const snapshot = buildSnapshot(analyzeProject(demo));
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();
    const ga = snapshot.gas.find((entry) => entry.text === "0/0/14");
    expect(ga?.decisions.dpt?.display).toBe("9.001 Temperatur (°C)");
    expect(ga?.decisions.direction?.display).toBe("Rückmeldung");
    expect(ga?.decisions.room?.display).toBe("Living room");
    expect(snapshot.project.counts).toMatchObject({ groupAddresses: 19, devices: 5, devicesWithManufacturerData: 5 });
    expect(snapshot.coverage.room.decided).toBe(19);
    expect(snapshot.dpts.find((entry) => entry.value === "DPST-1-1")?.display).toBe("1.001 Schalten");
  });

  it("zeigt je GA Belege, Verknuepfungen und Flags", () => {
    const analysis = analyzeProject(demo);
    const entry = analysis.recognition.byGroupAddressId.get(idOf("0/0/3"));
    if (!entry) throw new Error("fehlt");
    const detail = buildDetail(entry, demo);
    const actuator = detail.links.find((link) => link.cabinet);
    expect(actuator).toMatchObject({ receives: true, sends: false, flags: "KS", location: "Switchboard" });
    expect(detail.claims.filter((claim) => claim.winner).map((claim) => claim.dimension).sort()).toEqual(["direction", "dpt", "room", "trade"]);
  });
});

describe("Analysebericht", () => {
  it("enthaelt Ergebnisse, aber weder Projektname noch GUID", () => {
    const snapshot = buildSnapshot(analyzeProject(demo));
    const report = buildReport(snapshot, { toolVersion: "0.1.0", profile: undefined, reviewCount: 0, date: "2026-10-08" });
    const text = JSON.stringify(report);
    expect(report["format"]).toBe(REPORT_FORMAT);
    expect(text).not.toContain("DemoProject");
    expect(text).not.toContain("012be31b-e333-4027-90d6-be17f79aa998");
    expect(text).toContain('"ga":"0/0/14"');
    expect(reportSummary(snapshot)).toContain("19 GAs");
  });
});

describe("Abgleich mit Bestaetigungen", () => {
  it("misst die Erkennung ohne Antworten an den bestaetigten Werten", () => {
    const baseline = analyzeProject(demo);
    const room = baseline.recognition.byGroupAddressId.get(idOf("0/0/14"))?.decisions.room.winner?.value ?? "";
    const reviews = new Map([
      [idOf("0/0/14"), { room, direction: "command" }],
      [idOf("0/0/1"), { dpt: "DPST-1-2" }],
    ]);
    const check = checkReviews(baseline, reviews);
    expect(check.byDimension.room).toMatchObject({ rated: 1, correct: 1 });
    expect(check.byDimension.direction).toMatchObject({ rated: 1, wrong: 1 });
    expect(check.byDimension.dpt).toMatchObject({ rated: 1, partial: 1 });
    const wrong = check.entries.find((entry) => entry.result === "wrong");
    expect(wrong).toMatchObject({ ga: "0/0/14", confirmed: { display: "Befehl" }, predicted: { display: "Rückmeldung" } });
    expect(checkAccuracy(check.byDimension.room)).toBe(1);
    expect(checkAccuracy(check.byDimension.trade)).toBeUndefined();

    const snapshot = buildSnapshot(analyzeProject(demo, { useEtsFunctions: true, reviews }));
    const report = buildReport(snapshot, { toolVersion: "0.1.0", profile: undefined, reviewCount: 2, date: "2026-10-08", reviewCheck: check });
    expect(JSON.stringify(report)).toContain('"result":"wrong"');
    expect(reportSummary(snapshot, check)).toContain("direction 0/1");
  });

  it("schreibt nur Bestaetigtes in den Gold-Standard, lesbar fuer den Benchmark", () => {
    const reviews = new Map([[idOf("0/0/6"), { direction: "status" }]]);
    const snapshot = buildSnapshot(analyzeProject(demo, { useEtsFunctions: true, reviews }));
    const gold = parseGold(buildGold(snapshot, "2026-10-08"));
    expect(gold.entries.size).toBe(1);
    const entry = [...gold.entries.values()][0];
    expect(entry).toMatchObject({ text: "0/0/6", direction: "status", room: undefined, dpt: undefined });
  });

  it("beschreibt Verknuepfungen kurz fuer den Bericht", () => {
    const entry = analyzeProject(demo).recognition.byGroupAddressId.get(idOf("0/0/3"));
    if (!entry) throw new Error("fehlt");
    const actuator = buildDetail(entry, demo).links.find((link) => link.cabinet);
    if (!actuator) throw new Error("kein Aktor");
    expect(formatLink(actuator)).toMatch(/\[Verteiler\] KO .* KS empfängt$/);
  });
});
