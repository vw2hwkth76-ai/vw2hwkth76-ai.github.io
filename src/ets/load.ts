import { type EtsArchiveOptions, openEtsArchive } from "../archive/ets-archive.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { readManufacturerData, type ManufacturerData } from "./manufacturer.ts";
import { type MasterData, readMasterData } from "./master-data.ts";
import type { EtsProject } from "./model.ts";
import { readEtsProject } from "./project-reader.ts";
import { type ResolvedDevice, resolveDevices } from "./resolve.ts";

export interface LoadedProject {
  readonly project: EtsProject;
  readonly master: MasterData;
  readonly manufacturer: ManufacturerData;
  readonly devices: readonly ResolvedDevice[];
  readonly passwordProtected: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** Liest ein knxproj vollstaendig ein. Das Passwort wird nur zum Entschluesseln benutzt und nicht gespeichert. */
export async function loadKnxProject(data: Uint8Array, options: EtsArchiveOptions = {}): Promise<LoadedProject> {
  const archive = await openEtsArchive(data, options);
  const project = await readEtsProject(archive);
  const master = await readMasterData(archive);
  const manufacturer = await readManufacturerData(
    archive,
    project.devices.map((device) => device.hardware2ProgramRefId),
  );
  const resolved = resolveDevices(project, manufacturer);
  return {
    project,
    master,
    manufacturer,
    devices: resolved.devices,
    passwordProtected: archive.passwordProtected,
    diagnostics: [...project.diagnostics, ...manufacturer.diagnostics, ...resolved.diagnostics],
  };
}
