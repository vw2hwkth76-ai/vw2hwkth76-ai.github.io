const UMLAUTS: Readonly<Record<string, string>> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** Vergleichsform fuer Namen: klein, Umlaute ausgeschrieben, ohne Akzente und Satzzeichen. */
export function normalizeText(text: string): string {
  const composed = text.normalize("NFC").toLowerCase().replace(/[äöüß]/g, (char) => UMLAUTS[char] ?? char);
  const plain = composed.normalize("NFD").replace(/\p{Mn}/gu, "");
  return plain.replace(/[^a-z0-9]+/g, " ").trim();
}
