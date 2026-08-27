from __future__ import annotations

from typing import Any

from ets2td.knxproj.stammdaten import (
    Aufzaehlungsformat,
    Bitformat,
    DptInfo,
    Stammdaten,
    Zahlenformat,
)
from ets2td.modell import Datenpunkt, PfadErgebnis, WotRolle
from ets2td.pfad_b.lexikon import normalisiere

TD_KONTEXT = "https://www.w3.org/2022/wot/td/v1.1"
VOKABULAR_IRI = "https://vw2hwkth76-ai.github.io/ets2td/vokabular#"
SAREF_IRI = "https://saref.etsi.org/core/"
SPRACHE = "de"

OHNE_RAUM = "Unzugeordnet"


def slug(text: str) -> str:
    return normalisiere(text).replace(" ", "-") or "unbenannt"


def baue_tds(
    ergebnis: PfadErgebnis,
    stammdaten: Stammdaten,
    je_funktion: bool = False,
) -> dict[str, dict[str, Any]]:
    gruppen: dict[str, list[Datenpunkt]] = {}
    for punkt in ergebnis.datenpunkte:
        raum = punkt.raum.wert if punkt.raum is not None else OHNE_RAUM
        if je_funktion:
            funktion = punkt.funktion.wert if punkt.funktion is not None else OHNE_RAUM
            titel = f"{raum}: {funktion}"
        else:
            titel = raum
        gruppen.setdefault(titel, []).append(punkt)

    tds: dict[str, dict[str, Any]] = {}
    vergeben: dict[str, str] = {}
    for titel, punkte in sorted(gruppen.items()):
        dateiname = _freier_dateiname(ergebnis.projekt, titel, vergeben, ergebnis)
        tds[dateiname] = _baue_td(ergebnis, titel, punkte, stammdaten)
    return tds


def _freier_dateiname(
    projekt: str, titel: str, vergeben: dict[str, str], ergebnis: PfadErgebnis
) -> str:
    """Vergibt einen eindeutigen Dateinamen.

    Zwei Raumnamen koennen auf denselben Slug fallen ("Buero 1" und "Buero_1").
    Ohne Suffix wuerde die zweite Thing Description die erste ueberschreiben und
    ganze Raeume verschwaenden lautlos aus der Ausgabe.
    """
    basis = f"{slug(projekt)}--{slug(titel)}"
    name = f"{basis}.td.json"
    laufnummer = 2
    while name in vergeben:
        ergebnis.hinweise.append(
            f"Die Titel '{vergeben[name]}' und '{titel}' ergeben denselben Dateinamen; "
            f"'{titel}' wird mit Suffix {laufnummer} abgelegt."
        )
        name = f"{basis}-{laufnummer}.td.json"
        laufnummer += 1
    vergeben[name] = titel
    return name


def _baue_td(
    ergebnis: PfadErgebnis,
    titel: str,
    punkte: list[Datenpunkt],
    stammdaten: Stammdaten,
) -> dict[str, Any]:
    td: dict[str, Any] = {
        "@context": [
            TD_KONTEXT,
            {"ets2td": VOKABULAR_IRI, "saref": SAREF_IRI, "@language": SPRACHE},
        ],
        "@type": "Thing",
        "id": f"urn:ets2td:{slug(ergebnis.projekt)}:{slug(titel)}",
        "title": titel,
        "description": (
            f"Automatisch erzeugt aus dem ETS-Projekt '{ergebnis.projekt}' (Pfad {ergebnis.pfad})."
        ),
        "securityDefinitions": {"nosec_sc": {"scheme": "nosec"}},
        "security": "nosec_sc",
    }
    kategorien: dict[str, dict[str, Any]] = {"properties": {}, "actions": {}, "events": {}}

    for punkt in punkte:
        rolle = WotRolle(punkt.rolle.wert) if punkt.rolle is not None else WotRolle.PROPERTY
        kategorie = {
            WotRolle.PROPERTY: "properties",
            WotRolle.ACTION: "actions",
            WotRolle.EVENT: "events",
        }[rolle]
        schluessel = slug(punkt.name) if punkt.name else f"ga-{punkt.ga}"
        if schluessel in kategorien[kategorie]:
            schluessel = f"{schluessel}-{punkt.ga}"
        kategorien[kategorie][schluessel] = _baue_affordanz(punkt, rolle, stammdaten)

    for name, inhalt in kategorien.items():
        if inhalt:
            td[name] = inhalt
    return td


