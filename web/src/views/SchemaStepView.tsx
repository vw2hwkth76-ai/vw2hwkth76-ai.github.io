import { Copy, Upload } from "@carbon/icons-react";
import { Button, Checkbox, InlineLoading, InlineNotification, TextArea } from "@carbon/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractJson } from "../../../src/recognize/schema-prompt.ts";
import { isRecord } from "../../../src/util/guards.ts";
import type { AnalysisClient } from "../client.ts";
import { count, fileStem, share } from "../format.ts";
import type { AnalyzeResult, OpenResult, PreviewFigures, SchemaPreviewResult, SchemaPromptResult } from "../protocol.ts";
import { download, type ProjectState } from "../storage.ts";

interface Props {
  readonly client: AnalysisClient;
  readonly project: OpenResult;
  readonly state: ProjectState;
  /** Laufende Erkennung ohne neues Schema; nur fuer die Anzeige, waehrend der Vorschlag fehlt. */
  readonly current: AnalyzeResult | undefined;
  readonly onDone: (profile: unknown) => void;
  readonly onCancel: () => void;
}

type Preview = Extract<SchemaPreviewResult, { ok: true }>;

const valueKey = (group: string, value: string): string => `v\u0000${group}\u0000${value}`;
const ruleKey = (index: number): string => `r\u0000${index}`;

/** Nimmt abgewaehlte Werte und Regeln aus der Dateiform des Schemas. */
function withoutDisabled(profile: unknown, disabled: ReadonlySet<string>): unknown {
  if (!isRecord(profile) || disabled.size === 0) return profile;
  const values = isRecord(profile["values"]) ? profile["values"] : {};
  const filtered = Object.fromEntries(
    Object.entries(values).map(([group, table]) => [
      group,
      isRecord(table) ? Object.fromEntries(Object.entries(table).filter(([value]) => !disabled.has(valueKey(group, value)))) : table,
    ]),
  );
  const rules = Array.isArray(profile["rules"]) ? profile["rules"].filter((_, index) => !disabled.has(ruleKey(index))) : [];
  return { ...profile, values: filtered, rules };
}

function Compare({ label, before, after, total }: { readonly label: string; readonly before: number; readonly after: number; readonly total?: number }): ReactNode {
  const show = (value: number): string => (total === undefined ? count(value) : share(value, total));
  return (
    <div className="ws-figure">
      <dt>{label}</dt>
      <dd>
        <span className="ws-compare__before">{show(before)}</span> <span aria-hidden="true">→</span>
        <span className="ws-sr-only"> mit Schema </span> {show(after)}
      </dd>
    </div>
  );
}

