from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

CORE = "http://schema.knx.org/2023/en50090-6-2/core#"
KNX = "http://schema.knx.org/2020/ontology/knx#"
LOC = "http://schema.knx.org/2023/en50090-6-2/loc#"
TAG = "http://schema.knx.org/2023/en50090-6-2/tag#"
DCT = "http://purl.org/dc/terms/"
OWL = "http://www.w3.org/2002/07/owl#"

ERWARTETE_NAMESPACES = (CORE, KNX, LOC)


class KeinKnxExport(Exception):
    pass


@dataclass
class Knoten:
    id: str
    typen: tuple[str, ...]
    roh: dict[str, Any]

    def texte(self, eigenschaft: str) -> list[str]:
        return [w for w in _werte(self.roh.get(eigenschaft)) if isinstance(w, str)]

    def text(self, eigenschaft: str, sprache: str = "de") -> str:
        rohwert = self.roh.get(eigenschaft)
        mehrsprachig = [
            w for w in _werte(rohwert) if isinstance(w, dict) and "@language" in w
        ]
        if mehrsprachig:
            passend = [w for w in mehrsprachig if w.get("@language") == sprache]
            gewaehlt = passend or [w for w in mehrsprachig if w.get("@language") == "en"]
            return str((gewaehlt or mehrsprachig)[0].get("@value", ""))
        einfach = self.texte(eigenschaft)
        return einfach[0] if einfach else ""

    def wahrheit(self, eigenschaft: str) -> bool | None:
        for wert in _werte(self.roh.get(eigenschaft)):
            if isinstance(wert, dict) and "@value" in wert:
                return str(wert["@value"]).lower() == "true"
            if isinstance(wert, str):
                return wert.lower() == "true"
        return None

    def zahl(self, eigenschaft: str) -> int | None:
        for wert in _werte(self.roh.get(eigenschaft)):
            text = wert.get("@value") if isinstance(wert, dict) else wert
            if isinstance(text, str) and text.lstrip("-").isdigit():
                return int(text)
        return None

    def verweise(self, eigenschaft: str) -> tuple[str, ...]:
        return tuple(
            wert["@id"]
            for wert in _werte(self.roh.get(eigenschaft))
            if isinstance(wert, dict) and "@id" in wert
        )


def _werte(rohwert: Any) -> list[Any]:
    if rohwert is None:
        return []
    return rohwert if isinstance(rohwert, list) else [rohwert]


@dataclass
class Graph:
    knoten: dict[str, Knoten] = field(default_factory=dict)
    kontext: dict[str, str] = field(default_factory=dict)
    rueckverweise: dict[str, list[tuple[str, str]]] = field(default_factory=dict)

    def vom_typ(self, typ: str) -> Iterator[Knoten]:
        for knoten in self.knoten.values():
            if typ in knoten.typen:
                yield knoten

    def ziel(self, knoten: Knoten, eigenschaft: str) -> Knoten | None:
        for verweis in knoten.verweise(eigenschaft):
            treffer = self.knoten.get(verweis)
            if treffer is not None:
                return treffer
        return None

    def quellen(self, knoten_id: str, eigenschaft: str) -> list[Knoten]:
        return [
            self.knoten[quelle]
            for quelle, kante in self.rueckverweise.get(knoten_id, ())
            if kante == eigenschaft and quelle in self.knoten
        ]


def _kuerze(iri: str, kontext: dict[str, str]) -> str:
    for praefix, basis in kontext.items():
        if iri.startswith(basis):
            return f"{praefix}:{iri[len(basis):]}"
    return iri


def lade_graph(pfad: Path) -> Graph:
    if pfad.suffix.lower() == ".ttl":
        raise KeinKnxExport(
            "Turtle wird nicht gelesen. Die ETS exportiert dieselben Daten auch als "
            "JSON Linked Data; bitte die .jsonld-Variante uebergeben."
        )
    try:
        rohdaten = json.loads(pfad.read_text(encoding="utf-8"))
    except json.JSONDecodeError as fehler:
        raise KeinKnxExport(f"{pfad.name} ist kein gueltiges JSON: {fehler}") from fehler
    if not isinstance(rohdaten, dict) or "@graph" not in rohdaten:
        raise KeinKnxExport(
            f"{pfad.name} enthaelt kein @graph auf oberster Ebene. Erwartet wird ein "
            "semantischer ETS-Export (JSON Linked Data)."
        )
    kontext = {
        praefix: basis
        for praefix, basis in rohdaten.get("@context", {}).items()
        if isinstance(basis, str)
    }
    fehlend = [ns for ns in ERWARTETE_NAMESPACES if ns not in kontext.values()]
    if fehlend:
        raise KeinKnxExport(
            f"{pfad.name} nennt die KIM-Namespaces {', '.join(fehlend)} nicht. "
            "Der Export stammt vermutlich nicht aus der ETS oder nutzt eine "
            "unbekannte Ontologieversion."
        )

    graph = Graph(kontext=kontext)
    for eintrag in rohdaten["@graph"]:
        knoten_id = eintrag.get("@id")
        if not isinstance(knoten_id, str):
            continue
        typen = tuple(
            _kuerze(t, kontext)
            for t in _werte(eintrag.get("@type"))
            if isinstance(t, str) and not t.endswith("NamedIndividual")
        )
        graph.knoten[knoten_id] = Knoten(id=knoten_id, typen=typen, roh=eintrag)

    for knoten in graph.knoten.values():
        for eigenschaft in knoten.roh:
            if eigenschaft.startswith("@"):
                continue
            for ziel in knoten.verweise(eigenschaft):
                graph.rueckverweise.setdefault(ziel, []).append((knoten.id, eigenschaft))
    return graph
