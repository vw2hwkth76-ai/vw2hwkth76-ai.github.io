import type { NamingProfile } from "../recognize/profile.ts";
import type { Snapshot } from "./snapshot.ts";

/**
 * Analysebericht fuer die Rueckmeldung an die Entwicklung. Enthaelt GA-,
 * Raum- und Geraetebezeichnungen, aber keinen Projektnamen, keine GUID und
 * keine Schluessel. Kundenprojekte vorher anonymisieren.
 */

export const REPORT_FORMAT = "knx-td-analysebericht-1";

export interface ReportOptions {
  readonly toolVersion: string;
  readonly profile: NamingProfile | undefined;
  readonly reviewCount: number;
  /** Datum ohne Uhrzeit, z. B. "2026-10-08". */
  readonly date: string;
}

export function buildReport(snapshot: Snapshot, options: ReportOptions): Record<string, unknown> {
  const { project } = snapshot;
  return {
    format: REPORT_FORMAT,
    tool: options.toolVersion,
    date: options.date,
    project: {
      createdBy: `${project.createdBy} ${project.toolVersion}`.trim(),
      schemaVersion: project.schemaVersion,
      groupAddressStyle: project.groupAddressStyle,
      counts: project.counts,
    },
    coverage: snapshot.coverage,
    reviews: options.reviewCount,
    profile: options.profile ?? null,
    profileWarnings: snapshot.profileWarnings,
    diagnostics: snapshot.diagnostics.map(({ code, severity, count }) => ({ code, severity, count })),
    unknownCodes: snapshot.unknownCodes,
    groupAddresses: snapshot.gas.map((ga) => ({
      ga: ga.text,
      name: ga.name,
      ranges: ga.ranges,
      linked: ga.linked,
      central: ga.central || undefined,
      outOfUse: ga.outOfUse || undefined,
      room: compact(ga.decisions.room),
      trade: compact(ga.decisions.trade),
      direction: compact(ga.decisions.direction),
      dpt: compact(ga.decisions.dpt),
      thing: ga.thingLabel,
      role: ga.role,
      questions: ga.questionIds.length > 0 ? ga.questionIds.map((id) => id.slice(ga.id.length + 1)) : undefined,
    })),
    things: snapshot.things.map((thing) => ({
      label: thing.label,
      type: thing.type,
      functionType: thing.functionType,
      room: thing.room,
      source: thing.source,
      members: thing.members.map((member) => `${member.text}=${member.role ?? "?"}`),
    })),
    questions: snapshot.questions.map((question) => ({ kind: question.kind, dimension: question.dimension, ga: question.gaText, message: question.message })),
  };
}

function compact(decision: Snapshot["gas"][number]["decisions"]["room"]): unknown {
  if (!decision) return undefined;
  return {
    value: decision.display,
    source: decision.source,
    confidence: Math.round(decision.confidence * 100) / 100,
    conflict: decision.conflict ? `${decision.conflict.display} (${decision.conflict.source})` : undefined,
  };
}

/** Kurzfassung als Text zum Einfuegen in einen Chat. */
export function reportSummary(snapshot: Snapshot): string {
  const total = snapshot.project.counts.groupAddresses;
  const percent = (value: number): string => `${total === 0 ? 0 : Math.round((value / total) * 1000) / 10} %`;
  const kinds = new Map<string, number>();
  for (const question of snapshot.questions) kinds.set(`${question.kind}:${question.dimension}`, (kinds.get(`${question.kind}:${question.dimension}`) ?? 0) + 1);
  return [
    `${REPORT_FORMAT}, ${snapshot.project.createdBy} ${snapshot.project.toolVersion}, ${total} GAs, ${snapshot.project.counts.devices} Geräte (${snapshot.project.counts.devicesWithManufacturerData} mit Herstellerdaten), ${snapshot.project.counts.etsFunctions} ETS-Funktionen`,
    `Entschieden: Raum ${percent(snapshot.coverage.room.decided)}, Gewerk ${percent(snapshot.coverage.trade.decided)}, Richtung ${percent(snapshot.coverage.direction.decided)}, DPT ${percent(snapshot.coverage.dpt.decided)}`,
    `Things: ${snapshot.things.length}, Rückfragen: ${snapshot.questions.length} (${[...kinds].map(([key, count]) => `${key} ${count}`).join(", ")})`,
    `Unbekannte Kürzel: ${snapshot.unknownCodes.map((code) => `${code.token} (${code.count})`).join(", ") || "keine"}`,
  ].join("\n");
}
