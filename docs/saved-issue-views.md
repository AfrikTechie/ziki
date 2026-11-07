# Saved issue views

Open a project's issue board, choose a status tab, search, filters and order, then expand **Saved views**. Enter a name and choose **Save current view**. The named link restores those settings on page one. Use **Delete** beside a view to remove it.

Views are private to the signed-in person and belong to the current project. They persist in PostgreSQL across devices. Up to 20 names can be saved per person per project. Names are trimmed, limited to 60 characters and unique within that collection. A duplicate name returns an error so an earlier view is preserved.

A saved view reruns the current issue list. Results change as issues change. Opening a view requires current access to its project, and existing list permissions apply to deleted issues and every other filter. Stale area or milestone filters follow the board's existing handling. Idea lists do not have saved views.

## Implementation

Previously a recurring queue had to be reconstructed or bookmarked in the browser. The [toolbar component](../components/saved-issue-views.tsx) now calls [server actions](../app/actions/saved-issue-views.ts) that authenticate through the existing project resolver. The actions scope every write to the authenticated user and resolved project. A transaction lock enforces the collection limit during concurrent saves.

The [query helper](../lib/saved-issue-views.ts) stores only supported filter keys. Links use the existing project-route helpers. Pagination and unknown parameters are omitted. Saving also captures the effective sort order when it came from the user's sort cookie.

The additive [migration](../prisma/migrations/20270114000002_saved_issue_views/migration.sql) creates SavedIssueView. User and project foreign keys cascade deletion. Apply pending migrations with `pnpm exec prisma migrate deploy` before serving the new code.

## Verification

Run `pnpm verify:ready` after the complete change, followed by `pnpm verify:recheck` for repairs and `pnpm build`. The focused cases are in [saved-issue-views.test.ts](../tests/platform/saved-issue-views.test.ts).

With a local database and the normal end-to-end users loaded, run `pnpm e2e saved-views.spec.ts`. The test saves a search and sort, navigates away, restores them, checks mobile overflow, and deletes the view. Existing [end-to-end setup instructions](../e2e/README.md) apply.

Also check two accounts and two projects. A view saved by one account should be absent for the other. A person without access to a private project should be unable to open its issue board. A duplicate name, blank name or full collection should return an error. A failed load should display a retry control.
