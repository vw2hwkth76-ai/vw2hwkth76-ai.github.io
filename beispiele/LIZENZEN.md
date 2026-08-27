# Herkunft und Lizenzen der Beispielprojekte

Alle Dateien wurden am 2026-08-26 aus oeffentlichen Repositories uebernommen.
Keine der Quellen steht unter einer Copyleft-Lizenz.

| Datei | Quelle | Lizenz (SPDX) |
|---|---|---|
| style1.knxproj | https://github.com/laurent-martin/ets-to-homeassistant (examples/Style1.knxproj) | Apache-2.0 |
| style2.knxproj | https://github.com/laurent-martin/ets-to-homeassistant (examples/Style2.knxproj) | Apache-2.0 |
| style3.knxproj | https://github.com/laurent-martin/ets-to-homeassistant (examples/Style3.knxproj) | Apache-2.0 |
| demoprojekt.knxproj | https://github.com/Blizzard26/knxTools (example/ExampleProject.knxproj) | CC-BY-4.0 |
| musterprojekt-ets6.knxproj | reales Kundenprojekt, vom Auftraggeber bereitgestellt, anonymisiert | Nutzung im Rahmen dieses Prototyps |
| musterprojekt-ets6.jsonld | semantischer Export desselben Projekts, anonymisiert | Nutzung im Rahmen dieses Prototyps |

Hinweise:

- style1 bis style3 sind dasselbe ETS5-Projekt (Einfamilienhaus, englische
  Namen, Funktionen und Gebaeudestruktur gepflegt) in den drei
  Gruppenadress-Stilen Free, TwoLevel und ThreeLevel. Die Adress-Integer
  sind in allen drei Dateien identisch.
- demoprojekt.knxproj ist ein ETS5-Projekt mit Geraeten samt
  Herstellerdaten, Kommunikationsobjekt-Verknuepfungen und den
  unveraenderten Standard-Gruppennamen ("New main group").
- Die Projektdateien von xknxproject (GPL-2.0-only) werden bewusst nicht
  verwendet, auch nicht deren Test-Fixtures.
- musterprojekt-ets6 ist ein ETS6-Projekt (6.3, Namespace 23) mit 194
  Gruppenadressen, 40 Geraeten und 13 Raeumen, ohne Funktions-Linking. Es ist
  das einzige Beispiel, das in beiden Formaten desselben Projekts vorliegt,
  und traegt deshalb den Vergleich der Pfade A und B.

Anonymisierung von musterprojekt-ets6 (`werkzeuge/anonymisieren.py`):

- Ersetzt wurden Projektname, Gebaeudename, Bearbeiterkuerzel, die
  Projekt-GUID und die Projektnummer; der Projektverlauf (`ProjectTraces`)
  wurde entfernt. Die Ersetzungstabelle steht bewusst nicht im Repository,
  sondern wird dem Werkzeug als eigene Datei uebergeben.
- Gruppenadressnamen, Raumnamen und die gesamte Struktur blieben
  unveraendert, damit die Fixture ihren Realitaetsgehalt behaelt. Sie
  enthalten keinen Personenbezug (geprueft).
- Entfernt wurden ausserdem die Herstellerdateien (`M-*`, rund 8,7 MB
  urheberrechtlich geschuetzte Produktdaten), Signaturen und Zertifikate.
  Das Archiv schrumpft dadurch von 8,9 MB auf 143 KB. `knx_master.xml`
  bleibt erhalten, weil daraus die Datenpunkttypen aufgeloest werden.
- Die Anonymisierung ist reproduzierbar, die Originaldateien liegen nicht
  im Repository.

Referenzdaten, nicht eingecheckt (per URL abrufbar):

| Daten | Quelle | Lizenz (SPDX) |
|---|---|---|
| KIM-Ontologie (EN 50090-6-2) | https://gitlab.knx.org/public-projects/hbes-information-model | MIT |
