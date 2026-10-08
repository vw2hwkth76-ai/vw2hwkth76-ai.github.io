export type ArchiveErrorCode =
  | "not-a-zip"
  | "corrupt"
  | "unsupported"
  | "limit-exceeded"
  | "password-required"
  | "password-wrong"
  | "structure";

/** Fehler beim Lesen eines Archivs. Die Meldung ist fuer Menschen gedacht und auf Deutsch. */
export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;

  constructor(code: ArchiveErrorCode, message: string) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
  }
}
