import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { ensureWorkItemsCollection, getTypesenseClient, WORK_ITEMS_COLLECTION } from "@/lib/typesense";
import { indexAllWorkItems, processSearchOutbox } from "@/lib/search-index";

async function main() {
  const args = new Set(process.argv.slice(2));
  const typesense = getTypesenseClient();
  if (args.has("--init")) {
    await ensureWorkItemsCollection();
    console.info(`[search-index] collection ready: ${WORK_ITEMS_COLLECTION}`);
    return;
  }

  const owner = randomUUID();
  const acquired = await prisma.$queryRaw<Array<{ id: number }>>`UPDATE "SearchIndexControl" SET "leaseOwner"=${owner}, "leaseUntil"=${new Date(Date.now() + 5 * 60_000)} WHERE "id"=1 AND ("leaseUntil" IS NULL OR "leaseUntil"<=NOW()) RETURNING "id"`;
  if (!acquired.length) throw new Error("Another search index backfill or rebuild is already running.");
  let result: Awaited<ReturnType<typeof indexAllWorkItems>>;
  const renew = async () => {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`UPDATE "SearchIndexControl" SET "leaseUntil"=${new Date(Date.now() + 5 * 60_000)} WHERE "id"=1 AND "leaseOwner"=${owner} RETURNING "id"`;
    if (!rows.length) throw new Error("Search index backfill lease expired; stop and retry the command.");
  };
  const release = async () => { await prisma.$executeRaw`UPDATE "SearchIndexControl" SET "leaseOwner"=NULL, "leaseUntil"=NULL WHERE "id"=1 AND "leaseOwner"=${owner}`; };
  try {
    // Recover claims left behind by a dead worker; a live worker's lease is
    // considered expired after five minutes by the normal outbox claim query.
    await prisma.$executeRaw`UPDATE "SearchIndexOutbox" SET "status"='pending', "claimedAt"=NULL, "availableAt"=NOW(), "lastError"=COALESCE("lastError", 'Recovered expired processing claim before reindex.') WHERE "status"='processing' AND "claimedAt"<NOW()-INTERVAL '5 minutes'`;
    // Let a worker that claimed an event just before the lease began finish
    // before the direct bulk upserts start.
    for (let i = 0; i < 600; i += 1) {
      const pending = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS "count" FROM "SearchIndexOutbox" WHERE "status"='processing'`;
      if (Number(pending[0]?.count ?? 0) === 0) break;
      if (i === 599) throw new Error("Timed out waiting for the current outbox worker to finish.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (args.has("--rebuild")) {
      try { await typesense.collections(WORK_ITEMS_COLLECTION).delete(); }
      catch (error) { if ((error as { httpStatus?: number }).httpStatus !== 404) throw error; }
      // A live search request may recreate the collection during the delete/create gap.
      // Reuse the idempotent initializer so rebuild accepts that valid race.
      await ensureWorkItemsCollection();
    } else {
      await ensureWorkItemsCollection();
    }

    result = await indexAllWorkItems(200, renew);
  } finally {
    await release();
  }
  console.info("[search-index] backfill", result);
  let drained = 0;
  let failed = 0;
  for (let i = 0; i < 100; i += 1) {
    const batch = await processSearchOutbox(100);
    drained += batch.processed;
    failed += batch.failed;
    if (batch.processed === 0) break;
  }
  const [bugs, ideas, collection, outbox] = await Promise.all([
    prisma.bug.count(), prisma.idea.count(), typesense.collections(WORK_ITEMS_COLLECTION).retrieve(),
    prisma.$queryRaw<Array<{ pending: bigint; failed: bigint }>>`SELECT
      COUNT(*) FILTER (WHERE "status" IN ('pending','processing'))::bigint AS "pending",
      COUNT(*) FILTER (WHERE "status"='failed')::bigint AS "failed"
      FROM "SearchIndexOutbox"`,
  ]);
  const expected = bugs + ideas;
  const pending = Number(outbox[0]?.pending ?? 0);
  const permanentlyFailed = Number(outbox[0]?.failed ?? 0);
  console.info("[search-index] reconciliation", { expected, indexedDocuments: collection.num_documents, drained, failed, pending, permanentlyFailed });
  if (result.failed > 0 || result.skipped > 0 || failed > 0 || pending > 0 || collection.num_documents !== expected) {
    throw new Error("Search index backfill/reconciliation is incomplete; inspect the output and retry.");
  }
}

main().catch((error) => {
  console.error("[search-index] command failed", error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
