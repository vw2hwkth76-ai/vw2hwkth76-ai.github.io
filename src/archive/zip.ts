import { Inflate } from "fflate";
import { concat } from "./bytes.ts";
import { crc32 } from "./crc32.ts";
import { ArchiveError } from "./errors.ts";
import { type AesStrength, decryptWinZipAes } from "./winzip-aes.ts";
import { decryptZipCrypto } from "./zipcrypto.ts";

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EXTRA_ZIP64 = 0x0001;
const EXTRA_AES = 0x9901;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const METHOD_AES = 99;
const FLAG_ENCRYPTED = 0x1;
const FLAG_DATA_DESCRIPTOR = 0x8;
const FLAG_UTF8 = 0x800;
const INFLATE_CHUNK = 1 << 16;

export interface ZipLimits {
  /** Hoechstzahl der Eintraege im Zentralverzeichnis. */
  readonly maxEntries: number;
  /** Hoechstgroesse eines entpackten Eintrags, tatsaechlich gezaehlt, nicht deklariert. */
  readonly maxEntryBytes: number;
  /** Summe aller entpackten Bytes ueber die Lebensdauer des Archivs. */
  readonly maxTotalBytes: number;
}

export const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
};

export type Encryption =
  | { kind: "none" }
  | { kind: "zipcrypto" }
  | { kind: "aes"; strength: AesStrength; vendorVersion: number; method: number };

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly modTime: number;
  readonly encryption: Encryption;
  readonly isDirectory: boolean;
}

export type ReadResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; reason: "password-required" | "password-wrong" };

export class ZipArchive {
  readonly entries: readonly ZipEntry[];
  readonly #data: Uint8Array;
  readonly #view: DataView;
  readonly #limits: ZipLimits;
  readonly #byName: Map<string, ZipEntry>;
  #produced = 0;

  private constructor(data: Uint8Array, entries: ZipEntry[], limits: ZipLimits) {
    this.#data = data;
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.#limits = limits;
    this.entries = entries;
    this.#byName = new Map(entries.map((entry) => [entry.name, entry]));
  }

  static open(data: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): ZipArchive {
    return new ZipArchive(data, readCentralDirectory(data, limits), limits);
  }

  get(name: string): ZipEntry | undefined {
    return this.#byName.get(name);
  }

