from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

Steuerung = Literal["auswahl", "schalter", "text", "zahl", "liste"]

TD_DATENTYPEN = ("boolean", "integer", "number", "string", "object", "array", "null")

OPERATIONEN = {
    "property": ("readproperty", "writeproperty", "observeproperty", "unobserveproperty"),
    "action": ("invokeaction", "queryaction", "cancelaction"),
    "event": ("subscribeevent", "unsubscribeevent"),
}

SICHERHEITSSCHEMATA = ("nosec", "basic", "digest", "bearer", "psk", "oauth2", "apikey", "auto")


@dataclass(frozen=True)
class Option:
    wert: str
    titel: str
    hilfe: str = ""


@dataclass(frozen=True)
class Parameter:
    id: str
    titel: str
    steuerung: Steuerung
    seite: str
    td_pfad: str
    hilfe: str
    optionen: tuple[Option, ...] = ()
    standard: Any = None
    sichtbar_wenn: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    einheit: str = ""
    minimum: float | None = None
    maximum: float | None = None


SEITE_ALLGEMEIN = "Allgemein"
SEITE_INTERAKTION = "Interaktion"
SEITE_DATEN = "Datenschema"
SEITE_ANBINDUNG = "Anbindung"

NUR_PROPERTY: Mapping[str, tuple[str, ...]] = {"rolle": ("property",)}
NUR_ACTION: Mapping[str, tuple[str, ...]] = {"rolle": ("action",)}
NUR_EVENT: Mapping[str, tuple[str, ...]] = {"rolle": ("event",)}
NUR_ZAHL: Mapping[str, tuple[str, ...]] = {"datentyp": ("integer", "number")}
NUR_TEXT: Mapping[str, tuple[str, ...]] = {"datentyp": ("string",)}


