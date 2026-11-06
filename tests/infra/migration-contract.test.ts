import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrationDatabaseUrl } from "@/scripts/migration-database-url.mjs";

const searchMocks = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  transitions: vi.fn(),
  rawQueries: vi.fn(),
  recoveryQueries: vi.fn(),
  claimSql: "",
  queryRows: [] as Array<Record<string, unknown>>,
  deleteDocument: vi.fn(),
  createCollection: vi.fn(),
  existingFields: [] as Array<Record<string, unknown>>,
}));
const prismaMocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(async () => [{ leaseUntil: null }]),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { searchMocks.recoveryQueries(strings.join("?"), values); return 0; }),
    $queryRawUnsafe: vi.fn(async (query: string) => { searchMocks.claimSql = query; return searchMocks.events.splice(0, 1); }),
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => searchMocks.transitions(strings.join("?"), values)),
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { searchMocks.rawQueries(strings.join("?"), values); return searchMocks.queryRows; }),
      bug: { findUnique: vi.fn(async () => null) },
      idea: { findUnique: vi.fn(async () => null) },
    },
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMocks.prisma }));
vi.mock("typesense", () => ({
  default: { Client: class {
    collections(name?: string) {
      if (name) return {
        retrieve: async () => ({ fields: searchMocks.existingFields }),
        documents: () => ({ delete: searchMocks.deleteDocument }),
      };
      return { retrieve: async () => [], create: searchMocks.createCollection };
    }
  } },
}));
import { bugSearchSort, listFailedSearchOutbox, processSearchOutbox, pruneProcessedSearchOutbox, retryFailedSearchOutbox, searchWorkItems, typesenseFilter } from "@/lib/search-index";
import { ensureWorkItemsCollection, resetTypesenseClientForTests, WORK_ITEMS_SCHEMA } from "@/lib/typesense";

/**
 * Migrations advance the schema safely (AGENTS.md, Migrations): production
 * applies them at container start, so a migration Postgres can't run takes the
 * deploy down. Each is one SQL file applied in name order, a new enum value is
 * never used in the migration that adds it, and migrations run over a direct
 * connection, never the pooler.
 */
const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const folders = readdirSync(MIGRATIONS).filter((name) => statSync(path.join(MIGRATIONS, name)).isDirectory()).sort();
const sqlOf = (folder: string) => readFileSync(path.join(MIGRATIONS, folder, "migration.sql"), "utf8");

