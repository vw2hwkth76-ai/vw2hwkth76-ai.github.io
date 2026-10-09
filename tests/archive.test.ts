import { readFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { utf8 } from "../src/archive/bytes.ts";
import { crc32 } from "../src/archive/crc32.ts";
import { ArchiveError } from "../src/archive/errors.ts";
import { deriveEts6ZipPassword, openEtsArchive } from "../src/archive/ets-archive.ts";
import { DEFAULT_LIMITS, ZipArchive, type ZipEntry } from "../src/archive/zip.ts";
import { loadKnxProject } from "../src/ets/load.ts";

const fixture = (name: string): Uint8Array => readFileSync(new URL(`../fixtures/archiv/${name}`, import.meta.url));
const TEXT = utf8("Wohnzimmer Licht Decke schalten 1/1/1\n".repeat(400));
const PASSWORD = [utf8("Geheim-123")];

function entry(archive: ZipArchive, name: string): ZipEntry {
  const found = archive.get(name);
  if (!found) throw new Error(`${name} fehlt`);
  return found;
}

async function readText(archive: ZipArchive, name: string, passwords: Uint8Array[] = []): Promise<Uint8Array> {
  const result = await archive.read(entry(archive, name), passwords);
  if (!result.ok) throw new Error(result.reason);
  return result.data;
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArchiveError) return error.code;
    throw error;
  }
  return "kein Fehler";
}

describe("ZipArchive", () => {
  it("liest gespeicherte, komprimierte, leere Eintraege und Ordner", async () => {
    const archive = ZipArchive.open(fixture("offen.zip"));
    expect(await readText(archive, "text.txt")).toEqual(TEXT);
    const binary = await readText(archive, "daten.bin");
    expect(binary.byteLength).toBe(70_000);
    expect(crc32(binary)).toBe(entry(archive, "daten.bin").crc32);
    expect((await readText(archive, "leer.txt")).byteLength).toBe(0);
    expect(entry(archive, "ordner/").isDirectory).toBe(true);
  });

  it.each(["aes256.zip", "aes128.zip"])("entschluesselt WinZip-AES aus pyzipper (%s)", async (name) => {
    const archive = ZipArchive.open(fixture(name));
    expect(entry(archive, "text.txt").encryption.kind).toBe("aes");
    expect(await readText(archive, "text.txt", PASSWORD)).toEqual(TEXT);
    expect((await readText(archive, "daten.bin", PASSWORD)).byteLength).toBe(70_000);
  });

  it("entschluesselt ZipCrypto aus Info-ZIP, auch mit Datendeskriptor", async () => {
    const archive = ZipArchive.open(fixture("zipcrypto.zip"));
    expect(entry(archive, "text.txt").encryption.kind).toBe("zipcrypto");
    expect(await readText(archive, "text.txt", PASSWORD)).toEqual(TEXT);
    const stream = ZipArchive.open(fixture("zipcrypto-strom.zip"));
    const streamed = entry(stream, "-");
    expect(streamed.flags & 0x8).toBe(0x8);
    expect((await readText(stream, "-", PASSWORD)).byteLength).toBe(TEXT.byteLength);
  });

  it("meldet fehlendes und falsches Passwort getrennt", async () => {
    for (const name of ["aes256.zip", "zipcrypto.zip"]) {
      const archive = ZipArchive.open(fixture(name));
      expect(await archive.read(entry(archive, "text.txt"))).toEqual({ ok: false, reason: "password-required" });
      expect(await archive.read(entry(archive, "text.txt"), [utf8("falsch")])).toEqual({
        ok: false,
        reason: "password-wrong",
      });
    }
  });

  it("liest ZIP64-Archive", async () => {
    const archive = ZipArchive.open(fixture("zip64.zip"));
    expect(await readText(archive, "text.txt")).toEqual(TEXT);
  });

  it("stoppt Zip-Bomben an der tatsaechlich entpackten Groesse", async () => {
    const archive = ZipArchive.open(fixture("bombe.zip"), { ...DEFAULT_LIMITS, maxEntryBytes: 1024 * 1024 });
    expect(await errorCode(archive.read(entry(archive, "nullen.bin")))).toBe("limit-exceeded");
  });

  it("begrenzt die Summe ueber alle Eintraege", async () => {
    const archive = ZipArchive.open(fixture("offen.zip"), { ...DEFAULT_LIMITS, maxTotalBytes: 80_000 });
    await readText(archive, "daten.bin");
    expect(await errorCode(archive.read(entry(archive, "text.txt")))).toBe("limit-exceeded");
  });

  it("weist Nicht-ZIP und beschaedigte Archive mit eindeutigem Fehler ab", async () => {
    expect(await errorCode(Promise.resolve().then(() => ZipArchive.open(utf8("<xml/>"))))).toBe("not-a-zip");
    expect(await errorCode(Promise.resolve().then(() => ZipArchive.open(fixture("abgeschnitten.zip"))))).toBe(
      "corrupt",
    );
  });

  it("begrenzt die Zahl der Eintraege", () => {
    expect(() => ZipArchive.open(fixture("offen.zip"), { ...DEFAULT_LIMITS, maxEntries: 2 })).toThrow(ArchiveError);
  });
});

