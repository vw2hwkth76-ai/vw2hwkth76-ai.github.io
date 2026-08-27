from __future__ import annotations

from typing import Any

import pytest

from ets2td.gateway.ressourcen import (
    CBOR_FORMAT,
    COV_IRI,
    JSON_FORMAT,
    AbbildungsFehler,
    bilde_ab,
    gruppenadresse_aus,
)

BASIS = "coap://192.168.1.10:5683"


def vorlage(**abschnitte: Any) -> dict[str, Any]:
    td: dict[str, Any] = {
        "@context": ["https://www.w3.org/2022/wot/td/v1.1", {"ets2td": "http://beispiel/#"}],
        "title": "Wohnzimmer",
        "securityDefinitions": {"nosec_sc": {"scheme": "nosec"}},
        "security": "nosec_sc",
    }
    td.update(abschnitte)
    return td


def eigenschaft(**felder: Any) -> dict[str, Any]:
    grund: dict[str, Any] = {
        "title": "Deckenlicht",
        "type": "boolean",
        "forms": [{"href": "knx://1/1/1", "op": ["readproperty", "writeproperty"]}],
        "ets2td:gruppenadresse": "1/1/1",
        "ets2td:dpt": "DPST-1-1",
    }
    grund.update(felder)
    return grund


@pytest.mark.parametrize(
    ("href", "erwartet"),
    [
        ("knx://1/1/1", "1/1/1"),
        ("knx://2/0/17", "2/0/17"),
        ("https://beispiel/x", None),
        ("", None),
    ],
)
def test_gruppenadresse_wird_nur_aus_knx_schema_gelesen(href: str, erwartet: str | None) -> None:
    assert gruppenadresse_aus(href) == erwartet


def test_forms_zeigen_nach_der_abbildung_auf_coap() -> None:
    ab = bilde_ab(vorlage(properties={"licht": eigenschaft()}), BASIS)
    form = ab.thing["properties"]["licht"]["forms"][0]
    assert form["href"] == f"{BASIS}/properties/licht"
    assert form["contentType"] == "application/json"
    assert form["cov:contentFormat"] == JSON_FORMAT
    assert form["cov:accept"] == JSON_FORMAT


def test_eindeutige_operation_bekommt_die_passende_methode() -> None:
    td = vorlage(
        properties={
            "lesen": eigenschaft(forms=[{"href": "knx://1/1/1", "op": ["readproperty"]}]),
            "schreiben": eigenschaft(forms=[{"href": "knx://1/1/2", "op": ["writeproperty"]}]),
        },
        actions={
            "ausloesen": eigenschaft(forms=[{"href": "knx://1/1/3", "op": ["invokeaction"]}])
        },
        events={"alarm": eigenschaft(forms=[{"href": "knx://1/1/4", "op": ["subscribeevent"]}])},
    )
    ab = bilde_ab(td, BASIS)
    assert ab.thing["properties"]["lesen"]["forms"][0]["cov:method"] == "GET"
    assert ab.thing["properties"]["schreiben"]["forms"][0]["cov:method"] == "PUT"
    assert ab.thing["actions"]["ausloesen"]["forms"][0]["cov:method"] == "POST"
    assert ab.thing["events"]["alarm"]["forms"][0]["cov:method"] == "GET"


def test_mehrdeutige_operation_bekommt_keine_methode() -> None:
    ab = bilde_ab(vorlage(properties={"licht": eigenschaft()}), BASIS)
    assert "cov:method" not in ab.thing["properties"]["licht"]["forms"][0]


def test_kontext_wird_um_den_cov_praefix_ergaenzt() -> None:
    ab = bilde_ab(vorlage(properties={"licht": eigenschaft()}), BASIS)
    innen = [teil for teil in ab.thing["@context"] if isinstance(teil, dict)]
    assert innen[0]["cov"] == COV_IRI
    assert innen[0]["ets2td"] == "http://beispiel/#", "vorhandene Praefixe bleiben erhalten"


def test_kontext_als_einzelwert_wird_zur_liste() -> None:
    td = vorlage(properties={"licht": eigenschaft()})
    td["@context"] = "https://www.w3.org/2022/wot/td/v1.1"
    ab = bilde_ab(td, BASIS)
    assert isinstance(ab.thing["@context"], list)
    assert {"cov": COV_IRI} in ab.thing["@context"]


def test_cov_praefix_wird_nicht_doppelt_gesetzt() -> None:
    td = vorlage(properties={"licht": eigenschaft()})
    td["@context"] = ["https://www.w3.org/2022/wot/td/v1.1", {"cov": COV_IRI}]
    ab = bilde_ab(td, BASIS)
    assert sum(1 for t in ab.thing["@context"] if isinstance(t, dict) and "cov" in t) == 1


def test_base_und_sicherheit_werden_gesetzt() -> None:
    ab = bilde_ab(vorlage(properties={"licht": eigenschaft()}), BASIS)
    assert ab.thing["base"] == f"{BASIS}/"
    assert ab.thing["security"] == "nosec_sc"


