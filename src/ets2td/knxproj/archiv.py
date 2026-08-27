"""Findet die Projektdateien im knxproj, gleich in welcher Verpackung.

Die ETS legt project.xml und 0.xml auf zwei Arten ab: entweder in einem
Ordner P-XXXX direkt im Archiv, oder in einem eigenen Archiv P-XXXX.zip
darin. Die zweite Form ist der Regelfall, sobald ein Projektpasswort
gesetzt ist; dann sind die beiden Dateien mit WinZip-AES verschluesselt.

Das Passwort verlaesst diese Ebene nicht: entschluesselt wird beim Lesen,
gespeichert wird nichts.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import re
import struct
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from zipfile import ZipFile, ZipInfo

AES_METHODE = 99
AES_KENNUNG = 0x9901
AES_RUNDEN = 1000
SALZLAENGEN = {1: 8, 2: 12, 3: 16}
PRUEFLAENGE = 2
SIGNATURLAENGE = 10

PROJEKT_XML = re.compile(r"(?:^|/)[Pp]roject\.xml$")
INSTALLATION_XML = re.compile(r"(?:^|/)\d+\.xml$")
INNERES_ARCHIV = re.compile(r"^P-[0-9A-Fa-f]+\.zip$")


class ArchivFehler(Exception):
    pass


class PasswortNoetig(ArchivFehler):
    pass


class PasswortFalsch(ArchivFehler):
    pass


class EntschluesselungNichtVerfuegbar(ArchivFehler):
    pass


@dataclass(frozen=True)
class Projektdateien:
    """Die Projektdateien samt Zugriff, unabhaengig von ihrer Verpackung."""

    namen: tuple[str, ...]
    lies: Callable[[str], bytes]
    verschachtelt: bool

    def projekt_xmls(self) -> list[str]:
        return sorted(n for n in self.namen if PROJEKT_XML.search(n))

    def installations_xmls(self) -> list[str]:
        return sorted(n for n in self.namen if INSTALLATION_XML.search(n))


def _aes_angaben(info: ZipInfo) -> tuple[int, int] | None:
    """Liest Verschluesselungsstaerke und die eigentliche Kompressionsmethode."""
    roh, pos = info.extra, 0
    while pos + 4 <= len(roh):
        kennung, laenge = struct.unpack_from("<HH", roh, pos)
        if kennung == AES_KENNUNG and laenge >= 7:
            _, _, staerke, methode = struct.unpack_from("<HHBH", roh, pos + 4)
            return staerke, methode
        pos += 4 + laenge
    return None


def _schluessel(passwort: str, salz: bytes, laenge: int) -> tuple[bytes, bytes, bytes]:
    roh = hashlib.pbkdf2_hmac(
        "sha1", passwort.encode("utf-8"), salz, AES_RUNDEN, 2 * laenge + PRUEFLAENGE
    )
    return roh[:laenge], roh[laenge : 2 * laenge], roh[2 * laenge :]


def _aes_ctr(schluessel: bytes, daten: bytes) -> bytes:
    """AES im Zaehlermodus, wie WinZip ihn verwendet: little endian, ab 1."""
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    except ImportError as fehler:
        raise EntschluesselungNichtVerfuegbar(
            "Fuer passwortgeschuetzte Projekte wird cryptography gebraucht: "
            "pip install -e '.[passwort]'. Alternativ das Projekt in der ETS "
            "ohne Passwort exportieren."
        ) from fehler

    bloecke = (len(daten) + 15) // 16
    zaehler = b"".join(nummer.to_bytes(16, "little") for nummer in range(1, bloecke + 1))
    rechner = Cipher(algorithms.AES(schluessel), modes.ECB()).encryptor()
    maske = rechner.update(zaehler) + rechner.finalize()
    return bytes(a ^ b for a, b in zip(daten, maske, strict=False))


def entschluessele(info: ZipInfo, roh: bytes, passwort: str) -> bytes:
    """Macht einen mit WinZip-AES geschuetzten Eintrag wieder lesbar."""
    angaben = _aes_angaben(info)
    if angaben is None:
        raise ArchivFehler(f"{info.filename} ist verschluesselt, aber ohne AES-Angaben.")
    staerke, methode = angaben
    salzlaenge = SALZLAENGEN.get(staerke)
    if salzlaenge is None:
        raise ArchivFehler(f"{info.filename}: unbekannte Verschluesselungsstaerke {staerke}.")

    salz = roh[:salzlaenge]
    pruefwert = roh[salzlaenge : salzlaenge + PRUEFLAENGE]
    nutzdaten = roh[salzlaenge + PRUEFLAENGE : -SIGNATURLAENGE]
    signatur = roh[-SIGNATURLAENGE:]

    aes_schluessel, hmac_schluessel, erwartet = _schluessel(passwort, salz, salzlaenge * 2)
    if pruefwert != erwartet:
        raise PasswortFalsch("Das Projektpasswort passt nicht.")

    gerechnet = hmac.new(hmac_schluessel, nutzdaten, hashlib.sha1).digest()[:SIGNATURLAENGE]
    if not hmac.compare_digest(gerechnet, signatur):
        raise ArchivFehler(f"{info.filename}: Pruefsumme stimmt nicht, Archiv beschaedigt.")

    inhalt = _aes_ctr(aes_schluessel, nutzdaten)
    if methode == 8:
        return zlib.decompress(inhalt, -15)
    return inhalt


def _liest_aus(archiv: ZipFile, passwort: str | None) -> Callable[[str], bytes]:
    def lies(name: str) -> bytes:
        info = archiv.getinfo(name)
        if info.compress_type != AES_METHODE and not info.flag_bits & 0x1:
            return archiv.read(name)
        if not passwort:
            raise PasswortNoetig(
                "Das Projekt ist mit einem Projektpasswort geschuetzt. "
                "Bitte das Passwort angeben oder das Projekt in der ETS ohne "
                "Passwort exportieren."
            )
        return entschluessele(info, _rohdaten(archiv, info), passwort)

    return lies


def _rohdaten(archiv: ZipFile, info: ZipInfo) -> bytes:
    """Liest einen Eintrag ohne Dekompression; zipfile kann Methode 99 nicht."""
    quelle = archiv.fp
    if quelle is None:
        raise ArchivFehler("Archiv ist nicht mehr geoeffnet.")
    quelle.seek(info.header_offset)
    kopf = quelle.read(30)
    namenslaenge, extralaenge = struct.unpack_from("<HH", kopf, 26)
    quelle.seek(info.header_offset + 30 + namenslaenge + extralaenge)
    return quelle.read(info.compress_size)


def oeffne_projekt(archiv: ZipFile, passwort: str | None = None) -> Projektdateien:
    """Liefert die Projektdateien, egal ob als Ordner oder als inneres Archiv."""
    namen = archiv.namelist()
    direkt = [n for n in namen if PROJEKT_XML.search(n)]
    if direkt:
        return Projektdateien(tuple(namen), _liest_aus(archiv, passwort), verschachtelt=False)

    innere = sorted(n for n in namen if INNERES_ARCHIV.fullmatch(n))
    if not innere:
        raise ArchivFehler(
            "Unerwartete Archivstruktur: weder <Projekt-Id>/project.xml noch "
            "<Projekt-Id>.zip gefunden. Vorhanden sind: "
            + ", ".join(sorted(namen)[:12])
        )

    try:
        inhalt = archiv.read(innere[0])
    except Exception as fehler:
        raise ArchivFehler(
            f"{innere[0]} laesst sich nicht auspacken: {fehler}. "
            "Das Archiv ist vermutlich beschaedigt; bitte in der ETS neu exportieren."
        ) from fehler

    innen = ZipFile(io.BytesIO(inhalt))
    return Projektdateien(tuple(innen.namelist()), _liest_aus(innen, passwort), verschachtelt=True)


def ist_geschuetzt(archiv: ZipFile) -> bool:
    """Sagt vorab, ob ein Passwort gebraucht wird, ohne etwas zu entschluesseln."""
    try:
        dateien = oeffne_projekt(archiv)
    except ArchivFehler:
        return False
    try:
        for name in dateien.projekt_xmls()[:1]:
            dateien.lies(name)
    except PasswortNoetig:
        return True
    except ArchivFehler:
        return False
    return False
