import { Close } from "@carbon/icons-react";
import { IconButton, InlineNotification, Search, Select, SelectItem, Tag } from "@carbon/react";
import { type ReactNode, useMemo, useState } from "react";
import { BUNDLE_LABEL } from "../../../src/app/labels.ts";
import type { ThingView } from "../../../src/app/snapshot.ts";
import { type Column, VirtualTable } from "../components/VirtualTable.tsx";
import { count } from "../format.ts";
import { useWorkspace } from "../workspace.ts";

const COLUMNS: readonly Column<ThingView>[] = [
  { id: "label", header: "Thing", sort: (thing) => thing.label, cell: (thing) => thing.label, primary: true, title: (thing) => thing.label },
  { id: "type", header: "Typ", width: "11rem", sort: (thing) => thing.typeLabel, cell: (thing) => thing.typeLabel },
  { id: "room", header: "Raum", width: "18%", sort: (thing) => thing.room ?? "￿", cell: (thing) => thing.room ?? <span className="ws-none">offen</span> },
  {
    id: "trade",
    header: "Gewerk",
    width: "11rem",
    sort: (thing) => thing.trade ?? "￿",
    cell: (thing) => thing.trade ?? <span className="ws-none">offen</span>,
  },
  { id: "source", header: "Bündelung", width: "10rem", sort: (thing) => thing.source, cell: (thing) => BUNDLE_LABEL[thing.source] ?? thing.source },
  { id: "members", header: "GAs", width: "4.5rem", sort: (thing) => thing.members.length, cell: (thing) => count(thing.members.length) },
];

export function ThingsView(): ReactNode {
  const workspace = useWorkspace();
  const { snapshot, lookups } = workspace;
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const types = useMemo(
    () => [...new Map(snapshot.things.map((thing) => [thing.type, thing.typeLabel]))].sort((a, b) => a[1].localeCompare(b[1], "de")),
    [snapshot],
  );

  const rows = useMemo(() => {
    const words = query.toLocaleLowerCase("de").split(/\s+/).filter(Boolean);
    return snapshot.things.filter((thing) => {
      if (type !== "" && thing.type !== type) return false;
      if (words.length === 0) return true;
      const haystack = `${thing.label} ${thing.room ?? ""} ${thing.members.map((member) => `${member.text} ${member.name}`).join(" ")}`.toLocaleLowerCase("de");
      return words.every((word) => haystack.includes(word));
    });
  }, [snapshot, query, type]);

  const active = workspace.focusThing !== undefined ? lookups.thingByKey.get(workspace.focusThing) : undefined;
  const structure = active ? snapshot.questions.filter((question) => question.kind === "structure" && question.thingKey === active.key) : [];

  return (
    <div className="ws-split">
      <div className="ws-split__main">
        <header className="ws-page-header" style={{ marginBottom: "1rem" }}>
          <div>
            <h1>Things</h1>
            <p>
              Gebündelte Gruppenadressen, die zusammen ein Gerät oder eine Funktion beschreiben. Typ und KNX-Funktionstyp bestimmen später das Thing Model der
              Thing Description.
            </p>
          </div>
        </header>
        <div className="ws-toolbar" role="search">
          <div className="ws-toolbar__search">
            <Search
              size="md"
              labelText="Suche"
              placeholder="Thing, Raum, GA oder GA-Name"
              value={query}
              onChange={(event) => setQuery(typeof event === "string" ? event : event.target.value)}
              closeButtonLabelText="Suche leeren"
            />
          </div>
          <div className="ws-toolbar__filter">
            <Select id="filter-typ" size="md" labelText="Typ" hideLabel value={type} onChange={(event) => setType(event.target.value)}>
              <SelectItem value="" text="Alle Typen" />
              {types.map(([value, label]) => (
                <SelectItem key={value} value={value} text={label} />
              ))}
            </Select>
          </div>
          <span className="ws-toolbar__count" aria-live="polite">
            {rows.length === snapshot.things.length ? `${count(rows.length)} Things` : `${count(rows.length)} von ${count(snapshot.things.length)}`}
          </span>
        </div>
        <VirtualTable<ThingView>
          label="Things"
          rows={rows}
          columns={COLUMNS}
          rowId={(thing) => thing.key}
          activeId={active?.key}
          onActivate={(thing) => workspace.openThing(thing.key)}
          initialSort={{ id: "room", desc: false }}
          muted={(thing) => thing.outOfUse}
          empty={
            <div className="ws-empty">
              <h3>Kein Thing passt</h3>
              <p>Suche oder Typfilter lockern.</p>
            </div>
          }
        />
        <div style={{ height: "1rem" }} />
      </div>
      {active ? (
        <aside className="ws-split__aside" aria-label={`Thing ${active.label}`} onKeyDown={(event) => event.key === "Escape" && workspace.openThing(undefined)}>
          <div className="ws-inspector">
            <div className="ws-inspector__head">
              <div>
                <div className="ws-inspector__ga">{active.label}</div>
                <div className="ws-inspector__name">
                  {active.typeLabel}
                  {active.functionType ? <span className="muted">, KNX-Funktionstyp {active.functionType}</span> : null}
                </div>
              </div>
              <IconButton kind="ghost" size="sm" label="Schließen" align="left" onClick={() => workspace.openThing(undefined)}>
                <Close size={16} />
              </IconButton>
            </div>
            <div className="ws-inspector__actions">
              <Tag size="sm" type="cool-gray">
                {BUNDLE_LABEL[active.source] ?? active.source}
              </Tag>
              {active.room ? (
                <Tag size="sm" type="cool-gray">
                  {active.room}
                </Tag>
              ) : null}
              {active.trade ? (
                <Tag size="sm" type="cool-gray">
                  {active.trade}
                </Tag>
              ) : null}
              {active.central ? (
                <Tag size="sm" type="purple">
                  Zentral
                </Tag>
              ) : null}
              {active.outOfUse ? (
                <Tag size="sm" type="gray">
                  Stillgelegt
                </Tag>
              ) : null}
            </div>
            {structure.map((question) => (
              <InlineNotification
                key={question.id}
                kind="warning"
                lowContrast
                hideCloseButton
                title="Rückfrage"
                subtitle={question.message}
                style={{ marginTop: "1rem" }}
              />
            ))}
            <h3>Gruppenadressen</h3>
            <table className="ws-claims">
              <thead>
                <tr>
                  <th scope="col">GA</th>
                  <th scope="col">Name</th>
                  <th scope="col">Rolle</th>
                </tr>
              </thead>
              <tbody>
                {active.members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <button type="button" className="ws-rowlink mono" onClick={() => workspace.openGa(member.id)}>
                        {member.text}
                      </button>
                    </td>
                    <td>{member.name}</td>
                    <td className="mono">{member.role ?? <span className="ws-none">ohne</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="helper" style={{ marginTop: "0.5rem" }}>
              Bündelung: ETS-Funktion vor Aktorkanal vor Namensfamilie. Einzelne GAs ohne Partner bleiben eigene Things.
            </p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
