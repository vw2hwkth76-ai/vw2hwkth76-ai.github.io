# KNX TD Werkstatt

Proof of Concept: KNX-ETS-Projekte (`.knxproj`) werden zu W3C WoT Thing
Descriptions. Grundsatz: belegte Semantik zuerst, Heuristik und KI nur für den
Rest, jede Zuordnung mit Quelle und Beleg.

Stand: **Schritt 4 von 6 (Thing Descriptions)**. Projektimport,
Evidenz-Graph, Erkennung mit Things und Rückfragen, Benchmark, Web-Oberfläche
und TD-Ausgabe sind fertig; KI-Schritt und Simulator folgen.

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
  room"). Raumnamen werden zerlegt wie GA-Namen ("PhysLab2G" trifft
  "Physics Lab2G (line1)"): Klammerzusätze optional, Kürzel, Synonyme
  (Corridor/Circulation, WC/Toilets), Geschossbuchstabe hinter der Nummer
  (G/Ground, F/First), Tippfehler. Nennt ein Name mehrere Räume
  ("Lab 5&6"), gilt der gemeinsame Bereich; ohne jeden Hinweis das Gebäude.
- **DPT aus den Herstellerobjekten**, wenn weder GA noch Objekt einen DPT
  tragen (ältere Herstellerdaten): Die Objektgröße legt den Haupttyp fest,
  wo sie eindeutig ist (1 Bit ist DPT 1), Objekttext und EIS-Angabe den
  Untertyp ("Output presence" 1.018, "EIS 5" DPT 9). Kein Text gilt gegen
  die Größe.
- **Things** aus ETS-Funktion, Aktorkanal, Raumgerät und Namensfamilie.
  Heizungs- und Lüftungs-GAs eines Raums am selben Regler oder Antrieb im
  Raum sind ein Thing; beim Schema "Ort / Gewerk" ("Ground Floor /
  Heating") auch ohne gemeinsames Gerät, solange keine zwei Ausgänge
  dieselbe Aufgabe haben. Getypt nach den
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

## Thing Descriptions (Schritt 4)

Ansicht **Thing Descriptions** in der Werkstatt, Download als ZIP:

| Datei | Inhalt |
|---|---|
| `things/*.td.json` | Feld-TD: KNX-Forms, `href` ist die Gruppenadresse relativ zur Gateway-Basis, Herkunft je Form in `kb:evidence` |
| `things/*.platform.td.json` | Plattform-TD: HTTP-Forms, Beobachten per Server-Sent Events (`subprotocol: "sse"`) |
| `models/ft-*.tm.json` | Thing Models je KNX-Funktionstyp aus `knx_master.xml` (FT-1, FT-6, FT-7, FT-8, FT-9) |
| `collection.td.json` | Sammel-TD mit `item`-Links auf alle Feld-TDs |
| `knx-binding.jsonld` | JSON-LD-Kontext der Begriffe mit Präfix `kb:` |

- **TD 1.1** als Hauptausgabe, **TD 2.0** nach dem Working Draft vom
  4.11.2025 (vorläufiger Kontext, HTTP-Methoden und `contentType` explizit).
- **Schalten:** Befehl und Rückmeldung derselben Größe werden eine Property
  mit Schreib-Form auf die Befehls-GA und Lese-/Beobachten-Form auf die
  Rückmelde-GA. Variante: Befehl als Action, Rückmeldung als lesbare
  Property. Gepaart wird nur bei gleichem DPT-Haupttyp.
- **Lesen** nur, wo ein Objekt Lesetelegramme beantwortet; ohne
  Herstellerdaten mit `kb:readVerified: false`.
- **Feld- und Plattform-TD** sind über `proxy-to` verbunden (TD 1.1,
  Tabelle 25), die Feld-TD verweist per `type` auf ihr Thing Model.
- **Semantik:** `@type` aus Brick 1.4 (Klassen gegen Brick.ttl 1.4.2
  geprüft), Einheiten aus QUDT (gegen das Einheitenvokabular geprüft),
  Datenschemata aus den DPT-Feldern mit Koeffizient, Grenzen und
  benannten Zuständen (`oneOf` mit `const` und `title`).
- **Stabile IDs:** UUID v5 aus Projekt-GUID und ETS-Funktion, Aktorkanal
  oder GA-ID, nie aus der Gruppenadresse.
- **Unsicheres** bleibt sichtbar: Belege, Widersprüche und offene Fragen
  stehen an der Form. Der Schalter "nur fest belegte oder bestätigte GAs"
  lässt alles weg, was nicht bestätigt oder mit mindestens 0,85 belegt ist.
- **Geprüft** gegen die W3C-Schemas für TD und TM 1.1 sowie den
  2.0-Entwurf (`tests/schemas/`).
- Der Namensraum `kb:` ist auf der Pages-Seite unter `/ns/knx-binding`
  (Begriffsseite) und `/ns/knx-binding.jsonld` (Kontext) abrufbar.

## Benchmark

`npm run bench` misst jedes Verfahren gegen die Gold-Standards aus dem
Vorgänger, in Klammern die Werte von `ets2td`.

| Projekt | Raum | Funktion | Richtung | DPT |
|---|---|---|---|---|
| Style, ohne ETS-Funktionen | 99,2 % (97,6) | 76,4 % (72,8) | 92,6 % (74,0) | 100 % (100) |
| Demoprojekt, ohne ETS-Funktionen | 100 % (100) | 0 % (89,5) | 94,1 % (52,9) | 100 % (100) |
| Demoprojekt, mit Namensschema (5 Kürzel) | 100 % | 63,2 % + 7 teils | 94,1 % | 100 % |
| Demoprojekt, mit allem | 100 % | 100 % | 100 % | 100 % |
| Musterprojekt (ETS6, lokal) | 100 % (85,0) | 86,5 % (91,9) | 100 % (71,1) | 100 % (67,6) |
| Schulprojekt (ETS3-Zeit, lokal, kein DPT im Projekt) | 97,5 % | – | 98,6 % | 99,6 % |

Dazu misst der Benchmark, wie viel ohne Rückfrage in Thing Descriptions
geht: Anteil der GAs, die in einem Thing liegen, Richtung und DPT
entschieden haben und keine offene Rückfrage tragen; die Bündelung paarweise
gegen die Soll-Things des Gold-Standards.

| Projekt | TD-fertig ohne Rückfrage | Bündelung Präzision | Bündelung Vollständigkeit |
|---|---|---|---|
| Style | 100 % | – | – |
| Demoprojekt | 89,5 % | – | – |
| Musterprojekt (lokal) | 69,1 % | – | – |
| Schulprojekt (lokal) | 99,7 % (vorher 39,1) | 99,6 % (57,8) | 91,8 % (22,9) |

Einordnung:

- Das **Musterprojekt und das Schulprojekt sind Trainingsmaterial**, kein
  Test: Vokabular und Regeln sind beim Blick auf genau diese Projekte
  entstanden. Belastbar werden die Zahlen erst an ungesehenen Projekten.
- "TD-fertig" heißt entschieden, nicht fehlerfrei: Beim Schulprojekt liegen
  einige Things auf Gebäude- oder Bereichsebene, wo kein Raum erkennbar war,
  und manche DPTs sind nur im Haupttyp bekannt (1 Bit ohne Untertyp).
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
src/td/        Datenschemata, Affordances, Feld- und Plattform-TD, Thing Models
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
