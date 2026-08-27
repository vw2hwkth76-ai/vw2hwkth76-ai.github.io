from __future__ import annotations

from ets2td.modell import WotRolle
from ets2td.pfad_b import lexikon


def test_normalisierung_mit_umlauten() -> None:
    assert lexikon.normalisiere("Büro-Küche 2.OG") == "buero kueche 2 og"


def test_schalten_ist_action() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Licht Küche schalten")) is WotRolle.ACTION


def test_rueckmeldung_ist_property() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("RM Licht Küche")) is WotRolle.PROPERTY


def test_status_schlaegt_kommandoverb() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Status schalten")) is WotRolle.PROPERTY


def test_alarm_ist_event_auch_als_teilwort() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Windalarm Terrasse")) is WotRolle.EVENT


def test_messwert_ist_property() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Temperatur Wohnzimmer")) is WotRolle.PROPERTY


def test_unbekanntes_ergibt_keine_rolle() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("XyZ 42")) is None


def test_dpt_schalten() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Deckenlicht schalten")) == "DPST-1-1"


def test_dpt_dimmen_vor_wert() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Dimmen Wert")) == "DPST-3-7"


def test_dpt_temperatur() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Temperatur Istwert")) == "DPST-9-1"


def test_dpt_prozentwert() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Helligkeit Wert")) == "DPST-5-1"


def test_dpt_jalousie_fahren() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Jalousie auf ab")) == "DPST-1-8"


def test_dpt_alarm() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Regenalarm alarm")) == "DPST-1-5"


def test_dpt_sperren() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Sperren Handbedienung")) == "DPST-1-3"


def test_dpt_szene() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Szene Abruf")) == "DPST-17-1"


def test_dpt_fensterkontakt() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Fenster Kontakt")) == "DPST-1-19"


def test_dpt_praesenz() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Präsenz Flur")) == "DPST-1-18"


def test_dpt_betriebsart() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("Betriebsart Heizung")) == "DPST-20-102"


def test_dpt_unbekannt() -> None:
    assert lexikon.erkenne_dpt(lexikon.tokens("XyZ 42")) is None


def test_raum_aus_kandidaten_laengster_treffer() -> None:
    kandidaten = ("Bad", "Badezimmer")
    assert lexikon.erkenne_raum("Badezimmer Licht", kandidaten) == "Badezimmer"


def test_raum_aus_lexikon_deutsch() -> None:
    assert lexikon.erkenne_raum_lexikon("Licht Wohnzimmer schalten") == "wohnzimmer"


def test_raum_aus_lexikon_englisch() -> None:
    assert lexikon.erkenne_raum_lexikon("Living room lamp") == "living room"


def test_folgewort_personenname_erkannt() -> None:
    assert lexikon.unbekanntes_folgewort("Büro Kurt Licht schalten", "buero") == "kurt"


def test_folgewort_nummer_erkannt() -> None:
    assert lexikon.unbekanntes_folgewort("Büro 2 Licht", "buero") == "2"


def test_folgewort_funktionswort_unkritisch() -> None:
    assert lexikon.unbekanntes_folgewort("Wohnzimmer Licht schalten", "wohnzimmer") is None


def test_knx_rollenkatalog() -> None:
    assert lexikon.KNX_ROLLEN["SwitchOnOff"] is WotRolle.ACTION
    assert lexikon.KNX_ROLLEN["InfoOnOff"] is WotRolle.PROPERTY
    assert lexikon.KNX_ROLLEN["WindAlarm"] is WotRolle.EVENT
    assert lexikon.KNX_ROLLEN["TempRoom"] is WotRolle.PROPERTY


def test_guid_muster() -> None:
    assert lexikon.GUID_MUSTER.fullmatch("275fe355-566d-4987-bc4e-3f644974b62f")
    assert not lexikon.GUID_MUSTER.fullmatch("SwitchOnOff")


def test_strukturraum_bildet_stichwort_ab() -> None:
    kandidaten = ("Badezimmer", "Küche", "Wohnzimmer")
    assert lexikon.strukturraum_zu("bad", kandidaten) == "Badezimmer"


def test_strukturraum_bleibt_offen_bei_mehrdeutigkeit() -> None:
    assert lexikon.strukturraum_zu("bad", ("Badezimmer", "Badflur")) is None


def test_strukturraum_ohne_treffer() -> None:
    assert lexikon.strukturraum_zu("garage", ("Küche", "Bad")) is None


def test_raum_mit_mehrfachnamen_ueber_teilwort() -> None:
    assert lexikon.erkenne_raum("Licht M Flur", ("Büro/ Flur", "Küche")) == "Büro/ Flur"


def test_vollstaendige_phrase_schlaegt_teilwort() -> None:
    assert lexikon.erkenne_raum("Licht Flur Küche", ("Büro/ Flur", "Küche")) == "Küche"


def test_teilwort_bleibt_offen_bei_zwei_treffern() -> None:
    assert lexikon.erkenne_raum("Licht Flur Büro", ("Büro Nord", "Flur Süd")) is None


def test_kurze_teilwoerter_loesen_nicht_aus() -> None:
    assert lexikon.erkenne_raum("Licht WC Decke", ("Bad/ WC Bereich",)) is None


def test_position_ohne_marker_ergibt_keine_rolle() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Rolladen 1 Position")) is None


def test_position_mit_statusmarker_ist_property() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Rolladen 1 Position RM")) is WotRolle.PROPERTY


def test_wert_ohne_marker_ergibt_keine_rolle() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Dimming value")) is None


def test_rolladen_lang_ist_action() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Rolladen 1 lang")) is WotRolle.ACTION


def test_betriebsmodus_ist_action() -> None:
    assert lexikon.erkenne_rolle(lexikon.tokens("Betriebsm. Kompf.")) is WotRolle.ACTION


def test_ausser_betrieb_erkannt() -> None:
    assert lexikon.ist_ausser_betrieb("Rolladen lang--out of use")
    assert not lexikon.ist_ausser_betrieb("Rolladen lang")
