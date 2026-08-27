# Abhaengigkeiten und Lizenzen

Stand 2026-08-26. Regel des Projekts: keine Copyleft-Lizenzen, xknxproject
(GPL-2.0-only) wird nicht verwendet, auch nicht dessen Test-Fixtures.

## Laufzeit (Python)

| Abhaengigkeit | Version | Lizenz (SPDX) |
|---|---|---|
| Python-Standardbibliothek (zipfile, xml.etree, json, argparse, ...) | 3.11+ | PSF-2.0 |

Keine externen Laufzeitabhaengigkeiten. xknx (MIT) wird nicht gebraucht,
weil kein Buszugriff stattfindet.

## Entwicklung (Python)

| Abhaengigkeit | Lizenz (SPDX) |
|---|---|
| pytest | MIT |
| mypy | MIT |
| ruff | MIT |
| setuptools (Build-Backend) | MIT |

## Validierung (Node, nur Entwicklung, wird nicht mit ausgeliefert)

| Abhaengigkeit | Version | Lizenz (SPDX) |
|---|---|---|
| Node.js (Laufzeitumgebung) | 22 | MIT |
| @thing-description-playground/cli | 1.6.0 | MIT |

Vollscan aller 248 transitiv installierten npm-Pakete (license-Feld der
package.json): 208 MIT, 13 Apache-2.0, 8 BSD-3-Clause, 5 ISC,
3 BSD-2-Clause, 3 W3C-20150513, je 1 CC0-1.0, Unlicense, Python-2.0,
(MIT OR Apache-2.0), (AFL-2.1 OR BSD-3-Clause) sowie
@node-wot/td-tools 0.8.16 mit "EPL-2.0 OR W3C-20150513". Bei den
Dual-Lizenzen gilt die permissive Option (W3C-20150513 beziehungsweise
BSD-3-Clause), es entsteht kein Copyleft-Zwang. Drei Pakete deklarieren
kein license-Feld: @ewoudenberg/difflib 0.1.0, backslash 0.2.2,
dreamopt 0.8.0; alle drei sind reine Dev-Werkzeuge im Validatorpfad und
werden nicht distribuiert. Wer sie meiden will, laesst die Validierung in
einer isolierten Umgebung laufen.

## Daten

| Daten | Quelle | Lizenz (SPDX) |
|---|---|---|
| beispiele/style1 bis style3.knxproj | github.com/laurent-martin/ets-to-homeassistant | Apache-2.0 |
| beispiele/demoprojekt.knxproj | github.com/Blizzard26/knxTools | CC-BY-4.0 (Namensnennung, kein Copyleft) |
| beispiele/musterprojekt-ets6.* | reales Kundenprojekt, anonymisiert | Nutzung im Rahmen dieses Prototyps |
| src/ets2td/pfad_a/daten/kim_dpt.json | abgeleitet aus der KIM-Ontologie | MIT (KNX Association) |
| KIM-Ontologie (nicht eingecheckt, per URL) | gitlab.knx.org/public-projects/hbes-information-model | MIT |

Die Datei `kim_dpt.json` enthaelt 389 Zuordnungen von KIM-Datenpunkttyp zu
ETS-Kennung, erzeugt mit `werkzeuge/kim_dpt_tabelle.py` aus der
MIT-lizenzierten Ontologie. Die vollstaendige Ontologie (4 MB Turtle
beziehungsweise 8 MB JSON-LD) wird nicht mitgeliefert.

Details und Abrufdatum: beispiele/LIZENZEN.md.

## Bewusst ausgeschlossen

| Projekt | Grund |
|---|---|
| xknxproject | GPL-2.0-only, laut Vorgabe tabu, eigener Parser implementiert |
| Test-Fixtures aus xknxproject | Teil desselben GPL-Repos |
| EPL-only-Quellen (z. B. guw/knx-utils) | schwaches Copyleft |
