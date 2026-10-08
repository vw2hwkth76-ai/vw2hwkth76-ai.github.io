import { Copy, Download } from "@carbon/icons-react";
import { Button, ContentSwitcher, InlineLoading, InlineNotification, Select, SelectItem, Switch, TextInput, Toggle } from "@carbon/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { TdOptions, TdThingEntry } from "../../../src/td/render.ts";
import { isRecord } from "../../../src/util/guards.ts";
import { type Column, VirtualTable } from "../components/VirtualTable.tsx";
import { count, fileStem } from "../format.ts";
import type { TdResult } from "../protocol.ts";
import { download, downloadBlob } from "../storage.ts";
import { Figure } from "../components/Figure.tsx";
import { useWorkspace } from "../workspace.ts";

type Pane = "field" | "platform" | "model";
const PANES: readonly Pane[] = ["field", "platform", "model"];

const COLUMNS: readonly Column<TdThingEntry>[] = [
  { id: "title", header: "Thing", sort: (thing) => thing.title, cell: (thing) => thing.title, primary: true, title: (thing) => thing.title },
  { id: "properties", header: "Properties", width: "8.5rem", sort: (thing) => thing.properties, cell: (thing) => count(thing.properties) },
  { id: "actions", header: "Actions", width: "7rem", sort: (thing) => thing.actions, cell: (thing) => count(thing.actions) },
  { id: "excluded", header: "Ohne GA", width: "7.5rem", sort: (thing) => thing.excluded, cell: (thing) => (thing.excluded > 0 ? count(thing.excluded) : "") },
];

/** Basis-URL pruefen: absolut und mit Schraegstrich am Ende, damit relative hrefs sauber aufloesen. */
function validBase(value: string, schemes: readonly string[]): string | undefined {
  try {
    const url = new URL(value);
    if (!schemes.includes(url.protocol)) return `Erwartet ${schemes.map((scheme) => `${scheme}//`).join(" oder ")}`;
    if (!value.endsWith("/")) return "Muss mit / enden";
    return undefined;
  } catch {
    return "Keine gültige URL";
  }
}

