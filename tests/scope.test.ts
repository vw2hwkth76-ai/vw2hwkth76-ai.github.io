import { beforeAll, describe, expect, it } from "vitest";
import { buildReport } from "../src/app/report.ts";
import { buildDetail, buildExcludedDetail, buildSnapshot } from "../src/app/snapshot.ts";
import { buildScopeOverview, searchScope, splitThings } from "../src/app/scope-view.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../src/graph/evidence-graph.ts";
import { excludedReasons, excludeIds, exclusionFromState, NO_GROUP, parseExclusion, includeIds, mainGroupId, mainGroups, NO_EXCLUSION, reserveOnlyMiddleGroups, restrictGraph, type Exclusion } from "../src/graph/scope.ts";
import { gaUsage, summarizeUsage } from "../src/graph/usage.ts";
import { analyzeProject } from "../src/recognize/pipeline.ts";
import { buildSchemaPrompt } from "../src/recognize/schema-prompt.ts";
import { readFixture } from "./helpers.ts";

let demo: ProjectGraph;
/** Wie ein Vorlagenprojekt: nur wenige GAs behalten ihre Verknuepfungen. */
let template: ProjectGraph;
const KEPT = 3;
/** Zweite Hauptgruppe, damit sich Gruppen unterscheiden lassen (das Demoprojekt hat nur eine). */
let split: ProjectGraph;

beforeAll(async () => {
  demo = buildGraph(await loadKnxProject(readFixture("oeffentlich/demoprojekt.knxproj")));
  template = { ...demo, groupAddresses: demo.groupAddresses.map((node, index) => (index < KEPT ? node : { ...node, links: [] })) };
  const other = { id: "GR-ZWEI", name: "Zweite Gruppe", start: 0, end: 0, parentId: undefined };
  split = { ...template, groupAddresses: template.groupAddresses.map((node, index) => (index < 10 ? node : { ...node, ranges: [other, ...node.ranges.slice(1)] })) };
});

const only = (patch: Partial<Exclusion>): Exclusion => ({ ...NO_EXCLUSION, ...patch });
const OPTIONS = { useEtsFunctions: false } as const;

describe("Ausschluss nach Regeln", () => {
  it("schliesst ohne Regel nichts aus", () => {
    expect(excludedReasons(template, NO_EXCLUSION).size).toBe(0);
    expect(restrictGraph(template, new Map())).toBe(template);
  });

  it("schliesst Vorrat aus und nennt den Grund", () => {
    const reasons = excludedReasons(template, only({ reserve: true }));
    const active = template.groupAddresses.filter((node) => gaUsage(node) === "active");
    expect(reasons.size).toBe(template.groupAddresses.length - active.length);
    expect([...reasons.values()].every((reason) => reason === "reserve")).toBe(true);
    for (const node of active) expect(reasons.has(node.ga.id)).toBe(false);
  });

  it("schliesst ohne Geraete im Projekt nichts als Vorrat aus", () => {
    const bare: ProjectGraph = { ...template, loaded: { ...template.loaded, project: { ...template.loaded.project, devices: [] } } };
    expect(excludedReasons(bare, only({ reserve: true })).size).toBe(0);
  });

  it("schliesst Hauptgruppen aus", () => {
    const groups = mainGroups(split);
    expect(groups.length).toBe(2);
    expect(groups.reduce((sum, group) => sum + group.total, 0)).toBe(split.groupAddresses.length);
    const first = groups[0];
    expect(first).toBeDefined();
    const reasons = excludedReasons(split, only({ ranges: [first?.id ?? ""] }));
    expect(reasons.size).toBe(first?.total);
    expect([...reasons.values()].every((reason) => reason === "group")).toBe(true);
  });

  it("gibt einzelnen Entscheidungen den Vorrang vor Gruppe und Vorrat", () => {
    const first = template.groupAddresses[0];
    const reserved = template.groupAddresses.find((node) => gaUsage(node) !== "active");
    expect(first).toBeDefined();
    expect(reserved).toBeDefined();
    if (!first || !reserved) return;
    // Einzeln ausgeschlossen, obwohl in Benutzung und in keiner ausgeschlossenen Gruppe.
    expect(excludedReasons(template, only({ gas: [first.ga.id] })).get(first.ga.id)).toBe("single");
    // Zurueckgeholt gewinnt gegen Vorrat, Gruppe und einzelnen Ausschluss.
    const reasons = excludedReasons(template, only({ reserve: true, ranges: [mainGroupId(reserved)], gas: [reserved.ga.id], include: [reserved.ga.id] }));
    expect(reasons.has(reserved.ga.id)).toBe(false);
  });
});

