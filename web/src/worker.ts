/// <reference lib="webworker" />
import { strToU8, zipSync } from "fflate";
import { ArchiveError } from "../../src/archive/errors.ts";
import { buildGold, buildReport, formatLink, reportSummary } from "../../src/app/report.ts";
import { checkReviews, type ReviewCheck } from "../../src/app/review-check.ts";
import { buildScopeOverview, searchScope, splitThings } from "../../src/app/scope-view.ts";
import { buildDetail, buildExcludedDetail, buildSnapshot, projectKey, type Snapshot } from "../../src/app/snapshot.ts";
import { loadKnxProject } from "../../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../../src/graph/evidence-graph.ts";
import { excludedReasons, excludeIds, includeIds, restrictGraph } from "../../src/graph/scope.ts";
import type { ClaimDimension } from "../../src/recognize/claims.ts";
import { analyzeProject, type ProjectAnalysis } from "../../src/recognize/pipeline.ts";
import { readiness } from "../../src/bench/readiness.ts";
import { ASPECT_LABEL, DIRECTION_LABEL, TRADE_LABEL } from "../../src/app/labels.ts";
import { dptDotted } from "../../src/ets/dpt-id.ts";
import { compileProfile, type NamingProfile, parseProfile, profileJson } from "../../src/recognize/profile.ts";
import { type SchemaMeaning, schemaCoverage } from "../../src/recognize/schema.ts";
import { buildSchemaPrompt } from "../../src/recognize/schema-prompt.ts";
import { buildThingDescriptions, type TdBundle, type TdOptions } from "../../src/td/render.ts";
import { XmlError } from "../../src/xml/sax.ts";
import type {
  AnalyzeResult,
  OpenResult,
  PreviewFigures,
  ReportResult,
  Request,
  Response,
  SchemaPreviewResult,
  SchemaPromptResult,
  TdResult,
  WorkerError,
} from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

let graph: ProjectGraph | undefined;
let analysis: ProjectAnalysis | undefined;
let last: { snapshot: Snapshot; check: ReviewCheck | undefined; profile: NamingProfile | undefined; reviewCount: number } | undefined;
/** Erkennung ohne Antworten; haengt nur von Profil und ETS-Schalter ab, nicht von den Antworten. */
let baseline: { key: string; analysis: ProjectAnalysis } | undefined;
/** Letzter TD-Export, gilt fuer genau diese Analyse und diese Optionen. */
let tdCache: { analysis: ProjectAnalysis; key: string; bundle: TdBundle } | undefined;

async function tdBundle(options: TdOptions, toolVersion: string): Promise<TdBundle> {
  if (!analysis) throw new Error("Noch keine Analyse vorhanden.");
  const key = JSON.stringify([options, toolVersion]);
  if (tdCache?.analysis === analysis && tdCache.key === key) return tdCache.bundle;
  const bundle = await buildThingDescriptions(analysis, options, toolVersion);
  tdCache = { analysis, key, bundle };
  return bundle;
}

function readme(bundle: TdBundle, options: TdOptions, toolVersion: string): string {
  return [
    `Thing Descriptions aus der KNX TD Werkstatt ${toolVersion}`,
    "",
    `Format: W3C WoT Thing Description ${options.version === "2.0" ? "2.0 (Working Draft, Kontext vorläufig)" : "1.1"}`,
    `Befehle: ${options.commands === "action" ? "Action plus lesbare Status-Property" : "Property mit Schreib- und Lese-Form"}`,
    `Auswahl: ${options.strict ? "nur fest belegte oder bestätigte GAs" : "alle GAs, Herkunft je Form in kb:evidence"}`,
    "",
    "things/*.td.json            Feld-TD mit KNX-Forms (href = Gruppenadresse, base = Gateway)",
    "things/*.platform.td.json   Plattform-TD mit HTTP-Forms, Beobachten per Server-Sent Events",
    "models/*.tm.json            Thing Models je KNX-Funktionstyp aus knx_master.xml",
    "collection.td.json          Sammel-TD mit Links auf alle Feld-TDs",
    "knx-binding.jsonld          JSON-LD-Kontext der Begriffe mit Präfix kb:",
    "",
    `${bundle.things.length} Things, ${bundle.skipped.length} übersprungen, ${bundle.excludedGroupAddresses} GAs ausgeschlossen.`,
    "Platzhalter: Gateway-Basis und Plattform-URL vor dem Einsatz anpassen.",
    "",
  ].join("\n");
}

function figures(result: ProjectAnalysis): PreviewFigures {
  const ready = readiness(result);
  return { groupAddresses: ready.groupAddresses, ready: ready.ready, firm: ready.firm, things: ready.things, questions: ready.questions };
}

