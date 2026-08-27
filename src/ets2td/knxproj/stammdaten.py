from __future__ import annotations

from dataclasses import dataclass, field
from xml.etree.ElementTree import Element, fromstring


def lokal(tag: str) -> str:
    return tag.rpartition("}")[2]


@dataclass(frozen=True)
class Bitformat:
    geloescht: str
    gesetzt: str
    name: str = ""


@dataclass(frozen=True)
class Zahlenformat:
    art: str
    breite_bit: int
    einheit: str = ""
    minimum: float | None = None
    maximum: float | None = None
    koeffizient: float | None = None
    name: str = ""


@dataclass(frozen=True)
class Aufzaehlungsformat:
    werte: tuple[tuple[int, str], ...]
    name: str = ""


Format = Bitformat | Zahlenformat | Aufzaehlungsformat


@dataclass(frozen=True)
class DptInfo:
    id: str
    name: str
    text: str
    groesse_bit: int
    formate: tuple[Format, ...] = ()
    haupttyp_id: str = ""


@dataclass(frozen=True)
class Funktionstyp:
    id: str
    text: str
    veraltet: bool = False


@dataclass
class Stammdaten:
    dpts: dict[str, DptInfo] = field(default_factory=dict)
    raumnutzungen: dict[str, str] = field(default_factory=dict)
    funktionstypen: dict[str, Funktionstyp] = field(default_factory=dict)

    def dpt(self, dpt_id: str) -> DptInfo | None:
        return self.dpts.get(dpt_id)


def _zahl(wert: str | None) -> float | None:
    if wert is None or wert == "":
        return None
    return float(wert)


def _sammle_formatelemente(wurzel: Element) -> dict[str, Element]:
    register: dict[str, Element] = {}
    for el in wurzel.iter():
        if lokal(el.tag) in ("Bit", "UnsignedInteger", "SignedInteger", "Float", "Enumeration"):
            el_id = el.get("Id")
            if el_id:
                register[el_id] = el
    return register


def _lies_format(el: Element, register: dict[str, Element]) -> Format | None:
    art = lokal(el.tag)
    if art == "RefType":
        ref = el.get("RefId", "")
        ziel = register.get(ref)
        return _lies_format(ziel, register) if ziel is not None else None
    if art == "Bit":
        return Bitformat(
            geloescht=el.get("Cleared", ""),
            gesetzt=el.get("Set", ""),
            name=el.get("Name", ""),
        )
    if art in ("UnsignedInteger", "SignedInteger", "Float"):
        return Zahlenformat(
            art={"UnsignedInteger": "unsigned", "SignedInteger": "signed", "Float": "float"}[art],
            breite_bit=int(el.get("Width", "0")),
            einheit=el.get("Unit", ""),
            minimum=_zahl(el.get("MinValue")),
            maximum=_zahl(el.get("MaxValue")),
            koeffizient=_zahl(el.get("Coefficient")),
            name=el.get("Name", ""),
        )
    if art == "Enumeration":
        werte = tuple(
            (int(kind.get("Value", "0")), kind.get("Text", ""))
            for kind in el
            if lokal(kind.tag) == "EnumValue"
        )
        return Aufzaehlungsformat(werte=werte, name=el.get("Name", ""))
    return None


def _lies_formate(subtyp: Element, register: dict[str, Element]) -> tuple[Format, ...]:
    ergebnis: list[Format] = []
    for format_el in subtyp:
        if lokal(format_el.tag) != "Format":
            continue
        for kind in format_el:
            gelesen = _lies_format(kind, register)
            if gelesen is not None:
                ergebnis.append(gelesen)
    return tuple(ergebnis)


def lade_stammdaten(master_xml: bytes) -> Stammdaten:
    wurzel = fromstring(master_xml)
    register = _sammle_formatelemente(wurzel)
    daten = Stammdaten()

    for dpt_el in wurzel.iter():
        if lokal(dpt_el.tag) != "DatapointType":
            continue
        dpt_id = dpt_el.get("Id", "")
        groesse = int(dpt_el.get("SizeInBit", "0"))
        daten.dpts[dpt_id] = DptInfo(
            id=dpt_id,
            name=dpt_el.get("Name", ""),
            text=dpt_el.get("Text", ""),
            groesse_bit=groesse,
        )
        for sub_el in dpt_el.iter():
            if lokal(sub_el.tag) != "DatapointSubtype":
                continue
            sub_id = sub_el.get("Id", "")
            daten.dpts[sub_id] = DptInfo(
                id=sub_id,
                name=sub_el.get("Name", ""),
                text=sub_el.get("Text", ""),
                groesse_bit=groesse,
                formate=_lies_formate(sub_el, register),
                haupttyp_id=dpt_id,
            )

    for el in wurzel.iter():
        art = lokal(el.tag)
        if art == "SpaceUsage":
            daten.raumnutzungen[el.get("Id", "")] = el.get("Text", "")
        elif art == "FunctionType":
            daten.funktionstypen[el.get("Id", "")] = Funktionstyp(
                id=el.get("Id", ""),
                text=el.get("Text", ""),
                veraltet=el.get("Status", "") == "deprecated",
            )
    return daten
