import type { BundleSource } from "../recognize/recognize.ts";
import type { AssetModel, Binding, Gap, ModelAsset, ModelType } from "./model.ts";

/**
 * Konfidenz und Freigabe je Asset. Die Konfidenz ist keine Wahrscheinlichkeit, sondern eine Einstufung aus Belegen mit
 * genannten Gruenden: Jeder Grund ist ein pruefbarer Befund (keine Raumzuordnung, nur ueber Namen gebuendelt, offene
 * Rueckfrage). Die Freigabe ist die Entscheidung eines Menschen; abgelehnte Assets verlassen den Export.
 */

export type Confidence = "high" | "medium" | "low";
export type Decision = "approved" | "rejected";
/** Entscheidungen je Asset-Id; die Ids sind stabil (UUID v5), die Entscheidungen bleiben ueber Neuberechnungen erhalten. */
export type Decisions = Readonly<Record<string, Decision>>;

export interface AssetReview {
  readonly confidence: Confidence;
  /** Womit die Datenpunkte zum Asset gebuendelt wurden. */
  readonly bundling: BundleSource;
  /** Ids aus REASONS, die die Einstufung begruenden; leer bei hoher Konfidenz. */
  readonly reasons: readonly ReasonId[];
}

export type ReasonId = "no-bindings" | "open-questions" | "no-room" | "single-ga" | "generic-thing" | "name-bundling" | "generated-type" | "unknown-role" | "no-dpt";

interface Reason {
  readonly severity: "low" | "medium";
  readonly en: string;
  readonly de: string;
}

export const REASONS: Readonly<Record<ReasonId, Reason>> = {
  "no-bindings": { severity: "low", en: "No data point could be bound", de: "Kein Datenpunkt konnte gebunden werden" },
  "open-questions": { severity: "low", en: "Open questions about its group addresses", de: "Offene Rückfragen zu den Gruppenadressen" },
  "no-room": { severity: "low", en: "No room found", de: "Kein Raum gefunden" },
  "single-ga": { severity: "medium", en: "Single group address, nothing to bundle", de: "Einzelne Gruppenadresse, nichts zu bündeln" },
  "generic-thing": { severity: "medium", en: "Function not recognized (generic)", de: "Funktion nicht erkannt (allgemein)" },
  "name-bundling": { severity: "medium", en: "Bundled by name similarity", de: "Über Namensähnlichkeit gebündelt" },
  "generated-type": { severity: "medium", en: "No type in the target profile", de: "Kein Typ im Zielprofil" },
  "unknown-role": { severity: "medium", en: "Group addresses without a recognized role", de: "Gruppenadressen ohne erkannte Rolle" },
  "no-dpt": { severity: "medium", en: "Data point type missing", de: "Datenpunkttyp fehlt" },
};

export interface ReviewInput {
  readonly bundling: BundleSource;
  readonly central: boolean;
  readonly thingType: string;
  readonly hasRoom: boolean;
  readonly openQuestions: number;
  /** Nur mit geladenem Zielprofil: Ohne Profil ist jeder Typ erzeugt und das sagt nichts ueber die Zuordnung. */
  readonly noTargetType: boolean;
  readonly bindings: readonly Binding[];
}

/**
 * Hoch: Keine Auffaelligkeit. Niedrig: ein schwerer Grund oder zwei mittlere. Sonst mittel.
 * Die Regel ist absichtlich einfach, damit ein Mensch sie im Kopf nachrechnen kann.
 */
export function assess(input: ReviewInput): AssetReview {
  const reasons: ReasonId[] = [];
  if (input.bindings.length === 0) reasons.push("no-bindings");
  if (input.openQuestions > 0) reasons.push("open-questions");
  if (!input.hasRoom) reasons.push("no-room");
  if (input.thingType === "Generic") reasons.push("generic-thing");
  // Gemessen an den Gold-Standards der Benchmark: ETS-Funktion 100 %, Aktorkanal 98 %, Namensfamilie 86 %, Einzel-GA 50 % richtig.
  // Eine Zentral-GA und ein reiner Messwert (Praesenz, Temperatur) stehen von Natur aus allein; ein Schaltobjekt ohne Rueckmeldung nicht.
  if (input.bundling === "single" && !input.central && input.bindings.some((binding) => binding.subtype !== "input")) reasons.push("single-ga");
  if (input.bundling === "family") reasons.push("name-bundling");
  if (input.noTargetType) reasons.push("generated-type");
  if (input.bindings.some((binding) => binding.role === undefined)) reasons.push("unknown-role");
  if (input.bindings.some((binding) => binding.dpt === undefined)) reasons.push("no-dpt");
  const severe = reasons.filter((reason) => REASONS[reason].severity === "low").length;
  const medium = reasons.length - severe;
  const confidence: Confidence = severe > 0 || medium >= 2 ? "low" : medium === 1 ? "medium" : "high";
  return { confidence, bundling: input.bundling, reasons };
}

export interface ReviewCounts {
  readonly total: number;
  readonly approved: number;
  readonly rejected: number;
  readonly open: number;
  readonly byConfidence: Readonly<Record<Confidence, number>>;
  /** Offen und hohe Konfidenz: kann in einem Schritt freigegeben werden. */
  readonly openHigh: number;
}

/** Nur Geraete tragen eine Einstufung; Raeume, Ebenen und Systeme kommen aus der ETS oder dem Gewerk. */
export const reviewable = (asset: ModelAsset): boolean => asset.kind === "equipment" && asset.review !== undefined;

