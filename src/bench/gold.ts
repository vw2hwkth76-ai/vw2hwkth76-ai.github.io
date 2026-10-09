import { normalizeDpt } from "../ets/dpt-id.ts";
import type { Direction } from "../graph/direction.ts";
import { isRecord } from "../util/guards.ts";

export const DIMENSIONS = ["room", "function", "direction", "dpt"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface GoldEntry {
  readonly address: number;
  readonly text: string;
  readonly name: string;
  readonly room: string | undefined;
  readonly function: string | undefined;
  readonly direction: Direction | undefined;
  readonly dpt: string | undefined;
  /** Soll-Buendelung: GAs mit gleichem Wert gehoeren in ein Thing; ohne Wert steht die GA allein. */
  readonly thing: string | undefined;
}

export interface GoldStandard {
  readonly project: string;
  readonly entries: ReadonlyMap<number, GoldEntry>;
}

const GOLD_DIRECTION: Readonly<Record<string, Direction>> = { action: "command", property: "status", event: "alarm" };

/** Liest das Gold-Format von ets2td ({ projekt, datenpunkte: { "<GA-Integer>": { raum, funktion, rolle, dpt } } }). */
export function parseGold(json: unknown): GoldStandard {
  if (!isRecord(json) || typeof json["projekt"] !== "string" || !isRecord(json["datenpunkte"])) {
    throw new Error("Gold-Standard: erwartet { projekt, datenpunkte }.");
  }
  const entries = new Map<number, GoldEntry>();
  for (const [key, value] of Object.entries(json["datenpunkte"])) {
    const address = Number(key);
    if (!Number.isInteger(address) || !isRecord(value)) throw new Error(`Gold-Standard: ungültiger Eintrag ${key}.`);
    const role = text(value["rolle"]);
    const direction = role === undefined ? undefined : GOLD_DIRECTION[role];
    if (role !== undefined && direction === undefined) throw new Error(`Gold-Standard: unbekannte Rolle "${role}" bei ${key}.`);
    const dpt = text(value["dpt"]);
    entries.set(address, {
      address,
      text: text(value["text"]) ?? key,
      name: text(value["name"]) ?? "",
      room: text(value["raum"]),
      function: text(value["funktion"]),
      direction,
      dpt: dpt === undefined ? undefined : (normalizeDpt(dpt) ?? dpt),
      thing: text(value["thing"]),
    });
  }
  return { project: json["projekt"], entries };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

