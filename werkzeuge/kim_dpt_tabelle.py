"""Erzeugt src/ets2td/pfad_a/daten/kim_dpt.json aus der KIM-Ontologie.

Aufruf:
    python3 werkzeuge/kim_dpt_tabelle.py <pfad-zur-ontology.ttl>

Die Ontologie stammt aus https://gitlab.knx.org/public-projects/hbes-information-model
(MIT). Abgebildet werden nur DatapointType-Individuen, die sowohl
knx:dptMajorNumber als auch knx:dptMinorNumber tragen; daraus entsteht die
ETS-Kennung DPST-<major>-<minor>.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "src/ets2td/pfad_a/daten/kim_dpt.json"

INDIVIDUUM = re.compile(r"(knx:[\w.]+) a knx:DatapointType")
MAJOR = re.compile(r'knx:dptMajorNumber "(\d+)"')
MINOR = re.compile(r'knx:dptMinorNumber "(\d+)"')
TITEL = re.compile(r'dct:title "([^"]*)"')


def erzeuge(ontologie: str) -> dict[str, dict[str, str]]:
    tabelle: dict[str, dict[str, str]] = {}
    for block in re.split(r"\n(?=\S)", ontologie):
        name = INDIVIDUUM.match(block)
        major = MAJOR.search(block)
        minor = MINOR.search(block)
        if not (name and major and minor):
            continue
        titel = TITEL.search(block)
        tabelle[name.group(1)] = {
            "dpst": f"DPST-{major.group(1)}-{int(minor.group(1))}",
            "titel": titel.group(1) if titel else "",
        }
    return tabelle


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    tabelle = erzeuge(Path(sys.argv[1]).read_text(encoding="utf-8"))
    ZIEL.write_text(
        json.dumps(tabelle, indent=1, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"{len(tabelle)} DPT-Individuen nach {ZIEL} geschrieben.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
