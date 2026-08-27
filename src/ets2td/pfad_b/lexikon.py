from __future__ import annotations

import re
import unicodedata

from ets2td.modell import WotRolle

UMLAUTE = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def normalisiere(text: str) -> str:
    # NFC zuerst: macOS liefert Umlaute zerlegt, sonst wird aus "Kueche" "ku che".
    zusammengesetzt = unicodedata.normalize("NFC", text).lower().translate(UMLAUTE)
    ohne_akzente = "".join(
        zeichen
        for zeichen in unicodedata.normalize("NFD", zusammengesetzt)
        if unicodedata.category(zeichen) != "Mn"
    )
    return re.sub(r"[^a-z0-9]+", " ", ohne_akzente).strip()


def tokens(text: str) -> tuple[str, ...]:
    return tuple(normalisiere(text).split())


def enthaelt_phrase(text: str, phrase: str) -> bool:
    return f" {normalisiere(phrase)} " in f" {normalisiere(text)} "


KNX_ROLLEN: dict[str, WotRolle] = {
    "SwitchOnOff": WotRolle.ACTION,
    "InfoOnOff": WotRolle.PROPERTY,
    "RelativeSetvalueControl": WotRolle.ACTION,
    "ActualDimmingValue": WotRolle.PROPERTY,
    "DimmingControl": WotRolle.ACTION,
    "DimmingValue": WotRolle.ACTION,
    "InfoDimmingValue": WotRolle.PROPERTY,
    "MoveUpDown": WotRolle.ACTION,
    "StopStepUpDown": WotRolle.ACTION,
    "CurrentAbsolutePositionBlindsPercentage": WotRolle.PROPERTY,
    "CurrentAbsolutePositionSlatPercentage": WotRolle.PROPERTY,
    "WindAlarm": WotRolle.EVENT,
    "RainAlarm": WotRolle.EVENT,
    "HVACMode": WotRolle.ACTION,
    "ValvePosition": WotRolle.PROPERTY,
    "TempRoom": WotRolle.PROPERTY,
    "TempRoomSetpoint": WotRolle.ACTION,
    "WindowStatus": WotRolle.PROPERTY,
}

GUID_MUSTER = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


STATUS_WOERTER = frozenset(
    {
        "status",
        "rueckmeldung",
        "rm",
        "info",
        "istwert",
        "ist",
        "feedback",
        "state",
        "actual",
        "current",
        "aktuell",
        "aktuelle",
    }
)

EVENT_WOERTER = frozenset(
    {
        "alarm",
        "rauch",
        "smoke",
        "brand",
        "fire",
        "leckage",
        "sabotage",
        "stoerung",
        "windalarm",
        "regenalarm",
        "frostalarm",
    }
)

AKTIONS_WOERTER = frozenset(
    {
        "schalten",
        "schalt",
        "switching",
        "switch",
        "toggle",
        "ein",
        "aus",
        "on",
        "off",
        "dimmen",
        "dimming",
        "dim",
        "heller",
        "dunkler",
        "fahren",
        "fahrt",
        "auf",
        "ab",
        "up",
        "down",
        "move",
        "hoch",
        "runter",
        "stopp",
        "stop",
        "step",
        "schritt",
        "lang",
        "kurz",
        "langzeit",
        "kurzzeit",
        "betriebsm",
        "betriebsmodus",
        "kompf",
        "komfort",
        "nacht",
        "frost",
        "sperren",
        "sperre",
        "lock",
        "freigabe",
        "enable",
        "disable",
        "sollwert",
        "setpoint",
        "soll",
        "szene",
        "scene",
        "abruf",
        "aufruf",
        "call",
        "zwang",
        "zwangsfuehrung",
        "reset",
        "quittieren",
        "betriebsart",
        "mode",
        "modus",
    }
)

# Ohne Statusmarker im Namen nicht entscheidbar: dieselbe Bezeichnung traegt in
# realen Projekten mal den Stellbefehl, mal die Rueckmeldung. Solche Adressen
# bekommen keine Rolle und landen in der Rueckfrageliste.
MEHRDEUTIGE_WOERTER = frozenset(
    {"wert", "value", "stellwert", "position", "helligkeit", "brightness"}
)

MESSWERT_WOERTER = frozenset(
    {
        "temperatur",
        "temperature",
        "temp",
        "helligkeit",
        "brightness",
        "lux",
        "feuchte",
        "humidity",
        "co2",
        "wind",
        "windgeschwindigkeit",
        "regen",
        "praesenz",
        "presence",
        "bewegung",
        "motion",
        "fenster",
        "window",
        "tuer",
        "door",
        "kontakt",
        "contact",
        "verbrauch",
        "energie",
        "energy",
        "leistung",
        "power",
        "spannung",
        "zaehler",
        "meter",
    }
)

