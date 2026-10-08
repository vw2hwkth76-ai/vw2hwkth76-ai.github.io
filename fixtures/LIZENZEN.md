# Herkunft und Lizenzen der Testdaten

## oeffentlich/

Übernommen aus dem Vorgänger `ets2td`, dort am 2026-08-26 aus öffentlichen
Repositories bezogen. Keine Quelle steht unter einer Copyleft-Lizenz.

| Datei | Quelle | Lizenz (SPDX) |
|---|---|---|
| style1.knxproj, style2.knxproj, style3.knxproj | github.com/laurent-martin/ets-to-homeassistant (examples/Style1-3.knxproj) | Apache-2.0 |
| demoprojekt.knxproj | github.com/Blizzard26/knxTools (example/ExampleProject.knxproj) | CC-BY-4.0 |
| style.gold.json, demoprojekt.gold.json | Gold-Standards aus `ets2td`, abgeleitet aus ETS-Funktionen, Gebäudestruktur und gepflegten DPTs | wie das jeweilige Projekt |

- style1 bis style3 sind dasselbe ETS5-Projekt (Einfamilienhaus, englische
  Namen, Funktionen gepflegt) in den GA-Stilen Free, TwoLevel und ThreeLevel.
  Sie enthalten keine Herstellerdaten und keine Geräte.
- demoprojekt ist ein ETS5.7-Projekt mit Geräten, Herstellerdaten
  (M-0004, M-0083, darunter eine 52-MB-Applikation) und
  KO-Verknüpfungen.
- Die Projektdateien von xknxproject (GPL-2.0-only) werden bewusst nicht
  verwendet, auch nicht deren Test-Fixtures.

## archiv/

Selbst erzeugt mit `scripts/fixtures/archive_fixtures.py`, und zwar mit
unabhängigen Werkzeugen: pyzipper 0.4.0 (MIT) für WinZip-AES, Info-ZIP für
ZipCrypto und ZIP64. Die Prüfung des eigenen Entschlüsselungscodes ist damit
nicht zirkulär. Inhalt: synthetischer Text, keine Projektdaten.

`ets6-geschuetzt.knxproj` folgt der öffentlich beschriebenen
ETS6-Passwortableitung (PBKDF2-HMAC-SHA256, UTF-16LE, Salz
`21.project.ets.knx.org`, 65536 Runden, Base64). Gegen ein echtes, in der
ETS6 geschütztes Projekt ist sie noch nicht geprüft.

## privat/ (nicht im Repository)

Kundenprojekte bleiben lokal, der Ordner steht in `.gitignore`. Benchmarks
gegen diese Projekte laufen nur, wenn die Dateien vorhanden sind.
