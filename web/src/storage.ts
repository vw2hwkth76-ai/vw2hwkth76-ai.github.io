import { type Exclusion, exclusionFromState, NO_EXCLUSION } from "../../src/graph/scope.ts";
import { DEFAULT_TD_OPTIONS, type TdOptions } from "../../src/td/render.ts";
import { isRecord } from "../../src/util/guards.ts";
import type { ReviewRecord } from "./protocol.ts";

/**
 * Antworten und Namensschema je Projekt im Browser dieses Rechners.
 * Bequemlichkeit, keine verlaessliche Ablage: Exportieren ist der Weg, um
 * einen Stand zu sichern oder weiterzugeben.
 */

export const STATE_FORMAT = "knx-td-projektstand-1";
const PREFIX = "knx-td-werkstatt:";
const DIMENSIONS = new Set(["room", "trade", "direction", "dpt"]);

export interface ProjectState {
  readonly reviews: ReviewRecord;
  readonly profile: unknown;
  readonly useEtsFunctions: boolean;
  /** Ausgabeoptionen der Thing Descriptions; aendern nichts an der Erkennung. */
  readonly td: TdOptions;
  /** Der Assistent nach dem Import (Umfang, Namensschema) ist durchlaufen, mit oder ohne Schema. */
  readonly schemaChecked: boolean;
  /** Welche GAs ausgewertet werden; fehlt, solange der Nutzer nichts gewaehlt hat (dann gelten alle). */
  readonly exclude?: Exclusion;
}

export const exclusionOf = (state: ProjectState): Exclusion => state.exclude ?? NO_EXCLUSION;

export const EMPTY_STATE: ProjectState = { reviews: {}, profile: undefined, useEtsFunctions: true, td: DEFAULT_TD_OPTIONS, schemaChecked: false };

function parseTdOptions(json: unknown): TdOptions {
  if (!isRecord(json)) return DEFAULT_TD_OPTIONS;
  const text = (value: unknown, fallback: string): string => (typeof value === "string" && value.length > 0 && value.length <= 200 ? value : fallback);
  return {
    version: json["version"] === "2.0" ? "2.0" : "1.1",
    commands: json["commands"] === "action" ? "action" : "property",
    strict: json["strict"] === true,
    gateway: text(json["gateway"], DEFAULT_TD_OPTIONS.gateway),
    platform: text(json["platform"], DEFAULT_TD_OPTIONS.platform),
  };
}

export function parseState(json: unknown): ProjectState | undefined {
  if (!isRecord(json) || !isRecord(json["reviews"])) return undefined;
  const reviews: Record<string, Record<string, string>> = {};
  for (const [gaId, entry] of Object.entries(json["reviews"])) {
    if (!isRecord(entry)) continue;
    const clean: Record<string, string> = {};
    for (const [dimension, value] of Object.entries(entry)) {
      if (DIMENSIONS.has(dimension) && typeof value === "string" && value.length <= 200) clean[dimension] = value;
    }
    if (Object.keys(clean).length > 0) reviews[gaId] = clean;
  }
  const profile = json["profile"] ?? undefined;
  // Aeltere Staende ohne das Feld: Wer schon ein Schema oder Antworten hat, ist ueber den Schritt hinaus.
  const schemaChecked = json["schemaChecked"] === true || profile !== undefined || Object.keys(reviews).length > 0;
  const exclude = exclusionFromState(json);
  return { reviews, profile, useEtsFunctions: json["useEtsFunctions"] !== false, td: parseTdOptions(json["td"]), schemaChecked, ...(exclude ? { exclude } : {}) };
}

export function loadState(key: string): ProjectState {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return (raw ? parseState(JSON.parse(raw)) : undefined) ?? EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export function saveState(key: string, state: ProjectState): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(state));
  } catch {
    // Privater Modus oder volle Ablage: der Stand gilt dann nur fuer diese Sitzung.
  }
}

export function clearState(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // nichts zu tun
  }
}

export function loadPreference(name: string): string | undefined {
  try {
    return localStorage.getItem(`${PREFIX}pref:${name}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function savePreference(name: string, value: string): void {
  try {
    localStorage.setItem(`${PREFIX}pref:${name}`, value);
  } catch {
    // nichts zu tun
  }
}

export function download(fileName: string, content: string, type = "application/json"): void {
  downloadBlob(fileName, new Blob([content], { type }));
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
