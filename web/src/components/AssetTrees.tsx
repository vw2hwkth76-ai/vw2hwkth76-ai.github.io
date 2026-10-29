import { Checkmark, ChevronDown, ChevronRight, Close } from "@carbon/icons-react";
import { Button, ContentSwitcher, Search, Switch, Tag } from "@carbon/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Binding, ModelAsset, ModelType } from "../../../src/assets/model.ts";
import type { Subtype } from "../../../src/assets/profile.ts";
import { type Confidence, type Decision, type Decisions, REASONS } from "../../../src/assets/review.ts";
import { count } from "../format.ts";

/**
 * Zwei Baeume, ein Asset: links der Ortsbaum (wo ist es?), rechts der Funktionsbaum (wozu gehoert es?). Ein Klick
 * markiert das Asset in beiden Baeumen, klappt beide Pfade auf und zeigt Typ, Klasse, Attribute und Gruppenadressen.
 */

type TreeKind = "location" | "function";

/** Welche Geraete die Baeume zeigen: alle, nur die noch zu pruefenden mit mittlerer oder niedriger Konfidenz, oder nur Abgelehnte. */
export type ReviewFilter = "all" | "attention" | "rejected";
export const REVIEW_FILTERS: readonly { readonly key: ReviewFilter; readonly label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "attention", label: "Zu prüfen" },
  { key: "rejected", label: "Abgelehnt" },
];

interface Props {
  readonly assets: readonly ModelAsset[];
  readonly types: readonly ModelType[];
  readonly decisions: Decisions;
  readonly onDecide: (id: string, decision: Decision | undefined) => void;
  readonly filter: ReviewFilter;
  readonly onFilter: (filter: ReviewFilter) => void;
}

export const CONFIDENCE_LABEL: Readonly<Record<Confidence, string>> = { high: "hoch", medium: "mittel", low: "niedrig" };
const CONFIDENCE_TAG: Readonly<Record<Confidence, "green" | "warm-gray" | "red">> = { high: "green", medium: "warm-gray", low: "red" };
const BUNDLING_LABEL: Readonly<Record<string, string>> = {
  "ets-function": "ETS-Funktion",
  channel: "Aktorkanal",
  schema: "Namensschema",
  family: "Namensähnlichkeit",
  single: "einzelne Gruppenadresse",
};

const decisionOf = (decisions: Decisions, id: string): Decision | undefined => (Object.hasOwn(decisions, id) ? decisions[id] : undefined);

const SUBTYPE_ORDER: readonly Subtype[] = ["input", "output", "status", "info", "property"];
const SUBTYPE_TAG: Readonly<Record<Subtype, "blue" | "purple" | "green" | "gray" | "warm-gray">> = {
  input: "blue",
  output: "purple",
  status: "green",
  info: "gray",
  property: "warm-gray",
};
const SUBTYPE_HINT: Readonly<Record<Subtype, string>> = {
  input: "Messwert",
  output: "Sollwert, Befehl",
  status: "Zustand",
  info: "statische Info",
  property: "Stammdaten",
};
const KIND_LABEL: Readonly<Record<ModelAsset["kind"], string>> = {
  country: "Land",
  region: "Region",
  site: "Standort",
  space: "Raum",
  system: "System",
  equipment: "Gerät",
};
const TREE_TITLE: Readonly<Record<TreeKind, { readonly title: string; readonly question: string }>> = {
  location: { title: "Ort", question: "Wo ist es?" },
  function: { title: "Funktion", question: "Wozu gehört es?" },
};

const parentIn = (asset: ModelAsset, tree: TreeKind): string | null => (tree === "location" ? asset.parent.location : asset.parent.function);

/** Steht ein Asset im Funktionsbaum? Systeme und alles, was unter einem haengt. */
const inFunctionTree = (asset: ModelAsset): boolean => asset.kind === "system" || asset.parent.function !== null;

const normalize = (text: string): string => text.toLocaleLowerCase("de").normalize("NFKD").replace(/\p{M}/gu, "");

