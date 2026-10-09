import type { Space } from "../ets/model.ts";
import { normalizeText, type Token, tokenize } from "./text.ts";

/**
 * "sequence": alle Bestandteile des Raumnamens im GA-Namen, auch gekuerzt,
 * als Synonym oder in anderer Reihenfolge; "loose" ebenso, aber ohne den
 * Geschossbuchstaben hinter der Raumnummer; "mismatch" mit anderem
 * Geschossbuchstaben ("Lab8F" fuer "Lab8G"), nur wenn es keinen besseren gibt.
 */
export type RoomMatchKind = "full" | "sequence" | "loose" | "mismatch" | "abbreviation" | "compound" | "initials" | "partial";

export interface RoomMatch {
  readonly spaceId: string;
  readonly tokens: readonly number[];
  readonly kind: RoomMatchKind;
}

export interface RoomFinding {
  /** Eindeutige Treffer, hoechstens einer je Token. */
  readonly matches: readonly RoomMatch[];
  /** Tokens, die zu mehreren Raeumen passen, etwa "Nursery" bei "Nursery 1" und "Nursery 2". */
  readonly ambiguousTokens: readonly number[];
}

const ROOM_TYPES = new Set(["Room", "Corridor", "Stairway", "Stairs", "BuildingPart", "Space"]);
const GENERIC = new Set(["room", "raum", "zimmer", "bereich", "area", "zone", "floor", "etage", "geschoss", "haus", "house", "the", "und", "and"]);
const RANK: Readonly<Record<RoomMatchKind, number>> = { full: 3, sequence: 3, loose: 2, mismatch: 1, abbreviation: 2, compound: 2, initials: 2, partial: 1 };
/** Grundwoerter deutscher Raumnamen, aus denen Kuerzel wie "WZ" oder "SZ" entstehen. */
const ROOM_HEADS = ["zimmer", "raum", "kammer", "stube", "flur", "bereich", "kueche", "bad"];
const MIN_ABBREVIATION = 3;
const MIN_COMPOUND = 4;

interface Candidate {
  readonly space: Space;
  readonly parts: readonly string[];
  /** Kuerzel aus Anfangsbuchstaben, "lr" fuer "Living room", "wz" fuer "Wohnzimmer". */
  readonly initials: string | undefined;
  /** Bestandteile fuer den Sequenzabgleich, zerlegt wie GA-Namen ("Lab2G" zu lab, 2, g). */
  readonly sequence: SequenceParts | undefined;
}

interface SequenceParts {
  readonly words: readonly string[];
  readonly numbers: readonly string[];
  /** Einzelbuchstaben, meist das Geschoss hinter der Raumnummer. */
  readonly letters: readonly string[];
}

/** Woerter, die in Raumnamen dasselbe meinen; das erste ist die Vergleichsform. */
const SYNONYMS: readonly (readonly string[])[] = [
  ["circulation", "corridor", "korridor", "flur", "hallway"],
  ["toilet", "toilets", "wc", "wcs", "lavatory"],
  ["stairwell", "stairway", "staircase", "stairs", "treppenhaus"],
];
const CANONICAL = new Map(SYNONYMS.flatMap((group) => group.map((word) => [word, group[0] ?? word] as const)));
/** Geschossbuchstaben hinter Raumnummern ("Lab2G" im Erdgeschoss, "Lab1F" im ersten Stock). */
const FLOOR_LETTERS: Readonly<Record<string, readonly string[]>> = { g: ["ground"], f: ["first"] };

function sequenceParts(name: string): SequenceParts | undefined {
  // Klammerzusaetze ("(line1)") sind Verwaltungsangaben, kein Teil des gesprochenen Namens.
  const core = name.replace(/\([^)]*\)/g, " ");
  const tokens = tokenize(core).map((token) => token.norm).filter((norm) => !GENERIC.has(norm));
  const words = tokens.filter((norm) => /^[a-z]{2,}$/.test(norm));
  if (words.length === 0) return undefined;
  return { words, numbers: tokens.filter((norm) => /^\d+$/.test(norm)), letters: tokens.filter((norm) => /^[a-z]$/.test(norm)) };
}

function initialsOf(parts: readonly string[]): string | undefined {
  if (parts.length >= 2 && parts.every((part) => /^[a-z]/.test(part))) return parts.map((part) => part[0]).join("");
  const single = parts[0];
  if (parts.length !== 1 || !single) return undefined;
  for (const head of ROOM_HEADS) {
    if (single.length > head.length + 1 && single.endsWith(head)) return `${single[0]}${head[0]}`;
  }
  return undefined;
}

/** Gleicht Woerter eines Namens gegen die Raeume der ETS-Gebaeudestruktur ab. */
export class RoomMatcher {
  readonly #rooms: Candidate[];
  readonly #floors: Candidate[];

