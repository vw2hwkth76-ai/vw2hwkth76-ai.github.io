import { Button, Checkbox, InlineLoading, Search, Tag } from "@carbon/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ScopeOverview, ScopeRow, ScopeSearch } from "../../../src/app/scope-view.ts";
import type { ExcludeReason, Exclusion } from "../../../src/graph/scope.ts";
import type { AnalysisClient } from "../client.ts";
import { count, share } from "../format.ts";
import { Figure } from "./Figure.tsx";

interface Props {
  readonly client: AnalysisClient;
  readonly exclude: Exclusion;
  readonly onChange: (next: Exclusion) => void;
}

const REASON_LABEL: Readonly<Record<ExcludeReason, string>> = { reserve: "Vorrat", group: "Hauptgruppe", single: "einzeln" };
const USAGE_LABEL = { active: "in Benutzung", idle: "ohne Funktion", reserve: "Vorrat" } as const;
const SEARCH_LIMIT = 30;

/**
 * Legt fest, welche GAs ausgewertet werden: Vorrat, ganze Hauptgruppen und einzelne GAs per Suche. Zahlen und
 * Treffer kommen aus dem Worker; geaendert wird erst, wenn der Aufrufer `onChange` uebernimmt.
 */
export function ScopeEditor({ client, exclude, onChange }: Props): ReactNode {
  const [overview, setOverview] = useState<ScopeOverview>();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<ScopeSearch>();
  const [failure, setFailure] = useState<string>();
  const sequence = useRef(0);
  // Aenderungen laufen nacheinander und bauen auf der jeweils letzten auf; sonst ueberschriebe ein spaeterer Klick einen frueheren.
  const latest = useRef(exclude);
  latest.current = exclude;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const change = useCallback(
    (step: (current: Exclusion) => Exclusion | Promise<Exclusion>): void => {
      queue.current = queue.current.then(async () => {
        try {
          const next = await step(latest.current);
          latest.current = next;
          onChange(next);
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error));
        }
      });
    },
    [onChange],
  );

  useEffect(() => {
    const id = ++sequence.current;
    client.call({ type: "scope-overview", exclude }).then(
      (next) => id === sequence.current && setOverview(next),
      (error: unknown) => id === sequence.current && setFailure(error instanceof Error ? error.message : String(error)),
    );
  }, [client, exclude]);

  useEffect(() => {
    const text = query.trim();
    if (text === "") {
      setSearch(undefined);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      client.call({ type: "scope-search", exclude, query: text, limit: SEARCH_LIMIT }).then(
        (next) => current && setSearch(next),
        (error: unknown) => current && setFailure(error instanceof Error ? error.message : String(error)),
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [client, exclude, query]);

  const applyToHits = (action: "exclude" | "include"): void => {
    const text = query.trim();
    change((current) => client.call({ type: "scope-apply", exclude: current, action, query: text }));
  };

  const toggleGroup = (id: string): void =>
    change((current) => {
      const set = new Set(current.ranges);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...current, ranges: [...set] };
    });

  const toggleRow = (row: ScopeRow): void => change((current) => client.call({ type: "scope-apply", exclude: current, action: row.excluded ? "include" : "exclude", ids: [row.id] }));

  if (failure) return <p role="alert">{failure}</p>;
  if (!overview) return <InlineLoading description="Umfang wird berechnet" />;

  const reserveCount = overview.idle + overview.reserve;
  const singles = exclude.gas.length + exclude.include.length;
  const hits = search?.total ?? 0;
  const hitsExcluded = search?.excluded ?? 0;

  return (
    <div className="ws-scope">
      <dl className="ws-figures">
        <Figure label="Gruppenadressen" value={count(overview.total)} />
        <Figure
          label="In Benutzung"
          value={overview.hasDevices ? count(overview.active) : "–"}
          note={overview.hasDevices ? share(overview.active, overview.total) : "keine Geräte im Projekt"}
        />
        <Figure label="Vorrat" value={overview.hasDevices ? count(reserveCount) : "–"} note={overview.hasDevices ? "kein Gerät sendet oder empfängt" : undefined} />
        <Figure
          label="Wird ausgewertet"
          value={count(overview.included)}
          note={overview.excluded > 0 ? `${count(overview.excluded)} ausgeschlossen` : "alle"}
        />
      </dl>

      {overview.hasDevices && reserveCount > 0 ? (
        <section className="ws-section" aria-labelledby="scope-reserve">
          <h2 id="scope-reserve">Vorrat</h2>
          {overview.template ? (
            <p>
              Nur {count(overview.active)} von {count(overview.total)} Gruppenadressen ({share(overview.active, overview.total)}) sind mit einem Gerät verknüpft, das sendet oder
              empfängt. Viele Errichter importieren eine große Vorlage und verknüpfen nur, was sie brauchen. Der Rest ist Vorrat, kein Fehler.
            </p>
          ) : (
            <p>In Benutzung heißt: Ein Gerät sendet oder empfängt auf der GA. Die übrigen GAs sind Vorrat.</p>
          )}
          <Checkbox
            id="scope-reserve-check"
            labelText={`Vorrat ausschließen (${count(reserveCount)} GAs)`}
            helperText="Ausgeschlossene GAs bekommen keine Belege, bilden keine Things, stellen keine Rückfragen und stehen nicht im Prompt. In der Tabelle bleiben sie grau sichtbar."
            checked={exclude.reserve}
            onChange={(_, { checked }) => change((current) => ({ ...current, reserve: checked }))}
          />
        </section>
      ) : null}

      <section className="ws-section" aria-labelledby="scope-groups">
        <h2 id="scope-groups">Hauptgruppen</h2>
        <p>Ein Häkchen heißt: Die Hauptgruppe wird ausgewertet. Abgewählte Gruppen fallen ganz heraus, zum Beispiel Sicherheit, Multimedia oder Logik.</p>
        <div className="ws-table-scroll">
          <table className="cds--data-table cds--data-table--sm ws-step__table ws-scope__table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="ws-sr-only">Wird ausgewertet</span>
                </th>
                <th scope="col">Hauptgruppe</th>
                <th scope="col" className="ws-scope__num">
                  GAs
                </th>
                <th scope="col" className="ws-scope__num">
                  In Benutzung
                </th>
              </tr>
            </thead>
            <tbody>
              {overview.groups.map((group) => (
                <tr key={group.id}>
                  <td>
                    <Checkbox
                      id={`scope-group-${group.id}`}
                      labelText={`${group.name} wird ausgewertet`}
                      hideLabel
                      checked={!group.excluded}
                      onChange={() => toggleGroup(group.id)}
                    />
                  </td>
                  <td>{group.name}</td>
                  <td className="ws-scope__num">{count(group.total)}</td>
                  <td className="ws-scope__num">{overview.hasDevices ? count(group.active) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ws-section" aria-labelledby="scope-single">
        <h2 id="scope-single">Einzelne GAs</h2>
        <p>Nach Adresse, Name oder Gruppenbereich suchen und die Treffer ausschließen oder wieder aufnehmen. Eine einzelne Entscheidung geht Gruppe und Vorrat vor.</p>
        <Search
          size="md"
          labelText="GAs suchen"
          placeholder="Adresse, Name oder Bereich, mehrere Wörter möglich"
          value={query}
          onChange={(event) => setQuery(typeof event === "string" ? event : event.target.value)}
          closeButtonLabelText="Suche leeren"
        />
        {search ? (
          <>
            <div className="ws-step__row">
              <span className="ws-scope__hits" aria-live="polite">
                {count(hits)} Treffer, davon {count(hitsExcluded)} ausgeschlossen
              </span>
              <Button kind="secondary" size="sm" disabled={hits === hitsExcluded} onClick={() => applyToHits("exclude")}>
                Alle {count(hits)} Treffer ausschließen
              </Button>
              <Button kind="tertiary" size="sm" disabled={hitsExcluded === 0} onClick={() => applyToHits("include")}>
                Alle Treffer aufnehmen
              </Button>
            </div>
            {hits > search.rows.length ? <p className="helper">Die ersten {count(search.rows.length)} Treffer sind aufgeführt; die Knöpfe oben gelten für alle.</p> : null}
            <div className="ws-table-scroll">
              <table className="cds--data-table cds--data-table--sm ws-step__table ws-scope__table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="ws-sr-only">Wird ausgewertet</span>
                    </th>
                    <th scope="col">GA</th>
                    <th scope="col">Name</th>
                    <th scope="col">Bereich</th>
                    <th scope="col">Nutzung</th>
                    <th scope="col">Stand</th>
                  </tr>
                </thead>
                <tbody>
                  {search.rows.map((row) => (
                    <tr key={row.id} className={row.excluded ? "ws-row--muted" : undefined}>
                      <td>
                        <Checkbox id={`scope-row-${row.id}`} labelText={`${row.text} wird ausgewertet`} hideLabel checked={!row.excluded} onChange={() => toggleRow(row)} />
                      </td>
                      <td className="mono">{row.text}</td>
                      <td>{row.name || <span className="ws-none">ohne Namen</span>}</td>
                      <td>{row.range}</td>
                      <td>{USAGE_LABEL[row.usage]}</td>
                      <td>
                        {row.excluded ? (
                          <Tag size="sm" type="gray">
                            ausgeschlossen ({REASON_LABEL[row.excluded]})
                          </Tag>
                        ) : (
                          "ausgewertet"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hits === 0 ? <p className="helper">Keine GA passt.</p> : null}
          </>
        ) : null}
        {singles > 0 ? (
          <div className="ws-step__row">
            <span className="ws-scope__hits">
              {count(exclude.gas.length)} einzeln ausgeschlossen, {count(exclude.include.length)} einzeln zurückgeholt.
            </span>
            <Button kind="ghost" size="sm" onClick={() => change((current) => ({ ...current, gas: [], include: [] }))}>
              Einzelentscheidungen zurücksetzen
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