describe("openEtsArchive", () => {
  it("leitet das ETS6-Passwort wie die unabhaengige Python-Referenz ab", async () => {
    expect(await deriveEts6ZipPassword("Grüße-2026")).toBe("oNj0ocMWOwD1AAJp9nNPqsPo+AbNGg6/D9Coh7r71GU=");
  });

  it.each([
    ["ets5-geschuetzt.knxproj", "Projekt-pw1", 20],
    ["ets6-geschuetzt.knxproj", "Grüße-2026", 23],
  ])("oeffnet geschuetzte Projekte (%s)", async (name, password, schema) => {
    const archive = await openEtsArchive(fixture(name), { password });
    expect(archive.schemaVersion).toBe(schema);
    expect(archive.passwordProtected).toBe(true);
    expect(archive.installationXmls).toEqual(["0.xml"]);
    const installation = new TextDecoder().decode(await archive.readProjectFile("0.xml"));
    expect(installation).toContain('Name="Decke schalten"');
  });

  it("verlangt das Passwort und erkennt ein falsches", async () => {
    expect(await errorCode(openEtsArchive(fixture("ets6-geschuetzt.knxproj")))).toBe("password-required");
    expect(await errorCode(openEtsArchive(fixture("ets6-geschuetzt.knxproj"), { password: "falsch" }))).toBe(
      "password-wrong",
    );
  });

  it("oeffnet ungeschuetzte Projekte mit Herstellerdaten", async () => {
    const archive = await openEtsArchive(fixture("../oeffentlich/demoprojekt.knxproj"));
    expect(archive.passwordProtected).toBe(false);
    expect(archive.schemaVersion).toBe(20);
    expect(archive.projectXml).toBe("P-045C/project.xml");
    expect(archive.installationXmls).toEqual(["P-045C/0.xml"]);
    expect(archive.manufacturerXmls).toContain("M-0083/Hardware.xml");
    expect(archive.manufacturerXmls).not.toContain("M-0083/Baggages/Symbol0_Balken.png");
  });

  it("liest entpackte, wieder gepackte Projekte, auch im Unterordner oder als .knxproj im ZIP", async () => {
    const original = fixture("../oeffentlich/demoprojekt.knxproj");
    const files = unzipSync(original);
    const inFolder = zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [`Export Demo/${name}`, data])));
    const wrapped = zipSync({ "Anhang/demoprojekt.knxproj": original, "Anhang/Lies mich.txt": utf8("Projekt im Anhang") });
    for (const variant of [zipSync(files), inFolder, wrapped]) {
      const archive = await openEtsArchive(variant);
      expect(archive.projectXml).toBe("P-045C/project.xml");
      expect(archive.installationXmls).toEqual(["P-045C/0.xml"]);
      expect(archive.manufacturerXmls).toContain("M-0083/Hardware.xml");
      expect((await loadKnxProject(variant)).project.groupAddresses).toHaveLength(19);
    }
  });

  it("lehnt ZIPs ohne ETS-Projekt verstaendlich ab", async () => {
    expect(await errorCode(openEtsArchive(zipSync({ "notizen/text.txt": utf8("kein Projekt") })))).toBe("structure");
  });
});
