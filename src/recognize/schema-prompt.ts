import { isNeutral } from "../graph/direction.ts";
import type { ProjectGraph } from "../graph/evidence-graph.ts";
import { type Exclusion, excludedReasons, NO_EXCLUSION, reserveOnlyMiddleGroups } from "../graph/scope.ts";
import { ASPECTS, TRADES } from "./lexicon.ts";
import { PROFILE_FORMAT_V2 } from "./profile.ts";

/**
 * Prompt fuer den Schema-Vorschlag eines LLM. Der Mensch kopiert ihn in ein
 * LLM seiner Wahl und fuegt die Antwort wieder ein; die App selbst schickt
 * nichts weg. Er enthaelt nur, was das Schema braucht: Gebaeudestruktur,
 * GA-Namen, Gruppenbereiche, DPT, Groesse und Funktion der verknuepften
 * Objekte. Projektname, Kunde, Errichter und Geraetebeschreibungen fehlen.
 */

export interface PromptOptions {
  /** Ab dieser Zahl GAs nur Beispiele je Namensform; die Abdeckung prueft die App danach an allen. */
  readonly maxGroupAddresses?: number;
  /** Anrede mit Namen ("Dr. Meier", "Frau Schmidt") durch Platzhalter ersetzen. */
  readonly maskPersons?: boolean;
  /** Ausgeschlossene GAs stehen weder als Zeile noch in den Gruppenbereichen im Prompt. */
  readonly exclude?: Exclusion;
}

export interface SchemaPrompt {
  readonly text: string;
  readonly groupAddresses: number;
  /** GAs, die als Zeile im Prompt stehen. */
  readonly included: number;
  /** GAs, die wegen des Ausschlusses nicht vorkommen. */
  readonly excluded: number;
  /** Ersetzte Personennamen. */
  readonly masked: number;
}

