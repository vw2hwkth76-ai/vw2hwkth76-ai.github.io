import { base64, latin1, ownBuffer, utf8, utf16le } from "./bytes.ts";
import { ArchiveError } from "./errors.ts";
import { DEFAULT_LIMITS, ZipArchive, type ZipEntry, type ZipLimits } from "./zip.ts";

const PROJECT_XML = /(?:^|\/)project\.xml$/i;
const INSTALLATION_XML = /(?:^|\/)\d+\.xml$/;
const INNER_ARCHIVE = /^P-[0-9A-Fa-f]+\.zip$/;
const MANUFACTURER_XML = /^M-[0-9A-Fa-f]+\/[^/]+\.xml$/i;
const MASTER_XML = "knx_master.xml";
const SCHEMA_NAMESPACE = /xmlns="http:\/\/knx\.org\/xml\/project\/(\d+)"/;

/** Ab diesem Schema (ETS6) leitet die ETS das ZIP-Passwort aus dem Projektpasswort ab. */
export const ETS6_SCHEMA = 21;
const ETS6_SALT = "21.project.ets.knx.org";
const ETS6_ITERATIONS = 65_536;

export interface EtsArchiveOptions {
  readonly password?: string;
  readonly limits?: ZipLimits;
}

/** Ein geoeffnetes ETS-Projektarchiv, gleich ob als Ordner oder als inneres, geschuetztes Archiv. */
export interface EtsArchive {
  /** Schemaversion aus knx_master.xml, z. B. 20 fuer ETS5.7, 23 fuer ETS6.3. */
  readonly schemaVersion: number | undefined;
  readonly passwordProtected: boolean;
  readonly projectXml: string;
  readonly installationXmls: readonly string[];
  readonly manufacturerXmls: readonly string[];
  readonly hasMasterXml: boolean;
  readProjectFile(name: string): Promise<Uint8Array>;
  readMasterXml(): Promise<Uint8Array>;
  readManufacturerFile(name: string): Promise<Uint8Array>;
}

/** ETS6: PBKDF2-HMAC-SHA256 ueber das UTF-16LE-Passwort, Base64 als ZIP-Passwort. */
export async function deriveEts6ZipPassword(password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf16le(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: utf8(ETS6_SALT), iterations: ETS6_ITERATIONS },
    key,
    256,
  );
  return base64(new Uint8Array(bits));
}

export async function openEtsArchive(
  data: Uint8Array,
  options: EtsArchiveOptions = {},
): Promise<EtsArchive> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const outer = ZipArchive.open(data, limits);
  const names = outer.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name);

  const masterEntry = outer.get(MASTER_XML);
  const schemaVersion = masterEntry ? await readSchemaVersion(outer, masterEntry) : undefined;
  const manufacturerXmls = names.filter((name) => MANUFACTURER_XML.test(name)).sort();

  const readOuter = async (name: string): Promise<Uint8Array> => {
    const entry = outer.get(name);
    if (!entry) throw new ArchiveError("structure", `${name} fehlt im Archiv.`);
    const result = await outer.read(entry);
    if (!result.ok) {
      throw new ArchiveError("unsupported", `${name} ist verschlüsselt, erwartet war ein offener Eintrag.`);
    }
    return result.data;
  };

  const base = {
    schemaVersion,
    hasMasterXml: masterEntry !== undefined,
    manufacturerXmls,
    readMasterXml: () => readOuter(MASTER_XML),
    readManufacturerFile: readOuter,
  };

  const directProject = names.filter((name) => PROJECT_XML.test(name) && !name.startsWith("M-")).sort();
  if (directProject.length > 0) {
    const projectXml = directProject[0] ?? "";
    const folder = projectXml.slice(0, projectXml.lastIndexOf("/") + 1);
    const project = await withPassword(outer, projectXml, schemaVersion, options.password);
    return {
      ...base,
      passwordProtected: project.protected,
      projectXml,
      installationXmls: names.filter((name) => name.startsWith(folder) && INSTALLATION_XML.test(name.slice(folder.length))).sort(),
      readProjectFile: (name) => project.read(name),
    };
  }

  const inner = names.filter((name) => INNER_ARCHIVE.test(name)).sort();
  const innerName = inner[0];
  if (innerName === undefined) {
    throw new ArchiveError(
      "structure",
      "Unerwartete Archivstruktur: weder <Projekt>/project.xml noch <Projekt>.zip gefunden. " +
        "Bitte das Projekt in der ETS als .knxproj exportieren.",
    );
  }
  const innerArchive = ZipArchive.open(await readOuter(innerName), limits);
  const innerNames = innerArchive.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  const projectXml = innerNames.find((name) => PROJECT_XML.test(name));
  if (projectXml === undefined) {
    throw new ArchiveError("structure", `${innerName} enthält keine project.xml.`);
  }
  const project = await withPassword(innerArchive, projectXml, schemaVersion, options.password);
  return {
    ...base,
    passwordProtected: project.protected,
    projectXml,
    installationXmls: innerNames.filter((name) => INSTALLATION_XML.test(name)).sort(),
    readProjectFile: (name) => project.read(name),
  };
}

