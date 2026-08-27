from __future__ import annotations

from ets2td.knxproj.leser import KnxProjekt
from ets2td.knxproj.stammdaten import Aufzaehlungsformat, Bitformat, Zahlenformat


def test_dpt_schalter_hat_bitformat(style1: KnxProjekt) -> None:
    info = style1.stammdaten.dpt("DPST-1-1")
    assert info is not None
    assert info.groesse_bit == 1
    assert info.name == "DPT_Switch"
    assert info.formate == (Bitformat(geloescht="Off", gesetzt="On"),)


def test_dpt_prozent_hat_koeffizient_und_einheit(style1: KnxProjekt) -> None:
    info = style1.stammdaten.dpt("DPST-5-1")
    assert info is not None
    format_ = info.formate[0]
    assert isinstance(format_, Zahlenformat)
    assert format_.art == "unsigned"
    assert format_.breite_bit == 8
    assert format_.einheit == "%"
    assert format_.koeffizient is not None
    assert abs(format_.koeffizient - 0.3921566) < 1e-6


def test_dpt_temperatur_hat_wertebereich(style1: KnxProjekt) -> None:
    info = style1.stammdaten.dpt("DPST-9-1")
    assert info is not None
    format_ = info.formate[0]
    assert isinstance(format_, Zahlenformat)
    assert format_.art == "float"
    assert format_.einheit == "°C"
    assert format_.minimum == -273
    assert format_.maximum == 670760


def test_dpt_jalousiesteuerung_aufgeloester_reftype(style1: KnxProjekt) -> None:
    info = style1.stammdaten.dpt("DPST-3-8")
    assert info is not None
    assert len(info.formate) == 2
    bit, schritt = info.formate
    assert isinstance(bit, Bitformat)
    assert (bit.geloescht, bit.gesetzt) == ("Up", "Down")
    assert isinstance(schritt, Zahlenformat)
    assert schritt.name == "StepCode"
    assert schritt.breite_bit == 3


def test_dpt_hvac_modus_ist_aufzaehlung(style1: KnxProjekt) -> None:
    info = style1.stammdaten.dpt("DPST-20-102")
    assert info is not None
    format_ = info.formate[0]
    assert isinstance(format_, Aufzaehlungsformat)
    assert len(format_.werte) >= 3


def test_haupttyp_ohne_formate_bekannt(style1: KnxProjekt) -> None:
    info = style1.stammdaten.dpt("DPT-1")
    assert info is not None
    assert info.groesse_bit == 1
    assert info.haupttyp_id == ""


def test_raumnutzungen_aufgeloest(style1: KnxProjekt) -> None:
    assert style1.stammdaten.raumnutzungen["SU-4"] == "Living room"


def test_funktionstyp_veraltet_markiert(style1: KnxProjekt) -> None:
    assert style1.stammdaten.funktionstypen["FT-2"].veraltet is True
    assert style1.stammdaten.funktionstypen["FT-2"].text == "dimmable light"
    assert style1.stammdaten.funktionstypen["FT-6"].veraltet is False
