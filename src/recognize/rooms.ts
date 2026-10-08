import type { Space } from "../ets/model.ts";
import { normalizeText, type Token } from "./text.ts";

export type RoomMatchKind = "full" | "abbreviation" | "compound" | "initials" | "partial";

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
const RANK: Readonly<Record<RoomMatchKind, number>> = { full: 3, abbreviation: 2, compound: 2, initials: 2, partial: 1 };
/** Grundwoerter deutscher Raumnamen, aus denen Kuerzel wie "WZ" oder "SZ" entstehen. */
const ROOM_HEADS = ["zimmer", "raum", "kammer", "stube", "flur", "bereich", "kueche", "bad"];
const MIN_ABBREVIATION = 3;
const MIN_COMPOUND = 4;

interface Candidate {
  readonly space: Space;
  readonly parts: readonly string[];
  /** Kuerzel aus Anfangsbuchstaben, "lr" fuer "Living room", "wz" fuer "Wohnzimmer". */
  readonly initials: string | undefined;
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
      return { space, parts, initials: initialsOf(parts) };
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
  return { matches: kept, ambiguousTokens: [...ambiguous].sort((a, b) => a - b) };
}

/** "bad" kuerzt "badezimmer" ab, "schlafen" ebenso "schlafzimmer" (gemeinsamer Stamm). */
function abbreviates(word: string, name: string): boolean {
  if (name.startsWith(word)) return word.length >= MIN_ABBREVIATION;
  let common = 0;
  while (common < word.length && common < name.length && word[common] === name[common]) common++;
  return common >= 5 && common / word.length >= 0.7;
}