describe("Auswertung ohne die ausgeschlossenen GAs", () => {
  it("Vorrat erzeugt weder Things noch Rueckfragen noch Belege noch Schema-Treffer", () => {
    const analysis = analyzeProject(template, { ...OPTIONS, exclude: only({ reserve: true }) });
    const out = new Set(analysis.excluded.keys());
    expect(out.size).toBeGreaterThan(0);
    expect(analysis.recognition.groupAddresses.length).toBe(template.groupAddresses.length - out.size);
    for (const id of out) expect(analysis.recognition.byGroupAddressId.has(id)).toBe(false);
    for (const thing of analysis.things) expect(thing.draft.groupAddressIds.some((id) => out.has(id))).toBe(false);
    for (const question of analysis.questions) expect(question.groupAddressIds?.some((id) => out.has(id)) ?? false).toBe(false);
    // Ohne den Ausschluss waere es anders: Der Vorrat bildete Things.
    const all = analyzeProject(template, OPTIONS);
    expect(all.things.some((thing) => thing.draft.groupAddressIds.some((id) => out.has(id)))).toBe(true);
  });

  it("zeigt ausgeschlossene GAs im Snapshot, aber ohne Erkennung", () => {
    const analysis = analyzeProject(template, { ...OPTIONS, exclude: only({ reserve: true }) });
    const snapshot = buildSnapshot(analysis);
    expect(snapshot.gas.length).toBe(template.groupAddresses.length);
    const left = snapshot.gas.filter((ga) => ga.excluded !== undefined);
    expect(left.length).toBe(analysis.excluded.size);
    expect(left.every((ga) => ga.excluded === "reserve" && Object.keys(ga.decisions).length === 0 && ga.thingKey === "")).toBe(true);
    expect(snapshot.gas.filter((ga) => ga.excluded === undefined).every((ga) => Object.keys(ga.decisions).length > 0)).toBe(true);
    expect(snapshot.scope).toMatchObject({ total: template.groupAddresses.length, excluded: analysis.excluded.size, byReason: { reserve: analysis.excluded.size, group: 0, single: 0 } });
    expect(snapshot.scope.included).toBe(analysis.recognition.groupAddresses.length);
    // Kennzahlen zaehlen nur die ausgewerteten GAs.
    for (const dimension of ["room", "trade", "direction", "dpt"] as const) expect(snapshot.coverage[dimension].decided).toBeLessThanOrEqual(snapshot.scope.included);
    const out = analysis.full.groupAddresses.find((node) => analysis.excluded.has(node.ga.id));
    expect(out).toBeDefined();
    if (out) expect(buildExcludedDetail(out, analysis.full).claims).toEqual([]);
  });

  it("zaehlt Diagnosen nur fuer die ausgewerteten GAs", () => {
    const all = buildSnapshot(analyzeProject(template, OPTIONS));
    const used = buildSnapshot(analyzeProject(template, { ...OPTIONS, exclude: only({ reserve: true }) }));
    const unlinked = (snapshot: typeof all): number => snapshot.diagnostics.find((entry) => entry.code === "ga.unlinked")?.count ?? 0;
    expect(unlinked(all)).toBeGreaterThan(0);
    expect(unlinked(used)).toBe(0);
  });

  it("schreibt den Umfang in den Bericht", () => {
    const analysis = analyzeProject(template, { ...OPTIONS, exclude: only({ reserve: true }) });
    const report = buildReport(buildSnapshot(analysis), { toolVersion: "t", profile: undefined, reviewCount: 0, date: "2026-10-21" });
    const rows = report["groupAddresses"] as { excluded?: string; usage: string }[];
    expect(rows.length).toBe(template.groupAddresses.length);
    expect(rows.filter((row) => row.excluded === "reserve").length).toBe(analysis.excluded.size);
    expect(report["scope"]).toMatchObject({ total: template.groupAddresses.length, excluded: analysis.excluded.size, reserveExcluded: true });
  });

  it("kommt auf dasselbe heraus wie ein Graph, der die GAs gar nicht hat", () => {
    const exclude = only({ reserve: true });
    const direct = analyzeProject(template, { ...OPTIONS, exclude });
    const reasons = excludedReasons(template, exclude);
    const trimmed = analyzeProject(restrictGraph(template, reasons), OPTIONS);
    expect(direct.things.map((thing) => thing.draft.key)).toEqual(trimmed.things.map((thing) => thing.draft.key));
    expect(direct.questions.length).toBe(trimmed.questions.length);
  });
});

