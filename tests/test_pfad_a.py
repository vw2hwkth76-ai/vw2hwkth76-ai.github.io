from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from conftest import BEISPIELE

from ets2td.modell import PfadErgebnis, Quelle
from ets2td.pfad_a.graph import KeinKnxExport, lade_graph
from ets2td.pfad_a.leser import charakterisiere, dpt_tabelle, lies_semantischen_export

EXPORT = BEISPIELE / "musterprojekt-ets6.jsonld"

KONTEXT = {
    "core": "http://schema.knx.org/2023/en50090-6-2/core#",
    "knx": "http://schema.knx.org/2020/ontology/knx#",
    "loc": "http://schema.knx.org/2023/en50090-6-2/loc#",
    "dct": "http://purl.org/dc/terms/",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "prj": "http://iot.knx.org/test#",
}


def schreibe_export(tmp_path: Path, knoten: list[dict[str, Any]]) -> Path:
    datei = tmp_path / "export.jsonld"
    datei.write_text(json.dumps({"@context": KONTEXT, "@graph": knoten}))
    return datei


def funktionspunkt(adresse: int, titel: str, **rest: Any) -> dict[str, Any]:
    return {
        "@id": f"prj:GA-{adresse}",
        "@type": ["knx:FunctionPoint", "owl:NamedIndividual"],
        "knx:groupAddress": {"@value": str(adresse), "@type": "xsd:positiveInteger"},
        "dct:title": titel,
        **rest,
    }


def wahr(wert: bool = True) -> dict[str, str]:
    return {"@value": "True" if wert else "False", "@type": "xsd:boolean"}


@pytest.fixture(scope="session")
def musterprojekt() -> PfadErgebnis:
    return lies_semantischen_export(EXPORT)


def test_dpt_tabelle_aus_ontologie() -> None:
    assert dpt_tabelle()["knx:switch"] == "DPST-1-1"
    assert dpt_tabelle()["knx:bool"] == "DPST-1-2"
    assert dpt_tabelle()["knx:valueElectricCurrent"] == "DPST-14-19"


def test_turtle_wird_abgelehnt(tmp_path: Path) -> None:
    datei = tmp_path / "export.ttl"
    datei.write_text("@prefix core: <http://example.org/> .")
    with pytest.raises(KeinKnxExport, match="Turtle"):
        lade_graph(datei)


def test_json_ohne_graph_wird_abgelehnt(tmp_path: Path) -> None:
    datei = tmp_path / "export.jsonld"
    datei.write_text(json.dumps({"@context": KONTEXT}))
    with pytest.raises(KeinKnxExport, match="@graph"):
        lade_graph(datei)


def test_fremde_ontologie_wird_abgelehnt(tmp_path: Path) -> None:
    datei = tmp_path / "export.jsonld"
    datei.write_text(json.dumps({"@context": {"ex": "http://example.org/"}, "@graph": []}))
    with pytest.raises(KeinKnxExport, match="KIM-Namespaces"):
        lade_graph(datei)


def test_export_ohne_funktionspunkte(tmp_path: Path) -> None:
    datei = schreibe_export(tmp_path, [])
    with pytest.raises(KeinKnxExport, match="keine knx:FunctionPoint"):
        lies_semantischen_export(datei)


def test_rolle_nur_schreibbar_ist_action(tmp_path: Path) -> None:
    datei = schreibe_export(tmp_path, [funktionspunkt(1, "Licht", **{"core:writable": wahr()})])
    punkt = lies_semantischen_export(datei).datenpunkte[0]
    assert punkt.rolle is not None
    assert punkt.rolle.wert == "action"
    assert punkt.rolle.quelle is Quelle.SEMANTIK_ZUGRIFF


def test_rolle_nur_lesbar_ist_property(tmp_path: Path) -> None:
    datei = schreibe_export(tmp_path, [funktionspunkt(1, "RM", **{"core:readable": wahr()})])
    punkt = lies_semantischen_export(datei).datenpunkte[0]
    assert punkt.rolle is not None
    assert punkt.rolle.wert == "property"


