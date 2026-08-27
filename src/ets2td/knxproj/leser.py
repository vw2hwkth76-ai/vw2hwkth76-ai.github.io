from __future__ import annotations

import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree.ElementTree import Element, fromstring

from ets2td.knxproj.archiv import (
    ArchivFehler,
    PasswortNoetig,
    Projektdateien,
    oeffne_projekt,
)
from ets2td.knxproj.stammdaten import Stammdaten, lade_stammdaten, lokal


class KnxProjektFehler(Exception):
    pass


class PasswortGeschuetzt(KnxProjektFehler):
    pass


@dataclass(frozen=True)
class Gruppenadresse:
    id: str
    adresse: int
    name: str
    beschreibung: str = ""
    dpt_id: str = ""
    zentral: bool = False
    hauptgruppe: str = ""
    mittelgruppe: str = ""


@dataclass(frozen=True)
class RaumInfo:
    id: str
    name: str
    typ: str
    nutzung: str = ""
    pfad: tuple[str, ...] = ()


@dataclass(frozen=True)
class FunktionsVerknuepfung:
    rolle: str
    ga_id: str


@dataclass(frozen=True)
class EtsFunktion:
    id: str
    name: str
    typ_id: str
    typ_text: str
    raum: RaumInfo
    verknuepfungen: tuple[FunktionsVerknuepfung, ...] = ()


@dataclass(frozen=True)
class KommObjekt:
    text: str
    ga_ids: tuple[str, ...]


@dataclass(frozen=True)
class Geraet:
    id: str
    raum_id: str = ""
    komm_objekte: tuple[KommObjekt, ...] = ()


@dataclass
class KnxProjekt:
    name: str
    ga_stil: str
    erstellt_mit: str
    schema_namespace: str
    gruppenadressen: dict[str, Gruppenadresse] = field(default_factory=dict)
    funktionen: list[EtsFunktion] = field(default_factory=list)
    raeume: list[RaumInfo] = field(default_factory=list)
    geraete: list[Geraet] = field(default_factory=list)
    stammdaten: Stammdaten = field(default_factory=Stammdaten)
    hinweise: list[str] = field(default_factory=list)


def formatiere_ga(adresse: int, stil: str) -> str:
    if stil == "ThreeLevel":
        return f"{adresse >> 11}/{(adresse >> 8) & 0x7}/{adresse & 0xFF}"
    if stil == "TwoLevel":
        return f"{adresse >> 11}/{adresse & 0x7FF}"
    return str(adresse)


def _kinder(el: Element, name: str) -> list[Element]:
    return [kind for kind in el if lokal(kind.tag) == name]


def _erstes(wurzel: Element, name: str) -> Element | None:
    for el in wurzel.iter():
        if lokal(el.tag) == name:
            return el
    return None


def _lies_gruppenadressen(
    installation: Element, projekt: KnxProjekt, bereichskette: tuple[str, ...] = ()
) -> None:
    wurzel = _erstes(installation, "GroupAddresses")
    if wurzel is None:
        projekt.hinweise.append("Keine GroupAddresses-Sektion gefunden.")
        return
    _lies_bereiche(wurzel, projekt, ())


def _lies_bereiche(el: Element, projekt: KnxProjekt, kette: tuple[str, ...]) -> None:
    for kind in el:
        name = lokal(kind.tag)
        if name == "GroupRange":
            _lies_bereiche(kind, projekt, (*kette, kind.get("Name", "")))
        elif name == "GroupAddress":
            ga_id = kind.get("Id", "")
            projekt.gruppenadressen[ga_id] = Gruppenadresse(
                id=ga_id,
                adresse=int(kind.get("Address", "0")),
                name=kind.get("Name", ""),
                beschreibung=kind.get("Description", ""),
                dpt_id=kind.get("DatapointType", ""),
                zentral=kind.get("Central", "") == "true",
                hauptgruppe=kette[0] if kette else "",
                mittelgruppe=kette[1] if len(kette) > 1 else "",
            )
        else:
            _lies_bereiche(kind, projekt, kette)


def _lies_orte(installation: Element, projekt: KnxProjekt) -> dict[str, str]:
    orte = _erstes(installation, "Locations")
    geraet_zu_raum: dict[str, str] = {}
    if orte is None:
        projekt.hinweise.append("Keine Locations-Sektion (Gebaeudestruktur) gefunden.")
        return geraet_zu_raum
    for kind in orte:
        if lokal(kind.tag) == "Space":
            _lies_raum(kind, projekt, (), geraet_zu_raum)
    return geraet_zu_raum


