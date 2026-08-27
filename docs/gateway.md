# CoAP-Gateway: Thing Descriptions am echten Bus

Der Konfigurator erzeugt Thing Descriptions mit `knx://2/0/17` in den Forms.
Das benennt die Gruppenadresse, ist aber kein Protokoll: die W3C fuehrt kein
KNX-Binding. Ohne Gateway ist die Beschreibung deshalb lesbar, aber nicht
bedienbar.

`ets2td-gateway` schliesst die Luecke. Es laedt eine erzeugte Thing
Description, haengt jede Affordanz als CoAP-Ressource ins Netz und
uebersetzt zwischen JSON beziehungsweise CBOR und dem KNX-Datenpunkttyp.

## Installation

    pip install -e .[gateway]

Der Kern bleibt ohne externe Abhaengigkeiten. Nur das Gateway braucht
aiocoap, xknx und cbor2, alle drei permissiv lizenziert (siehe
docs/dependencies.md).

## Ohne Hardware ausprobieren

    ets2td-gateway ausgabe/td/b/projekt--wohnzimmer.td.json --selbsttest

Der Simulator beantwortet Lesevorgaenge aus einer Startbelegung, die
ausschliesslich aus den Datenschemata der Thing Description stammt. Der
Selbsttest ruft danach jede Affordanz einmal auf und druckt, was
zurueckkam. Geschrieben wird dabei nur gegen den Simulator, nie gegen eine
echte Anlage.

## Am KNXnet/IP-Interface

    ets2td-gateway ausgabe/td/b/projekt--wohnzimmer.td.json \
        --bus tunneling --gateway-ip 192.168.1.50

`tunneling` und `tunneling-tcp` sind Punkt-zu-Punkt-Verbindungen, also
unicast. `routing` bleibt waehlbar, laeuft aber ueber Multicast auf
224.0.23.12 und ist genau der Betriebsfall, den dieses Gateway vermeidet.
`automatik` sucht zuerst eine Tunnelverbindung und faellt erst dann auf
Routing zurueck.

Ohne `--bind` lauscht das Gateway auf allen Adressen. Wo IPv6 abgeschaltet
ist, kann aiocoap das nicht, dann waehlt es die Adresse der aktiven
Netzkarte und sagt das beim Start.

## Was ueber CoAP herauskommt

| Pfad | Methode | Bedeutung |
|---|---|---|
| `/.well-known/wot` | GET | die ausfuehrbare Thing Description |
| `/properties/<name>` | GET | Wert lesen |
| `/properties/<name>` | GET mit Observe | Aenderungen abonnieren |
| `/properties/<name>` | PUT | Wert schreiben |
| `/actions/<name>` | POST | Befehl ausloesen |
| `/events/<name>` | GET mit Observe | Meldung abonnieren |

Die Zuordnung folgt der Vorgabe des CoAP-Bindings. Antwortformat ist JSON,
mit `Accept: application/cbor` auch CBOR.

Eine Antwort sieht so aus:

    {"bekannt": true, "roh": [191], "wert": 75, "einheit": "%"}

`roh` ist die KNX-Nutzlast, `wert` die Auswertung nach Datenpunkttyp. Ist
kein Datenpunkttyp belegt, bleibt `wert` leer und nur `roh` steht da. Das
Gateway raet nicht.

Geschrieben wird mit `{"wert": 75}` oder direkt mit `75`.

## Was das Gateway ablehnt

| Lage | Antwort |
|---|---|
| PUT auf eine nur lesbare Property | 4.05 Method Not Allowed |
| POST auf eine Property | 4.05 Method Not Allowed |
| Wert ausserhalb des Wertebereichs | 4.00 Bad Request |
| Nutzlast nicht lesbar | 4.00 Bad Request |
| Adresse ohne belegten Datenpunkttyp | 4.00 Bad Request |
| `Accept` weder JSON noch CBOR | 4.06 Not Acceptable |

In allen Faellen erreicht kein Telegramm den Bus. Eine Adresse ohne
gepflegten Datenpunkttyp bleibt lesbar, aber nicht beschreibbar: welche
Bytes dort richtig waeren, steht nirgends im Projekt, und Raten auf einem
Aktor ist keine Option. Wer die Adresse schalten will, traegt den
Datenpunkttyp im Konfigurator nach und erzeugt die Thing Description neu.

## Observe statt Polling

Das Gateway hoert alle Gruppentelegramme mit und haelt den letzten Wert je
Adresse. Sendet ein Geraet, geht die Benachrichtigung ohne erneute Abfrage
an alle Beobachter. Genau das traegt eine Visualisierung, die nicht zyklisch
pollt, und es ist die Voraussetzung dafuer, dass Auswertung und Darstellung
ueberhaupt woanders laufen koennen als am Bus.

## Grenzen

Das Gateway ist ein Prototyp und ohne Sicherung ausgelegt: die Thing
Description traegt `nosec_sc`. Fuer einen Betrieb ausserhalb eines
geschlossenen Netzes fehlen DTLS beziehungsweise OSCORE, eine
Zugriffskontrolle und eine Begrenzung der Buslast. KNX Secure auf der
Busseite bringt xknx mit, angebunden ist es hier nicht.

Ein Lesevorgang auf eine Adresse, die noch nie gesendet hat, loest ein
GroupValueRead aus und wartet bis zu drei Sekunden. Adressen ohne
gesetztes Leseflag antworten nicht; dort meldet das Gateway
`{"bekannt": false}` statt einen Wert zu erfinden.
