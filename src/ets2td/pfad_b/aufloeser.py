from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol

from ets2td.modell import Quelle, Rueckfrage, Zuordnung


@dataclass(frozen=True)
class NamensAnfrage:
    ga_text: str
    name: str
    beschreibung: str
    hauptgruppe: str
    mittelgruppe: str
    raum_kandidaten: tuple[str, ...]
    fehlende_dimensionen: tuple[str, ...]


@dataclass(frozen=True)
class NamensAntwort:
    zuordnungen: Mapping[str, Zuordnung] = field(default_factory=dict)
    rueckfrage: Rueckfrage | None = None


class NameResolver(Protocol):
    def aufloesen(self, anfrage: NamensAnfrage) -> NamensAntwort: ...


def standard_rueckfrage(anfrage: NamensAnfrage) -> Rueckfrage:
    kontext = ", ".join(
        teil
        for teil in (
            f"Hauptgruppe '{anfrage.hauptgruppe}'" if anfrage.hauptgruppe else "",
            f"Mittelgruppe '{anfrage.mittelgruppe}'" if anfrage.mittelgruppe else "",
            f"Beschreibung '{anfrage.beschreibung}'" if anfrage.beschreibung else "",
        )
        if teil
    )
    frage = (
        f"Die Gruppenadresse {anfrage.ga_text} '{anfrage.name}' ließ sich nicht auflösen"
        + (f" ({kontext})" if kontext else "")
        + ". Fehlend: "
        + ", ".join(anfrage.fehlende_dimensionen)
        + "."
    )
    return Rueckfrage(
        ga_text=anfrage.ga_text,
        name=anfrage.name,
        fehlende_dimensionen=anfrage.fehlende_dimensionen,
        frage=frage,
        vorschlaege=anfrage.raum_kandidaten[:3] if "raum" in anfrage.fehlende_dimensionen else (),
    )


class KeinResolver:
    def aufloesen(self, anfrage: NamensAnfrage) -> NamensAntwort:
        return NamensAntwort(rueckfrage=standard_rueckfrage(anfrage))


class FakeResolver:
    """Deterministischer Ersatz fuer den LLM-Schritt in Tests.

    Die Tabelle bildet den normalisierten GA-Namen auf Dimensionswerte ab.
    Unbekannte Namen ergeben eine Rueckfrage, niemals eine erfundene Zuordnung.
    """

    def __init__(self, tabelle: Mapping[str, Mapping[str, str]], konfidenz: float = 0.85):
        self._tabelle = {schluessel.lower(): dict(werte) for schluessel, werte in tabelle.items()}
        self._konfidenz = konfidenz

    def aufloesen(self, anfrage: NamensAnfrage) -> NamensAntwort:
        eintrag = self._tabelle.get(anfrage.name.lower())
        if eintrag is None:
            return NamensAntwort(rueckfrage=standard_rueckfrage(anfrage))
        zuordnungen = {
            dimension: Zuordnung(wert=wert, quelle=Quelle.LLM, konfidenz=self._konfidenz)
            for dimension, wert in eintrag.items()
            if dimension in anfrage.fehlende_dimensionen
        }
        offen = tuple(d for d in anfrage.fehlende_dimensionen if d not in zuordnungen)
        rueckfrage = None
        if offen:
            reduziert = NamensAnfrage(
                ga_text=anfrage.ga_text,
                name=anfrage.name,
                beschreibung=anfrage.beschreibung,
                hauptgruppe=anfrage.hauptgruppe,
                mittelgruppe=anfrage.mittelgruppe,
                raum_kandidaten=anfrage.raum_kandidaten,
                fehlende_dimensionen=offen,
            )
            rueckfrage = standard_rueckfrage(reduziert)
        return NamensAntwort(zuordnungen=zuordnungen, rueckfrage=rueckfrage)
