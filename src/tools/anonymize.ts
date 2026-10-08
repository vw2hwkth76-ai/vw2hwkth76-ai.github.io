import { zipSync } from "fflate";
import { utf8 } from "../archive/bytes.ts";
import { type EtsArchiveOptions, openEtsArchive } from "../archive/ets-archive.ts";
import { type RewriteRules, rewriteXml } from "../xml/rewrite.ts";

/**
 * Anonymisiert ein knxproj fuer die Weitergabe als Testprojekt. Laeuft
 * lokal; gedacht, bevor ein Kundenprojekt den eigenen Rechner verlaesst.
 *
 * Entfernt: KNX-Secure-Schluessel und Passwoerter, Seriennummern, geladene
 * Geraeteabbilder, IP-Konfiguration, Kommentare, Projektverlauf,
 * Benutzerdateien, Signaturen und Zertifikate.
 * Ersetzt: Projektname, -nummer und -GUID, Namen von Gebaeuden und
 * Liegenschaften, dazu frei waehlbare Begriffe per Ersetzungstabelle.
 * Behaelt: GA-, Raum-, Funktions- und Geraetenamen, Struktur,
 * Verknuepfungen, Parameter und die Herstellerdaten.
 */

export interface AnonymizeOptions extends EtsArchiveOptions {
  /** Begriff auf Ersatz, z. B. { "Mueller": "Person 1" }. Gilt fuer alle Attributwerte. */
  readonly replacements?: Readonly<Record<string, string>>;
}

export interface AnonymizeReport {
  readonly removedSecrets: number;
  readonly removedElements: number;
  readonly replacedValues: number;
  /** Uebernommene Dateien; Signaturen, Zertifikate und Herstellerbilder fehlen bewusst. */
  readonly keptFiles: readonly string[];
  /** Seltene, grossgeschriebene Woerter aus Namen; zur Sichtpruefung auf Personennamen. */
  readonly namesToReview: readonly { readonly word: string; readonly count: number }[];
}

export interface AnonymizeResult {
  readonly output: Uint8Array;
  readonly report: AnonymizeReport;
}

const DROP_ELEMENTS = new Set([
  "ProjectTraces",
  "ProjectTrace",
  "UserFiles",
  "UserFile",
  "HistoryEntries",
  "HistoryEntry",
  "Security",
  "DeviceCertificates",
  "DeviceCertificate",
  "Certificates",
  "Certificate",
]);
const SECRET_ATTRIBUTE = /(?:Key|Password|AuthenticationCode|SequenceNumber|Fdsk|Secret)$/i;
const IDENTITY_ATTRIBUTE = /^(?:SerialNumber|ContractNumber|LoadedImage|CheckSums|DeliveryDate)$/;
const NETWORK_ATTRIBUTE = /(?:IPAddress|SubnetMask|DefaultGateway|MacAddress|MulticastAddress|Hostname)$/i;
const BUILDING_TYPES: Readonly<Record<string, string>> = {
  Building: "Gebäude",
  BuildingPart: "Gebäudeteil",
  Site: "Liegenschaft",
};
const NAME_ELEMENTS = new Set(["GroupAddress", "GroupRange", "Space", "BuildingPart", "Function", "DeviceInstance", "Trade", "ComObjectInstanceRef"]);
const REVIEW_STOPWORDS = new Set(
  [
    "Licht", "Leuchte", "Decke", "Wand", "Spot", "Spots", "Dimmen", "Dimmwert", "Schalten", "Status", "Wert", "Rolladen", "Rollladen", "Jalousie",
    "Markise", "Lamelle", "Position", "Fahren", "Stop", "Stopp", "Heizen", "Heizung", "Kühlen", "Temperatur", "Ist", "Soll", "Sollwert", "Istwert",
    "Betriebsart", "Komfort", "Nacht", "Frost", "Standby", "Fenster", "Tür", "Kontakt", "Präsenz", "Bewegung", "Melder", "Alarm", "Wind", "Regen",
    "Zentral", "Zentrale", "Szene", "Szenen", "Sperre", "Taster", "Aktor", "Kanal", "Ausgang", "Eingang", "Küche", "Wohnzimmer", "Schlafzimmer",
    "Kinderzimmer", "Bad", "Badezimmer", "Gäste", "Büro", "Flur", "Diele", "Gang", "Treppe", "Treppenhaus", "Keller", "Garage", "Garten", "Terrasse",
    "Balkon", "Technik", "Technikraum", "Verteilung", "Ankleide", "Esszimmer", "Essen", "Wohnen", "Arbeiten", "Lesen", "Haus", "Erdgeschoss",
    "Obergeschoss", "Dachgeschoss", "Untergeschoss", "Aussen", "Außen", "Innen", "Links", "Rechts", "Mitte", "Oben", "Unten", "Light", "Switch",
    "Switching", "Dimming", "Value", "Blind", "Blinds", "Shutter", "Room", "Living", "Kitchen", "Bedroom", "Bathroom", "Office", "Floor", "Ground",
    "First", "Central", "Scene", "Heating", "Temperature", "Setpoint", "Current", "Actual", "Mode", "Window", "Door", "Presence", "Motion",
  ].map((word) => word.toLowerCase()),
);

