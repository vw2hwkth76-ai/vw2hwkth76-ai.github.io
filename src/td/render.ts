import type { MasterData } from "../ets/master-data.ts";
import type { ProjectGraph } from "../graph/evidence-graph.ts";
import type { ProjectAnalysis } from "../recognize/pipeline.ts";
import { BUNDLE_LABEL, THING_TYPE_LABEL } from "../app/labels.ts";
import { dptAnnotation, dptSchema } from "./dpt-schema.ts";
import { uuidV5 } from "./ids.ts";
import { compact, type Json, type JsonObject } from "./json.ts";
import { type CommandStyle, type Operation, planFunctionType, type PlannedAffordance, type PlannedForm, type PlannedThing, planThings } from "./plan.ts";
import { BINDING_CONTEXT, BINDING_CONTEXT_FILE, HTTP_PREFIX, PREFIXES, SPACE_CLASS, TD11_CONTEXT, TD2_CONTEXT } from "./vocabulary.ts";

export type TdVersion = "1.1" | "2.0";

export interface TdOptions {
  readonly version: TdVersion;
  readonly commands: CommandStyle;
  readonly strict: boolean;
  /** Basis der KNX-Forms, z. B. "knx://gateway/". */
  readonly gateway: string;
  /** Basis-URL der Plattform, z. B. "https://plattform.example/". */
  readonly platform: string;
}

export const DEFAULT_TD_OPTIONS: TdOptions = {
  version: "1.1",
  commands: "property",
  strict: false,
  gateway: "knx://gateway/",
  platform: "https://plattform.example/",
};

export interface TdFile {
  readonly path: string;
  readonly json: JsonObject;
}

export interface TdThingEntry {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly fieldPath: string;
  readonly platformPath: string;
  readonly properties: number;
  readonly actions: number;
  readonly excluded: number;
}

export interface TdBundle {
  readonly files: readonly TdFile[];
  readonly things: readonly TdThingEntry[];
  readonly skipped: readonly { readonly key: string; readonly title: string; readonly reason: string }[];
  readonly excludedGroupAddresses: number;
}

const HTTP_METHOD: Readonly<Record<string, string>> = {
  readproperty: "GET",
  writeproperty: "PUT",
  observeproperty: "GET",
  invokeaction: "POST",
};

function context(version: TdVersion): Json {
  return version === "2.0" ? [TD2_CONTEXT, { ...PREFIXES, ...HTTP_PREFIX }] : [TD11_CONTEXT, { ...PREFIXES }];
}

function opValue(ops: readonly string[]): Json {
  return ops.length === 1 ? (ops[0] ?? "") : [...ops];
}

function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "thing"
  );
}

function schemaFor(dpt: string | undefined, master: MasterData): JsonObject {
  return dptSchema(dpt, master) ?? {};
}

function knxForm(entry: PlannedForm): JsonObject {
  return compact({
    href: entry.ga ?? "",
    op: opValue(entry.ops),
    contentType: "application/json",
    "kb:groupAddress": entry.ga,
    "kb:dpt": dptAnnotation(entry.dpt),
    "kb:readVerified": entry.readVerified === false ? false : undefined,
    "kb:evidence": entry.evidence.map((item) =>
      compact({
        "kb:dimension": item.dimension,
        "kb:source": item.source,
        "kb:confidence": item.confidence,
        "kb:reviewed": item.source === "review" ? true : undefined,
        "kb:conflict": item.conflict,
      }),
    ),
    "kb:openQuestion": entry.openQuestion ? true : undefined,
  });
}

function httpForms(item: PlannedAffordance, version: TdVersion): JsonObject[] {
  const ops = new Set<Operation>(item.forms.flatMap((entry) => entry.ops));
  const path = `${item.kind === "action" ? "actions" : "properties"}/${item.key}`;
  const http = (href: string, op: Operation, extra: Readonly<Record<string, Json | undefined>> = {}): JsonObject =>
    compact({ href, op, contentType: "application/json", "htv:methodName": version === "2.0" ? HTTP_METHOD[op] : undefined, ...extra });
  if (item.kind === "action") return [http(path, "invokeaction")];
  const result: JsonObject[] = [];
  if (ops.has("readproperty")) result.push(http(path, "readproperty"));
  if (ops.has("writeproperty")) result.push(http(path, "writeproperty"));
  if (ops.has("observeproperty")) result.push(http(`${path}/observe`, "observeproperty", { subprotocol: "sse" }));
  return result;
}

