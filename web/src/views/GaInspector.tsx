import { Close } from "@carbon/icons-react";
import { Button, IconButton, InlineLoading, InlineNotification, Link, Tag } from "@carbon/react";
import { type ReactNode, useEffect, useState } from "react";
import { BUNDLE_LABEL, DIMENSION_LABEL, SOURCE_LABEL } from "../../../src/app/labels.ts";
import { DIMENSIONS, type GaDetail, type GaView } from "../../../src/app/snapshot.ts";
import { dptDotted } from "../../../src/ets/dpt-id.ts";
import { DecisionValue } from "../components/DecisionValue.tsx";
import { ValuePicker } from "../components/ValuePicker.tsx";
import { confidence } from "../format.ts";
import { useWorkspace } from "../workspace.ts";

interface Props {
  readonly ga: GaView;
  readonly onClose: () => void;
}

export function GaInspector({ ga, onClose }: Props): ReactNode {
  const workspace = useWorkspace();
  const { client, snapshot, lookups, state } = workspace;
  const [detail, setDetail] = useState<GaDetail>();
  const [error, setError] = useState<string>();
  const review = state.reviews[ga.id];
  const thing = lookups.thingByKey.get(ga.thingKey);

  useEffect(() => {
    let current = true;
    setError(undefined);
    client.call({ type: "detail", gaId: ga.id }).then(
      (next) => current && setDetail(next),
      (failure: unknown) => current && setError(failure instanceof Error ? failure.message : String(failure)),
    );
    return () => {
      current = false;
    };
  }, [client, ga.id, snapshot]);

  const shown = detail?.id === ga.id ? detail : undefined;
  const questions = ga.questionIds.map((id) => lookups.questionById.get(id)).filter((question) => question !== undefined);
  const unconfirmed = DIMENSIONS.filter((dimension) => ga.decisions[dimension] && review?.[dimension] === undefined);

  return (
    <div className="ws-inspector">
      <div className="ws-inspector__head">
        <div>
          <div className="ws-inspector__ga mono">{ga.text}</div>
          <div className="ws-inspector__name">{ga.name || "ohne Namen"}</div>
          {ga.ranges.length > 0 ? <div className="ws-inspector__path">{ga.ranges.join(" / ")}</div> : null}
        </div>
        <IconButton kind="ghost" size="sm" label="Inspektor schließen" align="left" onClick={onClose}>
          <Close size={16} />
        </IconButton>
      </div>

      <div className="ws-inspector__actions">
        {ga.central ? (
          <Tag size="sm" type="purple">
            Zentral
          </Tag>
        ) : null}
        {ga.outOfUse ? (
          <Tag size="sm" type="gray">
            Stillgelegt
          </Tag>
        ) : null}
        {ga.linked === 0 ? (
          <Tag size="sm" type="warm-gray">
            Unverknüpft
          </Tag>
        ) : (
          <Tag size="sm" type="cool-gray">
            {ga.linked} Verknüpfungen
          </Tag>
        )}
        {ga.readable === false ? (
          <Tag size="sm" type="warm-gray">
            Nicht lesbar
          </Tag>
        ) : null}
      </div>

      {questions.map((question) => (
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

      <h3>Entscheidungen</h3>
      {DIMENSIONS.map((dimension) => {
        const decision = ga.decisions[dimension];
        const reviewed = review?.[dimension] !== undefined;
        return (
          <div key={dimension} className="ws-decision">
            <span className="ws-decision__label">{DIMENSION_LABEL[dimension]}</span>
            <div>
              <DecisionValue decision={decision} />
              {decision ? (
                <div className="ws-decision__evidence">
                  {SOURCE_LABEL[decision.source]}, {confidence(decision.confidence)}: {decision.evidence}
                </div>
              ) : null}
              {decision?.conflict ? (
                <div className="ws-decision__conflict">
                  Widerspruch: {decision.conflict.display} ({SOURCE_LABEL[decision.conflict.source]}: {decision.conflict.evidence})
                </div>
              ) : null}
              <div className="ws-decision__controls">
                <ValuePicker
                  id={`review-${dimension}`}
                  dimension={dimension}
                  label={`${DIMENSION_LABEL[dimension]} festlegen`}
                  hideLabel
                  value={decision?.value}
                  onChange={(value) => workspace.setReview([ga.id], dimension, value)}
                />
                {reviewed ? (
                  <Button kind="ghost" size="sm" onClick={() => workspace.setReview([ga.id], dimension, undefined)}>
                    Zurücksetzen
                  </Button>
                ) : decision ? (
                  <Button kind="tertiary" size="sm" onClick={() => workspace.confirmCurrent([ga.id], [dimension])}>
                    Bestätigen
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      <div className="ws-inspector__actions">
        <Button kind="primary" size="sm" disabled={unconfirmed.length === 0} onClick={() => workspace.confirmCurrent([ga.id])}>
          {unconfirmed.length === 0 ? "Alles bestätigt" : "Alle Werte bestätigen"}
        </Button>
        {review ? (
          <Button kind="ghost" size="sm" onClick={() => workspace.clearReviews([ga.id])}>
            Bestätigungen entfernen
          </Button>
        ) : null}
      </div>

      <h3>Thing</h3>
      {thing ? (
        <p className="ws-inspector__name">
          <Link
            href="#/things"
            onClick={(event) => {
              event.preventDefault();
              workspace.openThing(thing.key);
            }}
          >
            {thing.label}
          </Link>{" "}
          <span className="muted">
            {thing.typeLabel}, {BUNDLE_LABEL[thing.source] ?? thing.source}
            {ga.role ? `, Rolle ${ga.role}` : ""}
          </span>
        </p>
      ) : (
        <p className="muted">Keinem Thing zugeordnet.</p>
      )}

      {error ? <InlineNotification kind="error" lowContrast hideCloseButton title="Details nicht ladbar" subtitle={error} /> : null}
      {!shown && !error ? <InlineLoading description="Belege werden geladen" style={{ marginTop: "1.5rem" }} /> : null}
      {shown ? <DetailSections detail={shown} /> : null}
    </div>
  );
}

function DetailSections({ detail }: { readonly detail: GaDetail }): ReactNode {
  return (
    <>
      {detail.description ? (
        <>
          <h3>Beschreibung</h3>
          <p className="ws-inspector__name">{detail.description}</p>
        </>
      ) : null}
      {detail.etsFunctions.length > 0 ? (
        <>
          <h3>ETS-Funktionen</h3>
          <ul className="ws-list">
            {detail.etsFunctions.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>Belege</h3>
      <table className="ws-claims">
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            <th scope="col">Wert und Begründung</th>
            <th scope="col">Quelle</th>
            <th scope="col" className="ws-claims__num">
              Konf.
            </th>
          </tr>
        </thead>
        <tbody>
          {detail.claims.map((claim, index) => (
            <tr key={`${claim.dimension}-${claim.source}-${claim.value}-${index}`} className={claim.winner ? "ws-claims__winner" : undefined}>
              <td>{DIMENSION_LABEL[claim.dimension]}</td>
              <td>
                {claim.display}
                <span className="ws-claims__evidence">{claim.evidence}</span>
              </td>
              <td>{SOURCE_LABEL[claim.source]}</td>
              <td className="ws-claims__num">{confidence(claim.confidence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="helper" style={{ marginTop: "0.5rem" }}>
        Fett: der Beleg, der entschieden hat. Konfidenzen ordnen Belege, sie sind keine Wahrscheinlichkeiten.
      </p>

      <h3>Verknüpfte Kommunikationsobjekte</h3>
      {detail.links.length === 0 ? (
        <p className="muted">Keine. Werte kommen nur von außen, etwa aus einer Visualisierung.</p>
      ) : (
        <div className="ws-links">
          {detail.links.map((link, index) => (
            <div key={`${link.device}-${link.comObject}-${index}`} className="ws-link">
              <div className="ws-link__head">
                <span className="mono">{link.device}</span>
                <span>{link.product ?? "Gerät ohne Herstellerdaten"}</span>
                {link.cabinet ? (
                  <Tag size="sm" type="blue">
                    Verteiler
                  </Tag>
                ) : null}
                {link.sends ? (
                  <Tag size="sm" type="teal">
                    sendet
                  </Tag>
                ) : null}
                {link.receives ? (
                  <Tag size="sm" type="cool-gray">
                    empfängt
                  </Tag>
                ) : null}
              </div>
              <div className="ws-link__meta">
                KO {link.comObject}
                {link.channel ? `, ${link.channel}` : ""}
                {link.location ? `, Einbauort ${link.location}` : ""}
                {link.flags ? `, Flags ${link.flags}` : ""}
                {link.size ? `, Größe ${link.size}` : ""}
                {link.dpts.length > 0 ? `, DPT ${link.dpts.map(dptDotted).join(" ")}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="helper" style={{ marginTop: "0.5rem" }}>
        Flags: K Kommunikation, L Lesen, S Schreiben, Ü Übertragen, A Aktualisieren, I Lesen bei Init.
      </p>

      {detail.diagnostics.length > 0 ? (
        <>
          <h3>Hinweise</h3>
          <ul className="ws-list">
            {detail.diagnostics.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
