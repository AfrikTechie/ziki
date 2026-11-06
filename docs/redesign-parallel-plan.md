# Ziki redesign — parallel agent plan

UI-only reskin. Source of truth: [`design-handoff/HANDOFF.md`](../design-handoff/HANDOFF.md) and the light/dark HTML pairs in [`design-handoff/designs/`](../design-handoff/designs/). Dark files are the same screens, not extra lanes.

Keep every existing route, server action, API call, permission, and feature. Change presentation. Do not invent routes or endpoints. Bracketed mockup text and chart numbers are sample data — bind real data. Setup copy other than the first lines of the Claude prompt stays as the app has it today.

## Why this split does not collide

The signed-in chrome (sidebar, top bar, tokens, font, logos) is on every screen. If several agents edit it, the last merge wins and the shell breaks. So:

1. **One shell agent lands first** and is the only agent allowed to edit shared chrome.
2. **Every later agent branches from `main` only after that PR is merged.**
3. **Each later agent owns a disjoint path list.** They import the shell. They do not edit it.
4. **One integrator runs last**, after every lane has merged, and is the only agent allowed to touch shared files again.

No lane rebases onto another lane. No lane edits `app/api/**`, `prisma/**`, `app/actions/**`, or auth configuration.

## Wave 0 — shell (one agent, blocks everyone)

Branch from `main`. Merge to `main` before Wave 1 starts.

Build, in this order:

1. Design tokens from HANDOFF.md (light and dark) in `app/globals.css`, `app/theme-brand.css`, and `app/theme-dark.css`. Page background `#F5F7FC` / `#070F22`. Cards and top bar use the surface token. Sidebar stays `#0B1733` in both themes. Filled buttons with white text use `#2E6FEF`. Manrope 400–800 replaces Inter in `app/layout.tsx`. Monospace stays `ui-monospace`. `prefers-reduced-motion` turns hover and entrance motion off.
2. Logo assets from `design-handoff/assets/` into `public/`. `ziki-logo-dark.png` is the white wordmark for the navy sidebar. `ziki-logo-light.png` is the navy wordmark. `ziki-mark.png` is the icon.
3. Shared shell, used by every signed-in page via `app/(app)/layout.tsx`:
   - Sidebar (~248px): logo, collapse, project switcher, nav **Overview**, **Issues** (live count), **Team**. Active item is the `#2E6FEF` pill. Agents is not in the sidebar. Team links to the existing `/settings/team` ( `/team` already redirects there). Collapse must work; at phone width the shell stacks to one column.
   - Top bar: points pill, Escalation button (red tint, existing pending count), Agents menu, theme toggle, notifications bell with unread badge, avatar menu.
   - Agents menu: the user’s agents, **Create agent**, **Manage agents**. Wire these to existing URLs only (`/settings/agents`, and the create flow that already lives there).
   - Avatar menu: name, role, points, Theme (System / Light / Dark), Switch organisation, Leaderboard, Settings, Docs and `/llms.txt`, Sign out. **Also keep** the role switcher and admin links that exist today. They are real features the mockup omitted.
   - Remove the floating Report issue button from `app/(app)/layout.tsx` and `app/(auth)/layout.tsx`. If `REPORT_FORM_URL` is set, keep that link inside the avatar menu so the capability is not deleted.
   - Remove the in-page `DashboardSidebar` from `app/(app)/dashboard/page.tsx` and `app/(app)/issues/(list)/page.tsx` so those pages do not render a second sidebar. Leave their page bodies otherwise untouched for the lane agents.
4. Export stable presentational pieces from `components/shell/` and stop. Suggested exports: `PageHeading` (title, optional description, actions slot for **New issue**), `SurfaceCard`, `PillButton` styles. Screen agents use these. They do not edit them.
5. Do not restyle individual screens in this PR.

**Frozen after this PR merges.** Later lanes must not edit:

- `app/globals.css`, `app/theme-brand.css`, `app/theme-dark.css`, `app/layout.tsx`
- `app/(app)/layout.tsx`, `app/(auth)/layout.tsx`
- `components/app-header.tsx`, `components/dashboard-sidebar.tsx`, `components/shell/**`
- `components/theme-toggle.tsx`, `components/organisation-switcher.tsx`, `components/brand-lockup.tsx`, `components/project-switcher.tsx`
- `components/page-container.ts`, `lib/header-nav.ts`
- `components/ui/button.tsx`, `input.tsx`, `badge.tsx`, `select.tsx`, `textarea.tsx`
- `design-handoff/**`
- `public/` logo files added by this PR

If a lane needs a token or prop that does not exist, build a local component inside that lane’s folder. Do not reopen the shell files. The integrator dedupes later.

## Wave 1 — eight lanes, started together, merged in any order

Each lane: one branch from post-shell `main`, one PR to `main`, paths below only. Match the light file and the `*Dark.dc.html` twin. Phone width: one column, cards full width, wide tables scroll. Touch targets at least 40px. Do not hard-code sample names or numbers.

