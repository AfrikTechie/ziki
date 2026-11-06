import { prisma } from "@/lib/prisma";
import { listFailedSearchOutbox, retryFailedSearchOutbox } from "@/lib/search-index";

async function main() {
  const [command, value, afterIdArg] = process.argv.slice(2);
  if (command === "--failed") {
    const limit = value === undefined ? 50 : Number(value);
    const afterId = afterIdArg ?? "0";
    const events = await listFailedSearchOutbox(limit, afterId);
    const nextAfter = events.length === limit ? events.at(-1)!.id.toString() : null;
    console.info(JSON.stringify({ events: events.map((event) => ({ ...event, id: event.id.toString() })), nextAfter }, null, 2));
    return;
  }
  if (command === "--retry" && value) {
    const retried = await retryFailedSearchOutbox(value);
    if (!retried) throw new Error(`Failed outbox event ${value} was not found; it may already be retried or cleaned.`);
    console.info(`[search-index] event ${value} requeued; the cron worker will retry it.`);
    return;
  }
  throw new Error("Usage: pnpm search:outbox -- --failed [limit] [after-id] | pnpm search:outbox -- --retry <event-id>");
}

main().catch((error) => {
  console.error("[search-index] outbox command failed", error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
