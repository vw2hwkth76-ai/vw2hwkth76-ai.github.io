from __future__ import annotations

from typing import Any

from ets2td.knxproj.stammdaten import (
    Aufzaehlungsformat,
    Bitformat,
    Stammdaten,
    Zahlenformat,
)
from ets2td.modell import Datenpunkt, WotRolle
from ets2td.td.bauer import datenschema_fuer


def operationen_fuer(rolle: str, nur_lesbar: bool, nur_schreibbar: bool) -> list[str]:
    """Haelt die Operationen zur Zugriffslage passend.

    Muss zu operationenFuer in oberflaeche/import.js passen.
    """
    if rolle == "action":
        return ["invokeaction"]
    if rolle == "event":
        return ["subscribeevent"]
    if nur_schreibbar:
        return ["writeproperty"]
    if nur_lesbar:
        return ["readproperty", "observeproperty"]
    return ["readproperty", "writeproperty", "observeproperty"]

SEMANTIK_JE_HAUPTTYP = {
    "DPT-1": "saref:OnOffState",
    "DPT-9": "saref:Temperature",
    "DPT-12": "saref:Energy",
    "DPT-13": "saref:Energy",
}

SEMANTIK_JE_DPST = {
    "DPST-1-18": "saref:Motion",
    "DPST-1-19": "saref:OpenClose",
    "DPST-9-7": "saref:Humidity",
    "DPST-9-1": "saref:Temperature",
}


def _haupttyp(dpt_id: str) -> str:
    teile = dpt_id.split("-")
    return f"DPT-{teile[1]}" if len(teile) >= 2 else dpt_id


def semantischer_typ(dpt_id: str, rolle: WotRolle) -> str:
    if not dpt_id:
        return ""
    if dpt_id in SEMANTIK_JE_DPST:
        return SEMANTIK_JE_DPST[dpt_id]
    return SEMANTIK_JE_HAUPTTYP.get(_haupttyp(dpt_id), "")


def vorbelegung(punkt: Datenpunkt, stammdaten: Stammdaten) -> dict[str, Any]:
    rolle = WotRolle(punkt.rolle.wert) if punkt.rolle is not None else WotRolle.PROPERTY
    dpt_id = punkt.dpt.wert if punkt.dpt is not None else ""
    schema = datenschema_fuer(dpt_id, stammdaten) if dpt_id else None

    datentyp = str(schema.get("type", "boolean")) if schema else "boolean"
    ist_property = rolle is WotRolle.PROPERTY
    nur_lesbar = ist_property and punkt.lesbar is True and punkt.schreibbar is not True
    nur_schreibbar = ist_property and punkt.schreibbar is True and punkt.lesbar is not True

    werte: dict[str, Any] = {
        "titel": punkt.name or f"GA {punkt.ga_text}",
        "beschreibung": punkt.beschreibung,
        "semantischer_typ": semantischer_typ(dpt_id, rolle),
        "rolle": rolle.value,
        "readonly": nur_lesbar,
        "writeonly": nur_schreibbar,
        "observable": True,
        "safe": False,
        "idempotent": _ist_idempotent(punkt),
        "synchronous": False,
        "datentyp": datentyp,
        "einheit": str(schema.get("unit", "")) if schema else "",
        "minimum": schema.get("minimum") if schema else None,
        "maximum": schema.get("maximum") if schema else None,
        "multipleof": None,
        "maxlength": 14 if _haupttyp(dpt_id) == "DPT-16" else None,
        "href": f"knx://{punkt.ga_text}",
        "contenttype": "application/json",
        "operationen": operationen_fuer(rolle.value, nur_lesbar, nur_schreibbar),
    }
    return werte


def _ist_idempotent(punkt: Datenpunkt) -> bool:
    relativ = ("dimming", "step", "stop", "relative")
    return not any(marker in punkt.knx_rolle.lower() for marker in relativ)


def aufzaehlung_fuer(dpt_id: str, stammdaten: Stammdaten) -> list[dict[str, Any]]:
    info = stammdaten.dpt(dpt_id)
    if info is None:
        return []
    for format_ in info.formate:
        if isinstance(format_, Aufzaehlungsformat):
            return [{"wert": wert, "titel": text} for wert, text in format_.werte]
        if isinstance(format_, Bitformat):
            return [
                {"wert": False, "titel": format_.geloescht or "aus"},
                {"wert": True, "titel": format_.gesetzt or "ein"},
            ]
    return []


def zahl_text(wert: float) -> str:
    """Formatiert Zahlen so, wie es der Browser auch tut (siehe oberflaeche/import.js)."""
    if float(wert).is_integer():
        return str(int(wert))
    return f"{round(float(wert), 2):.2f}".rstrip("0").rstrip(".")


def wertebereich_text(dpt_id: str, stammdaten: Stammdaten) -> str:
    info = stammdaten.dpt(dpt_id)
    if info is None:
        return ""
    schema = datenschema_fuer(dpt_id, stammdaten)
    if schema is not None and schema.get("oneOf"):
        return f"{len(schema['oneOf'])} Stufen"
    if schema is not None and schema.get("type") in ("integer", "number"):
        grenzen = [
            zahl_text(schema[schluessel])
            for schluessel in ("minimum", "maximum")
            if schema.get(schluessel) is not None
        ]
        spanne = " bis ".join(grenzen) if grenzen else ""
        einheit = str(schema.get("unit", ""))
        return f"{spanne} {einheit}".strip() or f"{info.groesse_bit} Bit"

    teile: list[str] = []
    for format_ in info.formate:
        if isinstance(format_, Bitformat):
            teile.append(f"{format_.geloescht} oder {format_.gesetzt}")
        elif isinstance(format_, Aufzaehlungsformat):
            teile.append(f"{len(format_.werte)} Stufen")
        elif isinstance(format_, Zahlenformat):
            teile.append(f"{format_.breite_bit} Bit {format_.einheit}".strip())
    return ", ".join(teile) or f"{info.groesse_bit} Bit"
