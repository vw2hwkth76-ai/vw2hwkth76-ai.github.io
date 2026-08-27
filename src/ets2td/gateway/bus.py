"""Busabstraktion des Gateways.

Das Gateway kennt nur dieses Protokoll. Ob dahinter ein KNXnet/IP-Interface
oder der Simulator steht, entscheidet der Aufruf. Damit laufen alle Tests
ohne Netzwerk, und die Vorfuehrung braucht keine Hardware.

Gelesen wird aus einem Zwischenspeicher: das Gateway hoert alle
Gruppentelegramme mit und merkt sich den letzten Wert je Adresse. Ein GET
ohne vorherigen Buslauf stoesst zusaetzlich ein GroupValueRead an, denn
nicht jede Adresse sendet von sich aus.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Protocol

from ets2td.gateway.kodierung import Nutzlast

Beobachter = Callable[[str, Nutzlast], None]


class BusVerbindung(Protocol):
    async def verbinden(self) -> None: ...

    async def trennen(self) -> None: ...

    async def schreiben(self, ga: str, nutzlast: Nutzlast) -> None: ...

    async def lesen(self, ga: str, zeitgrenze: float) -> Nutzlast | None: ...

    def beobachten(self, rueckruf: Beobachter) -> None: ...

    @property
    def beschreibung(self) -> str: ...


class Zwischenspeicher:
    """Haelt den zuletzt gesehenen Wert je Gruppenadresse."""

    def __init__(self) -> None:
        self._werte: dict[str, Nutzlast] = {}
        self._warten: dict[str, list[asyncio.Future[Nutzlast]]] = {}
        self._beobachter: list[Beobachter] = []

    def wert(self, ga: str) -> Nutzlast | None:
        return self._werte.get(ga)

    def beobachten(self, rueckruf: Beobachter) -> None:
        self._beobachter.append(rueckruf)

    def melde(self, ga: str, nutzlast: Nutzlast) -> None:
        self._werte[ga] = nutzlast
        for wartender in self._warten.pop(ga, []):
            if not wartender.done():
                wartender.set_result(nutzlast)
        for rueckruf in list(self._beobachter):
            rueckruf(ga, nutzlast)

    async def naechster_wert(self, ga: str, zeitgrenze: float) -> Nutzlast | None:
        wartender: asyncio.Future[Nutzlast] = asyncio.get_running_loop().create_future()
        self._warten.setdefault(ga, []).append(wartender)
        try:
            return await asyncio.wait_for(wartender, zeitgrenze)
        except TimeoutError:
            return None
        finally:
            offen = self._warten.get(ga)
            if offen and wartender in offen:
                offen.remove(wartender)
