# Marketing in Ziki — migration plan

Bring Amp (the `metric-tracker` repo, live at `amp.ziki.dev` / `metrics.zedu.chat`) into Ziki as the **Marketing** section of each project. The Marketing tab in Ziki's top nav opens the section at `/<project>/marketing`, with sub-tabs for Tasks, Proposals, Library and Settings. It no longer links to `amp.ziki.dev`.

This file is the shared backlog. **Phase 0 (foundations) lands first, done by one or two people. Everyone else picks a Phase 1 item after the foundations it depends on are merged.**

## Agreed scope

| Decision | Answer |
| --- | --- |
| Data model | **Reuse Ziki's model.** A marketing task is a Ziki idea → issue, using Ziki's verdicts, bids, claims, deliveries, judgements and `PointEntry`. We add only what marketing needs; we do not port Amp's `Task`, `TaskVote`, `TaskComment`, `PointsLedger` or `PointRule` tables. |
| Tenancy | **The same Ziki project holds both.** Every project gets a Marketing section next to its product issues. Same members, agents and workspace. |
| Existing Amp data | **Start fresh.** No import. Amp keeps running untouched, and Ziki no longer links to it. |
| Features | **Only Amp's live features** (listed below). Not the removed Overview, Content, Directories, SEO checker or Press & Media modules, and not a metrics/KPI dashboard. |
| Design | **Ziki's design system**, not Amp's. Follow `docs/brand-guide.md`: no Amp purple, no Amp wordmark, no five-up stat cards. Rebuild the screens with Ziki components; do not copy Amp's shadcn components across. |

### Stack differences to keep in mind when reading Amp's code

| | Amp | Ziki |
| --- | --- | --- |
| Next.js | 14 (App Router) | 16 — read `node_modules/next/dist/docs/` before writing code |
| React | 18 | 19 |
| Auth | NextAuth v4, `getServerSession` | Auth.js v5 (`auth()`) |
| Prisma | 5 | 6 |
| Package manager | npm | **pnpm only** |
| Tests | `tsx --test`, embedded Postgres | Vitest critical suite under `tests/`, CLI scenarios in `cli/tests/` |
| API | `/api/tasks`, `/api/agent/*`, OpenAPI via zod-to-openapi | `/api/v1/*`, work feed `/<project>/work`, MCP tools, `pnpm ziki` CLI |

Use Amp's code to understand **the rules**, then implement them the Ziki way. Read `AGENTS.md` and `CONTRIBUTING.md` before starting. The "issue model" rules in `AGENTS.md` still apply to marketing work.

---

## Amp feature → Ziki mapping

This table is the core of the migration. "Exists" means Ziki already does it and marketing reuses it. "Extend" means a change to something that already exists. "New" means building something.

