from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from ets2td.knxproj.leser import formatiere_ga
from ets2td.modell import Datenpunkt, PfadErgebnis, Quelle, Rueckfrage, WotRolle, Zuordnung
from ets2td.pfad_a.graph import Graph, KeinKnxExport, Knoten, lade_graph

DPT_TABELLE = Path(__file__).resolve().parent / "daten" / "kim_dpt.json"

WOHNRAUM_TYPEN = ("loc:Room",)
BETRIEBSRAUM_TYPEN = ("loc:Space", "loc:DistributionBoard")


@lru_cache(maxsize=1)
def dpt_tabelle() -> dict[str, str]:
    roh = json.loads(DPT_TABELLE.read_text(encoding="utf-8"))
    return {schluessel: eintrag["dpst"] for schluessel, eintrag in roh.items()}


def _dpst(dpt_verweis: str) -> str:
    return dpt_tabelle().get(dpt_verweis, "")


def _geraet_je_datenpunkt(graph: Graph) -> dict[str, Knoten]:
    zuordnung: dict[str, Knoten] = {}
    for geraet in graph.vom_typ("core:Device"):
        for programm_id in geraet.verweise("core:hosts"):
            programm = graph.knoten.get(programm_id)
            if programm is None:
                continue
            for funktionalitaet_id in programm.verweise("core:implements"):
                funktionalitaet = graph.knoten.get(funktionalitaet_id)
                if funktionalitaet is None:
                    continue
                for punkt_id in funktionalitaet.verweise("core:hasPoint"):
                    zuordnung[punkt_id] = geraet
    return zuordnung


def _ort_je_geraet(graph: Graph) -> dict[str, Knoten]:
    zuordnung: dict[str, Knoten] = {}
    for ort in graph.knoten.values():
        for geraet_id in ort.verweise("loc:containsEquipment"):
            zuordnung[geraet_id] = ort
    return zuordnung


def _funktion_je_punkt(graph: Graph) -> dict[str, Knoten]:
    zuordnung: dict[str, Knoten] = {}
    for typ in ("core:ApplicationFunction", "knx:Channel"):
        for funktion in graph.vom_typ(typ):
            for punkt_id in funktion.verweise("core:hasPoint"):
                zuordnung[punkt_id] = funktion
    return zuordnung


def _rolle_aus_zugriff(punkt: Knoten) -> tuple[WotRolle, bool] | None:
    schreibbar = punkt.wahrheit("core:writable")
    lesbar = punkt.wahrheit("core:readable")
    if schreibbar and lesbar:
        return WotRolle.PROPERTY, False
    if schreibbar:
        return WotRolle.ACTION, False
    if lesbar:
        return WotRolle.PROPERTY, True
    return None


def _raum_zuordnung(
    graph: Graph,
    funktionspunkt: Knoten,
    geraet_je_datenpunkt: dict[str, Knoten],
    ort_je_geraet: dict[str, Knoten],
) -> tuple[Zuordnung | None, str]:
    orte: dict[str, Knoten] = {}
    for datenpunkt_id in funktionspunkt.verweise("core:groups"):
        geraet = geraet_je_datenpunkt.get(datenpunkt_id)
        if geraet is None:
            continue
        ort = ort_je_geraet.get(geraet.id)
        if ort is not None:
            orte[ort.id] = ort

    wohnraeume = [o for o in orte.values() if any(t in WOHNRAUM_TYPEN for t in o.typen)]
    betriebsraeume = [o for o in orte.values() if any(t in BETRIEBSRAUM_TYPEN for t in o.typen)]

    if len(wohnraeume) == 1:
        # Sitzt zusaetzlich ein Geraet im Schaltschrank, ist der gefundene Raum
        # der Standort eines Bedienelements oder Sensors und nicht zwingend der
        # Wirkort der Funktion.
        unsicher = bool(betriebsraeume)
        return (
            Zuordnung(
                wohnraeume[0].text("dct:title"),
                Quelle.SEMANTIK_GERAETEKETTE,
                0.5 if unsicher else 0.8,
            ),
            "Bedienort moeglich, Aktor steht im Schaltschrank" if unsicher else "",
        )
    if len(wohnraeume) > 1:
        namen = sorted(o.text("dct:title") for o in wohnraeume)
        return None, "mehrdeutig: " + ", ".join(namen)
    if betriebsraeume:
        namen = sorted(o.text("dct:title") for o in betriebsraeume)
        return None, "nur Betriebsmittelort (" + ", ".join(namen) + ")"
    return None, "keine Ortsangabe ueber die Geraetekette"


