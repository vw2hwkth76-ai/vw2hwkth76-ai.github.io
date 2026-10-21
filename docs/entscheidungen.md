# Entscheidungen

Stand 2026-10-08. Festgehalten, damit spätere Schritte nicht neu verhandelt
werden müssen. Formulierungen bleiben herstellerneutral.

## Zielbild

- Zwei Zielgruppen: Demonstration für eine Edge-plus-Cloud-Gebäudeplattform
  und Werkzeug für Integratoren. Demo-Wirkung und Genauigkeit zählen gleich.
- Eingabe ist das `.knxproj`. Der reine GA-Export (CSV/XML) enthält weder
  Geräte noch Flags noch Kanäle und bleibt Notlauf. Der semantische Export
  der ETS ist optional.

## Ausgabe

- **TD 1.1 als Hauptausgabe**, TD 2.0 (Entwurf, Kontext-IRI vorläufig) als
  experimentelle zweite Serialisierung aus demselben internen Modell.
- **Zwei TDs aus einem Modell:** Feld-TD mit KNX-Forms für die
  Edge-Laufzeit, Plattform-TD mit HTTP- oder MQTT-Forms für die Cloud,
  verbunden über `proxy-to`. Das KNX-Vokabular wird echtes JSON-LD.
- **Schalten als Property mit zwei Forms** (Schreiben auf die Befehls-GA,
  Lesen/Beobachten auf die Status-GA). Die Variante "Action plus
  Status-Property" bleibt per Schalter verfügbar. Actions nur für
  Zustandsloses: relativ dimmen, Fahren/Schritt, Szene.
- **Tags** (Ort, Gewerk, Datenrolle) als definierte Kontextbegriffe plus
  `@type` aus einer echten Ontologie, nicht als freies `tags`-Objekt.
- **Stabile IDs** aus Projekt-GUID und Aktorkanal beziehungsweise
  ETS-Funktion, damit Umadressieren keine Bindungen bricht.
- `readproperty` nur, wenn ein Objekt Lesetelegramme beantwortet
  (`readable` im Graphen); sonst nur beobachten.

## Erkennung

- Rangfolge der Belege: Review > ETS-Funktion und ETS-DPT > Herstellerdaten
  und Verdrahtung > bestätigte Regel > offene Regel > KI.
- Gruppierung zu Things über den Aktorkanal (ChannelId, Herstellerkanal,
  Textparameter), nicht über Namensähnlichkeit. Ort aus Gruppenhierarchie und
  Sensorstandort, weil Aktoren im Verteiler sitzen.
- Thing Models auf Basis der normativen KNX-Funktionstypen aus
  `knx_master.xml`, ergänzt wo nötig.
- KI erkennt die Namenskonvention eines Projekts einmal als Regelwerk, das ein
  Mensch prüft; danach deterministische Anwendung. Restfälle in kleinen
  Stapeln, jeder Vorschlag einzeln bestätigt, Belege müssen im Projekt
  existieren. Claude mit eigenem Schlüssel im Browser, Namen vor dem Senden
  pseudonymisiert, nur nach Zustimmung je Projekt.

## Befunde aus Schritt 1

- **Verdrahtung schlägt Funktionsrolle.** Im Demoprojekt hängt "LD LR Dimming
  value" (Rolle InfoDimmingValue) am Eingang "Dim absolutely" des Aktors und
  "LD LR Value" (Rolle DimmingValue) an dessen Rückmeldeobjekt. Die
  ETS-Rollen sind vertauscht. Der Gold-Standard ist nach der Verdrahtung
  korrigiert, die Begründung steht in der Gold-Datei.
- **Aktorkanal ist im Projekt belegt.** ETS6 schreibt `ChannelId` an die
  Kommunikationsobjekte, ETS5 gruppiert über kanalbezogene Textparameter.
- **ETS6-Passwortableitung** ist gegen eine unabhängige Referenz geprüft,
  aber noch nicht gegen ein echtes, in der ETS6 geschütztes Projekt.

