import { Asleep, Close, Cube, Dashboard, DataTable, DocumentExport, Help, Light, Rule } from "@carbon/icons-react";
import {
  GlobalTheme,
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  InlineLoading,
  SideNav,
  SideNavItems,
  SideNavLink,
  SkipToContent,
} from "@carbon/react";
import { type ComponentType, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DIMENSIONS } from "../../src/app/snapshot.ts";
import type { ClaimDimension } from "../../src/recognize/claims.ts";
import { AnalysisClient, AnalysisError } from "./client.ts";
import { count } from "./format.ts";
import type { AnalyzeResult, OpenResult, ReviewRecord, WorkerError } from "./protocol.ts";
import { EMPTY_STATE, loadPreference, loadState, type ProjectState, savePreference, saveState } from "./storage.ts";
import { ExportView } from "./views/ExportView.tsx";
import { GaView } from "./views/GaView.tsx";
import { OverviewView } from "./views/OverviewView.tsx";
import { PasswordModal } from "./views/PasswordModal.tsx";
import { QuestionsView } from "./views/QuestionsView.tsx";
import { SchemaView } from "./views/SchemaView.tsx";
import { type ProjectSource, StartView } from "./views/StartView.tsx";
import { ThingsView } from "./views/ThingsView.tsx";
import { isView, type Lookups, type ViewId, type Workspace, WorkspaceContext } from "./workspace.ts";

type Theme = "g10" | "g100";

type Phase =
  | { readonly kind: "start"; readonly error?: WorkerError }
  | { readonly kind: "opening"; readonly fileName: string }
  | { readonly kind: "password"; readonly fileName: string; readonly wrong: boolean }
  | { readonly kind: "ready" };

const NAV: readonly { readonly view: ViewId; readonly label: string; readonly icon: ComponentType }[] = [
  { view: "uebersicht", label: "Übersicht", icon: Dashboard },
  { view: "gruppenadressen", label: "Gruppenadressen", icon: DataTable },
  { view: "things", label: "Things", icon: Cube },
  { view: "rueckfragen", label: "Rückfragen", icon: Help },
  { view: "namensschema", label: "Namensschema", icon: Rule },
  { view: "export", label: "Export", icon: DocumentExport },
];

function initialTheme(): Theme {
  const stored = loadPreference("theme");
  if (stored === "g10" || stored === "g100") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "g100" : "g10";
}