def _baue_affordanz(punkt: Datenpunkt, rolle: WotRolle, stammdaten: Stammdaten) -> dict[str, Any]:
    schema = datenschema_fuer(punkt.dpt.wert, stammdaten) if punkt.dpt is not None else None
    href = f"knx://{punkt.ga_text}"

    affordanz: dict[str, Any] = {"title": punkt.name}

    if rolle is WotRolle.PROPERTY:
        if schema is not None:
            # Die Bitlegende des Datenpunkttyps darf die Projektbeschreibung
            # nicht verdraengen; sie wandert nach ets2td:bedeutung.
            bedeutung = schema.pop("description", "")
            affordanz.update(schema)
            if bedeutung:
                affordanz["ets2td:bedeutung"] = bedeutung
        nur_lesen, nur_schreiben = _zugriff(punkt)
        if nur_lesen:
            affordanz["readOnly"] = True
        if nur_schreiben:
            affordanz["writeOnly"] = True
        affordanz["observable"] = not nur_schreiben
        affordanz["forms"] = [{"href": href, "op": _operationen(nur_lesen, nur_schreiben)}]
    elif rolle is WotRolle.ACTION:
        if schema is not None:
            affordanz["input"] = schema
        affordanz["forms"] = [{"href": href, "op": ["invokeaction"]}]
    else:
        if schema is not None:
            affordanz["data"] = schema
        affordanz["forms"] = [{"href": href, "op": ["subscribeevent"]}]

    if punkt.beschreibung:
        affordanz["description"] = punkt.beschreibung

    affordanz["ets2td:gruppenadresse"] = punkt.ga_text
    if punkt.dpt is not None:
        affordanz["ets2td:dpt"] = punkt.dpt.wert
    if punkt.knx_rolle:
        affordanz["ets2td:knxRolle"] = punkt.knx_rolle
    affordanz["ets2td:herkunft"] = [
        {
            "ets2td:dimension": dimension,
            "ets2td:quelle": zuordnung.quelle.value,
            "ets2td:konfidenz": zuordnung.konfidenz,
        }
        for dimension in ("raum", "funktion", "rolle", "dpt")
        if (zuordnung := punkt.zuordnung(dimension)) is not None
    ]
    return affordanz


def _zugriff(punkt: Datenpunkt) -> tuple[bool, bool]:
    """Ermittelt, ob die Adresse ausschliesslich gelesen oder geschrieben wird.

    Sind beide Rechte gesetzt oder ist keines belegt, bleibt die Thing
    Description offen: readOnly und writeOnly entfallen dann beide.
    """
    lesbar, schreibbar = punkt.lesbar, punkt.schreibbar
    if lesbar is None and schreibbar is None:
        return False, False
    return bool(lesbar) and not schreibbar, bool(schreibbar) and not lesbar


def _operationen(nur_lesen: bool, nur_schreiben: bool) -> list[str]:
    if nur_schreiben:
        return ["writeproperty"]
    if nur_lesen:
        return ["readproperty", "observeproperty"]
    return ["readproperty", "writeproperty", "observeproperty"]


def datenschema_fuer(dpt_id: str, stammdaten: Stammdaten) -> dict[str, Any] | None:
    info = stammdaten.dpt(dpt_id)
    if info is None:
        return None
    if not info.formate:
        if info.haupttyp_id or not dpt_id.startswith("DPT-"):
            return None
        return _schema_aus_groesse(info)

    teile = [_schema_fuer_format(format_) for format_ in info.formate]
    if len(teile) == 1:
        return teile[0]
    eigenschaften: dict[str, Any] = {}
    for laufnummer, (format_, teil) in enumerate(zip(info.formate, teile, strict=True), start=1):
        name = getattr(format_, "name", "") or f"teil{laufnummer}"
        eigenschaften[slug(name)] = teil
    return {"type": "object", "properties": eigenschaften}


def _schema_aus_groesse(info: DptInfo) -> dict[str, Any] | None:
    if info.groesse_bit == 1:
        return {"type": "boolean"}
    return None


def _schema_fuer_format(format_: Bitformat | Zahlenformat | Aufzaehlungsformat) -> dict[str, Any]:
    if isinstance(format_, Bitformat):
        schema: dict[str, Any] = {"type": "boolean"}
        if format_.geloescht or format_.gesetzt:
            schema["description"] = f"false = {format_.geloescht}, true = {format_.gesetzt}"
        return schema
    if isinstance(format_, Aufzaehlungsformat):
        return {
            "type": "integer",
            "oneOf": [{"const": wert, "title": text} for wert, text in format_.werte],
        }
    return _zahlenschema(format_)


def _zahlenschema(format_: Zahlenformat) -> dict[str, Any]:
    koeffizient = format_.koeffizient
    if format_.art == "float":
        minimum, maximum = format_.minimum, format_.maximum
    elif format_.art == "signed":
        minimum = float(-(2 ** (format_.breite_bit - 1)))
        maximum = float(2 ** (format_.breite_bit - 1) - 1)
    else:
        minimum = 0.0
        maximum = float(2**format_.breite_bit - 1)
    if koeffizient is not None:
        minimum = None if minimum is None else round(minimum * koeffizient, 2)
        maximum = None if maximum is None else round(maximum * koeffizient, 2)

    ganzzahlig = format_.art != "float" and koeffizient is None
    schema: dict[str, Any] = {"type": "integer" if ganzzahlig else "number"}
    if minimum is not None:
        schema["minimum"] = int(minimum) if ganzzahlig else minimum
    if maximum is not None:
        schema["maximum"] = int(maximum) if ganzzahlig else maximum
    if format_.einheit:
        schema["unit"] = format_.einheit
    return schema
