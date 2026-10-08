# KNX TD Werkstatt

Proof of Concept: KNX-ETS-Projekte (`.knxproj`) werden zu W3C WoT Thing
Descriptions. Grundsatz: belegte Semantik zuerst, Heuristik und KI nur für den
Rest, jede Zuordnung mit Quelle und Beleg.

Stand: **Schritt 3 von 6 (Oberfläche)**. Projektimport, Evidenz-Graph,
Erkennung mit Things und Rückfragen, Benchmark und die Web-Oberfläche sind
fertig; TD-Ausgabe, KI-Schritt und Simulator folgen.

## Schnellstart

```
npm ci
npm run dev          # Werkstatt im Browser, http://localhost:5173
npm run check        # Typprüfung (strict) und Tests
npm run bench        # Benchmark gegen die Gold-Standards
npm run bench -- --fehler
npm run build && npm run pruefe-build   # Build ohne Abrufe fremder Server
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

## Erkennung (Schritt 2)

Je GA werden Belege gesammelt und nach Rangfolge entschieden: ETS-Funktion
und ETS-DPT, Verdrahtung und Herstellerdaten, Namenspaare ("X" / "X RM"),
Name, Einbauort der Bediengeräte, Gruppenhierarchie, Familie. Liegen zwei
Belege zu dicht beieinander, wird daraus eine Rückfrage statt einer
stillen Entscheidung.

- **Vokabular** deutsch und englisch mit Komposita ("Küchenfenster" ergibt
  Raum Küche und Fensterkontakt), Kennwörtern für Rückmeldung, Befehl,
  Alarm, Zentral und stillgelegt.
- **Raumabgleich** gegen die ETS-Räume: exakt, Abkürzung ("Bad",
  "Schlafzim."), Kompositum, Initialen ("LR", "WZ"), Mehrwort ("Living
  room"); mehrere Räume ergeben eine Rückfrage.
- **Things** aus ETS-Funktion, Aktorkanal und Namensfamilie, getypt nach den
  KNX-Funktionstypen (FT-1, FT-6, FT-7, FT-9, FT-10) mit den KNX-Rollen
  (SwitchOnOff, InfoOnOff, DimmingControl, ...), ergänzt um Rollen ohne Norm
  (ComfortMode, HeatingStatus, ...).
- **Namensschema** je Integrator als Kürzeltabelle
  (`knx-td-namensschema-1`, Beispiel `fixtures/oeffentlich/demoprojekt.namensschema.json`):
  "L" bedeutet Licht, "LR" den Raum Living room, "RM" eine Rückmeldung. Es gilt als bestätigte Regel,
  unter ETS-Angaben und Verdrahtung, über jeder Namensheuristik. Häufige
  Kürzel ohne Bedeutung werden mit Beispielen und DPT-Hinweisen gelistet,
  als Vorlage für das Profil und später für den KI-Vorschlag.
- **Rückfragen** für Widersprüche, Mehrdeutigkeiten, fehlende Werte und
  doppelte Rollen. Mehrdeutige Begriffe ("Wert", "Position") ohne Kennwort
  werden bewusst nicht geraten.

## Oberfläche (Schritt 3)

- **Import** per Datei oder Beispielprojekt, geschützte ETS5- und
  ETS6-Projekte mit Passwortdialog. Die Analyse läuft in einem Web Worker.
- **Übersicht:** Kennzahlen, Anteil entschiedener Werte je Dimension nach
  Belegstärke, Trefferquote gegen die eigenen Bestätigungen, Hinweise aus
  dem Projekt. Schalter, ob ETS-Funktionen als Beleg zählen.
- **Gruppenadressen:** virtuelle Tabelle mit Suche, Filtern (Rückfrage,
  Widerspruch, schwach belegt, bestätigt), Sortierung, Tastatursteuerung und
  Sammelaktionen. Der Inspektor zeigt je GA alle Belege mit Quelle und
  Begründung, die verknüpften Kommunikationsobjekte mit Flags und Kanal, und
  nimmt Bestätigungen und Korrekturen an.
- **Things, Rückfragen, Namensschema** (Kürzeltabelle bearbeiten, unbekannte
  Kürzel übernehmen, laden und speichern) und **Export** (Analysebericht,
  Kurzfassung, Projektstand, Gold-Standard).

### Eigene Projekte durchlaufen lassen

1. Kundenprojekt lokal anonymisieren (siehe unten).
2. In der Werkstatt öffnen, Rückfragen beantworten und in den
   Gruppenadressen eine Stichprobe über alle Gewerke bestätigen oder
   korrigieren. Jede Bestätigung wird zum Prüfwert.
3. Unter Export den **Analysebericht** herunterladen und die **Kurzfassung**
   kopieren. Der Bericht enthält die Trefferquote und jede Abweichung mit
   der Quelle und Begründung, auf der die Erkennung lag.
4. Optional anonymisiertes Projekt plus **Gold-Standard**: daraus wird ein
   fester Testfall in `fixtures/privat/` für den Benchmark.

## Benchmark

`npm run bench` misst jedes Verfahren gegen die Gold-Standards aus dem
Vorgänger, in Klammern die Werte von `ets2td`.

| Projekt | Raum | Funktion | Richtung | DPT |
|---|---|---|---|---|
| Style, ohne ETS-Funktionen | 99,2 % (97,6) | 76,4 % (72,8) | 92,6 % (74,0) | 100 % (100) |
| Demoprojekt, ohne ETS-Funktionen | 100 % (100) | 0 % (89,5) | 88,2 % (52,9) | 100 % (100) |
| Demoprojekt, mit Namensschema (5 Kürzel) | 100 % | 63,2 % + 7 teils | 88,2 % | 100 % |
| Demoprojekt, mit allem | 100 % | 100 % | 100 % | 100 % |
| Musterprojekt (ETS6, lokal) | 100 % (85,0) | 86,5 % (91,9) | 100 % (71,1) | 100 % (67,6) |

Einordnung:

- Das **Musterprojekt ist Trainingsmaterial**, kein Test: Das Vokabular ist
  beim Blick auf genau dieses Projekt entstanden. Belastbar wird die Zahl
  erst an ungesehenen Projekten.
- Die fehlenden Richtungen sind ausschließlich mehrdeutige Fälle ohne
  Kennwort, falsche Richtungen gibt es in keinem Projekt.
- Die Funktionsnamen im Demoprojekt sind Kurzcodes ("L LR", "LD LR"); die
  löst kein Vokabular, sondern das Namensschema bzw. der KI-Schritt.
- Mit ETS-Funktionen gewinnt die Verdrahtung gegen vertauschte ETS-Rollen
  und meldet den Widerspruch.

## Aufbau

```
src/archive/   ZIP, Verschlüsselung, ETS-Archivstruktur
src/xml/       Streaming-XML ohne DTD
src/ets/       Projekt, Stammdaten, Herstellerdaten, Auflösung
src/graph/     Evidenz-Graph, Richtung aus Verdrahtung, Diagnosen
src/recognize/ Vokabular, Raumabgleich, Belege, Things, Rückfragen
src/bench/     Gold-Standards, Verfahren, Bewertung
src/tools/     Anonymisierer
src/app/       Snapshot, Bericht, Abgleich mit Bestätigungen (für die Oberfläche)
web/           Oberfläche: React, Carbon, Worker
scripts/       Benchmark, Anonymisierer, Build-Prüfung
fixtures/      frei lizenzierte Testprojekte; privat/ bleibt lokal
```

Der Kern unter `src/` kommt ohne DOM und ohne Node-APIs aus und läuft damit im
Browser und auf der Kommandozeile. Bezeichner sind englisch, Meldungen und
Dokumentation deutsch.

## Datenschutz

Projektdateien werden nur lokal gelesen. Kundenprojekte gehören nach
`fixtures/privat/`, das per `.gitignore` nie ins Repository gelangt.
Projektpasswörter werden nur zum Entschlüsseln verwendet und nicht gespeichert.

- Die Oberfläche lädt nichts von fremden Servern: IBM Plex kommt aus den
  npm-Paketen, der Build setzt eine Content-Security-Policy, die nur eigene
  Quellen erlaubt, und `npm run pruefe-build` prüft das in der CI.
- Bestätigungen und Namensschema liegen je Projekt im `localStorage` dieses
  Browsers und lassen sich unter Export löschen.
- `.npmrc` schaltet Installationsskripte ab; Carbon und IBM Plex würden
  sonst beim `npm install` Nutzungsdaten an IBM senden.
- Der Analysebericht enthält keinen Projektnamen und keine GUID, aber GA-,
  Raum- und Gerätenamen. Deshalb vorher anonymisieren.

### Kundenprojekte als Testdaten weitergeben

Vor jeder Weitergabe, auch an eine KI-Sitzung, **auf dem eigenen Rechner**
anonymisieren:

```
git clone <dieses Repository> && cd <Ordner> && npm ci
KNX_PROJEKTPASSWORT='...' npm run anonymisieren -- kunde.knxproj kunde-anonym.knxproj --ersetzen ersetzungen.json
```

- Entfernt KNX-Secure-Schlüssel und Passwörter, Seriennummern, geladene
  Geräteabbilder, IP-Konfiguration, Kommentare, Projektverlauf,
  Benutzerdateien, Signaturen und Zertifikate.
- Ersetzt Projektname, -nummer, -GUID und die Namen von Gebäuden und
  Liegenschaften. Herstellerdaten, Struktur und Verknüpfungen bleiben.
- Gibt seltene, großgeschriebene Wörter aus Namen aus. Personennamen daraus
  in `ersetzungen.json` aufnehmen (`{ "Müller": "Person 1" }`) und erneut
  laufen lassen.
- Das Passwort per Umgebungsvariable, damit es nicht in der Shell-Historie
  landet. Die Ausgabe ist ohne Passwort.

## Vorgänger

`ets2td` (Python, Konfigurator, CoAP-Gateway) liegt auf dem Branch
`claude/knx-ets-wot-prototype-oj8yvz`.
