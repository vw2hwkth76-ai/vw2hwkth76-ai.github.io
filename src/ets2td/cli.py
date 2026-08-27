from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from ets2td.bericht.ausgabe import bericht_json, bericht_markdown
from ets2td.bericht.vergleich import lade_gold, vergleiche
from ets2td.knxproj.leser import KnxProjekt, KnxProjektFehler, lies_knxproj
from ets2td.knxproj.stammdaten import Stammdaten
from ets2td.konfigurator.bundle import baue_bundle, schreibe_bundle
from ets2td.modell import DIMENSIONEN, Datenpunkt, PfadErgebnis
from ets2td.pfad_a.graph import KeinKnxExport
from ets2td.pfad_a.leser import lies_semantischen_export
from ets2td.pfad_b.ableitung import leite_ab
from ets2td.td.bauer import baue_tds
from ets2td.td.pruefer import ValidatorNichtInstalliert, validiere_tds

KNXPROJ_ENDUNGEN = (".knxproj",)
SEMANTIK_ENDUNGEN = (".jsonld", ".json", ".ttl")


def baue_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ets2td",
        description=(
            "Erzeugt W3C WoT Thing Descriptions aus KNX-ETS-Exporten und misst, "
            "wie viel Semantik jeder Pfad aus dem Projekt gewinnt."
        ),
    )
    parser.add_argument(
        "exporte",
        nargs="+",
        type=Path,
        help=".knxproj fuer Pfad B, .jsonld/.ttl (semantischer Export) fuer Pfad A",
    )
    parser.add_argument("--pfad", choices=("a", "b", "beide"), default="beide")
    parser.add_argument("--out", type=Path, required=True, help="Ausgabeverzeichnis")
    parser.add_argument(
        "--gold", type=Path, help="Gold-Standard-Datei fuer die Korrektheitsmessung"
    )
    parser.add_argument(
        "--gold-vorlage",
        action="store_true",
        help="erzeugt gold-vorlage.json aus Pfad B zum Handkorrigieren",
    )
    parser.add_argument(
        "--je-funktion",
        action="store_true",
        help="eine TD pro Funktion statt pro Raum",
    )
    parser.add_argument(
        "--validieren", action="store_true", help="TDs mit dem Thingweb Playground pruefen"
    )
    parser.add_argument(
        "--validator-verzeichnis",
        type=Path,
        default=Path(__file__).resolve().parent.parent.parent / "validator",
        help="Verzeichnis mit installierter Playground-CLI (npm install)",
    )
    parser.add_argument(
        "--demo",
        type=Path,
        help="schreibt ein JSON-Bundle fuer die Konfigurator-Oberflaeche",
    )
    parser.add_argument(
        "--mit-jsonld-pruefung",
        action="store_true",
        help="JSON-LD-Pruefung des Validators aktivieren (braucht Netzzugriff)",
    )
    return parser


def _zuordnung_dict(punkt: Datenpunkt) -> dict[str, Any]:
    eintrag: dict[str, Any] = {
        "ga": punkt.ga,
        "ga_text": punkt.ga_text,
        "name": punkt.name,
        "beschreibung": punkt.beschreibung,
        "knx_rolle": punkt.knx_rolle,
        "zentral": punkt.zentral,
    }
    for dimension in DIMENSIONEN:
        zuordnung = punkt.zuordnung(dimension)
        eintrag[dimension] = (
            None
            if zuordnung is None
            else {
                "wert": zuordnung.wert,
                "quelle": zuordnung.quelle.value,
                "konfidenz": zuordnung.konfidenz,
            }
        )
    return eintrag


