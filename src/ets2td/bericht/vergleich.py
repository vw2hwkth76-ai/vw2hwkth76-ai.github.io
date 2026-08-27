from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from ets2td.modell import DIMENSIONEN, PfadErgebnis
from ets2td.pfad_b.lexikon import normalisiere


@dataclass(frozen=True)
class GoldEintrag:
    raum: str = ""
    funktion: str = ""
    rolle: str = ""
    dpt: str = ""

    def wert(self, dimension: str) -> str:
        wert: str = getattr(self, dimension)
        return wert


def lade_gold(pfad: Path) -> dict[int, GoldEintrag]:
    daten = json.loads(pfad.read_text(encoding="utf-8"))
    eintraege: dict[int, GoldEintrag] = {}
    for schluessel, werte in daten["datenpunkte"].items():
        eintraege[int(schluessel)] = GoldEintrag(
            raum=werte.get("raum", ""),
            funktion=werte.get("funktion", ""),
            rolle=werte.get("rolle", ""),
            dpt=werte.get("dpt", ""),
        )
    return eintraege


@dataclass(frozen=True)
class Fehlerfall:
    ga_text: str
    name: str
    dimension: str
    erwartet: str
    erhalten: str
    quelle: str

    @property
    def klasse(self) -> str:
        if not self.erhalten:
            return f"{self.dimension}: nicht zugeordnet"
        return f"{self.dimension}: falsch aus {self.quelle}"


@dataclass
class DimensionsBilanz:
    bewertet: int = 0
    korrekt: int = 0
    halbtreffer: int = 0
    falsch: int = 0
    fehlend: int = 0

    @property
    def quote(self) -> float:
        return self.korrekt / self.bewertet if self.bewertet else 0.0


@dataclass
class PfadBilanz:
    pfad: str
    projekt: str
    datenpunkte: int
    rueckfragen: int
    abdeckung: dict[str, int] = field(default_factory=dict)
    bilanzen: dict[str, DimensionsBilanz] = field(default_factory=dict)
    fehler: list[Fehlerfall] = field(default_factory=list)
    quellen: dict[str, dict[str, int]] = field(default_factory=dict)
    hinweise: list[str] = field(default_factory=list)

    @property
    def fehlerklassen(self) -> dict[str, int]:
        klassen: dict[str, int] = {}
        for fehler in self.fehler:
            klassen[fehler.klasse] = klassen.get(fehler.klasse, 0) + 1
        for dimension, bilanz in self.bilanzen.items():
            if bilanz.fehlend:
                schluessel = f"{dimension}: nicht zugeordnet"
                klassen[schluessel] = klassen.get(schluessel, 0) + bilanz.fehlend
        return dict(sorted(klassen.items(), key=lambda eintrag: -eintrag[1]))


def dpt_haupttyp(dpt_id: str) -> str:
    teile = dpt_id.split("-")
    if len(teile) >= 2 and teile[0] in ("DPT", "DPST"):
        return f"DPT-{teile[1]}"
    return dpt_id


def _gleich(dimension: str, erwartet: str, erhalten: str) -> bool:
    if dimension == "dpt":
        return erwartet.strip().upper() == erhalten.strip().upper()
    return normalisiere(erwartet) == normalisiere(erhalten)


def _teiltreffer(dimension: str, erwartet: str, erhalten: str) -> bool:
    """Erkennt fachlich gleichwertige, unterschiedlich formulierte Zuordnungen.

    Der DPT-Haupttyp zaehlt als Teiltreffer, weil der Subtyp nur die Skalierung
    praezisiert. Bei der Funktion zaehlt eine Teilbezeichnung ("Decke" statt
    "Bad Decke"), weil es fuer Funktionsnamen keine normierte Schreibweise gibt.
    """
    if dimension == "dpt":
        return dpt_haupttyp(erwartet) == dpt_haupttyp(erhalten)
    if dimension == "funktion":
        links, rechts = normalisiere(erwartet), normalisiere(erhalten)
        return bool(links) and bool(rechts) and (links in rechts or rechts in links)
    return False


def vergleiche(ergebnis: PfadErgebnis, gold: dict[int, GoldEintrag] | None) -> PfadBilanz:
    bilanz = PfadBilanz(
        pfad=ergebnis.pfad,
        projekt=ergebnis.projekt,
        datenpunkte=len(ergebnis.datenpunkte),
        rueckfragen=len(ergebnis.rueckfragen),
        hinweise=list(ergebnis.hinweise),
    )
    for dimension in DIMENSIONEN:
        bilanz.abdeckung[dimension] = 0
        bilanz.bilanzen[dimension] = DimensionsBilanz()
        bilanz.quellen[dimension] = {}

    for punkt in ergebnis.datenpunkte:
        eintrag = gold.get(punkt.ga) if gold is not None else None
        for dimension in DIMENSIONEN:
            zuordnung = punkt.zuordnung(dimension)
            if zuordnung is not None:
                bilanz.abdeckung[dimension] += 1
                quellen = bilanz.quellen[dimension]
                quellen[zuordnung.quelle.value] = quellen.get(zuordnung.quelle.value, 0) + 1
            if eintrag is None:
                continue
            erwartet = eintrag.wert(dimension)
            if not erwartet:
                continue
            dim_bilanz = bilanz.bilanzen[dimension]
            dim_bilanz.bewertet += 1
            if zuordnung is None:
                dim_bilanz.fehlend += 1
                continue
            if _gleich(dimension, erwartet, zuordnung.wert):
                dim_bilanz.korrekt += 1
            elif _teiltreffer(dimension, erwartet, zuordnung.wert):
                dim_bilanz.halbtreffer += 1
            else:
                dim_bilanz.falsch += 1
                bilanz.fehler.append(
                    Fehlerfall(
                        punkt.ga_text,
                        punkt.name,
                        dimension,
                        erwartet,
                        zuordnung.wert,
                        zuordnung.quelle.value,
                    )
                )
    return bilanz
