import { Button, ComboBox, Search, Select, SelectItem } from "@carbon/react";
import { type ReactNode, useMemo, useState } from "react";
import { TRADE_LABEL } from "../../../src/app/labels.ts";
import { DIMENSIONS, type GaView as GaRow } from "../../../src/app/snapshot.ts";
import { TRADES } from "../../../src/recognize/lexicon.ts";
import { DecisionValue, decisionTitle } from "../components/DecisionValue.tsx";
import { type Option, useOptions, ValuePicker } from "../components/ValuePicker.tsx";
import { type Column, VirtualTable } from "../components/VirtualTable.tsx";
import { count, strengthOf } from "../format.ts";
import { useWorkspace } from "../workspace.ts";
import { GaInspector } from "./GaInspector.tsx";

type StateFilter = "alle" | "fragen" | "widerspruch" | "unsicher" | "bestaetigt" | "unbestaetigt";

const STATE_FILTERS: readonly { readonly value: StateFilter; readonly label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "fragen", label: "Mit Rückfrage" },
  { value: "widerspruch", label: "Mit Widerspruch" },
  { value: "unsicher", label: "Offen oder schwach belegt" },
  { value: "bestaetigt", label: "Bestätigt" },
  { value: "unbestaetigt", label: "Nicht bestätigt" },
];

const BATCH_LABEL = { room: "Raum setzen", trade: "Gewerk setzen", direction: "Richtung setzen" } as const;

const NO_ROOM: Option = { value: "", label: "Ohne Raum" };

function sortValue(ga: GaRow, dimension: (typeof DIMENSIONS)[number]): string {
  return ga.decisions[dimension]?.display ?? "￿";
}

const COLUMNS: readonly Column<GaRow>[] = [
  { id: "ga", header: "GA", width: "6.5rem", sort: (ga) => ga.address, cell: (ga) => <span className="mono">{ga.text}</span>, primary: true },
  {
    id: "name",
    header: "Name",
    sort: (ga) => ga.name,
    cell: (ga) => ga.name || <span className="ws-none">ohne Namen</span>,
    title: (ga) => [ga.name, ...ga.ranges].join("\n"),
  },
  {
    id: "room",
    header: "Raum",
    width: "12%",
    sort: (ga) => sortValue(ga, "room"),
    cell: (ga) => <DecisionValue decision={ga.decisions.room} />,
    title: (ga) => decisionTitle(ga.decisions.room),
  },
  {
    id: "trade",
    header: "Gewerk",
    width: "10%",
    sort: (ga) => sortValue(ga, "trade"),
    cell: (ga) => <DecisionValue decision={ga.decisions.trade} />,
    title: (ga) => decisionTitle(ga.decisions.trade),
  },
  {
    id: "direction",
    header: "Richtung",
    width: "9rem",
    sort: (ga) => sortValue(ga, "direction"),
    cell: (ga) => <DecisionValue decision={ga.decisions.direction} />,
    title: (ga) => decisionTitle(ga.decisions.direction),
  },
  {
    id: "dpt",
    header: "DPT",
    width: "14%",
    sort: (ga) => sortValue(ga, "dpt"),
    cell: (ga) => <DecisionValue decision={ga.decisions.dpt} />,
    title: (ga) => decisionTitle(ga.decisions.dpt),
  },
  {
    id: "thing",
    header: "Thing",
    width: "13%",
    sort: (ga) => ga.thingLabel,
    cell: (ga) => ga.thingLabel,
    title: (ga) => [ga.thingLabel, ga.role].filter(Boolean).join("\n"),
  },
  {
    id: "questions",
    header: "Fragen",
    width: "5rem",
    sort: (ga) => -ga.questionIds.length,
    cell: (ga) => (ga.questionIds.length > 0 ? count(ga.questionIds.length) : ""),
  },
];

/** Mit offenem Inspektor genuegen die Spalten, die man beim Pruefen vergleicht; DPT und Thing stehen im Inspektor. */
const COMPACT_WIDTH: Readonly<Record<string, string | undefined>> = { ga: "5.5rem", name: "28%", room: "20%", trade: "16%", direction: undefined };
const COMPACT_COLUMNS: readonly Column<GaRow>[] = COLUMNS.filter((column) => Object.hasOwn(COMPACT_WIDTH, column.id)).map((column) => {
  const width = COMPACT_WIDTH[column.id];
  const { width: _ignored, ...rest } = column;
  return width === undefined ? rest : { ...rest, width };
});

