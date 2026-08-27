from __future__ import annotations

from pathlib import Path

import pytest

from ets2td.knxproj.leser import (
    EtsFunktion,
    Gruppenadresse,
    KnxProjekt,
    RaumInfo,
    lies_knxproj,
)
from ets2td.knxproj.stammdaten import Stammdaten

WURZEL = Path(__file__).resolve().parent.parent
BEISPIELE = WURZEL / "beispiele"


@pytest.fixture(scope="session")
def style1() -> KnxProjekt:
    return lies_knxproj(BEISPIELE / "style1.knxproj")


@pytest.fixture(scope="session")
def style3() -> KnxProjekt:
    return lies_knxproj(BEISPIELE / "style3.knxproj")


@pytest.fixture(scope="session")
def demoprojekt() -> KnxProjekt:
    return lies_knxproj(BEISPIELE / "demoprojekt.knxproj")


def synthetisches_projekt(
    gruppenadressen: list[Gruppenadresse],
    funktionen: list[EtsFunktion] | None = None,
    raeume: list[RaumInfo] | None = None,
    stil: str = "ThreeLevel",
) -> KnxProjekt:
    return KnxProjekt(
        name="Testprojekt",
        ga_stil=stil,
        erstellt_mit="Test",
        schema_namespace="http://knx.org/xml/project/20",
        gruppenadressen={ga.id: ga for ga in gruppenadressen},
        funktionen=list(funktionen or []),
        raeume=list(raeume or []),
        stammdaten=Stammdaten(),
    )
