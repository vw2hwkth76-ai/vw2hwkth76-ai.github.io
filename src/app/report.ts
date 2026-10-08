import type { NamingProfile } from "../recognize/profile.ts";
import { checkAccuracy, type ReviewCheck } from "./review-check.ts";
import { DIMENSIONS, type LinkView, type Snapshot } from "./snapshot.ts";

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
  /** Verknuepfungen je GA-Id in Kurzform, siehe `formatLink`. */
  readonly links?: ReadonlyMap<string, readonly string[]>;
  readonly reviewCheck?: ReviewCheck;
}

/** "1.1.3 Schaltaktor 4fach [Verteiler] KO 2 Kanal A: Schalten, KS, empfaengt" */
export function formatLink(link: LinkView): string {
  const role = [link.sends ? "sendet" : "", link.receives ? "empfängt" : "", link.answersRead ? "antwortet" : ""].filter((part) => part !== "").join("/");
  return [
    link.device,
    link.product,
    link.cabinet ? "[Verteiler]" : link.location ? `[${link.location}]` : "",
    `KO ${link.comObject}${link.channel ? ` (${link.channel})` : ""}`,
    link.flags,
    role,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
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
    reviewCheck: options.reviewCheck
      ? {
          byDimension: options.reviewCheck.byDimension,
          deviations: options.reviewCheck.entries
            .filter((entry) => entry.result !== "correct")
            .map((entry) => ({
              ga: entry.ga,
              name: entry.name,
              dimension: entry.dimension,
              confirmed: entry.confirmed.display,
              predicted: entry.predicted?.display,
              source: entry.predicted?.source,
              confidence: entry.predicted ? Math.round(entry.predicted.confidence * 100) / 100 : undefined,
              evidence: entry.predicted?.evidence,
              result: entry.result,
            })),
        }
      : undefined,
    profile: options.profile ?? null,
    profileWarnings: snapshot.profileWarnings,
    diagnostics: snapshot.diagnostics.map(({ code, severity, count }) => ({ code, severity, count })),
    unknownCodes: snapshot.unknownCodes,
    groupAddresses: snapshot.gas.map((ga) => ({
      ga: ga.text,
      name: ga.name,
      ranges: ga.ranges,
      linked: ga.linked,
      links: options.links?.get(ga.id),
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
    evidence: decision.evidence,
    conflict: decision.conflict ? `${decision.conflict.display} (${decision.conflict.source})` : undefined,
  };
}

/** Kurzfassung als Text zum Einfuegen in einen Chat. */
export function reportSummary(snapshot: Snapshot, reviewCheck?: ReviewCheck): string {
  const total = snapshot.project.counts.groupAddresses;
  const percent = (value: number): string => `${total === 0 ? 0 : Math.round((value / total) * 1000) / 10} %`;
  const kinds = new Map<string, number>();
  for (const question of snapshot.questions) kinds.set(`${question.kind}:${question.dimension}`, (kinds.get(`${question.kind}:${question.dimension}`) ?? 0) + 1);
  return [
    `${REPORT_FORMAT}, ${snapshot.project.createdBy} ${snapshot.project.toolVersion}, ${total} GAs, ${snapshot.project.counts.devices} Geräte (${snapshot.project.counts.devicesWithManufacturerData} mit Herstellerdaten), ${snapshot.project.counts.etsFunctions} ETS-Funktionen`,
    `Entschieden: Raum ${percent(snapshot.coverage.room.decided)}, Gewerk ${percent(snapshot.coverage.trade.decided)}, Richtung ${percent(snapshot.coverage.direction.decided)}, DPT ${percent(snapshot.coverage.dpt.decided)}`,
    `Things: ${snapshot.things.length}, Rückfragen: ${snapshot.questions.length} (${[...kinds].map(([key, count]) => `${key} ${count}`).join(", ")})`,
    `Unbekannte Kürzel: ${snapshot.unknownCodes.map((code) => `${code.token} (${code.count})`).join(", ") || "keine"}`,
    ...(reviewCheck ? [checkLine(reviewCheck)] : []),
  ].join("\n");
}

function checkLine(check: ReviewCheck): string {
  const parts = DIMENSIONS.flatMap((dimension) => {
    const tally = check.byDimension[dimension];
    const accuracy = checkAccuracy(tally);
    if (accuracy === undefined) return [];
    return [`${dimension} ${tally.correct}/${tally.rated} (${Math.round(accuracy * 1000) / 10} %, falsch ${tally.wrong}, fehlt ${tally.missing})`];
  });
  return `Gegen Bestätigungen: ${parts.join(", ") || "noch nichts bestätigt"}`;
}

const GOLD_ROLE: Readonly<Record<string, string>> = { command: "action", status: "property", alarm: "event" };

/**
 * Gold-Standard im Format von ets2td aus den bestaetigten Werten. Nur
 * Bestaetigtes zaehlt; alles andere bleibt leer und damit unbewertet.
 * Enthaelt GA-Namen: nur aus anonymisierten Projekten weitergeben.
 */
export function buildGold(snapshot: Snapshot, date: string): Record<string, unknown> {
  const points: Record<string, Record<string, string>> = {};
  for (const ga of snapshot.gas) {
    const room = ga.decisions.room?.source === "review" ? ga.decisions.room.display : undefined;
    const direction = ga.decisions.direction?.source === "review" ? GOLD_ROLE[ga.decisions.direction.value] : undefined;
    const dpt = ga.decisions.dpt?.source === "review" ? ga.decisions.dpt.value : undefined;
    if (room === undefined && direction === undefined && dpt === undefined) continue;
    points[String(ga.address)] = {
      text: ga.text,
      name: ga.name,
      ...(room === undefined ? {} : { raum: room }),
      ...(direction === undefined ? {} : { rolle: direction }),
      ...(dpt === undefined ? {} : { dpt }),
    };
  }
  return {
    projekt: snapshot.project.name,
    kommentar: `Aus bestätigten Antworten der Werkstatt, ${date}. Nicht bestätigte Werte fehlen und sind unbewertet.`,
    datenpunkte: points,
  };
}
