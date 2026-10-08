import { crc32Byte } from "./crc32.ts";

const HEADER_LENGTH = 12;

/**
 * Traditionelle PKWARE-Verschluesselung (ZipCrypto). Schwach, aber in alten
 * ETS-Exporten anzutreffen.
 *
 * @param check erwartetes letztes Kopfbyte: hoechstes CRC-Byte, bei
 *   Datendeskriptor (Bit 3) das hoehere Byte der Aenderungszeit
 * @returns entschluesselte Nutzdaten ohne Kopf, oder undefined bei falschem Passwort
 */
export function decryptZipCrypto(
  data: Uint8Array,
  password: Uint8Array,
  check: number,
): Uint8Array | undefined {
  if (data.byteLength < HEADER_LENGTH) return undefined;
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;

  const update = (byte: number): void => {
    k0 = crc32Byte(k0, byte);
    k1 = (k1 + (k0 & 0xff)) >>> 0;
    k1 = (Math.imul(k1, 134775813) + 1) >>> 0;
    k2 = crc32Byte(k2, k1 >>> 24);
  };
  const streamByte = (): number => {
    const temp = (k2 | 2) & 0xffff;
    return ((temp * (temp ^ 1)) >>> 8) & 0xff;
  };

  for (const byte of password) update(byte);

  let last = 0;
  for (let i = 0; i < HEADER_LENGTH; i++) {
    last = (data[i] ?? 0) ^ streamByte();
    update(last);
  }
  if (last !== check) return undefined;

  const out = new Uint8Array(data.byteLength - HEADER_LENGTH);
  for (let i = 0; i < out.byteLength; i++) {
    const plain = (data[i + HEADER_LENGTH] ?? 0) ^ streamByte();
    update(plain);
    out[i] = plain;
  }
  return out;
}