PARAMETER: tuple[Parameter, ...] = (
    Parameter(
        id="titel",
        titel="Bezeichnung",
        steuerung="text",
        seite=SEITE_ALLGEMEIN,
        td_pfad="title",
        hilfe=(
            "Sprechender Name der Interaktion. Erscheint in jedem Client, der die "
            "Thing Description liest. Vorbelegt mit dem Namen der Gruppenadresse."
        ),
    ),
    Parameter(
        id="beschreibung",
        titel="Beschreibung",
        steuerung="text",
        seite=SEITE_ALLGEMEIN,
        td_pfad="description",
        hilfe=(
            "Freitext fuer Menschen. Vorbelegt aus dem Beschreibungsfeld der "
            "Gruppenadresse, falls im Projekt gepflegt."
        ),
    ),
    Parameter(
        id="semantischer_typ",
        titel="Semantischer Typ",
        steuerung="auswahl",
        seite=SEITE_ALLGEMEIN,
        td_pfad="@type",
        hilfe=(
            "Ordnet die Interaktion einem Begriff aus einem Vokabular zu, damit "
            "fremde Systeme sie ohne Namensraten verstehen. Ohne Angabe bleibt die "
            "Interaktion untypisiert und nur fuer Menschen lesbar."
        ),
        optionen=(
            Option("", "ohne", "Keine semantische Annotation."),
            Option("saref:OnOffState", "Schaltzustand", "SAREF: Ein- und Ausschaltzustand."),
            Option("saref:Light", "Beleuchtung", "SAREF: Leuchte oder Lichtgruppe."),
            Option("saref:Temperature", "Temperatur", "SAREF: Temperaturgroesse."),
            Option("saref:Humidity", "Feuchte", "SAREF: relative Luftfeuchte."),
            Option("saref:Motion", "Bewegung", "SAREF: Bewegungs- oder Praesenzmeldung."),
            Option("saref:Energy", "Energie", "SAREF: Energie oder Verbrauch."),
            Option("saref:OpenClose", "Offen und geschlossen", "SAREF: Fenster- oder Tuerkontakt."),
        ),
        standard="",
    ),
    Parameter(
        id="rolle",
        titel="Art der Interaktion",
        steuerung="auswahl",
        seite=SEITE_INTERAKTION,
        td_pfad="",
        hilfe=(
            "Bestimmt, in welchen Abschnitt der Thing Description die Gruppenadresse "
            "einsortiert wird, und damit alle weiteren Parameter dieser Seite. "
            "Property ist ein Zustand, den man liest, schreibt oder beobachtet. "
            "Action ist ein Vorgang, den man ausloest. Event ist eine Meldung, die "
            "das Geraet von sich aus schickt."
        ),
        optionen=(
            Option("property", "Property (Zustand)", "Lesbarer und beobachtbarer Wert."),
            Option("action", "Action (Vorgang)", "Ausgeloester Befehl ohne eigenen Zustand."),
            Option("event", "Event (Meldung)", "Spontane Meldung, meist Alarm oder Stoerung."),
        ),
        standard="property",
    ),
    Parameter(
        id="readonly",
        titel="Nur lesbar",
        steuerung="schalter",
        seite=SEITE_INTERAKTION,
        td_pfad="readOnly",
        hilfe=(
            "Setzt readOnly. Passend fuer Rueckmeldungen und Messwerte, die der Bus "
            "sendet, aber niemand beschreiben darf. Schliesst 'Nur schreibbar' aus."
        ),
        standard=True,
        sichtbar_wenn=NUR_PROPERTY,
    ),
    Parameter(
        id="writeonly",
        titel="Nur schreibbar",
        steuerung="schalter",
        seite=SEITE_INTERAKTION,
        td_pfad="writeOnly",
        hilfe=(
            "Setzt writeOnly. Passend fuer reine Stellbefehle ohne Rueckleseweg. "
            "Schliesst 'Nur lesbar' aus."
        ),
        standard=False,
        sichtbar_wenn=NUR_PROPERTY,
    ),
    Parameter(
        id="observable",
        titel="Beobachtbar",
        steuerung="schalter",
        seite=SEITE_INTERAKTION,
        td_pfad="observable",
        hilfe=(
            "Setzt observable. Der Client kann sich auf Wertaenderungen anmelden, "
            "statt zyklisch zu pollen. Auf dem KNX-Bus ist das der Normalfall, weil "
            "Telegramme ohnehin gesendet werden."
        ),
        standard=True,
        sichtbar_wenn=NUR_PROPERTY,
    ),
    Parameter(
        id="safe",
        titel="Nebenwirkungsfrei",
        steuerung="schalter",
        seite=SEITE_INTERAKTION,
        td_pfad="safe",
        hilfe=(
            "Setzt safe. Nur waehlen, wenn der Aufruf den Anlagenzustand nicht "
            "veraendert. Bei einem Schaltbefehl also nein."
        ),
        standard=False,
        sichtbar_wenn=NUR_ACTION,
    ),
    Parameter(
        id="idempotent",
        titel="Wiederholbar ohne Zusatzwirkung",
        steuerung="schalter",
        seite=SEITE_INTERAKTION,
        td_pfad="idempotent",
        hilfe=(
            "Setzt idempotent. Mehrfaches Senden desselben Werts hat dieselbe "
            "Wirkung wie einmaliges. Gilt fuer absolute Befehle (Ein, 50 Prozent), "
            "nicht fuer relative (heller, Schritt auf)."
        ),
        standard=True,
        sichtbar_wenn=NUR_ACTION,
    ),
    Parameter(
        id="synchronous",
        titel="Antwortet erst nach Ausfuehrung",
        steuerung="schalter",
        seite=SEITE_INTERAKTION,
        td_pfad="synchronous",
        hilfe=(
            "Setzt synchronous. Auf KNX ueblicherweise nein, weil ein Telegramm "
            "unbestaetigt abgesetzt wird und die Rueckmeldung getrennt kommt."
        ),
        standard=False,
        sichtbar_wenn=NUR_ACTION,
    ),
    Parameter(
        id="datentyp",
        titel="Datentyp",
        steuerung="auswahl",
        seite=SEITE_DATEN,
        td_pfad="type",
        hilfe=(
            "JSON-Datentyp des Werts. Wird aus dem KNX-Datenpunkttyp vorbelegt: "
            "1 Bit ergibt boolean, Prozent und Temperatur ergeben number, "
            "Aufzaehlungen ergeben integer."
        ),
        optionen=(
            Option("boolean", "boolean", "Wahrheitswert, typisch DPT 1.x."),
            Option("integer", "integer", "Ganzzahl, typisch DPT 5.x roh oder 20.x."),
            Option("number", "number", "Gleitkommazahl, typisch DPT 9.x oder skaliertes 5.x."),
            Option("string", "string", "Zeichenkette, typisch DPT 16.x."),
            Option("object", "object", "Zusammengesetzter Wert, etwa DPT 3.007."),
            Option("array", "array", "Liste von Werten."),
            Option("null", "null", "Kein Wert."),
        ),
        standard="boolean",
    ),
    Parameter(
        id="einheit",
        titel="Einheit",
        steuerung="text",
        seite=SEITE_DATEN,
        td_pfad="unit",
        hilfe=(
            "Physikalische Einheit als Text, etwa Grad Celsius oder Prozent. Stammt "
            "aus der knx_master.xml des Projekts und ist deshalb belegt, nicht geraten."
        ),
        sichtbar_wenn=NUR_ZAHL,
    ),
    Parameter(
        id="minimum",
        titel="Kleinster Wert",
        steuerung="zahl",
        seite=SEITE_DATEN,
        td_pfad="minimum",
        hilfe=(
            "Untere Grenze des Wertebereichs. Aus dem Datenpunkttyp uebernommen, "
            "etwa 0 bei Prozent oder minus 273 bei Temperatur."
        ),
        sichtbar_wenn=NUR_ZAHL,
    ),
    Parameter(
        id="maximum",
        titel="Groesster Wert",
        steuerung="zahl",
        seite=SEITE_DATEN,
        td_pfad="maximum",
        hilfe="Obere Grenze des Wertebereichs, ebenfalls aus dem Datenpunkttyp.",
        sichtbar_wenn=NUR_ZAHL,
    ),
    Parameter(
        id="multipleof",
        titel="Schrittweite",
        steuerung="zahl",
        seite=SEITE_DATEN,
        td_pfad="multipleOf",
        hilfe=(
            "Erlaubt nur Vielfache dieses Werts. Sinnvoll, wenn die Anlage in festen "
            "Stufen arbeitet, etwa 5 Prozent."
        ),
        sichtbar_wenn=NUR_ZAHL,
    ),
    Parameter(
        id="maxlength",
        titel="Maximale Laenge",
        steuerung="zahl",
        seite=SEITE_DATEN,
        td_pfad="maxLength",
        hilfe="Zeichenzahl begrenzen. Bei DPT 16.x sind es 14 Zeichen.",
        sichtbar_wenn=NUR_TEXT,
    ),
    Parameter(
        id="href",
        titel="Adresse",
        steuerung="text",
        seite=SEITE_ANBINDUNG,
        td_pfad="forms[0].href",
        hilfe=(
            "Ziel des Zugriffs. Der Prototyp setzt die Gruppenadresse im Schema "
            "knx ein. Ein echtes Gateway traegt hier seine HTTP- oder CoAP-Adresse ein."
        ),
    ),
    Parameter(
        id="contenttype",
        titel="Inhaltstyp",
        steuerung="auswahl",
        seite=SEITE_ANBINDUNG,
        td_pfad="forms[0].contentType",
        hilfe="Format der uebertragenen Nutzdaten.",
        optionen=(
            Option("application/json", "application/json", "Standardfall der TD."),
            Option("text/plain", "text/plain", "Roher Wert ohne Rahmen."),
            Option("application/octet-stream", "application/octet-stream", "Rohes Telegramm."),
        ),
        standard="application/json",
    ),
    Parameter(
        id="operationen",
        titel="Operationen",
        steuerung="liste",
        seite=SEITE_ANBINDUNG,
        td_pfad="forms[0].op",
        hilfe=(
            "Welche Zugriffe das Formular erlaubt. Die Auswahl haengt an der Art der "
            "Interaktion und ist deshalb nicht frei kombinierbar."
        ),
    ),
)


def parameter_je_seite() -> dict[str, tuple[Parameter, ...]]:
    seiten: dict[str, list[Parameter]] = {}
    for parameter in PARAMETER:
        seiten.setdefault(parameter.seite, []).append(parameter)
    return {seite: tuple(werte) for seite, werte in seiten.items()}
