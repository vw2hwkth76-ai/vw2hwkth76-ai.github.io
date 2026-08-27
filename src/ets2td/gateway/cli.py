"""Startet das CoAP-Gateway zu einer Thing Description.

Aufruf:
    ets2td-gateway ausgabe/td/b/projekt--wohnzimmer.td.json \\
        --bus tunneling --gateway-ip 192.168.1.50

    ets2td-gateway ... --bus simulator --selbsttest

Der Selbsttest startet den Server, ruft sich ueber die Rueckschleife selbst
auf und druckt, was jede Affordanz geantwortet hat. Er ersetzt keinen Test
der Testsuite, sondern zeigt bei der Vorfuehrung, dass die Kette steht.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from ets2td.gateway.bus import BusVerbindung
from ets2td.gateway.netz import eigene_adresse, standard_bindung, waehle_transporte
from ets2td.gateway.ressourcen import JSON_FORMAT, TD_PFAD, Abbildung, Ressource, bilde_ab

STANDARD_PORT = 5683


PLATZHALTER = ("::", "0.0.0.0", "")


def _lauschadresse(gewuenscht: str | None, ipv6: bool) -> str:
    """Loest den Platzhalter auf, wo aiocoap ohne IPv6 keinen zulaesst."""
    if not gewuenscht:
        return standard_bindung(ipv6)
    if gewuenscht in PLATZHALTER and not ipv6:
        return eigene_adresse()
    return gewuenscht


def _erreichbar(bind: str) -> str:
    """Ein Lauschplatzhalter taugt nicht als Adresse in den Forms."""
    return "127.0.0.1" if bind in PLATZHALTER else bind


def _probewert(ressource: Ressource) -> Any:
    """Waehlt einen Wert, den der Datenpunkttyp sicher annimmt."""
    from ets2td.gateway.startwerte import probewert

    return probewert(ressource)


def _bus_bauen(args: argparse.Namespace, abbildung: Abbildung) -> BusVerbindung:
    if args.bus == "simulator":
        from ets2td.gateway.simulator import SimulierterBus
        from ets2td.gateway.startwerte import startbelegung

        return SimulierterBus(startbelegung(abbildung))

    from ets2td.gateway.knxbus import Anbindung, KnxBus

    return KnxBus(
        anbindung=Anbindung(args.bus),
        gateway_ip=args.gateway_ip,
        gateway_port=args.gateway_port,
        lokale_ip=args.lokale_ip,
    )


async def _selbsttest(ursprung: str, abbildung: Abbildung, schreiben: bool) -> int:
    """Fragt jede Affordanz einmal ab.

    Geschrieben wird nur gegen den Simulator. Auf einer echten Anlage waere
    ein Selbsttest, der Aktoren schaltet, ein Sachschaden.
    """
    from aiocoap import Context, Message
    from aiocoap.numbers.codes import Code

    klient = await Context.create_client_context()
    fehler = 0
    try:
        antwort = await klient.request(Message(code=Code.GET, uri=f"{ursprung}/{TD_PFAD}")).response
        thing = json.loads(antwort.payload.decode("utf-8"))
        print(f"  {TD_PFAD:44} {antwort.code}  {thing.get('title', '')}")
        if not antwort.code.is_successful():
            fehler += 1

        for ressource in abbildung.ressourcen:
            pfad = "/".join(ressource.pfad)
            if ressource.lesbar:
                antwort = await klient.request(
                    Message(code=Code.GET, uri=f"{ursprung}/{pfad}")
                ).response
                inhalt = antwort.payload.decode("utf-8", "replace")
                print(f"  GET  {pfad:42} {antwort.code}  {inhalt[:56]}")
                if not antwort.code.is_successful():
                    fehler += 1
            if not (schreiben and ressource.schreibbar):
                if not ressource.lesbar:
                    print(f"  ---  {pfad:42} nur schreibbar, auf echtem Bus nicht ausgeloest")
                continue
            probe = _probewert(ressource)
            if probe is None:
                print(f"  ---  {pfad:42} ohne Datenpunkttyp nicht schreibbar")
                continue
            code = Code.POST if ressource.abschnitt == "actions" else Code.PUT
            antwort = await klient.request(
                Message(
                    code=code,
                    uri=f"{ursprung}/{pfad}",
                    payload=json.dumps({"wert": probe}).encode("utf-8"),
                    content_format=JSON_FORMAT,
                )
            ).response
            print(f"  {code.name:4} {pfad:42} {antwort.code}  gesendet: {probe!r}")
            if not antwort.code.is_successful():
                fehler += 1
    finally:
        await klient.shutdown()
    return fehler


async def _laufen(args: argparse.Namespace, ipv6: bool) -> int:
    td: dict[str, Any] = json.loads(Path(args.td).read_text(encoding="utf-8"))
    bind = _lauschadresse(args.bind, ipv6)
    ursprung = f"coap://{args.ursprung or _erreichbar(bind)}:{args.port}"
    abbildung = bilde_ab(td, ursprung)
    bus = _bus_bauen(args, abbildung)

    from ets2td.gateway.server import Gateway

    gateway = Gateway(abbildung, bus)
    kontext = await gateway.starten((bind, args.port))

    print(f"Thing:  {abbildung.thing.get('title', '(ohne Titel)')}")
    print(f"Bus:    {bus.beschreibung}")
    print(f"CoAP:   {ursprung}/{TD_PFAD}")
    if not ipv6:
        print("        IPv6 nicht verfuegbar, IPv4-Transporte gewaehlt")
    print(
        f"        {len(abbildung.ressourcen)} Affordanzen "
        f"auf {len(abbildung.nach_ga())} Adressen"
    )

    try:
        if args.selbsttest:
            print("\nSelbsttest:")
            fehler = await _selbsttest(
                f"coap://{_erreichbar(bind)}:{args.port}", abbildung, args.bus == "simulator"
            )
            print(f"\n{fehler} Fehler." if fehler else "\nAlle Abfragen beantwortet.")
            return 1 if fehler else 0
        print("\nLaeuft. Beenden mit Strg+C.")
        await asyncio.get_running_loop().create_future()
    except asyncio.CancelledError:
        pass
    finally:
        await kontext.shutdown()
        await bus.trennen()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ets2td-gateway", description=__doc__)
    parser.add_argument("td", type=Path, help="erzeugte Thing Description")
    parser.add_argument(
        "--bus",
        default="simulator",
        choices=("simulator", "tunneling", "tunneling-tcp", "routing", "automatik"),
        help="tunneling und tunneling-tcp sind unicast, routing ist multicast",
    )
    parser.add_argument("--gateway-ip", help="IP des KNXnet/IP-Interfaces")
    parser.add_argument("--gateway-port", type=int, default=3671)
    parser.add_argument("--lokale-ip", help="lokale IP, falls mehrere Netzkarten vorhanden sind")
    parser.add_argument("--bind", help="Adresse, auf der CoAP lauscht (Vorgabe :: oder 0.0.0.0)")
    parser.add_argument("--port", type=int, default=STANDARD_PORT)
    parser.add_argument("--ursprung", help="Hostname in den Forms, falls abweichend von --bind")
    parser.add_argument("--selbsttest", action="store_true", help="einmal alles abfragen und enden")
    args = parser.parse_args(argv)

    if args.bus != "simulator" and not args.gateway_ip and args.bus != "automatik":
        parser.error(f"--bus {args.bus} braucht --gateway-ip (oder --bus automatik)")
    ipv6 = waehle_transporte()
    return asyncio.run(_laufen(args, ipv6))


if __name__ == "__main__":
    sys.exit(main())