interface PasswordedReader {
  readonly protected: boolean;
  read(name: string): Promise<Uint8Array>;
}

/** Ermittelt am project.xml das passende Passwort und benutzt es fuer alle Projektdateien. */
async function withPassword(
  archive: ZipArchive,
  probeName: string,
  schemaVersion: number | undefined,
  password: string | undefined,
): Promise<PasswordedReader> {
  const probe = archive.get(probeName);
  if (!probe) throw new ArchiveError("structure", `${probeName} fehlt im Archiv.`);

  const reader = (passwords: readonly Uint8Array[]) => async (name: string) => {
    const entry: ZipEntry | undefined = archive.get(name);
    if (!entry) throw new ArchiveError("structure", `${name} fehlt im Archiv.`);
    const result = await archive.read(entry, passwords);
    if (!result.ok) {
      throw new ArchiveError("password-wrong", `${name} lässt sich mit dem Projektpasswort nicht öffnen.`);
    }
    return result.data;
  };

  if (probe.encryption.kind === "none") return { protected: false, read: reader([]) };
  if (password === undefined || password === "") {
    throw new ArchiveError(
      "password-required",
      "Das Projekt ist mit einem Projektpasswort geschützt. Bitte das Passwort eingeben.",
    );
  }

  for (const candidate of await passwordCandidates(password, schemaVersion)) {
    const result = await archive.read(probe, [candidate]);
    if (result.ok) return { protected: true, read: reader([candidate]) };
  }
  throw new ArchiveError("password-wrong", "Das Projektpasswort ist nicht korrekt.");
}

async function passwordCandidates(
  password: string,
  schemaVersion: number | undefined,
): Promise<Uint8Array[]> {
  const derived = utf8(await deriveEts6ZipPassword(password));
  const raw = [utf8(password), latin1(password)].filter((bytes) => bytes !== undefined);
  // Unbekanntes Schema: beide Varianten probieren, die wahrscheinlichere zuerst.
  const ets6 = schemaVersion === undefined || schemaVersion >= ETS6_SCHEMA;
  const ordered = ets6 ? [derived, ...raw] : [...raw, derived];
  const unique = new Map(ordered.map((bytes) => [base64(bytes), ownBuffer(bytes)]));
  return [...unique.values()];
}

async function readSchemaVersion(archive: ZipArchive, entry: ZipEntry): Promise<number | undefined> {
  const result = await archive.read(entry);
  if (!result.ok) return undefined;
  const head = new TextDecoder("utf-8").decode(result.data.subarray(0, 4096));
  const match = SCHEMA_NAMESPACE.exec(head);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
