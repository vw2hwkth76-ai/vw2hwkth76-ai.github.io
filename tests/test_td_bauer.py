from __future__ import annotations

from typing import Any

from ets2td.knxproj.stammdaten import (
    Aufzaehlungsformat,
    Bitformat,
    DptInfo,
    Stammdaten,
    Zahlenformat,
)
from ets2td.modell import Datenpunkt, PfadErgebnis, Quelle, Zuordnung
from ets2td.td.bauer import baue_tds, slug


def _stammdaten() -> Stammdaten:
    return Stammdaten(
        dpts={
            "DPST-1-1": DptInfo(
                id="DPST-1-1",
                name="DPT_Switch",
                text="switch",
                groesse_bit=1,
                formate=(Bitformat("Off", "On"),),
                haupttyp_id="DPT-1",
            ),
            "DPST-5-1": DptInfo(
                id="DPST-5-1",
                name="DPT_Scaling",
                text="percentage",
                groesse_bit=8,
                formate=(
                    Zahlenformat(art="unsigned", breite_bit=8, einheit="%", koeffizient=0.3921566),
                ),
                haupttyp_id="DPT-5",
            ),
            "DPST-9-1": DptInfo(
                id="DPST-9-1",
                name="DPT_Value_Temp",
                text="temperature",
                groesse_bit=16,
                formate=(
                    Zahlenformat(
                        art="float", breite_bit=16, einheit="°C", minimum=-273, maximum=670760
                    ),
                ),
                haupttyp_id="DPT-9",
            ),
            "DPST-20-102": DptInfo(
                id="DPST-20-102",
                name="DPT_HVACMode",
                text="HVAC mode",
                groesse_bit=8,
                formate=(Aufzaehlungsformat(werte=((0, "Auto"), (1, "Comfort"))),),
                haupttyp_id="DPT-20",
            ),
            "DPST-3-7": DptInfo(
                id="DPST-3-7",
                name="DPT_Control_Dimming",
                text="dimming control",
                groesse_bit=4,
                formate=(
                    Bitformat("Decrease", "Increase"),
                    Zahlenformat(art="unsigned", breite_bit=3, name="StepCode"),
                ),
                haupttyp_id="DPT-3",
            ),
        }
    )


def _punkt(
    ga: int,
    name: str,
    rolle: str | None,
    dpt: str | None,
    raum: str = "Wohnzimmer",
    funktion: str = "Deckenlicht",
    lesbar: bool | None = None,
    schreibbar: bool | None = None,
) -> Datenpunkt:
    punkt = Datenpunkt(ga=ga, ga_text=f"1/2/{ga}", name=name)
    punkt.lesbar = lesbar
    punkt.schreibbar = schreibbar
    punkt.raum = Zuordnung(raum, Quelle.GEBAEUDESTRUKTUR, 1.0)
    punkt.funktion = Zuordnung(funktion, Quelle.ETS_FUNKTION, 1.0)
    if rolle is not None:
        punkt.rolle = Zuordnung(rolle, Quelle.ETS_FUNKTION, 0.95)
    if dpt is not None:
        punkt.dpt = Zuordnung(dpt, Quelle.ETS_ATTRIBUT, 1.0)
    return punkt


def _einzige_td(punkte: list[Datenpunkt], je_funktion: bool = False) -> dict[str, Any]:
    ergebnis = PfadErgebnis(pfad="b", projekt="Test", datenpunkte=punkte)
    tds = baue_tds(ergebnis, _stammdaten(), je_funktion=je_funktion)
    assert len(tds) == 1
    return next(iter(tds.values()))


def test_slug_mit_umlauten() -> None:
    assert slug("Büro Süd") == "buero-sued"


def test_property_mit_prozent_schema() -> None:
    td = _einzige_td(
        [_punkt(1, "Helligkeit Status", "property", "DPST-5-1", lesbar=True, schreibbar=False)]
    )
    affordanz = td["properties"]["helligkeit-status"]
    assert affordanz["type"] == "number"
    assert affordanz["minimum"] == 0.0
    assert affordanz["maximum"] == 100.0
    assert affordanz["unit"] == "%"
    assert affordanz["readOnly"] is True
    assert affordanz["observable"] is True
    assert affordanz["forms"][0]["op"] == ["readproperty", "observeproperty"]
    assert affordanz["forms"][0]["href"] == "knx://1/2/1"


def test_schreibbare_property_ist_nicht_readonly() -> None:
    td = _einzige_td(
        [_punkt(1, "Soll-Temp", "property", "DPST-9-1", lesbar=True, schreibbar=True)]
    )
    affordanz = td["properties"]["soll-temp"]
    assert "readOnly" not in affordanz
    assert "writeOnly" not in affordanz
    assert affordanz["forms"][0]["op"] == ["readproperty", "writeproperty", "observeproperty"]


