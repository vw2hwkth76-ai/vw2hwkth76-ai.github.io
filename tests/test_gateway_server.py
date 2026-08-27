"""Prueft die CoAP-Ressourcen ohne Netzwerk.

Die Handler werden direkt aufgerufen. Damit braucht die Testsuite weder
Socket noch Bus, und die Regeln bleiben trotzdem einzeln nachgewiesen.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("aiocoap", reason="Gateway-Extra nicht installiert")
pytest.importorskip("cbor2", reason="Gateway-Extra nicht installiert")

import cbor2
from aiocoap import Message
from aiocoap.numbers.codes import Code
from aiocoap.numbers.contentformat import ContentFormat

from ets2td.gateway.kodierung import kodierer_fuer
from ets2td.gateway.ressourcen import bilde_ab
from ets2td.gateway.server import AffordanzRessource, Gateway
from ets2td.gateway.simulator import SimulierterBus
from ets2td.gateway.startwerte import startbelegung

BASIS = "coap://127.0.0.1:5683"


def td_vorlage() -> dict[str, Any]:
    return {
        "@context": ["https://www.w3.org/2022/wot/td/v1.1"],
        "title": "Wohnzimmer",
        "securityDefinitions": {"nosec_sc": {"scheme": "nosec"}},
        "security": "nosec_sc",
        "properties": {
            "position": {
                "title": "Rolladen",
                "type": "number",
                "unit": "%",
                "minimum": 0,
                "maximum": 100,
                "observable": True,
                "forms": [
                    {
                        "href": "knx://2/0/16",
                        "op": ["readproperty", "writeproperty", "observeproperty"],
                    }
                ],
                "ets2td:gruppenadresse": "2/0/16",
                "ets2td:dpt": "DPST-5-1",
            },
            "rueckmeldung": {
                "title": "Rolladen RM",
                "type": "number",
                "readOnly": True,
                "forms": [{"href": "knx://2/0/17", "op": ["readproperty", "observeproperty"]}],
                "ets2td:gruppenadresse": "2/0/17",
                "ets2td:dpt": "DPST-5-1",
            },
            "ohne_dpt": {
                "title": "Unbekannt",
                "forms": [{"href": "knx://2/0/18", "op": ["readproperty", "writeproperty"]}],
                "ets2td:gruppenadresse": "2/0/18",
            },
        },
        "actions": {
            "schalten": {
                "title": "Schalten",
                "input": {"type": "boolean"},
                "forms": [{"href": "knx://1/1/1", "op": ["invokeaction"]}],
                "ets2td:gruppenadresse": "1/1/1",
                "ets2td:dpt": "DPST-1-1",
            }
        },
    }


@pytest.fixture
def aufbau() -> tuple[Gateway, SimulierterBus]:
    abbildung = bilde_ab(td_vorlage(), BASIS)
    bus = SimulierterBus(startbelegung(abbildung))
    return Gateway(abbildung, bus), bus


def lauf(aufgabe: Any) -> Any:
    return asyncio.run(aufgabe)


def hole(gateway: Gateway, *pfad: str) -> AffordanzRessource:
    return gateway.ressourcen[pfad]


def _horche(gateway: Gateway) -> list[str]:
    """Ersetzt die Observe-Meldung durch ein Protokoll der betroffenen Pfade."""
    gemeldet: list[str] = []

    def merker(name: str) -> Callable[[], None]:
        return lambda: gemeldet.append(name)

    for pfad, ressource in gateway.ressourcen.items():
        ressource.melde_aenderung = merker("/".join(pfad))  # type: ignore[method-assign]
    return gemeldet


def test_get_liefert_wert_einheit_und_rohbytes(aufbau: tuple[Gateway, SimulierterBus]) -> None:
    gateway, bus = aufbau
    kodierer = kodierer_fuer("DPST-5-1")
    assert kodierer is not None
    bus.melde_von_aussen("2/0/17", kodierer.nach_knx(75))
    antwort = lauf(hole(gateway, "properties", "rueckmeldung").render_get(Message(code=Code.GET)))
    assert antwort.code == Code.CONTENT
    inhalt = json.loads(antwort.payload)
    assert inhalt == {"bekannt": True, "roh": [191], "wert": 75, "einheit": "%"}


def test_put_schreibt_den_kodierten_wert_auf_den_bus(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "properties", "position").render_put(
            Message(code=Code.PUT, payload=b'{"wert": 50}')
        )
    )
    assert antwort.code == Code.CHANGED
    ga, nutzlast = bus.geschrieben[-1]
    kodierer = kodierer_fuer("DPST-5-1")
    assert kodierer is not None
    assert (ga, kodierer.aus_knx(nutzlast)) == ("2/0/16", 50)


def test_put_nimmt_auch_den_nackten_wert_an(aufbau: tuple[Gateway, SimulierterBus]) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "properties", "position").render_put(Message(code=Code.PUT, payload=b"50"))
    )
    assert antwort.code == Code.CHANGED
    assert bus.geschrieben[-1][0] == "2/0/16"


def test_post_loest_die_action_aus(aufbau: tuple[Gateway, SimulierterBus]) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "actions", "schalten").render_post(
            Message(code=Code.POST, payload=b'{"wert": true}')
        )
    )
    assert antwort.code == Code.CHANGED
    kodierer = kodierer_fuer("DPST-1-1")
    assert kodierer is not None
    assert kodierer.aus_knx(bus.geschrieben[-1][1]) is True


def test_put_auf_nur_lesbare_property_wird_abgewiesen(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "properties", "rueckmeldung").render_put(
            Message(code=Code.PUT, payload=b'{"wert": 10}')
        )
    )
    assert antwort.code == Code.METHOD_NOT_ALLOWED
    assert bus.geschrieben == []


def test_post_auf_eine_property_wird_abgewiesen(aufbau: tuple[Gateway, SimulierterBus]) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "properties", "position").render_post(
            Message(code=Code.POST, payload=b'{"wert": 10}')
        )
    )
    assert antwort.code == Code.METHOD_NOT_ALLOWED
    assert bus.geschrieben == []


def test_unpassender_wert_erreicht_den_bus_nicht(aufbau: tuple[Gateway, SimulierterBus]) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "properties", "position").render_put(
            Message(code=Code.PUT, payload=b'{"wert": 500}')
        )
    )
    assert antwort.code == Code.BAD_REQUEST
    assert bus.geschrieben == []


def test_kaputte_nutzlast_erreicht_den_bus_nicht(aufbau: tuple[Gateway, SimulierterBus]) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "properties", "position").render_put(
            Message(code=Code.PUT, payload=b"{kein json")
        )
    )
    assert antwort.code == Code.BAD_REQUEST
    assert bus.geschrieben == []


def test_ohne_datenpunkttyp_wird_nichts_geschrieben(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "properties", "ohne_dpt").render_put(
            Message(code=Code.PUT, payload=b'{"wert": true}')
        )
    )
    assert antwort.code == Code.BAD_REQUEST
    assert b"Datenpunkttyp" in antwort.payload
    assert bus.geschrieben == []


def test_ohne_datenpunkttyp_meldet_get_nur_rohbytes(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, bus = aufbau
    kodierer = kodierer_fuer("DPST-1-1")
    assert kodierer is not None
    bus.melde_von_aussen("2/0/18", kodierer.nach_knx(True))
    antwort = lauf(hole(gateway, "properties", "ohne_dpt").render_get(Message(code=Code.GET)))
    inhalt = json.loads(antwort.payload)
    assert inhalt["roh"] == [1]
    assert inhalt["wert"] is None
    assert "hinweis" in inhalt


def test_adresse_ohne_bislang_gesehenen_wert_meldet_unbekannt(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, _ = aufbau
    antwort = lauf(hole(gateway, "properties", "ohne_dpt").render_get(Message(code=Code.GET)))
    assert antwort.code == Code.CONTENT
    assert json.loads(antwort.payload) == {"wert": None, "bekannt": False}


def test_accept_cbor_liefert_cbor(aufbau: tuple[Gateway, SimulierterBus]) -> None:
    gateway, _ = aufbau
    antwort = lauf(
        hole(gateway, "properties", "position").render_get(
            Message(code=Code.GET, accept=ContentFormat.CBOR)
        )
    )
    assert antwort.opt.content_format == ContentFormat.CBOR
    assert cbor2.loads(antwort.payload)["wert"] == 0


def test_cbor_nutzlast_wird_beim_schreiben_gelesen(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, bus = aufbau
    antwort = lauf(
        hole(gateway, "properties", "position").render_put(
            Message(
                code=Code.PUT,
                payload=bytes(cbor2.dumps({"wert": 25})),
                content_format=ContentFormat.CBOR,
            )
        )
    )
    assert antwort.code == Code.CHANGED
    kodierer = kodierer_fuer("DPST-5-1")
    assert kodierer is not None
    assert kodierer.aus_knx(bus.geschrieben[-1][1]) == 25


def test_unbekanntes_accept_wird_abgelehnt(aufbau: tuple[Gateway, SimulierterBus]) -> None:
    gateway, _ = aufbau
    antwort = lauf(
        hole(gateway, "properties", "position").render_get(
            Message(code=Code.GET, accept=ContentFormat.TEXT)
        )
    )
    assert antwort.code == Code.NOT_ACCEPTABLE


def test_thing_wird_unter_well_known_ausgeliefert(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, _ = aufbau
    antwort = lauf(gateway.thing_ressource.render_get(Message(code=Code.GET)))
    assert json.loads(antwort.payload)["title"] == "Wohnzimmer"


def test_bustelegramm_meldet_die_beobachtete_ressource(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, bus = aufbau
    gemeldet = _horche(gateway)
    kodierer = kodierer_fuer("DPST-5-1")
    assert kodierer is not None
    bus.melde_von_aussen("2/0/17", kodierer.nach_knx(30))
    assert gemeldet == ["properties/rueckmeldung"]


def test_nicht_beobachtbare_ressource_meldet_nichts(
    aufbau: tuple[Gateway, SimulierterBus],
) -> None:
    gateway, bus = aufbau
    gemeldet = _horche(gateway)
    kodierer = kodierer_fuer("DPST-1-1")
    assert kodierer is not None
    bus.melde_von_aussen("1/1/1", kodierer.nach_knx(True))
    assert gemeldet == []


def test_startbelegung_setzt_nur_belegte_datenpunkttypen() -> None:
    abbildung = bilde_ab(td_vorlage(), BASIS)
    belegung = startbelegung(abbildung)
    assert set(belegung) == {"2/0/16", "2/0/17"}


def test_startbelegung_bevorzugt_null_im_wertebereich() -> None:
    abbildung = bilde_ab(td_vorlage(), BASIS)
    kodierer = kodierer_fuer("DPST-5-1")
    assert kodierer is not None
    assert kodierer.aus_knx(startbelegung(abbildung)["2/0/16"]) == 0
