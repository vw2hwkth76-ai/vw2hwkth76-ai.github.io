import { Copy, Download, TrashCan, Upload } from "@carbon/icons-react";
import { Button, InlineLoading, InlineNotification, Modal } from "@carbon/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ReportResult } from "../protocol.ts";
import { fileStem, today } from "../format.ts";
import { clearState, download, EMPTY_STATE, parseState, STATE_FORMAT } from "../storage.ts";
import { useWorkspace } from "../workspace.ts";

export function ExportView(): ReactNode {
  const workspace = useWorkspace();
  const { client, snapshot, project, state } = workspace;
  const [report, setReport] = useState<ReportResult>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const stem = fileStem(project.name);
  const reviewCount = Object.keys(state.reviews).length;

  useEffect(() => {
    let current = true;
    setReport(undefined);
    client.call({ type: "report", toolVersion: __WERKSTATT_VERSION__, date: today() }).then(
      (next) => current && setReport(next),
      (failure: unknown) => current && setError(failure instanceof Error ? failure.message : String(failure)),
    );
    return () => {
      current = false;
    };
  }, [client, snapshot]);

  const copySummary = async (): Promise<void> => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.summary);
      setNotice("Kurzfassung kopiert.");
    } catch {
      setNotice("Kopieren nicht erlaubt. Bitte den Text markieren und kopieren.");
    }
  };

  const importState = async (file: File): Promise<void> => {
    try {
      const json: unknown = JSON.parse(await file.text());
      const parsed = parseState(json);
      if (!parsed) throw new Error(`erwartet ${STATE_FORMAT}`);
      workspace.replaceState(parsed);
      setNotice(`Projektstand geladen: ${Object.keys(parsed.reviews).length} bestätigte GAs.`);
    } catch (failure) {
      setNotice(`Projektstand nicht lesbar (${failure instanceof Error ? failure.message : String(failure)}).`);
    }
  };

  return (
    <div className="ws-page">
      <header className="ws-page-header">
        <div>
          <h1>Export</h1>
          <p>Alles entsteht im Browser. Dateien landen im Download-Ordner, nichts wird übertragen.</p>
        </div>
      </header>

      {notice ? (
        <InlineNotification kind="info" lowContrast title="Hinweis" subtitle={notice} onClose={() => setNotice(undefined)} style={{ marginBottom: "1.5rem" }} />
      ) : null}
      {error ? <InlineNotification kind="error" lowContrast hideCloseButton title="Bericht nicht erstellt" subtitle={error} /> : null}

      <div className="ws-tiles">
        <section className="ws-tile" aria-labelledby="export-report">
          <h2 id="export-report">Analysebericht</h2>
          <p>
            Für die Rückmeldung an die Entwicklung: Entscheidungen mit Begründung, Verknüpfungen, Rückfragen und die Trefferquote gegen Ihre Bestätigungen. Ohne
            Projektname und GUID, aber mit GA-, Raum- und Gerätenamen.
          </p>
          {report ? <pre className="ws-summary">{report.summary}</pre> : <InlineLoading description="Bericht wird erstellt" />}
          <div className="ws-tile__actions">
            <Button
              kind="primary"
              size="md"
              renderIcon={Download}
              disabled={!report}
              onClick={() => report && download(`${stem}.analysebericht.json`, report.report)}
            >
              Bericht herunterladen
            </Button>
            <Button kind="tertiary" size="md" renderIcon={Copy} disabled={!report} onClick={() => void copySummary()}>
              Kurzfassung kopieren
            </Button>
          </div>
        </section>

        <section className="ws-tile" aria-labelledby="export-state">
          <h2 id="export-state">Projektstand</h2>
          <p>Ihre Bestätigungen ({reviewCount} GAs) und das Namensschema als Datei. Zum Sichern, für einen anderen Rechner oder um die Arbeit weiterzugeben.</p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importState(file);
              event.target.value = "";
            }}
          />
          <div className="ws-tile__actions">
            <Button
              kind="primary"
              size="md"
              renderIcon={Download}
              onClick={() => download(`${stem}.projektstand.json`, JSON.stringify({ format: STATE_FORMAT, ...state }, null, 2))}
            >
              Stand speichern
            </Button>
            <Button kind="tertiary" size="md" renderIcon={Upload} onClick={() => fileInput.current?.click()}>
              Stand laden
            </Button>
          </div>
        </section>

        <section className="ws-tile" aria-labelledby="export-gold">
          <h2 id="export-gold">Gold-Standard</h2>
          <p>Nur die bestätigten Werte, im Format des Benchmarks. Zusammen mit dem anonymisierten Projekt wird daraus ein fester Testfall für die Erkennung.</p>
          <div className="ws-tile__actions">
            <Button
              kind="tertiary"
              size="md"
              renderIcon={Download}
              disabled={!report || reviewCount === 0}
              onClick={() => report && download(`${stem}.gold.json`, report.gold)}
            >
              Gold-Standard herunterladen
            </Button>
          </div>
        </section>

        <section className="ws-tile" aria-labelledby="export-td">
          <h2 id="export-td">Thing Descriptions</h2>
          <p>Feld- und Plattform-TD je Thing, Thing Models je KNX-Funktionstyp, Sammel-TD und Binding-Kontext als ZIP.</p>
          <div className="ws-tile__actions">
            <Button kind="primary" size="md" onClick={() => workspace.navigate("thing-descriptions")}>
              Zu den Thing Descriptions
            </Button>
          </div>
        </section>

        <section className="ws-tile" aria-labelledby="export-delete">
          <h2 id="export-delete">Lokale Daten löschen</h2>
          <p>Entfernt Bestätigungen und Namensschema dieses Projekts aus dem Browser. Die Projektdatei selbst wurde nie gespeichert.</p>
          <div className="ws-tile__actions">
            <Button kind="danger--tertiary" size="md" renderIcon={TrashCan} onClick={() => setConfirmDelete(true)}>
              Daten löschen
            </Button>
          </div>
        </section>
      </div>

      <Modal
        open={confirmDelete}
        danger
        size="xs"
        modalHeading="Lokale Daten löschen?"
        primaryButtonText="Löschen"
        secondaryButtonText="Abbrechen"
        onRequestClose={() => setConfirmDelete(false)}
        onRequestSubmit={() => {
          clearState(project.key);
          workspace.replaceState(EMPTY_STATE);
          setConfirmDelete(false);
          setNotice("Bestätigungen und Namensschema dieses Projekts sind gelöscht.");
        }}
      >
        <p className="cds--modal-content__text">
          {reviewCount} bestätigte GAs und das Namensschema gehen verloren, sofern sie nicht als Projektstand gespeichert sind.
        </p>
      </Modal>
    </div>
  );
}