| Lane | Mockups | Route | Owns |
| --- | --- | --- | --- |
| Overview | `Main.dc.html` overview half, `Dark.dc.html` | `/dashboard` | `app/(app)/dashboard/**`, `components/dashboard-agents.tsx`, `components/overview/**`, new `lib/points/history.ts` only |
| Issues | `Main.dc.html` issues half, `Dark.dc.html` | `/issues` | `app/(app)/issues/(list)/**`, `components/issue-filters.tsx`, `components/issue-row-meta.tsx`, `components/platform-tabs.tsx`, `components/pagination-controls.tsx` |
| Issue | `Issue.dc.html`, `IssueDark.dc.html` | `/issues/[id]`, plus `/issues/new` and `/issues/[id]/history` | `app/(app)/issues/[id]/**`, `app/(app)/issues/new/**`, `app/(app)/issues/not-found.tsx`, comment and timeline components listed below |
| Leaderboard | `Leaderboard.dc.html`, `LeaderboardDark.dc.html` | `/leaderboard` | `app/(app)/leaderboard/**` |
| Agents | Create, Manage, Connect, Approve, both themes | existing agent URLs | `app/(app)/settings/agents/**`, `components/first-agent-empty-state.tsx`, `components/agent-key-copy.tsx` |
| Settings | `Settings.dc.html`, `SettingsDark.dc.html` | `/settings` and the settings routes below | settings files listed below. Not `settings/agents/**`. Not `settings/webhooks/**` |
| Webhooks | `Webhooks.dc.html`, `WebhooksDark.dc.html` | `/settings/webhooks` | `app/(app)/settings/webhooks/**`, `components/webhook-management.tsx` |
| Sign-in | `Login.dc.html`, `LoginDark.dc.html` | `/login` | `app/(auth)/login/**`, `app/(auth)/signup/**`, `app/(auth)/forgot-password/**`, `app/(auth)/reset-password/**`, `app/(auth)/join/**`, `components/login-form.tsx`, `components/signup-form.tsx`, `components/forgot-password-form.tsx`, `components/reset-password-form.tsx`, `components/google-sign-in-button.tsx` |

`Main.dc.html` is two views in one file. Overview owns the welcome view. Issues owns the list view. They do not edit each other’s files. The sidebar switch is already the shell’s real navigation.

### What each designed screen must show

- **Overview.** Greeting with the real name. **New issue** beside the title (links to existing `/issues/new`). Four stat cards: Points, Created by me, Assigned to me, Resolved issues. Hover lift and top gradient line, disabled under reduced motion. “Issues assigned to me” table. “Your points” chart with Daily / Weekly / Monthly / Yearly and a date-range picker (presets plus From / To). Weekly view draws a dashed 500-pt line; weeks at or above 500 are solid blue with a green “+N” chip. Users may exceed 500. Read points from `PointEntry` in a **new** `lib/points/history.ts`. Do not edit `lib/points/leaderboard.ts`, `lib/dashboard-queries.ts`, or the schema.
- **Issues.** Title plus **New issue**. Platform tabs with counts. Search with the existing `/` shortcut. Filter popover: Show, Kind, Status, Severity, Category, Platform, Sort By. Keep every filter the app already supports even if the mockup shows a shorter list. Empty states use the mockup’s wording only where it matches real filter results.
- **Issue.** Number and title. Main column and side rail. Conversation and Agent decisions tabs. Comment types keep a label, icon, and 4px left accent: Comment, Bid, Review, Delivery, Merge request. Agent decisions: Not a real issue, Confirmed, Claimed, Good to merge, Not ready to merge. Status language everywhere: High = bad, Medium = warn with border, Low = chip; Open / In progress = info; Confirmed = ok; Reported = chip. `/issues/new` and history keep working and use the same cards, type, and buttons. Do not drop edit, vote, assign, claim, bid, merge, delete, or restore.
- **Leaderboard.** Top-3 podium, “your standing”, rankings, Points / Solved sort. Real totals only.
- **Agents.** Map onto URLs that already exist. Do not add `/settings/agents/new`.
  - Manage → `/settings/agents` (one card per agent, key strip, preferred areas).
  - Create → the existing create form, presented as the Create screen (starting level as selectable cards). A view on the manage page is fine.
  - Connect → `/settings/agents/connect` (stepper, assistant cards, setup block, test connection).
  - Approve → `/settings/agents/pair`. Code auto-uppercases and inserts the dash (`ABCD-2345`). Continue stays disabled until the code is valid. Flow is code → review → approved or denied.
  - Also restyle `/settings/agents/[agentId]/messages` with the same cards. Do not change message behaviour.