  /** Liest einen unverschluesselten Eintrag; verschluesselte melden password-required. */
  async read(entry: ZipEntry, passwords: readonly Uint8Array[] = []): Promise<ReadResult> {
    const raw = this.#rawData(entry);
    if (entry.encryption.kind === "none") {
      return { ok: true, data: this.#decompress(entry, entry.method, raw, true) };
    }
    if (passwords.length === 0) return { ok: false, reason: "password-required" };

    if (entry.encryption.kind === "zipcrypto") {
      const check =
        entry.flags & FLAG_DATA_DESCRIPTOR ? (entry.modTime >>> 8) & 0xff : entry.crc32 >>> 24;
      for (const password of passwords) {
        const plain = decryptZipCrypto(raw, password, check);
        if (plain === undefined) continue;
        try {
          return { ok: true, data: this.#decompress(entry, entry.method, plain, true) };
        } catch (error) {
          // Ein Pruefbyte passt in einem von 256 Faellen zufaellig; dann scheitert erst das Entpacken.
          if (error instanceof ArchiveError && error.code === "corrupt") continue;
          throw error;
        }
      }
      return { ok: false, reason: "password-wrong" };
    }

    const aes = entry.encryption;
    let integrityFailure = false;
    for (const password of passwords) {
      const result = await decryptWinZipAes(raw, aes.strength, password);
      if (result.ok) {
        // AE-2 traegt keine CRC, die Integritaet sichert dort der HMAC.
        const checkCrc = aes.vendorVersion === 1;
        return { ok: true, data: this.#decompress(entry, aes.method, result.data, checkCrc) };
      }
      if (result.reason === "integrity") integrityFailure = true;
    }
    // Ein falsches Passwort trifft den Pruefwert nur in einem von 65536 Faellen.
    // Scheitert danach der HMAC, sind mit hoher Wahrscheinlichkeit die Daten beschaedigt.
    if (integrityFailure) {
      throw new ArchiveError(
        "corrupt",
        `${entry.name}: Pruefsumme der Verschluesselung stimmt nicht. Das Archiv ist vermutlich beschaedigt.`,
      );
    }
    return { ok: false, reason: "password-wrong" };
  }

  #rawData(entry: ZipEntry): Uint8Array {
    const offset = entry.localHeaderOffset;
    if (offset + 30 > this.#data.byteLength || this.#view.getUint32(offset, true) !== SIG_LOCAL) {
      throw new ArchiveError("corrupt", `${entry.name}: lokaler Dateikopf fehlt oder ist beschaedigt.`);
    }
    const nameLength = this.#view.getUint16(offset + 26, true);
    const extraLength = this.#view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > this.#data.byteLength) {
      throw new ArchiveError("corrupt", `${entry.name}: Daten reichen ueber das Dateiende hinaus.`);
    }
    return this.#data.subarray(start, end);
  }

  #decompress(entry: ZipEntry, method: number, data: Uint8Array, checkCrc: boolean): Uint8Array {
    const budget = Math.min(this.#limits.maxEntryBytes, this.#limits.maxTotalBytes - this.#produced);
    let out: Uint8Array;
    if (method === METHOD_STORED) {
      if (data.byteLength > budget) throw limitError(entry.name);
      out = data;
    } else if (method === METHOD_DEFLATE) {
      out = inflateLimited(data, budget, entry.name);
    } else {
      throw new ArchiveError(
        "unsupported",
        `${entry.name}: Kompressionsverfahren ${method} wird nicht unterstuetzt (erwartet: Deflate).`,
      );
    }
    this.#produced += out.byteLength;
    if (checkCrc && crc32(out) !== entry.crc32) {
      throw new ArchiveError("corrupt", `${entry.name}: CRC-Pruefsumme stimmt nicht, Archiv beschaedigt.`);
    }
    return out;
  }
}

function limitError(name: string): ArchiveError {
  return new ArchiveError(
    "limit-exceeded",
    `${name}: entpackte Daten ueberschreiten das Verarbeitungslimit. Moeglicherweise ein manipuliertes Archiv.`,
  );
}

function inflateLimited(data: Uint8Array, budget: number, name: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.byteLength;
    if (total > budget) throw limitError(name);
    chunks.push(chunk);
  });
  try {
    if (data.byteLength === 0) inflater.push(new Uint8Array(0), true);
    for (let i = 0; i < data.byteLength; i += INFLATE_CHUNK) {
      const end = Math.min(i + INFLATE_CHUNK, data.byteLength);
      inflater.push(data.subarray(i, end), end === data.byteLength);
    }
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError("corrupt", `${name}: Deflate-Daten sind beschaedigt.`);
  }
  return concat(chunks, total);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= minimum; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new ArchiveError("not-a-zip", "Die Datei ist kein ZIP-Archiv (knxproj).");
}

