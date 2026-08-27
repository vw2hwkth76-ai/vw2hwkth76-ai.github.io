from __future__ import annotations

import json
from pathlib import Path

from ets2td.bericht.ausgabe import bericht_json, bericht_markdown
from ets2td.bericht.vergleich import GoldEintrag, dpt_haupttyp, lade_gold, vergleiche
from ets2td.modell import Datenpunkt, PfadErgebnis, Quelle, Rueckfrage, Zuordnung


def _punkt(ga: int, name: str, **zuordnungen: str) -> Datenpunkt:
    punkt = Datenpunkt(ga=ga, ga_text=f"1/0/{ga}", name=name)
    for dimension, wert in zuordnungen.items():
        setattr(punkt, dimension, Zuordnung(wert, Quelle.NAMENSLEXIKON, 0.6))
    return punkt


def _ergebnis(punkte: list[Datenpunkt]) -> PfadErgebnis:
    return PfadErgebnis(
        pfad="b",
        projekt="Test",
        datenpunkte=punkte,
        rueckfragen=[Rueckfrage("1/0/9", "X", ("raum",), "Frage?")],
    )


GOLD = {
    1: GoldEintrag(raum="Wohnzimmer"),
    2: GoldEintrag(rolle="Action"),
    3: GoldEintrag(dpt="DPST-5-1"),
    4: GoldEintrag(raum="Küche"),
    5: GoldEintrag(funktion=""),
    6: GoldEintrag(dpt="DPST-1-1"),
}


def test_dpt_haupttyp() -> None:
    assert dpt_haupttyp("DPST-5-1") == "DPT-5"
    assert dpt_haupttyp("DPT-9") == "DPT-9"
    assert dpt_haupttyp("unsinn") == "unsinn"


def test_vergleich_zaehlt_korrekt_falsch_fehlend() -> None:
    bilanz = vergleiche(
        _ergebnis(
            [
                _punkt(1, "a", raum="wohnzimmer"),
                _punkt(2, "b", rolle="action"),
                _punkt(3, "c", dpt="DPST-5-4"),
                _punkt(4, "d"),
                _punkt(5, "e", funktion="Licht"),
                _punkt(6, "f", dpt="DPT-1"),
            ]
        ),
        GOLD,
    )
    assert bilanz.bilanzen["raum"].korrekt == 1
    assert bilanz.bilanzen["raum"].fehlend == 1
    assert bilanz.bilanzen["rolle"].korrekt == 1
    assert bilanz.bilanzen["dpt"].halbtreffer == 2
    assert bilanz.bilanzen["dpt"].korrekt == 0
    assert bilanz.bilanzen["funktion"].bewertet == 0
    assert bilanz.rueckfragen == 1


def test_vergleich_fehlerfaelle_gesammelt() -> None:
    bilanz = vergleiche(_ergebnis([_punkt(1, "a", raum="Bad")]), GOLD)
    assert bilanz.bilanzen["raum"].falsch == 1
    fehler = bilanz.fehler[0]
    assert (fehler.erwartet, fehler.erhalten) == ("Wohnzimmer", "Bad")
    assert fehler.quelle == "namenslexikon"


def test_abdeckung_und_quellen_ohne_gold() -> None:
    bilanz = vergleiche(_ergebnis([_punkt(1, "a", raum="Bad", rolle="action")]), None)
    assert bilanz.abdeckung == {"raum": 1, "funktion": 0, "rolle": 1, "dpt": 0}
    assert bilanz.quellen["raum"] == {"namenslexikon": 1}
    assert all(b.bewertet == 0 for b in bilanz.bilanzen.values())


def test_lade_gold(tmp_path: Path) -> None:
    datei = tmp_path / "gold.json"
    datei.write_text(
        json.dumps(
            {
                "projekt": "T",
                "datenpunkte": {"2304": {"raum": "Bad", "rolle": "action", "text": "1/1/0"}},
            }
        )
    )
    gold = lade_gold(datei)
    assert gold[2304].raum == "Bad"
    assert gold[2304].dpt == ""


def test_bericht_json_mit_quoten() -> None:
    bilanz = vergleiche(_ergebnis([_punkt(1, "a", raum="wohnzimmer")]), GOLD)
    daten = bericht_json([bilanz], mit_gold=True, vorbemerkungen=["Hinweis"])
    assert daten["vorbemerkungen"] == ["Hinweis"]
    assert daten["pfade"][0]["quoten"]["raum"] == 1.0


def test_bericht_markdown_enthaelt_tabellen() -> None:
    bilanz = vergleiche(_ergebnis([_punkt(1, "a", raum="Bad")]), GOLD)
    text = bericht_markdown([bilanz], mit_gold=True, vorbemerkungen=["Vorab"])
    assert "> Vorab" in text
    assert "| raum |" in text
    assert "### Fehlerbeispiele" in text
    assert "Wohnzimmer" in text


def test_bericht_markdown_ohne_gold() -> None:
    bilanz = vergleiche(_ergebnis([_punkt(1, "a")]), None)
    text = bericht_markdown([bilanz], mit_gold=False)
    assert "Ohne Gold-Standard" in text
    assert "### Korrektheit" not in text
