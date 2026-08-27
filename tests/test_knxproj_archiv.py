"""Prueft die Archivschicht: beide Verpackungen und die Entschluesselung.

Die verschluesselten Fixtures werden mit pyzipper erzeugt, also mit einer
anderen Implementierung als der geprueften. Ein Rundlauf durch den eigenen
Verschluessler waere zirkulaer und wuerde eine Abweichung vom Format der
ETS nicht auffallen lassen.
"""

from __future__ import annotations

import io
import zipfile
from typing import Any

import pytest

from ets2td.knxproj.archiv import (
    ArchivFehler,
    PasswortFalsch,
    PasswortNoetig,
    ist_geschuetzt,
    oeffne_projekt,
)

PROJEKT = b"<Project><ProjectInformation Name='Testhaus'/></Project>"
INSTALLATION = b"<Installation/>"
PASSWORT = "geheim"


def knxproj_mit(eintraege: dict[str, bytes]) -> zipfile.ZipFile:
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as archiv:
        for name, inhalt in eintraege.items():
            archiv.writestr(name, inhalt)
    return zipfile.ZipFile(puffer)


def inneres_archiv(verschluesselt: bool, nbits: int = 256, deflate: bool = True) -> bytes:
    puffer = io.BytesIO()
    if not verschluesselt:
        art = zipfile.ZIP_DEFLATED if deflate else zipfile.ZIP_STORED
        with zipfile.ZipFile(puffer, "w", compression=art) as archiv:
            archiv.writestr("project.xml", PROJEKT)
            archiv.writestr("0.xml", INSTALLATION)
        return puffer.getvalue()

    pyzipper: Any = pytest.importorskip("pyzipper", reason="nur zum Erzeugen der Fixture")
    art = pyzipper.ZIP_DEFLATED if deflate else pyzipper.ZIP_STORED
    with pyzipper.AESZipFile(puffer, "w", compression=art, encryption=pyzipper.WZ_AES) as archiv:
        archiv.setpassword(PASSWORT.encode())
        archiv.setencryption(pyzipper.WZ_AES, nbits=nbits)
        archiv.writestr("project.xml", PROJEKT)
        archiv.writestr("0.xml", INSTALLATION)
    return puffer.getvalue()


def test_entpackte_form_wird_gelesen() -> None:
    archiv = knxproj_mit({"P-0001/project.xml": PROJEKT, "P-0001/0.xml": INSTALLATION})
    dateien = oeffne_projekt(archiv)
    assert not dateien.verschachtelt
    assert dateien.projekt_xmls() == ["P-0001/project.xml"]
    assert dateien.installations_xmls() == ["P-0001/0.xml"]
    assert dateien.lies("P-0001/project.xml") == PROJEKT


def test_inneres_archiv_ohne_passwort_wird_gelesen() -> None:
    archiv = knxproj_mit({"P-0001.zip": inneres_archiv(verschluesselt=False)})
    dateien = oeffne_projekt(archiv)
    assert dateien.verschachtelt
    assert dateien.projekt_xmls() == ["project.xml"]
    assert dateien.lies("project.xml") == PROJEKT


def test_mehrere_installationen_werden_gefunden() -> None:
    archiv = knxproj_mit(
        {
            "P-0001/project.xml": PROJEKT,
            "P-0001/0.xml": INSTALLATION,
            "P-0001/1.xml": INSTALLATION,
        }
    )
    assert oeffne_projekt(archiv).installations_xmls() == ["P-0001/0.xml", "P-0001/1.xml"]


def test_ohne_projektdatei_kommt_ein_hinweis_auf_die_struktur() -> None:
    archiv = knxproj_mit({"irgendwas.txt": b"x"})
    with pytest.raises(ArchivFehler, match="Unerwartete Archivstruktur"):
        oeffne_projekt(archiv)


def test_beschaedigtes_inneres_archiv_nennt_den_grund() -> None:
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w", compression=zipfile.ZIP_DEFLATED) as archiv:
        archiv.writestr("P-0001.zip", b"x" * 400)
    roh = bytearray(puffer.getvalue())
    roh[60:80] = b"\xff" * 20
    with pytest.raises(ArchivFehler, match="beschaedigt"):
        oeffne_projekt(zipfile.ZipFile(io.BytesIO(bytes(roh))))


@pytest.mark.parametrize("nbits", [128, 192, 256])
@pytest.mark.parametrize("deflate", [True, False])
def test_verschluesselte_dateien_werden_entschluesselt(nbits: int, deflate: bool) -> None:
    archiv = knxproj_mit({"P-0001.zip": inneres_archiv(True, nbits=nbits, deflate=deflate)})
    dateien = oeffne_projekt(archiv, PASSWORT)
    assert dateien.lies("project.xml") == PROJEKT
    assert dateien.lies("0.xml") == INSTALLATION


def test_ohne_passwort_wird_nichts_geraten() -> None:
    archiv = knxproj_mit({"P-0001.zip": inneres_archiv(True)})
    with pytest.raises(PasswortNoetig, match="Projektpasswort"):
        oeffne_projekt(archiv).lies("project.xml")


def test_falsches_passwort_wird_erkannt() -> None:
    archiv = knxproj_mit({"P-0001.zip": inneres_archiv(True)})
    with pytest.raises(PasswortFalsch, match="passt nicht"):
        oeffne_projekt(archiv, "daneben").lies("project.xml")


def test_schutz_laesst_sich_vorab_feststellen() -> None:
    geschuetzt = knxproj_mit({"P-0001.zip": inneres_archiv(True)})
    offen = knxproj_mit({"P-0001.zip": inneres_archiv(False)})
    entpackt = knxproj_mit({"P-0001/project.xml": PROJEKT, "P-0001/0.xml": INSTALLATION})
    assert ist_geschuetzt(geschuetzt)
    assert not ist_geschuetzt(offen)
    assert not ist_geschuetzt(entpackt)