function readCentralDirectory(data: Uint8Array, limits: ZipLimits): ZipEntry[] {
  if (data.byteLength < 22) throw new ArchiveError("not-a-zip", "Die Datei ist kein ZIP-Archiv (knxproj).");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  let count = view.getUint16(eocd + 10, true);
  let size = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);

  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || view.getUint32(locator, true) !== SIG_ZIP64_LOCATOR) {
      throw new ArchiveError("corrupt", "ZIP64-Verweis fehlt, das Archiv ist beschaedigt.");
    }
    const record = safeNumber(view.getBigUint64(locator + 8, true));
    if (record + 56 > data.byteLength || view.getUint32(record, true) !== SIG_ZIP64_EOCD) {
      throw new ArchiveError("corrupt", "ZIP64-Verzeichnisende fehlt, das Archiv ist beschaedigt.");
    }
    count = safeNumber(view.getBigUint64(record + 32, true));
    size = safeNumber(view.getBigUint64(record + 40, true));
    offset = safeNumber(view.getBigUint64(record + 48, true));
  }

  if (count > limits.maxEntries) {
    throw new ArchiveError(
      "limit-exceeded",
      `Das Archiv enthaelt ${count} Eintraege, erlaubt sind ${limits.maxEntries}.`,
    );
  }
  if (offset + size > data.byteLength) {
    throw new ArchiveError("corrupt", "Das Zentralverzeichnis reicht ueber das Dateiende hinaus.");
  }

  const entries: ZipEntry[] = [];
  let pos = offset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > data.byteLength || view.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new ArchiveError("corrupt", "Das Zentralverzeichnis ist beschaedigt.");
    }
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const modTime = view.getUint16(pos + 12, true);
    const crc = view.getUint32(pos + 16, true);
    let compressedSize = view.getUint32(pos + 20, true);
    let uncompressedSize = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    let localHeaderOffset = view.getUint32(pos + 42, true);
    const nameBytes = data.subarray(pos + 46, pos + 46 + nameLength);
    const extra = data.subarray(pos + 46 + nameLength, pos + 46 + nameLength + extraLength);

    let encryption: Encryption = { kind: "none" };
    for (const field of extraFields(extra)) {
      const fieldView = new DataView(field.data.buffer, field.data.byteOffset, field.data.byteLength);
      if (field.id === EXTRA_ZIP64) {
        let at = 0;
        if (uncompressedSize === 0xffffffff && at + 8 <= field.data.byteLength) {
          uncompressedSize = safeNumber(fieldView.getBigUint64(at, true));
          at += 8;
        }
        if (compressedSize === 0xffffffff && at + 8 <= field.data.byteLength) {
          compressedSize = safeNumber(fieldView.getBigUint64(at, true));
          at += 8;
        }
        if (localHeaderOffset === 0xffffffff && at + 8 <= field.data.byteLength) {
          localHeaderOffset = safeNumber(fieldView.getBigUint64(at, true));
        }
      } else if (field.id === EXTRA_AES && field.data.byteLength >= 7) {
        const strength = fieldView.getUint8(4);
        if (strength !== 1 && strength !== 2 && strength !== 3) {
          throw new ArchiveError("unsupported", "Unbekannte AES-Schluessellaenge im Archiv.");
        }
        encryption = {
          kind: "aes",
          vendorVersion: fieldView.getUint16(0, true),
          strength,
          method: fieldView.getUint16(5, true),
        };
      }
    }
    if (flags & FLAG_ENCRYPTED && encryption.kind === "none") {
      if (method === METHOD_AES) {
        throw new ArchiveError("corrupt", "AES-verschluesselter Eintrag ohne AES-Angaben.");
      }
      if (flags & 0x40) {
        throw new ArchiveError("unsupported", "Starke PKWARE-Verschluesselung wird nicht unterstuetzt.");
      }
      encryption = { kind: "zipcrypto" };
    }

    const name = decodeName(nameBytes, (flags & FLAG_UTF8) !== 0);
    entries.push({
      name,
      method,
      flags,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      modTime,
      encryption,
      isDirectory: name.endsWith("/"),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function* extraFields(extra: Uint8Array): Generator<{ id: number; data: Uint8Array }> {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let pos = 0;
  while (pos + 4 <= extra.byteLength) {
    const id = view.getUint16(pos, true);
    const length = view.getUint16(pos + 2, true);
    if (pos + 4 + length > extra.byteLength) return;
    yield { id, data: extra.subarray(pos + 4, pos + 4 + length) };
    pos += 4 + length;
  }
}

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder("utf-8").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let name = "";
    for (const byte of bytes) name += String.fromCharCode(byte);
    return name;
  }
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ArchiveError("limit-exceeded", "ZIP64-Angabe ausserhalb des verarbeitbaren Bereichs.");
  }
  return Number(value);
}