describe("Prompt fuer das Namensschema", () => {
  it("enthaelt keine ausgeschlossenen GAs", () => {
    const exclude = only({ reserve: true });
    const reasons = excludedReasons(template, exclude);
    const all = buildSchemaPrompt(template, { maxGroupAddresses: 10_000 });
    const used = buildSchemaPrompt(template, { maxGroupAddresses: 10_000, exclude });
    expect(all.included).toBe(template.groupAddresses.length);
    expect(used.included).toBe(template.groupAddresses.length - reasons.size);
    expect(used.excluded).toBe(reasons.size);
    expect(used.groupAddresses).toBe(template.groupAddresses.length);
    const dropped = template.groupAddresses.find((node) => reasons.has(node.ga.id));
    expect(dropped).toBeDefined();
    if (dropped) {
      expect(all.text).toContain(`${dropped.ga.text} | `);
      expect(used.text).not.toContain(`\n${dropped.ga.text} | `);
    }
    expect(used.text).toContain("bewusst weggelassen");
  });

  it("nennt Mittelgruppen, die nur im Vorrat vorkommen, als Vokabular", () => {
    const keep = template.groupAddresses.filter((node) => gaUsage(node) === "active");
    const reasons = excludedReasons(template, only({ reserve: true }));
    const vocabulary = reserveOnlyMiddleGroups(template, reasons);
    const usedNames = new Set(keep.map((node) => node.ranges[1]?.name.trim()));
    for (const name of vocabulary) expect(usedNames.has(name)).toBe(false);
    const prompt = buildSchemaPrompt(template, { maxGroupAddresses: 10_000, exclude: only({ reserve: true }) });
    if (vocabulary.length > 0) expect(prompt.text).toContain(vocabulary.join(" | "));
    else expect(prompt.text).not.toContain("nur im weggelassenen Vorrat");
  });

  it("fuehrt das Vokabular aus dem Vorrat nur mit Namen auf, nicht mit GAs", () => {
    const main = { id: "GR-EINS", name: "Hauptgruppe", start: 0, end: 0, parentId: undefined };
    const used = { id: "GR-A", name: "Schalten", start: 0, end: 0, parentId: "GR-EINS" };
    const idle = { id: "GR-B", name: "Szene Sondermodus", start: 0, end: 0, parentId: "GR-EINS" };
    const shaped: ProjectGraph = {
      ...template,
      groupAddresses: template.groupAddresses.map((node, index) => ({ ...node, ranges: [main, index < KEPT ? used : idle] })),
    };
    const exclude = only({ reserve: true });
    expect(reserveOnlyMiddleGroups(shaped, excludedReasons(shaped, exclude))).toEqual(["Szene Sondermodus"]);
    const prompt = buildSchemaPrompt(shaped, { maxGroupAddresses: 10_000, exclude });
    const [, vocabulary = ""] = prompt.text.split("nur im weggelassenen Vorrat");
    expect(vocabulary).toContain("Szene Sondermodus");
    expect(vocabulary).not.toContain("Schalten");
  });

  it("lässt bewusst abgewaehlte Hauptgruppen aus dem Vokabular heraus", () => {
    const group = mainGroups(split)[0];
    const reasons = excludedReasons(split, only({ ranges: [group?.id ?? ""] }));
    expect(reserveOnlyMiddleGroups(split, reasons)).toEqual([]);
  });
});

