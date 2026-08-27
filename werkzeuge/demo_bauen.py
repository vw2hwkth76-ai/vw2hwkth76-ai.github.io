"""Baut das Demo-Bundle ueber mehrere Projekte und erzeugt die Oberflaeche.

Aufruf:
    python3 werkzeuge/demo_bauen.py [--out dist/konfigurator.html]

Die Projektliste steht unten in PROJEKTE. Jedes Projekt wird durch beide
Pfade geschickt, die Thing Descriptions werden erzeugt und mit dem Eclipse
Thingweb Playground geprueft; das Ergebnis der Pruefung landet als Kennzahl
im Bundle, damit die Oberflaeche keine Behauptung aufstellt, die niemand
geprueft hat.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

WURZEL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WURZEL / "src"))
sys.path.insert(0, str(WURZEL))

from ets2td.knxproj.leser import lies_knxproj  # noqa: E402
from ets2td.knxproj.stammdaten import Stammdaten  # noqa: E402
from ets2td.konfigurator.bundle import baue_bundle  # noqa: E402
from ets2td.modell import DIMENSIONEN, PfadErgebnis  # noqa: E402
from ets2td.pfad_a.graph import KeinKnxExport  # noqa: E402
from ets2td.pfad_a.leser import lies_semantischen_export  # noqa: E402
from ets2td.pfad_b.ableitung import leite_ab  # noqa: E402
from ets2td.td.bauer import baue_tds  # noqa: E402
from ets2td.td.pruefer import ValidatorNichtInstalliert, validiere_tds  # noqa: E402
from werkzeuge.oberflaeche_bauen import baue as baue_oberflaeche  # noqa: E402


@dataclass(frozen=True)
class Projektquelle:
    schluessel: str
    titel: str
    untertitel: str
    knxproj: Path
    export: Path | None = None


PROJEKTE = (
    Projektquelle(
        schluessel="muster-ets6",
        titel="Bestandsanlage ETS6",
        untertitel="194 Gruppenadressen, 40 Geraete, ohne Smart Linking",
        knxproj=WURZEL / "beispiele/musterprojekt-ets6.knxproj",
        export=WURZEL / "beispiele/musterprojekt-ets6.jsonld",
    ),
    Projektquelle(
        schluessel="style-ets5",
        titel="Einfamilienhaus ETS5",
        untertitel="251 Gruppenadressen, 98 gepflegte Funktionen",
        knxproj=WURZEL / "beispiele/style3.knxproj",
    ),
)


def _pruefe(ergebnis: PfadErgebnis, stammdaten: Stammdaten) -> str:
    validator = WURZEL / "validator"
    with tempfile.TemporaryDirectory() as verzeichnis:
        ziel = Path(verzeichnis)
        dateien = []
        for name, td in baue_tds(ergebnis, stammdaten).items():
            pfad = ziel / name
            pfad.write_text(json.dumps(td, indent=2, ensure_ascii=False), encoding="utf-8")
            dateien.append(pfad)
        try:
            bericht = validiere_tds(dateien, validator)
        except ValidatorNichtInstalliert:
            return f"{len(dateien)} Thing Descriptions erzeugt, Validator nicht installiert"
    if bericht.bestanden:
        return (
            f"Alle {len(bericht.dateien)} Thing Descriptions bestehen die "
            "Referenzvalidierung (JSON, Schema, JSON-LD, Zusatzchecks)"
        )
    return f"{len(bericht.fehlgeschlagen)} von {len(bericht.dateien)} nicht bestanden"


def _abdeckung(ergebnis: PfadErgebnis) -> dict[str, int]:
    return {
        dimension: sum(
            1 for punkt in ergebnis.datenpunkte if punkt.zuordnung(dimension) is not None
        )
        for dimension in DIMENSIONEN
    }


def baue_projekt(quelle: Projektquelle) -> dict[str, Any]:
    projekt = lies_knxproj(quelle.knxproj)
    ergebnisse: dict[str, PfadErgebnis] = {}

    if quelle.export is not None:
        try:
            ergebnisse["a"] = lies_semantischen_export(quelle.export, ga_stil=projekt.ga_stil)
        except KeinKnxExport as fehler:
            print(f"  Pfad A entfaellt: {fehler}")

    ergebnisse["b"] = leite_ab(projekt)
    if projekt.funktionen:
        ergebnisse["b-pur"] = leite_ab(projekt, heuristik_pur=True)

    reihenfolge = [name for name in ("a", "b", "b-pur") if name in ergebnisse]
    geordnet = {name: ergebnisse[name] for name in reihenfolge}

    kennzahlen: dict[str, Any] = {
        "quelle": quelle.untertitel,
        "validierung": _pruefe(geordnet["b"], projekt.stammdaten),
        "abdeckung": {name: _abdeckung(e) for name, e in geordnet.items()},
        "funktionen": len(projekt.funktionen),
        "geraete": len(projekt.geraete),
        "ga_stil": projekt.ga_stil,
        "erstellt_mit": projekt.erstellt_mit,
    }
    bundle = baue_bundle(geordnet, projekt.stammdaten, projekt.name, kennzahlen)
    bundle["schluessel"] = quelle.schluessel
    bundle["titel"] = quelle.titel
    bundle["untertitel"] = quelle.untertitel
    print(
        f"  {quelle.titel}: {len(geordnet['b'].datenpunkte)} Datenpunkte, "
        f"Pfade {', '.join(reihenfolge)}"
    )
    return bundle


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=WURZEL / "dist/konfigurator.html")
    parser.add_argument("--bundle", type=Path, help="Bundle zusaetzlich als JSON ablegen")
    args = parser.parse_args()

    projekte = []
    for quelle in PROJEKTE:
        if not quelle.knxproj.exists():
            print(f"  uebersprungen, Datei fehlt: {quelle.knxproj}")
            continue
        print(f"Verarbeite {quelle.titel} ...")
        projekte.append(baue_projekt(quelle))

    if not projekte:
        print("Kein Projekt verarbeitet.", file=sys.stderr)
        return 2

    sammlung = {
        "projekte": projekte,
        "parameter": projekte[0]["parameter"],
        "regeln": projekte[0]["regeln"],
    }
    for eintrag in projekte:
        eintrag.pop("parameter", None)
        eintrag.pop("regeln", None)

    with tempfile.TemporaryDirectory() as verzeichnis:
        zwischen = Path(verzeichnis) / "bundle.json"
        zwischen.write_text(
            json.dumps(sammlung, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        if args.bundle:
            args.bundle.parent.mkdir(parents=True, exist_ok=True)
            args.bundle.write_text(
                json.dumps(sammlung, ensure_ascii=False, indent=1), encoding="utf-8"
            )
        baue_oberflaeche(zwischen, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