def test_nur_schreibbare_property_ist_writeonly() -> None:
    td = _einzige_td(
        [_punkt(1, "Stellbefehl", "property", "DPST-1-1", lesbar=False, schreibbar=True)]
    )
    affordanz = td["properties"]["stellbefehl"]
    assert affordanz["writeOnly"] is True
    assert "readOnly" not in affordanz
    assert affordanz["observable"] is False
    assert affordanz["forms"][0]["op"] == ["writeproperty"]


def test_ohne_zugriffsangabe_keine_behauptung() -> None:
    td = _einzige_td([_punkt(1, "Unklar", "property", "DPST-1-1")])
    affordanz = td["properties"]["unklar"]
    assert "readOnly" not in affordanz
    assert "writeOnly" not in affordanz


def test_projektbeschreibung_ueberlebt_die_bitlegende() -> None:
    punkt = _punkt(1, "Licht", "property", "DPST-1-1", lesbar=True, schreibbar=False)
    punkt.beschreibung = "Deckenlicht ueber dem Esstisch"
    affordanz = _einzige_td([punkt])["properties"]["licht"]
    assert affordanz["description"] == "Deckenlicht ueber dem Esstisch"
    assert affordanz["ets2td:bedeutung"] == "false = Off, true = On"


def test_action_mit_bool_input() -> None:
    td = _einzige_td([_punkt(2, "Licht schalten", "action", "DPST-1-1")])
    affordanz = td["actions"]["licht-schalten"]
    assert affordanz["input"]["type"] == "boolean"
    assert "Off" in affordanz["input"]["description"]
    assert affordanz["forms"][0]["op"] == ["invokeaction"]


def test_event_mit_datenschema() -> None:
    td = _einzige_td([_punkt(3, "Windalarm", "event", "DPST-1-1")])
    affordanz = td["events"]["windalarm"]
    assert affordanz["data"]["type"] == "boolean"
    assert affordanz["forms"][0]["op"] == ["subscribeevent"]


def test_temperatur_wertebereich() -> None:
    td = _einzige_td([_punkt(4, "Temperatur", "property", "DPST-9-1")])
    affordanz = td["properties"]["temperatur"]
    assert affordanz["minimum"] == -273
    assert affordanz["unit"] == "°C"


def test_aufzaehlung_als_oneof() -> None:
    td = _einzige_td([_punkt(5, "Betriebsart", "action", "DPST-20-102")])
    schema = td["actions"]["betriebsart"]["input"]
    assert schema["type"] == "integer"
    assert {"const": 1, "title": "Comfort"} in schema["oneOf"]


def test_zusammengesetztes_format_als_objekt() -> None:
    td = _einzige_td([_punkt(6, "Dimmen", "action", "DPST-3-7")])
    schema = td["actions"]["dimmen"]["input"]
    assert schema["type"] == "object"
    assert set(schema["properties"]) == {"teil1", "stepcode"}
    assert schema["properties"]["stepcode"]["maximum"] == 7


def test_ohne_rolle_wird_property() -> None:
    td = _einzige_td([_punkt(7, "Unklar", None, None)])
    assert "unklar" in td["properties"]


def test_namenskollision_bekommt_ga_suffix() -> None:
    td = _einzige_td(
        [_punkt(8, "Licht", "action", "DPST-1-1"), _punkt(9, "Licht", "action", "DPST-1-1")]
    )
    assert set(td["actions"]) == {"licht", "licht-9"}


def test_je_funktion_gruppiert_nach_funktion() -> None:
    td = _einzige_td([_punkt(10, "Licht schalten", "action", "DPST-1-1")], je_funktion=True)
    assert td["title"] == "Wohnzimmer: Deckenlicht"


def test_td_pflichtfelder_und_metadaten() -> None:
    td = _einzige_td([_punkt(11, "Licht schalten", "action", "DPST-1-1")])
    assert td["@context"][0] == "https://www.w3.org/2022/wot/td/v1.1"
    assert td["@context"][1]["saref"] == "https://saref.etsi.org/core/"
    assert td["@context"][1]["@language"] == "de"
    assert td["securityDefinitions"]["nosec_sc"]["scheme"] == "nosec"
    assert td["security"] == "nosec_sc"
    affordanz = td["actions"]["licht-schalten"]
    assert affordanz["ets2td:gruppenadresse"] == "1/2/11"
    assert affordanz["ets2td:dpt"] == "DPST-1-1"
    herkunft = {e["ets2td:dimension"]: e for e in affordanz["ets2td:herkunft"]}
    assert herkunft["rolle"]["ets2td:quelle"] == "ets-funktion"