def _dpt_zuordnung(
    graph: Graph, funktionspunkt: Knoten
) -> tuple[Zuordnung | None, str]:
    eigener = funktionspunkt.verweise("knx:datapointType")
    if eigener:
        dpst = _dpst(eigener[0])
        if dpst:
            return Zuordnung(dpst, Quelle.ETS_SEMANTIK, 1.0), ""
        return None, f"unbekanntes DPT-Individuum {eigener[0]}"

    kandidaten: set[str] = set()
    for datenpunkt_id in funktionspunkt.verweise("core:groups"):
        datenpunkt = graph.knoten.get(datenpunkt_id)
        if datenpunkt is None:
            continue
        for verweis in datenpunkt.verweise("knx:datapointType"):
            dpst = _dpst(verweis)
            if dpst:
                kandidaten.add(dpst)
    if len(kandidaten) == 1:
        return Zuordnung(kandidaten.pop(), Quelle.SEMANTIK_KOMMOBJEKT, 0.8), ""
    if len(kandidaten) > 1:
        return None, "widersprechende DPTs an den Kommunikationsobjekten: " + ", ".join(
            sorted(kandidaten)
        )
    return None, ""


def lies_semantischen_export(pfad: Path, ga_stil: str = "ThreeLevel") -> PfadErgebnis:
    graph = lade_graph(pfad)

    installation = next(graph.vom_typ("core:Installation"), None)
    projektname = installation.text("dct:title") if installation else pfad.stem

    ergebnis = PfadErgebnis(pfad="a", projekt=projektname)

    geraet_je_datenpunkt = _geraet_je_datenpunkt(graph)
    ort_je_geraet = _ort_je_geraet(graph)
    funktion_je_punkt = _funktion_je_punkt(graph)

    anwendungsfunktionen = list(graph.vom_typ("core:ApplicationFunction"))
    if not anwendungsfunktionen:
        ergebnis.hinweise.append(
            "Der Export enthaelt keine core:ApplicationFunction. Im Projekt wurde kein "
            "Smart Linking verwendet, damit fehlt die Funktionssemantik vollstaendig."
        )

    funktionspunkte = list(graph.vom_typ("knx:FunctionPoint"))
    if not funktionspunkte:
        raise KeinKnxExport(
            f"{pfad.name} enthaelt keine knx:FunctionPoint-Knoten, also keine "
            "Gruppenadressen. Der Export ist fuer diesen Zweck unbrauchbar."
        )

    for funktionspunkt in funktionspunkte:
        adresse = funktionspunkt.zahl("knx:groupAddress")
        if adresse is None:
            ergebnis.hinweise.append(
                f"FunctionPoint {funktionspunkt.id} ohne knx:groupAddress, uebersprungen."
            )
            continue

        punkt = Datenpunkt(
            ga=adresse,
            ga_text=formatiere_ga(adresse, ga_stil),
            name=funktionspunkt.text("dct:title").strip(),
            beschreibung=funktionspunkt.text("dct:description").strip(),
        )

        zugriff = _rolle_aus_zugriff(funktionspunkt)
        if zugriff is not None:
            rolle, _nur_lesbar = zugriff
            punkt.rolle = Zuordnung(rolle.value, Quelle.SEMANTIK_ZUGRIFF, 0.8)

        punkt.dpt, dpt_grund = _dpt_zuordnung(graph, funktionspunkt)
        if dpt_grund:
            ergebnis.hinweise.append(f"GA {punkt.ga_text} '{punkt.name}': {dpt_grund}")

        punkt.raum, raum_grund = _raum_zuordnung(
            graph, funktionspunkt, geraet_je_datenpunkt, ort_je_geraet
        )
        if punkt.raum is not None and raum_grund:
            ergebnis.hinweise.append(
                f"GA {punkt.ga_text} '{punkt.name}': Raum '{punkt.raum.wert}' unsicher, "
                f"{raum_grund}."
            )
            raum_grund = ""

        funktion = None
        for datenpunkt_id in funktionspunkt.verweise("core:groups"):
            funktion = funktion_je_punkt.get(datenpunkt_id)
            if funktion is not None:
                break
        if funktion is not None:
            punkt.funktion = Zuordnung(
                funktion.text("dct:title"), Quelle.ETS_SEMANTIK, 0.9
            )

        fehlend = tuple(
            dimension
            for dimension in ("raum", "funktion", "rolle", "dpt")
            if punkt.zuordnung(dimension) is None
        )
        if fehlend:
            gruende = [raum_grund] if raum_grund and "raum" in fehlend else []
            if "funktion" in fehlend and not anwendungsfunktionen:
                gruende.append("kein Smart Linking im Projekt")
            ergebnis.rueckfragen.append(
                Rueckfrage(
                    ga_text=punkt.ga_text,
                    name=punkt.name,
                    fehlende_dimensionen=fehlend,
                    frage=(
                        f"Die Gruppenadresse {punkt.ga_text} '{punkt.name}' bleibt im "
                        f"semantischen Export unvollstaendig. Fehlend: "
                        f"{', '.join(fehlend)}."
                        + (" Grund: " + "; ".join(gruende) + "." if gruende else "")
                    ),
                )
            )

        ergebnis.datenpunkte.append(punkt)

    ergebnis.datenpunkte.sort(key=lambda punkt: punkt.ga)
    _ergaenze_strukturhinweise(graph, ergebnis)
    return ergebnis


