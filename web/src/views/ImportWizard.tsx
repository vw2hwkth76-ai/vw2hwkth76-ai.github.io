import { Button, InlineLoading, InlineNotification, ProgressIndicator, ProgressStep } from "@carbon/react";
import { type ReactNode, useEffect, useState } from "react";
import type { ScopeOverview, SplitThings } from "../../../src/app/scope-view.ts";
import { type Exclusion, isEmptyExclusion, NO_EXCLUSION } from "../../../src/graph/scope.ts";
import type { AnalysisClient } from "../client.ts";
import { ScopeEditor } from "../components/ScopeEditor.tsx";
import { count } from "../format.ts";
import type { OpenResult } from "../protocol.ts";
import { exclusionOf, type ProjectState } from "../storage.ts";
import { SchemaStepView, type SchemaChoice } from "./SchemaStepView.tsx";

export type WizardStep = "scope" | "schema" | "summary";

const STEPS: readonly { readonly id: WizardStep; readonly label: string }[] = [
  { id: "scope", label: "Umfang" },
  { id: "schema", label: "Namensschema" },
  { id: "summary", label: "Zusammenfassung" },
];

interface Props {
  readonly client: AnalysisClient;
  readonly project: OpenResult;
  readonly state: ProjectState;
  readonly initialStep: WizardStep;
  /** Beendet den Assistenten; erst jetzt gelten Umfang und Schema fuer die Auswertung. */
  readonly onFinish: (profile: unknown, exclude: Exclusion) => void;
  readonly onCancel: () => void;
}

/**
 * Gefuehrter Ablauf direkt nach dem Import: erst festlegen, welche GAs gelten, dann das Namensschema, dann eine
 * Zusammenfassung. Bis zum Ende bleibt alles ein Entwurf; die volle Analyse laeuft erst danach, damit das Umschalten
 * im ersten Schritt nicht jedes Mal das ganze Projekt neu rechnet.
 */
export function ImportWizard({ client, project, state, initialStep, onFinish, onCancel }: Props): ReactNode {
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [draft, setDraft] = useState<Exclusion>(exclusionOf(state));
  const [choice, setChoice] = useState<SchemaChoice>({ profile: state.profile });
  // Vorgabe fuer neue Projekte: Sieht es nach Vorlage aus, ist der Vorrat ausgeschlossen. Der Nutzer entscheidet.
  const [prepared, setPrepared] = useState(state.exclude !== undefined);

  useEffect(() => {
    if (prepared) return;
    let current = true;
    client.call({ type: "scope-overview", exclude: NO_EXCLUSION }).then(
      (overview) => {
        if (!current) return;
        if (overview.template) setDraft({ ...NO_EXCLUSION, reserve: true });
        setPrepared(true);
      },
      () => current && setPrepared(true),
    );
    return () => {
      current = false;
    };
  }, [client, prepared]);

  const index = STEPS.findIndex((entry) => entry.id === step);

  return (
    <div className="ws-page ws-step ws-wizard">
      <div className="ws-wizard__progress">
        <ProgressIndicator currentIndex={index} spaceEqually>
          {STEPS.map((entry) => (
            <ProgressStep key={entry.id} label={entry.label} />
          ))}
        </ProgressIndicator>
      </div>

      {!prepared ? (
        <InlineLoading description="Projekt wird angesehen" />
      ) : step === "scope" ? (
        <>
          <header className="ws-page-header">
            <div>
              <p className="ws-step__kicker">
                Schritt 1 von 3 · {project.name}
                {state.schemaChecked ? " · schon einmal geöffnet, gespeicherter Stand ist geladen" : ""}
              </p>
              <h1>Umfang</h1>
              <p>
                Welche Gruppenadressen sollen ausgewertet werden? Was hier draußen bleibt, taucht weder im Prompt für das Namensschema noch in Things, Rückfragen oder
                Thing Descriptions auf. In der Tabelle bleibt es grau sichtbar, und der Umfang lässt sich später ändern.
              </p>
            </div>
            <div className="ws-step__actions">
              <Button kind="ghost" size="md" onClick={onCancel}>
                Abbrechen
              </Button>
              <Button kind="primary" size="md" onClick={() => setStep("schema")}>
                Weiter zum Namensschema
              </Button>
            </div>
          </header>
          <ScopeEditor client={client} exclude={draft} onChange={setDraft} />
          <div className="ws-wizard__nav">
            <Button kind="primary" size="lg" onClick={() => setStep("schema")}>
              Weiter zum Namensschema
            </Button>
          </div>
        </>
      ) : step === "schema" ? (
        <SchemaStepView
          client={client}
          project={project}
          state={state}
          exclude={draft}
          initialProfile={choice.profile}
          onBack={() => setStep("scope")}
          onCancel={onCancel}
          onDone={(next) => {
            setChoice(next);
            setStep("summary");
          }}
        />
      ) : (
        <Summary client={client} project={project} state={state} exclude={draft} choice={choice} onBack={() => setStep("schema")} onFinish={() => onFinish(choice.profile, draft)} />
      )}
    </div>
  );
}

