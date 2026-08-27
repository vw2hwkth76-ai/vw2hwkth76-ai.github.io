from __future__ import annotations

from ets2td.knxproj.leser import KnxProjekt, formatiere_ga
from ets2td.modell import (
    DIMENSIONEN,
    Datenpunkt,
    PfadErgebnis,
    Quelle,
    WotRolle,
    Zuordnung,
)
from ets2td.pfad_b import lexikon
from ets2td.pfad_b.aufloeser import NamensAnfrage, NameResolver, standard_rueckfrage


def leite_ab(
    projekt: KnxProjekt,
    resolver: NameResolver | None = None,
    heuristik_pur: bool = False,
) -> PfadErgebnis:
    ergebnis = PfadErgebnis(
        pfad="b-pur" if heuristik_pur else "b",
        projekt=projekt.name,
        hinweise=list(projekt.hinweise),
    )

    punkte: dict[str, Datenpunkt] = {}
    for ga in projekt.gruppenadressen.values():
        punkt = Datenpunkt(
            ga=ga.adresse,
            ga_text=formatiere_ga(ga.adresse, projekt.ga_stil),
            name=ga.name,
            beschreibung=ga.beschreibung,
            hauptgruppe=ga.hauptgruppe,
            mittelgruppe=ga.mittelgruppe,
            zentral=ga.zentral,
        )
        if ga.dpt_id:
            punkt.dpt = Zuordnung(ga.dpt_id, Quelle.ETS_ATTRIBUT, 1.0)
        punkte[ga.id] = punkt

    if not heuristik_pur:
        _wende_funktionen_an(projekt, punkte, ergebnis)

    kandidaten = _raum_kandidaten(projekt)
    for punkt in punkte.values():
        _namensheuristik(punkt, kandidaten)

    _resolver_runde(punkte, kandidaten, resolver, ergebnis)

    for punkt in punkte.values():
        _setze_zugriff(punkt)

    ergebnis.datenpunkte = sorted(punkte.values(), key=lambda punkt: punkt.ga)
    return ergebnis


def _setze_zugriff(punkt: Datenpunkt) -> None:
    """Leitet Lese- und Schreibrecht aus der erkannten Rolle ab.

    Auf KNX sind Kommando- und Statusadressen getrennt: ein Schaltbefehl wird
    geschrieben, eine Rueckmeldung gelesen. Ohne erkannte Rolle bleibt beides
    offen, damit die Thing Description nichts behauptet.
    """
    if punkt.rolle is None:
        return
    if punkt.rolle.wert == WotRolle.ACTION.value:
        punkt.schreibbar = True
        punkt.lesbar = False
    elif punkt.rolle.wert == WotRolle.PROPERTY.value or punkt.rolle.wert == WotRolle.EVENT.value:
        punkt.lesbar = True
        punkt.schreibbar = False


def _wende_funktionen_an(
    projekt: KnxProjekt, punkte: dict[str, Datenpunkt], ergebnis: PfadErgebnis
) -> None:
    for funktion in projekt.funktionen:
        for verknuepfung in funktion.verknuepfungen:
            punkt = punkte.get(verknuepfung.ga_id)
            if punkt is None:
                ergebnis.hinweise.append(
                    f"Funktion '{funktion.name}': GA-Referenz {verknuepfung.ga_id} unbekannt."
                )
                continue
            if punkt.funktion is not None:
                ergebnis.hinweise.append(
                    f"GA {punkt.ga_text} '{punkt.name}' ist mehreren Funktionen zugeordnet, "
                    f"'{punkt.funktion.wert}' gewinnt."
                )
                continue
            punkt.funktion = Zuordnung(funktion.name, Quelle.ETS_FUNKTION, 1.0)
            punkt.raum = Zuordnung(funktion.raum.name, Quelle.GEBAEUDESTRUKTUR, 1.0)
            punkt.knx_rolle = verknuepfung.rolle
            wot = lexikon.KNX_ROLLEN.get(verknuepfung.rolle)
            if wot is not None:
                punkt.rolle = Zuordnung(wot.value, Quelle.ETS_FUNKTION, 0.95)
            elif lexikon.GUID_MUSTER.fullmatch(verknuepfung.rolle):
                ergebnis.hinweise.append(
                    f"GA {punkt.ga_text} '{punkt.name}': benutzerdefinierte Rolle (GUID) "
                    "ohne exportierte Definition, Rolle bleibt Namensheuristik ueberlassen."
                )
            elif verknuepfung.rolle:
                ergebnis.hinweise.append(
                    f"GA {punkt.ga_text}: KNX-Rolle '{verknuepfung.rolle}' nicht im Katalog."
                )


def _raum_kandidaten(projekt: KnxProjekt) -> tuple[str, ...]:
    gesehen: dict[str, None] = {}
    for raum in projekt.raeume:
        if raum.typ not in ("Building", "BuildingPart", "Floor") and raum.name:
            gesehen.setdefault(raum.name, None)
    return tuple(gesehen)