export async function anonymizeKnxproj(data: Uint8Array, options: AnonymizeOptions = {}): Promise<AnonymizeResult> {
  const archive = await openEtsArchive(data, options);
  const replacements = Object.entries(options.replacements ?? {}).filter(([from]) => from !== "");
  let removedSecrets = 0;
  let removedElements = 0;
  let replacedValues = 0;
  const words = new Map<string, number>();
  const buildingCounters = new Map<string, number>();

  const replace = (value: string): string => {
    let result = value;
    for (const [from, to] of replacements) result = result.split(from).join(to);
    if (result !== value) replacedValues++;
    return result;
  };

  const rules: RewriteRules = {
    dropElements: DROP_ELEMENTS,
    attribute(element, name, value, attributes) {
      if (SECRET_ATTRIBUTE.test(name) || IDENTITY_ATTRIBUTE.test(name) || NETWORK_ATTRIBUTE.test(name)) {
        removedSecrets++;
        return undefined;
      }
      if (name === "Comment") return value === "" ? value : "";
      if (element === "ProjectInformation") {
        if (name === "Name") return "Anonymisiertes Projekt";
        if (name === "ProjectNumber") return "0";
        if (name === "Guid") return "00000000-0000-4000-8000-000000000000";
      }
      if (element === "Installation" && name === "Name") return "";
      const buildingLabel = BUILDING_TYPES[attributes["Type"] ?? ""];
      if ((element === "Space" || element === "BuildingPart") && name === "Name" && buildingLabel !== undefined) {
        const count = (buildingCounters.get(buildingLabel) ?? 0) + 1;
        buildingCounters.set(buildingLabel, count);
        return `${buildingLabel} ${count}`;
      }
      const result = replace(value);
      if (NAME_ELEMENTS.has(element) && (name === "Name" || name === "Text" || name === "Description")) collectWords(result, words);
      return result;
    },
  };

  const files: Record<string, Uint8Array> = {};
  const folder = archive.projectXml.includes("/") ? archive.projectXml.slice(0, archive.projectXml.lastIndexOf("/") + 1) : "P-0000/";
  for (const name of [archive.projectXml, ...archive.installationXmls]) {
    const source = await archive.readProjectFile(name);
    const before = countElements(source);
    const rewritten = rewriteXml(source, rules, name);
    removedElements += before - countElements(utf8(rewritten));
    files[`${folder}${name.slice(name.lastIndexOf("/") + 1)}`] = utf8(rewritten);
  }
  if (archive.hasMasterXml) files["knx_master.xml"] = await archive.readMasterXml();
  for (const name of archive.manufacturerXmls) files[name] = await archive.readManufacturerFile(name);

  const output = zipSync(files, { level: 6, mtime: new Date("2020-01-01T00:00:00Z") });
  const namesToReview = [...words.entries()]
    .filter(([word, count]) => count <= 3 && !REVIEW_STOPWORDS.has(word.toLowerCase()))
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], "de"))
    .map(([word, count]) => ({ word, count }));
  return {
    output,
    report: {
      removedSecrets,
      removedElements,
      replacedValues,
      keptFiles: Object.keys(files).sort(),
      namesToReview,
    },
  };
}

function collectWords(value: string, words: Map<string, number>): void {
  for (const word of value.split(/[^\p{L}]+/u)) {
    if (word.length >= 3 && /^\p{Lu}/u.test(word)) words.set(word, (words.get(word) ?? 0) + 1);
  }
}

function countElements(data: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < data.byteLength - 1; i++) {
    if (data[i] === 0x3c && data[i + 1] !== 0x2f && data[i + 1] !== 0x3f && data[i + 1] !== 0x21) count++;
  }
  return count;
}
