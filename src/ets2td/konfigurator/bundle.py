from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from ets2td.knxproj.stammdaten import Stammdaten
from ets2td.konfigurator.parameter import (
    OPERATIONEN,
    PARAMETER,
    SICHERHEITSSCHEMATA,
    Parameter,
)
from ets2td.konfigurator.regeln import regeln_json
from ets2td.konfigurator.vorbelegung import (
    aufzaehlung_fuer,
    vorbelegung,
    wertebereich_text,
)
from ets2td.modell import DIMENSIONEN, Datenpunkt, PfadErgebnis
from ets2td.td.bauer import (
    OHNE_RAUM,
    TD_KONTEXT,
    VOKABULAR_IRI,
    datenschema_fuer,
    slug,
)

QUELLEN_KLARTEXT = {
    "ets-semantik": "Semantischer Export",
    "semantik-zugriff": "Export: Zugriffsflags",
    "semantik-geraetekette": "Export: Geraetestandort",
    "semantik-kommobjekt": "Export: Kommunikationsobjekt",
    "ets-funktion": "ETS-Funktion (Linking)",
    "ets-attribut": "ETS-Attribut",
    "gebaeudestruktur": "Gebaeudestruktur",
    "ga-hierarchie": "Gruppenadress-Hierarchie",
    "namenslexikon": "Namensheuristik",
    "llm": "Sprachmodell",
}


def _parameter_json(parameter: Parameter) -> dict[str, Any]:
    daten = asdict(parameter)
    daten["optionen"] = [asdict(option) for option in parameter.optionen]
    daten["sichtbar_wenn"] = {k: list(v) for k, v in parameter.sichtbar_wenn.items()}
    return daten


def _punkt_json(punkt: Datenpunkt, stammdaten: Stammdaten) -> dict[str, Any]:
    dpt_id = punkt.dpt.wert if punkt.dpt is not None else ""
    dpt_info = stammdaten.dpt(dpt_id) if dpt_id else None
    herkunft: dict[str, Any] = {}
    for dimension in DIMENSIONEN:
        zuordnung = punkt.zuordnung(dimension)
        if zuordnung is None:
            herkunft[dimension] = None
            continue
        herkunft[dimension] = {
            "wert": zuordnung.wert,
            "quelle": zuordnung.quelle.value,
            "quelle_klartext": QUELLEN_KLARTEXT.get(
                zuordnung.quelle.value, zuordnung.quelle.value
            ),
            "konfidenz": zuordnung.konfidenz,
        }
    return {
        "id": f"ga-{punkt.ga}",
        "ga": punkt.ga,
        "ga_text": punkt.ga_text,
        "name": punkt.name,
        "beschreibung": punkt.beschreibung,
        "hauptgruppe": punkt.hauptgruppe,
        "mittelgruppe": punkt.mittelgruppe,
        "knx_rolle": punkt.knx_rolle,
        "zentral": punkt.zentral,
        "dpt": dpt_id,
        "dpt_text": dpt_info.text if dpt_info else "",
        "dpt_name": dpt_info.name if dpt_info else "",
        "wertebereich": wertebereich_text(dpt_id, stammdaten) if dpt_id else "",
        "stufen": aufzaehlung_fuer(dpt_id, stammdaten) if dpt_id else [],
        "schema": datenschema_fuer(dpt_id, stammdaten) if dpt_id else None,
        "raum": punkt.raum.wert if punkt.raum is not None else "",
        "funktion": punkt.funktion.wert if punkt.funktion is not None else "",
        "herkunft": herkunft,
        "werte": vorbelegung(punkt, stammdaten),
    }


def _baum(punkte: list[dict[str, Any]]) -> list[dict[str, Any]]:
    raeume: dict[str, dict[str, Any]] = {}
    for punkt in punkte:
        raumname = punkt["raum"] or OHNE_RAUM
        raum = raeume.setdefault(
            raumname, {"id": slug(raumname), "titel": raumname, "funktionen": {}}
        )
        funktionsname = punkt["funktion"] or "Ohne Funktion"
        funktion = raum["funktionen"].setdefault(
            funktionsname,
            {"id": slug(f"{raumname}-{funktionsname}"), "titel": funktionsname, "punkte": []},
        )
        funktion["punkte"].append(punkt["id"])
    return [
        {
            "id": raum["id"],
            "titel": raum["titel"],
            "funktionen": sorted(raum["funktionen"].values(), key=lambda f: f["titel"]),
        }
        for raum in sorted(raeume.values(), key=lambda r: r["titel"])
    ]


def baue_bundle(
    ergebnisse: dict[str, PfadErgebnis],
    stammdaten: Stammdaten,
    projektname: str,
    kennzahlen: dict[str, Any] | None = None,
) -> dict[str, Any]:
    pfade: dict[str, Any] = {}
    for pfadname, ergebnis in ergebnisse.items():
        punkte = [_punkt_json(punkt, stammdaten) for punkt in ergebnis.datenpunkte]
        pfade[pfadname] = {
            "titel": pfadname,
            "punkte": punkte,
            "baum": _baum(punkte),
            "rueckfragen": [asdict(frage) for frage in ergebnis.rueckfragen],
            "hinweise": ergebnis.hinweise[:40],
        }
    return {
        "projekt": projektname,
        "erzeugt_mit": "ets2td",
        "td_kontext": TD_KONTEXT,
        "vokabular": VOKABULAR_IRI,
        "parameter": [_parameter_json(parameter) for parameter in PARAMETER],
        "operationen": {rolle: list(werte) for rolle, werte in OPERATIONEN.items()},
        "sicherheitsschemata": list(SICHERHEITSSCHEMATA),
        "quellen_klartext": QUELLEN_KLARTEXT,
        "regeln": regeln_json(),
        "pfade": pfade,
        "kennzahlen": kennzahlen or {},
    }


def schreibe_bundle(bundle: dict[str, Any], ziel: Path) -> None:
    ziel.write_text(
        json.dumps(bundle, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