| Amp feature | Amp source | Ziki equivalent | Gap |
| --- | --- | --- | --- |
| Post a task (title, description, task type, proposed points, required **rationale**) | `POST /api/tasks`, `src/lib/tasks.ts` | Idea (`POST /api/v1/ideas`) | **Extend:** `track: marketing`, required `rationale`, task type |
| Vote on a proposed task (up/down + reason, 5 to decide, each vote pays points) | `src/lib/task-votes.ts`, `/api/tasks/{id}/votes` | Idea verdicts + `ideaThreshold`, convert / reject | Exists. Vote pay is Ziki's first-opinion award (D7) |
| 5 downvotes delete a task | same | Reject idea → Rejected ideas | Exists (rejected, not deleted) |
| No confirmation step | — | Open · Requires confirmation | **Extend:** skipped for marketing (D2) |
| Bid on an open task; can't bid on your owner's task | `/api/agent/tasks`, bidding | `IssueBid` | Exists. Ziki's owner rule applies (D3) |
| Poster or admin offers the task to one bidder | `/api/tasks/{id}/offer`, `src/lib/task-offers.ts` | Award bid → offer → `IssueClaim` | Exists |
| Offer accept / decline with reason; 24h expiry | `accept-offer`, `decline-offer` | Claim offers, `offerWindowSeconds` | Exists (set the window per project) |
| Active-task cap (2) | `activeTaskLimit` | `ProjectWorkflow.maxActiveClaims` | Exists. **Extend** if marketing needs its own cap |
| Delivery with an attachment / link | `TaskComment` type `delivery` | `Delivery` (requires `pullRequestUrl`) | **Extend:** marketing delivery has no PR; deliverable URL(s), files, text |
| Peer review: 2 approvals approve, 2 "changes" send it back | `src/lib/task-acceptance.ts` | Test verdicts (`goodToMerge`), `verdictsNeeded` | Exists, with different words ("approve" / "request changes") |
| Revision rounds: back to the same worker, after 2 failed rounds reopen for bids | `revisionCount`, `maxRevisions` | Not good to merge → back to Open · Open | **New:** revision limit (D4) |
| Reviewers can't share an owner with the worker; one review per agent | `task-acceptance.ts` | Ziki allows owner agents; only the claim holder can't review | Exists. Ziki's rule applies (D3) |
| Review points (6, first 4 reviews paid) | `point-settings.ts` | `PointRole.reviewer`, `Project.rewardConfig` | Exists. Ziki's amounts apply (D7) |
| Poster gets 20% of the worker's points | `creatorSharePct` | `PointRole.reporter`, `Project.rewardConfig` | Exists. Ziki's reporter amount applies, paid at conversion (D2, D7) |
| Task types with default and max points | `TaskTypeDef`, `/api/task-types` | `IssueType` (per tenant, no points) | **Extend:** `track` only. Pay comes from the issue's reward (D5, D7) |
| Points settings card (vote points, votes to decide, review points, cap, share, limit, weekly target) | `/api/projects/{id}/points` | `ProjectWorkflow`, `Project.rewardConfig` | Exists, plus the new revision limit (D4, D7) |
| Weekly target (500) | `weeklyTarget` | Ziki's general goal | Exists. No marketing target (D7) |
| Scoreboard (periods, bidders tab) | `/scoreboard`, `scoreboard-server.ts` | `/leaderboard`, points pages | Exists. Marketing rewards count in the existing totals, with no separate leaderboard (D7) |
| Project brief (product, website, current focus, out of scope); agents read it | `src/lib/project-brief.ts`, `GET /api/agent/me` | `Project.goal`, `ProjectNotes` | **Extend:** marketing brief fields, exposed to agents |
| Task refs `T-341`, `/p/<slug>/T-341` | `src/lib/refs.ts` | Issue numbers `/<project>/<number>` | Exists, shared with product issues (D6). **New:** optional link to a related product issue |
| Task board / list | `/p/<slug>/tasks`, `task-board.ts` | Issue list tabs | **New page**, reusing the list components |
| Task page (thread, votes, bids, offer box, reviews) | `/p/<slug>/tasks/[taskId]` | Issue page | **New page variant** |
| Idea box: gallery of approved deliverables | `/p/<slug>/idea-box` | — | **New page.** Rename it (e.g. "Library") — "Ideas" already means something else in Ziki |
| My Work | `/p/<slug>/work`, `my-work.ts` | Work feed, inbox | Exists. **Extend:** marketing filter |
| Escalations (todo) | `/p/<slug>/todo`, `inbox.ts` | Escalations button, inbox | Exists. **Extend:** include marketing items |
| Notifications | `/api/notifications` | Notifications | Exists |
| Search | `/api/search` | Issue search / filters | **Extend:** marketing filter |
| Profile → agents ranked by points | `/p/<slug>/profile` | Agents pages | Exists |
| Admin export (xlsx) | `/api/admin/export` | Points balance export | Optional, low priority |
| Members, roles, invite link / join code | `/api/projects/*` | Tenant membership, invites | Exists, nothing to build |
| Agent API: `GET /api/agent/me`, `/api/agent/tasks`, agent guide `public/agent-guide.md` | `src/app/api/agent/**` | `/api/v1`, work feed, MCP, CLI, `docs/ziki-for-agents.md` | **Extend:** `track` everywhere, brief on `agents/me`, docs |

---

## Locked decisions

Signed off by the maintainer and Phase 0 owner on 2026-11-04. These change Ziki's issue model, so per `AGENTS.md` they went through the human reviewer gate. "The marketing track rules" below sum them up.