def _schreibe_json(pfad: Path, daten: Any) -> None:
    pfad.write_text(json.dumps(daten, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _schreibe_rueckfragen(ergebnis: PfadErgebnis, out: Path) -> None:
    _schreibe_json(
        out / f"rueckfragen-{ergebnis.pfad}.json",
        [asdict(frage) for frage in ergebnis.rueckfragen],
    )
    zeilen = [f"# Rueckfragen Pfad {ergebnis.pfad}: {ergebnis.projekt}", ""]
    if not ergebnis.rueckfragen:
        zeilen.append("Keine offenen Rueckfragen.")
    for frage in ergebnis.rueckfragen:
        zeilen.append(f"- {frage.frage}")
        if frage.vorschlaege:
            zeilen.append(f"  Vorschlaege: {', '.join(frage.vorschlaege)}")
    (out / f"rueckfragen-{ergebnis.pfad}.md").write_text(
        "\n".join(zeilen) + "\n", encoding="utf-8"
    )


def _schreibe_gold_vorlage(ergebnis: PfadErgebnis, out: Path) -> None:
    datenpunkte: dict[str, Any] = {}
    for punkt in ergebnis.datenpunkte:
        eintrag: dict[str, Any] = {"text": punkt.ga_text, "name": punkt.name}
        for dimension in DIMENSIONEN:
            zuordnung = punkt.zuordnung(dimension)
            eintrag[dimension] = zuordnung.wert if zuordnung is not None else ""
        datenpunkte[str(punkt.ga)] = eintrag
    _schreibe_json(
        out / "gold-vorlage.json", {"projekt": ergebnis.projekt, "datenpunkte": datenpunkte}
    )


def _verarbeite_pfad_b(
    knxproj: Path, ergebnisse: list[PfadErgebnis]
) -> KnxProjekt:
    projekt = lies_knxproj(knxproj)
    ergebnisse.append(leite_ab(projekt))
    if projekt.funktionen:
        ergebnisse.append(leite_ab(projekt, heuristik_pur=True))
    else:
        print("Keine ETS-Funktionen im Projekt, b-pur entfaellt (waere identisch zu b).")
    return projekt


def _schreibe_ausgaben(
    ergebnisse: list[PfadErgebnis],
    stammdaten: Stammdaten,
    args: argparse.Namespace,
) -> list[Path]:
    td_dateien: list[Path] = []
    for ergebnis in ergebnisse:
        if ergebnis.pfad == "b-pur":
            continue
        td_verzeichnis = args.out / "td" / ergebnis.pfad
        td_verzeichnis.mkdir(parents=True, exist_ok=True)
        for name, td in baue_tds(
            ergebnis, stammdaten, je_funktion=args.je_funktion
        ).items():
            ziel = td_verzeichnis / name
            _schreibe_json(ziel, td)
            td_dateien.append(ziel)

    for ergebnis in ergebnisse:
        _schreibe_json(
            args.out / f"zuordnungen-{ergebnis.pfad}.json",
            [_zuordnung_dict(punkt) for punkt in ergebnis.datenpunkte],
        )
        _schreibe_rueckfragen(ergebnis, args.out)
    if args.gold_vorlage and ergebnisse:
        _schreibe_gold_vorlage(ergebnisse[0], args.out)
    return td_dateien


def main(argv: Sequence[str] | None = None) -> int:
    parser = baue_parser()
    args = parser.parse_args(argv)

    knxprojs = [p for p in args.exporte if p.suffix.lower() in KNXPROJ_ENDUNGEN]
    semantik = [p for p in args.exporte if p.suffix.lower() in SEMANTIK_ENDUNGEN]
    unbekannt = [p for p in args.exporte if p not in knxprojs and p not in semantik]
    if unbekannt:
        parser.error("Unbekannte Endung: " + ", ".join(str(p) for p in unbekannt))
    if len(knxprojs) > 1 or len(semantik) > 1:
        parser.error("Bitte je Lauf hoechstens ein knxproj und einen semantischen Export angeben.")

    braucht_a = args.pfad in ("a", "beide")
    braucht_b = args.pfad in ("b", "beide")
    if args.pfad == "b" and not knxprojs:
        parser.error("Pfad B braucht eine .knxproj-Datei.")
    if args.pfad == "a" and not semantik:
        parser.error("Pfad A braucht einen semantischen Export (.jsonld oder .ttl).")

    args.out.mkdir(parents=True, exist_ok=True)
    ergebnisse: list[PfadErgebnis] = []
    vorbemerkungen: list[str] = []
    td_dateien: list[Path] = []
    stammdaten = Stammdaten()
    ga_stil = "ThreeLevel"

    if braucht_b and knxprojs:
        try:
            projekt = _verarbeite_pfad_b(knxprojs[0], ergebnisse)
        except KnxProjektFehler as fehler:
            print(f"Pfad B fehlgeschlagen: {fehler}", file=sys.stderr)
            return 2
        stammdaten = projekt.stammdaten
        ga_stil = projekt.ga_stil or ga_stil
        print(
            f"Pfad B: {len(projekt.gruppenadressen)} Gruppenadressen, "
            f"{len(projekt.funktionen)} ETS-Funktionen."
        )

    if braucht_a and semantik:
        try:
            ergebnis_a = lies_semantischen_export(semantik[0], ga_stil=ga_stil)
            ergebnisse.insert(0, ergebnis_a)
            print(f"Pfad A: {len(ergebnis_a.datenpunkte)} Gruppenadressen aus dem Export.")
            if not stammdaten.dpts:
                vorbemerkungen.append(
                    "Ohne knxproj fehlen die DPT-Stammdaten, die erzeugten TDs haben "
                    "deshalb keine Wertebereiche und Einheiten."
                )
        except KeinKnxExport as fehler:
            print(f"Pfad A fehlgeschlagen: {fehler}", file=sys.stderr)
            if args.pfad == "a":
                return 2
            vorbemerkungen.append("Pfad A wurde nicht ausgewertet: " + str(fehler))
    elif braucht_a and not semantik:
        vorbemerkungen.append("Pfad A uebersprungen, kein semantischer Export uebergeben.")

    if not ergebnisse:
        print("Kein Pfad lieferte Ergebnisse.", file=sys.stderr)
        return 2

    td_dateien = _schreibe_ausgaben(ergebnisse, stammdaten, args)
    print(f"{len(td_dateien)} Thing Descriptions erzeugt.")

    if args.demo:
        kennzahlen = {
            "projekt": ergebnisse[0].projekt,
            "datenpunkte": len(ergebnisse[0].datenpunkte),
            "pfade": sorted({e.pfad for e in ergebnisse}),
        }
        bundle = baue_bundle(
            {ergebnis.pfad: ergebnis for ergebnis in ergebnisse},
            stammdaten,
            ergebnisse[0].projekt,
            kennzahlen,
        )
        schreibe_bundle(bundle, args.demo)
        print(f"Demo-Bundle geschrieben: {args.demo}")

    gold = lade_gold(args.gold) if args.gold else None
    bilanzen = [vergleiche(ergebnis, gold) for ergebnis in ergebnisse]
    _schreibe_json(
        args.out / "bericht.json", bericht_json(bilanzen, gold is not None, vorbemerkungen)
    )
    (args.out / "bericht.md").write_text(
        bericht_markdown(bilanzen, gold is not None, vorbemerkungen), encoding="utf-8"
    )
    print(f"Bericht geschrieben: {args.out / 'bericht.md'}")

    if args.validieren and td_dateien:
        try:
            pruefung = validiere_tds(
                td_dateien, args.validator_verzeichnis, mit_jsonld=args.mit_jsonld_pruefung
            )
        except ValidatorNichtInstalliert as fehler:
            print(str(fehler), file=sys.stderr)
            return 1
        if pruefung.bestanden:
            print(f"Validierung: alle {len(pruefung.dateien)} TDs bestanden.")
        else:
            for datei in pruefung.fehlgeschlagen:
                print(f"Validierung fehlgeschlagen: {datei.datei}", file=sys.stderr)
                for zeile in datei.fehlerzeilen[:10]:
                    print(f"  {zeile}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
