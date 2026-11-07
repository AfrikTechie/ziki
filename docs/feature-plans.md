# Feature plans

**Turn one requested feature into a reviewed set of work, with a clear first version and definition of done.**

For example, an owner asks for appointment booking. Their plan describes the customer outcome, links an existing availability issue, proposes a booking idea for the first version, and keeps optional rescheduling for later. Each item has its own acceptance criteria. The whole plan retains an end-to-end success criterion: a customer can book an available appointment and receive confirmation.

## How this fits the existing tools

- A project brief describes the product and its current focus. A feature plan uses that context to break down one requested capability.
- Idea structuring clarifies one idea. A feature plan proposes several work items, reuses related work, and separates the first version from optional improvements before publication.
- Plan review is an awarded agent's implementation plan for an existing complex issue. A feature plan is the owner's product scope before those ideas become issues. It does not replace plan review or introduce issue dependency rules.

## Using it

1. Open a project's **Ideas → Feature plans → Plan a feature** (`/<org>/<project>/features`). Project members can create plans.
2. Describe one capability, its audience and constraints. Choose **Generate plan with AI**. Constraints are optional; no task-writing form is required.
3. Read the AI proposal cards: outcome, definition of done, First usable version and Later improvements. Review matching work from this project; link a relevant existing idea or issue instead of creating a duplicate. Check whether that work really meets the proposed criteria.
4. Open **Edit proposal (optional)** only if changes are needed. Edit, remove or add work items (up to eight). Put the smallest usable version in **First version**, and optional improvements in **Later**.
5. **Save draft and review**. A draft is private to its creator and creates no work.
6. **Publish first version**. The preview states how many ideas will be created and how many existing items will be linked. Publication shares the plan with project members and locks its scope. Its creator can publish the Later items separately when needed.
7. Follow linked work from the plan. Converted ideas lead to their issue. Verdicts, review, merge and reported deployment retain their actual meanings. A production count does not certify that the whole feature's success criteria have been met.

## What suggestions know

Automatic suggestions use the project's goal, brief, official notes (up to 6,000 characters), and up to twelve matching ideas and twelve matching issues. Search is limited to product work in the selected project. It is a starting point for review, not a codebase inspection or an exhaustive duplicate search. The owner can search again and change suggested links.

Generation uses the existing `ZIKI_CLAUDE_API_KEY` and idea-structuring provider, with no new dependency or credential. Private project context is sent to that provider only when the user requests a suggestion. Without a configured key, on refusal, or on failure, the page explains that AI is unavailable and preserves the request for retry. It never substitutes a blank manual plan. Request contents and model responses are not written to error logs. Suggestions never publish themselves.

## Existing workflow and safety

- New work is published as ordinary product **ideas**, with the task criteria, overall feature outcome, shared definition of done and a link back to the plan. There is no direct issue creation, automatic approval, assignment, new workflow state or reward rule.
- Reusing existing work only links it. It does not modify its description, acceptance criteria, status or claim. Moving it into Later does not pause work already underway.
- Every server action rechecks the explicit project's membership. Draft updates/publication also require the creator. Published plans are readable by project members; public-project visitors cannot read them.
- A plan row lock serializes saves and publication. Version checks refuse stale edits. Each published position has a unique receipt, so double clicks and retries do not create duplicate ideas. New ideas, their normal `idea.created` events and receipts are written in the same transaction.
- Retrying a draft save with different content refuses the request rather than silently discarding the newer edits.
- Existing references are rechecked against the project before publication. A deleted or foreign-project reference refuses the entire batch. Already-published receipts survive removal of linked work; retries do not silently replace it.
- Published scope is immutable. A changed feature needs a new plan; this preserves the relationship between the reviewed scope and the ideas it created.
- The migration adds two tables and relations. It does not modify existing issue/idea data or workflow states. No existing agent API response changes, and no agent route is added.
- Agents receive the resulting ordinary ideas through their existing work feed. Each new idea includes its task criteria and the overall context; the plan link is for people. There is no new agent command to discover.

## Review walkthrough

With the existing AI provider configured, describe a feature and constraints, generate a proposal, review the readable cards, and optionally edit the scope. Save and publish First version. Verify that only one normal idea appears, including its feature context. Reload the plan, inspect the idea link and unchanged definition of done, then publish Later. Existing-work reuse can be exercised by searching for that first idea in a second plan and linking it instead of publishing another copy.

Browser tests use saved proposal fixtures to exercise review, editing, privacy and publication without making paid provider calls. Generation failures and untrusted references are covered with a mocked provider in the unit suite.

Unit coverage is in `tests/intake/idea-create.test.ts`. The desktop/mobile browser scenario is `e2e/feature-plans.spec.ts` and uses the repository's isolated E2E database. Do not seed or reset a shared database to run it.
