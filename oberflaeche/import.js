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
    const extra = new Uint8Array(puffer, zeiger + 46 + namenslaenge, extralaenge);
    eintraege.push({ name, methode, flags, komprimiert, versatz, extra });
    zeiger += 46 + namenslaenge + extralaenge + kommentarlaenge;
  }
  return { puffer, sicht, eintraege };
}

const AES_METHODE = 99;
const AES_KENNUNG = 0x9901;
const AES_RUNDEN = 1000;
const SALZLAENGEN = { 1: 8, 2: 12, 3: 16 };
const AES_STAPEL = 256;

class PasswortNoetig extends Error {}
class PasswortFalsch extends Error {}

function rohbytes(zip, eintrag) {
  const kopf = eintrag.versatz;
  const namenslaenge = zip.sicht.getUint16(kopf + 26, true);
  const extralaenge = zip.sicht.getUint16(kopf + 28, true);
  const start = kopf + 30 + namenslaenge + extralaenge;
  return new Uint8Array(zip.puffer, start, eintrag.komprimiert);
}

async function blase(roh) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Dieser Browser kann kein ZIP entpacken. Bitte Chrome, Edge oder Safari nutzen.");
  }
  const strom = new Blob([roh]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

function aesAngaben(eintrag) {
  const sicht = new DataView(eintrag.extra.buffer, eintrag.extra.byteOffset, eintrag.extra.byteLength);
  let pos = 0;
  while (pos + 4 <= eintrag.extra.byteLength) {
    const kennung = sicht.getUint16(pos, true);
    const laenge = sicht.getUint16(pos + 2, true);
    if (kennung === AES_KENNUNG && laenge >= 7) {
      return { staerke: sicht.getUint8(pos + 8), methode: sicht.getUint16(pos + 9, true) };
    }
    pos += 4 + laenge;
  }
  return null;
}

function gleich(a, b) {
  if (a.length !== b.length) return false;
  let abweichung = 0;
  for (let i = 0; i < a.length; i++) abweichung |= a[i] ^ b[i];
  return abweichung === 0;
}

function zaehlerblock(nummer) {
  // WinZip zaehlt little endian ab 1, WebCrypto kennt nur big endian.
  // Deshalb wird jeder Block einzeln maskiert.
  const block = new Uint8Array(16);
  let rest = nummer;
  for (let i = 0; i < 16 && rest > 0; i++) {
    block[i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  return block;
}

async function aesCtr(schluesselbytes, daten) {
  const schluessel = await crypto.subtle.importKey(
    "raw", schluesselbytes, "AES-CTR", false, ["encrypt"]);
  const leer = new Uint8Array(16);
  const klartext = new Uint8Array(daten.length);
  const bloecke = Math.ceil(daten.length / 16);
  for (let start = 1; start <= bloecke; start += AES_STAPEL) {
    const stapel = [];
    for (let n = start; n < start + AES_STAPEL && n <= bloecke; n++) {
      stapel.push(crypto.subtle.encrypt(
        { name: "AES-CTR", counter: zaehlerblock(n), length: 128 }, schluessel, leer));
    }
    const masken = await Promise.all(stapel);
    masken.forEach((maske, i) => {
      const bytes = new Uint8Array(maske);
      const versatz = (start - 1 + i) * 16;
      for (let j = 0; j < 16 && versatz + j < daten.length; j++) {
        klartext[versatz + j] = daten[versatz + j] ^ bytes[j];
      }
    });
  }
  return klartext;
}

async function entschluessele(eintrag, roh, passwort) {
  if (!crypto.subtle) {
    throw new Error(
      "Passwortgeschützte Projekte brauchen die Web-Crypto-Schnittstelle. " +
      "Die Seite dafür über https oder localhost öffnen, nicht als lokale Datei.");
  }
  const angaben = aesAngaben(eintrag);
  if (!angaben) throw new Error(eintrag.name + " ist verschlüsselt, nennt aber keine AES-Angaben.");
  const salzlaenge = SALZLAENGEN[angaben.staerke];
  if (!salzlaenge) throw new Error("Unbekannte Verschlüsselungsstärke " + angaben.staerke);

  const salz = roh.subarray(0, salzlaenge);
  const pruefwert = roh.subarray(salzlaenge, salzlaenge + 2);
  const nutzdaten = roh.subarray(salzlaenge + 2, roh.length - 10);
  const signatur = roh.subarray(roh.length - 10);

  const basis = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveBits"]);
  const laenge = salzlaenge * 2;
  const abgeleitet = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salz, iterations: AES_RUNDEN, hash: "SHA-1" },
    basis, (2 * laenge + 2) * 8));

  if (!gleich(abgeleitet.subarray(2 * laenge), pruefwert)) {
    throw new PasswortFalsch("Das Projektpasswort passt nicht.");
  }

  const hmacSchluessel = await crypto.subtle.importKey(
    "raw", abgeleitet.subarray(laenge, 2 * laenge),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const gerechnet = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacSchluessel, nutzdaten)).subarray(0, 10);
  if (!gleich(gerechnet, signatur)) {
    throw new Error(eintrag.name + ": Prüfsumme stimmt nicht, das Archiv ist beschädigt.");
  }

  const inhalt = await aesCtr(abgeleitet.subarray(0, laenge), nutzdaten);
  return angaben.methode === 8 ? blase(inhalt) : inhalt;
}

