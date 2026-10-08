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