- **Settings.** Left section nav: Account, Preferences, Agents & API, Data & privacy. Account holds profile, wallet, two-factor. Preferences holds appearance, email notifications, keyboard shortcuts. Agents & API is a **link list** to Connect, Approve, Manage, Create, Webhooks, audit, and team — it does not reimplement those pages. Data & privacy holds export and delete. Save stays disabled until the value changes. Wallet validates `0x` plus 40 hex. Notification sub-toggles disable when the master is off. Delete account requires typing `DELETE`. Keep `/settings/profile`, `/settings/security`, `/settings/team`, and `/settings/audit` working. Profile and security may render the matching section or redirect to `?section=` on `/settings`. Team and audit pages get the same card and type treatment; their forms stay.
- **Webhooks.** Subscriptions list, add form, one-time secret reveal. Add stays disabled until an agent is chosen and the URL is valid `https://`.
- **Sign in.** Split layout: brand panel plus the sign-in card, light and dark. **Keep email/password and Google.** The mockup shows Google only; credentials are an existing feature and stay on the card. Signup, forgot-password, reset-password, and join use the same split frame and their current copy. They are not separate mockups.

### Settings lane file list

- `app/(app)/settings/page.tsx`
- `app/(app)/settings/loading.tsx`
- `app/(app)/settings/profile/**`
- `app/(app)/settings/security/**`
- `app/(app)/settings/team/**`
- `app/(app)/settings/audit/**`
- `components/theme-settings.tsx`
- `components/notification-settings.tsx`
- `components/wallet-address-form.tsx`
- `components/keyboard-shortcut-settings.tsx`
- `components/account-data-settings.tsx`
- `components/change-password-form.tsx`
- `components/display-name-form.tsx`
- `components/audit-log.tsx`
- `components/member-role-actions.tsx`

### Issue lane component list

Own these, and only these, under `components/`:

`activity-timeline.tsx`, `agent-resolved-notice.tsx`, `assignee-combobox.tsx`, `attachment-list.tsx`, `attachment-picker.tsx`, `comment-body.tsx`, `comment-form.tsx`, `comment-permalink-resolver.tsx`, `comment-thread.tsx`, `delete-issue-button.tsx`, `duplicate-controls.tsx`, `editable-issue-description.tsx`, `editable-proof-links.tsx`, `issue-agent-activity.tsx`, `issue-approval-banner.tsx`, `issue-bids.tsx`, `issue-escalations.tsx`, `issue-pull-request.tsx`, `markdown-editor.tsx`, `restore-issue-button.tsx`, `self-assign-button.tsx`, `similar-issues.tsx`, `update-issue-form.tsx`, `vote-button.tsx`, `voter-avatars.tsx`, `voter-overflow-badge.tsx`.

## Wave 1b — two residual lanes (same time as Wave 1)

No mockup. Do not invent a new layout. Apply `PageHeading`, surface cards, pills, and the status colours so these pages match the shell. Keep every control.

| Lane | Owns |
| --- | --- |
| Work queues | `app/(app)/escalations/**`, `app/(app)/questions/**`, `app/(app)/redesigns/**`, `app/(app)/notifications/**`, `app/(app)/docs/**`, `app/(app)/feed/**`, `app/(app)/jobs/**`, `components/escalation-controls.tsx`, `components/goal-budgets.tsx`, `components/mark-all-read-button.tsx` |
| Organisation admin | `app/(app)/projects/**`, `app/(app)/milestones/**`, `app/(app)/admin/**`, `app/(app)/points/**`, `app/(app)/organisations/**`, `app/(app)/users/**`, `components/milestone-manager.tsx`, `components/milestone-progress.tsx`, `components/milestone-due.tsx`, `components/points-ledger.tsx`, `components/points-summary.tsx`, `components/project-reward-rules-display.tsx`, `components/project-reward-rules-section.tsx` |

`app/(app)/team/page.tsx` is a redirect. Leave it.

**Out of scope for every lane:** `app/page.tsx` and `components/homepage/**` (marketing home), `app/api/**`, `prisma/**`, `e2e/**` unless a lane broke a selector it owns.

## Wave 2 — integrator (one agent, after all Wave 1 PRs merge)

- Walk every route in the tables above in light, dark, and a phone-width viewport.
- Fix only cross-lane gaps: a page that missed the shell, a double sidebar, a status colour that disagrees, a control that moved and no longer submits.
- This is the only time shared files may change after Wave 0.
- Run `pnpm test` and `pnpm lint`. On Node 26, `NODE_OPTIONS=--no-experimental-webstorage pnpm test`.

## Per-lane definition of done

- Light and dark match the mockup’s spacing, type, radius (cards 20px, controls pills, inputs 12px and 42–48px tall), and copy that is not marked as sample data.
- Every control that worked before still works: same action, same permission, same empty and error state.
- `pnpm test` for the files the lane touched. Do not restyle tests into failure; update assertions that check class names the lane intentionally changed.
- PR description lists owned paths and the routes checked.

## Conflict rules (do not relax these)

- Start Wave 1 only from `main` after the shell PR is merged.
- If a file is not in your lane’s list, you do not edit it.
- Do not format the whole repo. Do not upgrade dependencies.
- Do not reseed or reset the database.
- Two PRs that both only add files under different directories merge cleanly. That is the point of the path lists.
- A lane that discovers it must edit a frozen file stops and leaves a PR note. It does not push the edit.
