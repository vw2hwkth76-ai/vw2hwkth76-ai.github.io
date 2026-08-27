"""Wandelt zwischen KNX-Nutzlast und JSON-tauglichen Werten.

Die Zuordnung von DPST-Kennung zu Kodierer stammt aus xknx, nicht aus einer
eigenen Tabelle. Ohne belegten Datenpunkttyp wird nichts geraten: dann bleibt
nur der Rohtransport als Bytefolge.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from xknx.dpt.dpt import DPTBase
from xknx.dpt.payload import DPTArray, DPTBinary

Nutzlast = DPTArray | DPTBinary

DPST_MUSTER = re.compile(r"^DPS?T-(\d+)(?:-(\d+))?$")


class KodierFehler(ValueError):
    pass


@dataclass(frozen=True)
class Kodierer:
    kennung: str
    transcoder: type[DPTBase]

    @property
    def einheit(self) -> str:
        return getattr(self.transcoder, "unit", None) or ""

    def nach_knx(self, wert: Any) -> Nutzlast:
        try:
            return self.transcoder.to_knx(_vorbereiten(wert))
        except Exception as fehler:
            raise KodierFehler(f"{wert!r} passt nicht zu {self.kennung}: {fehler}") from fehler

    def aus_knx(self, nutzlast: Nutzlast) -> Any:
        try:
            return vereinfache(self.transcoder.from_knx(nutzlast))
        except Exception as fehler:
            raise KodierFehler(f"{nutzlast!r} passt nicht zu {self.kennung}: {fehler}") from fehler


def xknx_kennung(dpt_id: str) -> str | None:
    """Uebersetzt die ETS-Kennung DPST-5-1 in die xknx-Schreibweise 5.001."""
    treffer = DPST_MUSTER.match(dpt_id.strip())
    if not treffer:
        return None
    haupt, unter = treffer.group(1), treffer.group(2)
    return haupt if unter is None else f"{haupt}.{int(unter):03d}"


def kodierer_fuer(dpt_id: str | None) -> Kodierer | None:
    if not dpt_id:
        return None
    kennung = xknx_kennung(dpt_id)
    if kennung is None:
        return None
    transcoder = DPTBase.parse_transcoder(kennung)
    if transcoder is None:
        return None
    return Kodierer(kennung, transcoder)


def vereinfache(wert: Any) -> Any:
    """Reduziert xknx-Rueckgaben auf Typen, die JSON und CBOR tragen."""
    if isinstance(wert, Enum):
        return vereinfache(wert.value)
    if isinstance(wert, bool | int | float | str) or wert is None:
        return wert
    if isinstance(wert, dict):
        return {str(k): vereinfache(v) for k, v in wert.items()}
    if isinstance(wert, list | tuple):
        return [vereinfache(v) for v in wert]
    if hasattr(wert, "as_dict"):
        return vereinfache(wert.as_dict())
    return str(wert)


def _vorbereiten(wert: Any) -> Any:
    """Nimmt JSON-Wahrheitswerte auch dort an, wo xknx Zahlen erwartet."""
    if isinstance(wert, bool):
        return wert
    return wert


def rohbytes(nutzlast: Nutzlast) -> list[int]:
    if isinstance(nutzlast, DPTBinary):
        return [int(nutzlast.value)]
    if isinstance(nutzlast, DPTArray):
        return list(nutzlast.value)
    raise KodierFehler(f"Unbekannte Nutzlast {nutzlast!r}")


def aus_rohbytes(werte: list[int], binaer: bool) -> Nutzlast:
    if binaer:
        if len(werte) != 1 or not 0 <= werte[0] <= 0x3F:
            raise KodierFehler(f"{werte!r} ist keine gueltige 6-Bit-Nutzlast")
        return DPTBinary(werte[0])
    if any(not 0 <= b <= 0xFF for b in werte):
        raise KodierFehler(f"{werte!r} enthaelt Werte ausserhalb eines Bytes")
    return DPTArray(werte)