function viewFromHash(): ViewId {
  const name = window.location.hash.replace(/^#\/?/, "");
  return isView(name) ? name : "uebersicht";
}

function toFailure(error: unknown): WorkerError {
  if (error instanceof AnalysisError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "internal", message: error.message };
  return { code: "internal", message: String(error) };
}

function withReview(
  reviews: ReviewRecord,
  gaIds: readonly string[],
  change: (entry: Partial<Record<ClaimDimension, string>>, gaId: string) => void,
): ReviewRecord {
  const next: Record<string, Partial<Record<ClaimDimension, string>>> = { ...reviews };
  for (const gaId of gaIds) {
    const entry = { ...next[gaId] };
    change(entry, gaId);
    if (Object.keys(entry).length === 0) delete next[gaId];
    else next[gaId] = entry;
  }
  return next;
}

export function App(): ReactNode {
  const client = useMemo(() => new AnalysisClient(), []);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [phase, setPhase] = useState<Phase>({ kind: "start" });
  const [project, setProject] = useState<OpenResult>();
  const [state, setState] = useState<ProjectState>(EMPTY_STATE);
  const [result, setResult] = useState<AnalyzeResult>();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ViewId>(viewFromHash);
  const [navOpen, setNavOpen] = useState(false);
  const [focusGa, setFocusGa] = useState<string>();
  const [focusThing, setFocusThing] = useState<string>();
  const source = useRef<ProjectSource | undefined>(undefined);
  const sequence = useRef(0);

  useEffect(() => {
    document.documentElement.dataset["carbonTheme"] = theme;
    savePreference("theme", theme);
  }, [theme]);

  useEffect(() => {
    const onHash = (): void => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((next: ViewId) => {
    setView(next);
    setNavOpen(false);
    if (window.location.hash !== `#/${next}`) window.location.hash = `#/${next}`;
    window.scrollTo({ top: 0 });
  }, []);

  const open = useCallback(
    async (next: ProjectSource, password?: string) => {
      source.current = next;
      setPhase({ kind: "opening", fileName: next.name });
      try {
        const data = await next.blob.arrayBuffer();
        const opened = await client.call({ type: "open", data, password }, [data]);
        const stored = loadState(opened.key);
        setResult(undefined);
        setFocusGa(undefined);
        setFocusThing(undefined);
        setProject(opened);
        setState(stored === EMPTY_STATE && next.preset ? next.preset : stored);
        setPhase({ kind: "ready" });
        navigate("uebersicht");
      } catch (error) {
        const failure = toFailure(error);
        if (failure.code === "password-required" || failure.code === "password-wrong") {
          setPhase({ kind: "password", fileName: next.name, wrong: failure.code === "password-wrong" });
        } else {
          setPhase({ kind: "start", error: failure });
        }
      }
    },
    [client, navigate],
  );

  const close = useCallback(() => {
    sequence.current++;
    source.current = undefined;
    setProject(undefined);
    setResult(undefined);
    setState(EMPTY_STATE);
    setBusy(false);
    setPhase({ kind: "start" });
    window.location.hash = "";
  }, []);

  // Jede Aenderung am Projektstand loest eine neue Analyse aus; veraltete Antworten werden verworfen.
  useEffect(() => {
    if (!project) return;
    saveState(project.key, state);
    const id = ++sequence.current;
    setBusy(true);
    client.call({ type: "analyze", reviews: state.reviews, profile: state.profile, useEtsFunctions: state.useEtsFunctions }).then(
      (next) => {
        if (id !== sequence.current) return;
        setResult(next);
        setBusy(false);
      },
      (error: unknown) => {
        if (id !== sequence.current) return;
        setBusy(false);
        setProject(undefined);
        setPhase({ kind: "start", error: toFailure(error) });
      },
    );
  }, [client, project, state]);

  const lookups = useMemo<Lookups | undefined>(() => {
    if (!result) return undefined;
    const { snapshot } = result;
    return {
      gaById: new Map(snapshot.gas.map((ga) => [ga.id, ga])),
      thingByKey: new Map(snapshot.things.map((thing) => [thing.key, thing])),
      questionById: new Map(snapshot.questions.map((question) => [question.id, question])),
      spaceById: new Map(snapshot.spaces.map((space) => [space.id, space])),
    };
  }, [result]);

  const workspace = useMemo<Workspace | undefined>(() => {
    if (!project || !result || !lookups) return undefined;
    return {
      client,
      project,
      snapshot: result.snapshot,
      lookups,
      state,
      profileErrors: result.profileErrors,
      reviewCheck: result.reviewCheck,
      milliseconds: result.milliseconds,
      busy,
      focusGa,
      focusThing,
      setReview: (gaIds, dimension, value) =>
        setState((current) => ({
          ...current,
          reviews: withReview(current.reviews, gaIds, (entry) => {
            if (value === undefined) delete entry[dimension];
            else entry[dimension] = value;
          }),
        })),
      confirmCurrent: (gaIds, dimensions = DIMENSIONS) =>
        setState((current) => ({
          ...current,
          reviews: withReview(current.reviews, gaIds, (entry, gaId) => {
            const ga = lookups.gaById.get(gaId);
            for (const dimension of dimensions) {
              const decision = ga?.decisions[dimension];
              if (decision) entry[dimension] = decision.value;
            }
          }),
        })),
      clearReviews: (gaIds) =>
        setState((current) => ({
          ...current,
          reviews: withReview(current.reviews, gaIds, (entry) => {
            for (const dimension of DIMENSIONS) delete entry[dimension];
          }),
        })),
      setProfile: (profile) => setState((current) => ({ ...current, profile })),
      setUseEtsFunctions: (value) => setState((current) => ({ ...current, useEtsFunctions: value })),
      replaceState: (next) => setState(next),
      openGa: (gaId) => {
        setFocusGa(gaId);
        if (gaId !== undefined) navigate("gruppenadressen");
      },
      openThing: (thingKey) => {
        setFocusThing(thingKey);
        if (thingKey !== undefined) navigate("things");
      },
      navigate,
    };
  }, [client, project, result, lookups, state, busy, focusGa, focusThing, navigate]);

  const ready = phase.kind === "ready" && project !== undefined;
  const questions = result?.snapshot.questions.length ?? 0;

  return (
    <GlobalTheme theme={theme}>
      <Header aria-label="KNX TD Werkstatt">
        <SkipToContent href="#main">Zum Inhalt springen</SkipToContent>
        {ready ? (
          <HeaderMenuButton
            aria-label={navOpen ? "Navigation schließen" : "Navigation öffnen"}
            isActive={navOpen}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((value) => !value)}
          />
        ) : null}
        <HeaderName href="#/" prefix="" onClick={(event) => (ready ? (event.preventDefault(), navigate("uebersicht")) : undefined)}>
          KNX TD Werkstatt
        </HeaderName>
        {ready ? (
          <div className="ws-header-project">
            <span>Projekt</span>
            <span className="ws-header-project__name">{project.name}</span>
          </div>
        ) : null}
        <HeaderGlobalBar>
          {busy ? (
            <div className="ws-busy">
              <InlineLoading description="Analyse läuft" />
            </div>
          ) : null}
          <HeaderGlobalAction
            aria-label={theme === "g10" ? "Dunkle Darstellung" : "Helle Darstellung"}
            tooltipAlignment="end"
            onClick={() => setTheme((value) => (value === "g10" ? "g100" : "g10"))}
          >
            {theme === "g10" ? <Asleep size={20} /> : <Light size={20} />}
          </HeaderGlobalAction>
          {ready ? (
            <HeaderGlobalAction aria-label="Projekt schließen" tooltipAlignment="end" onClick={close}>
              <Close size={20} />
            </HeaderGlobalAction>
          ) : null}
        </HeaderGlobalBar>
        {ready ? (
          <SideNav aria-label="Ansichten" expanded={navOpen} onOverlayClick={() => setNavOpen(false)} onSideNavBlur={() => setNavOpen(false)} href="#main">
            <SideNavItems>
              {NAV.map((item) => (
                <SideNavLink
                  key={item.view}
                  renderIcon={item.icon}
                  href={`#/${item.view}`}
                  isActive={view === item.view}
                  aria-current={view === item.view ? "page" : undefined}
                  onClick={(event: { preventDefault: () => void }) => {
                    event.preventDefault();
                    navigate(item.view);
                  }}
                >
                  {item.view === "rueckfragen" && questions > 0 ? `${item.label} (${count(questions)})` : item.label}
                </SideNavLink>
              ))}
            </SideNavItems>
          </SideNav>
        ) : null}
      </Header>
      <main id="main" className={`ws-main${ready ? " ws-main--nav" : ""}`} tabIndex={-1}>
        {ready ? (
          workspace ? (
            <WorkspaceContext.Provider value={workspace}>
              <CurrentView view={view} />
            </WorkspaceContext.Provider>
          ) : (
            <div className="ws-page">
              <InlineLoading description="Projekt wird analysiert" />
            </div>
          )
        ) : (
          <StartView
            opening={phase.kind === "opening" ? phase.fileName : undefined}
            error={phase.kind === "start" ? phase.error : undefined}
            onOpen={(next) => void open(next)}
          />
        )}
      </main>
      <PasswordModal
        open={phase.kind === "password"}
        fileName={phase.kind === "password" ? phase.fileName : ""}
        wrong={phase.kind === "password" && phase.wrong}
        onSubmit={(password) => {
          if (source.current) void open(source.current, password);
        }}
        onCancel={() => setPhase({ kind: "start" })}
      />
    </GlobalTheme>
  );
}

function CurrentView({ view }: { readonly view: ViewId }): ReactNode {
  switch (view) {
    case "uebersicht":
      return <OverviewView />;
    case "gruppenadressen":
      return <GaView />;
    case "things":
      return <ThingsView />;
    case "rueckfragen":
      return <QuestionsView />;
    case "namensschema":
      return <SchemaView />;
    case "export":
      return <ExportView />;
  }
}
