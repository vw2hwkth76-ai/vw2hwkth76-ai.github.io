import { Button, FileUploaderDropContainer, InlineLoading, InlineNotification } from "@carbon/react";
import { type ReactNode, useState } from "react";
import demoProfile from "../../../fixtures/oeffentlich/demoprojekt.namensschema.json";
import demoUrl from "../../../fixtures/oeffentlich/demoprojekt.knxproj?url";
import styleUrl from "../../../fixtures/oeffentlich/style3.knxproj?url";
import type { WorkerError } from "../protocol.ts";
import type { ProjectState } from "../storage.ts";

export interface ProjectSource {
  readonly name: string;
  readonly blob: Blob;
  /** Startstand, falls fuer das Projekt noch nichts im Browser liegt. */
  readonly preset?: ProjectState;
}

interface Example {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly fileName: string;
  readonly preset?: ProjectState;
}

const EXAMPLES: readonly Example[] = [
  {
    id: "demo",
    label: "Demoprojekt mit Geräten",
    url: demoUrl,
    fileName: "demoprojekt.knxproj",
    preset: { reviews: {}, profile: demoProfile, useEtsFunctions: true },
  },
  { id: "style", label: "Einfamilienhaus ohne Geräte", url: styleUrl, fileName: "style3.knxproj" },
];

const MAX_BYTES = 512 * 1024 * 1024;

const HINTS: Readonly<Record<string, string>> = {
  "not-a-zip": "Die Datei ist kein ETS-Projektarchiv. Erwartet wird eine .knxproj-Datei aus der ETS (Projekt exportieren).",
  structure: "Im Archiv fehlt ein erwarteter Teil. Bitte das Projekt in der ETS neu exportieren.",
  "limit-exceeded": "Das Archiv überschreitet die Verarbeitungsgrenzen.",
  unsupported: "Dieses Archivformat wird noch nicht unterstützt.",
};

interface Props {
  readonly opening: string | undefined;
  readonly error: WorkerError | undefined;
  readonly onOpen: (source: ProjectSource) => void;
}

export function StartView(props: Props): ReactNode {
  const [localError, setLocalError] = useState<string>();
  const busy = props.opening !== undefined;

  const pick = (files: readonly File[]): void => {
    const file = files[0];
    if (!file) return;
    if (!/\.knxproj$/i.test(file.name)) {
      setLocalError(`"${file.name}" ist keine .knxproj-Datei.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError(`"${file.name}" ist größer als 512 MB.`);
      return;
    }
    setLocalError(undefined);
    props.onOpen({ name: file.name, blob: file });
  };

  const openExample = async (example: Example): Promise<void> => {
    setLocalError(undefined);
    try {
      const response = await fetch(example.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      props.onOpen({ name: example.fileName, blob: await response.blob(), ...(example.preset ? { preset: example.preset } : {}) });
    } catch (error) {
      setLocalError(`Beispielprojekt nicht ladbar (${error instanceof Error ? error.message : String(error)}).`);
    }
  };

  return (
    <div className="ws-start">
      <section aria-labelledby="start-title">
        <h1 id="start-title">KNX-Projekt einlesen und prüfen</h1>
        <p className="ws-start__lead">
          Die Werkstatt liest ein ETS-Projekt, erkennt für jede Gruppenadresse Raum, Gewerk, Befehl oder Rückmeldung und Datenpunkttyp und zeigt, worauf jede
          Entscheidung beruht. Was unklar ist, wird gefragt statt geraten.
        </p>

        <div className="ws-start__drop">
          {busy ? (
            <InlineLoading description={`${props.opening} wird gelesen`} />
          ) : (
            <FileUploaderDropContainer
              accept={[".knxproj"]}
              labelText="Datei hierher ziehen oder klicken, um eine .knxproj-Datei auszuwählen"
              name="projekt"
              onAddFiles={(_event, { addedFiles }) => pick(addedFiles)}
            />
          )}
        </div>

        {props.error || localError ? (
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={localError ? "Datei abgelehnt" : "Projekt nicht lesbar"}
            subtitle={localError ?? props.error?.message ?? ""}
          >
            {!localError && props.error && HINTS[props.error.code] ? <div className="ws-error-detail">{HINTS[props.error.code]}</div> : null}
          </InlineNotification>
        ) : null}

        <div className="ws-start__examples">
          {EXAMPLES.map((example) => (
            <Button key={example.id} kind="tertiary" size="md" disabled={busy} onClick={() => void openExample(example)}>
              {example.label}
            </Button>
          ))}
        </div>
        <p className="helper" style={{ marginTop: "0.5rem" }}>
          Beispiele: ExampleProject aus Blizzard26/knxTools (CC BY 4.0) und Style3 aus laurent-martin/ets-to-homeassistant (Apache-2.0).
        </p>
      </section>

      <aside className="ws-start__aside" aria-labelledby="start-data">
        <h2 id="start-data">Was mit der Datei passiert</h2>
        <ul>
          <li>
            <strong>Bleibt im Browser.</strong> Gelesen und ausgewertet wird lokal; die Datei wird an keinen Server übertragen.
          </li>
          <li>
            <strong>Passwort nur zum Entschlüsseln.</strong> Geschützte ETS5- und ETS6-Projekte lassen sich öffnen, das Passwort wird nicht gespeichert.
          </li>
          <li>
            <strong>Keine Schlüssel in der Ausgabe.</strong> KNX-Secure-Schlüssel und Passwörter aus dem Projekt erscheinen weder in Berichten noch in Exporten.
          </li>
          <li>
            <strong>Antworten lokal.</strong> Bestätigungen und das Namensschema liegen je Projekt in diesem Browser und lassen sich exportieren oder löschen.
          </li>
          <li>
            <strong>Vor dem Weitergeben anonymisieren.</strong> Berichte enthalten GA-, Raum- und Gerätenamen. Kundenprojekte vorher mit{" "}
            <code>npm run anonymisieren</code> bereinigen.
          </li>
        </ul>
      </aside>
    </div>
  );
}
