from __future__ import annotations

from conftest import synthetisches_projekt

from ets2td.knxproj.leser import (
    EtsFunktion,
    FunktionsVerknuepfung,
    Gruppenadresse,
    KnxProjekt,
    RaumInfo,
)
from ets2td.modell import Quelle
from ets2td.pfad_b.ableitung import leite_ab
from ets2td.pfad_b.aufloeser import FakeResolver
from ets2td.pfad_b.lexikon import KNX_ROLLEN

WOHNZIMMER = RaumInfo(id="BP-1", name="Wohnzimmer", typ="Room", pfad=("Haus", "Wohnzimmer"))


def test_dpt_attribut_wird_uebernommen() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=2304, name="Irgendwas", dpt_id="DPST-1-1")]
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.dpt is not None
    assert punkt.dpt.wert == "DPST-1-1"
    assert punkt.dpt.quelle is Quelle.ETS_ATTRIBUT
    assert punkt.dpt.konfidenz == 1.0


def test_funktion_setzt_raum_funktion_und_rolle() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=2304, name="Egal")],
        funktionen=[
            EtsFunktion(
                id="F-1",
                name="Deckenlicht",
                typ_id="FT-1",
                typ_text="switchable light",
                raum=WOHNZIMMER,
                verknuepfungen=(FunktionsVerknuepfung(rolle="SwitchOnOff", ga_id="GA-1"),),
            )
        ],
        raeume=[WOHNZIMMER],
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.raum is not None and punkt.raum.wert == "Wohnzimmer"
    assert punkt.raum.quelle is Quelle.GEBAEUDESTRUKTUR
    assert punkt.funktion is not None and punkt.funktion.wert == "Deckenlicht"
    assert punkt.funktion.quelle is Quelle.ETS_FUNKTION
    assert punkt.rolle is not None and punkt.rolle.wert == "action"
    assert punkt.knx_rolle == "SwitchOnOff"


def test_guid_rolle_gibt_hinweis_und_namensheuristik() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=2304, name="Wohnzimmer Licht dimmen")],
        funktionen=[
            EtsFunktion(
                id="F-1",
                name="Licht",
                typ_id="FT-0",
                typ_text="custom",
                raum=WOHNZIMMER,
                verknuepfungen=(
                    FunktionsVerknuepfung(
                        rolle="275fe355-566d-4987-bc4e-3f644974b62f", ga_id="GA-1"
                    ),
                ),
            )
        ],
        raeume=[WOHNZIMMER],
    )
    ergebnis = leite_ab(projekt)
    punkt = ergebnis.datenpunkte[0]
    assert any("GUID" in hinweis for hinweis in ergebnis.hinweise)
    assert punkt.rolle is not None and punkt.rolle.wert == "action"
    assert punkt.rolle.quelle is Quelle.NAMENSLEXIKON


def test_mehrfachzuordnung_erste_funktion_gewinnt() -> None:
    verknuepfung = FunktionsVerknuepfung(rolle="TempRoom", ga_id="GA-1")
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=100, name="Temperatur")],
        funktionen=[
            EtsFunktion("F-1", "Heizkoerper", "FT-4", "heizung", WOHNZIMMER, (verknuepfung,)),
            EtsFunktion("F-2", "Fussboden", "FT-5", "heizung", WOHNZIMMER, (verknuepfung,)),
        ],
        raeume=[WOHNZIMMER],
    )
    ergebnis = leite_ab(projekt)
    punkt = ergebnis.datenpunkte[0]
    assert punkt.funktion is not None and punkt.funktion.wert == "Heizkoerper"
    assert any("mehreren Funktionen" in hinweis for hinweis in ergebnis.hinweise)


