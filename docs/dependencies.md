# Abhaengigkeiten und Lizenzen

Stand 2026-08-27. Regel des Projekts: keine Copyleft-Lizenzen, xknxproject
(GPL-2.0-only) wird nicht verwendet, auch nicht dessen Test-Fixtures.

## Laufzeit (Python)

| Abhaengigkeit | Version | Lizenz (SPDX) |
|---|---|---|
| Python-Standardbibliothek (zipfile, xml.etree, json, argparse, ...) | 3.11+ | PSF-2.0 |

Der Kern hat keine externen Laufzeitabhaengigkeiten. Auswertung,
TD-Erzeugung und Konfigurator laufen allein mit der Standardbibliothek.

## Laufzeit des CoAP-Gateways (optionales Extra `gateway`)

Nur noetig fuer `ets2td-gateway`, also den Buszugriff. Installation mit
`pip install -e .[gateway]`.

| Abhaengigkeit | Version | Lizenz (SPDX) |
|---|---|---|
| aiocoap | 0.4.17 | MIT AND BSD-3-Clause |
| xknx | 3.20.0 | MIT |
| cbor2 | 6.1.4 | MIT |

Transitiv kommen hinzu: cryptography (Apache-2.0 OR BSD-3-Clause, ueber
xknx fuer KNX Secure), cffi (MIT-0), pycparser (BSD-3-Clause), ifaddr (MIT)
und typing-extensions (PSF-2.0). Vollscan ueber den Abhaengigkeitsbaum der
drei Wurzeln: 3 MIT, je 1 MIT-0, BSD-3-Clause, PSF-2.0,
"MIT AND BSD-3-Clause" und "Apache-2.0 OR BSD-3-Clause". Kein Copyleft, kein
Paket ohne Lizenzangabe. Bei der Dual-Lizenz von cryptography gilt die
gewaehlte permissive Option.

aiocoap liefert keinen py.typed-Marker aus, deshalb steht in pyproject.toml
eine mypy-Ausnahme fuer `aiocoap.*`. Sie gilt ausschliesslich fuer das
Gateway; der Kern bleibt vollstaendig unter --strict geprueft.

## Laufzeit fuer geschuetzte Projekte (optionales Extra `passwort`)

Nur noetig, wenn ein knxproj mit gesetztem Projektpasswort gelesen werden
soll. Installation mit `pip install -e .[passwort]`.

| Abhaengigkeit | Lizenz (SPDX) |
|---|---|
| cryptography | Apache-2.0 OR BSD-3-Clause |

Gebraucht wird davon allein die AES-Blockchiffre. Das Format selbst
(WinZip-AES: PBKDF2-HMAC-SHA1 mit 1000 Runden, Zaehlermodus mit
little-endian Zaehler, HMAC-SHA1 als Signatur) steckt in
`src/ets2td/knxproj/archiv.py` und braucht sonst nur die
Standardbibliothek. Im Browser uebernimmt das die Web-Crypto-Schnittstelle,
dort kommt keine Abhaengigkeit hinzu.

## Entwicklung (Python)

| Abhaengigkeit | Lizenz (SPDX) |
|---|---|
| pytest | MIT |
| mypy | MIT |
| ruff | MIT |
| pyzipper | MIT |
| setuptools (Build-Backend) | MIT |

pyzipper dient ausschliesslich dazu, in den Tests verschluesselte Archive zu
erzeugen. Damit wird die eigene Entschluesselung gegen eine unabhaengige
Implementierung geprueft; ein Rundlauf durch den eigenen Code waere
zirkulaer. Es wird nicht ausgeliefert. Seine Abhaengigkeit pycryptodomex
steht unter BSD-2-Clause beziehungsweise Public Domain.

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
| Eclipse 4diac FORTE (IEC 61499) | EPL-2.0, schwaches Copyleft. Als eigenstaendige Laufzeit neben dem Gateway betreibbar, aber nicht einbettbar, ohne die Projektregel zu verletzen. Fuer eine Kopplung waere MQTT der Weg, den beide Seiten ohne Eigenbau sprechen. |

## Wozu es kein Binding gibt

Die W3C fuehrt Bindings fuer HTTP, CoAP, MQTT, Modbus, BACnet, PROFINET,
LoRaWAN und OPC-UA. **Ein KNX-Binding gibt es nicht.** Deshalb tragen die
erzeugten Thing Descriptions `knx://<gruppenadresse>` als Kennung, nicht als
Protokoll: sie benennen die Adresse, ohne einen Zugriffsweg zu behaupten.
Erst das Gateway bindet sie an CoAP und schreibt die Forms entsprechend um.

Der CoAP-Praefix `cov` zeigt auf `https://www.w3.org/2019/wot/coap#`,
uebernommen aus der Kontextdatei des Bindings im Repo w3c/wot-binding-templates.