  constructor(spaces: readonly Space[]) {
    const candidate = (space: Space): Candidate => {
      const parts = normalizeText(space.name).split(" ").filter((part) => part !== "");
      return { space, parts, initials: initialsOf(parts), sequence: sequenceParts(space.name) };
    };
    this.#rooms = spaces.filter((space) => ROOM_TYPES.has(space.type)).map(candidate).filter((entry) => entry.parts.length > 0);
    this.#floors = spaces.filter((space) => space.type === "Floor").map(candidate).filter((entry) => entry.parts.length > 0);
  }

  get roomCount(): number {
    return this.#rooms.length;
  }

  findRooms(tokens: readonly Token[]): RoomFinding {
    return match(this.#rooms, tokens);
  }

  findFloors(tokens: readonly Token[]): RoomFinding {
    return match(this.#floors, tokens, false);
  }
}

function match(candidates: readonly Candidate[], tokens: readonly Token[], fuzzy = true): RoomFinding {
  const raw: RoomMatch[] = [];
  const initialsCount = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.initials) initialsCount.set(candidate.initials, (initialsCount.get(candidate.initials) ?? 0) + 1);
  }
  for (const { space, parts, initials } of candidates) {
    for (let start = 0; start + parts.length <= tokens.length; start++) {
      if (parts.every((part, offset) => tokens[start + offset]?.norm === part)) {
        raw.push({ spaceId: space.id, tokens: parts.map((_, offset) => start + offset), kind: "full" });
      }
    }
    if (!fuzzy) continue;
    if (initials && initialsCount.get(initials) === 1) {
      for (const token of tokens) {
        if (token.norm === initials) raw.push({ spaceId: space.id, tokens: [token.index], kind: "initials" });
      }
    }
    const significant = parts.filter((part) => part.length >= MIN_ABBREVIATION && !GENERIC.has(part) && !/^\d+$/.test(part));
    for (const token of tokens) {
      const word = token.norm;
      if (word.length < MIN_ABBREVIATION || GENERIC.has(word) || /^\d+$/.test(word)) continue;
      if (parts.length === 1) {
        const name = parts[0] ?? "";
        if (word !== name && abbreviates(word, name)) raw.push({ spaceId: space.id, tokens: [token.index], kind: "abbreviation" });
        else if (name.length >= MIN_COMPOUND && word.length > name.length && word.startsWith(name)) {
          raw.push({ spaceId: space.id, tokens: [token.index], kind: "compound" });
        }
      } else if (significant.includes(word)) {
        raw.push({ spaceId: space.id, tokens: [token.index], kind: "partial" });
      }
    }
  }

  // Je Token nur der staerkste Treffer; gleich starke Treffer verschiedener Raeume sind mehrdeutig.
  const best = new Map<number, RoomMatch[]>();
  for (const candidate of raw) {
    for (const index of candidate.tokens) {
      const current = best.get(index);
      const currentRank = current?.[0] ? RANK[current[0].kind] * 10 + current[0].tokens.length : -1;
      const rank = RANK[candidate.kind] * 10 + candidate.tokens.length;
      if (rank > currentRank) best.set(index, [candidate]);
      else if (rank === currentRank && current && !current.some((entry) => entry.spaceId === candidate.spaceId)) current.push(candidate);
    }
  }
  const matches = new Map<string, RoomMatch>();
  const ambiguous = new Set<number>();
  for (const [index, list] of best) {
    const first = list[0];
    if (list.length > 1 || !first) {
      ambiguous.add(index);
      continue;
    }
    if (first.tokens.every((tokenIndex) => best.get(tokenIndex)?.length === 1 && best.get(tokenIndex)?.[0] === first)) {
      matches.set(`${first.spaceId}:${first.tokens.join(",")}`, first);
    }
  }
  // Je Raum nur der staerkste, erste Treffer. Hinter einem voll genannten Raum beschreiben die
  // Woerter die Funktion ("Nursery 1 Bed"), davor zaehlen auch Abkuerzungen ("Bad/ WC").
  const ordered = [...matches.values()].sort((a, b) => RANK[b.kind] - RANK[a.kind] || (a.tokens[0] ?? 0) - (b.tokens[0] ?? 0));
  const firstFullEnd = Math.min(...ordered.filter((entry) => entry.kind === "full").map((entry) => Math.max(...entry.tokens)));
  const perSpace = new Map<string, RoomMatch>();
  for (const entry of ordered) {
    if (perSpace.has(entry.spaceId)) continue;
    if (entry.kind !== "full" && (entry.tokens[0] ?? 0) > firstFullEnd) continue;
    perSpace.set(entry.spaceId, entry);
  }
  const kept = [...perSpace.values()].sort((a, b) => (a.tokens[0] ?? 0) - (b.tokens[0] ?? 0));
  const result = { matches: kept, ambiguousTokens: [...ambiguous].sort((a, b) => a - b) };
  if (!fuzzy) return result;

  // Der Sequenzabgleich gewinnt, wenn er mehr vom Namen erklaert als die Einzelworttreffer.
  const sequences = bestSequences(candidates, tokens);
  const covered = Math.max(0, ...kept.map((entry) => entry.tokens.length));
  const leading = sequences[0];
  if (!leading || leading.tokens.length <= covered) return result;
  return { matches: sequences.sort((a, b) => (a.tokens[0] ?? 0) - (b.tokens[0] ?? 0)), ambiguousTokens: [] };
}

