from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from ets2td.bericht.vergleich import PfadBilanz
from ets2td.modell import DIMENSIONEN

MAX_FEHLERBEISPIELE = 15


def bericht_json(
    bilanzen: list[PfadBilanz], mit_gold: bool, vorbemerkungen: Sequence[str] = ()
) -> dict[str, Any]:
    return {
        "projekt": bilanzen[0].projekt if bilanzen else "",
        "mit_gold": mit_gold,
        "vorbemerkungen": list(vorbemerkungen),
        "pfade": [
            {
                **asdict(bilanz),
                "quoten": {
                    dimension: round(bilanz.bilanzen[dimension].quote, 4)
                    for dimension in DIMENSIONEN
                },
                "fehlerklassen": bilanz.fehlerklassen,
            }
            for bilanz in bilanzen
        ],
    }


def _prozent(zaehler: int, nenner: int) -> str:
    return f"{100 * zaehler / nenner:.1f} %" if nenner else "n. a."


def bericht_markdown(
    bilanzen: list[PfadBilanz], mit_gold: bool, vorbemerkungen: Sequence[str] = ()
) -> str:
    zeilen: list[str] = []
    projekt = bilanzen[0].projekt if bilanzen else ""
    zeilen.append(f"# Vergleichsbericht: {projekt}")
    zeilen.append("")
    for vorbemerkung in vorbemerkungen:
        zeilen.append(f"> {vorbemerkung}")
        zeilen.append("")
    if not mit_gold:
        zeilen.append(
            "Ohne Gold-Standard werden nur Abdeckungszahlen berichtet, keine Korrektheit."
        )
        zeilen.append("")

    for bilanz in bilanzen:
        zeilen.append(f"## Pfad {bilanz.pfad}")
        zeilen.append("")
        zeilen.append(
            f"Datenpunkte: {bilanz.datenpunkte}, offene Rueckfragen: {bilanz.rueckfragen}"
        )
        zeilen.append("")
        zeilen.append("### Abdeckung")
        zeilen.append("")
        zeilen.append("| Dimension | zugeordnet | Anteil |")
        zeilen.append("|---|---|---|")
        for dimension in DIMENSIONEN:
            anzahl = bilanz.abdeckung[dimension]
            zeilen.append(
                f"| {dimension} | {anzahl}/{bilanz.datenpunkte} "
                f"| {_prozent(anzahl, bilanz.datenpunkte)} |"
            )
        zeilen.append("")

        if mit_gold:
            zeilen.append("### Korrektheit gegen Gold-Standard")
            zeilen.append("")
            zeilen.append(
                "| Dimension | bewertet | korrekt | Haupttyp-Treffer | falsch | fehlend | Quote |"
            )
            zeilen.append("|---|---|---|---|---|---|---|")
            for dimension in DIMENSIONEN:
                b = bilanz.bilanzen[dimension]
                zeilen.append(
                    f"| {dimension} | {b.bewertet} | {b.korrekt} | {b.halbtreffer} "
                    f"| {b.falsch} | {b.fehlend} | {_prozent(b.korrekt, b.bewertet)} |"
                )
            zeilen.append("")

        zeilen.append("### Zuordnungsquellen")
        zeilen.append("")
        zeilen.append("| Dimension | Quelle | Anzahl |")
        zeilen.append("|---|---|---|")
        for dimension in DIMENSIONEN:
            for quelle, anzahl in sorted(bilanz.quellen[dimension].items()):
                zeilen.append(f"| {dimension} | {quelle} | {anzahl} |")
        zeilen.append("")

        if mit_gold and bilanz.fehlerklassen:
            zeilen.append("### Fehlerklassen")
            zeilen.append("")
            zeilen.append("| Klasse | Anzahl |")
            zeilen.append("|---|---|")
            for klasse, anzahl in bilanz.fehlerklassen.items():
                zeilen.append(f"| {klasse} | {anzahl} |")
            zeilen.append("")

        if mit_gold and bilanz.fehler:
            zeilen.append(f"### Fehlerbeispiele (maximal {MAX_FEHLERBEISPIELE})")
            zeilen.append("")
            zeilen.append("| GA | Name | Dimension | erwartet | erhalten | Quelle |")
            zeilen.append("|---|---|---|---|---|---|")
            for fehler in bilanz.fehler[:MAX_FEHLERBEISPIELE]:
                zeilen.append(
                    f"| {fehler.ga_text} | {fehler.name} | {fehler.dimension} "
                    f"| {fehler.erwartet} | {fehler.erhalten} | {fehler.quelle} |"
                )
            zeilen.append("")

        if bilanz.hinweise:
            zeilen.append("### Hinweise")
            zeilen.append("")
            for hinweis in bilanz.hinweise[:30]:
                zeilen.append(f"- {hinweis}")
            if len(bilanz.hinweise) > 30:
                zeilen.append(f"- ... und {len(bilanz.hinweise) - 30} weitere")
            zeilen.append("")

    return "\n".join(zeilen)