export function countReview(assets: readonly ModelAsset[], decisions: Decisions): ReviewCounts {
  const byConfidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  let approved = 0;
  let rejected = 0;
  let openHigh = 0;
  let total = 0;
  for (const asset of assets) {
    if (!asset.review || asset.kind !== "equipment") continue;
    total++;
    byConfidence[asset.review.confidence]++;
    const decision = Object.hasOwn(decisions, asset.id) ? decisions[asset.id] : undefined;
    if (decision === "approved") approved++;
    else if (decision === "rejected") rejected++;
    else if (asset.review.confidence === "high") openHigh++;
  }
  return { total, approved, rejected, open: total - approved - rejected, byConfidence, openHigh };
}

export interface ReviewOptions {
  /** Nur ausdruecklich freigegebene Geraete exportieren; sonst fliegen nur die abgelehnten raus. */
  readonly onlyApproved?: boolean;
}

/**
 * Wendet die Entscheidungen auf das Modell an. Abgelehnte (oder bei onlyApproved nicht freigegebene) Geraete
 * entfallen mit ihren Bindungen; was im Funktionsbaum darunter hing, rueckt zum Elternteil des entfernten Assets,
 * und Systeme ohne Inhalt entfallen. Die Luecken bleiben, ergaenzt um einen Hinweis, wie viel entfernt wurde.
 */
export function applyDecisions(model: AssetModel, decisions: Decisions, options: ReviewOptions = {}): AssetModel {
  const decided = (asset: ModelAsset): Decision | undefined => (Object.hasOwn(decisions, asset.id) ? decisions[asset.id] : undefined);
  const dropped = new Set<string>();
  for (const asset of model.assets) {
    if (asset.kind !== "equipment" || !asset.review) continue;
    const decision = decided(asset);
    if (decision === "rejected" || (options.onlyApproved === true && decision !== "approved")) dropped.add(asset.id);
  }
  if (dropped.size === 0) return model;

  const functionParent = new Map(model.assets.map((asset) => [asset.id, asset.parent.function]));
  const surviving = (id: string | null): string | null => {
    let current = id;
    const seen = new Set<string>();
    while (current !== null && dropped.has(current) && !seen.has(current)) {
      seen.add(current);
      current = functionParent.get(current) ?? null;
    }
    return current;
  };
  let assets: ModelAsset[] = model.assets
    .filter((asset) => !dropped.has(asset.id))
    .map((asset) => (asset.parent.function !== null && dropped.has(asset.parent.function) ? { ...asset, parent: { ...asset.parent, function: surviving(asset.parent.function) } } : asset));

  // Systeme, unter denen nichts mehr haengt, sind leer und entfallen (ein Gewerk ohne Assets braucht kein System).
  for (;;) {
    const used = new Set(assets.map((asset) => asset.parent.function).filter((id): id is string => id !== null));
    const next = assets.filter((asset) => asset.kind !== "system" || used.has(asset.id));
    if (next.length === assets.length) break;
    assets = next;
  }

  const counted = new Map<string, number>();
  for (const asset of assets) counted.set(asset.type, (counted.get(asset.type) ?? 0) + 1);
  const types: ModelType[] = model.types.filter((type) => counted.has(type.key)).map((type) => ({ ...type, assets: counted.get(type.key) ?? 0 }));
  const groupAddresses = new Set<string>();
  let bindings = 0;
  for (const asset of assets)
    for (const binding of asset.bindings) {
      bindings++;
      if (binding.write) groupAddresses.add(binding.write);
      if (binding.feedback) groupAddresses.add(binding.feedback);
    }
  const rejected = [...dropped].filter((id) => decisions[id] === "rejected").length;
  const unapproved = dropped.size - rejected;
  const gaps: Gap[] = [
    ...model.gaps,
    ...(rejected > 0
      ? [{ id: "review-rejected", title: "Assets rejected in the review", detail: "A person rejected these assets in the workshop; they are not part of this export. The gap list above was counted on the full model.", action: "info" as const, count: rejected, examples: [] }]
      : []),
    ...(unapproved > 0
      ? [{ id: "review-unapproved", title: "Assets not approved yet", detail: "The export was limited to approved assets; these have no approval and are left out.", action: "info" as const, count: unapproved, examples: [] }]
      : []),
  ];
  return {
    ...model,
    types,
    assets,
    gaps,
    stats: {
      assets: assets.length,
      equipment: assets.filter((asset) => asset.kind === "equipment").length,
      spaces: assets.filter((asset) => asset.kind === "space").length,
      bindings,
      groupAddresses: groupAddresses.size,
      typesFromProfile: types.filter((type) => type.origin === "profile").length,
      typesGenerated: types.filter((type) => type.origin === "generated").length,
      typesExtended: types.filter((type) => type.extended).length,
    },
  };
}

const csvCell = (value: string): string => {
  // Namen kommen aus dem Projekt; ein fuehrendes Formelzeichen darf in der Tabellenkalkulation nichts ausfuehren.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Prueflisten-Datei: je Geraet Konfidenz, Gruende und Entscheidung; die Spur, wer was freigegeben hat, bleibt beim Projekt. */
export function reviewCsv(model: AssetModel, decisions: Decisions): string {
  const header = ["asset_code", "asset_name", "asset_type", "confidence", "bundling", "reasons", "decision"];
  const rows = model.assets
    .filter((asset) => asset.kind === "equipment" && asset.review)
    .map((asset) =>
      [
        asset.code,
        asset.name,
        asset.type,
        asset.review?.confidence ?? "",
        asset.review?.bundling ?? "",
        (asset.review?.reasons ?? []).map((reason) => REASONS[reason].en).join(" | "),
        (Object.hasOwn(decisions, asset.id) ? decisions[asset.id] : undefined) ?? "open",
      ]
        .map(csvCell)
        .join(","),
    );
  return `${[header.join(","), ...rows].join("\n")}\n`;
}
