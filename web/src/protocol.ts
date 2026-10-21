import type { ReviewCheck } from "../../src/app/review-check.ts";
import type { ScopeOverview, ScopeSearch, SplitThings } from "../../src/app/scope-view.ts";
import type { AssetModel, Gap, ModelType, SiteInput } from "../../src/assets/model.ts";
import type { Exclusion } from "../../src/graph/scope.ts";
import type { GaDetail, Snapshot } from "../../src/app/snapshot.ts";
import type { TdBundle, TdOptions } from "../../src/td/render.ts";
import type { ClaimDimension } from "../../src/recognize/claims.ts";

/** Nachrichten zwischen Oberflaeche und Analyse-Worker. */

export type ReviewRecord = Readonly<Record<string, Readonly<Partial<Record<ClaimDimension, string>>>>>;

export interface OpenRequest {
  readonly type: "open";
  readonly data: ArrayBuffer;
  readonly password: string | undefined;
}

export interface AnalyzeRequest {
  readonly type: "analyze";
  readonly reviews: ReviewRecord;
  /** Rohes Profil-JSON; der Worker prueft es selbst. */
  readonly profile: unknown;
  readonly useEtsFunctions: boolean;
  /** Welche GAs ausgewertet werden. */
  readonly exclude: Exclusion;
}

export interface DetailRequest {
  readonly type: "detail";
  readonly gaId: string;
}

export interface ReportRequest {
  readonly type: "report";
  readonly toolVersion: string;
  readonly date: string;
}

export interface TdRequest {
  readonly type: "td";
  readonly options: TdOptions;
  readonly toolVersion: string;
}

export interface TdZipRequest {
  readonly type: "td-zip";
  readonly options: TdOptions;
  readonly toolVersion: string;
}

export interface SchemaPromptRequest {
  readonly type: "schema-prompt";
  readonly maskPersons: boolean;
  readonly exclude: Exclusion;
}

/** Umfang des Projekts mit den Zahlen, die der Ausschluss ergibt; braucht keine Analyse. */
export interface ScopeOverviewRequest {
  readonly type: "scope-overview";
  readonly exclude: Exclusion;
}

/** Schliesst GAs ein oder aus; gemeint sind entweder genannte Ids oder alle Treffer einer Suche. */
export interface ScopeApplyRequest {
  readonly type: "scope-apply";
  readonly exclude: Exclusion;
  readonly action: "exclude" | "include";
  readonly ids?: readonly string[];
  readonly query?: string;
}

/** Things, die der Ausschluss auseinanderreisst; rechnet eine Erkennung ohne Ausschluss. */
export interface ScopeSplitsRequest {
  readonly type: "scope-splits";
  readonly exclude: Exclusion;
  readonly profile: unknown;
  readonly useEtsFunctions: boolean;
}

/** GAs nach Adresse, Name oder Bereich suchen, fuer den Ausschluss von Treffern. */
export interface ScopeSearchRequest {
  readonly type: "scope-search";
  readonly exclude: Exclusion;
  readonly query: string;
  readonly limit: number;
}

/** Prueft ein vorgeschlagenes Schema am geladenen Projekt, ohne den Projektstand zu aendern. */
export interface SchemaPreviewRequest {
  readonly type: "schema-preview";
  readonly profile: unknown;
  readonly useEtsFunctions: boolean;
  readonly exclude: Exclusion;
}

/** Asset-Modell fuer die Building Pro Integration; das Zielprofil kommt roh, der Worker prueft es. */
export interface AssetModelRequest {
  readonly type: "asset-model";
  readonly profile: unknown;
  readonly site: SiteInput;
  readonly toolVersion: string;
}

export interface AssetZipRequest {
  readonly type: "asset-zip";
  readonly profile: unknown;
  readonly site: SiteInput;
  readonly toolVersion: string;
}

/** Prueft eine LLM-Antwort mit Zuordnungsregeln und liefert das ergaenzte Profil. */
export interface AssetAnswerRequest {
  readonly type: "asset-answer";
  readonly profile: unknown;
  readonly answer: unknown;
}

