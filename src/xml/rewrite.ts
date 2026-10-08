import { SaxesParser } from "saxes";
import { XmlError } from "./sax.ts";

export interface RewriteRules {
  /** Elementnamen (ohne Praefix), die samt Inhalt entfallen. */
  readonly dropElements: ReadonlySet<string>;
  /**
   * Liefert den neuen Attributwert oder undefined, um das Attribut zu entfernen.
   * `path` sind die Elementnamen von der Wurzel bis zum aktuellen Element.
   */
  attribute(element: string, name: string, value: string, attributes: Readonly<Record<string, string>>, path: readonly string[]): string | undefined;
}

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text: string): string =>
  escapeText(text).replace(/"/g, "&quot;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");

/**
 * Schreibt XML ueber einen SAX-Durchlauf neu. Kommentare und
 * Verarbeitungsanweisungen entfallen, ein DOCTYPE wird abgewiesen.
 */
export function rewriteXml(data: Uint8Array, rules: RewriteRules, fileName: string): string {
  const parser = new SaxesParser({ xmlns: false, position: false });
  const out: string[] = ['<?xml version="1.0" encoding="utf-8"?>\n'];
  const path: string[] = [];
  let skipDepth = 0;
  let failure: unknown;
  const local = (name: string): string => name.slice(name.indexOf(":") + 1);

  parser.on("doctype", () => {
    throw new XmlError(`${fileName}: DOCTYPE wird aus Sicherheitsgründen nicht verarbeitet.`);
  });
  parser.on("error", (error) => {
    failure ??= error;
  });
  parser.on("opentag", (tag) => {
    const name = local(tag.name);
    path.push(name);
    if (skipDepth > 0 || rules.dropElements.has(name)) {
      skipDepth++;
      return;
    }
    let element = `<${tag.name}`;
    for (const [attribute, value] of Object.entries(tag.attributes)) {
      const replaced = rules.attribute(name, attribute, value, tag.attributes, path);
      if (replaced !== undefined) element += ` ${attribute}="${escapeAttribute(replaced)}"`;
    }
    out.push(tag.isSelfClosing ? `${element} />` : `${element}>`);
  });
  parser.on("closetag", (tag) => {
    path.pop();
    if (skipDepth > 0) {
      skipDepth--;
      return;
    }
    if (!tag.isSelfClosing) out.push(`</${tag.name}>`);
  });
  parser.on("text", (text) => {
    if (skipDepth === 0) out.push(escapeText(text));
  });
  parser.on("cdata", (text) => {
    if (skipDepth === 0) out.push(escapeText(text));
  });

  const text = new TextDecoder("utf-8").decode(data);
  try {
    parser.write(text).close();
  } catch (error) {
    if (error instanceof XmlError) throw error;
    failure ??= error;
  }
  if (failure !== undefined) {
    const detail = failure instanceof Error ? failure.message : String(failure);
    throw new XmlError(`${fileName}: beschädigte XML-Datei (${detail}).`);
  }
  return out.join("");
}
