/* Projektimport im Browser: ZIP entpacken, knxproj lesen, Datenpunkte ableiten.
   Die Ableitungsregeln kommen aus dem Bundle (SAMMLUNG.parameter/regeln) und
   stammen damit aus derselben Quelle wie der Python-Weg. */

const ZIP_EOCD = 0x06054b50;
const ZIP_CD = 0x02014b50;

function leseZip(puffer) {
  const sicht = new DataView(puffer);
  let eocd = -1;
  for (let i = puffer.byteLength - 22; i >= 0 && i > puffer.byteLength - 66000; i--) {
    if (sicht.getUint32(i, true) === ZIP_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Keine ZIP-Datei: Zentralverzeichnis nicht gefunden.");
  const anzahl = sicht.getUint16(eocd + 10, true);
  let zeiger = sicht.getUint32(eocd + 16, true);
  const eintraege = [];
  for (let n = 0; n < anzahl; n++) {
    if (sicht.getUint32(zeiger, true) !== ZIP_CD) break;
    const methode = sicht.getUint16(zeiger + 10, true);
    const flags = sicht.getUint16(zeiger + 8, true);
    const komprimiert = sicht.getUint32(zeiger + 20, true);
    const namenslaenge = sicht.getUint16(zeiger + 28, true);
    const extralaenge = sicht.getUint16(zeiger + 30, true);
    const kommentarlaenge = sicht.getUint16(zeiger + 32, true);
    const versatz = sicht.getUint32(zeiger + 42, true);
    const name = new TextDecoder().decode(
      new Uint8Array(puffer, zeiger + 46, namenslaenge));
    eintraege.push({ name, methode, flags, komprimiert, versatz });
    zeiger += 46 + namenslaenge + extralaenge + kommentarlaenge;
  }
  return { puffer, sicht, eintraege };
}

async function entpacke(zip, name) {
  const eintrag = zip.eintraege.find(e => e.name === name);
  if (!eintrag) return null;
  if (eintrag.flags & 0x1) {
    throw new Error("Das Projekt ist passwortgeschuetzt. Bitte ohne Passwort exportieren.");
  }
  const kopf = eintrag.versatz;
  const namenslaenge = zip.sicht.getUint16(kopf + 26, true);
  const extralaenge = zip.sicht.getUint16(kopf + 28, true);
  const start = kopf + 30 + namenslaenge + extralaenge;
  const roh = new Uint8Array(zip.puffer, start, eintrag.komprimiert);
  if (eintrag.methode === 0) return new TextDecoder("utf-8").decode(roh);
  if (eintrag.methode !== 8) throw new Error("Unbekanntes ZIP-Verfahren " + eintrag.methode);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Dieser Browser kann kein ZIP entpacken. Bitte Chrome, Edge oder Safari nutzen.");
  }
  const strom = new Blob([roh]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const text = await new Response(strom).text();
  return text;
}

function lokal(knoten) {
  return knoten.localName || knoten.nodeName.replace(/^.*:/, "");
}

function kinder(knoten, name) {
  return [...knoten.children].filter(k => lokal(k) === name);
}

function alle(wurzel, name) {
  const treffer = [];
  const lauf = knoten => {
    for (const kind of knoten.children) {
      if (lokal(kind) === name) treffer.push(kind);
      lauf(kind);
    }
  };
  lauf(wurzel);
  return treffer;
}

function formatiereGa(adresse, stil) {
  if (stil === "ThreeLevel") return `${adresse >> 11}/${(adresse >> 8) & 0x7}/${adresse & 0xFF}`;
  if (stil === "TwoLevel") return `${adresse >> 11}/${adresse & 0x7FF}`;
  return String(adresse);
}

/* ---- Stammdaten aus knx_master.xml ---- */

function liesStammdaten(xmlText) {
  const dpts = {};
  const raumnutzungen = {};
  const funktionstypen = {};
  if (!xmlText) return { dpts, raumnutzungen, funktionstypen };
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) return { dpts, raumnutzungen, funktionstypen };

  const formatRegister = {};
  ["Bit", "UnsignedInteger", "SignedInteger", "Float", "Enumeration"].forEach(art => {
    alle(doc.documentElement, art).forEach(el => {
      const id = el.getAttribute("Id");
      if (id) formatRegister[id] = el;
    });
  });

  const liesFormat = el => {
    const art = lokal(el);
    if (art === "RefType") {
      const ziel = formatRegister[el.getAttribute("RefId")];
      return ziel ? liesFormat(ziel) : null;
    }
    if (art === "Bit") {
      return { art: "bit", geloescht: el.getAttribute("Cleared") || "",
               gesetzt: el.getAttribute("Set") || "", name: el.getAttribute("Name") || "" };
    }
    if (art === "UnsignedInteger" || art === "SignedInteger" || art === "Float") {
      const zahl = wert => (wert === null || wert === "" ? null : Number(wert));
      return {
        art: art === "Float" ? "float" : (art === "SignedInteger" ? "signed" : "unsigned"),
        breite: Number(el.getAttribute("Width") || 0),
        einheit: el.getAttribute("Unit") || "",
        minimum: zahl(el.getAttribute("MinValue")),
        maximum: zahl(el.getAttribute("MaxValue")),
        koeffizient: zahl(el.getAttribute("Coefficient")),
        name: el.getAttribute("Name") || "",
      };
    }
    if (art === "Enumeration") {
      return { art: "enum", werte: kinder(el, "EnumValue").map(k => ({
        wert: Number(k.getAttribute("Value") || 0), titel: k.getAttribute("Text") || "" })) };
    }
    return null;
  };

  alle(doc.documentElement, "DatapointType").forEach(el => {
    const groesse = Number(el.getAttribute("SizeInBit") || 0);
    const haupt = el.getAttribute("Id") || "";
    dpts[haupt] = { id: haupt, name: el.getAttribute("Name") || "",
                    text: el.getAttribute("Text") || "", groesse, formate: [] };
    alle(el, "DatapointSubtype").forEach(sub => {
      const formate = [];
      kinder(sub, "Format").forEach(f => {
        [...f.children].forEach(kind => {
          const gelesen = liesFormat(kind);
          if (gelesen) formate.push(gelesen);
        });
      });
      const id = sub.getAttribute("Id") || "";
      dpts[id] = { id, name: sub.getAttribute("Name") || "",
                   text: sub.getAttribute("Text") || "", groesse, formate, haupttyp: haupt };
    });
  });

  alle(doc.documentElement, "SpaceUsage").forEach(el => {
    raumnutzungen[el.getAttribute("Id")] = el.getAttribute("Text") || "";
  });
  alle(doc.documentElement, "FunctionType").forEach(el => {
    funktionstypen[el.getAttribute("Id")] = {
      text: el.getAttribute("Text") || "",
      veraltet: el.getAttribute("Status") === "deprecated",
    };
  });
  return { dpts, raumnutzungen, funktionstypen };
}

function datenschemaFuer(dptId, stammdaten) {
  const info = stammdaten.dpts[dptId];
  if (!info) return null;
  if (!info.formate || !info.formate.length) {
    if (info.haupttyp || !dptId.startsWith("DPT-")) return null;
    return info.groesse === 1 ? { type: "boolean" } : null;
  }
  const teile = info.formate.map(schemaFuerFormat);
  if (teile.length === 1) return teile[0];
  const eigenschaften = {};
  teile.forEach((teil, i) => {
    const name = (info.formate[i].name || ("teil" + (i + 1)));
    eigenschaften[schluesselAus(name)] = teil;
  });
  return { type: "object", properties: eigenschaften };
}

function schemaFuerFormat(format) {
  if (format.art === "bit") {
    const schema = { type: "boolean" };
    if (format.geloescht || format.gesetzt) {
      schema.description = `false = ${format.geloescht}, true = ${format.gesetzt}`;
    }
    return schema;
  }
  if (format.art === "enum") {
    return { type: "integer",
             oneOf: format.werte.map(w => ({ const: w.wert, title: w.titel })) };
  }
  let minimum, maximum;
  if (format.art === "float") { minimum = format.minimum; maximum = format.maximum; }
  else if (format.art === "signed") {
    minimum = -(2 ** (format.breite - 1)); maximum = 2 ** (format.breite - 1) - 1;
  } else { minimum = 0; maximum = 2 ** format.breite - 1; }
  if (format.koeffizient !== null && format.koeffizient !== undefined) {
    if (minimum !== null) minimum = Math.round(minimum * format.koeffizient * 100) / 100;
    if (maximum !== null) maximum = Math.round(maximum * format.koeffizient * 100) / 100;
  }
  const ganzzahlig = format.art !== "float" &&
    (format.koeffizient === null || format.koeffizient === undefined);
  const schema = { type: ganzzahlig ? "integer" : "number" };
  if (minimum !== null && minimum !== undefined) {
    schema.minimum = ganzzahlig ? Math.trunc(minimum) : minimum;
  }
  if (maximum !== null && maximum !== undefined) {
    schema.maximum = ganzzahlig ? Math.trunc(maximum) : maximum;
  }
  if (format.einheit) schema.unit = format.einheit;
  return schema;
}

/* ---- Projektstruktur ---- */

function liesProjekt(projektXml, installationXml, stammdaten) {
  const projektDoc = new DOMParser().parseFromString(projektXml, "application/xml");
  const info = alle(projektDoc.documentElement, "ProjectInformation")[0];
  const name = info ? (info.getAttribute("Name") || "Projekt") : "Projekt";
  const stil = info ? (info.getAttribute("GroupAddressStyle") || "ThreeLevel") : "ThreeLevel";

  const doc = new DOMParser().parseFromString(installationXml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Die Projektdatei ist kein gueltiges XML.");

  const gruppenadressen = {};
  const bereiche = alle(doc.documentElement, "GroupAddresses")[0];
  if (bereiche) {
    const lauf = (el, kette) => {
      for (const kind of el.children) {
        const art = lokal(kind);
        if (art === "GroupRange") {
          lauf(kind, [...kette, kind.getAttribute("Name") || ""]);
        } else if (art === "GroupAddress") {
          const id = kind.getAttribute("Id");
          if (!id) continue;
          gruppenadressen[id] = {
            id,
            adresse: Number(kind.getAttribute("Address") || 0),
            name: kind.getAttribute("Name") || "",
            beschreibung: kind.getAttribute("Description") || "",
            dpt: kind.getAttribute("DatapointType") || "",
            zentral: kind.getAttribute("Central") === "true",
            hauptgruppe: kette[0] || "",
            mittelgruppe: kette[1] || "",
          };
        } else {
          lauf(kind, kette);
        }
      }
    };
    lauf(bereiche, []);
  }

  const raeume = [];
  const funktionen = [];
  const orte = alle(doc.documentElement, "Locations")[0];
  if (orte) {
    const laufRaum = (el, pfad) => {
      const raumname = el.getAttribute("Name") || "";
      const raum = {
        id: el.getAttribute("Id") || "",
        name: raumname,
        typ: el.getAttribute("Type") || "",
        nutzung: stammdaten.raumnutzungen[el.getAttribute("Usage")] || "",
        pfad: [...pfad, raumname],
      };
      raeume.push(raum);
      for (const kind of el.children) {
        const art = lokal(kind);
        if (art === "Space") laufRaum(kind, raum.pfad);
        else if (art === "Function") {
          const typId = kind.getAttribute("Type") || "";
          funktionen.push({
            id: kind.getAttribute("Id") || "",
            name: kind.getAttribute("Name") || "",
            typText: (stammdaten.funktionstypen[typId] || {}).text || "",
            raum,
            verknuepfungen: kinder(kind, "GroupAddressRef").map(ref => ({
              rolle: ref.getAttribute("Role") || "",
              gaId: ref.getAttribute("RefId") || "",
            })),
          });
        }
      }
    };
    kinder(orte, "Space").forEach(el => laufRaum(el, []));
  }
  return { name, stil, gruppenadressen, raeume, funktionen };
}

/* ---- Ableitung: nutzt die Regeln aus dem Bundle ---- */

function normalisiere(text) {
  return String(text || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function woerterVon(text) {
  const n = normalisiere(text);
  return n ? n.split(" ") : [];
}
function enthaeltPhrase(text, phrase) {
  return (" " + normalisiere(text) + " ").includes(" " + normalisiere(phrase) + " ");
}
function schluesselAus(text) {
  return normalisiere(text).replace(/ /g, "-") || "unbenannt";
}

function erkenneRolle(woerter, regeln) {
  const menge = new Set(woerter);
  const trifft = liste => liste.some(w => menge.has(w));
  if (trifft(regeln.status)) return "property";
  if (trifft(regeln.event) || woerter.some(w => w.includes("alarm"))) return "event";
  if (trifft(regeln.mehrdeutig)) return null;
  if (trifft(regeln.aktion)) return "action";
  if (trifft(regeln.messwert)) return "property";
  return null;
}

function erkenneDpt(woerter, regeln) {
  const menge = new Set(woerter);
  for (const eintrag of regeln.dpt_fallback) {
    if (eintrag.woerter.some(w => menge.has(w))) return eintrag.dpt;
  }
  return null;
}

function erkenneRaum(text, kandidaten, regeln) {
  const voll = kandidaten.filter(k => k && enthaeltPhrase(text, k));
  if (voll.length) {
    return voll.reduce((a, b) => (normalisiere(a).length >= normalisiere(b).length ? a : b));
  }
  const menge = new Set(woerterVon(text));
  const teil = new Set(kandidaten.filter(k => k && woerterVon(k)
    .some(t => t.length >= regeln.mindestlaenge_teilname && menge.has(t))));
  return teil.size === 1 ? [...teil][0] : null;
}

function raumAusLexikon(text, regeln) {
  const treffer = regeln.raumphrasen.filter(p => enthaeltPhrase(text, p));
  return treffer.length ? treffer.reduce((a, b) => (a.length >= b.length ? a : b)) : null;
}

function strukturraumZu(phrase, kandidaten) {
  const stichwort = normalisiere(phrase);
  const treffer = new Set(kandidaten.filter(k => k && woerterVon(k)
    .some(w => w === stichwort || w.startsWith(stichwort))));
  return treffer.size === 1 ? [...treffer][0] : null;
}

function ausserBetrieb(text, regeln) {
  const n = normalisiere(text);
  return regeln.ausser_betrieb.some(m => n.includes(normalisiere(m)));
}

function unbekanntesFolgewort(text, phrase, regeln) {
  const woerter = woerterVon(text);
  const phrasenwoerter = woerterVon(phrase);
  const bekannt = new Set([...regeln.status, ...regeln.event, ...regeln.aktion,
    ...regeln.messwert, ...regeln.funktionswoerter]);
  for (let start = 0; start <= woerter.length - phrasenwoerter.length; start++) {
    if (phrasenwoerter.every((w, i) => woerter[start + i] === w)) {
      const folge = woerter[start + phrasenwoerter.length];
      if (folge === undefined) return null;
      if (!bekannt.has(folge) && !regeln.raumphrasen.includes(folge)) return folge;
      return null;
    }
  }
  return null;
}

function leiteAb(projekt, stammdaten, regeln) {
  const punkte = {};
  const hinweise = [];
  Object.values(projekt.gruppenadressen).forEach(ga => {
    punkte[ga.id] = {
      ga: ga.adresse,
      ga_text: formatiereGa(ga.adresse, projekt.stil),
      name: ga.name,
      beschreibung: ga.beschreibung,
      hauptgruppe: ga.hauptgruppe,
      mittelgruppe: ga.mittelgruppe,
      zentral: ga.zentral,
      knx_rolle: "",
      herkunft: { raum: null, funktion: null, rolle: null, dpt: null },
      dpt: ga.dpt,
    };
    if (ga.dpt) {
      punkte[ga.id].herkunft.dpt =
        { wert: ga.dpt, quelle: "ets-attribut", konfidenz: 1 };
    }
  });

  projekt.funktionen.forEach(funktion => {
    funktion.verknuepfungen.forEach(v => {
      const punkt = punkte[v.gaId];
      if (!punkt) return;
      if (punkt.herkunft.funktion) return;
      punkt.herkunft.funktion = { wert: funktion.name, quelle: "ets-funktion", konfidenz: 1 };
      punkt.herkunft.raum = { wert: funktion.raum.name, quelle: "gebaeudestruktur", konfidenz: 1 };
      punkt.knx_rolle = v.rolle;
      const wot = regeln.knx_rollen[v.rolle];
      if (wot) punkt.herkunft.rolle = { wert: wot, quelle: "ets-funktion", konfidenz: 0.95 };
      else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v.rolle)) {
        hinweise.push(`GA ${punkt.ga_text}: benutzerdefinierte Rolle als GUID, ohne Definition im Export.`);
      }
    });
  });

  const kandidaten = [...new Set(projekt.raeume
    .filter(r => !["Building", "BuildingPart", "Floor"].includes(r.typ) && r.name)
    .map(r => r.name))];

  Object.values(punkte).forEach(punkt => {
    const text = `${punkt.name} ${punkt.beschreibung}`.trim();
    const woerter = woerterVon(text);
    let raumtreffer = punkt.herkunft.raum ? punkt.herkunft.raum.wert : null;

    if (!punkt.herkunft.raum) {
      let treffer = erkenneRaum(text, kandidaten, regeln);
      if (treffer) {
        punkt.herkunft.raum = { wert: treffer, quelle: "namenslexikon", konfidenz: 0.75 };
        raumtreffer = treffer;
      } else {
        treffer = raumAusLexikon(text, regeln);
        if (treffer) {
          const struktur = strukturraumZu(treffer, kandidaten);
          if (struktur) {
            punkt.herkunft.raum = { wert: struktur, quelle: "namenslexikon", konfidenz: 0.75 };
            raumtreffer = struktur;
          } else if (!unbekanntesFolgewort(text, treffer, regeln)) {
            punkt.herkunft.raum = { wert: treffer, quelle: "namenslexikon", konfidenz: 0.6 };
            raumtreffer = treffer;
          }
        }
      }
      if (!punkt.herkunft.raum) {
        for (const gruppe of [punkt.mittelgruppe, punkt.hauptgruppe]) {
          if (!gruppe || ausserBetrieb(gruppe, regeln)) continue;
          if (woerterVon(gruppe).length > 1 && raumAusLexikon(gruppe, regeln)) {
            const mehrfach = regeln.raumphrasen.filter(p => enthaeltPhrase(gruppe, p));
            const ziele = new Set(mehrfach.map(p => strukturraumZu(p, kandidaten) || p));
            if (ziele.size > 1) continue;
          }
          let treffer2 = erkenneRaum(gruppe, kandidaten, regeln);
          if (!treffer2) {
            const lex = raumAusLexikon(gruppe, regeln);
            if (lex) {
              treffer2 = strukturraumZu(lex, kandidaten) ||
                (unbekanntesFolgewort(gruppe, lex, regeln) ? null : lex);
            }
          }
          if (treffer2) {
            punkt.herkunft.raum = { wert: treffer2, quelle: "ga-hierarchie", konfidenz: 0.65 };
            raumtreffer = treffer2;
            break;
          }
        }
      }
    }

    if (!punkt.herkunft.rolle) {
      let rolle = erkenneRolle(woerter, regeln);
      if (rolle) {
        punkt.herkunft.rolle = { wert: rolle, quelle: "namenslexikon", konfidenz: 0.7 };
      } else if (punkt.mittelgruppe) {
        rolle = erkenneRolle(woerterVon(punkt.mittelgruppe), regeln);
        if (rolle) punkt.herkunft.rolle = { wert: rolle, quelle: "ga-hierarchie", konfidenz: 0.5 };
      }
    }

    if (!punkt.herkunft.funktion) {
      const quelle = punkt.beschreibung || punkt.name;
      let liste = woerterVon(quelle);
      if (raumtreffer) {
        const rw = woerterVon(raumtreffer);
        let entfernt = false;
        for (let s = 0; s <= liste.length - rw.length; s++) {
          if (rw.every((w, i) => liste[s + i] === w)) {
            liste.splice(s, rw.length); entfernt = true; break;
          }
        }
        if (!entfernt) liste = liste.filter(w => !rw.includes(w));
      }
      const stopp = new Set([...regeln.status, ...regeln.aktion, ...regeln.event,
        ...regeln.mehrdeutig, "zentral", "central"]);
      const rest = liste.filter(w => !stopp.has(w)).join(" ");
      if (rest) punkt.herkunft.funktion = { wert: rest, quelle: "namenslexikon", konfidenz: 0.5 };
    }

    if (!punkt.herkunft.dpt) {
      let dpt = erkenneDpt(woerter, regeln);
      if (dpt) {
        punkt.herkunft.dpt = { wert: dpt, quelle: "namenslexikon", konfidenz: 0.4 };
      } else if (punkt.mittelgruppe) {
        dpt = erkenneDpt(woerterVon(punkt.mittelgruppe), regeln);
        if (dpt) punkt.herkunft.dpt = { wert: dpt, quelle: "ga-hierarchie", konfidenz: 0.35 };
      }
      if (punkt.herkunft.dpt) punkt.dpt = punkt.herkunft.dpt.wert;
    }
  });

  return { punkte: Object.values(punkte).sort((a, b) => a.ga - b.ga), hinweise };
}

/* ---- Vorbelegung und Bundle-Format ---- */

const STANDARD_OPS = {
  "property|true": ["readproperty", "observeproperty"],
  "property|false": ["readproperty", "writeproperty", "observeproperty"],
  "action|true": ["invokeaction"],
  "action|false": ["invokeaction"],
  "event|true": ["subscribeevent"],
  "event|false": ["subscribeevent"],
};

const SEMANTIK_DPST = {
  "DPST-1-18": "saref:Motion", "DPST-1-19": "saref:OpenClose",
  "DPST-9-7": "saref:Humidity", "DPST-9-1": "saref:Temperature",
};
const SEMANTIK_HAUPT = {
  "DPT-1": "saref:OnOffState", "DPT-9": "saref:Temperature",
  "DPT-12": "saref:Energy", "DPT-13": "saref:Energy",
};

function haupttypVon(dptId) {
  const teile = String(dptId || "").split("-");
  return teile.length >= 2 ? "DPT-" + teile[1] : dptId;
}

function semantischerTyp(dptId) {
  if (!dptId) return "";
  return SEMANTIK_DPST[dptId] || SEMANTIK_HAUPT[haupttypVon(dptId)] || "";
}

/* Muss identisch zu zahl_text in src/ets2td/konfigurator/vorbelegung.py bleiben. */
function zahlText(wert) {
  return Number.isInteger(wert) ? String(wert) : String(Math.round(wert * 100) / 100);
}

function wertebereichText(dptId, stammdaten) {
  const info = stammdaten.dpts[dptId];
  if (!info) return "";
  const schema = datenschemaFuer(dptId, stammdaten);
  if (schema && schema.oneOf) return schema.oneOf.length + " Stufen";
  if (schema && (schema.type === "integer" || schema.type === "number")) {
    const grenzen = ["minimum", "maximum"].filter(s => schema[s] !== undefined)
      .map(s => zahlText(schema[s]));
    const spanne = grenzen.join(" bis ");
    return (spanne + " " + (schema.unit || "")).trim() || info.groesse + " Bit";
  }
  const teile = (info.formate || []).map(f => {
    if (f.art === "bit") return `${f.geloescht} oder ${f.gesetzt}`;
    if (f.art === "enum") return f.werte.length + " Stufen";
    return `${f.breite} Bit ${f.einheit}`.trim();
  });
  return teile.join(", ") || info.groesse + " Bit";
}

function stufenFuer(dptId, stammdaten) {
  const info = stammdaten.dpts[dptId];
  if (!info) return [];
  for (const f of info.formate || []) {
    if (f.art === "enum") return f.werte.map(w => ({ wert: w.wert, titel: w.titel }));
    if (f.art === "bit") {
      return [{ wert: false, titel: f.geloescht || "aus" }, { wert: true, titel: f.gesetzt || "ein" }];
    }
  }
  return [];
}

function vorbelegungFuer(punkt, stammdaten) {
  const rolle = punkt.herkunft.rolle ? punkt.herkunft.rolle.wert : "property";
  const dptId = punkt.dpt || "";
  const schema = dptId ? datenschemaFuer(dptId, stammdaten) : null;
  const geschrieben = /^(switch|dimming|move|stop|hvac)/i.test(punkt.knx_rolle || "");
  const nurLesbar = rolle === "property" && !geschrieben;
  const relativ = /(dimming|step|stop|relative)/i.test(punkt.knx_rolle || "");
  return {
    titel: punkt.name || ("GA " + punkt.ga_text),
    beschreibung: punkt.beschreibung || "",
    semantischer_typ: semantischerTyp(dptId),
    rolle,
    readonly: nurLesbar,
    writeonly: false,
    observable: true,
    safe: false,
    idempotent: !relativ,
    synchronous: false,
    datentyp: schema ? (schema.type || "boolean") : "boolean",
    einheit: schema && schema.unit ? schema.unit : "",
    minimum: schema && schema.minimum !== undefined ? schema.minimum : null,
    maximum: schema && schema.maximum !== undefined ? schema.maximum : null,
    multipleof: null,
    maxlength: haupttypVon(dptId) === "DPT-16" ? 14 : null,
    href: "knx://" + punkt.ga_text,
    contenttype: "application/json",
    operationen: (STANDARD_OPS[rolle + "|" + nurLesbar] || ["readproperty"]).slice(),
  };
}

const QUELLEN_TEXT = {
  "ets-semantik": "Semantischer Export", "semantik-zugriff": "Export: Zugriffsflags",
  "semantik-geraetekette": "Export: Geraetestandort",
  "semantik-kommobjekt": "Export: Kommunikationsobjekt",
  "ets-funktion": "ETS-Funktion (Linking)", "ets-attribut": "ETS-Attribut",
  "gebaeudestruktur": "Gebaeudestruktur", "ga-hierarchie": "Gruppenadress-Hierarchie",
  "namenslexikon": "Namensheuristik", "llm": "Sprachmodell",
};

function baueImportProjekt(projekt, stammdaten, abgeleitet, dateiname) {
  const punkte = abgeleitet.punkte.map(p => {
    const info = stammdaten.dpts[p.dpt] || null;
    const herkunft = {};
    ["raum", "funktion", "rolle", "dpt"].forEach(dim => {
      const z = p.herkunft[dim];
      herkunft[dim] = z ? {
        wert: z.wert, quelle: z.quelle,
        quelle_klartext: QUELLEN_TEXT[z.quelle] || z.quelle,
        konfidenz: z.konfidenz,
      } : null;
    });
    return {
      id: "ga-" + p.ga,
      ga: p.ga, ga_text: p.ga_text, name: p.name, beschreibung: p.beschreibung,
      hauptgruppe: p.hauptgruppe, mittelgruppe: p.mittelgruppe,
      knx_rolle: p.knx_rolle, zentral: p.zentral,
      dpt: p.dpt || "",
      dpt_text: info ? info.text : "",
      dpt_name: info ? info.name : "",
      wertebereich: p.dpt ? wertebereichText(p.dpt, stammdaten) : "",
      stufen: p.dpt ? stufenFuer(p.dpt, stammdaten) : [],
      raum: herkunft.raum ? herkunft.raum.wert : "",
      funktion: herkunft.funktion ? herkunft.funktion.wert : "",
      herkunft,
      werte: vorbelegungFuer(p, stammdaten),
    };
  });

  const raeume = {};
  punkte.forEach(p => {
    const raumname = p.raum || "Unzugeordnet";
    const raum = raeume[raumname] ||
      (raeume[raumname] = { id: schluesselAus(raumname), titel: raumname, funktionen: {} });
    const fname = p.funktion || "Ohne Funktion";
    const funktion = raum.funktionen[fname] ||
      (raum.funktionen[fname] = { id: schluesselAus(raumname + "-" + fname), titel: fname, punkte: [] });
    funktion.punkte.push(p.id);
  });
  const baum = Object.values(raeume)
    .sort((a, b) => a.titel.localeCompare(b.titel))
    .map(r => ({ id: r.id, titel: r.titel,
      funktionen: Object.values(r.funktionen).sort((a, b) => a.titel.localeCompare(b.titel)) }));

  const rueckfragen = [];
  punkte.forEach(p => {
    const fehlend = ["raum", "funktion", "rolle", "dpt"]
      .filter(d => !p.herkunft[d] && !(d === "raum" && p.zentral));
    if (!fehlend.length) return;
    rueckfragen.push({
      ga_text: p.ga_text, name: p.name, fehlende_dimensionen: fehlend,
      frage: `Die Gruppenadresse ${p.ga_text} '${p.name}' liess sich nicht vollstaendig aufloesen. ` +
             `Fehlend: ${fehlend.join(", ")}.`,
      vorschlaege: fehlend.includes("raum")
        ? baum.map(r => r.titel).filter(t => t !== "Unzugeordnet").slice(0, 3) : [],
    });
  });

  const abdeckung = {};
  ["raum", "funktion", "rolle", "dpt"].forEach(d => {
    abdeckung[d] = punkte.filter(p => p.herkunft[d]).length;
  });

  return {
    schluessel: "import-" + Date.now(),
    titel: "Importiert",
    untertitel: `${punkte.length} Gruppenadressen, ${projekt.funktionen.length} Funktionen`,
    projekt: projekt.name,
    td_kontext: "https://www.w3.org/2022/wot/td/v1.1",
    vokabular: "https://vw2hwkth76-ai.github.io/ets2td/vokabular#",
    operationen: { property: ["readproperty", "writeproperty", "observeproperty", "unobserveproperty"],
                   action: ["invokeaction", "queryaction", "cancelaction"],
                   event: ["subscribeevent", "unsubscribeevent"] },
    quellen_klartext: QUELLEN_TEXT,
    pfade: { b: { titel: "b", punkte, baum, rueckfragen, hinweise: abgeleitet.hinweise } },
    kennzahlen: {
      quelle: dateiname,
      validierung: "Im Browser erzeugt, Strukturpruefung live",
      abdeckung: { b: abdeckung },
      funktionen: projekt.funktionen.length,
      ga_stil: projekt.stil,
    },
  };
}

async function importiereKnxproj(datei, regeln) {
  const puffer = await datei.arrayBuffer();
  const zip = leseZip(puffer);
  const projektDatei = zip.eintraege.find(e => /^[^/]+\/[Pp]roject\.xml$/.test(e.name));
  const installation = zip.eintraege
    .filter(e => /^[^/]+\/\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!projektDatei || !installation) {
    throw new Error("Das Archiv enthaelt keine ETS-Projektstruktur (project.xml und 0.xml).");
  }
  const masterEintrag = zip.eintraege.find(e => e.name === "knx_master.xml");
  const [projektXml, installationXml, masterXml] = await Promise.all([
    entpacke(zip, projektDatei.name),
    entpacke(zip, installation.name),
    masterEintrag ? entpacke(zip, "knx_master.xml") : Promise.resolve(null),
  ]);
  const stammdaten = liesStammdaten(masterXml);
  const projekt = liesProjekt(projektXml, installationXml, stammdaten);
  const abgeleitet = leiteAb(projekt, stammdaten, regeln);
  if (!masterXml) {
    abgeleitet.hinweise.unshift(
      "Keine knx_master.xml im Archiv: Wertebereiche und Einheiten fehlen.");
  }
  return baueImportProjekt(projekt, stammdaten, abgeleitet, datei.name);
}
