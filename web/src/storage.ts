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
}

export const EMPTY_STATE: ProjectState = { reviews: {}, profile: undefined, useEtsFunctions: true };

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
  return { reviews, profile: json["profile"] ?? undefined, useEtsFunctions: json["useEtsFunctions"] !== false };
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
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
