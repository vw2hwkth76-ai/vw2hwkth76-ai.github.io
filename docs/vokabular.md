# ets2td-Erweiterungsvokabular fuer Thing Descriptions

Die erzeugten TDs nutzen den Standardkontext der TD 1.1
(`https://www.w3.org/2022/wot/td/v1.1`) und zusaetzlich ein kleines eigenes
Vokabular mit dem Praefix `ets2td`, IRI-Basis
`https://vw2hwkth76-ai.github.io/ets2td/vokabular#`. Es transportiert
KNX-Herkunftsinformationen, die der TD-Standard nicht abdeckt. Sobald der
semantische Export der ETS eigene Terme fuer diese Angaben liefert, werden
dessen Terme bevorzugt.

| Term | Ort | Bedeutung |
|---|---|---|
| ets2td:gruppenadresse | Affordanz | Gruppenadresse im Stil des Projekts (z. B. "1/1/0" oder "2304") |
| ets2td:dpt | Affordanz | KNX-Datenpunkttyp der GA (z. B. "DPST-5-1") |
| ets2td:knxRolle | Affordanz | Originale ETS-Rolle der Funktionsverknuepfung (z. B. "SwitchOnOff", auch GUIDs) |
| ets2td:quellen | Affordanz | Je Dimension (raum, funktion, rolle, dpt) Herkunft und Konfidenz der Zuordnung |

Werte fuer `quelle`: ets-semantik, ets-funktion, ets-attribut,
gebaeudestruktur, ga-hierarchie, namenslexikon, llm. `konfidenz` liegt
zwischen 0 und 1; 1.0 bedeutet direkt aus expliziten ETS-Daten uebernommen.

Die `forms` verwenden Platzhalter-URIs im Schema `knx://<gruppenadresse>`,
da die TD 1.1 pro Affordanz mindestens ein form verlangt und der Prototyp
keine Protokollanbindung mitbringt.
