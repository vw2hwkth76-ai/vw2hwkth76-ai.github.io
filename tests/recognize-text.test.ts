import { describe, expect, it } from "vitest";
import type { Space } from "../src/ets/model.ts";
import { findWords, splitKnown } from "../src/recognize/lexicon.ts";
import { codeKeys, RoomMatcher } from "../src/recognize/rooms.ts";
import { tokenize } from "../src/recognize/text.ts";

const space = (id: string, name: string, type = "Room", parentId?: string): Space => ({
  id,
  name,
  type,
  usage: undefined,
  number: undefined,
  description: "",
  parentId,
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

/** Struktur wie in aelteren Schulprojekten: Raumnummer mit Geschossbuchstabe, Verwaltungszusatz in Klammern, Tippfehler. */
const SCHOOL = new RoomMatcher([
  space("p1", "Physics Lab1G (line1)"),
  space("p2", "Physics Lab2G (line1)"),
  space("pc", "Circulation Physics 1&2G (line1)"),
  space("a1", "Art Lab1F (line1)"),
  space("a8", "Art Lab8G (line4)"),
  space("tg", "Toilets Ground"),
  space("cf", "Circulaton First Floor"),
  space("store", "Dark Room/ Art Store"),
]);

/** Gewerbebau mit Raumnummern; gleich benannte Flurzonen in zwei Gebaeuden. */
const CAMPUS = new RoomMatcher([
  space("a12", "Site Level 1 Area 1&2", "Building"),
  space("a7", "Site Level 1 Area 7", "Building"),
  space("r057", "02_L1/B/057_Male_WC_&_Lobby", "Room", "a12"),
  space("sr10", "10_L1/B/SR10_Plant", "Room", "a12"),
  space("cz1a", "12_Corridor_Zone1", "Room", "a12"),
  space("cz1b", "19_Corridor_Zone1", "Room", "a7"),
  space("r703", "01_L1/A/003_Disabled_WC", "Room", "a7"),
]);

const rooms = (matcher: RoomMatcher, name: string): string[] => matcher.findRooms(tokenize(name)).matches.map((match) => match.spaceId).sort();

describe("tokenize", () => {
  it("trennt Satzzeichen, Binnenmajuskeln und Zahlen", () => {
    expect(tokenize("Ist-Temp").map((token) => token.norm)).toEqual(["ist", "temp"]);
    expect(tokenize("SollTemp").map((token) => token.norm)).toEqual(["soll", "temp"]);
    expect(tokenize("Licht1 Küche").map((token) => token.norm)).toEqual(["licht", "1", "kueche"]);
    expect(tokenize("Betriebsm. Kompf.Zentral").map((token) => token.norm)).toEqual(["betriebsm", "kompf", "zentral"]);
    expect(tokenize("Physlab2G_PIRDisable").map((token) => token.norm)).toEqual(["physlab", "2", "g", "pir", "disable"]);
    expect(tokenize("BIQ").map((token) => token.norm)).toEqual(["biq"]);
  });
});

describe("splitKnown", () => {
  it("teilt klein zusammengeschriebene Fachwoerter, wenn beide Teile bekannt sind", () => {
    expect(splitKnown("valuelights")).toEqual(["value", "lights"]);
    expect(splitKnown("currentsetpoint")).toEqual(["current", "setpoint"]);
    expect(splitKnown("wohnzimmer")).toBeUndefined();
    expect(splitKnown("switch")).toBeUndefined();
  });
});

describe("findWords", () => {
  const info = (name: string) => findWords(tokenize(name)).map((hit) => hit.info);
  it("kennt Stoerungen, Belegung, Klappen und Luftqualitaet", () => {
    expect(info("Toilet_ExtractFault")).toEqual([{ trade: "hvac" }, { marker: "alarm" }]);
    expect(info("Extractfault")).toEqual([{ trade: "hvac", marker: "alarm" }]);
    // Mehrwortbegriffe zuerst, dann Einzelwoerter.
    expect(info("Dali_Short_Circuit_Status").map((entry) => entry.marker ?? entry.trade)).toEqual(["alarm", "lighting", "status"]);
    expect(info("Lab_Occupied")).toContainEqual({ aspect: "presence" });
    expect(info("Damper_Value")).toEqual([{ aspect: "damper", trade: "hvac" }, { aspect: "value" }]);
    expect(info("Air quality sensor")).toContainEqual({ aspect: "airQuality", trade: "hvac" });
    expect(info("Heating / cooling")).toEqual([{ aspect: "heatCool", trade: "hvac" }]);
    expect(info("PIRDisable")).toEqual([{ aspect: "presence" }, { aspect: "lock" }]);
  });

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

  it("gleicht Raumnamen mit Nummer, Geschossbuchstabe und Kuerzeln ab", () => {
    expect(rooms(SCHOOL, "PhysLab2G_Window_Switch")).toEqual(["p2"]);
    expect(rooms(SCHOOL, "Physics_Lab1G_Temperature")).toEqual(["p1"]);
    expect(rooms(SCHOOL, "Art_Lab1F_Damper_Value")).toEqual(["a1"]);
    // Der Flur zu beiden Laboren erklaert mehr vom Namen als ein einzelnes Labor.
    expect(rooms(SCHOOL, "Fault_Corridor_PhysLab_1&2")).toEqual(["pc"]);
    expect(rooms(SCHOOL, "Fault_Corridor_PhysLab_1&2_b")).toEqual(["pc"]);
  });

  it("kennt Synonyme, Geschosswoerter und Tippfehler im Raumnamen", () => {
    expect(rooms(SCHOOL, "Ground_Staff_WC")).toEqual(["tg"]);
    expect(rooms(SCHOOL, "First_Floor_Corridor_West")).toEqual(["cf"]);
    expect(rooms(SCHOOL, "Corridor_PhysLab_1&2_Ground")).toEqual(["pc"]);
  });

  it("nennt bei Aufzaehlungen beide Raeume und widerspricht keinem Geschossbuchstaben", () => {
    expect(rooms(SCHOOL, "PhysicsLab 1&2_ECG_Error")).toEqual(["p1", "p2"]);
    // "Lab8F" gibt es nicht, "Lab8G" schon: der Tippfehler wird schwach zugeordnet; gibt es beide, gewinnt der exakte.
    expect(SCHOOL.findRooms(tokenize("Art_Lab8F_Airquality")).matches.map((match) => [match.spaceId, match.kind])).toEqual([["a8", "mismatch"]]);
    expect(rooms(new RoomMatcher([space("a8g", "Art Lab8G"), space("a8f", "Art Lab8F")]), "Art_Lab8F_Airquality")).toEqual(["a8f"]);
    expect(rooms(SCHOOL, "PhyslabX_Trigger")).toEqual([]);
    expect(rooms(SCHOOL, "Physlab2G_Airquality_Sensor")).toEqual(["p2"]);
    // Ein Kuerzel allein ("Art" im Lager) reicht nicht.
    expect(rooms(SCHOOL, "Art_Extract_Fault")).toEqual([]);
  });

  it("erkennt Raumnummern im GA-Namen", () => {
    expect(codeKeys("02_L1/B/057_Male_WC_&_Lobby")).toEqual(expect.arrayContaining(["b057", "l1b057"]));
    expect(codeKeys("12_Corridor_Zone1")).toEqual(expect.arrayContaining(["corz1", "corridorzone1"]));
    expect(codeKeys("Kitchen")).toEqual([]);
    expect(rooms(CAMPUS, "A0101B057_ASwitchLights_Input")).toEqual(["r057"]);
    expect(rooms(CAMPUS, "A0101BSR10_EmLamp1")).toEqual(["sr10"]);
    // "A003" ist eine andere Zone als "B057": keine Verwechslung ueber die Nummer allein.
    expect(rooms(CAMPUS, "A0101B003_SpaceOcc")).toEqual([]);
    // Gleiche Flurzone in zwei Gebaeuden: beide bleiben stehen, der Gruppenbereich entscheidet spaeter.
    expect(rooms(CAMPUS, "A0101BCORZ1_SpaceOcc")).toEqual(["cz1a", "cz1b"]);
  });

  it("unterscheidet Gebaeude nur an dem, was sie unterscheidet", () => {
    // "Site", "Level", "Area" stehen in jedem Gebaeudenamen; "1&2" macht den Unterschied.
    expect(rooms(CAMPUS, "Level 1 Area 1&2")).toEqual(["a12"]);
    expect(rooms(CAMPUS, "Level 1 Area 7")).toEqual(["a7"]);
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