function interaction(item: PlannedAffordance, master: MasterData, forms: readonly JsonObject[] | undefined, description: string | undefined): JsonObject {
  const head = {
    "@type": item.types.length === 1 ? item.types[0] : [...item.types],
    title: item.titleDe,
    titles: { de: item.titleDe, en: item.titleEn },
    description,
  };
  if (item.kind === "action") {
    const input = schemaFor(item.schemaDpt, master);
    return compact({ ...head, input: Object.keys(input).length > 0 ? input : undefined, forms: forms ? [...forms] : undefined });
  }
  return compact({
    ...head,
    ...schemaFor(item.schemaDpt, master),
    readOnly: item.readOnly ? true : undefined,
    writeOnly: item.writeOnly ? true : undefined,
    observable: item.observable ? true : undefined,
    forms: forms ? [...forms] : undefined,
  });
}

function describeForms(item: PlannedAffordance): string | undefined {
  const parts = item.forms.filter((entry) => entry.ga).map((entry) => `${entry.ga} "${entry.gaName ?? ""}"`);
  return parts.length > 0 ? `GA ${parts.join(", ")}` : undefined;
}

function affordanceMaps(
  affordances: readonly PlannedAffordance[],
  build: (item: PlannedAffordance) => JsonObject,
): { properties: JsonObject | undefined; actions: JsonObject | undefined } {
  const properties: Record<string, Json> = {};
  const actions: Record<string, Json> = {};
  for (const item of affordances) (item.kind === "action" ? actions : properties)[item.key] = build(item);
  return {
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    actions: Object.keys(actions).length > 0 ? actions : undefined,
  };
}

function modelPath(functionType: string): string {
  return `models/${functionType.toLowerCase()}.tm.json`;
}

function location(thing: PlannedThing, graph: ProjectGraph, spaceIds: ReadonlyMap<string, string>): JsonObject | undefined {
  if (thing.roomId === undefined) return undefined;
  const node = graph.spaces.get(thing.roomId);
  const id = spaceIds.get(thing.roomId);
  if (!node || !id) return undefined;
  return { "@id": `urn:uuid:${id}`, "@type": SPACE_CLASS[node.space.type] ?? "brick:Space", title: node.space.name };
}