describe("Uebersicht und Suche", () => {
  it("zaehlt Nutzung, Hauptgruppen und Ausschluss zusammen", () => {
    const overview = buildScopeOverview(template, only({ reserve: true }));
    const usage = summarizeUsage(template);
    expect(overview).toMatchObject({ active: usage.active, idle: usage.idle, reserve: usage.reserve, total: template.groupAddresses.length });
    expect(overview.included + overview.excluded).toBe(overview.total);
    expect(overview.template).toBe(true);
    expect(overview.groups.some((group) => group.excluded)).toBe(false);
  });

  it("sucht in Adresse, Name und Bereich und meldet den Stand des Ausschlusses", () => {
    const sample = template.groupAddresses[3];
    expect(sample).toBeDefined();
    if (!sample) return;
    const word = sample.ga.name.split(/\s+/).find((part) => part.length >= 3) ?? sample.ga.name;
    const hit = searchScope(template, NO_EXCLUSION, word, 5);
    expect(hit.total).toBeGreaterThan(0);
    expect(hit.ids.length).toBe(hit.total);
    expect(hit.rows.length).toBeLessThanOrEqual(5);
    expect(hit.excluded).toBe(0);
    expect(searchScope(template, NO_EXCLUSION, sample.ga.text, 5).ids).toContain(sample.ga.id);
    expect(searchScope(template, only({ gas: hit.ids }), word, 5).excluded).toBe(hit.total);
    expect(searchScope(template, NO_EXCLUSION, "   ", 5).total).toBe(0);
    expect(searchScope(template, NO_EXCLUSION, "zzzz-gibt-es-nicht", 5).total).toBe(0);
  });

  it("liefert zu jeder ausgewerteten GA ein Detail wie bisher", () => {
    const analysis = analyzeProject(template, { ...OPTIONS, exclude: only({ reserve: true }) });
    const entry = analysis.recognition.groupAddresses[0];
    expect(entry).toBeDefined();
    if (entry) expect(buildDetail(entry, analysis.recognition.graph).claims.length).toBeGreaterThan(0);
  });
});

