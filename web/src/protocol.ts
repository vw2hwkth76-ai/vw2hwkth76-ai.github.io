import type { ReviewCheck } from "../../src/app/review-check.ts";
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

export type Request = OpenRequest | AnalyzeRequest | DetailRequest | ReportRequest | TdRequest | TdZipRequest;

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

export interface ResultOf {
  readonly open: OpenResult;
  readonly analyze: AnalyzeResult;
  readonly detail: GaDetail;
  readonly report: ReportResult;
  readonly td: TdResult;
  readonly "td-zip": ArrayBuffer;
}

export interface WorkerError {
  readonly code: string;
  readonly message: string;
}

export type Response =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: WorkerError };
