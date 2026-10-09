import { dptMainNumber } from "../ets/dpt-id.ts";

/**
 * Datenpunkttyp aus Groesse und Text der verknuepften Kommunikationsobjekte.
 *
 * Aeltere Herstellerdaten (EIS-Zeit, ETS3) tragen keinen DPT am Objekt, aber
 * immer die Objektgroesse und einen Funktionstext. Die Groesse legt die
 * Kodierung oft schon eindeutig fest (1 Bit ist immer DPT 1), der Text den
 * Untertyp. Jede Regel prueft die Groesse; ein Text allein entscheidet nie.
 */

/** Ein verknuepftes Kommunikationsobjekt, soweit es fuer den DPT zaehlt. */
export interface ObjectInfo {
  /** Objekt- und Funktionstext, deutsch und englisch, klein geschrieben. */
  readonly text: string;
  /** Anzeigename fuer die Begruendung. */
  readonly label: string;
  /** Aktorobjekte bestimmen die Bedeutung, wenn Taster und Aktor denselben Wert verschieden beschreiben. */
  readonly actuator: boolean;
}

export interface ObjectDpt {
  readonly value: string;
  readonly confidence: number;
  readonly evidence: string;
}

interface TextRule {
  readonly bits: number;
  readonly pattern: RegExp;
  readonly dpt: string;
  /** Allgemeine Funktion ("Schalten" eines Binaereingangs): Ein passender Begriff im Namen sagt mehr. */
  readonly generic?: boolean;
}

/**
 * Spezifisch vor allgemein: Die erste passende Regel je Objekt gilt. Fenster
 * und Tuer fehlen bewusst, weil Kanalnamen sie oft enthalten ("row2_window").
 */
const TEXT_RULES: readonly TextRule[] = [
  { bits: 1, pattern: /(failure|fault|error|alarm|short circuit|st(ö|oe)rung|fehler|ausfall|kurzschluss)/, dpt: "DPST-1-5" },
  { bits: 1, pattern: /(disable|enable|block|sperr|freigab)/, dpt: "DPST-1-3" },
  { bits: 1, pattern: /(presence|occupan|occupied|pr(ä|ae)senz|anwesenheit|belegung)/, dpt: "DPST-1-18" },
  { bits: 1, pattern: /(heating\s*\/\s*cooling|heat\s*\/\s*cool|heizen\s*\/\s*k(ü|ue)hlen)/, dpt: "DPST-1-100" },
  { bits: 1, pattern: /(up\s*\/\s*down|auf\s*\/\s*ab|move|long[- ]time|langzeit)/, dpt: "DPST-1-8" },
  { bits: 1, pattern: /(stop|step|slat|lamell|short[- ]time|kurzzeit)/, dpt: "DPST-1-7" },
  { bits: 1, pattern: /(switch|on\s*\/\s*off|ein\s*\/\s*aus|schalt)/, dpt: "DPST-1-1", generic: true },
  { bits: 4, pattern: /(blind|shutter|jalousie|rollladen|lamell)/, dpt: "DPST-3-8" },
  { bits: 4, pattern: /(dimm|brighter|darker|heller|dunkler)/, dpt: "DPST-3-7" },
  { bits: 8, pattern: /(scene control|szenensteuerung|learn|lernen)/, dpt: "DPST-18-1" },
  { bits: 8, pattern: /(scene|szene)/, dpt: "DPST-17-1" },
  { bits: 8, pattern: /(hvac|operating mode|operation mode|betriebsart|betriebsmodus)/, dpt: "DPST-20-102" },
  { bits: 8, pattern: /(dimming value|dimmwert|brightness value|helligkeitswert|percent|prozent|position|control value|stellgr(ö|oe)|stellwert)/, dpt: "DPST-5-1" },
  { bits: 16, pattern: /(temperatur|setpoint|sollwert)/, dpt: "DPST-9-1" },
  { bits: 16, pattern: /(brightness|helligkeit|\blux\b|illuminan)/, dpt: "DPST-9-4" },
  { bits: 16, pattern: /(wind speed|windgeschwindigkeit)/, dpt: "DPST-9-5" },
  { bits: 16, pattern: /(humidity|feuchte)/, dpt: "DPST-9-7" },
  { bits: 16, pattern: /(co2|ppm|air quality|luftqualit)/, dpt: "DPST-9-8" },
  { bits: 16, pattern: /(physical value|physikalisch|float|gleitkomma)/, dpt: "DPT-9" },
  { bits: 16, pattern: /(counter|z(ä|ae)hl|impuls|pulse)/, dpt: "DPT-7" },
  { bits: 24, pattern: /(date|datum)/, dpt: "DPST-11-1" },
  { bits: 24, pattern: /(time|uhrzeit|zeit)/, dpt: "DPST-10-1" },
  { bits: 24, pattern: /\brgb\b/, dpt: "DPST-232-600" },
  { bits: 32, pattern: /(active energy|wirkarbeit|wirkenergie|\bkwh\b|\bwh\b)/, dpt: "DPST-13-10" },
  { bits: 32, pattern: /(counter|z(ä|ae)hl|impuls|pulse)/, dpt: "DPST-12-1" },
  { bits: 32, pattern: /(power|leistung)/, dpt: "DPST-14-56" },
  { bits: 32, pattern: /(float|gleitkomma)/, dpt: "DPT-14" },
];

