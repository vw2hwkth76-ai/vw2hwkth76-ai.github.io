import { Add, TrashCan, Upload } from "@carbon/icons-react";
import { Button, IconButton, InlineNotification, Select, SelectItem, TextInput } from "@carbon/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ASPECT_LABEL, MARKER_LABEL, TRADE_LABEL } from "../../../src/app/labels.ts";
import { isRecord } from "../../../src/util/guards.ts";
import { PROFILE_FORMAT, parseProfile } from "../../../src/recognize/profile.ts";
import { count, fileStem } from "../format.ts";
import { download } from "../storage.ts";
import { useWorkspace } from "../workspace.ts";

const FIELDS = ["trade", "aspect", "marker", "room", "label"] as const;
type Field = (typeof FIELDS)[number];
const FIELD_LABEL: Readonly<Record<Field, string>> = { trade: "Gewerk", aspect: "Aspekt", marker: "Kennwort", room: "Raum", label: "Anzeigename" };

interface DraftEntry {
  readonly key: number;
  readonly token: string;
  readonly values: Readonly<Record<Field, string>>;
}

interface Draft {
  readonly name: string;
  readonly entries: readonly DraftEntry[];
}

const EMPTY_VALUES: Record<Field, string> = { trade: "", aspect: "", marker: "", room: "", label: "" };
let nextKey = 1;

function toDraft(profile: unknown): Draft {
  if (!isRecord(profile)) return { name: "", entries: [] };
  const entries = Array.isArray(profile["entries"]) ? profile["entries"] : [];
  return {
    name: typeof profile["name"] === "string" ? profile["name"] : "",
    entries: entries.filter(isRecord).map((entry) => {
      const values = { ...EMPTY_VALUES };
      for (const field of FIELDS) {
        const value = entry[field];
        if (typeof value === "string") values[field] = value;
      }
      return { key: nextKey++, token: typeof entry["token"] === "string" ? entry["token"] : "", values };
    }),
  };
}

function toProfile(draft: Draft): unknown {
  if (draft.entries.length === 0) return undefined;
  return {
    format: PROFILE_FORMAT,
    name: draft.name.trim() || "Namensschema",
    entries: draft.entries.map((entry) => ({
      token: entry.token.trim(),
      ...Object.fromEntries(FIELDS.filter((field) => entry.values[field].trim() !== "").map((field) => [field, entry.values[field].trim()])),
    })),
  };
}