export function SchemaStepView({ client, project, state, current, onDone, onCancel }: Props): ReactNode {
  const [maskPersons, setMaskPersons] = useState(true);
  const [prompt, setPrompt] = useState<SchemaPromptResult>();
  const [copied, setCopied] = useState<"ok" | "failed">();
  const [showPrompt, setShowPrompt] = useState(false);
  const [answer, setAnswer] = useState("");
  const [inputError, setInputError] = useState<string>();
  /** Vorschlag in Dateiform, wie er geprueft wurde; Grundlage fuer die Haekchen. */
  const [base, setBase] = useState<Preview>();
  const [errors, setErrors] = useState<readonly string[]>();
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set());
  const [live, setLive] = useState<Preview>();
  const [checking, setChecking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);

  useEffect(() => {
    let active = true;
    client.call({ type: "schema-prompt", maskPersons }).then(
      (result) => active && setPrompt(result),
      () => active && setPrompt(undefined),
    );
    return () => {
      active = false;
    };
  }, [client, maskPersons]);

  const check = useCallback(
    async (candidate: unknown, keep: boolean) => {
      const id = ++sequence.current;
      setChecking(true);
      try {
        const result = await client.call({ type: "schema-preview", profile: candidate, useEtsFunctions: state.useEtsFunctions });
        if (id !== sequence.current) return;
        if (!result.ok) {
          setErrors(result.errors);
          if (!keep) setBase(undefined);
          setLive(undefined);
        } else {
          setErrors(undefined);
          if (!keep) {
            setBase(result);
            setDisabled(new Set());
          }
          setLive(result);
        }
      } catch (error) {
        if (id === sequence.current) setErrors([error instanceof Error ? error.message : String(error)]);
      } finally {
        if (id === sequence.current) setChecking(false);
      }
    },
    [client, state.useEtsFunctions],
  );

  // Ein mitgebrachtes Schema (Beispielprojekt, Rueckkehr aus der Ansicht Namensschema) wird gleich geprueft.
  const initial = useRef(state.profile);
  useEffect(() => {
    if (initial.current !== undefined) void check(initial.current, false);
  }, [check]);

  // Haekchen wirken nach kurzer Pause, ohne den Vorschlag selbst zu ersetzen.
  const effective = useMemo(() => (base ? withoutDisabled(base.profile, disabled) : undefined), [base, disabled]);
  useEffect(() => {
    if (!base || disabled.size === 0) {
      if (base) setLive(base);
      return;
    }
    const timer = window.setTimeout(() => void check(effective, true), 300);
    return () => window.clearTimeout(timer);
  }, [base, disabled, effective, check]);

  const copy = async (): Promise<void> => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.text);
      setCopied("ok");
    } catch {
      setCopied("failed");
      setShowPrompt(true);
    }
  };

  const checkAnswer = (): void => {
    try {
      const json = extractJson(answer);
      setInputError(undefined);
      void check(json, false);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadFile = async (file: File): Promise<void> => {
    try {
      const json: unknown = JSON.parse(await file.text());
      setInputError(undefined);
      void check(json, false);
    } catch (error) {
      setInputError(`Keine gültige JSON-Datei (${error instanceof Error ? error.message : String(error)}).`);
    }
  };

  const toggle = (key: string): void =>
    setDisabled((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const followUp = errors
    ? `Dein Schema hat diese Fehler:\n${errors.map((error) => `- ${error}`).join("\n")}\nBitte korrigiere sie und antworte wieder nur mit dem vollständigen JSON.`
    : undefined;
  const before: PreviewFigures | undefined = live?.before;
  const after: PreviewFigures | undefined = live?.after;
  const totalNames = base ? base.patterns.reduce((sum, pattern) => sum + pattern.matched, 0) + base.unmatched : 0;
  const groups = useMemo(() => {
    const byGroup = new Map<string, Preview["values"][number][]>();
    for (const entry of base?.values ?? []) byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry]);
    return [...byGroup];
  }, [base]);

  return (
    <div className="ws-page ws-step">
      <header className="ws-page-header">
        <div>
          <p className="ws-step__kicker">
            Schritt 2 von 2 · {project.name}
            {state.schemaChecked ? " · schon einmal geöffnet, gespeicherter Stand ist geladen" : ""}
          </p>
          <h1>Namensschema</h1>
          <p>
            Wie benennt der Errichter seine Gruppenadressen? Ein bestätigtes Namensschema liest Raum, Gewerk, Richtung und Things aus dem Namen und macht sie
            fest. Ohne Schema arbeitet die Erkennung mit Wortschatz und Verdrahtung.
          </p>
        </div>
        <div className="ws-step__actions">
          <Button kind="ghost" size="md" onClick={onCancel}>
            Abbrechen
          </Button>
          {state.schemaChecked ? (
            <Button kind="tertiary" size="md" onClick={() => onDone(state.profile)}>
              {state.profile === undefined ? "Weiter wie zuletzt, ohne Schema" : "Weiter wie zuletzt"}
            </Button>
          ) : null}
          <Button kind="secondary" size="md" onClick={() => onDone(undefined)}>
            Ohne Schema weiter
          </Button>
        </div>
      </header>

      <div className="ws-step__ways">
        <section className="ws-step__panel" aria-labelledby="step-llm">
          <h2 id="step-llm">Vorschlag von einem LLM</h2>
          <p>
            Die App schickt nichts weg. Den Prompt kopieren, in ein LLM einfügen und dessen Antwort hier einfügen; geprüft wird sie an allen Gruppenadressen
            dieses Projekts.
          </p>
          {prompt ? (
            <p className="helper">
              {prompt.included === prompt.groupAddresses
                ? `${count(prompt.groupAddresses)} GAs im Prompt`
                : `${count(prompt.included)} von ${count(prompt.groupAddresses)} GAs als Beispiele je Namensform`}
              , {count(prompt.text.length)} Zeichen{prompt.masked > 0 ? `, ${count(prompt.masked)} Personennamen ersetzt` : ""}.
            </p>
          ) : (
            <InlineLoading description="Prompt wird erstellt" />
          )}
          <Checkbox id="mask-persons" labelText="Personennamen ersetzen (Dr., Frau, Herr ...)" checked={maskPersons} onChange={(_, { checked }) => setMaskPersons(checked)} />
          <div className="ws-step__row">
            <Button kind="primary" size="md" renderIcon={Copy} disabled={!prompt} onClick={() => void copy()}>
              Prompt kopieren
            </Button>
            <Button kind="ghost" size="md" disabled={!prompt} onClick={() => setShowPrompt((value) => !value)}>
              {showPrompt ? "Prompt ausblenden" : "Prompt anzeigen"}
            </Button>
          </div>
          {copied === "ok" ? <p className="helper">In die Zwischenablage kopiert.</p> : null}
          {copied === "failed" ? <p className="helper">Kopieren nicht erlaubt; den Prompt unten markieren und kopieren.</p> : null}
          {showPrompt && prompt ? <TextArea id="schema-prompt" labelText="Prompt" rows={8} readOnly value={prompt.text} /> : null}
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title="Datenschutz"
            subtitle="Der Prompt enthält GA-Namen, Gruppenbereiche und Raumnamen dieses Projekts, keine Projekt-, Kunden- oder Errichterangaben. Wer ihn in ein LLM einfügt, übermittelt ihn an dessen Anbieter; bei Kundenprojekten nur mit Auftragsverarbeitungsvertrag."
          />
          <TextArea
            id="schema-answer"
            labelText="Antwort des LLM"
            helperText="Das JSON aus der Antwort; Text oder Codezaun drumherum stören nicht."
            rows={6}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <div className="ws-step__row">
            <Button kind="primary" size="md" disabled={answer.trim() === "" || checking} onClick={checkAnswer}>
              Antwort prüfen
            </Button>
          </div>
        </section>

        <section className="ws-step__panel" aria-labelledby="step-file">
          <h2 id="step-file">Gespeichertes Schema</h2>
          <p>Ein Namensschema gilt je Errichter. Einmal bestätigt und gespeichert, lässt es sich für weitere Projekte laden.</p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = "";
            }}
          />
          <Button kind="tertiary" size="md" renderIcon={Upload} onClick={() => fileInput.current?.click()}>
            Schema-Datei laden
          </Button>
          {current ? (
            <p className="helper ws-step__now">
              Ohne Schema: {count(current.snapshot.things.length)} Things, {count(current.snapshot.questions.length)} Rückfragen.
            </p>
          ) : null}
        </section>
      </div>

      {inputError ? <InlineNotification kind="error" lowContrast title="Nicht lesbar" subtitle={inputError} onClose={() => setInputError(undefined)} /> : null}
      {checking ? <InlineLoading description="Schema wird am Projekt geprüft" /> : null}
      {errors ? (
        <section className="ws-section" aria-labelledby="step-errors">
          <h2 id="step-errors">Schema abgelehnt</h2>
          <p>Nichts davon wird übernommen. Die Fehler an das LLM zurückgeben und die korrigierte Antwort erneut prüfen.</p>
          <ul className="ws-step__list">
            {errors.slice(0, 20).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          {followUp ? (
            <Button kind="tertiary" size="sm" renderIcon={Copy} onClick={() => void navigator.clipboard.writeText(followUp).catch(() => undefined)}>
              Rückmeldung für das LLM kopieren
            </Button>
          ) : null}
        </section>
      ) : null}

      {base && live ? (
        <>
          <section className="ws-section" aria-labelledby="step-effect">
            <h2 id="step-effect">{base.name || "Vorschlag"}</h2>
            {base.description ? <p>{base.description}</p> : null}
            {before && after ? (
              <dl className="ws-figures ws-figures--compare">
                <Compare label="TD-fertig ohne Rückfrage" before={before.ready} after={after.ready} total={after.groupAddresses} />
                <Compare label="Davon fest belegt" before={before.firm} after={after.firm} total={after.groupAddresses} />
                <Compare label="Things" before={before.things} after={after.things} />
                <Compare label="Rückfragen" before={before.questions} after={after.questions} />
              </dl>
            ) : null}
          </section>

          <section className="ws-section" aria-labelledby="step-coverage">
            <h2 id="step-coverage">Abdeckung</h2>
            <ul className="ws-step__list">
              {base.patterns.map((pattern, index) => (
                <li key={pattern.regex}>
                  Muster {index + 1} liest {count(pattern.matched)} von {count(totalNames)} GAs ({share(pattern.matched, totalNames)})
                  <code className="ws-step__regex">{pattern.regex}</code>
                </li>
              ))}
              {base.entries > 0 ? <li>Dazu {count(base.entries)} Kürzel aus der Kürzeltabelle.</li> : null}
            </ul>
            {base.patterns.length > 0 && base.unmatched > 0 ? (
              <p className="helper">
                {count(base.unmatched)} GAs liest kein Muster; für sie gilt die übliche Erkennung. Beispiele: {base.unmatchedExamples.slice(0, 5).join(" · ")}
              </p>
            ) : null}
            {base.unknownRooms.length > 0 ? (
              <InlineNotification
                kind="warning"
                lowContrast
                hideCloseButton
                title="Räume nicht gefunden"
                subtitle={`Diese Raumwerte gibt es in der Gebäudestruktur nicht; dort zählt der Raum aus dem Namen nicht: ${base.unknownRooms.join(", ")}.`}
              />
            ) : null}
            {live.warnings.length > 0 ? (
              <details className="ws-step__warnings">
                <summary>{count(live.warnings.length)} Hinweise, ignorierte Angaben</summary>
                <ul className="ws-step__list">
                  {live.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          {groups.length > 0 ? (
            <section className="ws-section" aria-labelledby="step-values">
              <h2 id="step-values">Bedeutung der Werte</h2>
              <p>Abgewählte Werte gelten nicht; der Vergleich oben rechnet sofort neu.</p>
              <div className="ws-step__tables">
                {groups.map(([group, entries]) => (
                  <table key={group} className="cds--data-table cds--data-table--sm ws-step__table">
                    <caption>Gruppe "{group}"</caption>
                    <thead>
                      <tr>
                        <th scope="col">
                          <span className="ws-sr-only">Gilt</span>
                        </th>
                        <th scope="col">Wert</th>
                        <th scope="col">Bedeutung</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.value}>
                          <td>
                            <Checkbox
                              id={`value-${group}-${entry.value}`}
                              labelText={`${group} ${entry.value} gilt`}
                              hideLabel
                              checked={!disabled.has(valueKey(group, entry.value))}
                              onChange={() => toggle(valueKey(group, entry.value))}
                            />
                          </td>
                          <td className="mono">{entry.value}</td>
                          <td>{entry.meaning || "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
            </section>
          ) : null}

          {base.rules.length > 0 ? (
            <section className="ws-section" aria-labelledby="step-rules">
              <h2 id="step-rules">Ausnahmen</h2>
              <table className="cds--data-table cds--data-table--sm ws-step__table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="ws-sr-only">Gilt</span>
                    </th>
                    <th scope="col">Wenn der Name passt auf</th>
                    <th scope="col">dann</th>
                    <th scope="col">weil</th>
                  </tr>
                </thead>
                <tbody>
                  {base.rules.map((rule, index) => (
                    <tr key={`${rule.match}-${index}`}>
                      <td>
                        <Checkbox id={`rule-${index}`} labelText={`Ausnahme ${index + 1} gilt`} hideLabel checked={!disabled.has(ruleKey(index))} onChange={() => toggle(ruleKey(index))} />
                      </td>
                      <td className="mono">{rule.match}</td>
                      <td>{rule.meaning}</td>
                      <td>{rule.why ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <div className="ws-step__finish">
            <Button kind="primary" size="lg" disabled={checking} onClick={() => onDone(live.profile)}>
              Schema übernehmen
            </Button>
            <Button kind="tertiary" size="lg" onClick={() => download(`${fileStem(live.name || "namensschema")}.namensschema.json`, JSON.stringify(live.profile, null, 2))}>
              Schema speichern
            </Button>
            <Button
              kind="ghost"
              size="lg"
              onClick={() => {
                setBase(undefined);
                setLive(undefined);
                setDisabled(new Set());
              }}
            >
              Verwerfen
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
