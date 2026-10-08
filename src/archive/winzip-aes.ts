import { ecb } from "@noble/ciphers/aes.js";
import { ownBuffer, equalBytes } from "./bytes.ts";

export type AesStrength = 1 | 2 | 3;

const SALT_LENGTH: Record<AesStrength, number> = { 1: 8, 2: 12, 3: 16 };
const VERIFIER_LENGTH = 2;
const MAC_LENGTH = 10;
const ITERATIONS = 1000;
const BLOCK = 16;
const KEYSTREAM_BLOCKS = 4096;

export type AesResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; reason: "password" | "integrity" };

/**
 * WinZip-AES (AE-1 und AE-2): PBKDF2-HMAC-SHA1 mit 1000 Runden, AES im
 * Zaehlermodus mit little-endian Zaehler ab 1, HMAC-SHA1 ueber den Chiffretext.
 */
export async function decryptWinZipAes(
  data: Uint8Array,
  strength: AesStrength,
  password: Uint8Array,
): Promise<AesResult> {
  const saltLength = SALT_LENGTH[strength];
  const keyLength = saltLength * 2;
  if (data.byteLength < saltLength + VERIFIER_LENGTH + MAC_LENGTH) {
    return { ok: false, reason: "integrity" };
  }
  const salt = data.subarray(0, saltLength);
  const verifier = data.subarray(saltLength, saltLength + VERIFIER_LENGTH);
  const cipher = data.subarray(saltLength + VERIFIER_LENGTH, data.byteLength - MAC_LENGTH);
  const mac = data.subarray(data.byteLength - MAC_LENGTH);

  const baseKey = await crypto.subtle.importKey("raw", ownBuffer(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-1", salt: ownBuffer(salt), iterations: ITERATIONS },
      baseKey,
      (2 * keyLength + VERIFIER_LENGTH) * 8,
    ),
  );
  const aesKey = derived.subarray(0, keyLength);
  const macKey = derived.subarray(keyLength, 2 * keyLength);
  if (!equalBytes(derived.subarray(2 * keyLength), verifier)) {
    return { ok: false, reason: "password" };
  }

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    ownBuffer(macKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, ownBuffer(cipher)));
  if (!equalBytes(signature.subarray(0, MAC_LENGTH), mac)) {
    // Pruefwert passte zufaellig (1 zu 65536) oder die Daten sind beschaedigt.
    return { ok: false, reason: "integrity" };
  }

  return { ok: true, data: aesCtrLittleEndian(aesKey, cipher) };
}

function aesCtrLittleEndian(key: Uint8Array, cipher: Uint8Array): Uint8Array {
  const out = new Uint8Array(cipher.byteLength);
  const counters = new Uint8Array(KEYSTREAM_BLOCKS * BLOCK);
  let counter = 1;
  for (let offset = 0; offset < cipher.byteLength; offset += KEYSTREAM_BLOCKS * BLOCK) {
    const length = Math.min(KEYSTREAM_BLOCKS * BLOCK, cipher.byteLength - offset);
    const blocks = Math.ceil(length / BLOCK);
    counters.fill(0);
    for (let b = 0; b < blocks; b++) {
      let value = counter++;
      for (let i = 0; i < 8 && value > 0; i++) {
        counters[b * BLOCK + i] = value % 256;
        value = Math.floor(value / 256);
      }
    }
    // Die Bibliothek erlaubt je Instanz nur einen Aufruf.
    const stream = ecb(key, { disablePadding: true }).encrypt(counters.subarray(0, blocks * BLOCK));
    for (let i = 0; i < length; i++) {
      out[offset + i] = (cipher[offset + i] ?? 0) ^ (stream[i] ?? 0);
    }
  }
  return out;
}
