import { Button, Tag, Toggle } from "@carbon/react";
import { type ReactNode, useMemo } from "react";
import { DIMENSION_LABEL, SEVERITY_LABEL, SOURCE_LABEL } from "../../../src/app/labels.ts";
import { checkAccuracy } from "../../../src/app/review-check.ts";
import { DIMENSIONS } from "../../../src/app/snapshot.ts";
import { isClaimSource } from "../../../src/recognize/claims.ts";
import { count, ratio, share, STRENGTH_LABEL, type Strength, strengthOf } from "../format.ts";
import { useWorkspace } from "../workspace.ts";

const STRENGTHS: readonly Strength[] = [4, 3, 2, 1];

export function OverviewView(): ReactNode {
  const workspace = useWorkspace();
  const { snapshot, reviewCheck, state } = workspace;
  const { project } = snapshot;
  const total = project.counts.groupAddresses;
  const reviewed = Object.keys(state.reviews).length;

  const strengths = useMemo(
    () =>
      Object.fromEntries(
        DIMENSIONS.map((dimension) => {
          const tally: Record<Strength, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
          for (const ga of snapshot.gas) {
            const decision = ga.decisions[dimension];
            if (decision) tally[strengthOf(decision.source, decision.confidence)]++;
          }
          return [dimension, tally];
        }),
      ),
    [snapshot],
  );

  const conflicts = snapshot.questions.filter((question) => question.kind === "conflict").length;

  return (
    <div className="ws-page">
      <header className="ws-page-header">
        <div>
          <h1>{project.name}</h1>
          <p>
            {[project.createdBy, project.toolVersion].filter(Boolean).join(" ") || "Unbekannte ETS-Version"}
            {project.schemaVersion !== undefined ? `, Schema ${project.schemaVersion}` : ""}, Gruppenadressen {project.groupAddressStyle}
            {project.passwordProtected ? ", passwortgeschützt" : ""}. Analysiert in {count(workspace.milliseconds)} ms.
          </p>
        </div>
        <Button kind="primary" size="md" onClick={() => workspace.navigate(snapshot.questions.length > 0 ? "rueckfragen" : "gruppenadressen")}>
          {snapshot.questions.length > 0 ? `${count(snapshot.questions.length)} Rückfragen bearbeiten` : "Gruppenadressen ansehen"}
        </Button>
      </header>

      <dl className="ws-figures">
        <Figure label="Gruppenadressen" value={count(total)} />
        <Figure
          label="Geräte"
          value={count(project.counts.devices)}
          note={project.counts.devices > 0 ? `${count(project.counts.devicesWithManufacturerData)} mit Herstellerdaten` : "keine im Projekt"}
        />
        <Figure
          label="ETS-Funktionen"
          value={count(project.counts.etsFunctions)}
          note={state.useEtsFunctions ? "als Beleg genutzt" : "als Beleg abgeschaltet"}
        />
        <Figure label="Räume und Bereiche" value={count(project.counts.spaces)} />
        <Figure label="Things" value={count(snapshot.things.length)} />
        <Figure label="Rückfragen" value={count(snapshot.questions.length)} note={conflicts > 0 ? `${count(conflicts)} Widersprüche` : undefined} />
        <Figure label="Bestätigte GAs" value={count(reviewed)} note={total > 0 ? share(reviewed, total) : undefined} />
      </dl>

      <section className="ws-section" aria-labelledby="coverage-title">
        <h2 id="coverage-title">Entschieden je Dimension</h2>
        <p>Anteil der Gruppenadressen mit einem Wert, gestaffelt nach Belegstärke. Schwache Belege sind Vorschläge, die eine Bestätigung verdienen.</p>
        <div className="ws-coverage">
          {DIMENSIONS.map((dimension) => {
            const tally = strengths[dimension] ?? { 1: 0, 2: 0, 3: 0, 4: 0 };
            const decided = snapshot.coverage[dimension].decided;
            const bySource = Object.entries(snapshot.coverage[dimension].bySource)
              .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
              .map(([source, value]) => `${isClaimSource(source) ? SOURCE_LABEL[source] : source}: ${count(value ?? 0)}`)
              .join(", ");
            return (
              <div key={dimension} className="ws-coverage__row" title={bySource}>
                <span className="ws-coverage__label">{DIMENSION_LABEL[dimension]}</span>
                <div className="ws-bar" role="img" aria-label={`${DIMENSION_LABEL[dimension]}: ${share(decided, total)} entschieden. ${bySource}`}>
                  {STRENGTHS.map((strength) =>
                    tally[strength] > 0 ? (
                      <span
                        key={strength}
                        className="ws-bar__part"
                        data-strength={strength}
                        style={{ width: `${(tally[strength] / Math.max(total, 1)) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>
                <span className="ws-coverage__value">{share(decided, total)}</span>
              </div>
            );
          })}
        </div>
        <div className="ws-legend" aria-hidden="true">
          {STRENGTHS.map((strength) => (
            <span key={strength}>
              <span className="ws-bar__part" data-strength={strength} />
              {STRENGTH_LABEL[strength]}
            </span>
          ))}
          <span>
            <span className="ws-bar__part" style={{ background: "var(--cds-layer-accent-01)" }} />
            offen
          </span>
        </div>
      </section>

      <section className="ws-section" aria-labelledby="check-title">
        <h2 id="check-title">Trefferquote gegen Ihre Bestätigungen</h2>
        {reviewCheck ? (
          <>
            <p>
              Die Erkennung ohne Ihre Antworten, gemessen an dem, was Sie bestätigt oder korrigiert haben. Dieser Wert gehört in den Bericht an die Entwicklung.
            </p>
            <div className="ws-table-scroll">
              <table className="ws-diagnostics">
                <thead>
                  <tr>
                    <th scope="col">Dimension</th>
                    <th scope="col" className="ws-diagnostics__num">
                      Bestätigt
                    </th>
                    <th scope="col" className="ws-diagnostics__num">
                      Richtig
                    </th>
                    <th scope="col" className="ws-diagnostics__num">
                      Teilweise
                    </th>
                    <th scope="col" className="ws-diagnostics__num">
                      Falsch
                    </th>
                    <th scope="col" className="ws-diagnostics__num">
                      Ohne Wert
                    </th>
                    <th scope="col" className="ws-diagnostics__num">
                      Trefferquote
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {DIMENSIONS.map((dimension) => {
                    const tally = reviewCheck.byDimension[dimension];
                    const accuracy = checkAccuracy(tally);
                    return (
                      <tr key={dimension}>
                        <td>{DIMENSION_LABEL[dimension]}</td>
                        <td className="ws-diagnostics__num">{count(tally.rated)}</td>
                        <td className="ws-diagnostics__num">{count(tally.correct)}</td>
                        <td className="ws-diagnostics__num">{count(tally.partial)}</td>
                        <td className="ws-diagnostics__num">{count(tally.wrong)}</td>
                        <td className="ws-diagnostics__num">{count(tally.missing)}</td>
                        <td className="ws-diagnostics__num">{accuracy === undefined ? "–" : ratio(accuracy)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>
            Noch nichts bestätigt. Jede Bestätigung in Gruppenadressen oder Rückfragen wird zum Prüfwert: die Werkstatt misst daran, wie gut die Erkennung ohne
            Ihre Antworten lag.
          </p>
        )}
      </section>

      <section className="ws-section" aria-labelledby="settings-title">
        <h2 id="settings-title">Erkennung</h2>
        <Toggle
          id="ets-funktionen"
          size="sm"
          labelText="ETS-Funktionen als Beleg nutzen"
          labelA="Aus"
          labelB="Ein"
          toggled={state.useEtsFunctions}
          onToggle={(value) => workspace.setUseEtsFunctions(value)}
        />
        <p className="helper" style={{ marginTop: "0.5rem", maxWidth: "68ch" }}>
          Ausgeschaltet zeigt sich, was die Erkennung allein aus Namen, Gebäudestruktur, Verdrahtung und Namensschema schafft. Viele Projekte pflegen keine
          ETS-Funktionen.
        </p>
        {snapshot.profileWarnings.length > 0 || workspace.profileErrors.length > 0 ? (
          <ul className="ws-list" style={{ marginTop: "1rem" }}>
            {[...workspace.profileErrors, ...snapshot.profileWarnings].map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {snapshot.unknownCodes.length > 0 ? (
          <p style={{ marginTop: "1rem" }}>
            {count(snapshot.unknownCodes.length)} wiederkehrende Kürzel ohne Bedeutung, zum Beispiel{" "}
            {snapshot.unknownCodes
              .slice(0, 5)
              .map((code) => `"${code.token}"`)
              .join(", ")}
            .{" "}
            <Button kind="ghost" size="sm" onClick={() => workspace.navigate("namensschema")}>
              Im Namensschema erklären
            </Button>
          </p>
        ) : null}
      </section>

      <section className="ws-section" aria-labelledby="diagnostics-title">
        <h2 id="diagnostics-title">Hinweise aus dem Projekt</h2>
        {snapshot.diagnostics.length === 0 ? (
          <p>Keine Auffälligkeiten in Verknüpfungen und Datenpunkttypen.</p>
        ) : (
          <div className="ws-table-scroll">
            <table className="ws-diagnostics">
              <thead>
                <tr>
                  <th scope="col">Art</th>
                  <th scope="col">Prüfung</th>
                  <th scope="col" className="ws-diagnostics__num">
                    Anzahl
                  </th>
                  <th scope="col">Beispiel</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.diagnostics.map((item) => (
                  <tr key={item.code}>
                    <td>
                      <Tag size="sm" type={item.severity === "error" ? "red" : item.severity === "warning" ? "warm-gray" : "cool-gray"}>
                        {SEVERITY_LABEL[item.severity] ?? item.severity}
                      </Tag>
                    </td>
                    <td className="mono">{item.code}</td>
                    <td className="ws-diagnostics__num">{count(item.count)}</td>
                    <td>{item.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value, note }: { readonly label: string; readonly value: string; readonly note?: string | undefined }): ReactNode {
  return (
    <div className="ws-figure">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <dd className="ws-figure__note">{note}</dd> : null}
    </div>
  );
}
