/** JSON-Werte fuer TD-Ausgaben; nur Daten, keine Funktionen oder undefined. */
export type Json = string | number | boolean | null | readonly Json[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: Json;
}

/** Objekt ohne undefined-Eintraege; so bleiben Ausgaben schlank und unter exactOptionalPropertyTypes typsicher. */
export function compact(entries: Readonly<Record<string, Json | undefined>>): JsonObject {
  const result: Record<string, Json> = {};
  for (const [key, value] of Object.entries(entries)) if (value !== undefined) result[key] = value;
  return result;
}

/** Schluessel fuer Affordances: "Scene number" ergibt "sceneNumber", "HVACMode" ergibt "hvacMode". */
export function camelKey(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/ß/g, "ss")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .flatMap((word) => word.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? [word]);
  const key = words.map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join("");
  return /^[a-z]/.test(key) ? key : `x${key}`;
}