def test_heuristik_pur_ignoriert_funktionen() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=2304, name="Wohnzimmer Licht schalten")],
        funktionen=[
            EtsFunktion(
                id="F-1",
                name="Deckenlicht",
                typ_id="FT-1",
                typ_text="switchable light",
                raum=WOHNZIMMER,
                verknuepfungen=(FunktionsVerknuepfung(rolle="SwitchOnOff", ga_id="GA-1"),),
            )
        ],
        raeume=[WOHNZIMMER],
    )
    ergebnis = leite_ab(projekt, heuristik_pur=True)
    punkt = ergebnis.datenpunkte[0]
    assert ergebnis.pfad == "b-pur"
    assert punkt.raum is not None and punkt.raum.quelle is Quelle.NAMENSLEXIKON
    assert punkt.funktion is not None and punkt.funktion.quelle is Quelle.NAMENSLEXIKON


def test_rolle_aus_mittelgruppe() -> None:
    projekt = synthetisches_projekt(
        [
            Gruppenadresse(
                id="GA-1", adresse=1, name="Deckenleuchte Kueche", mittelgruppe="Status"
            )
        ]
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.rolle is not None
    assert punkt.rolle.wert == "property"
    assert punkt.rolle.quelle is Quelle.GA_HIERARCHIE


def test_dpt_aus_mittelgruppe() -> None:
    projekt = synthetisches_projekt(
        [
            Gruppenadresse(
                id="GA-1", adresse=1, name="Deckenleuchte Kueche", mittelgruppe="Schalten"
            )
        ]
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.dpt is not None
    assert punkt.dpt.wert == "DPST-1-1"
    assert punkt.dpt.quelle is Quelle.GA_HIERARCHIE


def test_funktionsname_ohne_raum_und_verben() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=1, name="Wohnzimmer Deckenleuchte schalten")]
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.funktion is not None
    assert punkt.funktion.wert == "deckenleuchte"


def test_zentrale_ga_ohne_raum_keine_raum_rueckfrage() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=1, name="Zentralbefehl XY", zentral=True)]
    )
    ergebnis = leite_ab(projekt)
    assert ergebnis.datenpunkte[0].raum is None
    assert len(ergebnis.rueckfragen) == 1
    assert "raum" not in ergebnis.rueckfragen[0].fehlende_dimensionen


def test_personenname_erzeugt_rueckfrage_statt_raum() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=1, name="Büro Kurt Licht schalten")]
    )
    ergebnis = leite_ab(projekt)
    punkt = ergebnis.datenpunkte[0]
    assert punkt.raum is None
    assert len(ergebnis.rueckfragen) == 1
    assert "raum" in ergebnis.rueckfragen[0].fehlende_dimensionen


def test_personenname_mit_gebaeudestruktur_aufgeloest() -> None:
    buero = RaumInfo(id="BP-2", name="Büro Kurt", typ="Room", pfad=("Haus", "Büro Kurt"))
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=1, name="Büro Kurt Licht schalten")],
        raeume=[buero],
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.raum is not None
    assert punkt.raum.wert == "Büro Kurt"


def test_fake_resolver_loest_bekannte_namen() -> None:
    projekt = synthetisches_projekt([Gruppenadresse(id="GA-1", adresse=1, name="K7 Sonderfall")])
    resolver = FakeResolver(
        {
            "K7 Sonderfall": {
                "raum": "Serverraum",
                "funktion": "Temperatur",
                "rolle": "property",
                "dpt": "DPST-9-1",
            }
        }
    )
    ergebnis = leite_ab(projekt, resolver=resolver)
    punkt = ergebnis.datenpunkte[0]
    assert punkt.raum is not None and punkt.raum.wert == "Serverraum"
    assert punkt.raum.quelle is Quelle.LLM
    assert punkt.dpt is not None and punkt.dpt.wert == "DPST-9-1"
    assert ergebnis.rueckfragen == []


def test_fake_resolver_unbekanntes_ergibt_rueckfrage() -> None:
    projekt = synthetisches_projekt([Gruppenadresse(id="GA-1", adresse=1, name="QX 9")])
    ergebnis = leite_ab(projekt, resolver=FakeResolver({}))
    assert ergebnis.datenpunkte[0].raum is None
    assert len(ergebnis.rueckfragen) == 1


