export type Severity = "info" | "warning" | "error";

export interface DiagnosticRefs {
  readonly groupAddress?: string;
  readonly device?: string;
  readonly comObject?: string;
  readonly space?: string;
  readonly function?: string;
  readonly file?: string;
}

/** Befund mit stabilem Code fuer Filter und Tests und einer deutschen Meldung fuer Menschen. */
export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly refs: DiagnosticRefs;
}

export function diagnostic(
  code: string,
  severity: Severity,
  message: string,
  refs: DiagnosticRefs = {},
): Diagnostic {
  return { code, severity, message, refs };
}