/**
 * EIS-Bezeichnungen aus der Zeit vor den DPTs, wie sie in alten Objekttexten
 * stehen ("detector, EIS 1"). Je Groesse, weil EIS 2 mehrere Objekte umfasst.
 */
const EIS: Readonly<Record<number, Readonly<Record<number, string>>>> = {
  1: { 1: "DPT-1" },
  2: { 1: "DPT-1", 4: "DPST-3-7", 8: "DPST-5-1" },
  3: { 24: "DPST-10-1" },
  4: { 24: "DPST-11-1" },
  5: { 16: "DPT-9" },
  6: { 8: "DPST-5-1" },
  7: { 1: "DPT-1", 4: "DPST-3-8" },
  8: { 2: "DPT-2" },
  9: { 32: "DPT-14" },
  10: { 16: "DPT-7" },
  11: { 32: "DPT-12" },
  13: { 8: "DPT-4" },
  14: { 8: "DPT-5" },
  15: { 112: "DPST-16-0" },
};

/** Groessen, die genau einen Haupttyp zulassen. */
const UNIQUE_BY_SIZE: Readonly<Record<number, string>> = {
  1: "DPT-1",
  2: "DPT-2",
  4: "DPT-3",
  64: "DPST-19-1",
  112: "DPST-16-0",
};

const TEXT_CONFIDENCE = 0.85;
const EIS_CONFIDENCE = 0.8;
const SIZE_CONFIDENCE = 0.8;
/** 1 Byte ist meist DPT 5, kann aber auch DPT 6, 17 oder 20 sein: nur als schwacher Vorschlag unter der Konfliktschwelle. */
const BYTE_DEFAULT_CONFIDENCE = 0.55;

interface Match {
  readonly object: ObjectInfo;
  readonly dpt: string;
  readonly kind: "text" | "eis";
  readonly generic: boolean;
}

function matchObject(object: ObjectInfo, bits: number): Match | undefined {
  const text = object.text;
  if (text === "") return undefined;
  const rule = TEXT_RULES.find((entry) => entry.bits === bits && entry.pattern.test(text));
  if (rule) return { object, dpt: rule.dpt, kind: "text", generic: rule.generic === true };
  const eis = /\beis\s*(\d{1,2})\b/.exec(text);
  const dpt = eis ? EIS[Number(eis[1])]?.[bits] : undefined;
  return dpt ? { object, dpt, kind: "eis", generic: false } : undefined;
}

/**
 * @param sizes Objektgroessen der verknuepften Objekte in Bit.
 * @param hints DPT-Vorschlaege aus Name und Gruppenbereich, beste zuerst; sie
 *   verfeinern einen nur aus der Groesse bekannten Haupttyp.
 */
export function objectDpt(sizes: ReadonlySet<number>, objects: readonly ObjectInfo[], hints: readonly string[]): ObjectDpt | undefined {
  if (sizes.size !== 1) return undefined;
  const bits = [...sizes][0];
  if (bits === undefined) return undefined;

  const matches = objects.flatMap((object) => {
    const match = matchObject(object, bits);
    return match ? [match] : [];
  });
  for (const kind of ["text", "eis"] as const) {
    const all = matches.filter((match) => match.kind === kind);
    if (all.length === 0) continue;
    const fromActuators = all.filter((match) => match.object.actuator);
    const pool = fromActuators.length > 0 ? fromActuators : all;
    const values = [...new Set(pool.map((match) => match.dpt))];
    const confidence = kind === "text" ? TEXT_CONFIDENCE : EIS_CONFIDENCE;
    const where = [...new Set(pool.map((match) => `"${match.object.label}"`))].join(", ");
    const value = values[0];
    if (values.length === 1 && value) {
      // Ein Binaereingang "schaltet" auch bei einer Stoermeldung; dann traegt der Name die Bedeutung.
      const generic = pool.every((match) => match.generic);
      const hint = generic && !hints.includes(value) ? hints.find((dpt) => dptMainNumber(dpt) === dptMainNumber(value)) : undefined;
      if (hint) return { value: hint, confidence, evidence: `Objekttext ${where} bei ${bits} Bit, Untertyp aus dem Namen` };
      return { value, confidence, evidence: `${kind === "text" ? "Objekttext" : "EIS-Angabe"} ${where} bei ${bits} Bit` };
    }
    const mains = new Set(values.map(dptMainNumber));
    const main = [...mains][0];
    if (mains.size === 1 && main !== undefined) {
      return { value: `DPT-${main}`, confidence: confidence - 0.05, evidence: `Objekttexte ${where} bei ${bits} Bit, Untertyp uneinheitlich` };
    }
    return undefined;
  }

  const unique = UNIQUE_BY_SIZE[bits];
  if (unique) {
    const main = dptMainNumber(unique);
    const hint = hints.find((dpt) => dptMainNumber(dpt) === main);
    return {
      value: hint ?? unique,
      confidence: SIZE_CONFIDENCE,
      evidence: hint ? `Objektgröße ${bits} Bit, Untertyp aus dem Namen` : `Objektgröße ${bits} Bit`,
    };
  }
  if (bits === 8 && hints.length === 0) {
    return { value: "DPT-5", confidence: BYTE_DEFAULT_CONFIDENCE, evidence: "Objektgröße 8 Bit, ohne weiteren Hinweis" };
  }
  return undefined;
}
