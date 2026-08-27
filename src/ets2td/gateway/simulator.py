"""Bus ohne Bus.

Der Simulator beantwortet Lesevorgaenge aus einer Startbelegung und meldet
jeden Schreibvorgang als Aenderung zurueck, so wie es ein Aktor mit
Rueckmeldeobjekt taete. Er ist deterministisch: gleiche Aufrufe, gleiche
Werte, keine Zeitabhaengigkeit.
"""

from __future__ import annotations

from ets2td.gateway.bus import Beobachter, Zwischenspeicher
from ets2td.gateway.kodierung import Nutzlast


class SimulierterBus:
    def __init__(self, startwerte: dict[str, Nutzlast] | None = None) -> None:
        self._speicher = Zwischenspeicher()
        self.geschrieben: list[tuple[str, Nutzlast]] = []
        self.gelesen: list[str] = []
        for ga, nutzlast in (startwerte or {}).items():
            self._speicher.melde(ga, nutzlast)

    @property
    def beschreibung(self) -> str:
        return "Simulator (kein Bus)"

    async def verbinden(self) -> None:
        return None

    async def trennen(self) -> None:
        return None

    async def schreiben(self, ga: str, nutzlast: Nutzlast) -> None:
        self.geschrieben.append((ga, nutzlast))
        self._speicher.melde(ga, nutzlast)

    async def lesen(self, ga: str, zeitgrenze: float) -> Nutzlast | None:
        self.gelesen.append(ga)
        return self._speicher.wert(ga)

    def beobachten(self, rueckruf: Beobachter) -> None:
        self._speicher.beobachten(rueckruf)

    def melde_von_aussen(self, ga: str, nutzlast: Nutzlast) -> None:
        """Spielt ein Telegramm ein, das ein Geraet von sich aus gesendet haette."""
        self._speicher.melde(ga, nutzlast)
