from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from conftest import BEISPIELE, WURZEL

from ets2td.knxproj.leser import formatiere_ga, lies_knxproj
from ets2td.konfigurator.vorbelegung import vorbelegung, wertebereich_text
from ets2td.pfad_b.ableitung import leite_ab

HARNESS = WURZEL / "tests/hilfen/paritaet.mjs"
SEITE = WURZEL / "dist/konfigurator.html"

fehlt = (
    not HARNESS.exists()
    or not SEITE.exists()
    or shutil.which("node") is None
    or not Path("/opt/pw-browsers/chromium").exists()
)

pytestmark = pytest.mark.skipif(
    fehlt,
    reason="Oberflaeche oder Playwright fehlt (python3 werkzeuge/demo_bauen.py ausfuehren)",
)


def _browser_ergebnis(knxproj: Path) -> dict[str, Any]:
    lauf = subprocess.run(
        ["node", str(HARNESS), str(SEITE), str(knxproj)],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=WURZEL,
        check=False,
    )
    if lauf.returncode != 0:
        pytest.fail(f"Browserlauf fehlgeschlagen: {lauf.stderr[:600]}")
    return dict(json.loads(lauf.stdout.strip().splitlines()[-1]))


def _python_ergebnis(knxproj: Path) -> dict[int, dict[str, Any]]:
    projekt = lies_knxproj(knxproj)
    ergebnis = leite_ab(projekt)
    daten: dict[int, dict[str, Any]] = {}
    for punkt in ergebnis.datenpunkte:
        dpt = punkt.dpt.wert if punkt.dpt is not None else ""
        daten[punkt.ga] = {
            "ga_text": formatiere_ga(punkt.ga, projekt.ga_stil),
            "name": punkt.name,
            "dpt": dpt,
            "raum": punkt.raum.wert if punkt.raum else None,
            "raum_quelle": punkt.raum.quelle.value if punkt.raum else None,
            "funktion": punkt.funktion.wert if punkt.funktion else None,
            "rolle": punkt.rolle.wert if punkt.rolle else None,
            "rolle_quelle": punkt.rolle.quelle.value if punkt.rolle else None,
            "dpt_quelle": punkt.dpt.quelle.value if punkt.dpt else None,
            "wertebereich": wertebereich_text(dpt, projekt.stammdaten) if dpt else "",
            "werte": vorbelegung(punkt, projekt.stammdaten),
        }
    return daten


@pytest.mark.parametrize(
    "dateiname", ["musterprojekt-ets6.knxproj", "style3.knxproj", "demoprojekt.knxproj"]
)
def test_browser_leitet_wie_python_ab(dateiname: str) -> None:
    knxproj = BEISPIELE / dateiname
    browser = _browser_ergebnis(knxproj)
    assert "fehler" not in browser, browser.get("fehler")
    python = _python_ergebnis(knxproj)

    js = {int(p["ga"]): p for p in browser["punkte"]}
    assert set(js) == set(python), "Unterschiedliche Gruppenadressen gefunden"

    abweichungen: list[str] = []
    for ga, erwartet in sorted(python.items()):
        erhalten = js[ga]
        for feld in (
            "ga_text",
            "name",
            "dpt",
            "raum",
            "raum_quelle",
            "funktion",
            "rolle",
            "rolle_quelle",
            "dpt_quelle",
            "wertebereich",
        ):
            if erwartet[feld] != erhalten[feld]:
                abweichungen.append(
                    f"GA {erwartet['ga_text']} '{erwartet['name']}' Feld {feld}: "
                    f"Python={erwartet[feld]!r} Browser={erhalten[feld]!r}"
                )
    assert not abweichungen, (
        f"{len(abweichungen)} Abweichungen zwischen Python und Browser:\n"
        + "\n".join(abweichungen[:25])
    )


def test_vorbelegung_stimmt_ueberein() -> None:
    knxproj = BEISPIELE / "style3.knxproj"
    browser = _browser_ergebnis(knxproj)
    python = _python_ergebnis(knxproj)
    js = {int(p["ga"]): p for p in browser["punkte"]}

    abweichungen: list[str] = []
    for ga, erwartet in sorted(python.items()):
        for schluessel, wert in erwartet["werte"].items():
            erhalten = js[ga]["werte"].get(schluessel)
            if (
                isinstance(wert, float)
                and isinstance(erhalten, int | float)
                and abs(wert - float(erhalten)) < 0.01
            ):
                continue
            if wert != erhalten:
                abweichungen.append(
                    f"GA {erwartet['ga_text']} Parameter {schluessel}: "
                    f"Python={wert!r} Browser={erhalten!r}"
                )
    assert not abweichungen, (
        f"{len(abweichungen)} Abweichungen in der Vorbelegung:\n" + "\n".join(abweichungen[:25])
    )
