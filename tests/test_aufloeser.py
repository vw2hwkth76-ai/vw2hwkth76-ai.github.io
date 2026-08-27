from __future__ import annotations

from ets2td.pfad_b.aufloeser import KeinResolver, NamensAnfrage, standard_rueckfrage


def _anfrage(fehlend: tuple[str, ...]) -> NamensAnfrage:
    return NamensAnfrage(
        ga_text="1/2/3",
        name="Neue Mittelgruppe",
        beschreibung="",
        hauptgruppe="Licht",
        mittelgruppe="Neue Mittelgruppe",
        raum_kandidaten=("Wohnzimmer", "Küche", "Bad", "Flur"),
        fehlende_dimensionen=fehlend,
    )


def test_rueckfrage_nennt_ga_und_fehlende_dimensionen() -> None:
    frage = standard_rueckfrage(_anfrage(("raum", "dpt")))
    assert "1/2/3" in frage.frage
    assert "Neue Mittelgruppe" in frage.frage
    assert "raum" in frage.frage and "dpt" in frage.frage
    assert frage.fehlende_dimensionen == ("raum", "dpt")


def test_rueckfrage_mit_raumvorschlaegen() -> None:
    frage = standard_rueckfrage(_anfrage(("raum",)))
    assert frage.vorschlaege == ("Wohnzimmer", "Küche", "Bad")


def test_rueckfrage_ohne_raum_keine_vorschlaege() -> None:
    frage = standard_rueckfrage(_anfrage(("dpt",)))
    assert frage.vorschlaege == ()


def test_kein_resolver_fragt_immer_zurueck() -> None:
    antwort = KeinResolver().aufloesen(_anfrage(("rolle",)))
    assert antwort.zuordnungen == {}
    assert antwort.rueckfrage is not None