export function GaView(): ReactNode {
  const workspace = useWorkspace();
  const { snapshot, lookups, state } = workspace;
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("alle");
  const [trade, setTrade] = useState("");
  const [room, setRoom] = useState<Option | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const rooms = useOptions("room");

  const rows = useMemo(() => {
    const words = query.toLocaleLowerCase("de").split(/\s+/).filter(Boolean);
    return snapshot.gas.filter((ga) => {
      if (words.length > 0) {
        const haystack = `${ga.text} ${ga.name} ${ga.ranges.join(" ")} ${ga.thingLabel}`.toLocaleLowerCase("de");
        if (!words.every((word) => haystack.includes(word))) return false;
      }
      if (trade !== "" && (trade === "-" ? ga.decisions.trade !== undefined : ga.decisions.trade?.value !== trade)) return false;
      if (room && (room.value === "" ? ga.decisions.room !== undefined : ga.decisions.room?.value !== room.value)) return false;
      const reviewed = state.reviews[ga.id] !== undefined;
      switch (stateFilter) {
        case "alle":
          return true;
        case "fragen":
          return ga.questionIds.length > 0;
        case "widerspruch":
          return DIMENSIONS.some((dimension) => ga.decisions[dimension]?.conflict !== undefined);
        case "unsicher":
          return DIMENSIONS.some((dimension) => {
            const decision = ga.decisions[dimension];
            return !decision || strengthOf(decision.source, decision.confidence) === 1;
          });
        case "bestaetigt":
          return reviewed;
        case "unbestaetigt":
          return !reviewed;
      }
    });
  }, [snapshot, query, trade, room, stateFilter, state.reviews]);

  const active = workspace.focusGa !== undefined ? lookups.gaById.get(workspace.focusGa) : undefined;
  const selectedIds = [...selected].filter((id) => lookups.gaById.has(id));

  return (
    <div className="ws-split">
      <div className="ws-split__main">
        <header className="ws-page-header" style={{ marginBottom: "1rem" }}>
          <div>
            <h1>Gruppenadressen</h1>
          </div>
        </header>
        <div className="ws-toolbar" role="search">
          <div className="ws-toolbar__search">
            <Search
              size="md"
              labelText="Suche"
              placeholder="GA, Name, Gruppenbereich oder Thing"
              value={query}
              onChange={(event) => setQuery(typeof event === "string" ? event : event.target.value)}
              closeButtonLabelText="Suche leeren"
            />
          </div>
          <div className="ws-toolbar__filter">
            <Select
              id="filter-zustand"
              size="md"
              labelText="Zustand"
              hideLabel
              value={stateFilter}
              onChange={(event) => setStateFilter(parseState(event.target.value))}
            >
              {STATE_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value} text={option.label} />
              ))}
            </Select>
          </div>
          <div className="ws-toolbar__filter">
            <Select id="filter-gewerk" size="md" labelText="Gewerk" hideLabel value={trade} onChange={(event) => setTrade(event.target.value)}>
              <SelectItem value="" text="Alle Gewerke" />
              {TRADES.map((value) => (
                <SelectItem key={value} value={value} text={TRADE_LABEL[value]} />
              ))}
              <SelectItem value="-" text="Ohne Gewerk" />
            </Select>
          </div>
          <div className="ws-toolbar__filter" style={{ flexBasis: "16rem" }}>
            <ComboBox<Option>
              id="filter-raum"
              size="md"
              aria-label="Raum"
              placeholder="Alle Räume"
              items={[NO_ROOM, ...rooms]}
              itemToString={(item) => item?.label ?? ""}
              selectedItem={room}
              shouldFilterItem={({ item, inputValue }) => !inputValue || item.label.toLocaleLowerCase("de").includes(inputValue.toLocaleLowerCase("de"))}
              onChange={({ selectedItem }) => setRoom(selectedItem ?? null)}
            />
          </div>
          <span className="ws-toolbar__count" aria-live="polite">
            {rows.length === snapshot.gas.length ? `${count(rows.length)} GAs` : `${count(rows.length)} von ${count(snapshot.gas.length)}`}
          </span>
        </div>

        {selectedIds.length > 0 ? (
          <div className="ws-batch" role="toolbar" aria-label="Sammelaktionen">
            <span className="ws-batch__count">{count(selectedIds.length)} ausgewählt</span>
            {(["room", "trade", "direction"] as const).map((dimension) => (
              <ValuePicker
                key={dimension}
                id={`batch-${dimension}`}
                dimension={dimension}
                label={BATCH_LABEL[dimension]}
                placeholder={BATCH_LABEL[dimension]}
                hideLabel
                value={undefined}
                onChange={(value) => workspace.setReview(selectedIds, dimension, value)}
              />
            ))}
            <Button kind="primary" size="sm" onClick={() => workspace.confirmCurrent(selectedIds)}>
              Werte bestätigen
            </Button>
            <Button kind="secondary" size="sm" onClick={() => workspace.clearReviews(selectedIds)}>
              Bestätigungen entfernen
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setSelected(new Set())} style={{ color: "inherit" }}>
              Auswahl aufheben
            </Button>
          </div>
        ) : null}

        <VirtualTable<GaRow>
          label="Gruppenadressen"
          rows={rows}
          columns={active ? COMPACT_COLUMNS : COLUMNS}
          rowId={(ga) => ga.id}
          activeId={active?.id}
          onActivate={(ga) => workspace.openGa(ga.id)}
          selection={{ selected, onChange: setSelected }}
          initialSort={{ id: "ga", desc: false }}
          muted={(ga) => ga.outOfUse}
          empty={
            <div className="ws-empty">
              <h3>Keine Gruppenadresse passt</h3>
              <p>Suche oder Filter lockern.</p>
            </div>
          }
        />
        <p className="helper" style={{ padding: "0.5rem 0 1rem" }}>
          Balken zeigen die Belegstärke, das Häkchen eine Bestätigung, das Warnzeichen einen Widerspruch. Leertaste wählt die aktive Zeile aus, Umschalt
          erweitert die Auswahl.
        </p>
      </div>
      {active ? (
        <aside
          className="ws-split__aside"
          aria-label={`Gruppenadresse ${active.text}`}
          onKeyDown={(event) => event.key === "Escape" && workspace.openGa(undefined)}
        >
          <GaInspector ga={active} onClose={() => workspace.openGa(undefined)} />
        </aside>
      ) : null}
    </div>
  );
}

function parseState(value: string): StateFilter {
  return STATE_FILTERS.find((option) => option.value === value)?.value ?? "alle";
}
