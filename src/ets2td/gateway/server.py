"""CoAP-Server, der die Thing Description bedienbar macht.

Jede Affordanz wird eine Ressource: GET liest, PUT schreibt, POST loest aus,
GET mit Observe-Option meldet Aenderungen. Die Nutzlast ist JSON oder CBOR,
ausgewaehlt ueber die Accept-Option. Der Ressourcenbaum entsteht in
ressourcen.py und wird hier nur ans Netz gehaengt.
"""

from __future__ import annotations

import json
from typing import Any

import cbor2
from aiocoap import Context, Message
from aiocoap.numbers.codes import Code
from aiocoap.numbers.contentformat import ContentFormat
from aiocoap.resource import ObservableResource, Resource, Site

from ets2td.gateway.bus import BusVerbindung
from ets2td.gateway.kodierung import Kodierer, KodierFehler, Nutzlast, kodierer_fuer, rohbytes
from ets2td.gateway.ressourcen import CBOR_FORMAT, JSON_FORMAT, TD_PFAD, Abbildung, Ressource

LESE_ZEITGRENZE = 3.0


def _packe(wert: Any, format_: ContentFormat) -> bytes:
    if format_ == ContentFormat.CBOR:
        return bytes(cbor2.dumps(wert))
    return json.dumps(wert, ensure_ascii=False).encode("utf-8")


def _entpacke(nutzlast: bytes, format_: ContentFormat | None) -> Any:
    if format_ == ContentFormat.CBOR:
        return cbor2.loads(nutzlast)
    return json.loads(nutzlast.decode("utf-8"))


def _gewuenschtes_format(anfrage: Message) -> ContentFormat | None:
    """Waehlt das Antwortformat. Ein unbekanntes Accept fuehrt zu None."""
    akzeptiert = anfrage.opt.accept
    if akzeptiert is None:
        return ContentFormat.JSON
    if int(akzeptiert) == CBOR_FORMAT:
        return ContentFormat.CBOR
    if int(akzeptiert) == JSON_FORMAT:
        return ContentFormat.JSON
    return None


class AffordanzRessource(ObservableResource):
    def __init__(self, ressource: Ressource, bus: BusVerbindung) -> None:
        super().__init__()
        self.ressource = ressource
        self.bus = bus
        self.kodierer: Kodierer | None = kodierer_fuer(ressource.dpt)

    def melde_aenderung(self) -> None:
        self.updated_state()

    def darstellen(self, nutzlast: Nutzlast | None) -> dict[str, Any]:
        if nutzlast is None:
            return {"wert": None, "bekannt": False}
        antwort: dict[str, Any] = {"bekannt": True, "roh": rohbytes(nutzlast)}
        if self.kodierer is not None:
            antwort["wert"] = self.kodierer.aus_knx(nutzlast)
            if self.kodierer.einheit:
                antwort["einheit"] = self.kodierer.einheit
        else:
            antwort["wert"] = None
            antwort["hinweis"] = "ohne belegten Datenpunkttyp nur Rohbytes"
        return antwort

    def _nach_knx(self, wert: Any) -> Nutzlast:
        if self.kodierer is None:
            raise KodierFehler(
                f"{'/'.join(self.ressource.pfad)} hat keinen belegten Datenpunkttyp; "
                "ohne DPT wird nichts auf den Bus geschrieben"
            )
        return self.kodierer.nach_knx(wert)

    async def render_get(self, request: Message) -> Message:
        if not self.ressource.lesbar:
            return Message(code=Code.METHOD_NOT_ALLOWED)
        format_ = _gewuenschtes_format(request)
        if format_ is None:
            return Message(code=Code.NOT_ACCEPTABLE)
        nutzlast = await self.bus.lesen(self.ressource.ga, LESE_ZEITGRENZE)
        try:
            inhalt = self.darstellen(nutzlast)
        except KodierFehler as fehler:
            return Message(code=Code.INTERNAL_SERVER_ERROR, payload=str(fehler).encode("utf-8"))
        return Message(code=Code.CONTENT, payload=_packe(inhalt, format_), content_format=format_)

    async def render_put(self, request: Message) -> Message:
        if "writeproperty" not in self.ressource.operationen:
            return Message(code=Code.METHOD_NOT_ALLOWED)
        return await self._schreibe(request, Code.CHANGED)

    async def render_post(self, request: Message) -> Message:
        if "invokeaction" not in self.ressource.operationen:
            return Message(code=Code.METHOD_NOT_ALLOWED)
        return await self._schreibe(request, Code.CHANGED)

    async def _schreibe(self, request: Message, erfolg: Code) -> Message:
        eingang = request.opt.content_format
        format_ = ContentFormat.CBOR if eingang == ContentFormat.CBOR else ContentFormat.JSON
        try:
            roh = _entpacke(request.payload, format_)
        except Exception as fehler:
            return Message(
                code=Code.BAD_REQUEST, payload=f"Nutzlast unlesbar: {fehler}".encode()
            )
        wert = roh.get("wert") if isinstance(roh, dict) and "wert" in roh else roh
        try:
            nutzlast = self._nach_knx(wert)
        except KodierFehler as fehler:
            return Message(code=Code.BAD_REQUEST, payload=str(fehler).encode("utf-8"))
        await self.bus.schreiben(self.ressource.ga, nutzlast)
        return Message(code=erfolg)


class ThingRessource(Resource):
    def __init__(self, thing: dict[str, Any]) -> None:
        super().__init__()
        self.thing = thing

    async def render_get(self, request: Message) -> Message:
        format_ = _gewuenschtes_format(request)
        if format_ is None:
            return Message(code=Code.NOT_ACCEPTABLE)
        return Message(
            code=Code.CONTENT, payload=_packe(self.thing, format_), content_format=format_
        )


class Gateway:
    def __init__(self, abbildung: Abbildung, bus: BusVerbindung) -> None:
        self.abbildung = abbildung
        self.bus = bus
        self.site = Site()
        self.ressourcen: dict[tuple[str, ...], AffordanzRessource] = {}
        self.thing_ressource = ThingRessource(abbildung.thing)
        self.site.add_resource(tuple(TD_PFAD.split("/")), self.thing_ressource)
        for beschreibung in abbildung.ressourcen:
            ressource = AffordanzRessource(beschreibung, bus)
            self.ressourcen[beschreibung.pfad] = ressource
            self.site.add_resource(beschreibung.pfad, ressource)
        bus.beobachten(self._bus_meldung)

    def _bus_meldung(self, ga: str, nutzlast: Nutzlast) -> None:
        for ressource in self.ressourcen.values():
            if ressource.ressource.ga == ga and ressource.ressource.beobachtbar:
                ressource.melde_aenderung()

    async def starten(self, bind: tuple[str, int]) -> Context:
        await self.bus.verbinden()
        return await Context.create_server_context(self.site, bind=bind)
