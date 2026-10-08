/// <reference lib="webworker" />
import { ArchiveError } from "../../src/archive/errors.ts";
import { buildGold, buildReport, formatLink, reportSummary } from "../../src/app/report.ts";
import { checkReviews, type ReviewCheck } from "../../src/app/review-check.ts";
import { buildDetail, buildSnapshot, projectKey, type Snapshot } from "../../src/app/snapshot.ts";
import { loadKnxProject } from "../../src/ets/load.ts";
import { buildGraph, type ProjectGraph } from "../../src/graph/evidence-graph.ts";
import type { ClaimDimension } from "../../src/recognize/claims.ts";
import { analyzeProject, type ProjectAnalysis } from "../../src/recognize/pipeline.ts";
import { compileProfile, type NamingProfile, parseProfile } from "../../src/recognize/profile.ts";
import { XmlError } from "../../src/xml/sax.ts";
import type { AnalyzeResult, OpenResult, ReportResult, Request, Response, WorkerError } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

let graph: ProjectGraph | undefined;
let analysis: ProjectAnalysis | undefined;
let last: { snapshot: Snapshot; check: ReviewCheck | undefined; profile: NamingProfile | undefined; reviewCount: number } | undefined;
/** Erkennung ohne Antworten; haengt nur von Profil und ETS-Schalter ab, nicht von den Antworten. */
let baseline: { key: string; analysis: ProjectAnalysis } | undefined;

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case "open": {
      const started = performance.now();
      graph = undefined;
      analysis = undefined;
      last = undefined;
      baseline = undefined;
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
      const base = { useEtsFunctions: request.useEtsFunctions, ...(profile ? { profile } : {}) };
      analysis = analyzeProject(graph, { ...base, reviews });
      let check: ReviewCheck | undefined;
      if (reviews.size > 0) {
        const key = JSON.stringify([request.useEtsFunctions, parsedProfile ?? null]);
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
      if (!entry || !graph) throw new Error(`Gruppenadresse ${request.gaId} ist nicht bekannt.`);
      return buildDetail(entry, graph);
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

self.addEventListener("message", (event: MessageEvent<{ id: number; request: Request }>) => {
  const { id, request } = event.data;
  handle(request).then(
    (result) => self.postMessage({ id, ok: true, result } satisfies Response),
    (error: unknown) => self.postMessage({ id, ok: false, error: toError(error) } satisfies Response),
  );
});