DPT_FALLBACK: tuple[tuple[frozenset[str], str], ...] = (
    (frozenset({"dimmen", "dimming", "dim", "heller", "dunkler"}), "DPST-3-7"),
    (frozenset({"temperatur", "temperature", "temp"}), "DPST-9-1"),
    (frozenset({"lux"}), "DPST-9-4"),
    (frozenset({"feuchte", "humidity"}), "DPST-9-7"),
    (frozenset({"co2"}), "DPST-9-8"),
    (frozenset({"windgeschwindigkeit"}), "DPST-9-5"),
    (
        frozenset({"helligkeit", "brightness", "wert", "value", "stellwert", "position"}),
        "DPST-5-1",
    ),
    (frozenset({"betriebsm", "kompf", "komfort", "nacht", "frost"}), "DPST-1-1"),
    (frozenset({"fahren", "auf", "ab", "up", "down", "move", "hoch", "runter"}), "DPST-1-8"),
    (frozenset({"stopp", "stop", "step", "schritt"}), "DPST-1-7"),
    (frozenset({"alarm"}), "DPST-1-5"),
    (frozenset({"sperren", "sperre", "lock", "freigabe", "enable", "disable"}), "DPST-1-3"),
    (frozenset({"szene", "scene"}), "DPST-17-1"),
    (frozenset({"fenster", "window", "tuer", "door", "kontakt", "contact"}), "DPST-1-19"),
    (frozenset({"praesenz", "presence", "bewegung", "motion"}), "DPST-1-18"),
    (frozenset({"zwang", "zwangsfuehrung"}), "DPST-2-1"),
    (frozenset({"betriebsart", "hvac", "modus", "mode"}), "DPST-20-102"),
    (
        frozenset(
            {"schalten", "schalt", "switching", "switch", "toggle", "ein", "aus", "on", "off"}
        ),
        "DPST-1-1",
    ),
)

FUNKTIONS_WOERTER = frozenset(
    {
        "licht",
        "light",
        "lights",
        "lampe",
        "lamp",
        "leuchte",
        "deckenleuchte",
        "wandleuchte",
        "spots",
        "led",
        "steckdose",
        "socket",
        "jalousie",
        "jalousien",
        "rollladen",
        "rollo",
        "raffstore",
        "markise",
        "blind",
        "blinds",
        "shutter",
        "rollershutter",
        "beschattung",
        "heizung",
        "heating",
        "heizen",
        "radiator",
        "fussbodenheizung",
        "lueftung",
        "ventilation",
        "klima",
        "decke",
        "ceiling",
        "wand",
        "wall",
        "zentral",
        "central",
        "gruppe",
        "group",
        "raum",
        "room",
        "haus",
        "house",
        "effect",
        "effekt",
        "desk",
        "schreibtisch",
        "lamelle",
        "slat",
    }
)

ETAGEN_WOERTER = frozenset(
    {
        "eg",
        "og",
        "ug",
        "dg",
        "kg",
        "erdgeschoss",
        "obergeschoss",
        "untergeschoss",
        "dachgeschoss",
        "kellergeschoss",
        "etage",
        "geschoss",
        "floor",
        "ground",
        "first",
        "second",
        "upper",
    }
)

BEKANNTE_WOERTER = (
    STATUS_WOERTER
    | EVENT_WOERTER
    | AKTIONS_WOERTER
    | MESSWERT_WOERTER
    | FUNKTIONS_WOERTER
    | ETAGEN_WOERTER
)

RAUM_PHRASEN: tuple[str, ...] = (
    "wohnzimmer",
    "living room",
    "wohnen",
    "kueche",
    "kitchen",
    "kochen",
    "schlafzimmer",
    "bedroom",
    "schlafen",
    "badezimmer",
    "bad",
    "bathroom",
    "dusche",
    "wc",
    "gaeste wc",
    "flur",
    "diele",
    "corridor",
    "hallway",
    "buero",
    "office",
    "arbeitszimmer",
    "kinderzimmer",
    "nursery",
    "kind",
    "esszimmer",
    "dining room",
    "essen",
    "keller",
    "basement",
    "dachboden",
    "attic",
    "garage",
    "terrasse",
    "terrace",
    "balkon",
    "balcony",
    "garten",
    "garden",
    "aussen",
    "outdoor",
    "hauswirtschaftsraum",
    "hwr",
    "waschkueche",
    "technikraum",
    "technik",
    "treppenhaus",
    "staircase",
    "eingang",
    "entrance",
    "abstellraum",
    "gast",
    "gaestezimmer",
    "eltern",
)


