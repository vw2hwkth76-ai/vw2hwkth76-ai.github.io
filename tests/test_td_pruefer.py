from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import WURZEL

from ets2td.td.pruefer import CLI_RELATIV, ValidatorNichtInstalliert, validiere_tds

VALIDATOR = WURZEL / "validator"

GUELTIGE_TD = {
    "@context": "https://www.w3.org/2022/wot/td/v1.1",
    "@type": "Thing",
    "title": "Testding",
    "securityDefinitions": {"nosec_sc": {"scheme": "nosec"}},
    "security": "nosec_sc",
    "properties": {
        "licht": {
            "type": "boolean",
            "forms": [{"href": "knx://1/2/3", "op": ["readproperty"]}],
        }
    },
}


def test_fehlende_installation_wird_gemeldet(tmp_path: Path) -> None:
    with pytest.raises(ValidatorNichtInstalliert, match="npm install"):
        validiere_tds([tmp_path / "x.json"], tmp_path)


@pytest.mark.skipif(
    not (VALIDATOR / CLI_RELATIV).exists(), reason="Playground-CLI nicht installiert"
)
def test_gueltige_td_besteht(tmp_path: Path) -> None:
    datei = tmp_path / "gut.td.json"
    datei.write_text(json.dumps(GUELTIGE_TD))
    ergebnis = validiere_tds([datei], VALIDATOR)
    assert ergebnis.bestanden
    assert ergebnis.dateien[0].checks["schema"] == "passed"


@pytest.mark.skipif(
    not (VALIDATOR / CLI_RELATIV).exists(), reason="Playground-CLI nicht installiert"
)
def test_kaputte_td_faellt_durch(tmp_path: Path) -> None:
    datei = tmp_path / "kaputt.td.json"
    datei.write_text(json.dumps({"title": "Kaputt"}))
    ergebnis = validiere_tds([datei], VALIDATOR)
    assert not ergebnis.bestanden
    assert ergebnis.dateien[0].checks["schema"] == "failed"
    assert ergebnis.dateien[0].fehlerzeilen
