# ENDOR-679 — project notes verification

Issue: https://ziki.dev/issues/679

Branch: `feat/ENDOR-679-project-notes`, rebased onto `emerjent/ziki:main`
`1b40b2f6`. Original runtime evidence was captured from the feature on
base `f8e183c8`; the notes implementation was unchanged by the rebase.

## Scope and review

The notebook link opens `/notes` within the existing application layout. Official
notes, chronological agent comments and comment votes have separate storage.
Official guidance changes only through an authorized editor, never by vote count.
Existing organisation owner/admin authority and the existing `admin_merger` grant
control agent editing; no agent role is added. This extension to Mark's human-only
editing request requires human product review before merge.

See [working brief](../../project-notes.md) and
[API reference](../../ziki-for-agents.md#project-notes).

## Verified checks

- Node 22.23.4 with the frozen pnpm lockfile.
- Post-rebase `pnpm check` passed: lint, typecheck and 4,954 tests across 479 files.
  The five opt-in PostgreSQL tests are skipped in that default run and passed
  separately. Worker concurrency was capped at two, without changing timeouts.
- 150 targeted domain, route, human-action, UI interaction, route-method and
  project-discovery regression checks also passed.
- All migrations applied successfully to a new disposable PostgreSQL 16 database.
- Five real PostgreSQL integration checks passed: concurrent first creation,
  conflicting updates and restoration, duplicate concurrent votes, equal-time
  pagination, and transaction rollback on audit failure.
- `pnpm build` passed and includes `/notes` and all notes API handlers.

The PostgreSQL checks use the opt-in `lib/project-notes.integration.test.ts` suite
with `NOTES_INTEGRATION_TEST=true`. It refuses any database other than the
loopback `notes_test` database on port 55479. Existing application databases were
not reset, migrated or seeded. Browser evidence uses synthetic local users,
projects and agents, rather than production data.

## Browser verification

The recorded browser pass ran before the upstream rebase, against the clean
production build with the existing
localhost auth configuration (`AUTH_URL=http://localhost:3019`). It used signed
sessions for disposable local users; it verifies notes authorization and
interactions, not the external sign-in provider flow. Authentication code was
not changed.

Passed checks:
- Owner-agent editing, ordinary-agent edit denial and project-key isolation.
- Agent comments and idempotent upvotes, with no automatic guidance changes.
- Notebook placement beside search and navigation to `/notes`.
- Human editing, saving and restoring an earlier revision as a new version.
- Desktop (1440 px) and mobile (375 px) notes/editor views without horizontal overflow.
- Mobile saving with normal scrolling and an unforced click, without bottom-nav interception.
- No browser page errors during the completed pass.

A development-server attempt previously failed on an empty generated Next.js
action manifest. The clean production build and its real save/restore requests
passed; no authentication or framework workaround was added to application code.

## Evidence

- [Checks and test counts](./check-results.txt)
- [Notes entry point](./issues-notes-entry.png)
- [Desktop notes](./notes-desktop.png)
- [Revision history](./notes-history.png)
- [Mobile notes](./notes-mobile.png)
- [Mobile editor](./notes-mobile-editor.png)

A pull request submission does not imply merge or deployment. Agent editorial
access still requires human product review before merge.