| # | Question | Decision |
| --- | --- | --- |
| D1 | **Marketing lifecycle.** Marketing work has no pull request, merge or deploy. Which statuses does it use? | Same statuses up to Done · Accepted. A manager review accept then moves it straight to **Live · Published** (new substatus `published`), skipping Merge. No PR reports, no deployment reports. Added to `lib/issue-substatus.ts` as the one map. |
| D2 | Do marketing issues need the confirmation step? | No. An idea that passes the vote converts straight to **Open · Open**. The reporter is paid at conversion, because product work pays them at confirmation and that step doesn't exist here. |
| D3 | Same-owner rules. Amp forbids reviewing, or bidding on, your owner's work; Ziki allows everything except the claim holder reviewing itself. | Keep **Ziki's rule** (one rule for the whole product), and rely on weighted, independent verdicts. Revisit if points farming shows up. |
| D4 | Revision rounds. Amp sends rejected work back to the same worker up to 2 times, then reopens it for bids. Ziki sends "not good" straight back to Open · Open. | Add a per-project **revision limit** (default 2) for the marketing track: "request changes" → back to In progress for the same claim; once the limit is hit → Open · Open. |
| D5 | Task types. Amp: per project, each with default and max points. Ziki `IssueType`: per tenant, no points. | Extend `IssueType` with `track` only. Marketing types show only in the Marketing section. **No `points`, `maxPoints` or proposed points**, because D7 uses Ziki's rewards. |
| D6 | Numbering. Do marketing issues share numbers with product issues? | **Shared numbering** (`/<project>/<number>` keeps working everywhere), rendered with the marketing variant. A marketing issue can stand alone, or agents can link it to a related product issue. Each issue keeps its own number, because numbers are unique per tenant. |
| D7 | Point amounts. Amp's defaults (vote 5, review 6 × 4, poster 20%, weekly target 500) vs Ziki's current amounts. | **Ziki's point system, with none of Amp's amounts.** Solving pays the issue's own reward (agents' estimates, $1–$10). Reporter and reviewer amounts use the existing per-project `Project.rewardConfig`. The goal is Ziki's general goal, with no marketing target. Marketing rewards add to each person's existing points, and there is no separate marketing leaderboard: Ranking is the one scoreboard. New `PointRole`s only where none fits. |
| D8 | Visibility. Who sees the Marketing section? | Everyone in the project. There is no feature flag. Agents opt in with the work feed's `track` filter: with no filter, the feed returns product work only. |

### The marketing track rules

Decided, not built yet: until the marketing routes ship, every issue follows "The issue model" in `AGENTS.md`. A marketing issue is an ordinary idea and issue in the same project, with `track` set to `marketing`. Every rule in "The issue model" applies except these:

| Step | Marketing rule |
| --- | --- |
| Convert | The verdict that reaches the threshold converts the idea straight to Open · Open, with no agent converting it and no confirmation step. A bad idea doesn't open; a manager agent rejects it. The reporter is paid at conversion. |
| Delivery | Deliverable links, files and text, with no pull request. |
| Judgement | Not good sends the work back to In progress on the same claim, up to the project's revision limit (default 2). Past the limit it goes to Open · Open. |
| Manager review | Accept moves it from Done · Accepted to Live · Published (`published`), skipping Merge. There are no pull request or deployment reports. |

Everything else is shared with product work: issue numbers and the issue route, rewards, the goal, project reward settings and same-owner rules. A marketing issue can stand alone or link to a related product issue. Without a `track` filter the work feed returns product work only.

### Answers from F3

Confirmed by the Phase 0 owner on 2026-11-04. `lib/marketing/track.ts` holds them.

- **Does a manager's reject use up a revision round (D4)?** Yes, so one limit covers both ways of sending work back.
- **Which judgements count after a revision (D4)?** Only those given since the latest delivery.
- **What does the next worker start with once work reopens for bids (D4)?** A fresh revision count, because the rounds belonged to the last worker.
- **Where does reopening send a marketing issue (D2)?** Open · Open, because it has no confirmation step to return to.

---

## Phase 0 — foundations (land before anyone else starts)

Do these in order, one PR each where practical. Everything in Phase 1 depends on F1–F4. F5–F8 can run alongside F3–F4.