## Befunde aus Schritt 2

- **Konventionen unterscheiden sich grundlegend.** Im Musterprojekt ist die
  Mittelgruppe der Raum, im Style-Projekt die Funktion ("Switching",
  "Status"), der Raum steht dort im Namen. Die Erkennung legt deshalb kein
  Schema fest, sondern wertet jeden Namen und jeden Gruppenbereich
  gleichartig aus.
- **Paare sind die stärkste Namensquelle.** "X" und "X RM" im selben Bereich
  ergeben Befehl und Rückmeldung, dazu gemeinsamen DPT und Raum. So wird ein
  unmarkierter Name nur dann zum Befehl, wenn das Projekt selbst die
  Rückmeldung kennzeichnet.
- **Sensorstandort nach Gewerk gewichten.** Raumregler sitzen im geregelten
  Raum (stark), Taster oft nebenan (schwach). Das trennt im Musterprojekt
  die zwei gleichnamigen Heizungssätze in Schlafzimmer und Ankleide.
- **Abkürzungen nur vor einem voll genannten Raum.** "Nursery 1 Bed" meint
  nicht das Schlafzimmer, "Bad/ WC" nennt zwei Räume.
- **Kurzcodes brauchen das Namensschema.** "L LR Switching" ist ohne
  projektspezifische Tabelle (L = Licht, LD = dimmbar) nicht lösbar.

## Oberfläche (Schritt 3)

- **Carbon** (g10 hell, g100 dunkel, IBM Plex) als nüchternes Werkzeug mit
  hoher Dichte. Eigene Tabelle auf Carbon-Klassen mit virtuellem Rendern
  statt der Carbon-DataTable, damit auch Projekte mit mehreren tausend GAs
  flüssig bleiben.
- **Analyse im Web Worker**, die Oberfläche bekommt nur reine Daten
  (Snapshot). Jede Antwort löst eine neue Analyse aus; veraltete Ergebnisse
  werden verworfen.
- **Jede Bestätigung ist ein Prüfwert.** Die Werkstatt rechnet zusätzlich
  ohne Antworten und vergleicht: Das ergibt die Trefferquote an echten
  Projekten und eine Abweichungsliste mit Quelle und Begründung im
  Analysebericht. Aus den Bestätigungen entsteht auf Wunsch ein Gold-Standard
  im Benchmark-Format.
- **Belegstärke sichtbar, nicht nur farbig:** drei Balken (fest, mittel,
  schwach) plus Häkchen für bestätigt und Warnzeichen für Widerspruch.
- **Nichts verlässt den Browser.** Schriften aus den npm-Paketen statt CDN,
  Content-Security-Policy im Build (nur eigene Quellen), Prüfskript in der CI
  gegen Abrufe fremder Server. Antworten liegen je Projekt im
  `localStorage`, Passwörter nirgends.
- **Keine Installationsskripte** (`.npmrc`): Carbon und IBM Plex senden sonst
  beim Installieren Nutzungsdaten an IBM.
- **Veröffentlichung über GitHub Pages** aus `main` per Actions-Workflow.
  Bis die Pages-Quelle umgestellt ist, bleibt die bisherige Seite online.

## Befunde aus Schritt 3

- **Falsche Antworten zeigen sich als Strukturfrage.** Wer im Demoprojekt
  "LD LR Dimming value" als Rückmeldung bestätigt, bekommt sofort die Frage,
  warum zwei GAs dieselbe Rolle im Thing haben. Die Bündelung prüft damit die
  Antworten mit.

## Thing Descriptions (Schritt 4)

- **@type aus Brick 1.4 plus KNX-IRIs.** Brick deckt Geräte- und
  Datenpunktklassen ab (`Luminaire`, `On_Off_Command`,
  `Zone_Air_Temperature_Setpoint`); wo Brick nichts Passendes hat (Szene,
  Fensterstatus), stehen die allgemeinen Klassen `Command` und `Status`.