export function AssetTrees({ assets, types, decisions, onDecide, filter, onFilter }: Props): ReactNode {
  const byId = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const typeByKey = useMemo(() => new Map(types.map((type) => [type.key, type])), [types]);
  const children = useMemo(() => {
    const build = (tree: TreeKind): Map<string | null, ModelAsset[]> => {
      const map = new Map<string | null, ModelAsset[]>();
      for (const asset of assets) {
        if (tree === "function" && !inFunctionTree(asset)) continue;
        const key = parentIn(asset, tree);
        const list = map.get(key);
        if (list) list.push(asset);
        else map.set(key, [asset]);
      }
      return map;
    };
    return { location: build("location"), function: build("function") };
  }, [assets]);

  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState("");
  // Anfangs offen: im Ortsbaum bis zum Gebaeude, im Funktionsbaum die Systeme.
  const [open, setOpen] = useState<Record<TreeKind, ReadonlySet<string>>>(() => ({
    location: new Set(assets.filter((asset) => asset.kind !== "space" && asset.kind !== "equipment" && asset.kind !== "system").map((asset) => asset.id)),
    function: new Set(assets.filter((asset) => asset.kind === "system").map((asset) => asset.id)),
  }));

  const ancestors = (id: string, tree: TreeKind): string[] => {
    const chain: string[] = [];
    let current = byId.get(id);
    const seen = new Set<string>();
    while (current) {
      const parent = parentIn(current, tree);
      if (!parent || seen.has(parent)) break;
      seen.add(parent);
      chain.unshift(parent);
      current = byId.get(parent);
    }
    return chain;
  };

  const select = (id: string): void => {
    setSelected(id);
    setOpen((current) => ({
      location: new Set([...current.location, ...ancestors(id, "location")]),
      function: new Set([...current.function, ...ancestors(id, "function")]),
    }));
  };

  const toggle = (tree: TreeKind, id: string): void =>
    setOpen((current) => {
      const next = new Set(current[tree]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [tree]: next };
    });

  // Suche: Treffer und ihre Vorfahren bleiben sichtbar, alles dazwischen ist aufgeklappt.
  const words = normalize(query).split(/\s+/).filter((word) => word !== "");
  const matches = useMemo(() => {
    if (words.length === 0 && filter === "all") return undefined;
    const hits = new Set<string>();
    for (const asset of assets) {
      if (filter !== "all") {
        const decision = decisionOf(decisions, asset.id);
        const wanted = filter === "rejected" ? decision === "rejected" : asset.kind === "equipment" && asset.review !== undefined && asset.review.confidence !== "high" && decision === undefined;
        if (!wanted) continue;
      }
      const cls = typeByKey.get(asset.type)?.class ?? "";
      const haystack = normalize([asset.name, asset.code, asset.type, cls, ...asset.bindings.flatMap((binding) => [binding.attribute, binding.write ?? "", binding.feedback ?? ""])].join(" "));
      if (words.every((word) => haystack.includes(word))) hits.add(asset.id);
    }
    return hits;
    // words ist aus query abgeleitet
  }, [assets, typeByKey, query, filter, decisions]);
  const visible = useMemo(() => {
    if (!matches) return undefined;
    const result: Record<TreeKind, Set<string>> = { location: new Set(), function: new Set() };
    for (const id of matches) {
      for (const tree of ["location", "function"] as const) {
        const asset = byId.get(id);
        if (!asset || (tree === "function" && !inFunctionTree(asset))) continue;
        result[tree].add(id);
        for (const parent of ancestors(id, tree)) result[tree].add(parent);
      }
    }
    return result;
  }, [matches, byId]);

  const containers = { location: useRef<HTMLDivElement>(null), function: useRef<HTMLDivElement>(null) };
  useEffect(() => {
    if (!selected) return;
    for (const ref of [containers.location, containers.function]) {
      const node = ref.current?.querySelector<HTMLElement>(`[data-asset="${CSS.escape(selected)}"]`);
      node?.scrollIntoView({ block: "nearest" });
    }
  }, [selected, open]);

  const renderTree = (tree: TreeKind): ReactNode => {
    const walk = (parent: string | null, depth: number): ReactNode[] =>
      (children[tree].get(parent) ?? [])
        .filter((asset) => !visible || visible[tree].has(asset.id))
        .map((asset) => {
          const kids = (children[tree].get(asset.id) ?? []).filter((child) => !visible || visible[tree].has(child.id));
          const expanded = kids.length > 0 && (visible !== undefined || open[tree].has(asset.id));
          const type = typeByKey.get(asset.type);
          const isSelected = asset.id === selected;
          return (
            <li key={asset.id} role="treeitem" aria-expanded={kids.length > 0 ? expanded : undefined} aria-selected={isSelected} aria-level={depth + 1}>
              <div className={`ws-tree__row${isSelected ? " ws-tree__row--selected" : ""}${matches?.has(asset.id) ? " ws-tree__row--hit" : ""}`} data-asset={asset.id} style={{ paddingLeft: `${depth * 1.1 + 0.25}rem` }}>
                {kids.length > 0 ? (
                  <button type="button" className="ws-tree__toggle" aria-label={expanded ? `${asset.name} zuklappen` : `${asset.name} aufklappen`} onClick={() => toggle(tree, asset.id)} disabled={visible !== undefined}>
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                ) : (
                  <span className="ws-tree__toggle" aria-hidden="true" />
                )}
                <button type="button" className="ws-tree__label" onClick={() => select(asset.id)}>
                  <span className={`ws-tree__dot ws-tree__dot--${asset.kind}`} aria-hidden="true" />
                  <span className={`ws-tree__name${decisionOf(decisions, asset.id) === "rejected" ? " ws-tree__name--rejected" : ""}`}>{asset.name || "ohne Namen"}</span>
                  <span className="ws-tree__class">{type?.class ?? asset.type}</span>
                  {asset.review ? (
                    <span className={`ws-tree__conf ws-tree__conf--${asset.review.confidence}`} title={`Konfidenz ${CONFIDENCE_LABEL[asset.review.confidence]}`}>
                      <span className="cds--visually-hidden">Konfidenz {CONFIDENCE_LABEL[asset.review.confidence]}</span>
                    </span>
                  ) : null}
                  {decisionOf(decisions, asset.id) === "approved" ? <Checkmark size={16} className="ws-tree__approved" aria-label="freigegeben" /> : null}
                  {decisionOf(decisions, asset.id) === "rejected" ? <Close size={16} className="ws-tree__rejected" aria-label="abgelehnt" /> : null}
                  {asset.source.central ? <span className="ws-tree__badge">zentral</span> : null}
                  {kids.length > 0 && !expanded ? <span className="ws-tree__count">{count(kids.length)}</span> : null}
                </button>
              </div>
              {expanded ? (
                <ul role="group" className="ws-tree__list">
                  {walk(asset.id, depth + 1)}
                </ul>
              ) : null}
            </li>
          );
        });
    const roots = walk(null, 0);
    return (
      <section className="ws-tree" aria-labelledby={`tree-${tree}`}>
        <header className="ws-tree__head">
          <h3 id={`tree-${tree}`}>
            {TREE_TITLE[tree].title} <span>· {TREE_TITLE[tree].question}</span>
          </h3>
        </header>
        <div className="ws-tree__scroll" ref={containers[tree]}>
          {roots.length > 0 ? (
            <ul role="tree" aria-labelledby={`tree-${tree}`} className="ws-tree__list">
              {roots}
            </ul>
          ) : (
            <p className="helper ws-tree__empty">{visible ? (filter === "attention" && query.trim() === "" ? "Nichts mehr zu prüfen." : "Kein Treffer in diesem Baum.") : "Leer."}</p>
          )}
        </div>
      </section>
    );
  };

  const active = selected ? byId.get(selected) : undefined;

  return (
    <div className="ws-trees">
      <div className="ws-trees__search">
        <Search
          size="md"
          labelText="Assets suchen"
          placeholder="Name, Kennung, Typ, Klasse, Attribut oder Gruppenadresse"
          value={query}
          onChange={(event) => setQuery(typeof event === "string" ? event : event.target.value)}
          closeButtonLabelText="Suche leeren"
        />
        <ContentSwitcher
          size="md"
          selectedIndex={REVIEW_FILTERS.findIndex((entry) => entry.key === filter)}
          onChange={(event) => {
            const next = REVIEW_FILTERS.find((entry) => entry.key === event.name);
            if (next) onFilter(next.key);
          }}
          aria-label="Geräte filtern"
        >
          {REVIEW_FILTERS.map((entry) => (
            <Switch key={entry.key} name={entry.key} text={entry.label} />
          ))}
        </ContentSwitcher>
        {matches ? (
          <span className="ws-trees__hits" aria-live="polite">
            {count(matches.size)} Treffer
          </span>
        ) : null}
      </div>
      <div className="ws-trees__grid">
        {renderTree("location")}
        {renderTree("function")}
        <AssetPanel asset={active} byId={byId} typeByKey={typeByKey} decision={active ? decisionOf(decisions, active.id) : undefined} onDecide={onDecide} childrenOf={(id, tree) => children[tree].get(id) ?? []} onSelect={select} ancestors={ancestors} />
      </div>
    </div>
  );
}

