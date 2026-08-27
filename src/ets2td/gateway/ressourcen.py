"""Bildet eine Thing Description auf CoAP-Ressourcen ab.

Der Konfigurator erzeugt Forms mit knx://2/0/17. Das benennt die
Gruppenadresse, ist aber kein Protokoll: es gibt kein KNX-Binding bei der
W3C. Dieses Modul schreibt die Forms auf coap:// um und setzt die Terme des
CoAP-Bindings. Damit wird aus dem Steckbrief eine Schnittstelle, die jeder
WoT-Client bedienen kann.

Die Methodenzuordnung folgt der Vorgabe des Bindings: readproperty auf GET,
writeproperty auf PUT, invokeaction auf POST, observeproperty und
subscribeevent auf GET mit Observe-Option.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

COV_IRI = "https://www.w3.org/2019/wot/coap#"
JSON_FORMAT = 50
CBOR_FORMAT = 60
TD_PFAD = ".well-known/wot"

METHODE = {
    "readproperty": "GET",
    "writeproperty": "PUT",
    "observeproperty": "GET",
    "unobserveproperty": "GET",
    "invokeaction": "POST",
    "subscribeevent": "GET",
    "unsubscribeevent": "GET",
}

ABSCHNITTE = (("properties", "properties"), ("actions", "actions"), ("events", "events"))


class AbbildungsFehler(ValueError):
    pass


@dataclass(frozen=True)
class Ressource:
    pfad: tuple[str, ...]
    abschnitt: str
    name: str
    ga: str
    dpt: str | None
    operationen: tuple[str, ...]
    schema: dict[str, Any] = field(default_factory=dict)

    @property
    def lesbar(self) -> bool:
        return bool({"readproperty", "observeproperty", "subscribeevent"} & set(self.operationen))

    @property
    def beobachtbar(self) -> bool:
        return bool({"observeproperty", "subscribeevent"} & set(self.operationen))

    @property
    def schreibbar(self) -> bool:
        return bool({"writeproperty", "invokeaction"} & set(self.operationen))


@dataclass
class Abbildung:
    thing: dict[str, Any]
    ressourcen: tuple[Ressource, ...]

    def nach_ga(self) -> dict[str, list[Ressource]]:
        gruppen: dict[str, list[Ressource]] = {}
        for ressource in self.ressourcen:
            gruppen.setdefault(ressource.ga, []).append(ressource)
        return gruppen


def gruppenadresse_aus(href: str) -> str | None:
    """Liest die Gruppenadresse aus knx://2/0/17 oder aus einem Pfad."""
    if not href:
        return None
    teile = urlsplit(href)
    if teile.scheme == "knx":
        return f"{teile.netloc}{teile.path}".strip("/") or None
    return None


def bilde_ab(td: dict[str, Any], basis: str) -> Abbildung:
    """Erzeugt Ressourcen und die dazu passende, ausfuehrbare Thing Description.

    basis ist der Ursprung des Gateways, etwa coap://192.168.1.10:5683.
    """
    stamm = basis.rstrip("/")
    thing = _kopiere(td)
    thing["@context"] = _kontext_mit_cov(thing.get("@context", []))
    thing["base"] = f"{stamm}/"
    thing["securityDefinitions"] = {"nosec_sc": {"scheme": "nosec"}}
    thing["security"] = "nosec_sc"

    ressourcen: list[Ressource] = []
    for abschnitt, ordner in ABSCHNITTE:
        affordanzen = thing.get(abschnitt)
        if not isinstance(affordanzen, dict):
            continue
        for name, affordanz in affordanzen.items():
            ressource = _bilde_affordanz_ab(abschnitt, ordner, name, affordanz, stamm)
            if ressource is not None:
                ressourcen.append(ressource)
    return Abbildung(thing, tuple(ressourcen))


