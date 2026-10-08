import { createContext, useContext } from "react";
import type { ReviewCheck } from "../../src/app/review-check.ts";
import type { GaView, QuestionView, Snapshot, ThingView } from "../../src/app/snapshot.ts";
import type { ClaimDimension } from "../../src/recognize/claims.ts";
import type { TdOptions } from "../../src/td/render.ts";
import type { AnalysisClient } from "./client.ts";
import type { OpenResult } from "./protocol.ts";
import type { ProjectState } from "./storage.ts";

export const VIEWS = ["uebersicht", "gruppenadressen", "things", "rueckfragen", "namensschema", "thing-descriptions", "export"] as const;
export type ViewId = (typeof VIEWS)[number];

export function isView(value: string): value is ViewId {
  return (VIEWS as readonly string[]).includes(value);
}

export interface Lookups {
  readonly gaById: ReadonlyMap<string, GaView>;
  readonly thingByKey: ReadonlyMap<string, ThingView>;
  readonly questionById: ReadonlyMap<string, QuestionView>;
  readonly spaceById: ReadonlyMap<string, Snapshot["spaces"][number]>;
}

export interface Workspace {
  readonly client: AnalysisClient;
  readonly project: OpenResult;
  readonly snapshot: Snapshot;
  readonly lookups: Lookups;
  readonly state: ProjectState;
  readonly profileErrors: readonly string[];
  readonly reviewCheck: ReviewCheck | undefined;
  readonly milliseconds: number;
  readonly busy: boolean;
  /** GA im Inspektor; bleibt beim Wechsel der Ansicht erhalten. */
  readonly focusGa: string | undefined;
  readonly focusThing: string | undefined;
  setReview(gaIds: readonly string[], dimension: ClaimDimension, value: string | undefined): void;
  /** Uebernimmt die aktuellen Werte als bestaetigt, je GA und Dimension. */
  confirmCurrent(gaIds: readonly string[], dimensions?: readonly ClaimDimension[]): void;
  clearReviews(gaIds: readonly string[]): void;
  setProfile(profile: unknown): void;
  setUseEtsFunctions(value: boolean): void;
  setTdOptions(options: TdOptions): void;
  replaceState(state: ProjectState): void;
  openGa(gaId: string | undefined): void;
  openThing(thingKey: string | undefined): void;
  navigate(view: ViewId): void;
}

export const WorkspaceContext = createContext<Workspace | undefined>(undefined);

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspace ausserhalb eines geladenen Projekts");
  return workspace;
}
