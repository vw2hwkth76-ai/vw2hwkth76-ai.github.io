from __future__ import annotations

import pytest

pytest.importorskip("xknx", reason="Gateway-Extra nicht installiert")

from ets2td.gateway.kodierung import (
    KodierFehler,
    aus_rohbytes,
    kodierer_fuer,
    rohbytes,
    vereinfache,
    xknx_kennung,
)


@pytest.mark.parametrize(
    ("ets", "erwartet"),
    [
        ("DPST-1-1", "1.001"),
        ("DPST-5-1", "5.001"),
        ("DPST-9-1", "9.001"),
        ("DPST-20-102", "20.102"),
        ("DPST-16-0", "16.000"),
        ("DPT-1", "1"),
        (" DPST-5-1 ", "5.001"),
    ],
)
def test_kennung_wird_in_xknx_schreibweise_uebersetzt(ets: str, erwartet: str) -> None:
    assert xknx_kennung(ets) == erwartet


@pytest.mark.parametrize("unsinn", ["", "5.001", "DPST", "PDT-1-1", "DPST-x-1"])
def test_unbekannte_kennung_ergibt_keinen_kodierer(unsinn: str) -> None:
    assert kodierer_fuer(unsinn) is None


def test_ohne_dpt_gibt_es_keinen_kodierer() -> None:
    assert kodierer_fuer(None) is None


@pytest.mark.parametrize(
    ("dpt", "wert"),
    [
        ("DPST-1-1", True),
        ("DPST-1-1", False),
        ("DPST-1-8", True),
        ("DPST-5-1", 0),
        ("DPST-5-1", 50),
        ("DPST-5-1", 100),
        ("DPST-9-1", 21.5),
        ("DPST-9-1", -20.0),
        ("DPST-20-102", 1),
        ("DPST-16-0", "Hallo"),
    ],
)
def test_wert_ueberlebt_den_rundlauf(dpt: str, wert: object) -> None:
    kodierer = kodierer_fuer(dpt)
    assert kodierer is not None
    assert kodierer.aus_knx(kodierer.nach_knx(wert)) == wert


def test_zusammengesetzter_typ_laeuft_ueber_ein_objekt() -> None:
    kodierer = kodierer_fuer("DPST-10-1")
    assert kodierer is not None
    zurueck = kodierer.aus_knx(kodierer.nach_knx({"hour": 12, "minutes": 30, "seconds": 0}))
    assert isinstance(zurueck, dict)
    assert (zurueck["hour"], zurueck["minutes"], zurueck["seconds"]) == (12, 30, 0)


@pytest.mark.parametrize(
    ("dpt", "wert"),
    [("DPST-5-1", 150), ("DPST-5-1", -1), ("DPST-1-1", "quatsch"), ("DPST-9-1", "warm")],
)
def test_unpassender_wert_wird_abgelehnt_statt_gesendet(dpt: str, wert: object) -> None:
    kodierer = kodierer_fuer(dpt)
    assert kodierer is not None
    with pytest.raises(KodierFehler):
        kodierer.nach_knx(wert)


def test_einheit_stammt_aus_dem_datenpunkttyp() -> None:
    prozent = kodierer_fuer("DPST-5-1")
    schalter = kodierer_fuer("DPST-1-1")
    assert prozent is not None and schalter is not None
    assert prozent.einheit == "%"
    assert schalter.einheit == ""


def test_aufzaehlung_wird_auf_einen_einfachen_wert_reduziert() -> None:
    kodierer = kodierer_fuer("DPST-20-102")
    assert kodierer is not None
    ergebnis = kodierer.aus_knx(kodierer.nach_knx(3))
    assert ergebnis == 3
    assert not hasattr(ergebnis, "value")


def test_vereinfache_laesst_json_taugliche_werte_unveraendert() -> None:
    assert vereinfache({"a": [1, True, "x", None]}) == {"a": [1, True, "x", None]}


def test_rohbytes_sind_immer_zahlen() -> None:
    for dpt, wert in (("DPST-1-1", False), ("DPST-1-1", True), ("DPST-5-1", 100)):
        kodierer = kodierer_fuer(dpt)
        assert kodierer is not None
        bytes_ = rohbytes(kodierer.nach_knx(wert))
        assert all(isinstance(b, int) and not isinstance(b, bool) for b in bytes_)


def test_rohbytes_laufen_zurueck() -> None:
    kodierer = kodierer_fuer("DPST-9-1")
    assert kodierer is not None
    nutzlast = kodierer.nach_knx(21.5)
    assert aus_rohbytes(rohbytes(nutzlast), binaer=False) == nutzlast


@pytest.mark.parametrize(
    ("werte", "binaer"),
    [([64], True), ([300], False), ([-1], False), ([1, 2], True)],
)
def test_ungueltige_rohbytes_werden_abgelehnt(werte: list[int], binaer: bool) -> None:
    with pytest.raises(KodierFehler):
        aus_rohbytes(werte, binaer)
