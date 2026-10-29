import { Copy, Download, TrashCan, Upload } from "@carbon/icons-react";
import { Button, Checkbox, InlineLoading, InlineNotification, Tag, TextArea, TextInput } from "@carbon/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { GapAction, SiteInput } from "../../../src/assets/model.ts";
import { countReview, type Decision, type Decisions } from "../../../src/assets/review.ts";
import { extractJson } from "../../../src/recognize/schema-prompt.ts";
import { count, fileStem } from "../format.ts";
import type { AssetModelResult } from "../protocol.ts";
import { download, downloadBlob } from "../storage.ts";
import { AssetTrees, type ReviewFilter } from "../components/AssetTrees.tsx";
import { Figure } from "../components/Figure.tsx";
import { useWorkspace } from "../workspace.ts";

const ACTION_LABEL: Readonly<Record<GapAction, string>> = {
  "extend-model": "Modell erweitern",
  generated: "eigener Typ",
  review: "prüfen",
  info: "Hinweis",
};
const ACTION_TAG: Readonly<Record<GapAction, "red" | "purple" | "warm-gray" | "gray">> = { "extend-model": "red", generated: "purple", review: "warm-gray", info: "gray" };

const MAX_PROFILE_BYTES = 512 * 1024;

const SITE_FIELDS: readonly { readonly key: keyof SiteInput; readonly label: string; readonly placeholder: string }[] = [
  { key: "country", label: "Land", placeholder: "z. B. Germany" },
  { key: "region", label: "Region", placeholder: "z. B. Baden-Württemberg" },
  { key: "site", label: "Standort", placeholder: "z. B. Villa Nord" },
  { key: "codePrefix", label: "Kennungs-Präfix", placeholder: "z. B. VILLA" },
];

/**
 * Building Pro Integration: Asset-Struktur nach einer Ontologie aus der Erkennung. Das Zielprofil ist eine private
 * Datei des Nutzers; ohne Profil entstehen alle Typen aus der Erkennung.
 */
