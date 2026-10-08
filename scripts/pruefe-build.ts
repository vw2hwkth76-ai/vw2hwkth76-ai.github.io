import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

/**
 * Prueft den Build auf Abrufe fremder Server: keine CDN-Schriften, keine
 * externen Skripte oder Stile. Die App muss ohne Netz zu Dritten laufen
 * (DSGVO; Urteil LG Muenchen I zu Google Fonts, 3 O 17493/20).
 */

const root = process.argv[2] ?? "dist";
const RULES: readonly { readonly pattern: RegExp; readonly files: readonly string[]; readonly reason: string }[] = [
  { pattern: /\b(?:src|href|action)\s*=\s*["']?(?:https?:)?\/\//gi, files: [".html"], reason: "externe Ressource im HTML" },
  { pattern: /url\(\s*["']?(?:https?:)?\/\//gi, files: [".css", ".js"], reason: "externe URL in CSS" },
  { pattern: /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//gi, files: [".css"], reason: "externer CSS-Import" },
  {
    pattern: /(?:fonts\.googleapis\.com|fonts\.gstatic\.com|s81c\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|www-api\.ibm\.com)/gi,
    files: [".html", ".css", ".js"],
    reason: "bekannter CDN- oder Telemetrie-Host",
  },
  { pattern: /\b(?:fetch|importScripts|sendBeacon)\(\s*["'`]https?:\/\//gi, files: [".js"], reason: "Abruf einer absoluten URL" },
];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const findings: string[] = [];
let checked = 0;
for (const path of files(root)) {
  const extension = extname(path);
  if (![".html", ".css", ".js"].includes(extension)) continue;
  checked++;
  const text = readFileSync(path, "utf8");
  for (const rule of RULES) {
    if (!rule.files.includes(extension)) continue;
    for (const match of text.matchAll(rule.pattern)) {
      const at = match.index ?? 0;
      findings.push(`${relative(root, path)}: ${rule.reason}: ${text.slice(Math.max(0, at - 30), at + 60).replace(/\s+/g, " ")}`);
    }
  }
}

if (checked === 0) {
  console.error(`Kein Build in ${root}. Zuerst npm run build.`);
  process.exit(1);
}
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log(`${checked} Dateien geprüft, keine Abrufe fremder Server.`);