def _lies_raum(
    el: Element,
    projekt: KnxProjekt,
    pfad: tuple[str, ...],
    geraet_zu_raum: dict[str, str],
) -> None:
    name = el.get("Name", "")
    raum = RaumInfo(
        id=el.get("Id", ""),
        name=name,
        typ=el.get("Type", ""),
        nutzung=projekt.stammdaten.raumnutzungen.get(el.get("Usage", ""), ""),
        pfad=(*pfad, name),
    )
    projekt.raeume.append(raum)
    for kind in el:
        art = lokal(kind.tag)
        if art == "Space":
            _lies_raum(kind, projekt, raum.pfad, geraet_zu_raum)
        elif art == "Function":
            typ_id = kind.get("Type", "")
            typ = projekt.stammdaten.funktionstypen.get(typ_id)
            projekt.funktionen.append(
                EtsFunktion(
                    id=kind.get("Id", ""),
                    name=kind.get("Name", ""),
                    typ_id=typ_id,
                    typ_text=typ.text if typ else "",
                    raum=raum,
                    verknuepfungen=tuple(
                        FunktionsVerknuepfung(
                            rolle=ref.get("Role", ""), ga_id=ref.get("RefId", "")
                        )
                        for ref in _kinder(kind, "GroupAddressRef")
                    ),
                )
            )
        elif art == "DeviceInstanceRef":
            geraet_zu_raum[kind.get("RefId", "")] = raum.id


def _lies_geraete(
    installation: Element, projekt: KnxProjekt, geraet_zu_raum: dict[str, str]
) -> None:
    for el in installation.iter():
        if lokal(el.tag) != "DeviceInstance":
            continue
        geraet_id = el.get("Id", "")
        prefix = geraet_id.rpartition("_")[0]
        komm_objekte: list[KommObjekt] = []
        for ref in el.iter():
            if lokal(ref.tag) != "ComObjectInstanceRef":
                continue
            links = ref.get("Links", "")
            if not links:
                continue
            ga_ids = tuple(
                link if "_" in link else f"{prefix}_{link}" for link in links.split()
            )
            komm_objekte.append(KommObjekt(text=ref.get("Text", ""), ga_ids=ga_ids))
        projekt.geraete.append(
            Geraet(
                id=geraet_id,
                raum_id=geraet_zu_raum.get(geraet_id, ""),
                komm_objekte=tuple(komm_objekte),
            )
        )


def _dateien(archiv: zipfile.ZipFile, passwort: str | None) -> Projektdateien:
    try:
        return oeffne_projekt(archiv, passwort)
    except PasswortNoetig as fehler:
        raise PasswortGeschuetzt(str(fehler)) from fehler
    except ArchivFehler as fehler:
        raise KnxProjektFehler(str(fehler)) from fehler


def lies_knxproj(pfad: Path, passwort: str | None = None) -> KnxProjekt:
    try:
        archiv = zipfile.ZipFile(pfad)
    except zipfile.BadZipFile as fehler:
        raise KnxProjektFehler(f"{pfad} ist kein gueltiges ZIP-Archiv (knxproj).") from fehler
    with archiv:
        dateien = _dateien(archiv, passwort)
        namen = archiv.namelist()

        projekt_xmls = dateien.projekt_xmls()
        installations_xmls = dateien.installations_xmls()
        if not projekt_xmls or not installations_xmls:
            raise KnxProjektFehler(
                "Unerwartete Archivstruktur, gefunden wurden: "
                + ", ".join(sorted(dateien.namen)[:20])
                + ". Erwartet werden project.xml und 0.xml. "
                "Bitte diese Struktur melden, damit der Leser erweitert werden kann."
            )

        try:
            projekt_wurzel = fromstring(dateien.lies(projekt_xmls[0]))
        except PasswortNoetig as fehler:
            raise PasswortGeschuetzt(str(fehler)) from fehler
        except ArchivFehler as fehler:
            raise KnxProjektFehler(str(fehler)) from fehler
        info = _erstes(projekt_wurzel, "ProjectInformation")
        if info is None:
            raise KnxProjektFehler("ProjectInformation nicht gefunden in project.xml.")

        stammdaten = Stammdaten()
        if "knx_master.xml" in namen:
            stammdaten = lade_stammdaten(archiv.read("knx_master.xml"))

        projekt = KnxProjekt(
            name=info.get("Name", ""),
            ga_stil=info.get("GroupAddressStyle", ""),
            erstellt_mit=projekt_wurzel.get("CreatedBy", "")
            + " "
            + projekt_wurzel.get("ToolVersion", ""),
            schema_namespace=projekt_wurzel.tag.partition("}")[0].lstrip("{"),
            stammdaten=stammdaten,
        )
        if not projekt.stammdaten.dpts:
            projekt.hinweise.append("Keine knx_master.xml im Archiv, DPT-Details fehlen.")

        for datei in installations_xmls:
            wurzel = fromstring(dateien.lies(datei))
            for installation in wurzel.iter():
                if lokal(installation.tag) != "Installation":
                    continue
                _lies_gruppenadressen(installation, projekt)
                geraet_zu_raum = _lies_orte(installation, projekt)
                _lies_geraete(installation, projekt, geraet_zu_raum)

    if not projekt.funktionen:
        projekt.hinweise.append(
            "Keine Funktionen (Linking) im Projekt, Pfad B kann nur Namensheuristik nutzen."
        )
    return projekt