- **Plattform-TD nur mit HTTP.** Beobachten per Server-Sent Events. MQTT
  bleibt möglich, ist aber nicht Teil der Ausgabe.
- **Alles mit Herkunft.** Jede KNX-Form trägt Quelle, Konfidenz und
  Widerspruch für Richtung und DPT. Der strenge Modus filtert für den
  Produktivexport.
- **Eigener Binding-Namensraum.** W3C hat kein KNX-Binding; die Begriffe
  stehen herstellerneutral unter `kb:`, mit Kontextdatei und Begriffsseite.
- **TD 2.0** nach dem Changelog des Entwurfs: Kontext `wot-next`, HTTP-Binding
  nicht mehr im Kern (deshalb `htv:methodName` explizit), `contentType` ohne
  Default (deshalb an jeder Form).

## Befunde aus Schritt 4

- **Nur gleiche Größen paaren.** Im Demoprojekt steht "Setpoint value offset"
  (1.007, Schritt) neben dem Ist-Sollwert (9.001). Gepaart würde der
  Sollwert ein boolean; jetzt wird der Schrittbefehl eine eigene Action.
- **Das TM-Schema auf main ist schon 2.0.** Es akzeptiert nur den
  `wot-next`-Kontext. Für TD 1.1 gelten die bei W3C veröffentlichten
  Schemas unter `/2022/wot/td-schema/v1.1` und `/tm-schema/v1.1`.
- **FT-10 (Steckdose) fehlt in den Stammdaten** der Testprojekte;
  Steckdosen bekommen deshalb kein normiertes Thing Model.
- **Strenger Modus ist streng.** Im Musterprojekt kommen die Richtungen aus
  Namen (Konfidenz unter 0,85); übrig bleiben 20 von 70 Things. Bestätigen
  in der Werkstatt hebt das an.

## Befunde am Schulprojekt (ETS3-Zeit)

Erstes Projekt, das nicht beim Bau des Vokabulars dabei war; vorher 39 %
TD-fertig, 555 Rückfragen.

- **Kein einziger DPT im Projekt**, weder an GAs noch an Objekten. Die
  Herstellerdaten tragen aber immer Größe und Funktionstext, oft eine
  EIS-Angabe. Daraus lässt sich der DPT deterministisch ableiten, mit der
  Größe als hartem Filter. Ein allgemeiner Text ("Schalten" eines
  Binäreingangs) überlässt den Untertyp dem Namen ("ExtractFault" ist 1.005).
- **Objekttexte entscheiden die Richtung besser als Flags.** Platzhalter
  einer Visualisierung ("1 byte (3)") zählen nicht, Stellgrößen eines
  Reglers sind Zustand, Störungstexte machen daraus eine Meldung. Ein
  Messwert bleibt Zustand, auch wenn ein Aktor ihn verwertet.
- **Raumnamen sind Verwaltungsnamen** ("Physics Lab2G (line1)",
  "Circulaton First Floor"), GA-Namen Kurzformen ("PhysLab2G",
  "Corridor_..._First"). Der Abgleich zerlegt beide gleich und kennt Kürzel,
  Synonyme, Geschossbuchstaben und Tippfehler. Ein anderer
  Geschossbuchstabe an der Nummer gilt nur, wenn es keinen passenden Raum
  gibt.
- **"Window" ist im Licht ein Ort**, keine Funktion: "Window_Switch" ist die
  Fensterreihe, kein Fensterkontakt. Bei der Heizung bleibt der
  Fensterkontakt Teil des Raum-Things.
- **Der Begriff muss zur Größe passen.** "Power_Status" mit 1 Bit ist keine
  Leistung, "Brightness" mit 9.004 kein Dimmwert. Rollen prüfen deshalb den
  Haupttyp und fallen auf die nächste Deutung zurück.
- **Drittes Schema "Ort / Gewerk".** Style ist "Gewerk / Funktion", das
  Musterprojekt "Gewerk / Raum", das Schulprojekt "Ort / Gewerk". Dort
  nennen die Namen nur Einzelfunktionen ("Summer_Mode", "Damper_Text"); das
  Raumklima entsteht aus Raumgerät und Gruppenbereich.
