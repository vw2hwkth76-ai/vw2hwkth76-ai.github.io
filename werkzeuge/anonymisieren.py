"""Anonymisiert ein knxproj samt zugehoerigem semantischen Export.

Aufruf:
    python3 werkzeuge/anonymisieren.py <projekt.knxproj> <export.jsonld> <ziel> \
        --ersetzungen <mapping.json>

Die Ersetzungstabelle steht bewusst NICHT in dieser Datei, sondern in einer
eigenen JSON-Datei, die nicht eingecheckt wird. Andernfalls stuenden die zu
entfernenden Klarnamen im Quelltext und die Anonymisierung waere wertlos.

Format der Mapping-Datei:
    {"texte": {"Alter Name": "Neuer Name"},
     "guids": {"7ec00eb4-...": "00000000-0000-0000-0000-000000000000"},
     "projektnummer": {"14007": "10000"}}

Ersetzt werden ausschliesslich personenbeziehbare Angaben. Gruppenadressnamen,
Raumnamen und Struktur bleiben unveraendert, damit die Fixture ihren
Realitaetsgehalt behaelt.

Aus dem Archiv entfernt werden zusaetzlich die Herstellerdateien (M-*),
Signaturen und Zertifikate: sie sind gross, urheberrechtlich geschuetzt und
fuer die Auswertung nicht noetig. knx_master.xml bleibt erhalten, weil daraus
die Datenpunkttypen aufgeloest werden.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

BEHALTEN = ("knx_master.xml",)
VERLAUF = re.compile(r"<ProjectTraces>.*?</ProjectTraces>", re.DOTALL)
VERLAUF_LEER = re.compile(r"<ProjectTraces\s*/>")
ZEITSTEMPEL = re.compile(r'(LastModified|ProjectStart|LastDownload|LastUsedPuid)="[^"]*"')


def lade_ersetzungen(pfad: Path) -> dict[str, str]:
    roh = json.loads(pfad.read_text(encoding="utf-8"))
    tabelle: dict[str, str] = {}
    for gruppe in ("texte", "guids", "projektnummer"):
        tabelle.update(roh.get(gruppe, {}))
    if not tabelle:
        raise SystemExit(f"{pfad} enthaelt keine Ersetzungen.")
    return tabelle


def ersetze(text: str, tabelle: dict[str, str]) -> str:
    for alt, neu in sorted(tabelle.items(), key=lambda paar: -len(paar[0])):
        text = text.replace(alt, neu)
    return text


def anonymisiere_knxproj(quelle: Path, ziel: Path, tabelle: dict[str, str]) -> None:
    with zipfile.ZipFile(quelle) as archiv, zipfile.ZipFile(
        ziel, "w", zipfile.ZIP_DEFLATED
    ) as neu:
        for eintrag in archiv.infolist():
            name = eintrag.filename
            if name.endswith("/"):
                continue
            behalten = name in BEHALTEN or re.match(r"P-[0-9A-F]+/", name)
            if not behalten:
                continue
            if name.endswith((".signature", ".certificate")):
                continue
            rohdaten = archiv.read(name)
            if name.endswith(".xml"):
                text = rohdaten.decode("utf-8")
                text = VERLAUF.sub("", text)
                text = VERLAUF_LEER.sub("", text)
                rohdaten = ersetze(text, tabelle).encode("utf-8")
            neu.writestr(ersetze(name, tabelle), rohdaten)


def anonymisiere_export(quelle: Path, ziel: Path, tabelle: dict[str, str]) -> None:
    daten = json.loads(ersetze(quelle.read_text(encoding="utf-8"), tabelle))
    ziel.write_text(
        json.dumps(daten, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def pruefe(pfad: Path, tabelle: dict[str, str]) -> list[str]:
    roh = pfad.read_bytes()
    return [alt for alt in tabelle if alt.encode("utf-8") in roh]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("knxproj", type=Path)
    parser.add_argument("export", type=Path)
    parser.add_argument("ziel", type=Path)
    parser.add_argument("--ersetzungen", type=Path, required=True)
    parser.add_argument("--name", default="musterprojekt-ets6")
    args = parser.parse_args()

    tabelle = lade_ersetzungen(args.ersetzungen)
    args.ziel.mkdir(parents=True, exist_ok=True)
    ziel_knxproj = args.ziel / f"{args.name}.knxproj"
    ziel_export = args.ziel / f"{args.name}.jsonld"

    anonymisiere_knxproj(args.knxproj, ziel_knxproj, tabelle)
    anonymisiere_export(args.export, ziel_export, tabelle)

    fehler = 0
    for pfad in (ziel_knxproj, ziel_export):
        print(f"{pfad} ({pfad.stat().st_size} Bytes)")
        rest = pruefe(pfad, tabelle)
        if rest:
            print(f"  WARNUNG: enthaelt weiterhin {rest}", file=sys.stderr)
            fehler += 1
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
