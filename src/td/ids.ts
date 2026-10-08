/**
 * Stabile Kennungen als UUID Version 5 (RFC 9562): gleiche Eingabe, gleiche
 * ID. Grundlage sind Projekt-GUID und ETS-IDs von Funktion, Aktorkanal oder
 * GA, nicht die Gruppenadresse; Umadressieren bricht deshalb keine Bindung.
 */

/** Eigener Namensraum der Werkstatt, fest vergeben. */
const NAMESPACE = "6f0f3b52-8d1e-4c55-9a8e-2f7b1c4d9e03";

function hexToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index++) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function format(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function uuidV5(name: string, namespace = NAMESPACE): Promise<string> {
  const ns = hexToBytes(namespace);
  const text = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + text.length);
  input.set(ns, 0);
  input.set(text, ns.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", input)).slice(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  return format(hash);
}