- **Zwei Zugänge sind kein zweites Thing.** Klappenwert vom Raumtaster und
  Klappenwert am Aktor haben dieselbe Rolle; das ist keine Strukturfrage.
- **Gold-Standard mit Ermessen.** Stellgröße des Reglers als Zustand,
  Störungen als Meldung, Präsenz-Trigger als Zustand, Zentrallichter als
  eigene Things: Das sind vertretbare Festlegungen, keine Fakten.

## Befunde an Projekt C (Gewerbebau, blind gemessen)

Zuerst ohne jede Anpassung gemessen: 3,8 % TD-fertig, 842 Rückfragen. Das
ist die belastbare Zahl dafür, wie die Regeln aus den bisherigen Projekten
auf ein neues übertragen.

- **Räume über Nummern, nicht über Namen.** Die GAs heißen
  "A0101B057_ASwitchLights_Input", der Raum "02_L1/B/057_Male_WC_&_Lobby".
  In Gewerbebauten und Praxen ist das die Regel. Der Raumcode ist der
  stärkste Hinweis im Namen.
- **Mehrere Gebäude mit gleichen Raumnamen.** "Corridor_Zone1" gibt es in
  allen vier Gebäuden; eindeutig wird es erst über den Gruppenbereich ("Level
  1 Area 1&2"), der das Gebäude nennt. Dafür zählen Wörter, die in jedem
  Gebäudenamen stehen, nicht als Merkmal.
- **6 % der GAs verknüpft.** Verdrahtung und Herstellerdaten belegen nur
  drei Räume; die Konvention überträgt sie auf die übrigen 26. Die
  verknüpften müssen sich einig sein.
- **Gruppenbereiche ohne Funktion.** "New Main Group / Level 1 Area 1&2"
  nennt weder Gewerk noch Begriff. Dann sind Raumklima und Präsenzmelder
  eines Raums je ein Thing, wie beim Schema "Ort / Gewerk".
- **Fehlercode ist kein Alarm.** Eine Meldung ist ein Bit; ein Fehlercode in
  4 Byte ist ein gemeldeter Wert. Der Gold-Standard des Schulprojekts war
  dabei uneinheitlich (1-Byte-EVG-Fehlerstatus als Meldung) und ist
  korrigiert.
- **Steuernde Begriffe vor dem Objekt.** "PIRDisable" sperrt den Melder,
  meldet keine Präsenz; "OccupancyMode" ist die Betriebsart des Reglers.
- **Eine Frage je Funktion.** Fehlt der DPT bei allen
  "<Raum>_EmLamp1Test", ist das eine Entscheidung. Die Antwort gilt für
  alle GAs der Funktion.
- **Ehrliche Obergrenze.** Herstellereigene 3- und 4-Byte-Objekte haben in
  den Stammdaten keinen DPT, unverknüpfte Reglerfunktionen ("HeatingDemand")
  keine Größe. Ohne Kodierung lässt sich keine TD schreiben; diese GAs
  bleiben offen, statt geraten zu werden.


## Befunde an Projekt D (Wohnhaus, blind gemessen)

Zuerst ohne Anpassung gemessen: 68,1 % TD-fertig, 219 Rückfragen. Die
Regeln aus Schule und Projekt C trugen also schon deutlich weiter als bei
Projekt C (3,8 %). Gegen den Gold-Standard waren aber 81 der TD-fertigen
GAs falsch (77 Richtungen, 12 Räume) und die Bündelung nur zu 26 % präzise.
Seitdem misst der Benchmark "davon falsch" mit: Fertig heißt entschieden,
nicht richtig.

- **Ein Drittel Platzhalter.** 136 von 395 GAs heißen "." oder "Reserva".
  Sie sind stillgelegt: kein Thing, keine Rückfrage, nicht im Nenner.
- **Ein Sensor sendet einen Messwert.** Ein Taster, der auf den Eingang
  eines Raumreglers sendet, galt als Sensor, dessen Wert ein Aktor verwertet,
  und sein Befehl damit als Rückmeldung. Als Sensor zählt jetzt nur, wer
  Temperatur, Feuchte, Helligkeit, Wind, CO2 oder Zählerstände sendet; die
  Objektbeschriftung "Ausgang/Eingang" ist kein Eingang.
- **Eingangskanal ist nicht Eingang.** "Input A" eines Binäreingangs meldet,
  auch mit Schreib-Flag. Das fiel erst als Regression am Schulprojekt auf
  (5 auf 32 falsche Richtungen); der Benchmark über alle Projekte hat sie
  gefangen, bevor sie eingecheckt war.
- **Zentral-GAs kleben Kanäle zusammen.** Eine "Estores geral"-GA liegt auf
  allen Rollladenkanälen; über den Aktorkanal gebündelt wurde daraus ein
  Thing über das halbe Haus. Über den Kanal bündeln jetzt nur GAs, die auf
  genau einem Kanal liegen.
- **Etagen als Ort.** "Estores Piso 1 geral" nennt keinen Raum, aber die
  Etage. Nennt ein Name Raum und Etage, gilt der Raum.
- **Portugiesisch brauchte nur Wörter.** Zerlegung, Kennwörter und Regeln
  waren sprachunabhängig genug; es fehlten Begriffe wie Luz, Estores, Toldo,
  Climatização, St (Rückmeldung), Comando, Subir/Descer, Geral.
- **Doppelte Rollen nach Muster.** 29 Strukturfragen waren dasselbe Muster
  in vielen Things; jetzt eine Frage je Muster.
- **Gold-Standard korrigiert.** Der Gold-Standard ist von Hand erstellt; zwei
  Einträge waren uneinheitlich: Handbetrieb des Fancoils ist eine
  Rückmeldung, ein Filteralarm eine Meldung.
- **Nebenbei am Musterprojekt:** Unverknüpfte Heizungs-GAs ("heizen",
  "Betriebsm. Kompf.") haben keine Objektgröße. Ein Begriff ohne eigenen Typ
  ist dann ein Bit, eine Szene eine Szenennummer, aber nur, wenn kein anderer
  Begriff im Namen einen Typ nennt. 47 auf 6 Rückfragen.

## Befunde an Projekt E und Namensschema mit Aufbau

Ein kleines Büroprojekt mit strengem Schema
(`Etage.Raum.Gewerk-Art-Funktion[-Kanal][.Gerät.Kanal]`). Alle GAs liegen in
einem einzigen Gruppenbereich mit Standardnamen, die ganze Struktur steckt im
Namen. Blind 91 % "fertig", davon 182 falsch.

- **Die Etage verdrängte den Raum.** Seit Etagen als Ort zählen, gewann
  "Upper Floor" gegen "Office1" bei gleicher Länge. Jetzt verdrängen Etage und
  Gebäude keinen Raum im selben Namen. Eine Raumnummer weit hinter dem
  Raumwort zählt schwächer ("Office2 ... Gateway #1" ist nicht Office1).
- **Ersatzregeln der Verdrahtung waren so stark wie echte Belege.** "Nur
  Empfänger" und "lesbarer Sender ohne Aktor" zählten 0,93 wie ein
  Aktorausgang. Jetzt zählen sie 0,76: über einem bloßen Begriff im Namen
  (0,6), unter einem Kennwort (0,8). Die Grenze ist am Schulprojekt geeicht.
  Mit 0,7 erzeugte sie dort 35 neue Rückfragen; eine Regel "lesbar und
  beschreibbar ist einstellbar" verwechselte Raumfühler-Sollwerte mit
  Parametern und flog wieder raus.
- **Eingänge eines Aktors für seine Automatik** ("Presence", "Sun",
  "Heating" am Jalousieaktor) sind verwertete Zustände. Ein Objekt ist nie
  zugleich Sensor und Ziel, ein sendender Eingang ist Abgleich zwischen
  Meldern.
- **Haupttyp aus eindeutiger Größe gilt als fest** (0,9). 1 Bit ist immer
  DPT 1, das Datenschema der TD damit sicher. Ein Untertyp, der nur aus dem
  Namen kommt, bleibt bei 0,8.

### LLM-Experiment

Gefragt war, ob ein LLM das Projekt besser liest als die Regeln.

1. **Kürzeltabelle (Format 1), von mir geschrieben:** kein Gewinn, die Richtung
   sogar schlechter. Raumcodes wie "Office1" zerfallen in zwei Wörter, und
   "SET" als Befehl überstimmte Stellgrößen des Reglers. Der Wert des Schemas
   liegt hier im Aufbau, nicht in den Kürzeln.
2. **Aufbau (Format 2), von mir geschrieben:** alle 201 GAs gedeckt, 33 Things
   wie im Gold-Standard. Gold und Schema stammen aber aus derselben Lesart;
   das ist kein Test.
3. **Aufbau von einem unabhängigen LLM, das nur den Prompt sah:** Muster
   deckt alle 201 GAs inklusive Tippfehlern. Raum und Richtung lesen sich wie
   bei mir, 0 falsche, 97 % fertig und richtig. Einziger Unterschied:
   Raumregler und Fancoil als ein Thing (Präzision der Bündelung 63 %). Das
   ist eine Lesart, kein Fehler. Entschieden ist: zwei Things, wie Gerät und
   Brick es trennen.
4. **Was der Prompt braucht:** erlaubte Begriffe als Liste (das LLM erfand
   "brightness" und "fault"), Beschriftung in der Sprache der Namen, eine
   Gruppe "room" mit ETS-Raumnamen oder Raumkürzel mit Zuordnung. Bei großen
   Projekten nur Beispiele je Namensform; die Prüfung läuft danach über alle
   GAs.

### Entscheidungen

- **Kopieren statt API.** Die App bleibt ohne Netzzugriff (CSP, keine
  Schlüssel in einer öffentlichen Seite). Der Mensch kopiert den Prompt in
  ein LLM seiner Wahl und fügt die Antwort ein. Das Ergebnis ist eine
  Schema-Datei, kein LLM-Aufruf je Analyse. Gemessen wird reproduzierbar gegen
  die gespeicherte Datei.
- **Bestätigt heißt fest, außer bei Widerspruch.** Ein Schema gilt erst nach
  "Übernehmen". Es belegt mit 0,92, ersetzt die Namensheuristik, schlägt
  schwache Verdrahtung ohne Rückfrage und verliert mit Rückfrage gegen starke
  Verdrahtung (0,93) und ETS-Angaben (die Kühl-Stellgröße in Projekt E: Name
  "SET", der Regler sendet).
- **Schema-Things sind gesetzt:** keine Strukturfragen darin, andere
  Bündelungsregeln lassen ihre GAs in Ruhe. ETS-Funktionen gehen weiterhin
  vor.

## Befunde an Projekt F (Vorlagenprojekt, über 5.500 GAs)

Ein Einfamilienhaus mit einem Raster von über 5.500 GAs: Die Mittelgruppe
nennt die Funktion ("Schalten", "Position Behang RM"), der Name nur Raum und
Nummer ("Esszimmer 2"), für gut 25 Räume mit je 136 GAs, obwohl das Gebäude 11
Räume hat. Nur 4,6 % der GAs sind mit Geräten verknüpft; 93 % der GAs liegen
in Things ganz ohne Gerät. Blind: 1.306 Things, 2.616 TD-Dateien, 3,2 % fest
belegt, 2.992 Rückfragen. Das ist der Eindruck "2.500 Things im Einfamilienhaus".

- **Die Bündelung war schon richtig.** 16 Heizungs-GAs je Raum und Nummer,
  6 Jalousie-GAs je Name. Das Problem ist die Menge, nicht die Zuordnung.
- **Titel nur aus Ziffern.** 615 von 1.306 Things hießen "1" oder "2", weil
  der Raumname aus dem Titel genommen wurde. Ein Titel ohne Buchstaben fällt
  auf den GA-Namen zurück, danach waren es 80.
- **Das Schema muss den Bereich lesen können.** Der erste Blindlauf eines LLM
  schrieb 23 Muster auf Namen, fand aber die Funktion nicht, weil sie im
  Bereich steht. Neu: `"source": "path"` lässt ein Muster auf den Pfad
  passen.
- **Meine Sicherheitsprüfung war zu grob.** Sie lehnte das übliche
  Namensmuster `(?<room>\S+(?: \S+)*?)` ab, weil sie jede Wiederholung einer
  Gruppe mit Wiederholung als gefährlich las. Jetzt prüft eine Funktion die
  Klammerstruktur: Beginnt jede Runde mit einem festen Trenner, ist die
  Wiederholung eindeutig und erlaubt. Das Limit stieg von 20 auf 40 Muster.
- **Die Beispielauswahl im Prompt ignorierte den Bereich.** "Wohnzimmer 1"
  steht in 16 Mittelgruppen, das LLM sah drei davon. Jetzt kommt reihum aus
  jedem Gruppenbereich ein Beispiel, und alle Bereiche stehen mit Anzahl und
  Beispielname im Prompt.
- **Ein Prompt-Leck.** Bei einem einzelnen Gebäude ist dessen Name oft der
  des Bauherrn. Er steht nicht mehr im Prompt.
- **Datenpunkttyp je Wert im Schema.** Ohne Objekte gibt es für über 4.000
  GAs keinen DPT; ein LLM kennt aber den üblichen Typ ("Schalten" 1.001). Er
  steht in der Prüfliste, der Mensch bestätigt ihn. Passt er nicht zur
  Objektgröße, gilt er nicht.

| Lauf | Muster | gelesene GAs | TD-fertig | fest | Rückfragen | Things |
|---|---|---|---|---|---|---|
| ohne Schema | | | 70,8 % | 3,2 % | 2.992 | 1.306 |
| LLM 1, nur Namen | 23 (abgelehnt, bis die Prüfung gelockert war) | 1.096 | 84,7 % | 4,5 % | 1.263 | 423 |
| LLM 2, Pfad, Beispiele nach Namensform | 7 | 760 | 70,6 % | 3,7 % | 2.992 | 1.420 |
| LLM 3, Beispiele je Bereich | 1 | 4.460 | 89,0 % | 4,0 % | 737 | 779 |
| LLM 4, plus DPT je Wert | 6 | 5.271 | 92,4 % | 38,6 % | 445 | 831 |

Jeder Lauf war ein frisches LLM, das nur den Prompt sah. Die Läufe 2 bis 4
zeigen, dass Fehler im Prompt-Generator teurer waren als Fehler des LLM.
Es gibt keinen Gold-Standard für dieses Projekt; die Zahlen messen
Abdeckung und Festigkeit, nicht Richtigkeit.

### Vorlage und Nutzung

Das Projekt ist kein Fehlerfall, sondern eine verbreitete Arbeitsweise: Der
Errichter importiert eine große GA-Vorlage und verknüpft nur, was ein Haus
braucht. Ein Haus mit 10 oder 100 Räumen hat dann gleich viele GAs. Die
unverknüpften sind legitim, nur erzeugen sie in einer Thing Description
nichts, was ein Gerät tut.

- **Drei Zustände je GA.** In Benutzung: ein Objekt eines Geräts sendet oder
  empfängt auf ihr (ohne Herstellerdaten genügt die Verknüpfung). Verknüpft
  ohne Funktion: nur Platzhalterobjekte oder Objekte ohne Sende- und
  Empfangsflag. Vorrat: mit nichts verknüpft.
- **Vorlage erkennen.** Hat das Projekt Geräte und ist weniger als die
  Hälfte der GAs in Benutzung, fragt Schritt 2 nach dem Umfang. Vorgabe:
  nur in Benutzung. Projekte ohne Geräte (nur Gruppenadressen) fragen nie,
  weil dort "unverknüpft" nichts aussagt.
- **Umfang "nur in Benutzung".** Vorrat und verknüpft ohne Funktion gelten
  als stillgelegt: keine Rückfragen, nicht im Nenner der Kennzahlen, nicht
  im TD-Export. In der Tabelle bleiben sie sichtbar (Marke "Vorrat").
  Umschalten geht jederzeit in der Übersicht.
- **Zahlen für Projekt F.** In Benutzung sind 251 von 5.533 GAs (252 verknüpft, eine als stillgelegt benannt). Ohne
  Schema: TD-fertig 95,6 %, fest 70,1 %, 22 Rückfragen, 131 Things. Mit dem
  Schema aus Lauf 4: fest 79,3 %, 110 Things. Mit allen GAs bleiben 445
  Rückfragen. Projekt E ist unberührt, dort sind alle 201 GAs in Benutzung.

### Ausschluss statt Stilllegung

Der Umfang "nur in Benutzung" setzte Vorrat nur auf "stillgelegt". Erkennung,
Schema, Thing-Bildung und Prompt liefen weiter über alle GAs. Der
Analysebericht eines Vorlagenprojekts (5.533 GAs, 252 verknüpft) zeigte es:
5.282 GAs waren stillgelegt, trotzdem lagen alle 5.533 in Things, nur 145 von
897 Things hatten ein verknüpftes Mitglied, und eine unverknüpfte GA wie
`1/0/0` bekam vom Schema Gewerk, Richtung und Rolle mit 0,92. Der Prompt
enthielt den ganzen Vorrat.

- **Zwei Begriffe.** Stillgelegt (Platzhalter, Reserve) wird erkannt und nur
  nicht gezählt. Ausgeschlossen wird vor der Erkennung aus dem Graphen
  genommen (`restrictGraph`); alles danach sieht die GA nicht. So kann nichts
  mehr durchrutschen, weil kein Zwischenschritt den Ausschluss kennen muss.
- **Regeln.** Vorrat, Hauptgruppen (nach Id, nicht nach Name: "Sonderfunktionen"
  gibt es mit und ohne Leerzeichen) und einzelne GAs, dazu "einzeln
  zurückgeholt". Rangfolge: zurückgeholt, einzeln ausgeschlossen, Gruppe,
  Vorrat. Einträge entstehen nur, wo sie etwas ändern (`excludeIds`,
  `includeIds`), damit der Stand lesbar bleibt.
- **Vorrat als Vokabular.** Ein Schema nur aus den benutzten GAs kennt
  Mittelgruppen nicht, die dieses Projekt nicht braucht, das nächste mit
  derselben Vorlage aber schon. Der Prompt führt sie als Namensliste auf, ohne
  einzelne GAs. Bewusst abgewählte Hauptgruppen zählen dafür nicht.
- **Assistent statt Einzelschritt.** Umfang, Schema und Zusammenfassung sind
  ein Entwurf im Assistenten; die volle Analyse läuft erst danach. Davor
  rechnete jede Umschaltung das ganze Projekt neu. Die Zahlen im Assistenten
  kommen aus leichten Worker-Anfragen (`scope-overview`, `scope-search`).
- **Gespeicherter Stand.** `exclude` ersetzt `scope`. Alte Stände mit
  `scope: "used"` werden zu "Vorrat ausgeschlossen".
- **Bericht.** Neu: Abschnitt `scope` (gesamt, ausgewertet, ausgeschlossen
  nach Grund, Hauptgruppen) und je GA `usage` und `excluded`. Ausgeschlossene
  GAs stehen im Bericht ohne Belege.
- **Offen.** Ob der Ausschluss einzelner Rückmelde-GAs Things unvollständig
  macht, meldet die Zusammenfassung nur, sie verhindert es nicht.