async function entpackeBytes(zip, name, passwort) {
  const eintrag = zip.eintraege.find(e => e.name === name);
  if (!eintrag) return null;
  const geschuetzt = eintrag.methode === AES_METHODE || (eintrag.flags & 0x1);
  const roh = rohbytes(zip, eintrag);
  if (geschuetzt) {
    if (!passwort) throw new PasswortNoetig("Das Projekt ist mit einem Projektpasswort geschützt.");
    return entschluessele(eintrag, roh, passwort);
  }
  if (eintrag.methode === 0) return roh;
  if (eintrag.methode !== 8) throw new Error("Unbekanntes ZIP-Verfahren " + eintrag.methode);
  return blase(roh);
}

async function entpacke(zip, name, passwort) {
  const bytes = await entpackeBytes(zip, name, passwort);
  return bytes === null ? null : new TextDecoder("utf-8").decode(bytes);
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
  if (doc.querySelector("parsererror")) throw new Error("Die Projektdatei ist kein gültiges XML.");

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
  // NFC zuerst, sonst zerfallen von macOS gelieferte Umlaute; danach Akzente entfernen.
  const zusammen = String(text || "").normalize("NFC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  return zusammen.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function woerterVon(text) {
  const n = normalisiere(text);
  return n ? n.split(" ") : [];
}
function wortpaareVon(text) {
  // Verglichen wird normalisiert, ausgegeben wird die Schreibweise aus dem
  // Projekt. Muss zu lexikon.wortpaare passen, der Paritaetstest prueft das.
  // \w ist in JS auf ASCII beschraenkt, deshalb Unicode-Eigenschaften:
  // sonst zerfaellt "Kueche" mit Umlaut in "K" und "che".
  const roh = String(text || "").normalize("NFC").match(/[\p{L}\p{N}\p{M}]+/gu) || [];
  return roh.map(w => [w, normalisiere(w)]).filter(paar => paar[1]);
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

const STAMMFORMEN = {
  schlafen: "schlaf", wohnen: "wohn", kochen: "koch",
  essen: "ess", arbeiten: "arbeit", dusche: "dusch",
};

function strukturraumZu(phrase, kandidaten) {
  const stichwort = normalisiere(phrase);
  const stamm = STAMMFORMEN[stichwort] || stichwort;
  const treffer = new Set(kandidaten.filter(k => k && woerterVon(k)
    .some(w => w === stichwort || w.startsWith(stichwort) || w.startsWith(stamm))));
  return treffer.size === 1 ? [...treffer][0] : null;
}

function ausserBetrieb(text, regeln) {
  // Wortgrenzen, sonst faende "alt" auch "Schalten".
  const woerter = " " + normalisiere(text) + " ";
  return regeln.ausser_betrieb.some(m => woerter.includes(" " + normalisiere(m) + " "));
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
      lesbar: null,
      schreibbar: null,
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
      let liste = wortpaareVon(quelle);
      if (raumtreffer) {
        const rw = woerterVon(raumtreffer);
        let entfernt = false;
        for (let s = 0; s <= liste.length - rw.length; s++) {
          if (rw.every((w, i) => liste[s + i][1] === w)) {
            liste.splice(s, rw.length); entfernt = true; break;
          }
        }
        if (!entfernt) liste = liste.filter(paar => !rw.includes(paar[1]));
      }
      const stopp = new Set([...regeln.status, ...regeln.aktion, ...regeln.event,
        ...regeln.mehrdeutig, "zentral", "central"]);
      const rest = liste.filter(paar => !stopp.has(paar[1])).map(paar => paar[0]).join(" ");
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

  Object.values(punkte).forEach(setzeZugriff);
  return { punkte: Object.values(punkte).sort((a, b) => a.ga - b.ga), hinweise };
}

/* Muss zu _setze_zugriff in src/ets2td/pfad_b/ableitung.py passen. */
function setzeZugriff(punkt) {
  const rolle = punkt.herkunft.rolle ? punkt.herkunft.rolle.wert : null;
  if (!rolle) return;
  if (rolle === "action") { punkt.schreibbar = true; punkt.lesbar = false; }
  else { punkt.lesbar = true; punkt.schreibbar = false; }
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

/* Muss zu STANDARD_OPERATIONEN und _operationen in Python passen. */
function operationenFuer(rolle, nurLesbar, nurSchreibbar) {
  if (rolle === "action") return ["invokeaction"];
  if (rolle === "event") return ["subscribeevent"];
  if (nurSchreibbar) return ["writeproperty"];
  if (nurLesbar) return ["readproperty", "observeproperty"];
  return ["readproperty", "writeproperty", "observeproperty"];
}

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
  const istProperty = rolle === "property";
  const nurLesbar = istProperty && punkt.lesbar === true && punkt.schreibbar !== true;
  const nurSchreibbar = istProperty && punkt.schreibbar === true && punkt.lesbar !== true;
  const relativ = /(dimming|step|stop|relative)/i.test(punkt.knx_rolle || "");
  return {
    titel: punkt.name || ("GA " + punkt.ga_text),
    beschreibung: punkt.beschreibung || "",
    semantischer_typ: semantischerTyp(dptId),
    rolle,
    readonly: nurLesbar,
    writeonly: nurSchreibbar,
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
    operationen: operationenFuer(rolle, nurLesbar, nurSchreibbar),
  };
}

const QUELLEN_TEXT = {
  "ets-semantik": "Semantischer Export", "semantik-zugriff": "Export: Zugriffsflags",
  "semantik-geraetekette": "Export: Gerätestandort",
  "semantik-kommobjekt": "Export: Kommunikationsobjekt",
  "ets-funktion": "ETS-Funktion (Linking)", "ets-attribut": "ETS-Attribut",
  "gebaeudestruktur": "Gebäudestruktur", "ga-hierarchie": "Gruppenadress-Hierarchie",
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
      schema: p.dpt ? datenschemaFuer(p.dpt, stammdaten) : null,
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
      frage: `Die Gruppenadresse ${p.ga_text} '${p.name}' ließ sich nicht vollständig auflösen. ` +
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
      validierung: "Im Browser erzeugt, Strukturprüfung live",
      abdeckung: { b: abdeckung },
      funktionen: projekt.funktionen.length,
      ga_stil: projekt.stil,
    },
  };
}

