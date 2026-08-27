"""Erzeugt beispiele/musterprojekt-ets6.gold.json.

Der Gold-Standard ist eine manuelle Festlegung fuer genau dieses Projekt,
getroffen nach Durchsicht aller 194 Gruppenadressen im Zusammenhang mit der
Gebaeudestruktur. Er ist bewusst keine Heuristik: die Regeln unten benennen
Adressbereiche dieses Projekts, nicht allgemeine Namensmuster.

Grundsatz: bewertet wird nur, was aus dem Projekt heraus begruendbar ist.
Alles andere bleibt leer und damit unbewertet, statt geraten zu werden.

Raum: Zielwerte sind die Raumnamen der Gebaeudestruktur (Wohnzimmer,
Badezimmer, Gang, WC, Buero/ Flur, Ankleide, Kinderzimmer, Technikraum,
Schlafzimmer, Kueche). Gebaeudeweite Zentral-, Zeit-, Alarm- und
Diagnoseadressen bekommen keinen Raum. Ausseinbeleuchtung ebenfalls nicht,
weil die Gebaeudestruktur keinen Aussenbereich kennt.

Rolle: Kommando = action, Zustand und Rueckmeldung = property, spontane
Meldung mit Alarmcharakter = event.

DPT: nur dort gesetzt, wo er aus dem Projekt belegt ist (gepflegtes
DatapointType-Attribut) oder aus der KNX-Konvention zweifelsfrei folgt
(Schaltbefehl zur belegten Rueckmeldung, Prozentposition, Temperatur,
Uhrzeit, Datum). Rolladen-Kurzbefehle, Betriebsmodusbits, Fensterkontakte,
Szenen und Alarme bleiben offen, weil dort mehrere Subtypen ueblich sind.

Funktion: nur bei den durchnummerierten Objekten (Licht A bis T,
Rolladen 1 bis 8, Markise 9) und den benannten Leuchten gesetzt. Fuer
Heizung, Ueberwachung und Zentralfunktionen bleibt die Dimension leer, weil
das Projekt dort keine benannte Funktionseinheit fuehrt.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from ets2td.knxproj.leser import Gruppenadresse, formatiere_ga, lies_knxproj

ZIEL = Path(__file__).resolve().parent.parent / "beispiele/musterprojekt-ets6.gold.json"
QUELLE = Path(__file__).resolve().parent.parent / "beispiele/musterprojekt-ets6.knxproj"

MITTELGRUPPE_ZU_RAUM = {
    "Küche": "Küche",
    "Wohnzimmer": "Wohnzimmer",
    "Kinderzimmer": "Kinderzimmer",
    "Schlaf": "Schlafzimmer",
    "Schlafzimmer": "Schlafzimmer",
    "Schlafen": "Schlafzimmer",
    "Bad": "Badezimmer",
    "WC": "WC",
    "Flur": "Büro/ Flur",
}

NAME_ZU_RAUM = (
    ("ankleide", "Ankleide"),
    ("büro", "Büro/ Flur"),
    ("gang", "Gang"),
    ("wc", "WC"),
    ("bad", "Badezimmer"),
    ("küche", "Küche"),
    ("wohnzimmer", "Wohnzimmer"),
    ("kinderzimmer", "Kinderzimmer"),
    ("kind", "Kinderzimmer"),
    ("schlafzim", "Schlafzimmer"),
    ("flur", "Büro/ Flur"),
)

OHNE_RAUM_HAUPTGRUPPEN = ("Überwachung", "Sonderfunktionen")
OHNE_RAUM_MITTELGRUPPEN = ("Zentral", "Aussenanlage", "Licht")

# Raum aus dem Geraetestandort belegt, nicht aus dem Namen ableitbar.
# In der Mittelgruppe "Schlafen" liegen zwei gleichlautende Betriebsmodus-Saetze:
# 3/5/5 bis 3/5/7 sendet der Raumcontroller im Schlafzimmer, 3/5/8 bis 3/5/10 der
# Raumcontroller in der Ankleide (Geraetebeschreibung und loc:containsEquipment).
AUS_GERAETESTANDORT = {
    7429: "Schlafzimmer",
    7430: "Schlafzimmer",
    7431: "Schlafzimmer",
    7432: "Ankleide",
    7433: "Ankleide",
    7434: "Ankleide",
}

EVENT_NAMEN = (
    "alarm",
    "feuer",
    "störung",
    "ausgelöst",
    "überlast",
)

PROPERTY_NAMEN = (
    " rm",
    "status",
    "ist-temp",
    "in betrieb",
    "rück.",
    "fenster",
    "uhrzeit",
    "datum",
)


def raum_von(ga: Gruppenadresse) -> str:
    if ga.adresse in AUS_GERAETESTANDORT:
        return AUS_GERAETESTANDORT[ga.adresse]
    name = ga.name.lower().strip()
    treffer = [raum for teil, raum in NAME_ZU_RAUM if teil in name]
    if len(set(treffer)) > 1:
        return ""
    if treffer:
        return treffer[0]
    if ga.hauptgruppe in OHNE_RAUM_HAUPTGRUPPEN:
        return ""
    if ga.mittelgruppe in OHNE_RAUM_MITTELGRUPPEN:
        return ""
    return MITTELGRUPPE_ZU_RAUM.get(ga.mittelgruppe, "")


def rolle_von(ga: Gruppenadresse) -> str:
    name = ga.name.lower().strip()
    if any(wort in name for wort in EVENT_NAMEN):
        return "event"
    if any(wort in name for wort in PROPERTY_NAMEN) or name.endswith("rm"):
        return "property"
    return "action"


def dpt_von(ga: Gruppenadresse) -> str:
    if ga.dpt_id:
        return ga.dpt_id
    name = ga.name.lower().strip()
    if "position rm" in name:
        return "DPST-5-1"
    if "position" in name:
        return "DPST-5-1"
    if "ist-temp" in name or "soll-temp" in name or "sollwert" in name:
        return "DPST-9-1"
    if name == "uhrzeit":
        return "DPST-10-1"
    if name == "datum":
        return "DPST-11-1"
    if ga.hauptgruppe == "Licht" and "rm" not in name and "szene" not in name:
        return "DPST-1-1"
    if "lang" in name and ga.hauptgruppe == "Rolladen":
        return "DPST-1-8"
    return ""


def funktion_von(ga: Gruppenadresse) -> str:
    name = ga.name.strip()
    lichtbuchstabe = re.match(r"Licht ([A-Z])\b", name)
    if lichtbuchstabe:
        return f"Licht {lichtbuchstabe.group(1)}"
    rolladen = re.match(r"(Rolladen|Markiese|Markise) (\d+)", name)
    if rolladen:
        gewerk = "Markise" if rolladen.group(1).startswith("Mark") else "Rolladen"
        return f"{gewerk} {rolladen.group(2)}"
    for leuchte in ("Bad Decke", "Bad Spiegelschrank", "WC Decke", "WC Spiegelschrank"):
        if name.startswith(leuchte):
            return leuchte
    if name.startswith("Hintergrundbeleuchtung"):
        return "Hintergrundbeleuchtung"
    return ""


def main() -> int:
    projekt = lies_knxproj(QUELLE)
    datenpunkte: dict[str, dict[str, str]] = {}
    for ga in sorted(projekt.gruppenadressen.values(), key=lambda g: g.adresse):
        datenpunkte[str(ga.adresse)] = {
            "text": formatiere_ga(ga.adresse, projekt.ga_stil),
            "name": ga.name,
            "raum": raum_von(ga),
            "funktion": funktion_von(ga),
            "rolle": rolle_von(ga),
            "dpt": dpt_von(ga),
        }
    inhalt = {
        "projekt": projekt.name,
        "kommentar": (
            "Manuell festgelegter Gold-Standard fuer dieses Projekt, erzeugt von "
            "werkzeuge/gold_musterprojekt.py. Leere Werte sind bewusst unbewertet. "
            "Vor belastbaren Aussagen vom Projektverantwortlichen pruefen lassen."
        ),
        "datenpunkte": datenpunkte,
    }
    ZIEL.write_text(
        json.dumps(inhalt, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    bewertet = {
        dimension: sum(1 for e in datenpunkte.values() if e[dimension])
        for dimension in ("raum", "funktion", "rolle", "dpt")
    }
    print(f"{len(datenpunkte)} Datenpunkte nach {ZIEL.name}; bewertet: {bewertet}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