/** Alle Dateien eines Exports: Feld- und Plattform-TDs je Thing, Thing Models, Sammel-TD, Binding-Kontext. */
export async function buildThingDescriptions(analysis: ProjectAnalysis, options: TdOptions, toolVersion: string): Promise<TdBundle> {
  const graph = analysis.recognition.graph;
  const { master, project } = graph.loaded;
  const projectKey = project.guid ?? `${project.id}:${project.name}`;
  const plan = planThings(analysis, { commands: options.commands, strict: options.strict });
  const files: TdFile[] = [];
  const things: TdThingEntry[] = [];

  const spaceIds = new Map<string, string>();
  for (const id of new Set(plan.things.flatMap((thing) => (thing.roomId ? [thing.roomId] : [])))) spaceIds.set(id, await uuidV5(`${projectKey}|space:${id}`));

  // Thing Models fuer die normierten Funktionstypen, die das Projekt nutzt.
  const usedTypes = new Set(plan.things.flatMap((thing) => (thing.functionType ? [thing.functionType] : [])));
  const models = new Set<string>();
  for (const functionTypeId of usedTypes) {
    const functionType = master.functionTypes.get(functionTypeId);
    if (!functionType) continue;
    const thingClass = plan.things.find((thing) => thing.functionType === functionTypeId)?.thingClass;
    const affordances = planFunctionType(functionType, { commands: options.commands });
    const maps = affordanceMaps(affordances, (item) => interaction(item, master, undefined, undefined));
    files.push({
      path: modelPath(functionTypeId),
      json: compact({
        "@context": context(options.version),
        "@type": ["tm:ThingModel", ...(thingClass ? [thingClass] : [])],
        title: functionType.textDe ?? functionType.text,
        description: `Thing Model nach dem KNX-Funktionstyp ${functionTypeId} (${functionType.text}) aus knx_master.xml.`,
        "kb:functionType": functionTypeId,
        ...maps,
      }),
    });
    models.add(functionTypeId);
  }

  const collectionId = await uuidV5(`${projectKey}|collection`);
  for (const thing of plan.things) {
    const id = await uuidV5(`${projectKey}|${thing.stableKey}`);
    const platformId = await uuidV5(`${projectKey}|${thing.stableKey}|platform`);
    const stem = `things/${slug(thing.title)}-${id.slice(0, 8)}`;
    const fieldPath = `${stem}.td.json`;
    const platformPath = `${stem}.platform.td.json`;
    const platformBase = `${options.platform.replace(/\/?$/, "/")}things/${platformId}/`;
    const typeLink = thing.functionType && models.has(thing.functionType) ? [{ rel: "type", href: `../${modelPath(thing.functionType)}`, type: "application/tm+json" }] : [];
    const collectionLink = { rel: "collection", href: "../collection.td.json", type: "application/td+json" };
    const where = location(thing, graph, spaceIds);
    const roomName = thing.roomId ? graph.spaces.get(thing.roomId)?.space.name : undefined;
    const common = {
      "@context": context(options.version),
      "@type": thing.thingClass,
      title: thing.title,
      description: `${THING_TYPE_LABEL[thing.type]}${roomName ? `, ${roomName}` : ""}${thing.central ? ", Zentralfunktion" : ""}. Bündelung: ${BUNDLE_LABEL[thing.bundling] ?? thing.bundling}.`,
      "kb:functionType": thing.functionType,
      "brick:hasLocation": where,
    };

    const fieldMaps = affordanceMaps(thing.affordances, (item) => interaction(item, master, item.forms.map(knxForm), describeForms(item)));
    files.push({
      path: fieldPath,
      json: compact({
        ...common,
        id: `urn:uuid:${id}`,
        "kb:bundling": thing.bundling,
        "kb:openQuestions": thing.openQuestions > 0 ? thing.openQuestions : undefined,
        "kb:tool": `knx-td-werkstatt ${toolVersion}`,
        base: options.gateway,
        securityDefinitions: { nosec_sc: { scheme: "nosec" } },
        security: "nosec_sc",
        links: [...typeLink, { rel: "proxy-to", href: platformBase }, collectionLink],
        ...fieldMaps,
      }),
    });

    const platformMaps = affordanceMaps(thing.affordances, (item) => interaction(item, master, httpForms(item, options.version), undefined));
    files.push({
      path: platformPath,
      json: compact({
        ...common,
        id: `urn:uuid:${platformId}`,
        base: platformBase,
        securityDefinitions: { bearer_sc: { scheme: "bearer" } },
        security: "bearer_sc",
        links: [...typeLink, { rel: "alternate", href: `${fieldPath.slice("things/".length)}`, type: "application/td+json" }, collectionLink],
        ...platformMaps,
      }),
    });

    things.push({
      key: thing.key,
      id: `urn:uuid:${id}`,
      title: thing.title,
      fieldPath,
      platformPath,
      properties: thing.affordances.filter((item) => item.kind === "property").length,
      actions: thing.affordances.filter((item) => item.kind === "action").length,
      excluded: thing.excluded.length,
    });
  }

  files.push({
    path: "collection.td.json",
    json: {
      "@context": context(options.version),
      id: `urn:uuid:${collectionId}`,
      title: project.name,
      description: `${things.length} Things aus dem ETS-Projekt, erzeugt mit knx-td-werkstatt ${toolVersion}.`,
      securityDefinitions: { nosec_sc: { scheme: "nosec" } },
      security: "nosec_sc",
      links: things.map((thing) => ({ rel: "item", href: thing.fieldPath, type: "application/td+json" })),
    },
  });
  files.push({ path: BINDING_CONTEXT_FILE, json: BINDING_CONTEXT });

  return {
    files,
    things,
    skipped: plan.skipped,
    excludedGroupAddresses: plan.excludedCount,
  };
}
