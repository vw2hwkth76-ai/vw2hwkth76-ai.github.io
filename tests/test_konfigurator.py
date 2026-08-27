from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from conftest import BEISPIELE

from ets2td.knxproj.leser import KnxProjekt
from ets2td.konfigurator.bundle import baue_bundle, schreibe_bundle
from ets2td.konfigurator.parameter import (
    OPERATIONEN,
    PARAMETER,
    TD_DATENTYPEN,
    parameter_je_seite,
)
from ets2td.konfigurator.vorbelegung import (
    aufzaehlung_fuer,
    semantischer_typ,
    vorbelegung,
    wertebereich_text,
)
from ets2td.modell import Datenpunkt, PfadErgebnis, Quelle, WotRolle, Zuordnung
from ets2td.pfad_b.ableitung import leite_ab

TD_SCHEMA = (
    Path(__file__).resolve().parent.parent
    / "validator/node_modules/@thing-description-playground/core/td-schema.json"
)


def _punkt(name: str, dpt: str = "", rolle: str = "property", knx_rolle: str = "") -> Datenpunkt:
    punkt = Datenpunkt(ga=2305, ga_text="1/1/1", name=name)
    punkt.rolle = Zuordnung(rolle, Quelle.NAMENSLEXIKON, 0.7)
    punkt.knx_rolle = knx_rolle
    if dpt:
        punkt.dpt = Zuordnung(dpt, Quelle.ETS_ATTRIBUT, 1.0)
    return punkt


def test_jeder_parameter_hat_hilfe_und_seite() -> None:
    for parameter in PARAMETER:
        assert parameter.hilfe.strip(), parameter.id
        assert parameter.seite.strip(), parameter.id
        assert parameter.steuerung in ("auswahl", "schalter", "text", "zahl", "liste")


def test_parameter_ids_eindeutig() -> None:
    ids = [parameter.id for parameter in PARAMETER]
    assert len(ids) == len(set(ids))


def test_auswahlparameter_haben_optionen() -> None:
    for parameter in PARAMETER:
        if parameter.steuerung == "auswahl":
            assert parameter.optionen, parameter.id


@pytest.mark.skipif(not TD_SCHEMA.exists(), reason="Playground-Schema nicht installiert")
def test_td_pfade_sind_im_offiziellen_schema_erlaubt() -> None:
    schema = json.loads(TD_SCHEMA.read_text(encoding="utf-8"))["definitions"]
    erlaubt: dict[str, set[str]] = {
        "property": set(schema["property_element"]["properties"]),
        "action": set(schema["action_element"]["properties"]),
        "event": set(schema["event_element"]["properties"]),
    }
    datenschema = set(schema["dataSchema"]["properties"])

    for parameter in PARAMETER:
        pfad = parameter.td_pfad
        if not pfad or pfad.startswith("forms["):
            continue
        rollen = parameter.sichtbar_wenn.get("rolle", ("property", "action", "event"))
        for rolle in rollen:
            if rolle == "property":
                assert pfad in erlaubt["property"], f"{parameter.id} nicht in property_element"
            else:
                assert pfad in erlaubt[rolle] or pfad in datenschema, (
                    f"{parameter.id} weder in {rolle}_element noch in dataSchema"
                )


def test_datentypen_stimmen_mit_schema() -> None:
    assert set(TD_DATENTYPEN) == {
        "boolean",
        "integer",
        "number",
        "string",
        "object",
        "array",
        "null",
    }


def test_operationen_je_rolle() -> None:
    assert OPERATIONEN["property"] == (
        "readproperty",
        "writeproperty",
        "observeproperty",
        "unobserveproperty",
    )
    assert OPERATIONEN["action"] == ("invokeaction", "queryaction", "cancelaction")
    assert OPERATIONEN["event"] == ("subscribeevent", "unsubscribeevent")


def test_seiten_sind_gruppiert() -> None:
    seiten = parameter_je_seite()
    assert "Allgemein" in seiten
    assert "Interaktion" in seiten
    assert all(seiten.values())


def test_vorbelegung_schalter(style1: KnxProjekt) -> None:
    werte = vorbelegung(_punkt("Licht", "DPST-1-1"), style1.stammdaten)
    assert werte["datentyp"] == "boolean"
    assert werte["rolle"] == "property"
    assert werte["readonly"] is True
    assert werte["observable"] is True
    assert werte["href"] == "knx://1/1/1"
    assert "readproperty" in werte["operationen"]