/** Bedeutung eines Schema-Werts in Worten, fuer die Liste vor der Bestaetigung. */
function describeMeaning(meaning: SchemaMeaning): string {
  return [
    meaning.trade ? TRADE_LABEL[meaning.trade] : undefined,
    meaning.direction ? DIRECTION_LABEL[meaning.direction] : undefined,
    meaning.aspect ? ASPECT_LABEL[meaning.aspect] : undefined,
    meaning.dpt ? `DPT ${dptDotted(meaning.dpt)}` : undefined,
    meaning.room ? `Raum ${meaning.room}` : undefined,
    meaning.label ? `"${meaning.label}"` : undefined,
    meaning.thing ? `Thing wie ${meaning.thing}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ");
}

/** Erkennung ohne Schema fuer den Vergleich; haengt nur vom ETS-Schalter ab. */
let plain: { key: string; figures: PreviewFigures } | undefined;

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case "open": {
      const started = performance.now();
      graph = undefined;
      analysis = undefined;
      last = undefined;
      baseline = undefined;
      plain = undefined;
      tdCache = undefined;
      const loaded = await loadKnxProject(new Uint8Array(request.data), request.password === undefined ? {} : { password: request.password });
      graph = buildGraph(loaded);
      const result: OpenResult = {
        key: projectKey(loaded),
        name: loaded.project.name,
        passwordProtected: loaded.passwordProtected,
        milliseconds: Math.round(performance.now() - started),
      };
      return result;
    }
    case "analyze": {
      if (!graph) throw new Error("Kein Projekt geladen.");
      const started = performance.now();
      let profileErrors: string[] = [];
      let parsedProfile: NamingProfile | undefined;
      let profile;
      if (request.profile !== undefined && request.profile !== null) {
        const parsed = parseProfile(request.profile);
        if (parsed.ok) {
          parsedProfile = parsed.profile;
          profile = compileProfile(parsed.profile, graph.loaded.project.spaces);
        } else {
          profileErrors = parsed.errors;
        }
      }
      const reviews = new Map<string, Partial<Record<ClaimDimension, string>>>(Object.entries(request.reviews));
      const base = { useEtsFunctions: request.useEtsFunctions, exclude: request.exclude, ...(profile ? { profile } : {}) };
      analysis = analyzeProject(graph, { ...base, reviews });
      let check: ReviewCheck | undefined;
      if (reviews.size > 0) {
        const key = JSON.stringify([request.useEtsFunctions, request.exclude, parsedProfile ?? null]);
        if (baseline?.key !== key) baseline = { key, analysis: analyzeProject(graph, base) };
        check = checkReviews(baseline.analysis, reviews);
      }
      const snapshot = buildSnapshot(analysis, profile?.warnings ?? []);
      last = { snapshot, check, profile: parsedProfile, reviewCount: reviews.size };
      const result: AnalyzeResult = { snapshot, profileErrors, reviewCheck: check, milliseconds: Math.round(performance.now() - started) };
      return result;
    }
    case "detail": {
      const entry = analysis?.recognition.byGroupAddressId.get(request.gaId);
      if (entry && graph) return buildDetail(entry, graph);
      const out = analysis?.excluded.has(request.gaId) ? analysis.full.byGroupAddressId.get(request.gaId) : undefined;
      if (out && graph) return buildExcludedDetail(out, graph);
      throw new Error(`Gruppenadresse ${request.gaId} ist nicht bekannt.`);
    }
    case "td": {
      const started = performance.now();
      const bundle = await tdBundle(request.options, request.toolVersion);
      const result: TdResult = {
        things: bundle.things,
        skipped: bundle.skipped,
        excludedGroupAddresses: bundle.excludedGroupAddresses,
        files: bundle.files.map((file) => ({ path: file.path, text: JSON.stringify(file.json, null, 2) })),
        milliseconds: Math.round(performance.now() - started),
      };
      return result;
    }
    case "td-zip": {
      const bundle = await tdBundle(request.options, request.toolVersion);
      const entries: Record<string, Uint8Array> = { "LIESMICH.txt": strToU8(readme(bundle, request.options, request.toolVersion)) };
      for (const file of bundle.files) entries[file.path] = strToU8(`${JSON.stringify(file.json, null, 2)}\n`);
      const zip = zipSync(entries, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") });
      return transfer(zip.buffer);
    }
    case "schema-prompt": {
      if (!graph) throw new Error("Kein Projekt geladen.");
      const prompt = buildSchemaPrompt(graph, { maskPersons: request.maskPersons, exclude: request.exclude });
      const result: SchemaPromptResult = { text: prompt.text, groupAddresses: prompt.groupAddresses, included: prompt.included, excluded: prompt.excluded, masked: prompt.masked };
      return result;
    }
    case "scope-overview": {
      if (!graph) throw new Error("Kein Projekt geladen.");
      return buildScopeOverview(graph, request.exclude);
    }
    case "scope-apply": {
      if (!graph) throw new Error("Kein Projekt geladen.");
      const ids = request.ids ?? searchScope(graph, request.exclude, request.query ?? "", 1).ids;
      return request.action === "exclude" ? excludeIds(graph, request.exclude, ids) : includeIds(graph, request.exclude, ids);
    }
    case "scope-splits": {
      if (!graph) throw new Error("Kein Projekt geladen.");
      const parsed = request.profile === undefined || request.profile === null ? undefined : parseProfile(request.profile);
      const profile = parsed?.ok ? compileProfile(parsed.profile, graph.loaded.project.spaces) : undefined;
      const full = analyzeProject(graph, { useEtsFunctions: request.useEtsFunctions, ...(profile ? { profile } : {}) });
      return splitThings(full, new Set(excludedReasons(graph, request.exclude).keys()));
    }
    case "scope-search": {
      if (!graph) throw new Error("Kein Projekt geladen.");
      return searchScope(graph, request.exclude, request.query, Math.min(Math.max(request.limit, 1), 200));
    }
    case "schema-preview": {
      if (!graph) throw new Error("Kein Projekt geladen.");
      const started = performance.now();
      const parsed = parseProfile(request.profile);
      if (!parsed.ok) return { ok: false, errors: parsed.errors } satisfies SchemaPreviewResult;
      const compiled = compileProfile(parsed.profile, graph.loaded.project.spaces);
      const plainKey = JSON.stringify([request.useEtsFunctions, request.exclude]);
      if (plain?.key !== plainKey) {
        plain = { key: plainKey, figures: figures(analyzeProject(graph, { useEtsFunctions: request.useEtsFunctions, exclude: request.exclude })) };
      }
      const after = figures(analyzeProject(graph, { useEtsFunctions: request.useEtsFunctions, exclude: request.exclude, profile: compiled }));
      // Abdeckung nur ueber die GAs, die ausgewertet werden; ausgeschlossene muss das Schema nicht lesen.
      const evaluated = restrictGraph(graph, excludedReasons(graph, request.exclude)).groupAddresses;
      const coverage = compiled.schema ? schemaCoverage(compiled.schema, evaluated.map((node) => ({ name: node.ga.name, ranges: node.ranges.map((range) => range.name) }))) : undefined;
      const { schema } = parsed.profile;
      const result: SchemaPreviewResult = {
        ok: true,
        profile: profileJson(parsed.profile),
        name: parsed.profile.name,
        description: schema.description,
        warnings: [...parsed.warnings, ...compiled.warnings],
        patterns: schema.patterns.map((pattern, index) => ({ regex: pattern.regex, matched: coverage?.perPattern[index] ?? 0 })),
        unmatched: coverage?.unmatched ?? evaluated.length,
        unmatchedExamples: coverage?.unmatchedExamples ?? [],
        unknownRooms: coverage?.unknownRooms ?? [],
        values: Object.entries(schema.values).flatMap(([group, table]) =>
          Object.entries(table).map(([value, meaning]) => ({ group, value, meaning: describeMeaning(meaning) })),
        ),
        rules: schema.rules.map((rule) => ({ match: rule.match, meaning: describeMeaning(rule), why: rule.why })),
        entries: parsed.profile.entries.length,
        before: plain.figures,
        after,
        milliseconds: Math.round(performance.now() - started),
      };
      return result;
    }
    case "report": {
      if (!analysis || !graph || !last) throw new Error("Noch keine Analyse vorhanden.");
      const links = new Map<string, string[]>();
      for (const entry of analysis.recognition.groupAddresses) {
        links.set(entry.analysis.node.ga.id, buildDetail(entry, graph).links.map(formatLink));
      }
      const report = buildReport(last.snapshot, {
        toolVersion: request.toolVersion,
        profile: last.profile,
        reviewCount: last.reviewCount,
        date: request.date,
        links,
        ...(last.check ? { reviewCheck: last.check } : {}),
      });
      const result: ReportResult = {
        report: JSON.stringify(report, null, 2),
        summary: reportSummary(last.snapshot, last.check),
        gold: JSON.stringify(buildGold(last.snapshot, request.date), null, 2),
      };
      return result;
    }
  }
}

function toError(error: unknown): WorkerError {
  if (error instanceof ArchiveError) return { code: error.code, message: error.message };
  if (error instanceof XmlError) return { code: "xml", message: error.message };
  if (error instanceof Error) return { code: "internal", message: error.message };
  return { code: "internal", message: String(error) };
}

/** Markiert ein Ergebnis, dessen Puffer uebergeben statt kopiert wird. */
class Transfer {
  constructor(readonly buffer: ArrayBuffer) {}
}

function transfer(buffer: ArrayBuffer): Transfer {
  return new Transfer(buffer);
}

self.addEventListener("message", (event: MessageEvent<{ id: number; request: Request }>) => {
  const { id, request } = event.data;
  handle(request).then(
    (result) =>
      result instanceof Transfer
        ? self.postMessage({ id, ok: true, result: result.buffer } satisfies Response, [result.buffer])
        : self.postMessage({ id, ok: true, result } satisfies Response),
    (error: unknown) => self.postMessage({ id, ok: false, error: toError(error) } satisfies Response),
  );
});