const DEFAULT_MAX = 400;
const MAX_RANGE_LINES = 300;
const MAX_VOCABULARY = 200;
const MAX_OBJECT_TEXT = 40;
const PERSON = /\b(Dr|Prof|Herr|Frau|Hr|Fr|Mr|Mrs|Ms)\.?\s+[\p{Lu}][\p{L}'-]+/gu;

function instructions(): string {
  return `Du bekommst die Gruppenadressen eines KNX-Projekts. Erkenne das Namensschema des Errichters und gib es als JSON im Format "${PROFILE_FORMAT_V2}" zurück. Antworte nur mit dem JSON, ohne Erklärung davor oder danach.

Ziel: Aus jedem GA-Namen sollen Raum, Gewerk, Richtung und die Zugehörigkeit zu einem Thing ablesbar sein. Ein Thing ist ein Gerät oder eine Funktion, die ein Nutzer als Einheit bedient oder überwacht: ein Lichtkanal, ein Sonnenschutz, ein Raumregler, ein Fancoil. Verschiedene Geräte sind verschiedene Things, auch im selben Raum.

Format:
{
  "format": "${PROFILE_FORMAT_V2}",
  "name": "<kurzer Name des Schemas>",
  "aufbau": "<Aufbau in Worten, z. B. Etage.Raum.Gewerk-Art-Funktion-Kanal>",
  "patterns": [
    { "regex": "<JavaScript-Regex mit benannten Gruppen, auf den ganzen GA-Namen>", "source": "name|path", "thing": ["<Gruppen, deren Werte zusammen ein Thing bestimmen>"] }
  ],
  "values": {
    "<Gruppenname>": { "<Wert wie im Namen>": { "trade": "...", "direction": "...", "aspect": "...", "dpt": "<z. B. DPST-1-1, nur wenn sicher>", "label": "...", "thing": "<optional>", "room": "<nur bei Raumkürzeln>" } }
  },
  "rules": [ { "match": "<Regex auf den GA-Namen>", "direction": "...", "trade": "...", "aspect": "...", "why": "<kurz>" } ]
}

Regeln:
- "source": "name" lässt die Regex auf den GA-Namen allein passen. Steht die Funktion im Gruppenbereich (z. B. Mittelgruppe "Schalten") und der Name nennt nur Raum und Nummer, nimm "source": "path": Dann passt die Regex auf den Text "Hauptgruppe / Mittelgruppe / Name", genau so wie in der Spalte Bereich und Name unten, mit " / " dazwischen. Prüfe in jedem Projekt zuerst, ob die Funktion im Namen oder im Bereich steht.
- Höchstens 40 Muster; je weniger, desto besser. Regeln ("rules") wirken nur auf GAs, die ein Muster liest.
- Wiederholungen von Gruppen nur mit festem Trenner ("(?: \\S+)*"); verschachtelte Wiederholungen wie "(\\w+)*" lehnt die App ab.
- Die Gruppe "room" liefert den Raum. Steht im Namen der Raumname aus der Gebäudestruktur, genügt das; steht dort ein Kürzel ("WZ"), ordne es unter "values" -> "room" mit "room": "<Raumname wie in der Gebäudestruktur>" zu. Eine Etage heißt "floor".
- "thing" listet die Gruppen, deren Werte zusammen ein Thing bestimmen, z. B. ["room", "gewerk", "kanal"]. Soll ein Wert mit einem anderen derselben Gruppe ein Thing bilden, trage bei ihm "thing": "<anderer Wert>" ein.
- "direction": command (Befehl an ein Gerät), status (Zustand oder Messwert, den ein Gerät meldet), alarm (Störung).
- "trade": ${TRADES.join(", ")}.
- "aspect" nur aus dieser Liste, sonst weglassen: ${Object.keys(ASPECTS).join(", ")}.
- "dpt": der KNX-Datenpunkttyp, den diese Funktion üblicherweise trägt (Schalten DPST-1-1, relatives Dimmen DPST-3-7, Prozentwert DPST-5-1, Temperatur DPST-9-1). Nur eintragen, wenn Name oder Bereich ihn sicher nahelegen ("1 Bit", "8 Bit", "Temperatur"); sonst weglassen.
- "label" ist ein kurzer Anzeigename in der Sprache der GA-Namen.
- Wo Kennwörter allein nicht reichen, ergänze "rules" für Ausnahmen. Regeln gehen den Werten vor.
- Rate nicht: Lass Werte weg, deren Bedeutung du nicht erkennst.
- Achte auf Tippfehler und fehlende Trennzeichen; das Muster soll möglichst alle GAs abdecken. Prüfe es an mehreren Namen.`;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Form eines Namens ohne Raumnamen und Ziffern; GAs gleicher Form unterscheiden sich nur darin. */
function formOf(spaceNames: RegExp | undefined): (name: string) => string {
  return (name) => (spaceNames ? name.replace(spaceNames, "@") : name).replace(/\d+/g, "#");
}

export function buildSchemaPrompt(graph: ProjectGraph, options: PromptOptions = {}): SchemaPrompt {
  const max = options.maxGroupAddresses ?? DEFAULT_MAX;
  let masked = 0;
  const clean = (text: string): string =>
    options.maskPersons === false
      ? text
      : text.replace(PERSON, (_, title: string) => {
          masked++;
          return `${title}. [Name]`;
        });

  const lines: string[] = [instructions(), "", "Gebäudestruktur (Typ: Name, eingerückt nach Ebene):"];
  const spaces = graph.loaded.project.spaces;
  const children = new Map<string | undefined, (typeof spaces)[number][]>();
  for (const space of spaces) children.set(space.parentId, [...(children.get(space.parentId) ?? []), space]);
  // Der Name eines einzigen Gebaeudes ist oft der des Bauherrn; das Schema braucht ihn nicht, nur bei mehreren Gebaeuden unterscheidet er sie.
  const buildings = spaces.filter((space) => space.type === "Building").length;
  const shown = (space: (typeof spaces)[number]): string => (space.type === "Building" && buildings === 1 ? "(Name ausgelassen)" : clean(space.name));
  const walk = (parent: string | undefined, depth: number): void => {
    for (const space of children.get(parent) ?? []) {
      lines.push(`${"  ".repeat(depth)}${space.type}: ${shown(space)}`);
      if (depth < 12) walk(space.id, depth + 1);
    }
  };
  walk(undefined, 0);

  const excludedIds = excludedReasons(graph, options.exclude ?? NO_EXCLUSION);
  const nodes = graph.groupAddresses.filter((node) => !excludedIds.has(node.ga.id));
  // Grosse Projekte: reihum je Gruppenbereich die naechste Namensform, bis die Obergrenze erreicht ist. Der Bereich
  // zaehlt mit: "Wohnzimmer 1" in 16 Mittelgruppen sind 16 verschiedene Funktionen, nicht ein Beispiel.
  const rangePath = (node: (typeof nodes)[number]): string => node.ranges.map((range) => range.name.trim()).join(" / ");
  let picked: ReadonlySet<(typeof nodes)[number]> = new Set(nodes);
  if (nodes.length > max) {
    const names = [...new Set(spaces.map((space) => space.name.trim()).filter((name) => name.length >= 2))].sort((a, b) => b.length - a.length);
    const form = formOf(names.length > 0 ? new RegExp(names.map(escape).join("|"), "gi") : undefined);
    const byRange = new Map<string, Map<string, (typeof nodes)[number]>>();
    for (const node of nodes) {
      const path = rangePath(node);
      const forms = byRange.get(path) ?? new Map<string, (typeof nodes)[number]>();
      if (!forms.has(form(node.ga.name))) forms.set(form(node.ga.name), node);
      byRange.set(path, forms);
    }
    const queues = [...byRange.values()].map((forms) => [...forms.values()]);
    const chosen = new Set<(typeof nodes)[number]>();
    for (let round = 0; chosen.size < max && queues.some((queue) => queue.length > round); round++) {
      for (const queue of queues) {
        const node = queue[round];
        if (node && chosen.size < max) chosen.add(node);
      }
    }
    picked = chosen;
  }
  // Alle Gruppenbereiche mit Anzahl, auch wenn ihre GAs nur als Beispiele erscheinen: Die Funktion steht oft dort.
  const paths = new Map<string, { count: number; example: string }>();
  for (const node of nodes) {
    const path = rangePath(node);
    const entry = paths.get(path);
    if (entry) entry.count++;
    else paths.set(path, { count: 1, example: node.ga.name.trim() });
  }
  if (paths.size > 1) {
    lines.push("", "Gruppenbereiche (Hauptgruppe / Mittelgruppe, Anzahl GAs, Beispielname):");
    for (const [path, entry] of [...paths].slice(0, MAX_RANGE_LINES)) lines.push(`${clean(path)} | ${entry.count} | ${clean(entry.example)}`);
  }
  lines.push("", "Gruppenadressen (Adresse | Bereich | Name | DPT | verknüpfte Objekte: Größe Funktion):");
  let included = 0;
  for (const node of nodes) {
    if (!picked.has(node)) continue;
    const objects = [
      ...new Set(
        node.links
          .filter((link) => !isNeutral(link))
          .map((link) => `${link.comObject.objectSizeBits ?? "?"}b ${(link.comObject.functionText ?? link.comObject.text ?? "").trim().slice(0, MAX_OBJECT_TEXT)}`),
      ),
    ].join("; ");
    const range = node.ranges.map((entry) => clean(entry.name)).join(" / ");
    lines.push(`${node.ga.text} | ${range} | ${clean(node.ga.name)} | ${node.ga.dpts[0] ?? "-"} | ${objects}`);
    included++;
  }
  if (included < nodes.length) {
    lines.push("", `Weitere ${nodes.length - included} GAs sind nicht aufgeführt; sie folgen denselben Namensformen, meist nur mit anderem Raum oder anderer Nummer. Das Muster soll auch sie abdecken.`);
  }
  if (excludedIds.size > 0) {
    lines.push("", `${excludedIds.size} weitere GAs (Vorrat ohne Gerät oder ausgeschlossen) sind bewusst weggelassen. Das Muster muss sie nicht abdecken.`);
  }
  // Vorlagenprojekte tragen das ganze Vokabular des Errichters, auch fuer Funktionen, die dieses Projekt nicht nutzt;
  // ein Schema, das nur die benutzten Werte kennt, versagt beim naechsten Projekt mit derselben Vorlage.
  const vocabulary = reserveOnlyMiddleGroups(graph, excludedIds);
  if (vocabulary.length > 0) {
    lines.push(
      "",
      `Weitere Mittelgruppen, die nur im weggelassenen Vorrat vorkommen. Nur als Vokabular: Ordne ihnen unter "values" eine Bedeutung zu, wenn sie sicher erkennbar ist, aber lege dafür keine eigenen Muster an:`,
      vocabulary
        .slice(0, MAX_VOCABULARY)
        .map((name) => clean(name))
        .join(" | "),
    );
  }
  return { text: lines.join("\n"), groupAddresses: graph.groupAddresses.length, included, excluded: excludedIds.size, masked };
}

/** Holt das JSON aus einer eingefuegten LLM-Antwort, auch mit Codezaun oder Text drumherum. */
export function extractJson(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(answer);
  const body = fenced?.[1] ?? answer;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("In der Antwort steht kein JSON-Objekt.");
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch (error) {
    throw new Error(`Die Antwort ist kein gültiges JSON (${error instanceof Error ? error.message : String(error)}).`);
  }
}