def test_rolle_les_und_schreibbar_ist_property(tmp_path: Path) -> None:
    datei = schreibe_export(
        tmp_path,
        [funktionspunkt(1, "Soll", **{"core:readable": wahr(), "core:writable": wahr()})],
    )
    punkt = lies_semantischen_export(datei).datenpunkte[0]
    assert punkt.rolle is not None
    assert punkt.rolle.wert == "property"


def test_ohne_zugriffsangabe_keine_rolle(tmp_path: Path) -> None:
    datei = schreibe_export(tmp_path, [funktionspunkt(1, "Unklar")])
    ergebnis = lies_semantischen_export(datei)
    assert ergebnis.datenpunkte[0].rolle is None
    assert ergebnis.rueckfragen
    assert "rolle" in ergebnis.rueckfragen[0].fehlende_dimensionen


def test_dpt_am_funktionspunkt(tmp_path: Path) -> None:
    datei = schreibe_export(
        tmp_path, [funktionspunkt(1, "Licht", **{"knx:datapointType": {"@id": "knx:switch"}})]
    )
    punkt = lies_semantischen_export(datei).datenpunkte[0]
    assert punkt.dpt is not None
    assert punkt.dpt.wert == "DPST-1-1"
    assert punkt.dpt.quelle is Quelle.ETS_SEMANTIK


def test_dpt_aus_eindeutigem_kommunikationsobjekt(tmp_path: Path) -> None:
    datei = schreibe_export(
        tmp_path,
        [
            funktionspunkt(1, "Licht", **{"core:groups": [{"@id": "prj:DP-1"}]}),
            {
                "@id": "prj:DP-1",
                "@type": ["core:Datapoint"],
                "knx:datapointType": {"@id": "knx:bool"},
            },
        ],
    )
    punkt = lies_semantischen_export(datei).datenpunkte[0]
    assert punkt.dpt is not None
    assert punkt.dpt.wert == "DPST-1-2"
    assert punkt.dpt.quelle is Quelle.SEMANTIK_KOMMOBJEKT


def test_widersprechende_dpts_ergeben_keine_zuordnung(tmp_path: Path) -> None:
    datei = schreibe_export(
        tmp_path,
        [
            funktionspunkt(
                1, "Licht", **{"core:groups": [{"@id": "prj:DP-1"}, {"@id": "prj:DP-2"}]}
            ),
            {
                "@id": "prj:DP-1",
                "@type": ["core:Datapoint"],
                "knx:datapointType": {"@id": "knx:bool"},
            },
            {
                "@id": "prj:DP-2",
                "@type": ["core:Datapoint"],
                "knx:datapointType": {"@id": "knx:switch"},
            },
        ],
    )
    ergebnis = lies_semantischen_export(datei)
    assert ergebnis.datenpunkte[0].dpt is None
    assert any("widersprechende DPTs" in hinweis for hinweis in ergebnis.hinweise)


def _geraetekette(raum_id: str, raum_typ: str, raum_titel: str) -> list[dict[str, Any]]:
    return [
        {
            "@id": raum_id,
            "@type": [raum_typ],
            "dct:title": raum_titel,
            "loc:containsEquipment": {"@id": f"prj:DEV-{raum_titel}"},
        },
        {
            "@id": f"prj:DEV-{raum_titel}",
            "@type": ["core:Device"],
            "core:hosts": {"@id": f"prj:AP-{raum_titel}"},
        },
        {
            "@id": f"prj:AP-{raum_titel}",
            "@type": ["core:ApplicationProgram"],
            "core:implements": {"@id": f"prj:FU-{raum_titel}"},
        },
        {
            "@id": f"prj:FU-{raum_titel}",
            "@type": ["core:Functionality"],
            "core:hasPoint": {"@id": f"prj:DP-{raum_titel}"},
        },
        {"@id": f"prj:DP-{raum_titel}", "@type": ["core:Datapoint"]},
    ]


