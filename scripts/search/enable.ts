import { prisma } from "@/lib/prisma";
import { typesenseConfig } from "@/lib/typesense";

async function main() {
  // Refuse to start durable capture until the app has a complete server-side
  // connection configuration. The Typesense service itself may still be down.
  typesenseConfig();
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`UPDATE "SearchIndexControl" SET "indexingEnabled"=TRUE WHERE "id"=1 RETURNING "id"`;
  if (!rows.length) throw new Error("SearchIndexControl is missing; apply database migrations first.");
  console.info("[search-index] durable outbox capture enabled; run search:setup then search:reindex");
}

main().catch((error) => { console.error("[search-index] could not enable outbox capture", error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
