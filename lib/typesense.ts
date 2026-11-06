import "server-only";
import Typesense, { type Client } from "typesense";

export const WORK_ITEMS_COLLECTION = "ziki_work_items_v2";

export type WorkItemDocument = {
  id: string;
  sourceId: string;
  kind: "bug" | "idea";
  organisationId: string;
  projectId: string;
  track: string;
  number: number;
  numberText: string;
  title: string;
  description: string;
  status: string;
  substatus?: string;
  substatusOrder: number;
  typeId?: string;
  areaId?: string;
  milestoneId?: string;
  reporterId?: string;
  assigneeId?: string;
  createdByAgentId?: string;
  duplicateOfId?: string;
  hasType: boolean;
  hasArea: boolean;
  hasMilestone: boolean;
  hasAssignee: boolean;
  hasAgentCreator: boolean;
  hasDuplicateOf: boolean;
  hasBoostedAt: boolean;
  isDeleted: boolean;
  isBoosted: boolean;
  boostedAt?: number;
  voteCount: number;
  score: number;
  reward: number;
  createdAt: number;
  updatedAt: number;
};

export const WORK_ITEMS_SCHEMA = {
  name: WORK_ITEMS_COLLECTION,
  fields: [
    { name: "sourceId", type: "string", facet: true, sort: true },
    { name: "kind", type: "string", facet: true },
    { name: "organisationId", type: "string", facet: true },
    { name: "projectId", type: "string", facet: true },
    { name: "track", type: "string", facet: true },
    { name: "number", type: "int32", facet: true },
    { name: "numberText", type: "string" },
    { name: "title", type: "string", infix: true, sort: true },
    { name: "description", type: "string", infix: true },
    { name: "status", type: "string", facet: true },
    { name: "substatus", type: "string", facet: true, optional: true },
    { name: "substatusOrder", type: "int32", sort: true },
    { name: "typeId", type: "string", facet: true, optional: true },
    { name: "areaId", type: "string", facet: true, optional: true },
    { name: "milestoneId", type: "string", facet: true, optional: true },
    { name: "reporterId", type: "string", facet: true, optional: true },
    { name: "assigneeId", type: "string", facet: true, optional: true },
    { name: "createdByAgentId", type: "string", facet: true, optional: true },
    { name: "duplicateOfId", type: "string", facet: true, optional: true },
    { name: "hasType", type: "bool", facet: true },
    { name: "hasArea", type: "bool", facet: true },
    { name: "hasMilestone", type: "bool", facet: true },
    { name: "hasAssignee", type: "bool", facet: true },
    { name: "hasAgentCreator", type: "bool", facet: true },
    { name: "hasDuplicateOf", type: "bool", facet: true },
    { name: "hasBoostedAt", type: "bool", facet: true },
    { name: "isDeleted", type: "bool", facet: true },
    { name: "isBoosted", type: "bool", facet: true },
    { name: "boostedAt", type: "int64", optional: true },
    { name: "voteCount", type: "int32", sort: true },
    { name: "score", type: "float", facet: true, sort: true },
    { name: "reward", type: "float", sort: true },
    { name: "createdAt", type: "int64", sort: true },
    { name: "updatedAt", type: "int64", sort: true },
  ],
} as const;

export function typesenseConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.TYPESENSE_HOST?.trim();
  const apiKey = env.TYPESENSE_API_KEY?.trim();
  const port = Number(env.TYPESENSE_PORT ?? "8108");
  const protocol = env.TYPESENSE_PROTOCOL ?? "http";
  const timeoutSeconds = Number(env.TYPESENSE_TIMEOUT_SECONDS ?? "3");
  if (!host || !apiKey) throw new Error("Typesense is not configured. Set TYPESENSE_HOST and TYPESENSE_API_KEY.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("TYPESENSE_PORT must be a valid TCP port.");
  if (protocol !== "http" && protocol !== "https") throw new Error("TYPESENSE_PROTOCOL must be http or https.");
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("TYPESENSE_TIMEOUT_SECONDS must be greater than zero.");
  return { host, port, protocol, apiKey, timeoutSeconds };
}

let client: Client | undefined;
let collectionReady: Promise<void> | undefined;
export function getTypesenseClient(): Client {
  if (client) return client;
  const config = typesenseConfig();
  client = new Typesense.Client({
    nodes: [{ host: config.host, port: config.port, protocol: config.protocol }],
    apiKey: config.apiKey,
    connectionTimeoutSeconds: config.timeoutSeconds,
    numRetries: 0,
  });
  return client;
}

export function resetTypesenseClientForTests(): void {
  client = undefined;
  collectionReady = undefined;
}

function validateWorkItemsCollection(fields: Array<{ name: string; type: string; facet?: boolean; sort?: boolean; infix?: boolean; optional?: boolean }>): void {
  const actual = new Map(fields.map((field) => [field.name, field]));
  for (const expected of WORK_ITEMS_SCHEMA.fields) {
    const field = actual.get(expected.name);
    if (!field || field.type !== expected.type || ("facet" in expected && Boolean(field.facet) !== expected.facet)
      || ("sort" in expected && Boolean(field.sort) !== expected.sort)
      || ("infix" in expected && Boolean(field.infix) !== expected.infix)
      || Boolean(field.optional) !== ("optional" in expected && expected.optional)) {
      throw new Error(`Typesense collection ${WORK_ITEMS_COLLECTION} has incompatible field ${expected.name}. Rebuild the collection before starting search.`);
    }
  }
}

export function ensureWorkItemsCollection(): Promise<void> {
  if (!collectionReady) {
    collectionReady = (async () => {
      const typesense = getTypesenseClient();
      const existing = (await typesense.collections().retrieve()).find((collection) => collection.name === WORK_ITEMS_COLLECTION);
      if (existing) {
        validateWorkItemsCollection(existing.fields ?? []);
      } else {
        try {
          await typesense.collections().create(WORK_ITEMS_SCHEMA as never);
        } catch (error) {
          // Separate app instances can race their first search after deploy.
          // If another instance created the collection, validate that schema.
          const createdByPeer = await typesense.collections(WORK_ITEMS_COLLECTION).retrieve().catch(() => null);
          if (!createdByPeer) throw error;
          validateWorkItemsCollection(createdByPeer.fields ?? []);
        }
      }
    })().catch((error) => { collectionReady = undefined; throw error; });
  }
  return collectionReady;
}

export function documentId(kind: WorkItemDocument["kind"], sourceId: string): string {
  return `${kind}:${sourceId}`;
}

export function epoch(date: Date | null | undefined): number | undefined {
  return date ? date.getTime() : undefined;
}