/**
 * Raeume, deren Bestandteile alle im Namen stehen, mit der groessten
 * Abdeckung. Gleich gute Treffer bleiben alle stehen: "PhysicsLab 5&6"
 * nennt zwei Raeume, die Auswertung nimmt dann den gemeinsamen Bereich.
 */
function bestSequences(candidates: readonly Candidate[], tokens: readonly Token[]): RoomMatch[] {
  const found: { match: RoomMatch; missing: number }[] = [];
  for (const candidate of candidates) {
    if (!candidate.sequence) continue;
    const hit = sequenceMatch(candidate.sequence, tokens);
    if (!hit) continue;
    const kind: RoomMatchKind = hit.mismatch ? "mismatch" : hit.missing > 0 ? "loose" : "sequence";
    found.push({ match: { spaceId: candidate.space.id, tokens: hit.tokens, kind }, missing: hit.missing + (hit.mismatch ? MISMATCH_COST : 0) });
  }
  const score = (entry: { match: RoomMatch; missing: number }): number => entry.match.tokens.length * 10 - entry.missing;
  const top = Math.max(...found.map(score));
  return found.filter((entry) => score(entry) === top).map((entry) => entry.match);
}

/** Ein falscher Geschossbuchstabe wiegt schwerer als ein fehlender; ein Raum mehr im Namen wiegt beides auf. */
const MISMATCH_COST = 5;

function sequenceMatch(parts: SequenceParts, tokens: readonly Token[]): { tokens: number[]; missing: number; mismatch: boolean } | undefined {
  const used = new Set<number>();
  let exact = 0;
  const take = (test: (token: Token) => boolean): Token | undefined => {
    const token = tokens.find((entry) => !used.has(entry.index) && test(entry));
    if (token) used.add(token.index);
    return token;
  };
  for (let index = 0; index < parts.words.length; index++) {
    const word = parts.words[index] ?? "";
    const token = take((entry) => sameWord(entry.norm, word) !== "none");
    if (token) {
      if (sameWord(token.norm, word) === "exact") exact++;
      continue;
    }
    // Zusammengeschriebenes Kuerzel aus zwei Bestandteilen: "Physlab" fuer "Physics Lab".
    const next = parts.words[index + 1];
    const joined = next === undefined ? undefined : take((entry) => splitsInto(entry.norm, word, next));
    if (!joined) return undefined;
    exact++;
    index++;
  }
  const numberTokens: Token[] = [];
  for (const number of parts.numbers) {
    const token = take((entry) => entry.norm === number);
    if (!token) return undefined;
    numberTokens.push(token);
    exact++;
  }
  // Nur Kuerzel ("Bio") reichen nicht: Mindestens ein Bestandteil muss wortgleich sein.
  if (exact === 0) return undefined;
  let missing = 0;
  let mismatch = false;
  for (const letter of parts.letters) {
    if (take((entry) => entry.norm === letter || (FLOOR_LETTERS[letter] ?? []).includes(entry.norm))) continue;
    // Ein anderer Buchstabe direkt an der Raumnummer widerspricht ("Lab8F" gegen "Lab8G"), ein abgetrennter nicht ("1&2_b").
    const clash = numberTokens.some((number) => {
      const next = tokens[number.index + 1];
      return next !== undefined && next.start === number.end && !used.has(next.index) && /^[a-z]$/.test(next.norm) && next.norm !== letter;
    });
    if (clash) mismatch = true;
    else missing++;
  }
  return { tokens: [...used].sort((a, b) => a - b), missing, mismatch };
}

function splitsInto(token: string, first: string, second: string): boolean {
  for (let cut = 3; cut <= token.length - 2; cut++) {
    if (sameWord(token.slice(0, cut), first) !== "none" && sameWord(token.slice(cut), second) === "exact") return true;
  }
  return false;
}

/** Wie gut ein Namenswort einen Bestandteil des Raumnamens trifft. */
function sameWord(token: string, part: string): "exact" | "similar" | "none" {
  if (token === part) return "exact";
  const a = CANONICAL.get(token) ?? token;
  const b = CANONICAL.get(part) ?? part;
  if (a === b) return "exact";
  if (token.length < 3 || /\d/.test(token)) return "none";
  if (token === `${part}s` || part === `${token}s`) return "exact";
  if (part.length > token.length && part.startsWith(token)) return "similar";
  if (Math.min(a.length, b.length) >= 7 && editDistance(a, b) <= 1) return "similar";
  return "none";
}

/** Levenshtein-Abstand, fuer Tippfehler in Raumnamen ("Circulaton"). */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** "bad" kuerzt "badezimmer" ab, "schlafen" ebenso "schlafzimmer" (gemeinsamer Stamm). */
function abbreviates(word: string, name: string): boolean {
  if (name.startsWith(word)) return word.length >= MIN_ABBREVIATION;
  let common = 0;
  while (common < word.length && common < name.length && word[common] === name[common]) common++;
  return common >= 5 && common / word.length >= 0.7;
}