export function AssetView(): ReactNode {
  const workspace = useWorkspace();
  const { client, snapshot, state, project } = workspace;
  const assets = useMemo(() => state.assets ?? { site: {} }, [state.assets]);
  // Standort als Schluessel, damit gleiche Eingaben keine neue Rechnung ausloesen.
  const siteKey = JSON.stringify(assets.site);
  const [site, setSite] = useState<SiteInput>(assets.site);
  const [result, setResult] = useState<AssetModelResult>();
  const [error, setError] = useState<string>();
  const [zipping, setZipping] = useState(false);
  const [answer, setAnswer] = useState("");
  const [answerError, setAnswerError] = useState<readonly string[]>();
  const [notice, setNotice] = useState<string>();
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const fileInput = useRef<HTMLInputElement>(null);

  // Eingaben wirken nach einer kurzen Pause, damit nicht jeder Tastendruck neu rechnet.
  const { setAssets } = workspace;
  useEffect(() => {
    if (JSON.stringify(site) === siteKey) return;
    const timer = window.setTimeout(() => setAssets({ ...assets, site }), 400);
    return () => window.clearTimeout(timer);
  }, [site, siteKey, assets, setAssets]);

  useEffect(() => {
    let current = true;
    setError(undefined);
    client.call({ type: "asset-model", profile: assets.profile, site: JSON.parse(siteKey) as SiteInput, toolVersion: __WERKSTATT_VERSION__ }).then(
      (next) => current && setResult(next),
      (failure: unknown) => current && setError(failure instanceof Error ? failure.message : String(failure)),
    );
    return () => {
      current = false;
    };
  }, [client, snapshot, assets.profile, siteKey]);

  const loadProfile = async (file: File): Promise<void> => {
    // Das Profil liegt in jedem Projektstand im Browser; zu grosse Dateien wuerden das Speichern aller Antworten verhindern.
    if (file.size > MAX_PROFILE_BYTES) {
      setError(`Das Zielprofil ist ${count(Math.round(file.size / 1024))} KB groß; erlaubt sind ${count(MAX_PROFILE_BYTES / 1024)} KB.`);
      return;
    }
    try {
      const json: unknown = JSON.parse(await file.text());
      workspace.setAssets({ ...assets, profile: json });
      setNotice(`Zielprofil "${file.name}" geladen. Es bleibt nur in diesem Browser gespeichert.`);
    } catch (failure) {
      setError(`Keine gültige JSON-Datei (${failure instanceof Error ? failure.message : String(failure)}).`);
    }
  };

  const zip = async (): Promise<void> => {
    setZipping(true);
    try {
      const data = await client.call({ type: "asset-zip", profile: assets.profile, site: assets.site, toolVersion: __WERKSTATT_VERSION__, decisions, onlyApproved: assets.onlyApproved === true });
      downloadBlob(`${fileStem(project.name)}-asset-model.zip`, new Blob([data], { type: "application/zip" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setZipping(false);
    }
  };

  const applyAnswer = async (): Promise<void> => {
    try {
      const json = extractJson(answer);
      const merged = await client.call({ type: "asset-answer", profile: assets.profile, answer: json });
      if (!merged.ok) {
        setAnswerError(merged.errors);
        return;
      }
      setAnswerError(undefined);
      setAnswer("");
      workspace.setAssets({ ...assets, profile: merged.profile });
      setNotice(
        `Regeln übernommen. Das ergänzte Zielprofil gilt jetzt; speichern, um es zu behalten.${merged.warnings.length > 0 ? ` Hinweise: ${merged.warnings.slice(0, 4).join(" ")}` : ""}`,
      );
    } catch (failure) {
      setAnswerError([failure instanceof Error ? failure.message : String(failure)]);
    }
  };

  const decisions: Decisions = useMemo(() => assets.decisions ?? {}, [assets.decisions]);
  const decide = (ids: readonly string[], decision: Decision | undefined): void => {
    const next: Record<string, Decision> = { ...decisions };
    for (const id of ids) {
      if (decision === undefined) delete next[id];
      else next[id] = decision;
    }
    workspace.setAssets({ ...assets, decisions: next });
  };

  const ok = result?.ok ? result : undefined;
  const review = useMemo(() => (ok ? countReview(ok.assets, decisions) : undefined), [ok, decisions]);
  const hasProfile = assets.profile !== undefined;
  const extendCount = ok?.gaps.filter((gap) => gap.action === "extend-model").length ?? 0;

  return (
    <div className="ws-page ws-assets">
      <header className="ws-page-header">
        <div>
          <h1>Building Pro Integration</h1>
          <p>
            Asset-Struktur nach einer Ontologie: Ortsbaum mit Land, Region und Standort über der ETS-Gebäudestruktur, je Thing ein Asset mit einem Typ aus dem Zielprofil
            und je Datenpunkt ein Attribut mit seinen Gruppenadressen. Dazu eine Liste, wo das Asset-Modell erweitert werden muss. Die Dateien sind englisch.
          </p>
        </div>
        <Button kind="primary" size="md" renderIcon={Download} disabled={!ok || zipping} onClick={() => void zip()}>
          {zipping ? "ZIP wird erstellt" : "Als ZIP herunterladen"}
        </Button>
      </header>

      {notice ? <InlineNotification kind="success" lowContrast title="Erledigt" subtitle={notice} onClose={() => setNotice(undefined)} /> : null}
      {error ? <InlineNotification kind="error" lowContrast title="Fehler" subtitle={error} onClose={() => setError(undefined)} /> : null}

      <div className="ws-assets__inputs">
        <section className="ws-section" aria-labelledby="assets-profile">
          <h2 id="assets-profile">Zielprofil</h2>
          <p>
            Welche Asset-Typen, Klassen und Attribute die Zielplattform kennt und wie KNX darauf abgebildet wird. Das Profil ist eine eigene JSON-Datei
            ({"knx-asset-profile-1"}); es wird nicht hochgeladen und liegt nur in diesem Browser.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadProfile(file);
              event.target.value = "";
            }}
          />
          <div className="ws-step__row">
            <Button kind="tertiary" size="sm" renderIcon={Upload} onClick={() => fileInput.current?.click()}>
              {hasProfile ? "Anderes Profil laden" : "Zielprofil laden"}
            </Button>
            {hasProfile ? (
              <>
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={Download}
                  onClick={() => download(`${fileStem(ok?.profileName ?? "zielprofil")}.asset-profile.json`, JSON.stringify(assets.profile, null, 2))}
                >
                  Profil speichern
                </Button>
                <Button kind="ghost" size="sm" renderIcon={TrashCan} onClick={() => workspace.setAssets({ site: assets.site })}>
                  Profil entfernen
                </Button>
              </>
            ) : null}
          </div>
          {ok ? <p className="helper">{hasProfile ? `Geladen: ${ok.profileName}.` : "Kein Profil geladen: Alle Typen entstehen aus der Erkennung."}</p> : null}
          {result && !result.ok ? (
            <InlineNotification kind="error" lowContrast hideCloseButton title="Zielprofil abgelehnt" subtitle={result.errors.slice(0, 6).join(" ")} />
          ) : null}
          {ok && ok.profileWarnings.length > 0 ? (
            <details className="ws-step__warnings">
              <summary>{count(ok.profileWarnings.length)} Hinweise zum Profil</summary>
              <ul className="ws-list">
                {ok.profileWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section className="ws-section" aria-labelledby="assets-site">
          <h2 id="assets-site">Standort</h2>
          <p>Die ETS kennt weder Land noch Region. Leere Felder entfallen; der Standort ist immer die Wurzel unter Land und Region.</p>
          <div className="ws-assets__site">
            {SITE_FIELDS.map((field) => (
              <TextInput
                key={field.key}
                id={`site-${field.key}`}
                size="md"
                labelText={field.label}
                placeholder={field.placeholder}
                maxLength={120}
                value={site[field.key] ?? ""}
                onChange={(event) => setSite((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            ))}
          </div>
        </section>
      </div>

      {!result && !error ? <InlineLoading description="Asset-Modell wird gebaut" /> : null}
      {ok ? (
        <>
          <dl className="ws-figures">
            <Figure label="Assets" value={count(ok.stats.assets)} note={`${count(ok.stats.equipment)} Geräte, ${count(ok.stats.spaces)} Räume und Bereiche`} />
            <Figure label="Attribute gebunden" value={count(ok.stats.bindings)} note={`auf ${count(ok.stats.groupAddresses)} Gruppenadressen`} />
            <Figure label="Typen aus dem Profil" value={count(ok.stats.typesFromProfile)} note={ok.stats.typesExtended > 0 ? `${count(ok.stats.typesExtended)} davon erweitert` : undefined} />
            <Figure label="Eigene Typen" value={count(ok.stats.typesGenerated)} note="vom Export angelegt" />
            <Figure label="Modell erweitern" value={count(extendCount)} note="Lücken, die das Asset-Modell betreffen" />
          </dl>

          {review && review.total > 0 ? (
            <section className="ws-section" aria-labelledby="assets-review">
              <h2 id="assets-review">Prüfung</h2>
              <p>
                Jedes Gerät trägt eine Konfidenz aus den Belegen, mit den Gründen im Panel. Sie ist keine Wahrscheinlichkeit: Hoch heißt, dass Bündelung (ETS-Funktion, Aktorkanal,
                Namensschema), Typ, Raum und Datenpunkttypen stimmig sind. Gemessen an den Gold-Standards liegt die Bündelung über ETS-Funktionen bei 100 %, über Aktorkanäle bei
                98 %, über Namensähnlichkeit bei 86 % und bei einzelnen Gruppenadressen bei 50 %. Freigeben heißt, dass ein Mensch das Gerät geprüft hat; Ablehnen nimmt es aus dem ZIP.
              </p>
              <dl className="ws-figures">
                <Figure label="Hohe Konfidenz" value={count(review.byConfidence.high)} note={`${count(review.openHigh)} davon noch offen`} />
                <Figure label="Mittlere Konfidenz" value={count(review.byConfidence.medium)} />
                <Figure label="Niedrige Konfidenz" value={count(review.byConfidence.low)} />
                <Figure label="Freigegeben" value={count(review.approved)} note={`von ${count(review.total)} Geräten`} />
                <Figure label="Abgelehnt" value={count(review.rejected)} note={review.rejected > 0 ? "fehlen im ZIP" : undefined} />
              </dl>
              <div className="ws-step__row">
                <Button
                  kind="tertiary"
                  size="sm"
                  disabled={review.openHigh === 0}
                  onClick={() => {
                    decide(
                      ok?.assets.filter((asset) => asset.kind === "equipment" && asset.review?.confidence === "high" && !Object.hasOwn(decisions, asset.id)).map((asset) => asset.id) ?? [],
                      "approved",
                    );
                    setFilter("attention");
                  }}
                >
                  {review.openHigh > 0 ? `${count(review.openHigh)} offene mit hoher Konfidenz freigeben` : "Keine offenen mit hoher Konfidenz"}
                </Button>
                <Button kind="ghost" size="sm" disabled={review.approved + review.rejected === 0} onClick={() => decide(Object.keys(decisions), undefined)}>
                  Alle Entscheidungen zurücksetzen
                </Button>
              </div>
              <Checkbox
                id="assets-only-approved"
                labelText="Nur freigegebene Geräte ins ZIP aufnehmen"
                helperText="Räume, Ebenen und Systeme bleiben; Geräte ohne Freigabe entfallen. Ohne Haken entfallen nur die abgelehnten."
                checked={assets.onlyApproved === true}
                onChange={(_, { checked }) => workspace.setAssets({ ...assets, onlyApproved: checked })}
              />
            </section>
          ) : null}

          <section className="ws-section" aria-labelledby="assets-trees">
            <h2 id="assets-trees">Zwei Bäume, ein Asset</h2>
            <p>
              Jedes Asset steht im Ortsbaum (wo ist es?) und, wenn es zu einer Funktion gehört, im Funktionsbaum (wozu gehört es?). Ein Klick markiert es in beiden
              Bäumen. Der Funktionsbaum entsteht aus den Gewerken und den Zentralfunktionen; was eine Zentral-GA schaltet, steht darunter. Der Punkt hinter dem Typ zeigt
              die Konfidenz (grün hoch, grau mittel, rot niedrig), im Panel steht die Entscheidung.
            </p>
            <AssetTrees assets={ok.assets} types={ok.types} decisions={decisions} onDecide={(id, decision) => decide([id], decision)} filter={filter} onFilter={setFilter} />
          </section>

          <section className="ws-section" aria-labelledby="assets-gaps">
            <h2 id="assets-gaps">Wo das Asset-Modell nicht passt</h2>
            <p>Jede Zeile ist ein KNX-Konzept, das das Modell so nicht ausdrücken kann, mit Anzahl in diesem Projekt. Im ZIP steht dazu die englische Begründung (gaps.md).</p>
            <div className="ws-table-scroll">
              <table className="cds--data-table cds--data-table--sm ws-assets__table">
                <thead>
                  <tr>
                    <th scope="col">Lücke</th>
                    <th scope="col">Art</th>
                    <th scope="col" className="ws-scope__num">
                      Anzahl
                    </th>
                    <th scope="col">Beispiele</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.gaps.map((gap) => (
                    <tr key={gap.id}>
                      <td title={gap.detail}>{gap.title}</td>
                      <td>
                        <Tag size="sm" type={ACTION_TAG[gap.action]}>
                          {ACTION_LABEL[gap.action]}
                        </Tag>
                      </td>
                      <td className="ws-scope__num">{count(gap.count)}</td>
                      <td>{gap.examples.slice(0, 2).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ws-section" aria-labelledby="assets-types">
            <h2 id="assets-types">Asset-Typen</h2>
            <p>Die Vorlagenbibliothek dieses Projekts. Erweiterte Profiltypen tragen Attribute, die das Profil nicht kennt.</p>
            <div className="ws-table-scroll">
              <table className="cds--data-table cds--data-table--sm ws-assets__table">
                <thead>
                  <tr>
                    <th scope="col">Typ</th>
                    <th scope="col">Klasse</th>
                    <th scope="col">Herkunft</th>
                    <th scope="col" className="ws-scope__num">
                      Assets
                    </th>
                    <th scope="col">Attribute</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.types.map((type) => (
                    <tr key={type.key}>
                      <td className="mono">{type.key}</td>
                      <td className="mono">{type.class}</td>
                      <td>{type.origin === "generated" ? "eigener Typ" : type.extended ? "Profil, erweitert" : "Profil"}</td>
                      <td className="ws-scope__num">{count(type.assets)}</td>
                      <td>
                        {type.attributes.map((attribute) => (
                          <span key={attribute.name} className={attribute.origin === "extension" ? "ws-assets__attr ws-assets__attr--ext" : "ws-assets__attr"} title={`${attribute.subtype}${attribute.dpt ? `, DPT ${attribute.dpt}` : ""}`}>
                            {attribute.name}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {ok.prompt ? (
            <section className="ws-section" aria-labelledby="assets-ai">
              <h2 id="assets-ai">Zuordnung per KI</h2>
              <p>
                Für eigene Typen und fehlende Attribute schlägt ein LLM Regeln vor, die nur auf vorhandene Profiltypen zeigen dürfen. Die App prüft die Antwort wie ein
                Profil und schickt selbst nichts weg.
              </p>
              <InlineNotification
                kind="info"
                lowContrast
                hideCloseButton
                title="Datenschutz"
                subtitle="Der Prompt enthält die Typen des Zielprofils und Namen von Things aus diesem Projekt. Profil und Projekt sind vertraulich; nur in ein LLM geben, das dafür freigegeben ist."
              />
              <div className="ws-step__row">
                <Button kind="tertiary" size="sm" renderIcon={Copy} onClick={() => void navigator.clipboard.writeText(ok.prompt ?? "").then(() => setNotice("Prompt kopiert."), () => setError("Kopieren nicht erlaubt."))}>
                  Prompt kopieren
                </Button>
              </div>
              <TextArea id="asset-answer" labelText="Antwort des LLM" rows={5} value={answer} onChange={(event) => setAnswer(event.target.value)} />
              <div className="ws-step__row">
                <Button kind="primary" size="sm" disabled={answer.trim() === ""} onClick={() => void applyAnswer()}>
                  Antwort prüfen und übernehmen
                </Button>
              </div>
              {answerError ? <InlineNotification kind="error" lowContrast title="Antwort abgelehnt" subtitle={answerError.slice(0, 6).join(" ")} onClose={() => setAnswerError(undefined)} /> : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
