import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { BINDING_CONTEXT, BINDING_NAMESPACE, BINDING_TERMS } from "./src/td/vocabulary.ts";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * Nur eigene Quellen: Projektdaten koennen den Browser nicht Richtung
 * Dritter verlassen, auch nicht ueber einen Fehler im Code. Nur im Build,
 * der Entwicklungsserver braucht seine eigenen Verbindungen.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "werkstatt-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
  };
}

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Namensraum des KNX-Bindings aufloesbar machen: Kontext als JSON-LD und eine Begriffsseite. */
function bindingNamespace(): Plugin {
  return {
    name: "werkstatt-namespace",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "ns/knx-binding.jsonld", source: `${JSON.stringify(BINDING_CONTEXT, null, 2)}\n` });
      const rows = BINDING_TERMS.map((term) => `<tr id="${term.name}"><td><code>kb:${term.name}</code></td><td><code>${escape(term.type)}</code></td><td>${escape(term.de)}</td></tr>`).join("\n");
      this.emitFile({
        type: "asset",
        fileName: "ns/knx-binding.html",
        source: `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>KNX-Binding-Vokabular</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#161616}code{font-family:ui-monospace,monospace}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #e0e0e0;padding:.5rem .75rem .5rem 0;vertical-align:top}@media (prefers-color-scheme:dark){body{background:#161616;color:#f4f4f4}td{border-color:#393939}}</style>
</head><body>
<h1>KNX-Binding-Vokabular</h1>
<p>Namensraum <code>${escape(BINDING_NAMESPACE)}</code>, Präfix <code>kb:</code>. Begriffe für KNX-Forms und die Herkunft erkannter Werte in Thing Descriptions der KNX TD Werkstatt ${escape(version)}. Für KNX gibt es bei W3C kein Binding-Vokabular; dieses ist herstellerneutral und vorläufig.</p>
<p>JSON-LD-Kontext: <code>knx-binding.jsonld</code> im selben Verzeichnis.</p>
<table><tbody>
${rows}
</tbody></table>
</body></html>
`,
      });
    },
  };
}

export default defineConfig({
  root: "web",
  base: "./",
  define: { __WERKSTATT_VERSION__: JSON.stringify(version) },
  plugins: [contentSecurityPolicy(), bindingNamespace()],
  build: { outDir: "../dist", emptyOutDir: true, target: "es2023", chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
  worker: { format: "es" },
  oxc: { jsx: { runtime: "automatic" } },
  css: { preprocessorOptions: { scss: { quietDeps: true } } },
  server: { fs: { allow: [".."] } },
});
