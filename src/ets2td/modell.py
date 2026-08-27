from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

DIMENSIONEN = ("raum", "funktion", "rolle", "dpt")


class WotRolle(StrEnum):
    PROPERTY = "property"
    ACTION = "action"
    EVENT = "event"


class Quelle(StrEnum):
    ETS_SEMANTIK = "ets-semantik"
    SEMANTIK_ZUGRIFF = "semantik-zugriff"
    SEMANTIK_GERAETEKETTE = "semantik-geraetekette"
    SEMANTIK_KOMMOBJEKT = "semantik-kommobjekt"
    ETS_FUNKTION = "ets-funktion"
    ETS_ATTRIBUT = "ets-attribut"
    GEBAEUDESTRUKTUR = "gebaeudestruktur"
    GA_HIERARCHIE = "ga-hierarchie"
    NAMENSLEXIKON = "namenslexikon"
    LLM = "llm"


@dataclass(frozen=True)
class Zuordnung:
    wert: str
    quelle: Quelle
    konfidenz: float


@dataclass
class Datenpunkt:
    ga: int
    ga_text: str
    name: str
    beschreibung: str = ""
    hauptgruppe: str = ""
    mittelgruppe: str = ""
    knx_rolle: str = ""
    zentral: bool = False
    lesbar: bool | None = None
    schreibbar: bool | None = None
    dpt: Zuordnung | None = None
    raum: Zuordnung | None = None
    funktion: Zuordnung | None = None
    rolle: Zuordnung | None = None

    def zuordnung(self, dimension: str) -> Zuordnung | None:
        wert: Zuordnung | None = getattr(self, dimension)
        return wert


@dataclass(frozen=True)
class Rueckfrage:
    ga_text: str
    name: str
    fehlende_dimensionen: tuple[str, ...]
    frage: str
    vorschlaege: tuple[str, ...] = ()


@dataclass
class PfadErgebnis:
    pfad: str
    projekt: str
    datenpunkte: list[Datenpunkt] = field(default_factory=list)
    rueckfragen: list[Rueckfrage] = field(default_factory=list)
    hinweise: list[str] = field(default_factory=list)
