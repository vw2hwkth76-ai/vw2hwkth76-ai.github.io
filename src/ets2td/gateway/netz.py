"""Waehlt die CoAP-Transportschicht passend zum Betriebssystem.

aiocoap nimmt unter Linux ungeprueft den udp6-Transport. Wo IPv6 abgeschaltet
ist, und das ist in Firmennetzen keine Seltenheit, scheitert schon das
Anlegen des Sockets. Diese Pruefung stellt in dem Fall auf die
IPv4-Transporte um, bevor aiocoap seine Voreinstellung liest.
"""

from __future__ import annotations

import os
import socket

SERVER_VARIABLE = "AIOCOAP_SERVER_TRANSPORT"
CLIENT_VARIABLE = "AIOCOAP_CLIENT_TRANSPORT"
NUR_IPV4_SERVER = "tcpserver:tcpclient:simple6:simplesocketserver"
NUR_IPV4_CLIENT = "tcpclient:simple6"


def ipv6_nutzbar() -> bool:
    if not socket.has_ipv6:
        return False
    try:
        socket.socket(socket.AF_INET6, socket.SOCK_DGRAM).close()
    except OSError:
        return False
    return True


def waehle_transporte() -> bool:
    """Stellt auf IPv4 um, falls noetig. Gibt zurueck, ob IPv6 nutzbar ist."""
    if ipv6_nutzbar():
        return True
    os.environ.setdefault(SERVER_VARIABLE, NUR_IPV4_SERVER)
    os.environ.setdefault(CLIENT_VARIABLE, NUR_IPV4_CLIENT)
    return False


def eigene_adresse() -> str:
    """Ermittelt die IP der Netzkarte, ueber die das Standardziel liegt.

    Es wird kein Paket gesendet: ein UDP-Socket ohne Verkehr genuegt, damit
    das Betriebssystem die Route auswaehlt und die Quelladresse setzt.
    """
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 9))
        return str(probe.getsockname()[0])
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


def standard_bindung(ipv6: bool) -> str:
    """aiocoap kann ohne IPv6 nicht auf allen Adressen lauschen.

    Der simplesocketserver lehnt 0.0.0.0 ab, deshalb wird dort die Adresse
    der aktiven Netzkarte gewaehlt statt eines Platzhalters.
    """
    return "::" if ipv6 else eigene_adresse()