describe("Einzelne GAs ausschliessen und zurueckholen", () => {
  it("schreibt nur dort einen Eintrag, wo er etwas aendert", () => {
    const [a, b] = template.groupAddresses;
    const reserved = template.groupAddresses.find((node) => gaUsage(node) !== "active");
    expect(a && b && reserved).toBeTruthy();
    if (!a || !b || !reserved) return;
    // Schon durch den Vorrat ausgeschlossen: kein zusaetzlicher Eintrag.
    const withReserve = only({ reserve: true });
    expect(excludeIds(template, withReserve, [reserved.ga.id]).gas).toEqual([]);
    // Eine benutzte GA: Eintrag noetig.
    expect(excludeIds(template, withReserve, [a.ga.id]).gas).toEqual([a.ga.id]);
    // Zurueckholen ohne Regel, die sie ausschlosse: kein Eintrag, und ein alter Ausschluss faellt weg.
    const back = includeIds(template, only({ gas: [a.ga.id] }), [a.ga.id]);
    expect(back).toMatchObject({ gas: [], include: [] });
    // Vorrat zurueckholen: Eintrag noetig, solange die Regel gilt.
    const kept = includeIds(template, withReserve, [reserved.ga.id]);
    expect(kept.include).toEqual([reserved.ga.id]);
    expect(excludedReasons(template, kept).has(reserved.ga.id)).toBe(false);
    // Wieder ausschliessen nimmt den Eintrag zurueck.
    expect(excludeIds(template, kept, [reserved.ga.id])).toMatchObject({ gas: [], include: [] });
  });

  it("bleibt ueber wiederholte Aenderungen konsistent", () => {
    const ids = template.groupAddresses.map((node) => node.ga.id);
    let state = only({ reserve: true });
    state = includeIds(template, state, ids.slice(0, 10));
    state = excludeIds(template, state, ids.slice(5, 15));
    const reasons = excludedReasons(template, state);
    for (const id of ids.slice(5, 15)) expect(reasons.has(id)).toBe(true);
    for (const id of ids.slice(0, 5)) expect(reasons.has(id)).toBe(false);
    expect(new Set([...state.gas, ...state.include]).size).toBe(state.gas.length + state.include.length);
  });
});

describe("Things, die der Ausschluss auseinanderreisst", () => {
  it("zaehlt Things mit ausgeschlossenen und behaltenen GAs", () => {
    const full = analyzeProject(demo, OPTIONS);
    const multi = full.things.find((thing) => thing.draft.groupAddressIds.length >= 2);
    expect(multi).toBeDefined();
    if (!multi) return;
    const [first, ...rest] = multi.draft.groupAddressIds;
    const split = splitThings(full, new Set([first ?? ""]));
    expect(split.count).toBeGreaterThanOrEqual(1);
    expect(split.examples[0]?.dropped.length).toBeGreaterThan(0);
    expect(splitThings(full, new Set([first ?? "", ...rest])).examples.some((example) => example.thing === multi.draft.label)).toBe(false);
    expect(splitThings(full, new Set()).count).toBe(0);
  });
});

describe("Gespeicherter Ausschluss", () => {
  it("liest den Ausschluss und verwirft Unbrauchbares", () => {
    expect(parseExclusion({ reserve: true, ranges: ["a", 3, "a"], gas: ["x", "", "y"], include: ["y", "z"] })).toEqual({
      reserve: true,
      ranges: ["a"],
      gas: ["x", "y"],
      include: ["z"],
    });
    expect(parseExclusion(null)).toBeUndefined();
    expect(parseExclusion([])).toBeUndefined();
    expect(parseExclusion({ reserve: "ja" })).toEqual(NO_EXCLUSION);
  });

  it("behaelt den Ausschluss von GAs ohne Gruppenbereich ueber das Speichern", () => {
    const stored = JSON.parse(JSON.stringify({ ...NO_EXCLUSION, ranges: [NO_GROUP] })) as unknown;
    expect(parseExclusion(stored)?.ranges).toEqual([NO_GROUP]);
    const loose: ProjectGraph = { ...template, groupAddresses: template.groupAddresses.map((node, index) => (index < 2 ? { ...node, ranges: [] } : node)) };
    expect(excludedReasons(loose, only({ ranges: [NO_GROUP] })).size).toBe(2);
  });

  it("uebernimmt den alten Umfang 'nur in Benutzung' als Ausschluss des Vorrats", () => {
    expect(exclusionFromState({ scope: "used" })).toEqual({ ...NO_EXCLUSION, reserve: true });
    // "all" war eine ausdrueckliche Wahl und bleibt es.
    expect(exclusionFromState({ scope: "all" })).toEqual(NO_EXCLUSION);
    expect(exclusionFromState({})).toBeUndefined();
    // Der neue Eintrag geht dem alten vor.
    expect(exclusionFromState({ scope: "used", exclude: { reserve: false, ranges: ["a"] } })).toMatchObject({ reserve: false, ranges: ["a"] });
  });
});