export function SchemaView(): ReactNode {
  const workspace = useWorkspace();
  const { snapshot, state } = workspace;
  const [draft, setDraft] = useState<Draft>(() => toDraft(state.profile));
  const [importError, setImportError] = useState<string>();
  const committed = useRef<unknown>(state.profile);
  const fileInput = useRef<HTMLInputElement>(null);

  // Ein von aussen ersetzter Stand (Import des Projektstands) setzt den Entwurf neu.
  useEffect(() => {
    if (state.profile !== committed.current) {
      committed.current = state.profile;
      setDraft(toDraft(state.profile));
    }
  }, [state.profile]);

  const profile = useMemo(() => toProfile(draft), [draft]);
  const parsed = useMemo(() => (profile === undefined ? undefined : parseProfile(profile)), [profile]);
  const errors = parsed && !parsed.ok ? parsed.errors : [];

  // Gueltige Entwuerfe gelten nach kurzer Pause; Tippen loest nicht bei jedem Zeichen eine Analyse aus.
  const apply = useRef(workspace.setProfile);
  apply.current = workspace.setProfile;
  useEffect(() => {
    if (parsed && !parsed.ok) return;
    const next = parsed?.ok ? parsed.profile : undefined;
    if (JSON.stringify(next) === JSON.stringify(committed.current)) return;
    const timer = window.setTimeout(() => {
      committed.current = next;
      apply.current(next);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [parsed]);

  const roomNames = useMemo(() => [...new Set(snapshot.spaces.map((space) => space.name))].sort((a, b) => a.localeCompare(b, "de")), [snapshot]);
  const tokens = new Set(draft.entries.map((entry) => entry.token.trim().toLocaleLowerCase("de")));
  const codes = snapshot.unknownCodes.filter((code) => !tokens.has(code.token.toLocaleLowerCase("de")));

  const update = (key: number, change: (entry: DraftEntry) => DraftEntry): void =>
    setDraft((current) => ({ ...current, entries: current.entries.map((entry) => (entry.key === key ? change(entry) : entry)) }));
  const add = (token = ""): void => setDraft((current) => ({ ...current, entries: [...current.entries, { key: nextKey++, token, values: EMPTY_VALUES }] }));

  const importFile = async (file: File): Promise<void> => {
    try {
      const json: unknown = JSON.parse(await file.text());
      const result = parseProfile(json);
      if (!result.ok) {
        setImportError(result.errors.slice(0, 5).join(" "));
        return;
      }
      setImportError(undefined);
      setDraft(toDraft(result.profile));
    } catch (error) {
      setImportError(`Keine gültige JSON-Datei (${error instanceof Error ? error.message : String(error)}).`);
    }
  };

  return (
    <div className="ws-page">
      <header className="ws-page-header">
        <div>
          <h1>Namensschema</h1>
          <p>
            Die Kürzeltabelle eines Integrators, zum Beispiel "L" für Licht oder "WZ" für Wohnzimmer. Sie gilt über Projekte hinweg und steht als bestätigte
            Regel über jeder Namensheuristik, aber unter ETS-Angaben und Verdrahtung.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
          <Button kind="tertiary" size="md" renderIcon={Upload} onClick={() => fileInput.current?.click()}>
            Schema laden
          </Button>
          <Button
            kind="tertiary"
            size="md"
            disabled={!parsed?.ok}
            onClick={() => {
              if (parsed?.ok) download(`${fileStem(parsed.profile.name)}.namensschema.json`, JSON.stringify(parsed.profile, null, 2));
            }}
          >
            Schema speichern
          </Button>
        </div>
      </header>

      {importError ? (
        <InlineNotification kind="error" lowContrast title="Schema nicht geladen" subtitle={importError} onClose={() => setImportError(undefined)} />
      ) : null}
      {errors.length > 0 ? (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Noch nicht angewendet"
          subtitle={`Das Schema gilt erst, wenn alle Einträge gültig sind. ${errors.slice(0, 3).join(" ")}`}
        />
      ) : null}
      {snapshot.profileWarnings.map((warning) => (
        <InlineNotification key={warning} kind="info" lowContrast hideCloseButton title="Hinweis" subtitle={warning} />
      ))}

      <div className="ws-schema">
        <section aria-labelledby="schema-entries">
          <div style={{ maxWidth: "24rem", marginBottom: "1rem" }}>
            <TextInput
              id="schema-name"
              size="md"
              labelText="Name des Schemas"
              placeholder="z. B. Integrator Nord"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <h2 id="schema-entries" className="ws-sr-only">
            Einträge
          </h2>
          {draft.entries.length === 0 ? (
            <div className="ws-empty" style={{ border: "1px solid var(--cds-border-subtle)" }}>
              <h3>Noch keine Kürzel</h3>
              <p>Aus der Liste unbekannter Kürzel übernehmen oder eine Zeile anlegen.</p>
            </div>
          ) : (
            <div className="ws-schema-scroll">
              <table className="cds--data-table cds--data-table--sm ws-schema-table">
                <colgroup>
                  <col style={{ width: "6rem" }} />
                  <col style={{ width: "12rem" }} />
                  <col style={{ width: "11rem" }} />
                  <col style={{ width: "10rem" }} />
                  <col style={{ width: "13rem" }} />
                  <col />
                  <col style={{ width: "3rem" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Kürzel</th>
                    <th scope="col">Gewerk</th>
                    <th scope="col">Aspekt</th>
                    <th scope="col">Kennwort</th>
                    <th scope="col">Raum</th>
                    <th scope="col">Anzeigename</th>
                    <th scope="col" style={{ width: "3rem" }}>
                      <span className="ws-sr-only">Entfernen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.entries.map((entry, index) => (
                    <tr key={entry.key}>
                      <td>
                        <TextInput
                          id={`token-${entry.key}`}
                          size="sm"
                          labelText={`Kürzel ${index + 1}`}
                          hideLabel
                          value={entry.token}
                          onChange={(event) => update(entry.key, (current) => ({ ...current, token: event.target.value }))}
                        />
                      </td>
                      <FieldSelect entry={entry} field="trade" options={TRADE_LABEL} onChange={update} />
                      <FieldSelect entry={entry} field="aspect" options={ASPECT_LABEL} onChange={update} />
                      <FieldSelect entry={entry} field="marker" options={MARKER_LABEL} onChange={update} />
                      <FieldSelect entry={entry} field="room" options={Object.fromEntries(roomNames.map((name) => [name, name]))} onChange={update} />
                      <td>
                        <TextInput
                          id={`label-${entry.key}`}
                          size="sm"
                          labelText="Anzeigename"
                          hideLabel
                          value={entry.values.label}
                          onChange={(event) => update(entry.key, (current) => ({ ...current, values: { ...current.values, label: event.target.value } }))}
                        />
                      </td>
                      <td>
                        <IconButton
                          kind="ghost"
                          size="sm"
                          label={`"${entry.token || "leer"}" entfernen`}
                          align="left"
                          onClick={() => setDraft((current) => ({ ...current, entries: current.entries.filter((candidate) => candidate.key !== entry.key) }))}
                        >
                          <TrashCan size={16} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: "1rem" }}>
            <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => add()}>
              Kürzel hinzufügen
            </Button>
          </div>
        </section>

        <section aria-labelledby="schema-codes">
          <h2 id="schema-codes" className="ws-h2">
            Unbekannte Kürzel
          </h2>
          <p className="helper" style={{ marginBottom: "1rem" }}>
            Kurze, wiederkehrende Wörter in GA-Namen, die weder Vokabular noch Raumabgleich erklären. Der DPT-Haupttyp gibt einen Hinweis auf die Bedeutung.
          </p>
          {codes.length === 0 ? (
            <p className="muted">Keine. Alle wiederkehrenden Kürzel sind erklärt.</p>
          ) : (
            <div className="ws-codes">
              {codes.map((code) => (
                <div key={code.token} className="ws-code">
                  <div>
                    <span className="ws-code__token mono">{code.token}</span>{" "}
                    <span className="muted">
                      {count(code.count)} mal{code.dptMains.length > 0 ? `, DPT ${code.dptMains.join(", ")}` : ""}
                    </span>
                  </div>
                  <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => add(code.token)}>
                    Übernehmen
                  </Button>
                  <div className="ws-code__examples">{code.examples.join(" · ")}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

interface FieldSelectProps {
  readonly entry: DraftEntry;
  readonly field: Field;
  readonly options: Readonly<Record<string, string>>;
  readonly onChange: (key: number, change: (entry: DraftEntry) => DraftEntry) => void;
}

function FieldSelect({ entry, field, options, onChange }: FieldSelectProps): ReactNode {
  const value = entry.values[field];
  const known = value === "" || Object.hasOwn(options, value);
  return (
    <td>
      <Select
        id={`${field}-${entry.key}`}
        size="sm"
        labelText={FIELD_LABEL[field]}
        hideLabel
        value={value}
        invalid={!known}
        invalidText="Unbekannt"
        onChange={(event) => onChange(entry.key, (current) => ({ ...current, values: { ...current.values, [field]: event.target.value } }))}
      >
        <SelectItem value="" text="–" />
        {!known ? <SelectItem value={value} text={value} /> : null}
        {Object.entries(options).map(([key, label]) => (
          <SelectItem key={key} value={key} text={label} />
        ))}
      </Select>
    </td>
  );
}
