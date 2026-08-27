# Findings: Was in echten ETS-Projekten wirklich drinsteht

Stand 2026-08-26. Alle Aussagen sind an den eingecheckten Beispielprojekten
verifiziert, nichts ist aus Dokumentation geraten. Untersucht wurden fuenf
Projekte:

| Projekt | Herkunft | Eigenschaften |
|---|---|---|
| style1 bis style3 | ets-to-homeassistant (Apache-2.0) | ETS5, Einfamilienhaus, 251 GAs, 98 Funktionen, 20 Raeume, GA-Stile Free, TwoLevel, ThreeLevel, englische Klarnamen |
| demoprojekt | knxTools (CC-BY-4.0) | ETS5, 19 GAs, 5 Funktionen, Geraete mit Herstellerdaten, Kurzcode-Namen ("L LR Switching"), ungepflegte Gruppennamen |
| musterprojekt-ets6 | reales Kundenprojekt, anonymisiert | ETS6 6.3 (Namespace 23), 194 GAs, 40 Geraete, 13 Raeume, **kein** Funktions-Linking, dazu der semantische Export als JSON-LD |

Das ETS6-Projekt ist der einzige Fall mit beiden Formaten desselben Projekts
und traegt deshalb den eigentlichen Pfadvergleich. Es ist ein ueber zehn Jahre
gewachsenes Bestandsprojekt mit allen typischen Spuren: Tippfehler
("Markiese 9", "Zental Position"), Kurzcodes ("heiz_kompf", "Betriebsm.
Kompf."), Adressen ohne Raumbezug ("Licht K", "Rolladen 3") und ganze
Gruppenbereiche, die per Namenszusatz "--out of use" stillgelegt wurden.

## Kernergebnis

Die beiden Pfade sind nicht besser oder schlechter, sie sind komplementaer.
Gemessen am selben Projekt, gegen denselben Gold-Standard:

| Dimension | Pfad A (semantischer Export) | Pfad B (Heuristik ueber knxproj) |
|---|---|---|
| Raum | 53,1 % | 85,0 % |
| Funktion | 0,0 % | 91,9 % |
| Rolle | 64,9 % | 71,1 % |
| DPT | 47,2 % | 67,6 % |

Der semantische Export gewinnt dort, wo Zusammenhaenge im Projekt verdrahtet
sind und in keinem Namen stehen: Er weiss ueber die Geraetekette, welcher
Raumcontroller welche Adresse sendet, und liefert mit `core:writable` und
`core:readable` eine Rollenaussage, die kein Name hergibt. Er verliert
dort, wo die ETS die Struktur beim Export wegwirft.

Die entscheidende Beobachtung: Ohne Smart Linking exportiert die ETS keine
einzige `core:ApplicationFunction`, und die Gruppenadress-Hierarchie fehlt im
Export vollstaendig. Genau diese Hierarchie ist in diesem Projekt die beste
Semantikquelle ueberhaupt, denn die Mittelgruppen heissen "Kueche",
"Wohnzimmer", "Bad/ WC", "Schlafen". Pfad B holt daraus 77 von 148
Raumzuordnungen. Pfad A kann das nicht, weil die Information den Export nie
erreicht.

Anders gesagt: Der semantische Export ist in einem Projekt ohne Smart Linking
der schwaechere Pfad, obwohl er das formal semantischere Format ist.

## Struktur der knxproj-Datei (ETS5 und ETS6, verifiziert)

- ZIP-Archiv mit `P-XXXX/project.xml` (Projektname, `GroupAddressStyle`),
  `P-XXXX/0.xml` (Installation), `knx_master.xml` (Stammdaten),
  Signaturdateien, optional `M-XXXX/...` (Herstellerdaten).
- `GroupAddress` traegt `Address` als Integer, `Name`, optional `Description`,
  `DatapointType`, `Central`, `Comment`. Die Stil-Aufteilung (frei, zwei-,
  dreistufig) ist reine Anzeige: die Integer sind in allen drei
  Stil-Varianten identisch.
- `GroupRanges` (Haupt- und Mittelgruppen mit Namen) existieren in allen
  Stilen, auch bei `GroupAddressStyle="Free"`. Im knxproj gehen die Haupt-
  und Mittelgruppennamen also nicht verloren. Der Fallstrick "nur der Text der
  Untergruppe kommt mit" trifft dagegen den semantischen Export voll, siehe
  unten.
- ETS6 (Namespace `http://knx.org/xml/project/23`) aendert an all dem nichts
  Wesentliches: derselbe Archivaufbau, dieselben Elemente. Der vorhandene
  Leser verarbeitet ETS5 und ETS6 ohne Fallunterscheidung. Neu ist der
  Raumtyp `DistributionBoard` fuer den Schaltschrank.
- `Locations`: `Space`-Baum mit `Type` (Building, BuildingPart, Floor, Room),
  optional `Usage` (Codes wie `SU-4`, aufloesbar ueber die Stammdaten zu
  "Living room" usw.). In Raeumen haengen `Function`-Elemente
  (`Type="FT-x"`) mit `GroupAddressRef`-Kindern, die je ein `Role`-Attribut
  tragen (`SwitchOnOff`, `InfoOnOff`, `MoveUpDown`, ...). Das ist die
  tragfaehigste Semantikquelle in Pfad B.
- `knx_master.xml` liegt in jedem Archiv und enthaelt die kompletten
  DPT-Definitionen inklusive Bitbedeutungen (Off/On), Einheiten, Min/Max,
  Koeffizienten und Aufzaehlungswerten, dazu Raumnutzungs- und
  Funktionstypkataloge. Eine externe DPT-Tabelle ist unnoetig, die
  Wertebereiche der erzeugten TDs stammen direkt aus dem Projektarchiv.

## Struktur des semantischen Exports (ETS 6.3, verifiziert)

Der Export ist ein JSON-LD-Dokument mit `@context` und `@graph`, hier 1309
Knoten. Verwendete Namespaces: `core:`
(`http://schema.knx.org/2023/en50090-6-2/core#`), `loc:`, `tag:`, `knx:`
(`http://schema.knx.org/2020/ontology/knx#`), dazu QUDT fuer Einheiten. Der
projektspezifische Praefix `prj:` traegt die Projekt-GUID.

Die tatsaechlich vorkommenden Knotentypen und ihre Anzahl in diesem Projekt:

| Typ | Anzahl | Bedeutung |
|---|---|---|
| `core:Datapoint` | 957 | Kommunikationsobjekte der Geraete |
| `knx:FunctionPoint` | 194 | die Gruppenadressen, mit `knx:groupAddress` |
| `core:Device` | 40 | Geraete, mit `knx:individualAddress` |
| `core:ApplicationProgram` | 40 | Applikationsprogramme |
| `core:Functionality` | 39 | Objektgruppe je Applikationsprogramm |
| `loc:Room` | 10 | Raeume, mit `tag:hasLocationUsage` |
| `core:Product`, `knx:Channel`, `loc:Floor`, `loc:Building`, `loc:Site` | wenige | Katalog und Gebaeudehuelle |

Der Weg von einer Gruppenadresse zu einem Raum fuehrt ueber fuenf Kanten und
ist die einzige Ortsinformation im Export:

```
knx:FunctionPoint --core:groups--> core:Datapoint
core:Functionality --core:hasPoint--> core:Datapoint
core:ApplicationProgram --core:implements--> core:Functionality
core:Device --core:hosts--> core:ApplicationProgram
loc:Room --loc:containsEquipment--> core:Device
```

Datenpunkttypen stehen als Individuen (`knx:switch`, `knx:bool`,
`knx:valueElectricCurrent`) am FunctionPoint oder am Datapoint. Die Ontologie
fuehrt zu jedem Individuum `knx:dptMajorNumber` und `knx:dptMinorNumber`,
womit sich `knx:switch` verlustfrei auf `DPST-1-1` abbilden laesst. Die
Tabelle dafuer erzeugt `werkzeuge/kim_dpt_tabelle.py` aus der offiziellen
Ontologie (389 Individuen); geraten wird nichts.

## Konkrete Datenverluste und Fallstricke

### Im semantischen Export

1. **Die Gruppenadress-Hierarchie fehlt vollstaendig.** Im knxproj stehen 40
   `GroupRange`-Elemente mit den Namen "Licht", "Rolladen", "Heizen",
   "Kueche", "Wohnzimmer", "Bad/ WC". Im Export existiert kein einziger
   Knoten dafuer. Uebrig bleibt der `dct:title` des FunctionPoint, also
   ausschliesslich der Text der Untergruppe. In diesem Projekt ist damit die
   beste Raumquelle verloren: aus den Mittelgruppen holt Pfad B 77
   Raumzuordnungen, Pfad A kommt insgesamt nur auf 83.
2. **Ohne Smart Linking keine Funktionssemantik.** Der Export enthaelt null
   `core:ApplicationFunction`. Die 39 `core:Functionality`-Knoten sind keine
   Ersatzquelle: sie buendeln stumpf alle Objekte eines Applikationsprogramms
   ("Functionality containing 391 points") und tragen keine Raum- oder
   Gewerkbedeutung. Pfad A erreicht bei der Funktionsdimension 0,0 Prozent,
   die einzigen zwei Zuordnungen stammen aus `knx:Channel` und sind beide
   falsch (der Kanalname "Praesenz 1" eines Melders wird auf die geschaltete
   Leuchte uebertragen).
3. **Datenpunkttypen kommen nur mit, wo sie gepflegt sind.** 31 der 194
   Adressen tragen einen DPT, exakt dieselben 31 wie im knxproj. Der Export
   erfindet nichts, verliert aber auch nichts. Ueber die verbundenen
   Kommunikationsobjekte kommen 31 weitere hinzu, macht 62 von 194.
4. **Die Ortsangabe ist der Geraetestandort, nicht der Wirkort.** Das ist der
   gefaehrlichste Punkt, weil er falsche statt fehlender Werte erzeugt. 73
   der 121 eindeutigen Treffer landen im Raum "Verteilung", also im
   Schaltschrank, weil dort der Aktor haengt. Bei "Rolladen 4 lang" liefert
   die Kette "Kueche", weil dort der Tastsensor sitzt; der Rolladen haengt
   laut Mittelgruppe im Wohnzimmer. Der Prototyp senkt deshalb die Konfidenz
   auf 0,5 und protokolliert einen Hinweis, sobald neben dem Wohnraum ein
   Betriebsmittelort beteiligt ist.
5. **Umgekehrt weiss der Export Dinge, die in keinem Namen stehen.** In der
   Mittelgruppe "Schlafen" liegen zwei gleichlautende Betriebsmodus-Saetze
   ("Betriebsm. Kompf." zweimal, dito Nacht und Frost). Aus den Namen ist
   nicht entscheidbar, welcher wohin gehoert. Der Export loest es auf: den
   ersten Satz sendet der Raumcontroller im Schlafzimmer, den zweiten der in
   der Ankleide. Dieser Befund hat den Gold-Standard korrigiert, nicht
   umgekehrt.
6. **Rollen stecken in den Zugriffsflags.** `core:writable` und
   `core:readable` sind an 149 der 194 Adressen gesetzt und die einzige
   Rollenquelle des Exports. Die Zuordnung ist eindeutig, wo nur eines von
   beiden gesetzt ist. Bei 18 Adressen mit beiden Flags (Sollwerte,
   Betriebsmodi) liefert der Export ein beschreibbares Property, waehrend die
   KNX-uebliche Lesart ein Kommando sieht. Das erklaert 23 der Rollenfehler
   und ist eher ein Modellierungsunterschied als ein Fehler; wer TDs mit
   `readOnly: false` akzeptiert, liegt mit Pfad A richtig.
7. **Namen kommen unveraendert mit**, inklusive Tippfehlern und
   Leerzeichen am Ende. Einzige beobachtete Abweichung zum knxproj: eine
   XML-Entity wird aufgeloest ("I &gt; Imax" wird zu "I > Imax").
8. **Wertebereiche fehlen.** Der Export nennt den DPT, aber keine Einheiten,
   Minima oder Maxima. Wer TDs mit Wertebereichen will, braucht zusaetzlich
   die `knx_master.xml` aus dem knxproj. Ohne knxproj weist die CLI darauf hin.

### Im knxproj

1. Benutzerdefinierte Rollen erscheinen nur als GUID. In style1 haengen an
   der Funktion "Light room switch" Verknuepfungen wie
   `Role="275fe355-566d-4987-bc4e-3f644974b62f"` (GA 1/0/11 "Living room
   Light room dimming"). Die GUID ist weder in der Installation noch in
   `knx_master.xml` definiert. Die Rollensemantik benutzerdefinierter
   Funktionen geht beim Export verloren; uebrig bleibt Namensheuristik.
2. Auch in einem gepflegten Projekt fehlen DPTs: 31 von 251 GAs in style1
   haben kein `DatapointType`-Attribut (Zentralfunktionen, "Dawn switch").
   9 davon kann die Namensheuristik schaetzen, 22 bleiben offen und landen
   in der Rueckfrageliste.
3. Eine GA kann in mehreren Funktionen haengen. Die Heizungs-GAs (TempRoom,
   TempRoomSetpoint, HVACMode, WindowStatus) sind in style1 gleichzeitig in
   "Radiator" und "Floor heating" verlinkt. Eine eindeutige
   Funktionszuordnung pro Datenpunkt existiert dann nicht; der Prototyp
   nimmt die erste und protokolliert den Konflikt.
4. Kommentare sind RTF-Blobs. Im demoprojekt steckt in `Comment` komplettes
   RTF-Markup; als Semantikquelle praktisch unbrauchbar.
5. Ungepflegte Gruppennamen sind real: das demoprojekt nutzt woertlich
   "New main group" und "New middle group". Die GA-Hierarchie liefert dort
   keinerlei Information.
6. Zentral-GAs (`Central="true"`) haengen an Funktionen auf Gebaeudeebene.
   Ihr "Raum" ist das Gebaeude ("One-family house"); ohne Funktions-Linking
   ist das aus dem Namen nicht ableitbar.
7. Funktionsnamen mit Raumwoertern ("Light room switch") brechen die
   Namensheuristik: "Living room Light room switch" wird falsch in Raum und
   Funktion zerlegt. Sichtbar in den Fehlerbeispielen des Berichts.
8. Der als veraltet markierte Funktionstyp FT-2 ("dimmable light",
   `Status="deprecated"`) ist in style1 54-mal in Gebrauch; der Nachfolger
   FT-6 existiert parallel. Kataloge und Realitaet laufen auseinander.
9. `ComObjectInstanceRef` verweist auf GAs in Kurzform (`Links="GA-3"`).
   Aufloesbar nur ueber das Praefix der Geraete-Id (`P-045C-0_DI-1` fuehrt
   zu `P-045C-0_GA-3`). Ob der erste Link die sendende GA ist, ist nicht
   verifiziert.
10. Die DPT-Ableitung ueber Kommunikationsobjekte der Herstellerdateien
    (`M-XXXX/*.xml`, im demoprojekt bis 52 MB XML) ist eine ungenutzte
    Quelle; der Prototyp liest bisher nur die Verknuepfungen, nicht die
    Objektgroessen.
11. Stillgelegte Gruppenbereiche werden per Namenszusatz markiert, nicht per
    Attribut. Im Musterprojekt heissen vier Mittelgruppen "... --out of use"
    und enthalten weiterhin 17 Adressen. Der Prototyp erkennt den Zusatz und
    zieht aus solchen Gruppen keinen Raum mehr.
12. Sammelmittelgruppen wie "Bad/ WC" benennen zwei Raeume gleichzeitig. Ohne
    Hinweis im Adressnamen ist keiner davon belegt; der Prototyp laesst den
    Raum dann offen, statt sich fuer einen zu entscheiden.

## Messergebnisse

Alle Zahlen stammen aus `ets2td` gegen die eingecheckten Gold-Standards und
sind mit `python3 -m pytest` und der Playground-Validierung reproduzierbar.

### Musterprojekt ETS6, beide Pfade am selben Projekt

Gold-Standard: `beispiele/musterprojekt-ets6.gold.json`, manuell festgelegt
nach Durchsicht aller 194 Adressen (`werkzeuge/gold_musterprojekt.py`).
Bewertet sind 147 Raeume, 74 Funktionen, 194 Rollen, 108 DPTs; der Rest
bleibt bewusst unbewertet.

| Dimension | Pfad A korrekt | Quote | Pfad B korrekt | Quote |
|---|---|---|---|---|
| Raum | 78 von 147 | 53,1 % | 125 von 147 | 85,0 % |
| Funktion | 0 von 74 | 0,0 % | 68 (+4 Teiltreffer) von 74 | 91,9 % |
| Rolle | 126 von 194 | 64,9 % | 138 von 194 | 71,1 % |
| DPT | 51 von 108 | 47,2 % | 73 von 108 | 67,6 % |

Fehlerprofil: Pfad A macht fast keine falschen Zuordnungen (2 Raum, 2
Funktion, 23 Rolle), sondern laesst weg (67 Raum, 72 Funktion, 57 DPT). Pfad
B ist umgekehrt aggressiver (10 falsche Raeume) und deckt dafuer mehr ab.
Wer Vollstaendigkeit braucht, nimmt B; wer Verlaesslichkeit braucht, nimmt A
und akzeptiert Luecken.

Offene Rueckfragen: 192 bei Pfad A, 146 bei Pfad B. Beide Listen liegen als
`rueckfragen-a.md` und `rueckfragen-b.md` im Ausgabeverzeichnis.

### ETS5-Projekte, Pfad B gegen sich selbst

Gold-Standard hier abgeleitet aus ETS-Funktionen, Gebaeudestruktur und
gepflegten DPT-Attributen. Pfad b (mit Linking) ist damit
konstruktionsbedingt bei 100 Prozent und dient nur als Kontrolle; die
Messung ist b-pur, also dieselbe Heuristik mit ignoriertem Linking.

| Projekt | Raum | Funktion | Rolle | DPT |
|---|---|---|---|---|
| Style3, b-pur | 97,6 % | 72,8 % | 74,0 % | 100 % |
| DemoProject, b-pur | 100 % | 89,5 % | 52,9 % | 100 % |

Die DPT-Quote von 100 Prozent ist ein Artefakt: das Gold bewertet dort nur
gepflegte DPT-Attribute. Die echte Luecke sind die 22 unbewerteten Adressen.

Die Rollenquote von DemoProject ist gegenueber einem frueheren Stand
gesunken, weil "Position" und "Wert" jetzt als mehrdeutig gelten und keine
Rolle mehr erzeugen. Falsche Zuordnungen fielen dafuer von 14 auf 1. Das ist
die beabsichtigte Richtung: lieber eine Rueckfrage als ein geratener Wert.

Alle erzeugten TDs bestehen die Pruefung der Thingweb-Playground-CLI (JSON,
Schema, Zusatzchecks; JSON-LD-Pruefung deaktiviert, da sie Netzzugriff
braucht).

## Rollenkonvention

Kommandos (Schalten, Dimmen, Fahren, Sollwert und Betriebsart setzen,
Szenen) sind action, Zustaende und Rueckmeldungen (Status, Ist- und
Positionswerte, Fensterstatus, Stellgroessen) sind property, spontane
Meldungen mit Alarmcharakter sind event. Der Katalog beobachteter
KNX-Rollen steht in `src/ets2td/pfad_b/lexikon.py` (`KNX_ROLLEN`) und
enthaelt bewusst nur am realen Material beobachtete Rollen; unbekannte
Rollen fallen auf die Namensheuristik zurueck und werden protokolliert.

Bezeichnungen, die in realen Projekten mal den Stellbefehl und mal die
Rueckmeldung tragen ("Position", "Wert", "Helligkeit"), erzeugen ohne
Statusmarker im Namen bewusst keine Rolle. Am Musterprojekt sank die Zahl
falscher Rollen dadurch von 14 auf 2, am DemoProject von 14 auf 1.

Pfad A nutzt stattdessen `core:writable` und `core:readable`. Wo beides
gesetzt ist, entsteht ein beschreibbares Property statt einer Action; beide
Lesarten sind WoT-konform, die Messung zaehlt es nach der KNX-Konvention als
Abweichung.

## KIM-Ontologie

- Quelle: https://gitlab.knx.org/public-projects/hbes-information-model
  (MIT-Lizenz, KNX Association 2024), auch abrufbar ueber
  https://schema.knx.org/2020/ontology?destination_format=jsonld
- Kernnamespace `http://schema.knx.org/2023/en50090-6-2/core#` mit Klassen
  wie Installation, Device, Datapoint, FunctionalBlock, ApplicationFunction,
  Location; weitere Namespaces `loc#`, `tag#`,
  `http://schema.knx.org/2020/ontology/knx#`, dazu QUDT fuer Einheiten.
- Aus der Ontologie wird ausschliesslich die DPT-Tabelle abgeleitet
  (`werkzeuge/kim_dpt_tabelle.py`, 389 Individuen mit Major- und
  Minor-Nummer). Alle uebrigen Terme sind am echten Export verifiziert.
- Der Export enthaelt laut KNX-Dokumentation zusaetzlich eine Kopie der
  Ontologie. Im vorliegenden Export ist sie nicht enthalten: er umfasst nur
  Projektdaten (1309 Knoten). Wer die Ontologie braucht, laedt sie separat.

## Offene Punkte

1. Kein Projekt **mit** Smart Linking im Bestand. Die zentrale Aussage
   dieses Berichts ("ohne Smart Linking ist der semantische Export der
   schwaechere Pfad") ist damit belegt; die Gegenprobe fehlt. Ein Export
   eines Projekts mit gepflegten Funktionen wuerde zeigen, wie viel Pfad A
   gewinnt, wenn `core:ApplicationFunction` tatsaechlich befuellt ist.
2. Turtle (.ttl) wird nicht gelesen. Die ETS exportiert dieselben Daten als
   JSON-LD; ein Turtle-Parser waere eine zusaetzliche Abhaengigkeit ohne
   neuen Erkenntnisgewinn. Die CLI weist darauf hin.
3. DPT-Ableitung aus Herstellerdaten (Objektgroessen der
   Kommunikationsobjekte) ist als Quelle vorbereitet, aber nicht
   implementiert. Sie wuerde vor allem Pfad B helfen.
4. Die Gold-Standards sind Arbeitsstaende und sollten vom jeweiligen
   Projektverantwortlichen geprueft werden. Beim Musterprojekt sind 47
   Raeume, 120 Funktionen und 86 DPTs bewusst unbewertet; bei den
   ETS5-Projekten 42 beziehungsweise 2 Dimensionswerte.
5. Die Ortsangabe von Pfad A liesse sich verbessern, wenn man Sensoren,
   Aktoren und Bedienelemente unterscheidet. Der Export nennt dafuer
   `core:Product` mit Bestellnummer und Produktnamen ("Jalousieaktor UP
   1fach", "Tastsensor 4fach"). Das waere allerdings wieder Namensheuristik,
   diesmal auf Geraeteebene, und gehoert damit methodisch zu Pfad B.
