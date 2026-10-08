/** Kopie mit eigenem ArrayBuffer, wie ihn die Web-Crypto-Schnittstelle verlangt. */
export function ownBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

export function concat(chunks: readonly Uint8Array[], total?: number): Uint8Array<ArrayBuffer> {
  const size = total ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

export function utf16le(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 * i] = code & 0xff;
    out[2 * i + 1] = code >>> 8;
  }
  return out;
}

/** Latin-1 fuer alte Archive, deren Passwort nicht als UTF-8 abgelegt wurde. */
export function latin1(text: string): Uint8Array<ArrayBuffer> | undefined {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return undefined;
    out[i] = code;
  }
  return out;
}

export function base64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
