import { SaxesParser } from "saxes";

export type Attributes = Readonly<Record<string, string>>;

export interface XmlHandler {
  open(name: string, attributes: Attributes): void;
  close?(name: string): void;
}

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlError";
  }
}

const CHUNK = 1 << 20;

/**
 * Streaming-XML ohne DTD: Ein DOCTYPE wird abgewiesen, damit weder externe
 * Entitaeten noch Entitaetsbomben verarbeitet werden. Elementnamen kommen
 * ohne Namensraum-Praefix an.
 */
export function parseXml(data: Uint8Array, handler: XmlHandler, fileName: string): void {
  const parser = new SaxesParser({ xmlns: false, position: false });
  let failure: unknown;
  parser.on("doctype", () => {
    throw new XmlError(`${fileName}: DOCTYPE wird aus Sicherheitsgruenden nicht verarbeitet.`);
  });
  parser.on("error", (error) => {
    failure ??= error;
  });
  parser.on("opentag", (tag) => handler.open(localName(tag.name), tag.attributes));
  const close = handler.close;
  if (close) parser.on("closetag", (tag) => close.call(handler, localName(tag.name)));

  const decoder = new TextDecoder(detectEncoding(data));
  try {
    for (let i = 0; i < data.byteLength; i += CHUNK) {
      parser.write(decoder.decode(data.subarray(i, i + CHUNK), { stream: true }));
      if (failure !== undefined) break;
    }
    if (failure === undefined) parser.write(decoder.decode()).close();
  } catch (error) {
    if (error instanceof XmlError) throw error;
    failure ??= error;
  }
  if (failure !== undefined) {
    const detail = failure instanceof Error ? failure.message : String(failure);
    throw new XmlError(`${fileName}: beschaedigte XML-Datei (${detail}).`);
  }
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

function detectEncoding(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) return "utf-16le";
  if (data[0] === 0xfe && data[1] === 0xff) return "utf-16be";
  return "utf-8";
}