def _ergaenze_strukturhinweise(graph: Graph, ergebnis: PfadErgebnis) -> None:
    if not any(graph.vom_typ("knx:GroupRange")):
        ergebnis.hinweise.append(
            "Der Export enthaelt keine Gruppenadress-Hierarchie: Haupt- und "
            "Mittelgruppennamen aus der ETS fehlen, uebrig bleibt nur der Text der "
            "Untergruppe (dct:title des FunctionPoint)."
        )
    raeume = list(graph.vom_typ("loc:Room"))
    ohne_ausstattung = [r for r in raeume if not r.verweise("loc:containsEquipment")]
    if ohne_ausstattung:
        ergebnis.hinweise.append(
            f"{len(ohne_ausstattung)} von {len(raeume)} Raeumen enthalten kein Geraet "
            "und sind damit ueber die Geraetekette nicht erreichbar: "
            + ", ".join(sorted(r.text("dct:title") for r in ohne_ausstattung))
        )


def charakterisiere(pfad: Path) -> str:
    zeilen = [f"Datei: {pfad.name} ({pfad.stat().st_size} Bytes)"]
    if pfad.suffix.lower() in (".jsonld", ".json"):
        daten = json.loads(pfad.read_text(encoding="utf-8"))
        if isinstance(daten, dict):
            zeilen.append("Oberste Schluessel: " + ", ".join(sorted(daten)[:15]))
            kontext = daten.get("@context")
            if isinstance(kontext, dict):
                zeilen.append(
                    "@context-Praefixe: " + ", ".join(sorted(str(k) for k in kontext)[:20])
                )
            graph = daten.get("@graph")
            if isinstance(graph, list):
                zeilen.append(f"@graph-Knoten: {len(graph)}")
        elif isinstance(daten, list):
            zeilen.append(f"JSON-Array mit {len(daten)} Knoten")
    elif pfad.suffix.lower() == ".ttl":
        inhalt = pfad.read_text(encoding="utf-8", errors="replace")
        praefixe = [z for z in inhalt.splitlines() if z.lstrip().startswith("@prefix")]
        zeilen.append(f"Turtle mit {len(inhalt.splitlines())} Zeilen")
        zeilen.extend(praefixe[:15])
    return "\n".join(zeilen)