interface PanelProps {
  readonly asset: ModelAsset | undefined;
  readonly decision: Decision | undefined;
  readonly onDecide: (id: string, decision: Decision | undefined) => void;
  readonly byId: ReadonlyMap<string, ModelAsset>;
  readonly typeByKey: ReadonlyMap<string, ModelType>;
  readonly childrenOf: (id: string, tree: TreeKind) => readonly ModelAsset[];
  readonly onSelect: (id: string) => void;
  readonly ancestors: (id: string, tree: TreeKind) => string[];
}

function AssetPanel({ asset, decision, onDecide, byId, typeByKey, childrenOf, onSelect, ancestors }: PanelProps): ReactNode {
  if (!asset) {
    return (
      <aside className="ws-asset-panel ws-asset-panel--empty" aria-label="Asset">
        <p>Ein Asset in einem der beiden Bäume wählen. Es wird in beiden markiert, und hier stehen Typ, Klasse, Attribute und Gruppenadressen.</p>
        <dl className="ws-asset-panel__legend">
          {SUBTYPE_ORDER.map((subtype) => (
            <div key={subtype}>
              <dt>
                <Tag size="sm" type={SUBTYPE_TAG[subtype]}>
                  {subtype}
                </Tag>
              </dt>
              <dd>{SUBTYPE_HINT[subtype]}</dd>
            </div>
          ))}
        </dl>
      </aside>
    );
  }
  const type = typeByKey.get(asset.type);
  const bindingOf = new Map(asset.bindings.map((binding) => [binding.attribute, binding]));
  const attributes = type?.attributes ?? [];
  const crumbs = (tree: TreeKind): ReactNode => {
    const chain = ancestors(asset.id, tree);
    if (tree === "function" && chain.length === 0 && asset.kind !== "system") return <span className="ws-none">kein Platz im Funktionsbaum</span>;
    return (
      <>
        {chain.map((id) => (
          <span key={id}>
            <button type="button" className="ws-asset-panel__crumb" onClick={() => onSelect(id)}>
              {byId.get(id)?.name ?? id}
            </button>
            <span aria-hidden="true"> › </span>
          </span>
        ))}
        <strong>{asset.name}</strong>
      </>
    );
  };
  const below = (tree: TreeKind): readonly ModelAsset[] => childrenOf(asset.id, tree);

  return (
    <aside className="ws-asset-panel" aria-label={`Asset ${asset.name}`}>
      <div className="ws-asset-panel__head">
        <div>
          <p className="ws-asset-panel__kicker">
            {KIND_LABEL[asset.kind]}
            {asset.source.central ? " · Zentralfunktion" : ""}
          </p>
          <h3>{asset.name || "ohne Namen"}</h3>
          <p className="mono ws-asset-panel__code">{asset.code}</p>
        </div>
        <div className="ws-asset-panel__type">
          <span className="mono">{asset.type}</span>
          <span className="ws-asset-panel__class">→ {type?.class ?? "?"}</span>
          <span className="helper">{type?.origin === "generated" ? "eigener Typ" : type?.extended ? "Profiltyp, erweitert" : "Profiltyp"}</span>
        </div>
      </div>

      {asset.review ? (
        <section className="ws-asset-panel__review" aria-label="Prüfung">
          <div className="ws-asset-panel__review-head">
            <Tag size="sm" type={CONFIDENCE_TAG[asset.review.confidence]}>
              Konfidenz {CONFIDENCE_LABEL[asset.review.confidence]}
            </Tag>
            <span className="helper">Gebündelt über: {BUNDLING_LABEL[asset.review.bundling] ?? asset.review.bundling}</span>
          </div>
          {asset.review.reasons.length > 0 ? (
            <ul className="ws-asset-panel__reasons">
              {asset.review.reasons.map((reason) => (
                <li key={reason}>{REASONS[reason].de}</li>
              ))}
            </ul>
          ) : (
            <p className="helper">Kein Befund: Bündelung durch ETS-Funktion, Aktorkanal oder Namensschema, Typ, Raum und Datenpunkttypen vorhanden.</p>
          )}
          <div className="ws-step__row">
            <Button kind={decision === "approved" ? "primary" : "tertiary"} size="sm" renderIcon={Checkmark} onClick={() => onDecide(asset.id, decision === "approved" ? undefined : "approved")}>
              {decision === "approved" ? "Freigegeben" : "Freigeben"}
            </Button>
            <Button kind={decision === "rejected" ? "danger" : "danger--tertiary"} size="sm" renderIcon={Close} onClick={() => onDecide(asset.id, decision === "rejected" ? undefined : "rejected")}>
              {decision === "rejected" ? "Abgelehnt" : "Ablehnen"}
            </Button>
          </div>
          {decision === "rejected" ? <p className="helper">Dieses Gerät fehlt im ZIP. Erneutes Klicken nimmt die Ablehnung zurück.</p> : null}
        </section>
      ) : null}

      <dl className="ws-asset-panel__paths">
        <div>
          <dt>Ort</dt>
          <dd>{crumbs("location")}</dd>
        </div>
        <div>
          <dt>Funktion</dt>
          <dd>{crumbs("function")}</dd>
        </div>
      </dl>

      {asset.tags.length > 0 ? (
        <div className="ws-asset-panel__tags">
          {asset.tags.map((tag) => (
            <Tag key={tag} size="sm" type="cyan">
              {tag}
            </Tag>
          ))}
        </div>
      ) : null}

      {attributes.length > 0 ? (
        <div className="ws-asset-panel__attributes">
          {SUBTYPE_ORDER.map((subtype) => {
            const list = attributes.filter((attribute) => attribute.subtype === subtype);
            if (list.length === 0) return null;
            return (
              <section key={subtype} aria-label={subtype}>
                <h4>
                  <Tag size="sm" type={SUBTYPE_TAG[subtype]}>
                    {subtype}
                  </Tag>
                  <span>{SUBTYPE_HINT[subtype]}</span>
                </h4>
                <ul>
                  {list.map((attribute) => {
                    const binding = bindingOf.get(attribute.name);
                    return (
                      <li key={attribute.name} className={binding ? undefined : "ws-asset-panel__unbound"}>
                        <span className="mono ws-asset-panel__attr">
                          {attribute.name}
                          {attribute.origin === "extension" ? <span className="ws-asset-panel__ext" title="Vom Export ergänzt, der Typ kennt es nicht"> +</span> : null}
                        </span>
                        <span className="ws-asset-panel__binding">{binding ? <BindingText binding={binding} /> : "nicht belegt"}</span>
                        <span className="ws-asset-panel__unit">{[attribute.unit, binding?.dpt ? `DPT ${binding.dpt}` : attribute.dpt ? `DPT ${attribute.dpt}` : ""].filter(Boolean).join(" · ")}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="helper">Dieser Typ hat keine Attribute.</p>
      )}

      {(["function", "location"] as const).map((tree) => {
        const list = below(tree);
        if (list.length === 0) return null;
        return (
          <div key={tree} className="ws-asset-panel__below">
            <h4>
              {tree === "function" ? (asset.kind === "system" ? "Gehört zu diesem System" : "Steuert") : "Enthält"} ({count(list.length)})
            </h4>
            <ul>
              {list.slice(0, 40).map((child) => (
                <li key={child.id}>
                  <button type="button" className="ws-asset-panel__crumb" onClick={() => onSelect(child.id)}>
                    {child.name}
                  </button>{" "}
                  <span className="helper">{typeByKey.get(child.type)?.class ?? child.type}</span>
                </li>
              ))}
              {list.length > 40 ? <li className="helper">… und {count(list.length - 40)} weitere</li> : null}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}

function BindingText({ binding }: { readonly binding: Binding }): ReactNode {
  return (
    <>
      {binding.write ? (
        <span>
          schreibt <span className="mono">{binding.write}</span>
        </span>
      ) : null}
      {binding.write && binding.feedback ? <span aria-hidden="true"> · </span> : null}
      {binding.feedback ? (
        <span>
          Rückmeldung <span className="mono">{binding.feedback}</span>
        </span>
      ) : null}
      {binding.readable === false ? <span className="helper"> · nicht lesbar</span> : null}
    </>
  );
}
