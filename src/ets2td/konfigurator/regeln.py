from __future__ import annotations

from typing import Any

from ets2td.pfad_b import lexikon


def regeln_json() -> dict[str, Any]:
    """Exportiert die Ableitungsregeln, damit der Browser dieselben anwendet.

    Einzige Quelle bleibt das Lexikon in Python; der Import im Browser liest
    diese Tabellen, statt eigene Wortlisten zu pflegen.
    """
    return {
        "status": sorted(lexikon.STATUS_WOERTER),
        "event": sorted(lexikon.EVENT_WOERTER),
        "aktion": sorted(lexikon.AKTIONS_WOERTER),
        "messwert": sorted(lexikon.MESSWERT_WOERTER),
        "mehrdeutig": sorted(lexikon.MEHRDEUTIGE_WOERTER),
        "funktionswoerter": sorted(lexikon.FUNKTIONS_WOERTER),
        "raumphrasen": list(lexikon.RAUM_PHRASEN),
        "ausser_betrieb": list(lexikon.AUSSER_BETRIEB),
        "dpt_fallback": [
            {"woerter": sorted(woerter), "dpt": dpt} for woerter, dpt in lexikon.DPT_FALLBACK
        ],
        "knx_rollen": {rolle: wot.value for rolle, wot in lexikon.KNX_ROLLEN.items()},
        "mindestlaenge_teilname": lexikon.MINDESTLAENGE_TEILNAME,
    }
