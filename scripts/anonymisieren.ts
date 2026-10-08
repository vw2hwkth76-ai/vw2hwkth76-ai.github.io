import { readFileSync, writeFileSync } from "node:fs";
import { anonymizeKnxproj } from "../src/tools/anonymize.ts";

/**
 * Lokal ausfuehren, bevor ein Kundenprojekt den Rechner verlaesst:
 *   KNX_PROJEKTPASSWORT=... npm run anonymisieren -- kunde.knxproj kunde-anonym.knxproj [--ersetzen tabelle.json]
 * Das Passwort per Umgebungsvariable, damit es nicht in der Shell-Historie landet.
 */
const args = process.argv.slice(2);
const [input, output] = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--ersetzen");
if (input === undefined || output === undefined) {
  console.error("Aufruf: npm run anonymisieren -- <eingabe.knxproj> <ausgabe.knxproj> [--ersetzen tabelle.json]");
  process.exit(2);
}
const tableIndex = args.indexOf("--ersetzen");
const tablePath = tableIndex >= 0 ? args[tableIndex + 1] : undefined;
const table: unknown = tablePath === undefined ? {} : JSON.parse(readFileSync(tablePath, "utf-8"));
if (typeof table !== "object" || table === null || Array.isArray(table) || !Object.values(table).every((value) => typeof value === "string")) {
  console.error('Ersetzungstabelle: erwartet ein JSON-Objekt { "Begriff": "Ersatz" }.');
  process.exit(2);
}

const password = process.env["KNX_PROJEKTPASSWORT"];
const result = await anonymizeKnxproj(readFileSync(input), {
  replacements: table as Record<string, string>,
  ...(password === undefined ? {} : { password }),
});
writeFileSync(output, result.output);

const { report } = result;
console.log(`Geschrieben: ${output} (${(result.output.byteLength / 1024).toFixed(0)} KB, ${report.keptFiles.length} Dateien, ohne Passwort)`);
console.log(`Entfernt: ${report.removedSecrets} Schluessel/Kennungen/Netzangaben, ${report.removedElements} Elemente (Verlauf, Zertifikate, Secure-Daten)`);
console.log(`Ersetzt: ${report.replacedValues} Werte aus der Ersetzungstabelle`);
if (report.namesToReview.length > 0) {
  console.log("\nBitte auf Personennamen pruefen und bei Bedarf in die Ersetzungstabelle aufnehmen:");
  console.log(report.namesToReview.map((entry) => `${entry.word} (${entry.count})`).join(", "));
}