def test_raum_ueber_geraetekette(tmp_path: Path) -> None:
    datei = schreibe_export(
        tmp_path,
        [
            funktionspunkt(1, "Licht", **{"core:groups": [{"@id": "prj:DP-Kueche"}]}),
            *_geraetekette("prj:BP-1", "loc:Room", "Kueche"),
        ],
    )
    punkt = lies_semantischen_export(datei).datenpunkte[0]
    assert punkt.raum is not None
    assert punkt.raum.wert == "Kueche"
    assert punkt.raum.quelle is Quelle.SEMANTIK_GERAETEKETTE
    assert punkt.raum.konfidenz == 0.8


def test_raum_unsicher_wenn_aktor_im_schaltschrank(tmp_path: Path) -> None:
    datei = schreibe_export(
        tmp_path,
        [
            funktionspunkt(
                1,
                "Licht",
                **{"core:groups": [{"@id": "prj:DP-Kueche"}, {"@id": "prj:DP-Verteilung"}]},
            ),
            *_geraetekette("prj:BP-1", "loc:Room", "Kueche"),
            *_geraetekette("prj:BP-2", "loc:Space", "Verteilung"),
        ],
    )
    ergebnis = lies_semantischen_export(datei)
    punkt = ergebnis.datenpunkte[0]
    assert punkt.raum is not None
    assert punkt.raum.konfidenz == 0.5
    assert any("Bedienort" in hinweis for hinweis in ergebnis.hinweise)


def test_nur_betriebsmittelort_ergibt_keinen_raum(tmp_path: Path) -> None:
    datei = schreibe_export(
        tmp_path,
        [
            funktionspunkt(1, "Licht", **{"core:groups": [{"@id": "prj:DP-Verteilung"}]}),
            *_geraetekette("prj:BP-2", "loc:Space", "Verteilung"),
        ],
    )
    ergebnis = lies_semantischen_export(datei)
    assert ergebnis.datenpunkte[0].raum is None
    assert "Betriebsmittelort" in ergebnis.rueckfragen[0].frage


def test_mehrdeutiger_raum_ergibt_keine_zuordnung(tmp_path: Path) -> None:
    datei = schreibe_export(
        tmp_path,
        [
            funktionspunkt(
                1, "Licht", **{"core:groups": [{"@id": "prj:DP-Kueche"}, {"@id": "prj:DP-Bad"}]}
            ),
            *_geraetekette("prj:BP-1", "loc:Room", "Kueche"),
            *_geraetekette("prj:BP-2", "loc:Room", "Bad"),
        ],
    )
    ergebnis = lies_semantischen_export(datei)
    assert ergebnis.datenpunkte[0].raum is None
    assert "mehrdeutig" in ergebnis.rueckfragen[0].frage


def test_fehlendes_smart_linking_wird_gemeldet(tmp_path: Path) -> None:
    datei = schreibe_export(tmp_path, [funktionspunkt(1, "Licht")])
    ergebnis = lies_semantischen_export(datei)
    assert any("Smart Linking" in hinweis for hinweis in ergebnis.hinweise)


def test_fehlende_ga_hierarchie_wird_gemeldet(musterprojekt: PfadErgebnis) -> None:
    assert any(
        "Gruppenadress-Hierarchie" in hinweis for hinweis in musterprojekt.hinweise
    )


def test_musterprojekt_kennzahlen(musterprojekt: PfadErgebnis) -> None:
    assert musterprojekt.projekt == "10000Musterprojekt"
    assert len(musterprojekt.datenpunkte) == 194
    assert musterprojekt.pfad == "a"
    mit_raum = sum(1 for p in musterprojekt.datenpunkte if p.raum is not None)
    mit_rolle = sum(1 for p in musterprojekt.datenpunkte if p.rolle is not None)
    assert mit_raum == 83
    assert mit_rolle == 149


def test_musterprojekt_ga_formatierung(musterprojekt: PfadErgebnis) -> None:
    punkt = next(p for p in musterprojekt.datenpunkte if p.ga == 2305)
    assert punkt.ga_text == "1/1/1"
    assert punkt.name == "Licht A Küche"


def test_charakterisierung(tmp_path: Path) -> None:
    datei = schreibe_export(tmp_path, [funktionspunkt(1, "Licht")])
    beschreibung = charakterisiere(datei)
    assert "@graph-Knoten: 1" in beschreibung
    assert "core" in beschreibung