interface SummaryProps {
  readonly client: AnalysisClient;
  readonly project: OpenResult;
  readonly state: ProjectState;
  readonly exclude: Exclusion;
  readonly choice: SchemaChoice;
  readonly onBack: () => void;
  readonly onFinish: () => void;
}

function Summary({ client, project, state, exclude, choice, onBack, onFinish }: SummaryProps): ReactNode {
  const [overview, setOverview] = useState<ScopeOverview>();
  const [splits, setSplits] = useState<SplitThings>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    let current = true;
    setSplits(undefined);
    client.call({ type: "scope-overview", exclude }).then(
      (next) => current && setOverview(next),
      (error: unknown) => current && setFailure(error instanceof Error ? error.message : String(error)),
    );
    // Nur wenn etwas ausgeschlossen ist, kann ein Thing zerrissen werden.
    if (!isEmptyExclusion(exclude)) {
      client.call({ type: "scope-splits", exclude, profile: choice.profile ?? null, useEtsFunctions: state.useEtsFunctions }).then(
        (next) => current && setSplits(next),
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [client, exclude, choice.profile, state.useEtsFunctions]);

  const waitingForSplits = !isEmptyExclusion(exclude) && splits === undefined;

  return (
    <>
      <header className="ws-page-header">
        <div>
          <p className="ws-step__kicker">Schritt 3 von 3 · {project.name}</p>
          <h1>Zusammenfassung</h1>
          <p>So wird das Projekt ausgewertet. Danach öffnet sich die Werkstatt mit Übersicht, Tabellen, Rückfragen und Export.</p>
        </div>
        <div className="ws-step__actions">
          <Button kind="ghost" size="md" onClick={onBack}>
            Zurück
          </Button>
          <Button kind="primary" size="md" onClick={onFinish}>
            Zur Werkstatt
          </Button>
        </div>
      </header>

      {failure ? <InlineNotification kind="error" lowContrast title="Nicht berechenbar" subtitle={failure} hideCloseButton /> : null}
      {overview ? (
        <div className="ws-wizard__summary">
          <section className="ws-section" aria-labelledby="sum-scope">
            <h2 id="sum-scope">Umfang</h2>
            <ul className="ws-step__list">
              <li>
                Ausgewertet werden {count(overview.included)} von {count(overview.total)} Gruppenadressen.
              </li>
              {overview.excluded > 0 ? (
                <li>
                  Ausgeschlossen sind {count(overview.excluded)}: Vorrat {count(overview.byReason.reserve)}, Hauptgruppen {count(overview.byReason.group)}, einzeln{" "}
                  {count(overview.byReason.single)}.
                </li>
              ) : null}
              {overview.groups.some((group) => group.excluded) ? (
                <li>
                  Abgewählte Hauptgruppen:{" "}
                  {overview.groups
                    .filter((group) => group.excluded)
                    .map((group) => group.name)
                    .join(", ")}
                  .
                </li>
              ) : null}
            </ul>
          </section>

          <section className="ws-section" aria-labelledby="sum-schema">
            <h2 id="sum-schema">Namensschema</h2>
            <ul className="ws-step__list">
              {choice.profile === undefined || choice.profile === null ? (
                <li>Ohne Schema: Die Erkennung arbeitet mit Wortschatz und Verdrahtung.</li>
              ) : choice.name !== undefined ? (
                <li>
                  {choice.name}
                  {choice.evaluated !== undefined && choice.unmatched !== undefined
                    ? `: liest ${count(choice.evaluated - choice.unmatched)} von ${count(choice.evaluated)} ausgewerteten GAs.`
                    : "."}
                </li>
              ) : (
                <li>Gespeichertes Schema aus dem letzten Durchlauf.</li>
              )}
            </ul>
          </section>

          {waitingForSplits ? <InlineLoading description="Prüft, ob der Ausschluss Things auseinanderreißt" /> : null}
          {splits && splits.count > 0 ? (
            <InlineNotification
              kind="warning"
              lowContrast
              hideCloseButton
              title={`${count(splits.count)} Things sind durch den Ausschluss unvollständig`}
              subtitle={`Ein Teil ihrer GAs ist ausgeschlossen, der Rest bleibt. Fehlt die Rückmeldung zu einem Befehl, hat das Thing keine. Beispiele: ${splits.examples
                .map((example) => `${example.thing} (draußen: ${example.dropped.join(", ")})`)
                .join("; ")}.`}
            />
          ) : null}
        </div>
      ) : (
        <InlineLoading description="Umfang wird berechnet" />
      )}

      <div className="ws-wizard__nav">
        <Button kind="primary" size="lg" onClick={onFinish}>
          Zur Werkstatt
        </Button>
        <Button kind="ghost" size="lg" onClick={onBack}>
          Zurück
        </Button>
      </div>
    </>
  );
}