def _bilde_affordanz_ab(
    abschnitt: str, ordner: str, name: str, affordanz: Any, stamm: str
) -> Ressource | None:
    if not isinstance(affordanz, dict):
        return None
    formen = affordanz.get("forms")
    if not isinstance(formen, list) or not formen:
        raise AbbildungsFehler(f"{abschnitt}/{name} hat keine Forms")

    ga = affordanz.get("ets2td:gruppenadresse")
    if not isinstance(ga, str) or not ga:
        for form in formen:
            if isinstance(form, dict):
                ga = gruppenadresse_aus(str(form.get("href", "")))
                if ga:
                    break
    if not isinstance(ga, str) or not ga:
        raise AbbildungsFehler(f"{abschnitt}/{name} nennt keine Gruppenadresse")

    pfad = (ordner, name)
    operationen: list[str] = []
    neue_formen: list[dict[str, Any]] = []
    for form in formen:
        if not isinstance(form, dict):
            continue
        for op in _operationen_von(form, abschnitt):
            if op not in operationen:
                operationen.append(op)
        neue_formen.append(_baue_form(form, pfad, stamm, abschnitt))
    affordanz["forms"] = neue_formen

    dpt = affordanz.get("ets2td:dpt")
    return Ressource(
        pfad=pfad,
        abschnitt=abschnitt,
        name=name,
        ga=ga,
        dpt=dpt if isinstance(dpt, str) else None,
        operationen=tuple(operationen),
        schema=_schema_von(affordanz, abschnitt),
    )


def _operationen_von(form: dict[str, Any], abschnitt: str) -> list[str]:
    roh = form.get("op")
    if isinstance(roh, str):
        return [roh]
    if isinstance(roh, list):
        return [op for op in roh if isinstance(op, str)]
    return {
        "properties": ["readproperty", "writeproperty"],
        "actions": ["invokeaction"],
        "events": ["subscribeevent"],
    }[abschnitt]


def _baue_form(
    form: dict[str, Any], pfad: tuple[str, ...], stamm: str, abschnitt: str
) -> dict[str, Any]:
    neu = dict(form)
    neu["href"] = f"{stamm}/{'/'.join(pfad)}"
    neu["contentType"] = "application/json"
    neu["cov:contentFormat"] = JSON_FORMAT
    neu["cov:accept"] = JSON_FORMAT
    operationen = _operationen_von(form, abschnitt)
    methoden = {METHODE[op] for op in operationen if op in METHODE}
    if len(methoden) == 1:
        neu["cov:method"] = methoden.pop()
    return neu


def _schema_von(affordanz: dict[str, Any], abschnitt: str) -> dict[str, Any]:
    if abschnitt == "actions":
        eingabe = affordanz.get("input")
        return dict(eingabe) if isinstance(eingabe, dict) else {}
    if abschnitt == "events":
        daten = affordanz.get("data")
        return dict(daten) if isinstance(daten, dict) else {}
    return {
        schluessel: affordanz[schluessel]
        for schluessel in ("type", "unit", "minimum", "maximum", "enum", "const", "multipleOf")
        if schluessel in affordanz
    }


def _kontext_mit_cov(kontext: Any) -> Any:
    """Ergaenzt den cov-Praefix, ohne vorhandene Eintraege zu verlieren."""
    eintraege = list(kontext) if isinstance(kontext, list) else [kontext]
    for eintrag in eintraege:
        if isinstance(eintrag, dict) and eintrag.get("cov") == COV_IRI:
            return eintraege
    for eintrag in eintraege:
        if isinstance(eintrag, dict):
            eintrag["cov"] = COV_IRI
            return eintraege
    eintraege.append({"cov": COV_IRI})
    return eintraege


def _kopiere(wert: Any) -> Any:
    if isinstance(wert, dict):
        return {schluessel: _kopiere(inhalt) for schluessel, inhalt in wert.items()}
    if isinstance(wert, list):
        return [_kopiere(inhalt) for inhalt in wert]
    return wert