def test_vorbelegung_prozent_mit_wertebereich(style1: KnxProjekt) -> None:
    werte = vorbelegung(_punkt("Position", "DPST-5-1"), style1.stammdaten)
    assert werte["datentyp"] == "number"
    assert werte["einheit"] == "%"
    assert werte["minimum"] == 0
    assert werte["maximum"] == 100


def test_vorbelegung_action_bekommt_invokeaction(style1: KnxProjekt) -> None:
    werte = vorbelegung(
        _punkt("Schalten", "DPST-1-1", rolle="action", knx_rolle="SwitchOnOff"),
        style1.stammdaten,
    )
    assert werte["operationen"] == ["invokeaction"]


def test_relative_befehle_sind_nicht_idempotent(style1: KnxProjekt) -> None:
    werte = vorbelegung(
        _punkt("Dimmen", "DPST-3-7", rolle="action", knx_rolle="RelativeSetvalueControl"),
        style1.stammdaten,
    )
    assert werte["idempotent"] is False


def test_semantischer_typ_aus_dpt() -> None:
    assert semantischer_typ("DPST-9-1", WotRolle.PROPERTY) == "saref:Temperature"
    assert semantischer_typ("DPST-1-19", WotRolle.PROPERTY) == "saref:OpenClose"
    assert semantischer_typ("DPST-1-1", WotRolle.ACTION) == "saref:OnOffState"
    assert semantischer_typ("", WotRolle.PROPERTY) == ""


def test_wertebereich_text(style1: KnxProjekt) -> None:
    assert wertebereich_text("DPST-5-1", style1.stammdaten) == "0 bis 100 %"
    assert wertebereich_text("DPST-1-1", style1.stammdaten) == "Off oder On"
    assert "Stufen" in wertebereich_text("DPST-20-102", style1.stammdaten)


def test_aufzaehlung_bit(style1: KnxProjekt) -> None:
    stufen = aufzaehlung_fuer("DPST-1-1", style1.stammdaten)
    assert stufen == [{"wert": False, "titel": "Off"}, {"wert": True, "titel": "On"}]


def _bundle(projekt: KnxProjekt) -> dict[str, Any]:
    ergebnis: PfadErgebnis = leite_ab(projekt)
    return baue_bundle({"b": ergebnis}, projekt.stammdaten, projekt.name)


def test_bundle_grundstruktur(style1: KnxProjekt) -> None:
    bundle = _bundle(style1)
    assert bundle["projekt"] == "Style1"
    assert bundle["parameter"]
    assert bundle["pfade"]["b"]["punkte"]
    assert bundle["pfade"]["b"]["baum"]
    assert bundle["operationen"]["property"]


def test_bundle_punkt_traegt_herkunft(style1: KnxProjekt) -> None:
    bundle = _bundle(style1)
    punkt = next(p for p in bundle["pfade"]["b"]["punkte"] if p["ga"] == 2304)
    assert punkt["herkunft"]["raum"]["quelle_klartext"] == "Gebaeudestruktur"
    assert punkt["herkunft"]["dpt"]["konfidenz"] == 1.0
    assert punkt["werte"]["href"].startswith("knx://")


def test_bundle_baum_gruppiert_nach_raum_und_funktion(style1: KnxProjekt) -> None:
    bundle = _bundle(style1)
    baum = bundle["pfade"]["b"]["baum"]
    titel = [raum["titel"] for raum in baum]
    assert "Living room" in titel
    wohnzimmer = next(raum for raum in baum if raum["titel"] == "Living room")
    assert wohnzimmer["funktionen"]
    assert all(f["punkte"] for f in wohnzimmer["funktionen"])


def test_bundle_ist_serialisierbar(style1: KnxProjekt, tmp_path: Path) -> None:
    ziel = tmp_path / "bundle.json"
    schreibe_bundle(_bundle(style1), ziel)
    wieder = json.loads(ziel.read_text(encoding="utf-8"))
    assert wieder["projekt"] == "Style1"


def test_vorlage_enthaelt_platzhalter() -> None:
    vorlage = Path(__file__).resolve().parent.parent / "oberflaeche/vorlage.html"
    inhalt = vorlage.read_text(encoding="utf-8")
    assert "__BUNDLE__" in inhalt
    assert "<title>KNX Thing Description Konfigurator</title>" in inhalt


def test_beispielprojekt_liefert_vollstaendiges_bundle() -> None:
    from ets2td.knxproj.leser import lies_knxproj

    projekt = lies_knxproj(BEISPIELE / "musterprojekt-ets6.knxproj")
    bundle = _bundle(projekt)
    punkte = bundle["pfade"]["b"]["punkte"]
    assert len(punkte) == 194
    mit_wertebereich = [p for p in punkte if p["wertebereich"]]
    assert mit_wertebereich
