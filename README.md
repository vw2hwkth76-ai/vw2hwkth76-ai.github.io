# KNX TD Werkstatt

Proof of Concept: KNX-ETS-Projekte (`.knxproj`) werden zu W3C WoT Thing
Descriptions. Grundsatz: belegte Semantik zuerst, Heuristik und KI nur für den
Rest, jede Zuordnung mit Quelle und Beleg.

Stand: **Schritt 4 von 6 (Thing Descriptions)**, mit Assistent und Ausschluss nach dem Import. Projektimport,
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

- **Vokabular** deutsch und englisch, Grundwortschatz portugiesisch
  ("Estores", "Luz", "St" für Rückmeldung), mit Komposita ("Küchenfenster"
  ergibt Raum Küche und Fensterkontakt), Kennwörtern für Rückmeldung,
  Befehl, Alarm, Zentral und stillgelegt.
- **Stillgelegt** sind Platzhalter ohne Buchstaben und Ziffern (".", "--")
  und Reserve-GAs ("Reserve", "Reserva"): kein Thing, keine Rückfrage, nicht
  im Nenner der Kennzahlen.
- **Raumabgleich** gegen die ETS-Räume: exakt, Abkürzung ("Bad",
  "Schlafzim."), Kompositum, Initialen ("LR", "WZ"), Mehrwort ("Living
  room"). Raumnamen werden zerlegt wie GA-Namen ("PhysLab2G" trifft
  "Physics Lab2G (line1)"): Klammerzusätze optional, Kürzel, Synonyme
  (Corridor/Circulation, WC/Toilets), Geschossbuchstabe hinter der Nummer
  (G/Ground, F/First), Tippfehler. Nennt ein Name mehrere Räume
  ("Lab 5&6"), gilt der gemeinsame Bereich; ohne jeden Hinweis das Gebäude.
  Etagen zählen als Ort, wenn der Name keinen Raum nennt ("Estores Piso 1
  geral"); nennt er Raum und Etage, gilt der Raum.
- **DPT aus den Herstellerobjekten**, wenn weder GA noch Objekt einen DPT
  tragen (ältere Herstellerdaten): Die Objektgröße legt den Haupttyp fest,
  wo sie eindeutig ist (1 Bit ist DPT 1), Objekttext und EIS-Angabe den
  Untertyp ("Output presence" 1.018, "EIS 5" DPT 9). Kein Text gilt gegen
  die Größe. Ohne verknüpfte Objekte ist ein Begriff ohne eigenen Typ ein
  Bit ("Heizen", "Betriebsm. Komfort"), eine Szene eine Szenennummer
  (17.001), aber nur, wenn kein anderer Begriff im Namen einen Typ nennt
  ("Heizen Stellwert" bleibt 5.001).
- **Richtung aus der Verdrahtung:** Ein Eingangskanal ("Input A",
  "Eingang 3") meldet, auch mit Schreib-Flag; der Eingang eines
  empfangenden Geräts (Betriebsart am Raumregler) ist ein Befehlsziel; die
  Objektbeschriftung "Ausgang/Eingang" ist keins von beidem.
- **Things** aus ETS-Funktion, Aktorkanal, Raumgerät und Namensfamilie.
  Heizungs- und Lüftungs-GAs eines Raums am selben Regler oder Antrieb im
  Raum sind ein Thing; beim Schema "Ort / Gewerk" ("Ground Floor /
  Heating") auch ohne gemeinsames Gerät, solange keine zwei Ausgänge
  dieselbe Aufgabe haben. Über den Aktorkanal bündeln nur GAs, die auf
  genau einem Kanal liegen; eine Zentral-GA auf zehn Kanälen klebt sie
  nicht zusammen. Getypt nach den
  KNX-Funktionstypen (FT-1, FT-6, FT-7, FT-9, FT-10) mit den KNX-Rollen
  (SwitchOnOff, InfoOnOff, DimmingControl, ...), ergänzt um Rollen ohne Norm
  (ComfortMode, HeatingStatus, ...).
- **Namensschema** je Errichter, in zwei Stufen:
  - Kürzeltabelle (`knx-td-namensschema-1`, Beispiel
    `fixtures/oeffentlich/demoprojekt.namensschema.json`): "L" bedeutet
    Licht, "LR" den Raum Living room, "RM" eine Rückmeldung.
  - Aufbau (`knx-td-namensschema-2`): Muster mit benannten Gruppen lesen den
    ganzen Namen ("Etage.Raum.Gewerk-Art-Funktion-Kanal"), eine Tabelle sagt,
    was die Werte bedeuten (Gewerk, Richtung, Begriff, Datenpunkttyp,
    Raumkürzel, Anzeigename), Regeln fassen Ausnahmen. Die Gruppen unter
    "thing" bestimmen, welche GAs ein Thing bilden. Ein Muster liest den
    Namen oder, mit `"source": "path"`, den Pfad "Hauptgruppe / Mittelgruppe /
    Name": So lassen sich Projekte lesen, deren Gruppenbereiche die Funktion
    nennen und deren Namen nur Raum und Nummer tragen.
  - Bestätigt belegt das Schema Raum, Gewerk und Richtung mit 0,92: Es
    ersetzt die Namensheuristik und schlägt die schwachen Ersatzregeln der
    Verdrahtung. Widerspricht starke Verdrahtung oder eine ETS-Angabe,
    gewinnt diese, mit Rückfrage. Ungültige Muster (auch solche mit
    verschachtelten Wiederholungen wie "(a+)+", die den Browser blockieren
    könnten; "(?: \\S+)*" mit festem Trenner ist erlaubt) werden abgelehnt,
    höchstens 40 Muster, unbekannte Begriffe mit Hinweis ignoriert.
- **Verdrahtung mit Belegstärke:** Was ein Aktor oder ein eindeutiger
  Objekttext belegt, zählt 0,93. Ersatzregeln ("nur Empfänger", "lesbarer
  Sender ohne Aktor") zählen 0,76: Ein Kennwort im Namen ("Status", "STA")
  gewinnt dann, ein bloßer Begriff nicht. Eingänge eines Aktors für seine
  Automatik ("Output A / Presence") sind verwertete Zustände, keine
  gesteuerten Ausgänge.
- **Raumnummern:** "A0101B057_..." trifft den Raum "02_L1/B/057_..."; Räume
  ohne Nummerncode über Kurzformen ("CORZ1" für "Corridor_Zone1"). Gibt es
  denselben Raumnamen in mehreren Gebäuden, entscheidet das Gebäude, das der
  Gruppenbereich nennt; Wörter, die in jedem Gebäudenamen stehen, zählen
  dabei nicht.
- **Projektkonvention:** GAs, deren Name ohne Raum gleich lautet, tragen
  dieselbe Funktion. Was die verknüpften unter ihnen über Verdrahtung und
  Objekt-DPT belegen, gilt für die unverknüpften, solange sie sich einig sind.
- **Rückfragen** für Widersprüche, Mehrdeutigkeiten, fehlende Werte und
  doppelte Rollen, je Funktion statt je GA: Fehlt der DPT bei 49 gleichartigen
  GAs, ist das eine Frage, und die Antwort gilt für alle. Dasselbe Muster
  doppelter Rollen in vielen Things ist ebenfalls eine Frage. Mehrdeutige
  Begriffe ("Wert", "Position") ohne Kennwort werden bewusst nicht geraten.

## Oberfläche (Schritt 3)

- **Import** als `.knxproj`, als ZIP eines entpackten Projekts (auch mit
  Unterordner oder mit einer `.knxproj` darin), als entpackter Ordner oder
  Beispielprojekt; geschützte ETS5- und ETS6-Projekte mit Passwortdialog.
  Die Analyse läuft in einem Web Worker.
- **Assistent nach dem Import** in drei Schritten mit Fortschrittsleiste. Alles
  darin ist ein Entwurf; die volle Analyse läuft erst nach "Zur Werkstatt".
  Danach bleiben Dashboard, Tabellen, Rückfragen und Export wie sie sind.
  Jeder Schritt lässt sich später über die Werkstatt wieder öffnen.
  1. **Umfang:** Welche GAs werden ausgewertet? Drei Wege, die sich
     kombinieren lassen: der **Vorrat** (kein Gerät sendet oder empfängt
     darauf; bei Vorlagenprojekten vorbelegt, wenn weniger als die Hälfte der
     GAs in Benutzung ist), ganze **Hauptgruppen** per Häkchen und **einzelne
     GAs** per Suche (alle Treffer ausschließen oder wieder aufnehmen).
     Eine einzelne Entscheidung geht der Gruppe und dem Vorrat vor.
     **Ausgeschlossene GAs fallen ganz heraus:** keine Belege, kein
     Schema-Treffer, keine Things, keine Rückfragen, nicht im Prompt für das
     Namensschema, nicht in den Thing Descriptions, nicht im Nenner der
     Kennzahlen. In der Tabelle stehen sie grau mit dem Grund; der Filter
     "Ausgeschlossen" zeigt sie, Sammelaktionen holen sie zurück.
  2. **Namensschema**, überspringbar; bei einem schon bekannten Projekt ist der
     gespeicherte Stand vorbelegt und "Weiter wie zuletzt" übernimmt ihn
     unverändert:
     - Prompt für ein LLM kopieren. Er enthält nur Gebäudestruktur, GA-Namen
       der **eingeschlossenen** GAs, Gruppenbereiche, DPT und verknüpfte
       Objekte. Personennamen sind ersetzt, große Projekte erscheinen als
       Beispiele je Namensform. Die Mittelgruppen, die nur im weggelassenen
       Vorrat vorkommen, stehen als reine Namensliste dabei, damit das Schema
       beim nächsten Projekt mit derselben Vorlage nicht an ihnen scheitert.
     - Die Antwort einfügen oder ein gespeichertes Schema laden. Die App
       prüft sie an den GAs im Umfang: Abdeckung je Muster, nicht gelesene
       Beispiele, unbekannte Räume.
     - Werte und Ausnahmen lassen sich einzeln abwählen. Der Vergleich ohne
       und mit Schema (TD-fertig, fest belegt, Things, Rückfragen) rechnet
       sofort neu.
     - Die App selbst schickt nichts an ein LLM.
  3. **Zusammenfassung:** Umfang, Schema und eine Warnung, wenn der Ausschluss
     Things auseinanderreißt (Befehl drin, Rückmeldung draußen).
- **Übersicht:** Kennzahlen, Anteil entschiedener Werte je Dimension nach
  Belegstärke, Trefferquote gegen die eigenen Bestätigungen, Hinweise aus
  dem Projekt. Prozentwerte beziehen sich auf die ausgewerteten GAs. Schalter,
  ob ETS-Funktionen als Beleg zählen, Umfang mit Schnellschalter für den Vorrat.
- **Gruppenadressen:** virtuelle Tabelle mit Suche, Filtern (Rückfrage,
  Widerspruch, schwach belegt, bestätigt), Sortierung, Tastatursteuerung und
  Sammelaktionen. Der Inspektor zeigt je GA alle Belege mit Quelle und
  Begründung, die verknüpften Kommunikationsobjekte mit Flags und Kanal, und
  nimmt Bestätigungen und Korrekturen an.
- **Things, Rückfragen, Namensschema** (Kürzeltabelle bearbeiten, unbekannte
  Kürzel übernehmen, Aufbau neu vorschlagen lassen, laden und speichern) und
  **Export** (Analysebericht, Kurzfassung, Projektstand, Gold-Standard).

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

## Asset-Modell (Ansicht "Building Pro Integration")

Neben den Thing Descriptions exportiert die Werkstatt ein Asset-Modell nach
einer Ontologie: Assets in einem Ortsbaum, je Asset ein Typ mit Klasse und
Attributen, je Attribut die Gruppenadressen. Grundlage ist dieselbe Planung
wie bei den TDs, Befehl und Rückmeldung bleiben gepaart.

- **Zielprofil** (`knx-asset-profile-1`, JSON): welche Asset-Typen die
  Zielplattform kennt, ihre Klasse (RealEstateCore/Brick), ihre Attribute
  (input, output, status, info, property), welcher ETS-Raumtyp und welches
  Thing auf welchen Typ geht und welche Rolle auf welches Attribut. Das Profil
  ist eine Datei des Nutzers, wird zur Laufzeit geladen und bleibt im Browser;
  das Repo enthält kein plattformspezifisches Profil. Ohne Profil entstehen
  alle Typen aus der Erkennung.
- **Ortsbaum:** Land und Region (Eingabe, optional), Standort, darunter die
  ETS-Gebäudestruktur, darunter je Thing ein Asset. Lesbare Kennung mit Präfix, IDs als
  UUID v5 aus Projekt-GUID und ETS-Kennungen.
- **Typen:** erst die Regeln des Profils; was keine Regel trifft, bekommt einen
  eigenen Typ (`knx_*`). Fehlt einem Profiltyp ein Attribut, das KNX liefert,
  ergänzt der Export es und markiert den Typ als erweitert.
- **Lückenliste** (`gaps.md`, englisch): jede Stelle, an der KNX nicht ins
  Modell passt, mit Anzahl und Beispielen aus dem Projekt. Dazu gehören
  Befehl und Rückmeldung auf zwei GAs, Befehle ohne Zustand (relatives Dimmen,
  Schritt/Stopp), Zentralfunktionen, mehrteilige DPTs, Szenen, Logik,
  fehlende Attribute je Typ, Einheitenkonflikte und Ebenen über dem Standort.
- **Zuordnung per KI:** Für eigene Typen und ergänzte Attribute erzeugt die
  Ansicht einen Prompt. Die Antwort des LLM darf nur auf Typen und Attribute
  des Profils zeigen und wird wie ein Profil geprüft, bevor sie gilt.
- **ZIP:** `asset-model.json`, `template-library.md`, `gaps.md`,
  `location-tree.md`, bei offenen Zuordnungen `mapping-prompt.md`.

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
| Schulprojekt (ETS3-Zeit, lokal, kein DPT im Projekt) | 97,5 % | – | 99,1 % | 99,6 % |
| Projekt C (Gewerbebau, 6 % der GAs verknüpft, kein DPT) | 100 % (4,7) | – | 98,2 % (58,2) | 97,2 % (59,1) |
| Projekt D (Wohnhaus, portugiesisch benannt, ein Drittel Platzhalter) | 100 % | – | 98,5 % | 100 % |
| Projekt E (Büro, englisch, strenges Schema, alles in einem Bereich) | 100 % (blind 0,5) | – | 92,5 % (blind 85,6) | 96,8 % |
| Projekt E mit bestätigtem Namensschema | 100 % | – | 100 % | 96,8 % |

Dazu misst der Benchmark, wie viel ohne Rückfrage in Thing Descriptions
geht: Anteil der GAs in Benutzung (ohne stillgelegte), die in einem Thing
liegen, Richtung und DPT entschieden haben und keine offene Rückfrage
tragen. "Davon falsch" zählt die TD-fertigen GAs, bei denen Raum, Richtung
oder DPT dem Gold-Standard widerspricht. Die Bündelung wird paarweise gegen
die Soll-Things des Gold-Standards gemessen.

| Projekt | TD-fertig ohne Rückfrage | davon falsch | Rückfragen | Bündelung Präzision | Bündelung Vollständigkeit |
|---|---|---|---|---|---|
| Style | 100 % | 0 | 0 | – | – |
| Demoprojekt | 89,5 % | 0 | 2 | – | – |
| Musterprojekt (lokal) | 97,2 % (vorher 69,1) | 0 | 6 (47) | – | – |
| Schulprojekt (lokal) | 99,7 % (vorher 39,1) | 17 | 7 (555) | 98,9 % (57,8) | 93,1 % (22,9) |
| Projekt C (lokal), blind gemessen | 3,8 % | – | 842 | 95,4 % | 9,9 % |
| Projekt C nach Anpassung | 72,6 % | 0 | 16 | 100 % | 99,8 % |
| Projekt D (lokal), blind gemessen | 68,1 % von 395 | 81 | 219 | 26,1 % | 43,3 % |
| Projekt D nach Anpassung | 98,5 % von 259 (136 stillgelegt) | 0 | 9 | 100 % | 93,5 % |
| Projekt E (lokal), blind gemessen | 91,0 % | 182 | 15 | 54,0 % | 24,6 % |
| Projekt E nach Anpassung, ohne Schema | 89,6 % | 3 | 18 | 53,6 % | 24,8 % |
| Projekt E mit Namensschema, eigene Lesart | 97,0 % | 0 | 4 | 100 % | 100 % |
| Projekt E mit Namensschema eines LLM, nur mit dem Prompt | 97,0 % | 0 | 4 | 62,6 % | 100 % |

Einordnung:

- **Musterprojekt, Schulprojekt und die Projekte C bis E sind
  Trainingsmaterial**, kein Test: Vokabular und Regeln sind beim Blick auf
  genau diese Projekte entstanden. Belastbar sind nur die Blindmessungen an
  jeweils ungesehenen Projekten.
- Bei Projekt C fehlt für gut ein Viertel der GAs jeder Beleg zur Kodierung
  (herstellereigene 3- und 4-Byte-Objekte ohne DPT, unverknüpfte
  Reglerfunktionen). Das bleibt bewusst eine Rückfrage, je Funktion eine.
- **Projekt D blind** ist der erste Test, bei dem die Regeln aus Schule und
  Projekt C schon trugen: 68 % TD-fertig statt 3,8 % bei Projekt C. Aber
  81 dieser GAs waren falsch (77 Richtungen, 12 Räume), weil Objekttexte
  wie "Ausgang/Eingang" als Eingang galten und Etagen nicht als Ort. Blind
  fertig heißt also nicht blind richtig; deshalb die Spalte "davon falsch".
  Nach der Anpassung ist Projekt D wie Schule und Projekt C Trainingsmaterial.
- **Projekt E** hat ein strenges Schema
  (`Etage.Raum.Gewerk-Art-Funktion-Kanal`), alle GAs liegen in einem
  einzigen Gruppenbereich. Blind waren 91 % "fertig", aber 182 davon
  falsch: Die Etage im Namen verdrängte den Raum. Nach der Korrektur, ohne
  Schema, sind 88 % fertig und richtig. Die Bündelung bleibt ohne Schema
  schwach (115 Things statt 33), weil die Namen gleichartige Funktionen
  nicht verraten.
- **Mit Schema** sind es 97 % fertig und richtig, 88 % fest belegt, 33 Things,
  Bündelung 100/100. Im Modus "nur fest belegte" wird kein Thing mehr
  übersprungen (blind 43 von 120).
- **Ein LLM, das nur den Prompt sah,** hat ein Muster geliefert, das alle 201
  GAs abdeckt, und Raum und Richtung genauso gelesen. Die geringere Präzision
  der Bündelung hat eine Ursache: Es fasste Raumregler und Fancoil zu einem
  Thing zusammen. Im Schritt 2 lässt sich das mit einem Häkchen trennen.
- Seit Projekt D zählen stillgelegte GAs nicht mehr im Nenner. Beim
  Musterprojekt macht das 69,1 auf 74,0 % aus, den Rest bis 97,2 % die
  Bit-Regel für unverknüpfte Heizungs-GAs.
- "TD-fertig" heißt entschieden, nicht fehlerfrei: Beim Schulprojekt liegen
  13 Things auf Bereichsebene statt im Flurraum, 5 Richtungen sind falsch
  (Präsenz-Trigger, Betriebsart, Zähler), und manche DPTs sind nur im
  Haupttyp bekannt (1 Bit ohne Untertyp).
- Die übrigen fehlenden Richtungen sind mehrdeutige Fälle ohne Kennwort.
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
- Der Prompt für den Schema-Vorschlag enthält GA-Namen, Gruppenbereiche und
  Raumnamen, keine Projekt-, Kunden- oder Errichterangaben; Anreden mit
  Namen ("Dr. ...", "Frau ...") werden standardmäßig ersetzt. Wer ihn in ein
  LLM einfügt, übermittelt ihn an dessen Anbieter. Bei Kundenprojekten nur
  mit Auftragsverarbeitungsvertrag.
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