export type Request =
  | OpenRequest
  | AnalyzeRequest
  | DetailRequest
  | ReportRequest
  | TdRequest
  | TdZipRequest
  | SchemaPromptRequest
  | SchemaPreviewRequest
  | ScopeOverviewRequest
  | ScopeSearchRequest
  | ScopeApplyRequest
  | ScopeSplitsRequest
  | AssetModelRequest
  | AssetZipRequest
  | AssetAnswerRequest;

export type AssetModelResult =
  | { readonly ok: false; readonly errors: readonly string[] }
  | {
      readonly ok: true;
      readonly profileName: string;
      readonly profileWarnings: readonly string[];
      readonly stats: AssetModel["stats"];
      readonly types: readonly ModelType[];
      readonly gaps: readonly Gap[];
      /** Ortsbaum als Markdown, gekuerzt fuer die Vorschau. */
      readonly tree: string;
      readonly treeTruncated: boolean;
      /** Prompt fuer die KI-Zuordnung, wenn etwas offen ist und ein Zielprofil geladen ist. */
      readonly prompt: string | undefined;
      readonly milliseconds: number;
    };

export type AssetAnswerResult = { readonly ok: false; readonly errors: readonly string[] } | { readonly ok: true; readonly profile: unknown; readonly warnings: readonly string[] };

export interface OpenResult {
  readonly key: string;
  readonly name: string;
  readonly passwordProtected: boolean;
  readonly milliseconds: number;
}

export interface AnalyzeResult {
  readonly snapshot: Snapshot;
  readonly profileErrors: readonly string[];
  /** Erkennung ohne Antworten gegen die Antworten; fehlt, solange nichts bestaetigt ist. */
  readonly reviewCheck: ReviewCheck | undefined;
  readonly milliseconds: number;
}

export interface ReportResult {
  readonly report: string;
  readonly summary: string;
  readonly gold: string;
}

export interface TdResult extends Omit<TdBundle, "files"> {
  /** Pfad und formatiertes JSON je Datei, fuer die Vorschau. */
  readonly files: readonly { readonly path: string; readonly text: string }[];
  readonly milliseconds: number;
}

export interface SchemaPromptResult {
  readonly text: string;
  /** Alle GAs des Projekts. */
  readonly groupAddresses: number;
  /** GAs, die als Zeile im Prompt stehen. */
  readonly included: number;
  /** GAs, die der Ausschluss weglaesst. */
  readonly excluded: number;
  readonly masked: number;
}

/** Kennzahlen einer Erkennung, fuer den Vergleich mit und ohne Schema. */
export interface PreviewFigures {
  /** GAs in Benutzung. */
  readonly groupAddresses: number;
  readonly ready: number;
  readonly firm: number;
  readonly things: number;
  readonly questions: number;
}

export type SchemaPreviewResult =
  | { readonly ok: false; readonly errors: readonly string[] }
  | {
      readonly ok: true;
      /** Kanonische Dateiform; so wird es uebernommen und gespeichert. */
      readonly profile: unknown;
      readonly name: string;
      readonly description: string;
      readonly warnings: readonly string[];
      readonly patterns: readonly { readonly regex: string; readonly matched: number }[];
      readonly unmatched: number;
      readonly unmatchedExamples: readonly string[];
      readonly unknownRooms: readonly string[];
      readonly values: readonly { readonly group: string; readonly value: string; readonly meaning: string }[];
      readonly rules: readonly { readonly match: string; readonly meaning: string; readonly why: string | undefined }[];
      readonly entries: number;
      readonly before: PreviewFigures;
      readonly after: PreviewFigures;
      readonly milliseconds: number;
    };

export interface ResultOf {
  readonly open: OpenResult;
  readonly analyze: AnalyzeResult;
  readonly detail: GaDetail;
  readonly report: ReportResult;
  readonly td: TdResult;
  readonly "td-zip": ArrayBuffer;
  readonly "schema-prompt": SchemaPromptResult;
  readonly "schema-preview": SchemaPreviewResult;
  readonly "scope-overview": ScopeOverview;
  readonly "scope-search": ScopeSearch;
  readonly "scope-apply": Exclusion;
  readonly "scope-splits": SplitThings;
  readonly "asset-model": AssetModelResult;
  readonly "asset-zip": ArrayBuffer;
  readonly "asset-answer": AssetAnswerResult;
}

export interface WorkerError {
  readonly code: string;
  readonly message: string;
}

export type Response =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: WorkerError };