### F1. Lock the decisions
Get sign-off on D1–D8 above, and record the answers and the marketing rules in this file.
**Status:** decisions signed off 2026-11-04. Done once this file is merged.
**Blocks:** everything.

### F2. Schema: the marketing track
- New enum `WorkTrack { product, marketing }` — **in its own migration** (Postgres can't use a new enum value in the same transaction).
- `track WorkTrack @default(product)` on `Idea` and `Bug`, plus indexes on `(projectId, track, status)`.
- `rationale String?` on `Idea` (required by validation when `track = marketing`).
- `IssueType`: `track` (D5).
- `published` on `Substatus` (D1, own migration), revision count/limit fields (D4).
- Delivery: make `pullRequestUrl` optional for marketing, and add `deliverableUrls String[]` (or similar). Check `TestVerdict` and the merge review too: both are tied to a pull request today, so judging and accepting marketing work needs them to work without one.
- `Bug`: optional link from a marketing issue to a related product issue in the same project (D6).
- Migration-only, tested on a `pg_dump` copy; existing rows default to `product`. Never reseed.
- Add `published` to the lists that name every substatus (labels, badges, sort order, validation, the MCP filter), so nothing rejects or mislabels it. Moving an issue there is F3's job. Add one published marketing fixture, because `tests/infra/fixtures-contract` needs one per substatus; F7 adds the rest.

**Blocks:** F3, F4, every API item.

### F3. Lifecycle and rules core (`lib/`)
- `lib/issue-substatus.ts`: the marketing path from D1, still through `moveTo`.
- One helper, e.g. `lib/marketing/track.ts`, that answers "which rules apply to this issue" (confirmation skip, no PR gate, revision limit), so routes don't branch on `track` themselves.
- Settle the open questions and record the answers in this file ("Answers from F3" above).
- Validation schemas in `lib/validations/` for marketing ideas and deliveries.
- Critical tests for the new rules, added to the existing area files (`tests/intake/idea-verdict-convert`, `tests/work/delivery`, `tests/work/test-verdict`, `tests/merge/point-award`), not a new file per module.

**Blocks:** all API items.

### F4. Keep product and marketing apart in every existing query
Without this, marketing tasks leak into the Issues list, the product work feed and counts. Audit every `bug` / `idea` query (issue list, ideas page, work feed, inbox, dashboards, events, search, counts, sitemap, `llms.txt`) and add `track: "product"`, or a track argument, where it belongs. Add a test in `tests/ui/issue-list` and `tests/work/workfeed-dispatch` proving marketing items don't show in product views.
**Blocks:** launch. Can run in parallel with F3.

What the audit left unfiltered, on purpose:

- **Looking up one issue or idea** by id or number: both tracks share the issue route (D6).
- **A person's own records:** their profile, history, agent activity, inbox, notifications and data export.
- **Upkeep that applies to all work:** reclaiming orphaned or abandoned claims, offboarding, stake sweeps, and the usage counts that decide whether a task type or platform can be deleted.
- **Events and webhooks:** M-API-9 adds `track` to them.
- **Points, the leaderboard and the goal:** marketing and product work earn the same $ towards one goal (D7), so the totals include both. There is no separate marketing leaderboard.
- **`sitemap` and `llms.txt`:** neither reads issues or ideas.

### F5. Route shell and navigation
- `app/(app)/[org]/[project]/marketing/page.tsx`: the section's home, for anyone in the project.
- `components/app-header.tsx`: Marketing tab → `/<project>/marketing`. `app/(app)/marketing/page.tsx` redirects to the current project's marketing section. Nothing links to `amp.ziki.dev` any more.

There is no feature flag. Sub-tabs (M-LAUNCH-1) live in `app/(app)/[org]/[project]/marketing/layout.tsx`, and each page starts with `requireProject(slug, path)`. Agent routes are live as soon as they merge.

**Blocks:** all UI items.

### F6. Marketing settings storage
The only new dial is the **revision limit** (D4, default 2): a column on `ProjectWorkflow`, with its default and bounds in `lib/workflow-config.ts`. Everything else reuses what exists (D7): `ideaThreshold` for votes to decide, `maxActiveClaims` for the active-task cap, `Project.rewardConfig` for reporter and reviewer amounts, and Ziki's general goal. Include the read helper; the settings UI is a Phase 1 item.

The column came with F2, so F6 needs no migration. `workflowFor(projectId).revisionLimit` is the read helper, and it passes straight to `afterSendBack`. The limit is 1 to 10 (`revisionLimitSchema`, for M-API-6). It stays out of `workflowSettingsSchema`, so saving the product settings form leaves it alone.

**Blocks:** M-API-4, M-API-6, M-UI-7.

### F7. Fixtures
Add marketing ideas and issues in every marketing state to `scripts/dev/fixtures/generate.ts` (deterministic), run `pnpm db:fixtures:generate`, and commit the JSON. After `pnpm db:fixtures`, contributors have real data for the pages they build under `/demo/marketing`.
**Blocks:** comfortable UI work (UI items can start with placeholders).

The generator holds 14 marketing issues, 21 marketing ideas in all and 4 marketing task types. It writes them by hand with no random numbers, so the product rows don't change. The Demo workspace now has 234 issues and 271 ideas, of which 220 and 250 are product work.

### F8. Agent API contract (docs first)
Write the marketing part of `docs/ziki-for-agents.md` before the code: `track` on `POST /api/v1/ideas`, the work-feed `track` filter, marketing delivery fields, the brief on `GET /api/v1/agents/me`. This is the contract the API items implement and the CLI scenarios test.
**Blocks:** M-API items (they can start once the doc is merged).

The contract is the "Marketing work" section of `docs/ziki-for-agents.md`, marked as not live. Each M-API item moves its part into the route's own section as it ships, and M-DOC-2 removes the note. It settles these points, which the items below didn't:

- **Work on a delivery:** `deliverableText` (the work as Markdown, shown as a file), `attachmentIds` and `deliverableUrls`, with at least one of them. M-API-3 extends `marketingDeliveryBodySchema`, which today requires a link and refuses anything else.
- **Words:** approve and request changes are `goodToMerge` true and false, with no new verdict values or routes.
- **Refusals:** `409 wrong_track` for routes marketing doesn't use. Product-only item kinds stay out of the marketing feed.
- **Lists:** `GET /api/v1/issues`, `/issues/counts` and `/ideas` take `?track=` as the feed does.
- **Link route (M-API-12):** `PUT` and `DELETE /api/v1/issues/{id}/linked-issue`.
- **Brief (M-API-8):** `brief` has `product`, `audience`, `website` (the project's Site URL), `current_focus` and `out_of_scope`, the same object on `agents/me` and the marketing feed.

---

## Phase 1 — pick one and deliver

Each item is one branch and one PR to `main`. Put your name next to it before starting. Owned paths are suggestions to avoid collisions: stay inside them, and if you need a shared file changed, ask the Phase 0 owner.

### API and rules (`app/api/v1/**`, `lib/**`)

| ID | Item | Depends on | Owner |
| --- | --- | --- | --- |
| M-API-1 | **Propose a marketing task:** `POST /api/v1/ideas` with `track: marketing`, required `rationale`, task type. Server action for the web form. MCP tool + `cli/catalog.ts` + a CLI scenario. | F2, F3, F8 | |
| M-API-2 | **Vote → open / reject:** marketing ideas convert straight to Open · Open (D2), or reject; the reporter is paid at conversion (D2, D7). | F3 | |
| M-API-3 | **Marketing delivery:** `POST /api/v1/issues/{id}/delivery` accepts deliverable links and files instead of a PR for marketing issues; refuses a PR-only payload shape where that doesn't fit. | F2, F3 | Chizoba |
| M-API-4 | **Review and revision rounds:** "approve" / "request changes" verdicts, revision limit, reopen for bids after the limit (D4). | F3, F6 | |
| M-API-5 | **Accept → Live (published):** manager review accept moves marketing work to Live · Published, skipping Merge and the PR gate (D1). Pays the worker the issue's reward and pays review points (D7). Idempotent (`sourceKey`). | F3 | |
| M-API-6 | **Marketing settings API:** read and update the revision limit from F6 (owners/admins only). | F6 | emmyanzo |
| M-API-7 | **Marketing task types API:** CRUD for marketing `IssueType`s (D5). | F2 | |
| M-API-8 | **Project brief for agents:** marketing brief fields (product, audience, website, current focus, out of scope) stored on the project, returned on `GET /api/v1/agents/me` and in the work feed. | F2, F8 | |
| M-API-9 | **Work feed and events:** `track` filter on `/<project>/work`, returning product work only when no filter is given (D8); marketing items carry `minimumRole` / `canAct` like product items; events and webhooks include `track`. | F4, F8 | |
| M-API-11 | **Search:** marketing filter in search and quick lookup. | F4 | |
| M-API-12 | **Link to a product issue:** agents set or clear the optional link between a marketing issue and a related product issue in the same project (D6). MCP tool or `cli/catalog.ts` command, and a CLI scenario. | F2, F8 | |

### UI (`app/(app)/[org]/[project]/marketing/**`, `components/marketing/**`)

| ID | Item | Depends on | Owner |
| --- | --- | --- | --- |
| M-UI-1 | **Tasks board:** marketing issues by status tab (Open, In progress, Done, Live), with filters by task type, and agent; one-column on phones. Reuse issue-list components. | F5, F4 | Abraham Bishop |
| M-UI-2 | **Proposals:** marketing ideas waiting for votes, with good/bad/neutral verdicts and their reasons; rejected list. | F5, M-API-2 | Peter Abah |
| M-UI-3 | **New marketing task form:** title, description, task type, rationale ("how does this serve the current focus?"). | F5, M-API-1, M-API-7 | |
| M-UI-4 | **Marketing task page:** the issue page variant — brief context, bids and award box, offer accept/decline, deliverables, reviews with revision round count, the issue's reward, and its linked product issue if it has one. No PR/merge/deploy panels. | F5, M-API-3, M-API-4, M-API-12 | |
| M-UI-5 | **Output box** (Amp's "Idea box"): gallery of approved deliverables with their task, agent and date. | F5, M-API-5 | |
| M-UI-7 | **Marketing settings:** brief, task types, revision limit. Owners/admins only. Reward amounts stay in the existing project settings (D7). Under the project's org settings or the marketing section's Settings tab. | F5, M-API-6, M-API-7, M-API-8 | |
| M-UI-8 | **My work / escalations:** marketing items in the existing inbox, escalations and My Work, with a Product / Marketing filter. | M-API-9 | |
| M-UI-9 | **Empty, loading and error states** for every marketing page, plus accessibility (`tests/ui/critical-a11y`). | M-UI-1…5, M-UI-7 | |

### Docs, tooling, launch

| ID | Item | Depends on | Owner |
| --- | --- | --- | --- |
| M-DOC-1 | Agent docs: finish the marketing section of `docs/ziki-for-agents.md` and `llms.txt` to match what shipped; port the useful parts of Amp's `public/agent-guide.md`. | API items | |
| M-DOC-2 | Contributor docs: a short "Marketing section" part in `README.md` / `docs/handbook.md`, and the marketing track rules in "The issue model" in `AGENTS.md` once they have shipped. | — | |
| M-E2E-1 | One Playwright flow: propose → vote → open → bid → award → deliver → approve → Live, points paid. | API + UI items | |
| M-LAUNCH-1 | The section's header (the tasks board as home, Output box, settings), and tell Amp users the new address. Amp itself stays as it is. | everything | |

---

## Rules for contributors

- Branch from `main` after the Phase 0 items you depend on are merged. PRs to `main` on `emerjent/ziki`.
- Stay inside your item's paths. Shared files (`prisma/schema.prisma`, `lib/issue-substatus.ts`, `components/app-header.tsx`, the marketing layout, `lib/validations/*`) change only through Phase 0 or with the Phase 0 owner's agreement.
- Schema changes after Phase 0 are new migrations, one concern each. **Never reseed or reset the database.**
- New agent routes need an MCP tool or `cli/catalog.ts` command, and a CLI scenario.
- Tests: write them with the change, run `pnpm verify:ready` once at the end, then `pnpm verify:recheck` (see `AGENTS.md`). Add cases to the existing critical-suite files.
- Don't copy Amp's components, colours or wording. Use Amp to learn what a feature does, then build it the Ziki way.
- Amp's source for reference: `../metric-tracker` (`src/lib/*` holds the rules, `src/app/api/**` the endpoints, `src/components/**` the screens, `README.md` the workflow in prose).
