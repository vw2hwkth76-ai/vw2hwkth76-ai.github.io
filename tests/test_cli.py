from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import BEISPIELE

from ets2td.cli import main

STYLE2 = str(BEISPIELE / "style2.knxproj")
GOLD = str(BEISPIELE / "style.gold.json")


def test_kompletter_lauf_mit_gold(tmp_path: Path) -> None:
    rc = main([STYLE2, "--pfad", "b", "--out", str(tmp_path), "--gold", GOLD, "--gold-vorlage"])
    assert rc == 0
    for name in (
        "bericht.md",
        "bericht.json",
        "rueckfragen-b.md",
        "rueckfragen-b.json",
        "gold-vorlage.json",
        "zuordnungen-b.json",
        "zuordnungen-b-pur.json",
    ):
        assert (tmp_path / name).exists(), name
    assert list((tmp_path / "td" / "b").glob("*.td.json"))

    bericht = json.loads((tmp_path / "bericht.json").read_text())
    assert [p["pfad"] for p in bericht["pfade"]] == ["b", "b-pur"]
    assert bericht["mit_gold"] is True

    vorlage = json.loads((tmp_path / "gold-vorlage.json").read_text())
    assert len(vorlage["datenpunkte"]) == 251


def test_lauf_ohne_gold_meldet_nur_abdeckung(tmp_path: Path) -> None:
    rc = main([STYLE2, "--pfad", "b", "--out", str(tmp_path)])
    assert rc == 0
    assert "Ohne Gold-Standard" in (tmp_path / "bericht.md").read_text()


def test_pfad_beide_ohne_semantik_vermerkt_uebersprungen(tmp_path: Path) -> None:
    rc = main([STYLE2, "--pfad", "beide", "--out", str(tmp_path)])
    assert rc == 0
    bericht = json.loads((tmp_path / "bericht.json").read_text())
    assert any("uebersprungen" in v for v in bericht["vorbemerkungen"])


def test_pfad_a_bricht_kontrolliert_ab(tmp_path: Path) -> None:
    export = tmp_path / "export.jsonld"
    export.write_text(json.dumps({"@context": {"core": "http://example.org/"}, "@graph": []}))
    rc = main([str(export), "--pfad", "a", "--out", str(tmp_path / "out")])
    assert rc == 2


def test_unbekannte_endung_wird_abgelehnt(tmp_path: Path) -> None:
    datei = tmp_path / "export.xyz"
    datei.write_text("x")
    with pytest.raises(SystemExit) as abbruch:
        main([str(datei), "--out", str(tmp_path / "out")])
    assert abbruch.value.code == 2


def test_mehrere_knxproj_werden_abgelehnt(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as abbruch:
        main([STYLE2, STYLE2, "--out", str(tmp_path)])
    assert abbruch.value.code == 2
