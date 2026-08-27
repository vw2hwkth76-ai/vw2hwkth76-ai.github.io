# Verwendung

## Installation

```
pip install -e '.[dev]'
pip install -e '.[gateway]'    # nur fuer das CoAP-Gateway am Bus
cd validator && npm install    # einmalig, fuer --validieren
```

Python 3.11 oder neuer. Der Validator (Eclipse Thingweb Playground CLI)
braucht Node.js und wird als Subprozess aufgerufen.

## Aufrufe

```
ets2td beispiele/style3.knxproj --pfad b --out ausgabe/style3
ets2td beispiele/musterprojekt-ets6.knxproj beispiele/musterprojekt-ets6.jsonld \
    --pfad beide --gold beispiele/musterprojekt-ets6.gold.json \
    --out ausgabe/muster --validieren
```

Beide Dateien desselben Projekts zusammen zu uebergeben ist der Regelfall:
Pfad A liefert dann die Semantik aus dem Export, Pfad B die Heuristik aus dem
knxproj, und die Wertebereiche der TDs stammen aus der `knx_master.xml` im
knxproj. Ein semantischer Export allein funktioniert auch, dann fehlen den
TDs Einheiten und Wertebereiche; die CLI weist darauf hin.

Wichtige Schalter:

- `--gold <datei>`: misst Korrektheit gegen den Gold-Standard, sonst werden
  nur Abdeckungszahlen berichtet.
- `--gold-vorlage`: schreibt `gold-vorlage.json` aus Pfad B zum
  Handkorrigieren; leere Werte bedeuten unbewertet.
- `--je-funktion`: eine TD pro Funktion statt pro Raum.
- `--validieren`: prueft jede erzeugte TD mit der Playground-CLI
  (standardmaessig ohne JSON-LD-Pruefung, die Netzzugriff braucht;
  aktivierbar mit `--mit-jsonld-pruefung`).

## Ausgaben

- `td/<pfad>/*.td.json`: Thing Descriptions (TD 1.1, JSON-LD), je Pfad ein
  eigenes Verzeichnis
- `bericht.md`, `bericht.json`: Vergleichsbericht mit Abdeckung,
  Korrektheit, Zuordnungsquellen und Fehlerklassen je Pfad
- `rueckfragen-<pfad>.md`, `rueckfragen-<pfad>.json`: unaufloesbare Faelle
  mit Vorschlaegen statt geratener Zuordnungen
- `zuordnungen-<pfad>.json`: alle Datenpunkte mit Herkunft und Konfidenz je
  Dimension
- `gold-vorlage.json`: bei `--gold-vorlage`

Die Pfadkennungen sind `a` (semantischer Export), `b` (knxproj mit allem, was
das Projekt hergibt) und `b-pur` (dieselbe Heuristik mit ignoriertem
Funktions-Linking). `b-pur` entsteht automatisch, sobald das Projekt
Funktionen enthaelt, und misst, wie weit man ohne Linking kommt.

## LLM-Schritt

Der LLM-Schritt liegt hinter dem Protocol `NameResolver`
(`src/ets2td/pfad_b/aufloeser.py`). Standardmaessig laeuft kein LLM: was
Heuristik und Struktur nicht klaeren, wird Rueckfrage. Fuer Tests existiert
`FakeResolver` (deterministische Tabelle, keine Netzzugriffe). Eine echte
Anbindung implementiert dieselbe Schnittstelle: Eingabe ist eine
`NamensAnfrage` mit Kontext (GA, Name, Beschreibung, Gruppenhierarchie,
Raumkandidaten), Ausgabe sind Zuordnungen mit Konfidenz oder eine
Rueckfrage mit Vorschlaegen. Erfundene Zuordnungen sind per Vertrag
unerwuenscht.

## Erzeugte Beschreibungen am Bus betreiben

Die erzeugten Thing Descriptions tragen `knx://<gruppenadresse>`. Ein
KNX-Binding gibt es bei der W3C nicht, deshalb macht erst das Gateway sie
bedienbar:

```
ets2td-gateway ausgabe/td/b/projekt--wohnzimmer.td.json --selbsttest
ets2td-gateway --suche
ets2td-gateway ausgabe/td/b/projekt--wohnzimmer.td.json \
    --bus tunneling --gateway-ip 192.168.1.50
```

Ohne `--bus` laeuft der Simulator, also ohne Anlage und ohne Netz. Details,
Ressourcenlayout und Grenzen stehen in docs/gateway.md.

## Werkzeuge

- `werkzeuge/kim_dpt_tabelle.py <ontology.ttl>`: erzeugt die Zuordnung von
  KIM-Datenpunkttypen zu ETS-Kennungen aus der offiziellen Ontologie.
- `werkzeuge/anonymisieren.py <projekt.knxproj> <export.jsonld> <ziel>`:
  entfernt personenbeziehbare Angaben und Herstellerdaten aus einem
  Projektpaar.
- `werkzeuge/gold_musterprojekt.py`: erzeugt den Gold-Standard des
  ETS6-Beispiels neu.

## Qualitaetssicherung

```
python3 -m ruff check src tests
python3 -m mypy src tests
python3 -m pytest
```

Die Testsuite arbeitet ausschliesslich lokal (Fixtures in `beispiele/`,
Validierungstests werden uebersprungen, wenn `validator/node_modules`
fehlt). Auch die Gateway-Tests kommen ohne Socket und ohne Bus aus: die
CoAP-Handler werden direkt aufgerufen, der Bus ist der Simulator. Fehlt das
Gateway-Extra, werden sie uebersprungen.