const PROJEKT_XML = /(?:^|\/)[Pp]roject\.xml$/;
const INSTALLATION_XML = /(?:^|\/)\d+\.xml$/;
const INNERES_ARCHIV = /^P-[0-9A-Fa-f]+\.zip$/;

async function oeffneProjektarchiv(zip) {
  // Die ETS legt project.xml und 0.xml entweder in einen Ordner P-XXXX oder
  // in ein eigenes Archiv P-XXXX.zip darin. Die zweite Form ist der
  // Regelfall, sobald ein Projektpasswort gesetzt ist.
  if (zip.eintraege.some(e => PROJEKT_XML.test(e.name))) return zip;
  const innen = zip.eintraege.filter(e => INNERES_ARCHIV.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!innen) {
    throw new Error("Das Archiv enthält keine ETS-Projektstruktur (project.xml und 0.xml).");
  }
  let inhalt;
  try {
    inhalt = await entpackeBytes(zip, innen.name, null);
  } catch (fehler) {
    throw new Error(innen.name + " lässt sich nicht auspacken: " + fehler.message +
      ". Das Archiv ist vermutlich beschädigt, bitte in der ETS neu exportieren.");
  }
  const kopie = inhalt.buffer.slice(inhalt.byteOffset, inhalt.byteOffset + inhalt.byteLength);
  return leseZip(kopie);
}

function brauchtPasswort(zip) {
  return zip.eintraege.some(e =>
    (PROJEKT_XML.test(e.name) || INSTALLATION_XML.test(e.name)) &&
    (e.methode === AES_METHODE || (e.flags & 0x1)));
}

async function importiereKnxproj(datei, regeln, passwort) {
  const puffer = await datei.arrayBuffer();
  const aussen = leseZip(puffer);
  const zip = await oeffneProjektarchiv(aussen);
  const projektDatei = zip.eintraege.find(e => PROJEKT_XML.test(e.name));
  const installation = zip.eintraege
    .filter(e => INSTALLATION_XML.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!projektDatei || !installation) {
    throw new Error("Das Archiv enthält keine ETS-Projektstruktur (project.xml und 0.xml).");
  }
  if (!passwort && brauchtPasswort(zip)) {
    throw new PasswortNoetig("Das Projekt ist mit einem Projektpasswort geschützt.");
  }
  const masterZip = aussen.eintraege.some(e => e.name === "knx_master.xml") ? aussen : zip;
  const masterEintrag = masterZip.eintraege.find(e => e.name === "knx_master.xml");
  const [projektXml, installationXml, masterXml] = await Promise.all([
    entpacke(zip, projektDatei.name, passwort),
    entpacke(zip, installation.name, passwort),
    masterEintrag ? entpacke(masterZip, "knx_master.xml", passwort) : Promise.resolve(null),
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
