# Typesense search index

PostgreSQL is the source of truth. Typesense provides text matching for Bugs and Ideas; every hit is rechecked in PostgreSQL using the current tenant, project, track, deletion, and feature filters. List totals come from PostgreSQL. The indexed page is used only when its total matches the source count and its validated rows fill the expected page; otherwise the request uses the PostgreSQL query. This prevents an index-only total or a short stale page from being shown. Because the index is asynchronous, an equal-count combination of a missing and stale document can still temporarily affect ordering until the outbox catches up; strict cross-store snapshot consistency would require comparing the complete candidate set on every request. PostgreSQL remains the fallback when Typesense is missing or unavailable. Similar-issue discovery continues to use PostgreSQL trigram search.

## Optional local setup

The Compose Typesense service and credentials in `.env.example` are for local development only. Typesense configuration is server-side. With no `TYPESENSE_HOST` or `TYPESENSE_API_KEY`, searches use PostgreSQL and the cron worker skips indexing. PostgreSQL triggers also skip outbox events while the durable `SearchIndexControl.indexingEnabled` setting is false, so normal Bug and Idea writes do not create an indexing backlog before activation.

For a local index, configure the local `.env`, start the existing Compose stack, then run:

```bash
docker compose up -d
pnpm search:enable
pnpm search:setup
pnpm search:reindex
```

`search:enable` turns on durable outbox capture. `search:setup` creates or validates the collection. `search:reindex` backfills current Bugs and Ideas and drains trigger events recorded during the backfill. The backfill uses the existing worker lease so a concurrent cron run cannot race it.

## Production activation

Sodiq manages the production Typesense service. Store the production connection settings and API key in Coolify secrets; never commit them or reuse the local key. The safe activation sequence is:

1. Configure and verify the production Typesense service and application connection.
2. Run `pnpm search:enable` against the intended production database to enable trigger capture.
3. Run `pnpm search:setup` to initialize the collection.
4. Run `pnpm search:reindex`; changes made during backfill are captured in the outbox and drained afterward.
5. Reconcile source and collection counts, pending events, and failed events with the command output and `pnpm search:outbox -- --failed`.

An indexing outage after activation does not roll back PostgreSQL writes. The worker retries events with bounded attempts; events that exhaust retries remain failed for inspection and manual requeue. While indexing is enabled, a prolonged outage can still accumulate pending events, so monitor and restore service or disable capture through an operationally approved database change if necessary.

## Code and tests

- `lib/typesense.ts` contains the server-only client, collection schema, and initialization.
- `lib/search-index.ts` contains document mapping, text search, PostgreSQL candidate validation helpers, backfill, and outbox worker logic.
- `prisma/migrations/*search_index_outbox*/migration.sql` defines the outbox, durable control row, and Bug/Idea triggers.
- `scripts/search/` contains setup, backfill, enablement, and outbox operations.
- `tests/infra/migration-contract.test.ts` covers the collection contract, trigger contract, worker retries, and disabled/unconfigured worker behavior. Search fallback tests live with the relevant critical route and UI suites.

Run the repository checks using the commands in `AGENTS.md`. Do not use production credentials or a shared database for local indexing or migration experiments.
