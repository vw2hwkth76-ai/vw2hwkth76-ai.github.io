import { Button, ContentSwitcher, Pagination, Select, SelectItem, Switch, Tag } from "@carbon/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { DIMENSION_LABEL, QUESTION_KIND_LABEL } from "../../../src/app/labels.ts";
import type { QuestionView } from "../../../src/app/snapshot.ts";
import type { QuestionKind } from "../../../src/recognize/questions.ts";
import { count } from "../format.ts";
import { useWorkspace } from "../workspace.ts";

const KINDS: readonly (QuestionKind | "alle")[] = ["alle", "conflict", "ambiguous", "missing", "structure"];
const PAGE_SIZES = [25, 50, 100];

const TAG_TYPE: Readonly<Record<QuestionKind, "red" | "magenta" | "warm-gray" | "purple">> = {
  conflict: "red",
  ambiguous: "magenta",
  missing: "warm-gray",
  structure: "purple",
};

export function QuestionsView(): ReactNode {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const [kind, setKind] = useState<QuestionKind | "alle">("alle");
  const [dimension, setDimension] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const tally = useMemo(() => {
    const result = new Map<string, number>();
    for (const question of snapshot.questions) result.set(question.kind, (result.get(question.kind) ?? 0) + 1);
    return result;
  }, [snapshot]);

  const rows = useMemo(
    () => snapshot.questions.filter((question) => (kind === "alle" || question.kind === kind) && (dimension === "" || question.dimension === dimension)),
    [snapshot, kind, dimension],
  );

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const selectedIndex = Math.max(0, KINDS.indexOf(kind));

  return (
    <div className="ws-page">
      <header className="ws-page-header">
        <div>
          <h1>Rückfragen</h1>
          <p>
            Was die Werkstatt nicht sicher entscheiden kann. Eine Antwort gilt sofort, wird als bestätigt gespeichert und fließt in die Trefferquote ein.
            Beantwortete Fragen verschwinden aus der Liste.
          </p>
        </div>
      </header>

      <div className="ws-filters">
        <ContentSwitcher
          size="md"
          selectedIndex={selectedIndex}
          onChange={({ index }) => {
            const next = typeof index === "number" ? KINDS[index] : undefined;
            if (next) {
              setKind(next);
              setPage(1);
            }
          }}
          style={{ maxWidth: "44rem" }}
        >
          {KINDS.map((entry) => (
            <Switch
              key={entry}
              name={entry}
              text={`${entry === "alle" ? "Alle" : QUESTION_KIND_LABEL[entry]} (${count(entry === "alle" ? snapshot.questions.length : (tally.get(entry) ?? 0))})`}
            />
          ))}
        </ContentSwitcher>
        <div style={{ minWidth: "12rem" }}>
          <Select
            id="fragen-dimension"
            size="md"
            labelText="Dimension"
            hideLabel
            value={dimension}
            onChange={(event) => {
              setDimension(event.target.value);
              setPage(1);
            }}
          >
            <SelectItem value="" text="Alle Dimensionen" />
            <SelectItem value="room" text="Raum" />
            <SelectItem value="direction" text="Richtung" />
            <SelectItem value="dpt" text="Datenpunkttyp" />
            <SelectItem value="role" text="Bündelung" />
          </Select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="ws-empty" style={{ border: "1px solid var(--cds-border-subtle)" }}>
          <h3>{snapshot.questions.length === 0 ? "Keine offenen Rückfragen" : "Keine Rückfrage in dieser Auswahl"}</h3>
          <p>
            {snapshot.questions.length === 0
              ? "Alles ist entschieden. Schwach belegte Werte lassen sich in den Gruppenadressen trotzdem prüfen."
              : "Andere Art oder Dimension wählen."}
          </p>
        </div>
      ) : (
        <>
          <div className="ws-questions">
            {visible.map((question) => (
              <QuestionRow key={question.id} question={question} />
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            totalItems={rows.length}
            size="md"
            backwardText="Vorherige Seite"
            forwardText="Nächste Seite"
            itemsPerPageText="Je Seite"
            itemRangeText={(min: number, max: number, total: number) => `${min} bis ${max} von ${total}`}
            pageRangeText={(_current: number, total: number) => `von ${total} Seiten`}
            onChange={({ page: nextPage, pageSize: nextSize }) => {
              setPage(nextPage);
              setPageSize(nextSize);
            }}
          />
        </>
      )}
    </div>
  );
}

function QuestionRow({ question }: { readonly question: QuestionView }): ReactNode {
  const workspace = useWorkspace();
  const gaId = question.gaId;
  const dimension = question.dimension;
  return (
    <article className="ws-question" aria-label={question.message}>
      <div>
        <div className="ws-question__meta">
          <Tag size="sm" type={TAG_TYPE[question.kind]}>
            {QUESTION_KIND_LABEL[question.kind]}
          </Tag>
          <span className="helper">{dimension === "role" ? "Bündelung" : DIMENSION_LABEL[dimension]}</span>
          {question.gaIds.length > 1 ? <span className="helper">{count(question.gaIds.length)} GAs</span> : null}
        </div>
        <p className="ws-question__text">{question.message}</p>
      </div>
      <div className="ws-question__actions">
        {gaId !== undefined && dimension !== "role"
          ? question.suggestions.map((suggestion) => (
              <Button
                key={suggestion.value}
                kind="tertiary"
                size="sm"
                title={suggestion.evidence}
                onClick={() => workspace.setReview(question.gaIds.length > 0 ? question.gaIds : [gaId], dimension, suggestion.value)}
              >
                {suggestion.display}
              </Button>
            ))
          : null}
        {gaId !== undefined ? (
          <Button kind="ghost" size="sm" onClick={() => workspace.openGa(gaId)}>
            {question.suggestions.length > 0 ? "Andere Antwort" : "Beantworten"}
          </Button>
        ) : question.thingKey !== undefined ? (
          <Button kind="ghost" size="sm" onClick={() => workspace.openThing(question.thingKey)}>
            Thing ansehen
          </Button>
        ) : null}
      </div>
    </article>
  );
}
