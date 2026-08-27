"""KNXnet/IP-Anbindung ueber xknx.

Voreingestellt ist Tunneling, also eine Punkt-zu-Punkt-Verbindung zum
Interface. Routing bleibt waehlbar, laeuft aber ueber Multicast auf
224.0.23.12 und ist damit genau der Betriebsfall, den dieses Gateway
vermeiden soll.
"""

from __future__ import annotations

from enum import StrEnum

from xknx import XKNX
from xknx.io import ConnectionConfig, ConnectionType
from xknx.telegram import GroupAddress, Telegram
from xknx.telegram.apci import GroupValueRead, GroupValueResponse, GroupValueWrite

from ets2td.gateway.bus import Beobachter, Zwischenspeicher
from ets2td.gateway.kodierung import Nutzlast


class Anbindung(StrEnum):
    TUNNELING = "tunneling"
    TUNNELING_TCP = "tunneling-tcp"
    ROUTING = "routing"
    AUTOMATIK = "automatik"


UNICAST = (Anbindung.TUNNELING, Anbindung.TUNNELING_TCP)

_VERBINDUNGSART = {
    Anbindung.TUNNELING: ConnectionType.TUNNELING,
    Anbindung.TUNNELING_TCP: ConnectionType.TUNNELING_TCP,
    Anbindung.ROUTING: ConnectionType.ROUTING,
    Anbindung.AUTOMATIK: ConnectionType.AUTOMATIC,
}


class KnxBus:
    def __init__(
        self,
        anbindung: Anbindung = Anbindung.TUNNELING,
        gateway_ip: str | None = None,
        gateway_port: int = 3671,
        lokale_ip: str | None = None,
    ) -> None:
        self.anbindung = anbindung
        self.gateway_ip = gateway_ip
        self._speicher = Zwischenspeicher()
        self._xknx = XKNX(
            connection_config=ConnectionConfig(
                connection_type=_VERBINDUNGSART[anbindung],
                gateway_ip=gateway_ip,
                gateway_port=gateway_port,
                local_ip=lokale_ip,
            ),
            telegram_received_cb=self._telegramm,
        )

    @property
    def unicast(self) -> bool:
        return self.anbindung in UNICAST

    @property
    def beschreibung(self) -> str:
        ziel = self.gateway_ip or "automatisch gesucht"
        if self.anbindung is Anbindung.AUTOMATIK:
            art = "unicast bevorzugt, Multicast als Rueckfallebene"
        else:
            art = "unicast" if self.unicast else "multicast"
        return f"KNXnet/IP {self.anbindung.value} ({art}) ueber {ziel}"

    async def verbinden(self) -> None:
        await self._xknx.start()

    async def trennen(self) -> None:
        await self._xknx.stop()

    async def schreiben(self, ga: str, nutzlast: Nutzlast) -> None:
        await self._xknx.telegrams.put(
            Telegram(GroupAddress(ga), payload=GroupValueWrite(nutzlast))
        )

    async def lesen(self, ga: str, zeitgrenze: float) -> Nutzlast | None:
        zwischenstand = self._speicher.wert(ga)
        if zwischenstand is not None:
            return zwischenstand
        await self._xknx.telegrams.put(Telegram(GroupAddress(ga), payload=GroupValueRead()))
        return await self._speicher.naechster_wert(ga, zeitgrenze)

    def beobachten(self, rueckruf: Beobachter) -> None:
        self._speicher.beobachten(rueckruf)

    def _telegramm(self, telegram: Telegram) -> None:
        """xknx ruft diesen Rueckruf synchron auf, deshalb kein async."""
        nutzlast = telegram.payload
        if not isinstance(nutzlast, GroupValueWrite | GroupValueResponse):
            return
        if not isinstance(telegram.destination_address, GroupAddress):
            return
        self._speicher.melde(str(telegram.destination_address), nutzlast.value)


async def suche_schnittstellen(zeitgrenze: float = 4.0) -> list[str]:
    """Sucht KNXnet/IP-Schnittstellen im lokalen Netz.

    Nimmt dem Anwender die erste Huerde ab: ohne die IP des Interfaces
    laesst sich das Gateway nicht starten, und in der ETS steht sie nicht
    immer griffbereit.
    """
    from xknx.io import GatewayScanner

    scanner = GatewayScanner(XKNX(), timeout_in_seconds=zeitgrenze)
    zeilen = []
    for gefunden in await scanner.scan():
        wege = [
            name
            for name, kann in (
                ("tunneling", gefunden.supports_tunnelling),
                ("tunneling-tcp", gefunden.supports_tunnelling_tcp),
                ("routing", gefunden.supports_routing),
            )
            if kann
        ]
        adresse = gefunden.individual_address or "ohne Adresse"
        sicher = ", KNX Secure" if gefunden.supports_secure else ""
        zeilen.append(
            f"{gefunden.ip_addr}:{gefunden.port}  {gefunden.name}  "
            f"({adresse}, {' '.join(wege) or 'keine bekannte Betriebsart'}{sicher})"
        )
    return zeilen
