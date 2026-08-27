from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from ets2td.knxproj.leser import (
    KnxProjekt,
    KnxProjektFehler,
    PasswortGeschuetzt,
    formatiere_ga,
    lies_knxproj,
)


def test_formatiere_dreistufig() -> None:
    assert formatiere_ga(2304, "ThreeLevel") == "1/1/0"


def test_formatiere_zweistufig() -> None:
    assert formatiere_ga(2304, "TwoLevel") == "1/256"


def test_formatiere_frei() -> None:
    assert formatiere_ga(2304, "Free") == "2304"


def test_style1_grunddaten(style1: KnxProjekt) -> None:
    assert style1.name == "Style1"
    assert style1.ga_stil == "Free"
    assert style1.schema_namespace == "http://knx.org/xml/project/20"
    assert len(style1.gruppenadressen) == 251
    assert len(style1.funktionen) == 98


def test_style1_gruppenbereiche_vorhanden(style1: KnxProjekt) -> None:
    ga = next(g for g in style1.gruppenadressen.values() if g.adresse == 2304)
    assert ga.name == "Living room Ceiling light switching"
    assert ga.hauptgruppe == "Light"
    assert ga.mittelgruppe == "Switching"
    assert ga.dpt_id == "DPST-1-1"


def test_style1_zentrale_ga_markiert(style1: KnxProjekt) -> None:
    ga = next(g for g in style1.gruppenadressen.values() if g.adresse == 2050)
    assert ga.name == "Dimming light central"
    assert ga.zentral is True
    assert ga.dpt_id == ""


def test_style1_raum_mit_nutzung(style1: KnxProjekt) -> None:
    wohnzimmer = next(r for r in style1.raeume if r.name == "Living room")
    assert wohnzimmer.typ == "Room"
    assert wohnzimmer.nutzung == "Living room"
    assert wohnzimmer.pfad[0] == "One-family house"


def test_style1_funktion_mit_rollen(style1: KnxProjekt) -> None:
    funktion = next(f for f in style1.funktionen if f.id.endswith("_F-1"))
    assert funktion.name == "Ceiling light"
    assert funktion.typ_text == "dimmable light"
    assert funktion.raum.name == "Living room"
    rollen = [v.rolle for v in funktion.verknuepfungen]
    assert rollen == [
        "SwitchOnOff",
        "InfoOnOff",
        "RelativeSetvalueControl",
        "ActualDimmingValue",
    ]


def test_demoprojekt_geraete_links_aufgeloest(demoprojekt: KnxProjekt) -> None:
    geraet = next(g for g in demoprojekt.geraete if g.id.endswith("_DI-2"))
    ga_ids = [ga_id for objekt in geraet.komm_objekte for ga_id in objekt.ga_ids]
    assert "P-045C-0_GA-1" in ga_ids
    assert all(ga_id.startswith("P-045C-0_GA-") for ga_id in ga_ids)


def test_demoprojekt_geraet_raum_zuordnung(demoprojekt: KnxProjekt) -> None:
    zugeordnet = [g for g in demoprojekt.geraete if g.raum_id]
    assert zugeordnet, "Mindestens ein Geraet sollte einem Raum zugeordnet sein"


def test_keine_zip_datei(tmp_path: Path) -> None:
    datei = tmp_path / "kaputt.knxproj"
    datei.write_text("kein zip")
    with pytest.raises(KnxProjektFehler, match="kein gueltiges ZIP"):
        lies_knxproj(datei)


def test_unerwartete_archivstruktur(tmp_path: Path) -> None:
    datei = tmp_path / "leer.knxproj"
    with zipfile.ZipFile(datei, "w") as archiv:
        archiv.writestr("irgendwas.txt", "x")
    with pytest.raises(KnxProjektFehler, match="Unerwartete Archivstruktur"):
        lies_knxproj(datei)


def test_passwortschutz_wird_als_solcher_gemeldet(tmp_path: Path) -> None:
    pyzipper = pytest.importorskip("pyzipper", reason="nur zum Erzeugen der Fixture")
    innen = tmp_path / "innen.zip"
    with pyzipper.AESZipFile(
        innen, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES
    ) as archiv:
        archiv.setpassword(b"geheim")
        archiv.writestr("project.xml", "<Project/>")
        archiv.writestr("0.xml", "<Installation/>")
    datei = tmp_path / "geschuetzt.knxproj"
    with zipfile.ZipFile(datei, "w") as archiv:
        archiv.writestr("P-0001.zip", innen.read_bytes())
    with pytest.raises(PasswortGeschuetzt, match="Projektpasswort"):
        lies_knxproj(datei)