def erkenne_rolle(woerter: tuple[str, ...]) -> WotRolle | None:
    menge = set(woerter)
    if menge & STATUS_WOERTER:
        return WotRolle.PROPERTY
    if menge & EVENT_WOERTER or any("alarm" in wort for wort in woerter):
        return WotRolle.EVENT
    if menge & MEHRDEUTIGE_WOERTER:
        return None
    if menge & AKTIONS_WOERTER:
        return WotRolle.ACTION
    if menge & MESSWERT_WOERTER:
        return WotRolle.PROPERTY
    return None


def erkenne_dpt(woerter: tuple[str, ...]) -> str | None:
    menge = set(woerter)
    for schluessel, dpt_id in DPT_FALLBACK:
        if menge & schluessel:
            return dpt_id
    return None


AUSSER_BETRIEB = ("out of use", "ausser betrieb", "unbenutzt", "alt", "obsolet", "reserve")


def ist_ausser_betrieb(text: str) -> bool:
    """Erkennt stillgelegte Gruppen an ihrem Namenszusatz.

    Der Abgleich laeuft ueber Wortgrenzen, sonst faende "alt" auch
    "Schalten" und wuerde die haeufigste deutsche Mittelgruppe stilllegen.
    """
    woerter = f" {normalisiere(text)} "
    return any(f" {normalisiere(marker)} " in woerter for marker in AUSSER_BETRIEB)


MINDESTLAENGE_TEILNAME = 4


def erkenne_raum(text: str, kandidaten: tuple[str, ...]) -> str | None:
    treffer = [k for k in kandidaten if k and enthaelt_phrase(text, k)]
    if treffer:
        return max(treffer, key=lambda k: len(normalisiere(k)))
    return _erkenne_raum_teilname(text, kandidaten)


def _erkenne_raum_teilname(text: str, kandidaten: tuple[str, ...]) -> str | None:
    """Findet Raeume, deren Name mehrere Bezeichnungen buendelt ("Buero/ Flur")."""
    wortmenge = set(tokens(text))
    treffer = {
        kandidat
        for kandidat in kandidaten
        if kandidat
        and any(
            teil in wortmenge
            for teil in tokens(kandidat)
            if len(teil) >= MINDESTLAENGE_TEILNAME
        )
    }
    return treffer.pop() if len(treffer) == 1 else None


def erkenne_raum_lexikon(text: str) -> str | None:
    treffer = [p for p in RAUM_PHRASEN if enthaelt_phrase(text, p)]
    if treffer:
        return max(treffer, key=len)
    return None


STAMMFORMEN = {
    "schlafen": "schlaf",
    "wohnen": "wohn",
    "kochen": "koch",
    "essen": "ess",
    "arbeiten": "arbeit",
    "dusche": "dusch",
}


def strukturraum_zu(phrase: str, kandidaten: tuple[str, ...]) -> str | None:
    """Bildet ein Lexikonstichwort auf den passenden Raum der Gebaeudestruktur ab.

    "bad" wird so zu "Badezimmer", sofern die Struktur genau einen solchen Raum
    fuehrt. Damit gewinnt die Zuordnung den echten Raumnamen und braucht keine
    Rueckfrage mehr.
    """
    stichwort = normalisiere(phrase)
    stamm = STAMMFORMEN.get(stichwort, stichwort)
    treffer = {
        kandidat
        for kandidat in kandidaten
        if kandidat
        and any(
            wort == stichwort or wort.startswith(stichwort) or wort.startswith(stamm)
            for wort in tokens(kandidat)
        )
    }
    return treffer.pop() if len(treffer) == 1 else None


def unbekanntes_folgewort(text: str, phrase: str) -> str | None:
    """Liefert das Wort direkt hinter der Phrase, wenn es in keiner Wortliste steht.

    Faelle wie 'Buero Kurt' oder 'Buero 2' sollen eine Rueckfrage ausloesen
    statt einer halb geratenen Raumzuordnung.
    """
    woerter = tokens(text)
    phrasenwoerter = tokens(phrase)
    laenge = len(phrasenwoerter)
    for start in range(len(woerter) - laenge + 1):
        if tuple(woerter[start : start + laenge]) != phrasenwoerter:
            continue
        folgeposition = start + laenge
        if folgeposition >= len(woerter):
            return None
        folgewort = woerter[folgeposition]
        if folgewort not in BEKANNTE_WOERTER and RAUM_PHRASEN.count(folgewort) == 0:
            return folgewort
        return None
    return None
