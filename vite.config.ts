import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

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

export default defineConfig({
  root: "web",
  base: "./",
  define: { __WERKSTATT_VERSION__: JSON.stringify(version) },
  plugins: [contentSecurityPolicy()],
  build: { outDir: "../dist", emptyOutDir: true, target: "es2023", chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
  worker: { format: "es" },
  oxc: { jsx: { runtime: "automatic" } },
  css: { preprocessorOptions: { scss: { quietDeps: true } } },
  server: { fs: { allow: [".."] } },
});
