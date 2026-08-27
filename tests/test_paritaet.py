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


def _browser_ergebnis(knxproj: Path, passwort: str | None = None) -> dict[str, Any]:
    lauf = subprocess.run(
        ["node", str(HARNESS), str(SEITE), str(knxproj), *( [passwort] if passwort else [] )],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=WURZEL,
        check=False,
    )
    if lauf.returncode != 0:
        pytest.fail(f"Browserlauf fehlgeschlagen: {lauf.stderr[:600]}")
    return dict(json.loads(lauf.stdout.strip().splitlines()[-1]))


def _python_ergebnis(knxproj: Path, passwort: str | None = None) -> dict[int, dict[str, Any]]:
    projekt = lies_knxproj(knxproj, passwort)
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


def _verpacke_verschachtelt(quelle: Path, ziel: Path, passwort: str | None) -> None:
    """Baut aus einem Beispielprojekt die Form, die die ETS mit Passwort schreibt."""
    import io
    import zipfile

    innen = io.BytesIO()
    with zipfile.ZipFile(quelle) as alt:
        xmls = [n for n in alt.namelist() if n.startswith("P-") and n.endswith(".xml")]
        if passwort:
            pyzipper = pytest.importorskip("pyzipper", reason="nur zum Erzeugen der Fixture")
            with pyzipper.AESZipFile(
                innen, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES
            ) as neu:
                neu.setpassword(passwort.encode())
                for name in xmls:
                    neu.writestr(name.split("/")[-1], alt.read(name))
        else:
            with zipfile.ZipFile(innen, "w", zipfile.ZIP_DEFLATED) as neu:
                for name in xmls:
                    neu.writestr(name.split("/")[-1], alt.read(name))
        with zipfile.ZipFile(ziel, "w") as aussen:
            aussen.writestr("P-0001.zip", innen.getvalue())
            aussen.writestr("knx_master.xml", alt.read("knx_master.xml"))


@pytest.mark.parametrize("passwort", [None, "testpasswort"])
def test_verschachteltes_archiv_liest_sich_in_beiden_wegen_gleich(
    tmp_path: Path, passwort: str | None
) -> None:
    """Prueft die Archivschicht und, mit Passwort, zwei Entschluesselungen gegeneinander."""
    ziel = tmp_path / "verschachtelt.knxproj"
    _verpacke_verschachtelt(BEISPIELE / "musterprojekt-ets6.knxproj", ziel, passwort)

    browser = _browser_ergebnis(ziel, passwort)
    assert "fehler" not in browser, browser.get("fehler")
    python = _python_ergebnis(ziel, passwort)

    js = {int(p["ga"]): p for p in browser["punkte"]}
    assert set(js) == set(python)
    assert len(python) == 194

    abweichungen = [
        f"GA {erwartet['ga_text']} Feld {feld}"
        for ga, erwartet in sorted(python.items())
        for feld in ("ga_text", "name", "dpt", "raum", "funktion", "rolle", "wertebereich")
        if erwartet[feld] != js[ga][feld]
    ]
    assert not abweichungen, abweichungen[:10]