describe("Typesense outbox delivery", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESENSE_HOST", "localhost");
    vi.stubEnv("TYPESENSE_PORT", "8108");
    vi.stubEnv("TYPESENSE_PROTOCOL", "http");
    vi.stubEnv("TYPESENSE_API_KEY", "local-test-key");
    searchMocks.events = [{ id: BigInt(7), kind: "bug", sourceId: "deleted-bug", action: "delete", organisationId: "t1", projectId: "p1", status: "processing", attempts: 0, availableAt: new Date(), claimedAt: new Date(), processedAt: null, lastError: null, createdAt: new Date() }];
    searchMocks.transitions.mockClear();
    searchMocks.rawQueries.mockClear();
    searchMocks.recoveryQueries.mockClear();
    searchMocks.claimSql = "";
    searchMocks.queryRows = [];
    searchMocks.deleteDocument.mockReset().mockResolvedValue({});
    searchMocks.createCollection.mockReset().mockResolvedValue({});
    searchMocks.existingFields = [];
    prismaMocks.prisma.$executeRaw.mockClear();
    prismaMocks.tx.$executeRaw.mockClear();
    resetTypesenseClientForTests();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("acknowledges a hard-delete tombstone only after its index deletion succeeds", async () => {
    searchMocks.queryRows = [{ indexingEnabled: true }];
    const result = await processSearchOutbox(1);
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(searchMocks.deleteDocument).toHaveBeenCalledOnce();
    expect(prismaMocks.prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(prismaMocks.prisma.$executeRaw.mock.calls[0][0].join("?")).toContain("'processed'");
  });

  it("leaves a failed event retryable with backoff instead of acknowledging it", async () => {
    searchMocks.queryRows = [{ indexingEnabled: true }];
    searchMocks.deleteDocument.mockRejectedValueOnce(new Error("Typesense is offline"));
    const result = await processSearchOutbox(1);
    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(prismaMocks.prisma.$executeRaw).toHaveBeenCalledOnce();
    const [strings] = prismaMocks.prisma.$executeRaw.mock.calls[0];
    const parameters = searchMocks.transitions.mock.calls[0][1] as unknown[];
    expect(strings.join("?")).toContain('"status"=?');
    expect(parameters).toContain("pending");
    expect(parameters).toContain(1);
  });

  it("moves a permanently failing event to failed at the configured attempt limit", async () => {
    searchMocks.queryRows = [{ indexingEnabled: true }];
    vi.stubEnv("SEARCH_OUTBOX_MAX_ATTEMPTS", "1");
    searchMocks.deleteDocument.mockRejectedValueOnce(new Error("Typesense is offline"));

    await processSearchOutbox(1);

    const [strings] = prismaMocks.prisma.$executeRaw.mock.calls[0];
    expect(strings.join("?")).toContain('"status"=?');
    const values = searchMocks.transitions.mock.calls[0][1] as unknown[];
    expect(values).toContain("failed");
    expect(values).toContain(1);
  });

  it("counts expired worker claims toward the retry limit", async () => {
    searchMocks.queryRows = [{ indexingEnabled: true }];
    vi.stubEnv("SEARCH_OUTBOX_MAX_ATTEMPTS", "4");
    searchMocks.events = [];

    await processSearchOutbox(1);

    const [query, values] = searchMocks.recoveryQueries.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('"status"=CASE WHEN "attempts"+1 >= ? THEN \'failed\' ELSE \'pending\' END');
    expect(query).toContain('WHERE "status"=\'processing\'');
    expect(values).toContain(4);
  });

  it("does not let a failed event block later events for the same source", async () => {
    searchMocks.queryRows = [{ indexingEnabled: true }];
    searchMocks.events = [];

    await processSearchOutbox(1);

    expect(searchMocks.claimSql).toContain('earlier."status" IN (\'pending\',\'processing\')');
    expect(searchMocks.claimSql).not.toContain('earlier."status"<>' );
  });

  it("lists failed events and only requeues an event that is still failed", async () => {
    searchMocks.queryRows = [{ id: BigInt(7) }];
    await expect(listFailedSearchOutbox()).resolves.toEqual(searchMocks.queryRows);
    await listFailedSearchOutbox(10, "7");
    expect(await retryFailedSearchOutbox("7")).toBe(true);
    expect(searchMocks.rawQueries.mock.calls[0][0]).toContain('WHERE "status"=\'failed\'');
    expect(searchMocks.rawQueries.mock.calls[1][1]).toContain(BigInt(7));
    expect(searchMocks.rawQueries.mock.calls[2][0]).toContain('AND "status"=\'failed\'');
    searchMocks.queryRows = [];
    await expect(retryFailedSearchOutbox("7")).resolves.toBe(false);
    await expect(retryFailedSearchOutbox("not-an-id")).rejects.toThrow("positive integer");
  });

  it("does not claim events when durable capture is disabled", async () => {
    searchMocks.queryRows = [{ indexingEnabled: false }];
    await expect(processSearchOutbox(1)).resolves.toEqual({ processed: 0, failed: 0, skipped: "disabled" });
    expect(prismaMocks.tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("does not claim events when Typesense is unconfigured", async () => {
    vi.stubEnv("TYPESENSE_HOST", "");
    await expect(processSearchOutbox(1)).resolves.toEqual({ processed: 0, failed: 0, skipped: "unconfigured" });
    expect(prismaMocks.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMocks.tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("does not use an initialized but not durably enabled index", async () => {
    searchMocks.queryRows = [{ indexingEnabled: false }];
    await expect(searchWorkItems({ query: "login", kind: "bug", organisationId: "t1" })).rejects.toThrow("Typesense indexing is disabled");
    expect(searchMocks.createCollection).not.toHaveBeenCalled();
  });

  it("does not query Typesense when its connection is missing", async () => {
    vi.stubEnv("TYPESENSE_API_KEY", "");
    await expect(searchWorkItems({ query: "login", kind: "bug", organisationId: "t1" })).rejects.toThrow("Typesense is not configured");
    expect(prismaMocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("prunes only processed events older than retention, with a bounded locked batch", async () => {
    vi.stubEnv("SEARCH_OUTBOX_RETENTION_DAYS", "14");
    vi.stubEnv("SEARCH_OUTBOX_CLEANUP_BATCH_SIZE", "7");
    searchMocks.queryRows = [{ id: BigInt(1) }, { id: BigInt(2) }];
    const now = new Date("2026-11-05T00:00:00.000Z");

    await expect(pruneProcessedSearchOutbox(now)).resolves.toBe(2);

    const [query, values] = searchMocks.rawQueries.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('"status"=\'processed\'');
    expect(query).toContain('"processedAt" < ?');
    expect(query).toContain("FOR UPDATE SKIP LOCKED LIMIT ?");
    expect((values.find((value) => value instanceof Date) as Date).getTime()).toBe(new Date("2026-10-22T00:00:00.000Z").getTime());
    expect(values).toContain(7);
  });

  it("keeps issue sort requests within Typesense's three-field limit", () => {
    expect(bugSearchSort("importance")).toBe("isBoosted:desc,boostedAt:desc,voteCount:desc");
    for (const sort of ["newest", "recently_updated", "importance", "least_important", "title", "title_desc", "status", "status_desc", "reward", "reward_low"]) {
      expect(bugSearchSort(sort, false).split(",").length).toBeLessThanOrEqual(3);
      expect(bugSearchSort(sort).split(",")).toHaveLength(3);
    }
  });

  it("represents nullable filters with indexed presence flags", () => {
    expect(typesenseFilter("areaId", null)).toBe("hasArea:=false");
    expect(typesenseFilter("duplicateOfId", { not: null })).toBe("hasDuplicateOf:=true");
    expect(typesenseFilter("unsupported", null)).toBeNull();
  });

  it("handles simultaneous collection creation and validates optional schema fields", async () => {
    searchMocks.existingFields = WORK_ITEMS_SCHEMA.fields.map((field) => ({ ...field }));
    searchMocks.createCollection.mockRejectedValueOnce(new Error("collection already exists"));

    await expect(ensureWorkItemsCollection()).resolves.toBeUndefined();
    expect(searchMocks.createCollection).toHaveBeenCalledOnce();
  });

  it("rejects an existing collection whose optional-field contract is incompatible", async () => {
    searchMocks.existingFields = WORK_ITEMS_SCHEMA.fields.map((field) => ({ ...field }));
    searchMocks.existingFields.find((field) => field.name === "areaId")!.optional = false;
    searchMocks.createCollection.mockRejectedValueOnce(new Error("collection already exists"));

    await expect(ensureWorkItemsCollection()).rejects.toThrow("incompatible field areaId");
  });
});

describe("the migration history", () => {
  it("gates Bug and Idea outbox capture behind the durable disabled-by-default control", () => {
    const sql = sqlOf("20270105140000_search_index_outbox");
    expect(sql).toContain('"indexingEnabled" BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql).toContain('SELECT "indexingEnabled" INTO enabled FROM "SearchIndexControl"');
    expect(sql).toContain("IF NOT COALESCE(enabled, FALSE) THEN");
    expect(sql).toContain('CREATE TRIGGER "Bug_search_index_change"');
    expect(sql).toContain('CREATE TRIGGER "Idea_search_index_change"');
  });

  it("is one migration.sql per folder, each named by the timestamp it applies in", () => {
    expect(folders.length).toBeGreaterThan(0);
    for (const folder of folders) {
      expect(existsSync(path.join(MIGRATIONS, folder, "migration.sql")), folder).toBe(true);
      expect(folder, folder).toMatch(/^\d{14}(_\w+)?$/);
    }
  });

  it("never uses a new enum value in the migration that adds it, which Postgres refuses", () => {
    const offenders: string[] = [];
    for (const folder of folders) {
      const sql = sqlOf(folder).replace(/--.*$/gm, "");
      const added = [...sql.matchAll(/ALTER TYPE\s+"?\w+"?\s+ADD VALUE\s+(?:IF NOT EXISTS\s+)?'(\w+)'/gi)].map((m) => m[1]);
      const others = sql.split(";").filter((statement) => statement.trim() && !/ADD VALUE/i.test(statement));
      for (const value of added) {
        if (others.some((statement) => statement.includes(`'${value}'`))) offenders.push(`${folder}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  }, 30_000);
});

describe("the connection migrations use", () => {
  const POOLED = "postgresql://user:secret-pooler@ep-example-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require";

  it("is the direct host behind a pooled URL, credentials and options kept", () => {
    const url = new URL(migrationDatabaseUrl(POOLED));
    expect(url.hostname).toBe("ep-example.c-7.us-east-2.aws.neon.tech");
    expect(url.password).toBe("secret-pooler");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("is DIRECT_URL when set, and a local URL unchanged", () => {
    const direct = "postgresql://u:p@direct.example:5432/neondb";
    expect(migrationDatabaseUrl(POOLED, `"${direct}"`)).toBe(direct);
    const local = "postgresql://bugtracker:bugtracker@localhost:5433/bugtracker";
    expect(migrationDatabaseUrl(local)).toBe(local);
  });
});