def test_ursprung_bleibt_unveraendert() -> None:
    td = vorlage(properties={"licht": eigenschaft()})
    bilde_ab(td, BASIS)
    assert td["properties"]["licht"]["forms"][0]["href"] == "knx://1/1/1"


def test_ressource_traegt_adresse_dpt_und_operationen() -> None:
    ab = bilde_ab(vorlage(properties={"licht": eigenschaft()}), BASIS)
    (ressource,) = ab.ressourcen
    assert ressource.pfad == ("properties", "licht")
    assert ressource.ga == "1/1/1"
    assert ressource.dpt == "DPST-1-1"
    assert ressource.operationen == ("readproperty", "writeproperty")
    assert ressource.lesbar and ressource.schreibbar
    assert not ressource.beobachtbar


def test_beobachtbar_nur_bei_observe_oder_subscribe() -> None:
    td = vorlage(
        properties={
            "still": eigenschaft(forms=[{"href": "knx://1/1/1", "op": ["readproperty"]}]),
            "laut": eigenschaft(
                forms=[{"href": "knx://1/1/2", "op": ["readproperty", "observeproperty"]}]
            ),
        },
        events={"alarm": eigenschaft(forms=[{"href": "knx://1/1/3", "op": ["subscribeevent"]}])},
    )
    beobachtbar = {r.name: r.beobachtbar for r in bilde_ab(td, BASIS).ressourcen}
    assert beobachtbar == {"still": False, "laut": True, "alarm": True}


def test_adresse_wird_notfalls_aus_dem_href_gelesen() -> None:
    eintrag = eigenschaft()
    del eintrag["ets2td:gruppenadresse"]
    ab = bilde_ab(vorlage(properties={"licht": eintrag}), BASIS)
    assert ab.ressourcen[0].ga == "1/1/1"


def test_affordanz_ohne_adresse_wird_abgelehnt() -> None:
    eintrag = eigenschaft(forms=[{"href": "https://beispiel/x", "op": ["readproperty"]}])
    del eintrag["ets2td:gruppenadresse"]
    with pytest.raises(AbbildungsFehler, match="Gruppenadresse"):
        bilde_ab(vorlage(properties={"licht": eintrag}), BASIS)


def test_affordanz_ohne_forms_wird_abgelehnt() -> None:
    eintrag = eigenschaft(forms=[])
    with pytest.raises(AbbildungsFehler, match="Forms"):
        bilde_ab(vorlage(properties={"licht": eintrag}), BASIS)


def test_fehlende_operationen_werden_aus_dem_abschnitt_ergaenzt() -> None:
    td = vorlage(
        properties={"p": eigenschaft(forms=[{"href": "knx://1/1/1"}])},
        actions={"a": eigenschaft(forms=[{"href": "knx://1/1/2"}])},
        events={"e": eigenschaft(forms=[{"href": "knx://1/1/3"}])},
    )
    nach_name = {r.name: r.operationen for r in bilde_ab(td, BASIS).ressourcen}
    assert nach_name["p"] == ("readproperty", "writeproperty")
    assert nach_name["a"] == ("invokeaction",)
    assert nach_name["e"] == ("subscribeevent",)


def test_schema_der_property_traegt_wertebereich_und_einheit() -> None:
    eintrag = eigenschaft(type="number", unit="%", minimum=0, maximum=100)
    ab = bilde_ab(vorlage(properties={"pos": eintrag}), BASIS)
    assert ab.ressourcen[0].schema == {"type": "number", "unit": "%", "minimum": 0, "maximum": 100}


def test_schema_der_action_stammt_aus_input() -> None:
    eintrag = eigenschaft(input={"type": "integer", "minimum": 1, "maximum": 64})
    ab = bilde_ab(vorlage(actions={"szene": eintrag}), BASIS)
    assert ab.ressourcen[0].schema["maximum"] == 64


def test_schema_des_events_stammt_aus_data() -> None:
    eintrag = eigenschaft(data={"type": "boolean"})
    ab = bilde_ab(vorlage(events={"alarm": eintrag}), BASIS)
    assert ab.ressourcen[0].schema == {"type": "boolean"}


def test_mehrere_affordanzen_auf_derselben_adresse_werden_zusammengefasst() -> None:
    td = vorlage(
        properties={
            "a": eigenschaft(forms=[{"href": "knx://1/1/1", "op": ["readproperty"]}]),
            "b": eigenschaft(forms=[{"href": "knx://1/1/1", "op": ["writeproperty"]}]),
        }
    )
    nach_ga = bilde_ab(td, BASIS).nach_ga()
    assert len(nach_ga["1/1/1"]) == 2


def test_cbor_format_ist_bekannt_und_verschieden_von_json() -> None:
    assert (JSON_FORMAT, CBOR_FORMAT) == (50, 60)