def test_fake_resolver_teilantwort_laesst_rest_offen() -> None:
    projekt = synthetisches_projekt([Gruppenadresse(id="GA-1", adresse=1, name="QX 9")])
    resolver = FakeResolver({"QX 9": {"raum": "Keller"}})
    ergebnis = leite_ab(projekt, resolver=resolver)
    punkt = ergebnis.datenpunkte[0]
    assert punkt.raum is not None and punkt.raum.wert == "Keller"
    assert len(ergebnis.rueckfragen) == 1
    assert "raum" not in ergebnis.rueckfragen[0].fehlende_dimensionen
    assert "dpt" in ergebnis.rueckfragen[0].fehlende_dimensionen


def test_style1_kennzahlen(style1: KnxProjekt) -> None:
    ergebnis = leite_ab(style1)
    assert len(ergebnis.datenpunkte) == 251
    verlinkt = [punkt for punkt in ergebnis.datenpunkte if punkt.knx_rolle]
    assert verlinkt
    assert all(punkt.rolle is not None for punkt in verlinkt if punkt.knx_rolle in KNX_ROLLEN)
    assert ergebnis.rueckfragen
    assert any("GUID" in hinweis for hinweis in ergebnis.hinweise)


def test_raum_aus_mittelgruppe() -> None:
    projekt = synthetisches_projekt(
        [
            Gruppenadresse(
                id="GA-1", adresse=1, name="Licht A", hauptgruppe="Licht", mittelgruppe="Küche"
            )
        ],
        raeume=[RaumInfo(id="BP-1", name="Küche", typ="Room", pfad=("Haus", "Küche"))],
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.raum is not None
    assert punkt.raum.wert == "Küche"
    assert punkt.raum.quelle is Quelle.GA_HIERARCHIE


def test_ausser_betrieb_gruppe_liefert_keinen_raum() -> None:
    projekt = synthetisches_projekt(
        [
            Gruppenadresse(
                id="GA-1",
                adresse=1,
                name="Rolladen 1",
                hauptgruppe="Zentral",
                mittelgruppe="Rolladen--out of use",
            )
        ],
        raeume=[RaumInfo(id="BP-1", name="Küche", typ="Room", pfad=("Haus", "Küche"))],
    )
    assert leite_ab(projekt).datenpunkte[0].raum is None


def test_sammelmittelgruppe_liefert_keinen_raum() -> None:
    projekt = synthetisches_projekt(
        [
            Gruppenadresse(
                id="GA-1",
                adresse=1,
                name="Deckenlicht",
                hauptgruppe="Licht",
                mittelgruppe="Bad/ WC",
            )
        ],
        raeume=[
            RaumInfo(id="BP-1", name="Badezimmer", typ="Room", pfad=("Haus", "Badezimmer")),
            RaumInfo(id="BP-2", name="WC", typ="Room", pfad=("Haus", "WC")),
        ],
    )
    assert leite_ab(projekt).datenpunkte[0].raum is None


def test_lexikontreffer_wird_auf_strukturraum_abgebildet() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=1, name="Bad Spiegelschrank")],
        raeume=[RaumInfo(id="BP-1", name="Badezimmer", typ="Room", pfad=("Haus", "Badezimmer"))],
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.raum is not None
    assert punkt.raum.wert == "Badezimmer"


def test_funktionsname_ohne_raumteilwort() -> None:
    projekt = synthetisches_projekt(
        [Gruppenadresse(id="GA-1", adresse=1, name="Licht M Flur")],
        raeume=[RaumInfo(id="BP-1", name="Büro/ Flur", typ="Room", pfad=("Haus", "Büro/ Flur"))],
    )
    punkt = leite_ab(projekt).datenpunkte[0]
    assert punkt.funktion is not None
    assert punkt.funktion.wert == "licht m"
