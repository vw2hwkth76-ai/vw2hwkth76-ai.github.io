from __future__ import annotations

import re
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

CLI_RELATIV = Path("node_modules") / "@thing-description-playground" / "cli" / "index.js"

PFLICHT_CHECKS = ("json", "schema", "additional")
_STATUS_MUSTER = re.compile(r"(\w+): '(passed|failed|warning)'")


class ValidatorNichtInstalliert(Exception):
    pass


@dataclass
class DateiPruefung:
    datei: str
    checks: dict[str, str] = field(default_factory=dict)
    fehlerzeilen: list[str] = field(default_factory=list)

    @property
    def bestanden(self) -> bool:
        return all(self.checks.get(check) == "passed" for check in PFLICHT_CHECKS)


@dataclass
class PruefErgebnis:
    dateien: list[DateiPruefung] = field(default_factory=list)

    @property
    def bestanden(self) -> bool:
        return bool(self.dateien) and all(datei.bestanden for datei in self.dateien)

    @property
    def fehlgeschlagen(self) -> list[DateiPruefung]:
        return [datei for datei in self.dateien if not datei.bestanden]


def validiere_tds(
    td_dateien: Sequence[Path],
    validator_verzeichnis: Path,
    mit_jsonld: bool = False,
) -> PruefErgebnis:
    cli = validator_verzeichnis / CLI_RELATIV
    if not cli.exists():
        raise ValidatorNichtInstalliert(
            f"Playground-CLI nicht gefunden unter {cli}. "
            f"Bitte einmalig 'npm install' in {validator_verzeichnis} ausfuehren."
        )
    ergebnis = PruefErgebnis()
    for datei in td_dateien:
        kommando = ["node", str(cli)]
        if not mit_jsonld:
            kommando.append("--no-jsonld")
        kommando += ["--input", str(datei)]
        lauf = subprocess.run(
            kommando, capture_output=True, text=True, timeout=120, check=False
        )
        pruefung = DateiPruefung(datei=datei.name)
        report_teil = lauf.stdout.partition("--- Report")[2]
        for schluessel, status in _STATUS_MUSTER.findall(report_teil):
            if schluessel in ("json", "schema", "defaults", "jsonld", "additional"):
                pruefung.checks[schluessel] = status
        pruefung.fehlerzeilen = [
            zeile.strip()
            for zeile in lauf.stdout.splitlines()
            if zeile.startswith("X ") or zeile.startswith(">")
        ]
        if not pruefung.checks:
            pruefung.fehlerzeilen.append(
                "Keine Report-Ausgabe der Playground-CLI: " + lauf.stderr.strip()[:300]
            )
        ergebnis.dateien.append(pruefung)
    return ergebnis
