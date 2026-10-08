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