function modelPathOf(fieldText: string | undefined): string | undefined {
  if (!fieldText) return undefined;
  const json: unknown = JSON.parse(fieldText);
  if (!isRecord(json) || !Array.isArray(json["links"])) return undefined;
  const link = json["links"].find((entry: unknown) => isRecord(entry) && entry["rel"] === "type");
  const href = isRecord(link) && typeof link["href"] === "string" ? link["href"] : undefined;
  return href?.replace(/^\.\.\//, "");
}

export function TdView(): ReactNode {
  const workspace = useWorkspace();
  const { client, snapshot, state, project } = workspace;
  const options = state.td;
  const [result, setResult] = useState<TdResult>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [pane, setPane] = useState<Pane>("field");
  const [gateway, setGateway] = useState(options.gateway);
  const [platform, setPlatform] = useState(options.platform);
  const [notice, setNotice] = useState<string>();
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    let current = true;
    setError(undefined);
    client.call({ type: "td", options, toolVersion: __WERKSTATT_VERSION__ }).then(
      (next) => current && setResult(next),
      (failure: unknown) => current && setError(failure instanceof Error ? failure.message : String(failure)),
    );
    return () => {
      current = false;
    };
  }, [client, snapshot, options]);

  const files = useMemo(() => new Map(result?.files.map((file) => [file.path, file.text]) ?? []), [result]);
  const active = result?.things.find((thing) => thing.key === selected) ?? result?.things[0];
  const modelPath = modelPathOf(active ? files.get(active.fieldPath) : undefined);
  const path = active ? (pane === "field" ? active.fieldPath : pane === "platform" ? active.platformPath : modelPath) : undefined;
  const text = path ? files.get(path) : undefined;
  const gatewayError = validBase(gateway, ["knx:", "knxip:", "knx-ip:"]);
  const platformError = validBase(platform, ["https:", "http:"]);

  const update = (change: Partial<TdOptions>): void => workspace.setTdOptions({ ...options, ...change });
  const totals = result
    ? {
        properties: result.things.reduce((sum, thing) => sum + thing.properties, 0),
        actions: result.things.reduce((sum, thing) => sum + thing.actions, 0),
      }
    : undefined;

  const downloadZip = async (): Promise<void> => {
    setZipping(true);
    try {
      const zip = await client.call({ type: "td-zip", options, toolVersion: __WERKSTATT_VERSION__ });
      downloadBlob(`${fileStem(project.name)}-thing-descriptions.zip`, new Blob([zip], { type: "application/zip" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setZipping(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${path} kopiert.`);
    } catch {
      setNotice("Kopieren nicht erlaubt. Bitte den Text markieren und kopieren.");
    }
  };

  return (
    <div className="ws-page">
      <header className="ws-page-header">
        <div>
          <h1>Thing Descriptions</h1>
          <p>
            Je Thing eine Feld-TD mit KNX-Forms und eine Plattform-TD mit HTTP-Forms, verbunden über proxy-to, dazu Thing Models je KNX-Funktionstyp. Jede
            KNX-Form trägt ihre Herkunft; unsichere Werte bleiben sichtbar statt verschwiegen.
          </p>
        </div>
        <Button kind="primary" size="md" renderIcon={Download} disabled={!result || zipping || result.things.length === 0} onClick={() => void downloadZip()}>
          {zipping ? "ZIP wird erstellt" : "Alle als ZIP"}
        </Button>
      </header>

      {notice ? <InlineNotification kind="info" lowContrast title="Hinweis" subtitle={notice} onClose={() => setNotice(undefined)} /> : null}
      {error ? <InlineNotification kind="error" lowContrast title="Erzeugung fehlgeschlagen" subtitle={error} onClose={() => setError(undefined)} /> : null}

      <section className="ws-td-options" aria-labelledby="td-options">
        <h2 id="td-options" className="ws-sr-only">
          Optionen
        </h2>
        <Select
          id="td-version"
          size="md"
          labelText="Format"
          value={options.version}
          onChange={(event) => update({ version: event.target.value === "2.0" ? "2.0" : "1.1" })}
        >
          <SelectItem value="1.1" text="TD 1.1 (Recommendation)" />
          <SelectItem value="2.0" text="TD 2.0 (Working Draft)" />
        </Select>
        <Select
          id="td-commands"
          size="md"
          labelText="Befehle"
          value={options.commands}
          onChange={(event) => update({ commands: event.target.value === "action" ? "action" : "property" })}
        >
          <SelectItem value="property" text="Property mit Schreib- und Lese-Form" />
          <SelectItem value="action" text="Action plus Status-Property" />
        </Select>
        <TextInput
          id="td-gateway"
          size="md"
          labelText="Gateway-Basis (Feld-TD)"
          value={gateway}
          invalid={gatewayError !== undefined}
          invalidText={gatewayError}
          onChange={(event) => setGateway(event.target.value)}
          onBlur={() => gatewayError === undefined && gateway !== options.gateway && update({ gateway })}
          onKeyDown={(event) => event.key === "Enter" && gatewayError === undefined && update({ gateway })}
        />
        <TextInput
          id="td-platform"
          size="md"
          labelText="Plattform-URL (Plattform-TD)"
          value={platform}
          invalid={platformError !== undefined}
          invalidText={platformError}
          onChange={(event) => setPlatform(event.target.value)}
          onBlur={() => platformError === undefined && platform !== options.platform && update({ platform })}
          onKeyDown={(event) => event.key === "Enter" && platformError === undefined && update({ platform })}
        />
        <Toggle
          id="td-strict"
          size="sm"
          labelText="Nur fest belegte oder bestätigte GAs"
          labelA="Aus"
          labelB="Ein"
          toggled={options.strict}
          onToggle={(value) => update({ strict: value })}
        />
      </section>

      {!result ? (
        <InlineLoading description="Thing Descriptions werden erzeugt" />
      ) : (
        <>
          <dl className="ws-figures" style={{ marginTop: "1.5rem" }}>
            <Figure
              label="Things"
              value={count(result.things.length)}
              note={result.skipped.length > 0 ? `${count(result.skipped.length)} übersprungen` : undefined}
            />
            <Figure label="Properties" value={count(totals?.properties ?? 0)} />
            <Figure label="Actions" value={count(totals?.actions ?? 0)} />
            <Figure
              label="GAs ausgeschlossen"
              value={count(result.excludedGroupAddresses)}
              note={options.strict ? "nicht fest belegt oder stillgelegt" : "stillgelegt"}
            />
            <Figure label="Dateien" value={count(result.files.length + 1)} note={`erzeugt in ${count(result.milliseconds)} ms`} />
          </dl>

          <div className="ws-td-grid">
            <section aria-label="Things" className="ws-td-list">
              <VirtualTable<TdThingEntry>
                label="Things mit Thing Description"
                rows={result.things}
                columns={COLUMNS}
                rowId={(thing) => thing.key}
                activeId={active?.key}
                onActivate={(thing) => setSelected(thing.key)}
                empty={
                  <div className="ws-empty">
                    <h3>Kein Thing mit Thing Description</h3>
                    <p>
                      {options.strict
                        ? "Im strengen Modus ist keine GA fest belegt. Werte bestätigen oder den Schalter lösen."
                        : "Das Projekt enthält keine nutzbaren GAs."}
                    </p>
                  </div>
                }
              />
            </section>
            <section aria-label="Vorschau" className="ws-td-preview">
              <div className="ws-td-preview__bar">
                <ContentSwitcher
                  size="sm"
                  selectedIndex={PANES.indexOf(pane)}
                  onChange={({ index }) => {
                    const next = typeof index === "number" ? PANES[index] : undefined;
                    if (next) setPane(next);
                  }}
                >
                  <Switch name="field" text="Feld-TD" />
                  <Switch name="platform" text="Plattform-TD" />
                  <Switch name="model" text="Thing Model" disabled={!modelPath} />
                </ContentSwitcher>
                <Button kind="ghost" size="sm" renderIcon={Copy} hasIconOnly iconDescription="Kopieren" disabled={!text} onClick={() => void copy()} />
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={Download}
                  hasIconOnly
                  iconDescription="Datei herunterladen"
                  disabled={!text || !path}
                  onClick={() => text && path && download(path.split("/").pop() ?? "td.json", text, "application/td+json")}
                />
              </div>
              <div className="helper ws-td-preview__path">{path ?? "Kein Thing Model für diesen Typ; nur KNX-Funktionstypen haben eines."}</div>
              <pre className="ws-summary ws-td-code" tabIndex={0} aria-label={path ? `Inhalt von ${path}` : "Kein Inhalt"}>
                {text ?? ""}
              </pre>
            </section>
          </div>

          {result.skipped.length > 0 ? (
            <section className="ws-section" aria-labelledby="td-skipped">
              <h2 id="td-skipped">Übersprungene Things</h2>
              <div className="ws-table-scroll">
                <table className="ws-diagnostics">
                  <thead>
                    <tr>
                      <th scope="col">Thing</th>
                      <th scope="col">Grund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((entry) => (
                      <tr key={entry.key}>
                        <td>{entry.title}</td>
                        <td>{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="ws-section" aria-labelledby="td-notes">
            <h2 id="td-notes">Einordnung</h2>
            <ul className="ws-list">
              <li>KNX-Forms: href ist die Gruppenadresse relativ zur Gateway-Basis; kb:dpt nennt den Datenpunkttyp, kb:evidence Quelle und Konfidenz.</li>
              <li>Gelesen wird nur, wo ein Objekt Lesetelegramme beantwortet. Ohne Herstellerdaten steht kb:readVerified: false an der Form.</li>
              <li>@type aus Brick 1.4; Einheiten aus QUDT. Für das KNX-Binding gibt es bei W3C kein Vokabular, die Begriffe stehen im eigenen Kontext kb:.</li>
              <li>TD 2.0 folgt dem Working Draft vom 4.11.2025; dessen Kontext ist ausdrücklich vorläufig.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
