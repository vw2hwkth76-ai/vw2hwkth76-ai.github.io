import { ComboBox, Select, SelectItem } from "@carbon/react";
import { type ReactNode, useMemo } from "react";
import { DIRECTION_LABEL, TRADE_LABEL } from "../../../src/app/labels.ts";
import type { ClaimDimension } from "../../../src/recognize/claims.ts";
import { TRADES } from "../../../src/recognize/lexicon.ts";
import { useWorkspace } from "../workspace.ts";

export interface Option {
  readonly value: string;
  readonly label: string;
}

const COLLATOR = new Intl.Collator("de", { numeric: true });

export function useOptions(dimension: ClaimDimension): readonly Option[] {
  const { snapshot } = useWorkspace();
  return useMemo(() => {
    switch (dimension) {
      case "room": {
        // Der Projektknoten steht vor jedem Pfad und traegt nichts zur Unterscheidung bei.
        const prefix = `${snapshot.project.name} / `;
        return snapshot.spaces
          .map((space) => ({ value: space.id, label: (space.path.startsWith(prefix) ? space.path.slice(prefix.length) : space.path) || space.name }))
          .sort((a, b) => COLLATOR.compare(a.label, b.label));
      }
      case "trade":
        return TRADES.map((trade) => ({ value: trade, label: TRADE_LABEL[trade] }));
      case "direction":
        return Object.entries(DIRECTION_LABEL).map(([value, label]) => ({ value, label }));
      case "dpt":
        return snapshot.dpts.map((dpt) => ({ value: dpt.value, label: dpt.display })).sort((a, b) => COLLATOR.compare(a.label, b.label));
    }
  }, [dimension, snapshot]);
}

interface Props {
  readonly id: string;
  readonly dimension: ClaimDimension;
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
  readonly hideLabel?: boolean;
}

/** Auswahl eines Werts fuer eine Antwort; Raum und DPT mit Suche, der Rest als Liste. */
export function ValuePicker(props: Props): ReactNode {
  const options = useOptions(props.dimension);
  if (props.dimension === "room" || props.dimension === "dpt") {
    const selected = options.find((option) => option.value === props.value) ?? null;
    return (
      <ComboBox<Option>
        id={props.id}
        size="sm"
        titleText={props.hideLabel ? undefined : props.label}
        aria-label={props.label}
        placeholder={props.dimension === "room" ? "Raum suchen" : "DPT suchen"}
        items={[...options]}
        itemToString={(item) => item?.label ?? ""}
        selectedItem={selected}
        shouldFilterItem={({ item, inputValue }) => matches(item.label, inputValue)}
        onChange={({ selectedItem }) => {
          if (selectedItem) props.onChange(selectedItem.value);
        }}
      />
    );
  }
  return (
    <Select
      id={props.id}
      size="sm"
      labelText={props.label}
      hideLabel={props.hideLabel === true}
      value={props.value ?? ""}
      onChange={(event) => {
        if (event.target.value !== "") props.onChange(event.target.value);
      }}
    >
      <SelectItem value="" text="Wählen" disabled />
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value} text={option.label} />
      ))}
    </Select>
  );
}

function matches(label: string, input: string | null): boolean {
  if (!input) return true;
  const haystack = label.toLocaleLowerCase("de");
  return input
    .toLocaleLowerCase("de")
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
}
