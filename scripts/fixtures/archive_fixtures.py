"""Erzeugt die Archiv-Fixtures mit unabhaengigen Werkzeugen.

Die Entschluesselung im TypeScript-Code wird gegen pyzipper (WinZip-AES) und
Info-ZIP (ZipCrypto, ZIP64) geprueft. Ein Rundlauf durch den eigenen Code
waere zirkulaer.

Aufruf (pyzipper in einer eigenen Umgebung):
    python3 -m venv .venv && .venv/bin/pip install pyzipper==0.4.0
    .venv/bin/python scripts/fixtures/archive_fixtures.py fixtures/archiv
"""

from __future__ import annotations

import base64
import hashlib
import io
import os
import random
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import pyzipper

TEXT = ("Wohnzimmer Licht Decke schalten 1/1/1\n" * 400).encode("utf-8")
rng = random.Random(4711)
BINARY = bytes(rng.getrandbits(8) for _ in range(70_000))
ETS5_PASSWORD = "Projekt-pw1"
ETS6_PASSWORD = "Grüße-2026"


def master(schema: int) -> bytes:
    return (
        '﻿<?xml version="1.0" encoding="utf-8"?>\n'
        f'<KNX xmlns="http://knx.org/xml/project/{schema}" CreatedBy="ETS" ToolVersion="0">'
        "<MasterData /></KNX>"
    ).encode("utf-8")


def project_files(project_id: str, schema: int) -> dict[str, bytes]:
    ns = f"http://knx.org/xml/project/{schema}"
    project = (
        f'<?xml version="1.0" encoding="utf-8"?><KNX xmlns="{ns}"><Project Id="{project_id}">'
        f'<ProjectInformation Name="Fixture {project_id}" GroupAddressStyle="ThreeLevel" '
        'Guid="00000000-0000-4000-8000-00000000abcd" /></Project></KNX>'
    )
    installation = (
        f'<?xml version="1.0" encoding="utf-8"?><KNX xmlns="{ns}"><Project Id="{project_id}">'
        '<Installations><Installation Name=""><GroupAddresses><GroupRanges>'
        f'<GroupRange Id="{project_id}-0_GR-1" RangeStart="2048" RangeEnd="4095" Name="Licht">'
        f'<GroupAddress Id="{project_id}-0_GA-1" Address="2049" Name="Decke schalten" '
        'DatapointType="DPST-1-1" />'
        "</GroupRange></GroupRanges></GroupAddresses></Installation></Installations>"
        "</Project></KNX>"
    )
    return {"project.xml": project.encode("utf-8"), "0.xml": installation.encode("utf-8")}


def aes_zip(path: Path, files: dict[str, bytes], password: bytes, nbits: int) -> None:
    with pyzipper.AESZipFile(path, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as z:
        z.setpassword(password)
        z.setencryption(pyzipper.WZ_AES, nbits=nbits)
        for name, data in files.items():
            z.writestr(name, data)


def protected_knxproj(path: Path, project_id: str, schema: int, zip_password: bytes) -> None:
    inner = io.BytesIO()
    with pyzipper.AESZipFile(inner, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as z:
        z.setpassword(zip_password)
        z.setencryption(pyzipper.WZ_AES, nbits=256)
        for name, data in project_files(project_id, schema).items():
            z.writestr(name, data)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("knx_master.xml", master(schema))
        z.writestr(f"{project_id}.zip", inner.getvalue())
        z.writestr(f"{project_id}.signature", b"keine echte Signatur")


def ets6_zip_password(password: str) -> bytes:
    raw = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-16-le"), b"21.project.ets.knx.org", 65536, 32
    )
    return base64.b64encode(raw)


def main(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    files = {"text.txt": TEXT, "daten.bin": BINARY}

    with zipfile.ZipFile(target / "offen.zip", "w") as z:
        z.writestr("text.txt", TEXT, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("daten.bin", BINARY, compress_type=zipfile.ZIP_STORED)
        z.writestr("ordner/", b"")
        z.writestr("leer.txt", b"", compress_type=zipfile.ZIP_DEFLATED)

    aes_zip(target / "aes256.zip", files, b"Geheim-123", 256)
    aes_zip(target / "aes128.zip", files, b"Geheim-123", 128)

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, data in files.items():
            (work / name).write_bytes(data)
        subprocess.run(["zip", "-q", "-P", "Geheim-123", str(target.resolve() / "zipcrypto.zip"), "text.txt", "daten.bin"], cwd=work, check=True)
        # Ueber stdin geschrieben: Eintrag mit Datendeskriptor, Pruefbyte aus der Aenderungszeit.
        with open(work / "text.txt", "rb") as source:
            subprocess.run(["zip", "-q", "-P", "Geheim-123", str(target.resolve() / "zipcrypto-strom.zip"), "-"], cwd=work, stdin=source, check=True)
        subprocess.run(["zip", "-q", "-fz", str(target.resolve() / "zip64.zip"), "text.txt"], cwd=work, check=True)

    with zipfile.ZipFile(target / "bombe.zip", "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("nullen.bin", bytes(20 * 1024 * 1024))

    data = (target / "offen.zip").read_bytes()
    (target / "abgeschnitten.zip").write_bytes(data[: len(data) // 2] + data[-22:])

    protected_knxproj(target / "ets5-geschuetzt.knxproj", "P-0A01", 20, ETS5_PASSWORD.encode("utf-8"))
    protected_knxproj(target / "ets6-geschuetzt.knxproj", "P-0A02", 23, ets6_zip_password(ETS6_PASSWORD))
    print("abgeleitetes ETS6-Passwort:", ets6_zip_password(ETS6_PASSWORD).decode())


if __name__ == "__main__":
    main(Path(sys.argv[1]))