def _namensheuristik(punkt: Datenpunkt, kandidaten: tuple[str, ...]) -> None:
    text = f"{punkt.name} {punkt.beschreibung}".strip()
    woerter = lexikon.tokens(text)

    raumtreffer: str | None = None
    if punkt.raum is None:
        raumtreffer = lexikon.erkenne_raum(text, kandidaten)
        if raumtreffer is not None:
            punkt.raum = Zuordnung(raumtreffer, Quelle.NAMENSLEXIKON, 0.75)
        else:
            raumtreffer = lexikon.erkenne_raum_lexikon(text)
            if raumtreffer is not None:
                strukturraum = lexikon.strukturraum_zu(raumtreffer, kandidaten)
                if strukturraum is not None:
                    raumtreffer = strukturraum
                    punkt.raum = Zuordnung(raumtreffer, Quelle.NAMENSLEXIKON, 0.75)
                elif lexikon.unbekanntes_folgewort(text, raumtreffer):
                    raumtreffer = None
                else:
                    punkt.raum = Zuordnung(raumtreffer, Quelle.NAMENSLEXIKON, 0.6)
        if punkt.raum is None:
            raumtreffer = _raum_aus_hierarchie(punkt, kandidaten)
            if raumtreffer is not None:
                punkt.raum = Zuordnung(raumtreffer, Quelle.GA_HIERARCHIE, 0.65)
    elif punkt.raum is not None:
        raumtreffer = punkt.raum.wert

    if punkt.rolle is None:
        rolle = lexikon.erkenne_rolle(woerter)
        if rolle is not None:
            punkt.rolle = Zuordnung(rolle.value, Quelle.NAMENSLEXIKON, 0.7)
        elif punkt.mittelgruppe:
            rolle = lexikon.erkenne_rolle(lexikon.tokens(punkt.mittelgruppe))
            if rolle is not None:
                punkt.rolle = Zuordnung(rolle.value, Quelle.GA_HIERARCHIE, 0.5)

    if punkt.funktion is None:
        funktionsname = _funktionsname(punkt, raumtreffer)
        if funktionsname:
            punkt.funktion = Zuordnung(funktionsname, Quelle.NAMENSLEXIKON, 0.5)

    if punkt.dpt is None:
        dpt = lexikon.erkenne_dpt(woerter)
        if dpt is not None:
            punkt.dpt = Zuordnung(dpt, Quelle.NAMENSLEXIKON, 0.4)
        elif punkt.mittelgruppe:
            dpt = lexikon.erkenne_dpt(lexikon.tokens(punkt.mittelgruppe))
            if dpt is not None:
                punkt.dpt = Zuordnung(dpt, Quelle.GA_HIERARCHIE, 0.35)


def _raum_aus_hierarchie(punkt: Datenpunkt, kandidaten: tuple[str, ...]) -> str | None:
    for gruppentext in (punkt.mittelgruppe, punkt.hauptgruppe):
        if not gruppentext or lexikon.ist_ausser_betrieb(gruppentext):
            continue
        if len(lexikon.tokens(gruppentext)) > 1 and lexikon.erkenne_raum_lexikon(
            gruppentext
        ):
            # Sammelgruppen wie "Bad/ WC" benennen mehrere Raeume; ohne
            # Hinweis im Adressnamen ist keiner davon belegt.
            mehrfach = [
                p
                for p in lexikon.RAUM_PHRASEN
                if lexikon.enthaelt_phrase(gruppentext, p)
            ]
            if len({lexikon.strukturraum_zu(p, kandidaten) or p for p in mehrfach}) > 1:
                continue
        treffer = lexikon.erkenne_raum(gruppentext, kandidaten)
        if treffer is not None:
            return treffer
        treffer = lexikon.erkenne_raum_lexikon(gruppentext)
        if treffer is None:
            continue
        strukturraum = lexikon.strukturraum_zu(treffer, kandidaten)
        if strukturraum is not None:
            return strukturraum
        if not lexikon.unbekanntes_folgewort(gruppentext, treffer):
            return treffer
    return None


def _funktionsname(punkt: Datenpunkt, raumtreffer: str | None) -> str:
    quelle = punkt.beschreibung or punkt.name
    woerter = list(lexikon.tokens(quelle))
    if raumtreffer:
        raumwoerter = lexikon.tokens(raumtreffer)
        laenge = len(raumwoerter)
        entfernt = False
        for start in range(len(woerter) - laenge + 1):
            if tuple(woerter[start : start + laenge]) == raumwoerter:
                del woerter[start : start + laenge]
                entfernt = True
                break
        if not entfernt:
            woerter = [wort for wort in woerter if wort not in raumwoerter]
    stoppwoerter = (
        lexikon.STATUS_WOERTER
        | lexikon.AKTIONS_WOERTER
        | lexikon.EVENT_WOERTER
        | lexikon.MEHRDEUTIGE_WOERTER
        | {"zentral", "central"}
    )
    rest = [wort for wort in woerter if wort not in stoppwoerter]
    return " ".join(rest)


def _resolver_runde(
    punkte: dict[str, Datenpunkt],
    kandidaten: tuple[str, ...],
    resolver: NameResolver | None,
    ergebnis: PfadErgebnis,
) -> None:
    for punkt in sorted(punkte.values(), key=lambda p: p.ga):
        fehlend = tuple(
            dimension
            for dimension in DIMENSIONEN
            if punkt.zuordnung(dimension) is None and not (dimension == "raum" and punkt.zentral)
        )
        if not fehlend:
            continue
        anfrage = NamensAnfrage(
            ga_text=punkt.ga_text,
            name=punkt.name,
            beschreibung=punkt.beschreibung,
            hauptgruppe=punkt.hauptgruppe,
            mittelgruppe=punkt.mittelgruppe,
            raum_kandidaten=kandidaten,
            fehlende_dimensionen=fehlend,
        )
        if resolver is None:
            ergebnis.rueckfragen.append(standard_rueckfrage(anfrage))
            continue
        antwort = resolver.aufloesen(anfrage)
        for dimension, zuordnung in antwort.zuordnungen.items():
            if dimension in fehlend and punkt.zuordnung(dimension) is None:
                setattr(punkt, dimension, zuordnung)
        if antwort.rueckfrage is not None:
            ergebnis.rueckfragen.append(antwort.rueckfrage)
