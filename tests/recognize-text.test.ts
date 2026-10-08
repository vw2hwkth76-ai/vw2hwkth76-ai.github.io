import { describe, expect, it } from "vitest";
import type { Space } from "../src/ets/model.ts";
import { findWords } from "../src/recognize/lexicon.ts";
import { RoomMatcher } from "../src/recognize/rooms.ts";
import { tokenize } from "../src/recognize/text.ts";

const space = (id: string, name: string, type = "Room"): Space => ({
  id,
  name,
  type,
  usage: undefined,
  number: undefined,
  description: "",
  parentId: undefined,
  deviceIds: [],
});

const GERMAN = new RoomMatcher([
  space("haus", "Haus Muster", "Building"),
  space("ug", "UG", "Floor"),
  space("wz", "Wohnzimmer"),
  space("bad", "Badezimmer"),
  space("gang", "Gang"),
  space("wc", "WC"),
  space("buero", "Büro/ Flur"),
  space("kind", "Kinderzimmer"),
  space("schlaf", "Schlafzimmer"),
  space("kueche", "Küche"),
  space("vt", "Verteilung", "DistributionBoard"),
]);
const ENGLISH = new RoomMatcher([space("lr", "Living room"), space("n1", "Nursery 1"), space("n2", "Nursery 2"), space("bath", "Bath room"), space("tb", "Terrace/Balcony")]);

const rooms = (matcher: RoomMatcher, name: string): string[] => matcher.findRooms(tokenize(name)).matches.map((match) => match.spaceId).sort();

describe("tokenize", () => {
  it("trennt Satzzeichen, Binnenmajuskeln und Zahlen", () => {
    expect(tokenize("Ist-Temp").map((token) => token.norm)).toEqual(["ist", "temp"]);
    expect(tokenize("SollTemp").map((token) => token.norm)).toEqual(["soll", "temp"]);
    expect(tokenize("Licht1 Küche").map((token) => token.norm)).toEqual(["licht", "1", "kueche"]);
    expect(tokenize("Betriebsm. Kompf.Zentral").map((token) => token.norm)).toEqual(["betriebsm", "kompf", "zentral"]);
  });
});

describe("findWords", () => {
  const info = (name: string) => findWords(tokenize(name)).map((hit) => hit.info);
  it("erkennt Marker, Gewerke und Aspekte", () => {
    expect(info("Licht A RM Küche")).toEqual([{ trade: "lighting" }, { marker: "status" }]);
    expect(info("Rolladen 1 Position RM")).toEqual([{ trade: "shading" }, { aspect: "position" }, { marker: "status" }]);
    expect(info("KNX SV in Betrieb")).toContainEqual({ aspect: "operating" });
  });

  it("zerlegt Komposita in Grund- und Bestimmungswort", () => {
    expect(info("Küchenfenster 1")).toEqual([{ aspect: "window" }]);
    expect(info("Hintergrundbeleuchtung")).toEqual([{ trade: "lighting" }]);
    expect(info("Windalarm")).toEqual([{ aspect: "wind", marker: "alarm" }]);
  });
});

describe("RoomMatcher", () => {
  it("findet Raeume exakt, abgekuerzt und in Komposita", () => {
    expect(rooms(GERMAN, "Licht A RM Küche")).toEqual(["kueche"]);
    expect(rooms(GERMAN, "Bad Decke")).toEqual(["bad"]);
    expect(rooms(GERMAN, "Rolladen Schlafzim.")).toEqual(["schlaf"]);
    expect(rooms(GERMAN, "Schlafen")).toEqual(["schlaf"]);
    expect(rooms(GERMAN, "Küchenfenster 1")).toEqual(["kueche"]);
    expect(rooms(GERMAN, "heizen Büro")).toEqual(["buero"]);
    expect(rooms(GERMAN, "Flur")).toEqual(["buero"]);
    expect(rooms(GERMAN, "WC Decke")).toEqual(["wc"]);
  });

  it("meldet mehrere Raeume statt einen zu raten", () => {
    expect(rooms(GERMAN, "Bad/ WC")).toEqual(["bad", "wc"]);
    expect(rooms(GERMAN, "Rolladen Küche/ Wohnzimmer")).toEqual(["kueche", "wz"]);
  });

  it("ignoriert Verteiler, Gebaeude und Wortteile ohne Raumbezug", () => {
    expect(rooms(GERMAN, "Verteilung Ausgang")).toEqual([]);
    expect(rooms(GERMAN, "Licht zentral")).toEqual([]);
  });

  it("verlangt bei nummerierten Raeumen die Nummer", () => {
    expect(rooms(ENGLISH, "Nursery 1 Bed switching")).toEqual(["n1"]);
    expect(ENGLISH.findRooms(tokenize("Nursery Bed")).ambiguousTokens).toEqual([0]);
    expect(rooms(ENGLISH, "Living room Desk light")).toEqual(["lr"]);
    expect(rooms(ENGLISH, "Bath room Window movement")).toEqual(["bath"]);
    expect(rooms(ENGLISH, "Terrace/Balcony Wall light")).toEqual(["tb"]);
  });

  it("findet Etagen nur exakt", () => {
    expect(GERMAN.findFloors(tokenize("Rolladen UG")).matches.map((match) => match.spaceId)).toEqual(["ug"]);
  });
});

describe("textOf", () => {
  it("behaelt Satzzeichen zusammenhaengender Woerter", async () => {
    const { textOf } = await import("../src/recognize/text.ts");
    const name = "Staircase Stairs Ground/Upper switching";
    const tokens = tokenize(name);
    expect(textOf(name, tokens.slice(1, 4))).toBe("Stairs Ground/Upper");
    expect(textOf("Licht A RM Küche", tokenize("Licht A RM Küche").slice(0, 2))).toBe("Licht A");
    expect(textOf("R LR Wind alert", [tokenize("R LR Wind alert")[0]!, tokenize("R LR Wind alert")[3]!])).toBe("R alert");
  });
});
