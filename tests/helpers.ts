import { existsSync, readFileSync } from "node:fs";
import { utf8 } from "../src/archive/bytes.ts";
import { type EtsArchive, openEtsArchive } from "../src/archive/ets-archive.ts";

export const fixturePath = (relative: string): URL => new URL(`../fixtures/${relative}`, import.meta.url);

export function readFixture(relative: string): Uint8Array {
  return readFileSync(fixturePath(relative));
}

export function hasFixture(relative: string): boolean {
  return existsSync(fixturePath(relative));
}

export async function openFixture(relative: string, password?: string): Promise<EtsArchive> {
  return openEtsArchive(readFixture(relative), password === undefined ? {} : { password });
}

/** Archiv im Speicher fuer handgeschriebene XML-Faelle. */
export function memoryArchive(files: Record<string, string>, schemaVersion = 20): EtsArchive {
  const read = async (name: string): Promise<Uint8Array> => {
    const content = files[name];
    if (content === undefined) throw new Error(`${name} fehlt`);
    return utf8(content);
  };
  return {
    schemaVersion,
    passwordProtected: false,
    projectXml: "P-0001/project.xml",
    installationXmls: Object.keys(files).filter((name) => /\/\d+\.xml$/.test(name)),
    manufacturerXmls: Object.keys(files).filter((name) => name.startsWith("M-")),
    hasMasterXml: "knx_master.xml" in files,
    readProjectFile: read,
    readMasterXml: () => read("knx_master.xml"),
    readManufacturerFile: read,
  };
}
