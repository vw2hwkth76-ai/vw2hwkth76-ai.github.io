# KNX TD Werkstatt

Proof of Concept: KNX-ETS-Projekte (`.knxproj`) werden zu W3C WoT Thing
Descriptions. Grundsatz: belegte Semantik zuerst, Heuristik und KI nur für den
Rest, jede Zuordnung mit Quelle und Beleg.

Stand: **Schritt 1 von 6 (Fundament)**. Projektimport, Evidenz-Graph und
Benchmark sind fertig; Erkennung, Oberfläche und TD-Ausgabe folgen.

## Schnellstart

```
npm ci
npm run check        # Typprüfung (strict) und Tests
npm run bench        # Benchmark gegen die Gold-Standards
npm run bench -- --fehler
```

Node.js 22 oder neuer. Abhängigkeiten bitte mit npm 11 ändern: npm 10.9 bricht
beim Auflösen der Peer-Abhängigkeiten von vitest ab, `npm ci` funktioniert mit
beiden Versionen.

## Was Schritt 1 kann

- **Archiv:** eigener ZIP-Leser mit Deflate, WinZip-AES, ZipCrypto, ZIP64 und
  Grenzen auf die tatsächlich entpackten Bytes (Schutz gegen Zip-Bomben).
  Geschützte Projekte aus ETS5 (Rohpasswort) und ETS6 (abgeleitetes Passwort).
- **Projekt:** Gruppenadressen mit allen Bereichsebenen, Gebäudestruktur,
  ETS-Funktionen mit Rollen, Gewerke, Topologie, Parameterwerte,
  Kommunikationsobjekte mit Flags und Kanal, Verknüpfungen im neuen und alten
  Format. XML wird gestreamt, ein DOCTYPE wird abgewiesen.
- **Stammdaten:** alle DPTs aus `knx_master.xml` mit Feldern, Einheiten,
  Wertebereichen und deutschen Texten, dazu die normativen Funktionstypen der
  KNX (schaltbares Licht, dimmbares Licht, Sonnenschutz, Heizung, Steckdose)
  mit ihren Funktionspunkten. Auf ihnen bauen später die Thing Models auf.
- **Herstellerdaten:** Produkte inklusive Hutschienenmontage, nur die benutzten
  Applikationen, Kommunikationsobjekte inklusive Modulen, Kanäle,
  Textparameter, Übersetzungen. Effektive Werte: Projekt vor Ref vor Objekt.
- **Evidenz-Graph:** je GA die verknüpften Objekte mit Sende-, Empfangs- und
  Lese-Rolle, Gerät, Einbauort, Gewerk und ETS-Funktion. Diagnosen für
  DPT- und Größenkonflikte, fehlende DPTs, unverknüpfte und nicht lesbare GAs,
  fehlende Sender, Mehrfachfunktionen und Widersprüche zwischen ETS-Rolle und
  Verdrahtung.

## Benchmark

`npm run bench` misst jedes Verfahren gegen die Gold-Standards aus dem
Vorgänger. Stand Schritt 1, ohne jede Namensheuristik:

| Projekt | Raum | Funktion | Richtung | DPT |
|---|---|---|---|---|
| Style (ETS5, Funktionen gepflegt) | 100 % | 100 % | 100 % | 100 % |
| Demoprojekt (ETS5, Herstellerdaten) | 100 % | 100 % | 88,2 % | 100 % |
| Musterprojekt (ETS6, ohne Funktionen, lokal) | 0 % | 0 % | 0 % | 28,7 % |

Die 100 % sind konstruktionsbedingt, weil diese Gold-Standards aus den
ETS-Funktionen abgeleitet sind; sie belegen nur, dass nichts verloren geht.
Die zwei Richtungsabweichungen im Demoprojekt sind Widersprüche zwischen
ETS-Funktionsrolle und Verdrahtung, bei denen vermutlich der Gold-Standard
irrt (siehe `docs/entscheidungen.md`). Das Musterprojekt ist der eigentliche
Prüfstein für Schritt 2.

## Aufbau

```
src/archive/   ZIP, Verschlüsselung, ETS-Archivstruktur
src/xml/       Streaming-XML ohne DTD
src/ets/       Projekt, Stammdaten, Herstellerdaten, Auflösung
src/graph/     Evidenz-Graph, Richtung aus Verdrahtung, Diagnosen
src/bench/     Gold-Standards, Verfahren, Bewertung
fixtures/      frei lizenzierte Testprojekte; privat/ bleibt lokal
```

Der Kern unter `src/` kommt ohne DOM und ohne Node-APIs aus und läuft damit im
Browser und auf der Kommandozeile. Bezeichner sind englisch, Meldungen und
Dokumentation deutsch.

## Datenschutz

Projektdateien werden nur lokal gelesen. Kundenprojekte gehören nach
`fixtures/privat/`, das per `.gitignore` nie ins Repository gelangt.
Projektpasswörter werden nur zum Entschlüsseln verwendet und nicht gespeichert.

## Vorgänger

`ets2td` (Python, Konfigurator, CoAP-Gateway) liegt auf dem Branch
`claude/knx-ets-wot-prototype-oj8yvz`.
