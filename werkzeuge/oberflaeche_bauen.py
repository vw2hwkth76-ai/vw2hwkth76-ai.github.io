"""Baut dist/konfigurator.html aus Vorlage und Demo-Bundle.

Aufruf:
    python3 werkzeuge/oberflaeche_bauen.py <bundle.json> [ziel.html]

Das Bundle wird als JSON in die Seite eingebettet, damit die Oberflaeche ohne
Server und ohne Netzzugriff laeuft.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
VORLAGE = WURZEL / "oberflaeche/vorlage.html"
IMPORT = WURZEL / "oberflaeche/import.js"
STANDARDZIEL = WURZEL / "dist/konfigurator.html"


def baue(bundle_pfad: Path, ziel: Path) -> None:
    bundle = json.loads(bundle_pfad.read_text(encoding="utf-8"))
    kompakt = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    kompakt = kompakt.replace("</script", "<\\/script")
    seite = VORLAGE.read_text(encoding="utf-8")
    seite = seite.replace("__IMPORT__", IMPORT.read_text(encoding="utf-8"))
    seite = seite.replace("__BUNDLE__", kompakt)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    ziel.write_text(seite, encoding="utf-8")
    projekte = bundle.get("projekte", [bundle])
    print(f"{ziel} ({len(seite) // 1024} KB, {len(projekte)} Projekt(e))")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    ziel = Path(sys.argv[2]) if len(sys.argv) > 2 else STANDARDZIEL
    baue(Path(sys.argv[1]), ziel)
    return 0


if __name__ == "__main__":
    sys.exit(main())
