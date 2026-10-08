import { ArrowDown, ArrowUp, ArrowsVertical } from "@carbon/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

export interface Column<T> {
  readonly id: string;
  readonly header: string;
  /** CSS-Breite der Spalte; ohne Angabe teilt sich die Spalte den Rest. */
  readonly width?: string;
  readonly sort?: (row: T) => string | number;
  readonly cell: (row: T) => ReactNode;
  /** Klartext fuer den Tooltip einer abgeschnittenen Zelle. */
  readonly title?: (row: T) => string | undefined;
  /** Zelle als Schaltflaeche, die die Zeile oeffnet; eine Spalte je Tabelle. */
  readonly primary?: boolean;
}

interface Selection {
  readonly selected: ReadonlySet<string>;
  readonly onChange: (next: ReadonlySet<string>) => void;
}

interface Props<T> {
  readonly label: string;
  readonly rows: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly rowId: (row: T) => string;
  readonly activeId: string | undefined;
  readonly onActivate: (row: T) => void;
  readonly selection?: Selection;
  readonly initialSort?: { readonly id: string; readonly desc: boolean };
  readonly muted?: (row: T) => boolean;
  readonly empty: ReactNode;
}

const ROW_HEIGHT = 32;
const COLLATOR = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

/**
 * Tabelle mit Carbon-Klassen und virtuellem Rendern; traegt auch Projekte
 * mit mehreren tausend GAs. Pfeiltasten bewegen die aktive Zeile,
 * Leertaste waehlt sie fuer Sammelaktionen aus.
 */
export function VirtualTable<T>(props: Props<T>): ReactNode {
  const { rows, columns, rowId, activeId, onActivate, selection } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | undefined>(undefined);
  const [sort, setSort] = useState(props.initialSort);

  const sorted = useMemo(() => {
    const column = sort ? columns.find((candidate) => candidate.id === sort.id) : undefined;
    const key = column?.sort;
    if (!sort || !key) return rows;
    const factor = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = key(a);
      const right = key(b);
      const order = typeof left === "number" && typeof right === "number" ? left - right : COLLATOR.compare(String(left), String(right));
      return order * factor;
    });
  }, [rows, columns, sort]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  const activeIndex = useMemo(() => (activeId === undefined ? -1 : sorted.findIndex((row) => rowId(row) === activeId)), [sorted, activeId, rowId]);

  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);

  const toggle = (index: number, range: boolean): void => {
    if (!selection) return;
    const next = new Set(selection.selected);
    const row = sorted[index];
    if (!row) return;
    const id = rowId(row);
    const on = !next.has(id);
    if (range && anchorRef.current !== undefined) {
      const [from, to] = anchorRef.current < index ? [anchorRef.current, index] : [index, anchorRef.current];
      for (let at = from; at <= to; at++) {
        const candidate = sorted[at];
        if (candidate) {
          if (on) next.add(rowId(candidate));
          else next.delete(rowId(candidate));
        }
      }
    } else if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
    anchorRef.current = index;
    selection.onChange(next);
  };

  const allSelected = selection !== undefined && sorted.length > 0 && sorted.every((row) => selection.selected.has(rowId(row)));
  const someSelected = selection !== undefined && !allSelected && sorted.some((row) => selection.selected.has(rowId(row)));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const move = (to: number): void => {
      const row = sorted[Math.max(0, Math.min(sorted.length - 1, to))];
      if (row) onActivate(row);
      event.preventDefault();
    };
    switch (event.key) {
      case "ArrowDown":
        move(activeIndex + 1);
        break;
      case "ArrowUp":
        move(activeIndex <= 0 ? 0 : activeIndex - 1);
        break;
      case "PageDown":
        move(activeIndex + 20);
        break;
      case "PageUp":
        move(activeIndex - 20);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(sorted.length - 1);
        break;
      case " ":
        if (activeIndex >= 0) {
          toggle(activeIndex, event.shiftKey);
          event.preventDefault();
        }
        break;
    }
  };

  if (rows.length === 0) return <div className="ws-vt">{props.empty}</div>;

  return (
    <div className="ws-vt" ref={scrollRef} tabIndex={0} role="region" aria-label={`${props.label}, Pfeiltasten wählen eine Zeile`} onKeyDown={onKeyDown}>
      <table className="cds--data-table cds--data-table--sm" aria-rowcount={sorted.length + 1}>
        <colgroup>
          {selection ? <col style={{ width: "2.5rem" }} /> : null}
          {columns.map((column) => (
            <col key={column.id} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr aria-rowindex={1}>
            {selection ? (
              <th className="ws-col-check" scope="col">
                <input
                  type="checkbox"
                  className="ws-check"
                  aria-label="Alle sichtbaren Zeilen auswählen"
                  checked={allSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = someSelected;
                  }}
                  onChange={() => selection.onChange(allSelected ? new Set() : new Set(sorted.map(rowId)))}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const state = sort?.id === column.id ? (sort.desc ? "descending" : "ascending") : "none";
              return (
                <th key={column.id} scope="col" aria-sort={column.sort ? state : undefined}>
                  {column.sort ? (
                    <button
                      type="button"
                      className="ws-sort"
                      onClick={() => setSort(sort?.id === column.id ? { id: column.id, desc: !sort.desc } : { id: column.id, desc: false })}
                    >
                      <span>{column.header}</span>
                      {state === "ascending" ? <ArrowUp size={16} /> : state === "descending" ? <ArrowDown size={16} /> : <ArrowsVertical size={16} />}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 ? <tr aria-hidden="true" style={{ height: paddingTop }} /> : null}
          {items.map((item) => {
            const row = sorted[item.index];
            if (!row) return null;
            const id = rowId(row);
            const classes = [item.index === activeIndex ? "ws-row--active" : "", props.muted?.(row) ? "ws-row--muted" : ""].filter(Boolean).join(" ");
            return (
              <tr
                key={id}
                aria-rowindex={item.index + 2}
                aria-current={item.index === activeIndex ? "true" : undefined}
                className={classes || undefined}
                style={{ height: ROW_HEIGHT }}
                onClick={() => onActivate(row)}
              >
                {selection ? (
                  <td className="ws-col-check" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="ws-check"
                      aria-label="Zeile auswählen"
                      checked={selection.selected.has(id)}
                      onChange={() => undefined}
                      onClick={(event) => toggle(item.index, event.shiftKey)}
                    />
                  </td>
                ) : null}
                {columns.map((column) => (
                  <td key={column.id} title={column.title?.(row)}>
                    {column.primary ? (
                      <button type="button" className="ws-rowlink" onClick={(event) => (event.stopPropagation(), onActivate(row))}>
                        {column.cell(row)}
                      </button>
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
          {paddingBottom > 0 ? <tr aria-hidden="true" style={{ height: paddingBottom }} /> : null}
        </tbody>
      </table>
    </div>
  );
}
