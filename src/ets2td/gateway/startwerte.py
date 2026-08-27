"""Belegt den Simulator mit plausiblen Anfangswerten.

Abgeleitet wird ausschliesslich aus dem Datenschema der Affordanz. Wo kein
Datenpunkttyp belegt ist, bleibt die Adresse leer: der Simulator soll nicht
Wissen vortaeuschen, das die Thing Description nicht hergibt.
"""

from __future__ import annotations

from typing import Any

from ets2td.gateway.kodierung import KodierFehler, Nutzlast, kodierer_fuer
from ets2td.gateway.ressourcen import Abbildung, Ressource


def startbelegung(abbildung: Abbildung) -> dict[str, Nutzlast]:
    werte: dict[str, Nutzlast] = {}
    for ressource in abbildung.ressourcen:
        if ressource.ga in werte or not ressource.lesbar:
            continue
        nutzlast = _nutzlast_fuer(ressource)
        if nutzlast is not None:
            werte[ressource.ga] = nutzlast
    return werte


def _nutzlast_fuer(ressource: Ressource) -> Nutzlast | None:
    kodierer = kodierer_fuer(ressource.dpt)
    if kodierer is None:
        return None
    for kandidat in _kandidaten(ressource.schema):
        try:
            return kodierer.nach_knx(kandidat)
        except KodierFehler:
            continue
    return None


def _kandidaten(schema: dict[str, Any]) -> list[Any]:
    auswahl = schema.get("enum")
    if isinstance(auswahl, list) and auswahl:
        return [auswahl[0]]
    typ = schema.get("type")
    if typ == "boolean":
        return [False]
    if typ in ("integer", "number"):
        untere, obere = schema.get("minimum"), schema.get("maximum")
        null_erlaubt = (not isinstance(untere, int | float) or untere <= 0) and (
            not isinstance(obere, int | float) or obere >= 0
        )
        kandidaten: list[Any] = [0] if null_erlaubt else []
        if isinstance(untere, int | float):
            kandidaten.append(untere)
        return kandidaten or [0]
    if typ == "string":
        return [""]
    return [False, 0, ""]


def probewert(ressource: Ressource) -> Any:
    """Liefert einen Wert, den der Datenpunkttyp der Ressource annimmt.

    Wird nur fuer den Selbsttest gegen den Simulator gebraucht. Ohne
    belegten Datenpunkttyp gibt es keinen, denn dann waere jeder Wert
    geraten.
    """
    kodierer = kodierer_fuer(ressource.dpt)
    if kodierer is None:
        return None
    for kandidat in _kandidaten(ressource.schema):
        try:
            kodierer.nach_knx(kandidat)
        except KodierFehler:
            continue
        return kandidat
    return None
