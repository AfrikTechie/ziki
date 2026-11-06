// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The issue page's stage panels: bids with their votes and the Award control only where it may be used, confirmations and their banner, and judgements and merge reviews with their replies. */
const mocks = vi.hoisted(() => ({ addComment: vi.fn() }));
const libraryRefresh = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/[org]/[project]/marketing/output-box/actions", () => ({ refreshLibrary: libraryRefresh }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ org: "acme", project: "demo" }),
  usePathname: () => "/demo/1",
}));
vi.mock("@/app/actions/issues", () => ({ addCommentAction: mocks.addComment }));
vi.mock("@/app/actions/issue-bids", () => ({ awardIssueBidAction: vi.fn() }));
vi.mock("@/app/actions/confirmations", () => ({ giveConfirmationAction: vi.fn() }));
vi.mock("@/app/actions/watch", () => ({ setWatchingAction: vi.fn() }));
const decisionActions = vi.hoisted(() => ({ respond: vi.fn(async () => ({ ok: true as const })), agree: vi.fn(async () => ({ ok: true as const })) }));
vi.mock("@/app/actions/your-decision", () => ({ respondToCloseAction: decisionActions.respond, agreeWithCloseAction: decisionActions.agree }));

import { MergeReviewsPanel, TestVerdictsPanel, type MergeReviewView, type TestVerdictView } from "@/components/issue-review-entries";
import { IssueBidsPanel, type BidEntryView } from "@/components/issue-bids";
import { IssueConfirmationsPanel, type ConfirmationEntryView, type ConfirmationsData } from "@/components/issue-confirmations";
import { Library } from "@/components/marketing/library/library";
import { deliveryFiles, filterLibrary, type LibraryItem } from "@/components/marketing/library/model";
import { MarketingTaskHeader } from "@/components/marketing/marketing-task-header";
import { MarketingDeliverablesPanel, type MarketingDeliveryView } from "@/components/marketing/marketing-deliverables-panel";
import { MarketingTaskDetail } from "@/components/marketing/marketing-task-detail";
import { projectRef } from "@/lib/project-paths";
import { DecisionCard } from "@/components/decision-card";
import { decisionFor, type DecisionIssue, type DecisionSuggestion } from "@/lib/your-decision";

const PR = "https://github.com/emerjent/ziki/pull/42";

const verdict: TestVerdictView = {
  id: "tv1",
  agentName: "Bob's Claude",
  by: "Bob",
  goodToMerge: false,
  summary: "Not good to merge: Save still fails.",
  description: "Clicked Save twice on the PR head in Safari; the second click does nothing.",
  pullRequestUrl: PR,
  headSha: "abc1234def",
  current: true,
  updatedAt: new Date("2026-10-29T10:00:00Z"),
  replies: [{ id: "r1", body: "Which Safari version?", authorName: "Ada", agentName: null, createdAt: new Date("2026-10-29T11:00:00Z") }],
};

const review: MergeReviewView = {
  id: "mr1",
  agentName: "Dana's Claude",
  by: "Dana",
  verdict: "accept",
  summary: "Accept: small and tested.",
  description: "Two independent testers verified the head commit.",
  pullRequestUrl: PR,
  headSha: "0123456789",
  current: false,
  updatedAt: new Date("2026-10-29T12:00:00Z"),
  replies: [],
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("Library approved deliverables", () => {
  const items: LibraryItem[] = [
    { id: "launch", number: 42, title: "Launch campaign", summary: "Approved campaign", agent: "Studio", publishedAt: "2026-11-04T12:00:00Z", files: deliveryFiles(["https://example.com/social.png", "https://example.com/guide.docx"]) },
    { id: "article", number: 38, title: "Agent workflow", summary: "A workflow guide", agent: "Writer", publishedAt: "2026-11-02T12:00:00Z", files: deliveryFiles(["https://example.com/blog/workflow"]) },
  ];
  beforeEach(() => {
    window.history.replaceState(null, "", "/demo/marketing/library");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("combines attachment type and search, sorts by publication, and refuses unsafe sources", () => {
    expect(filterLibrary(items, "guide.docx", "Docs", false).map((item) => item.id)).toEqual(["launch"]);
    expect(filterLibrary(items, "#38", "Articles", false).map((item) => item.id)).toEqual(["article"]);
    expect(filterLibrary(items, "Studio", "Videos", false)).toEqual([]);
    expect(filterLibrary(items, "", "All", true).map((item) => item.id)).toEqual(["article", "launch"]);
    const written = [{ ...items[0], id: "written", files: deliveryFiles([], [], "# The launch essay") }];
    expect(filterLibrary(written, "launch essay", "Articles", false).map((item) => item.id)).toEqual(["written"]);
    expect(deliveryFiles(["javascript:alert(1)", "data:text/html,bad", "https://user:password@example.com/file", "/api/attachments/unrelated"])).toEqual([]);
    expect(deliveryFiles(["/api/attachments/owned"], [{ id: "owned", filename: "graphic.png", contentType: "image/png", size: 20 }])).toEqual([expect.objectContaining({ name: "graphic.png", local: true, kind: "Graphics" })]);
  });

  it("switches attachments and updates actions without changing the associated task", async () => {
    const user = userEvent.setup();
    const view = render(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    await user.click(screen.getByRole("button", { name: "guide.docx" }));
    view.rerender(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    expect(screen.getByRole("link", { name: /Open original/ })).toHaveAttribute("href", "https://example.com/guide.docx");
    expect(screen.getByRole("link", { name: /View task #42/ })).toHaveAttribute("href", "/acme/demo/42");
    expect(screen.getByRole("button", { name: /Download/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Agent workflow.*Task #38/ }));
    view.rerender(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    expect(screen.getByRole("link", { name: /Open original/ })).toHaveAttribute("href", "https://example.com/blog/workflow");
    expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
  });

  it("keeps everything typed in search while the URL catches up", async () => {
    const user = userEvent.setup();
    render(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    const search = screen.getByRole("searchbox", { name: "Search approved work" });
    await user.type(search, "workflow");
    expect(search).toHaveValue("workflow");
    expect(new URLSearchParams(window.location.search).get("q")).toBe("workflow");
    expect(screen.queryByRole("button", { name: /Launch campaign.*Task #42/ })).not.toBeInTheDocument();
  });

  it("retries only a failed preview and keeps task access available", async () => {
    const user = userEvent.setup();
    render(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    fireEvent.error(screen.getByRole("img", { name: /Launch campaign/ }));
    await user.click(screen.getByRole("button", { name: "Retry preview" }));
    expect(screen.getByRole("img", { name: /Launch campaign/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View task #42/ })).toHaveAttribute("href", "/acme/demo/42");
    expect(libraryRefresh).not.toHaveBeenCalled();
  });

  it("retains results on refresh failure and recovers from an initial collection error", async () => {
    const user = userEvent.setup();
    libraryRefresh.mockResolvedValue({ ok: false });
    const view = render(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/previous results/);
    expect(screen.getByRole("link", { name: /View task #42/ })).toBeInTheDocument();
    view.unmount();
    libraryRefresh.mockResolvedValue({ ok: true, items });
    render(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: false }} />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /View task #42/ })).toBeInTheDocument();
  });

  it("keeps mobile selection and search in the URL when returning from the detail view", async () => {
    window.history.replaceState(null, "", "/demo/marketing/library?q=Studio");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const user = userEvent.setup();
    const view = render(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    await user.click(screen.getByRole("button", { name: /Launch campaign.*Task #42/ }));
    view.rerender(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    expect(new URLSearchParams(window.location.search).get("view")).toBe("detail");
    expect(screen.getByRole("heading", { name: "Launch campaign" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /Back to Library/ }));
    view.rerender(<Library slug={projectRef("acme", "demo")} projectName="Demo" initial={{ ok: true, items }} />);
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Studio");
    expect(new URLSearchParams(window.location.search).get("item")).toBe("launch");
    expect(new URLSearchParams(window.location.search).has("view")).toBe(false);
    expect(screen.getByRole("button", { name: /Launch campaign.*Task #42/ })).toHaveAttribute("aria-pressed", "true");
    scroll.mockRestore();
  });
});

describe("TestVerdictsPanel (#review-entries)", () => {
  it("shows each verdict's chip, agent, owner, summary, description, pull request and replies", () => {
    render(<TestVerdictsPanel bugId="bug1" verdicts={[verdict]} canReply />);
    expect(screen.getByRole("heading", { name: /Judgements/ })).toBeInTheDocument();
    expect(screen.getByText("Not good to merge")).toBeInTheDocument();
    expect(screen.getByText("Bob's Claude")).toBeInTheDocument();
    expect(screen.getByText("for Bob")).toBeInTheDocument();
    expect(screen.getByText(verdict.summary)).toBeInTheDocument();
    expect(screen.getByText(verdict.description)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #42" })).toHaveAttribute("href", PR);
    expect(screen.getByText(/abc1234/)).toBeInTheDocument();
    expect(screen.getByText("Which Safari version?")).toBeInTheDocument();
    expect(screen.queryByText("Earlier code")).toBeNull();
  });

  it("replies to a verdict with a plain comment naming it", async () => {
    mocks.addComment.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<TestVerdictsPanel bugId="bug1" verdicts={[verdict]} canReply />);
    await user.click(screen.getByRole("button", { name: "Reply" }));
    const form = screen.getByRole("form", { name: "Reply to this judgement" });
    await user.type(form.querySelector("textarea")!, "Safari 18.");
    await user.click(screen.getAllByRole("button", { name: "Reply" }).at(-1)!);
    await waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(1));
    const [bugId, data] = mocks.addComment.mock.calls[0] as [string, FormData];
    expect(bugId).toBe("bug1");
    expect(data.get("testVerdictId")).toBe("tv1");
    expect(data.get("body")).toBe("Safari 18.");
    expect(data.get("type")).toBeNull();
  });
});

describe("MergeReviewsPanel (#review-entries)", () => {
  it("shows the manager's accept, marks a review of earlier code, and replies by mergeReviewId", async () => {
    mocks.addComment.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MergeReviewsPanel bugId="bug1" reviews={[review]} canReply />);
    expect(screen.getByRole("heading", { name: /Merge reviews/ })).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dana's Claude")).toBeInTheDocument();
    expect(screen.getByText("Earlier code")).toBeInTheDocument();
    expect(screen.getByText(review.summary)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reply" }));
    const form = screen.getByRole("form", { name: "Reply to this merge review" });
    await user.type(form.querySelector("textarea")!, "Thanks.");
    await user.click(screen.getAllByRole("button", { name: "Reply" }).at(-1)!);
    await waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(1));
    expect((mocks.addComment.mock.calls[0][1] as FormData).get("mergeReviewId")).toBe("mr1");
  });
});

const bid: BidEntryView = {
  id: "bid1",
  agentName: "Ada's Claude",
  by: "Ada",
  summary: "I can fix the login redirect today.",
  description: "The session cookie is dropped on redirect. I will keep it and add a test.",
  areaMatch: true,
  updatedAt: new Date("2026-10-29T10:00:00Z"),
  replies: [{ id: "r1", body: "Please add a regression test.", authorName: "Cara", agentName: null, createdAt: new Date("2026-10-29T11:00:00Z") }],
};


describe("IssueBidsPanel (#issue-bids)", () => {

  it("is one compact card past Open, collapsed, naming the awarded bid, and expands to the bids without Award", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <IssueBidsPanel
        bids={[{ ...bid, awardedAt: new Date("2026-10-29T12:00:00Z") }, { ...bid, id: "bid2", agentName: "Bob's agent" }]}
        collapsed
      />,
    );
    const card = screen.getByTestId("bids");
    const fold = card.querySelector("details")!;
    expect(fold).not.toHaveAttribute("open");
    expect(card).toHaveTextContent(/Ada's Claude/);
    await user.click(screen.getByText(/Awarded to Ada's Claude/));
    expect(fold).toHaveAttribute("open");
    expect(screen.getByText("Bob's agent")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Award bid" })).toBeNull();
  });

  it("shows each open bid's votes, and no Award button to a viewer who can't award", () => {
    render(<IssueBidsPanel bids={[{ ...bid, votes: 3 }, { ...bid, id: "bid2", agentName: "Bob's agent", votes: 1 }, { ...bid, id: "bid3", agentName: "Cara's agent" }]} />);
    expect(screen.getAllByTestId("bid-votes").map((votes) => votes.textContent?.match(/\d+/)?.[0])).toEqual(["3", "1", "0"]);
    expect(screen.queryByRole("button", { name: /Award/ })).toBeNull();
  });

  it("offers Award on every open bid, whatever its votes, and only to a viewer who can award (#open-award)", () => {
    const at = new Date("2026-10-29T12:00:00Z");
    const bids: BidEntryView[] = [
      { ...bid, id: "open1", agentName: "Open agent", votes: 3 },
      { ...bid, id: "open2", agentName: "Second agent", votes: 4 },
      { ...bid, id: "below1", agentName: "Short agent", votes: 2 },
      { ...bid, id: "withdrawn1", agentName: "Withdrawn agent", withdrawnAt: at, votes: 3 },
      { ...bid, id: "released1", agentName: "Released agent", awardedAt: at, awardReleasedAt: at, votes: 3 },
    ];
    const { unmount } = render(<IssueBidsPanel bids={bids} canAward awardThreshold={3} />);
    const buttons = screen.getAllByRole("button", { name: /Award/ });
    expect(buttons).toHaveLength(3);
    const awardedIds = buttons.map((button) => (button.closest("form")?.querySelector("input[name=bidId]") as HTMLInputElement | null)?.value);
    // Every open bid, the most voted first; the one below the old threshold too.
    expect(awardedIds).toEqual(["open2", "open1", "below1"]);
    expect(screen.getByTestId("bid-withdrawn").querySelector("button")).toBeNull();
    expect(screen.getByTestId("bid-released").querySelector("button")).toBeNull();
    unmount();

    render(<IssueBidsPanel bids={bids} awardThreshold={3} />);
    expect(screen.queryByRole("button", { name: /Award/ })).toBeNull();
  });

  it("marks an open bid whose bidder is at capacity, and offers no Award button for it (#bidder-capacity)", () => {
    render(<IssueBidsPanel bids={[{ ...bid, id: "full", agentName: "Pixel", atCapacity: true, votes: 3 }, { ...bid, id: "free", agentName: "Cara's agent", votes: 3 }]} canAward awardThreshold={3} />);
    const marks = screen.getAllByTestId("bid-at-capacity");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("at capacity");
    expect(marks[0].closest("li")).toHaveTextContent("Pixel");
    const buttons = screen.getAllByRole("button", { name: /Award/ });
    expect(buttons.map((button) => (button.closest("form")?.querySelector("input[name=bidId]") as HTMLInputElement | null)?.value)).toEqual(["free"]);
  });

});

const entry = (id: string, by: string, at: string): ConfirmationEntryView => ({
  id,
  verdict: "confirm",
  summary: `${by} reproduced it.`,
  description: `${by}'s steps and what happened.`,
  duplicateOf: null,
  onBehalfOfUserId: `user-${id}`,
  by,
  agentName: null,
  counted: true,
  undone: false,
  updatedAt: new Date(at),
  replies: [],
});

const data: ConfirmationsData = {
  confirmations: 2,
  confirmationsNeeded: 2,
  entries: [entry("c1", "Ada", "2026-10-28T10:00:00Z"), entry("c2", "Bob", "2026-10-28T11:00:00Z")],
};


describe("IssueConfirmationsPanel past Requires confirmation", () => {
  it("is one compact card, collapsed, with who confirmed it, and expands to the entries", async () => {
    const user = userEvent.setup({ delay: null });
    render(<IssueConfirmationsPanel bugId="bug1" data={data} viewerId="viewer" block={null} summaryMaxChars={200} history confirmed />);
    const card = screen.getByTestId("confirmations-collapsed");
    const fold = card.querySelector("details")!;
    expect(fold).not.toHaveAttribute("open");
    expect(card).toHaveTextContent(/Ada.*Bob/);
    // No big banner while it is collapsed.
    expect(screen.queryByTestId("confirmation-banner")).toBeNull();
    await user.click(screen.getByText(/Confirmed by/));
    expect(fold).toHaveAttribute("open");
    expect(screen.getByText("Ada reproduced it.")).toBeVisible();
  });

  it("shows the full cards, and no Not confirmed banner, while the issue requires confirmation", () => {
    render(<IssueConfirmationsPanel bugId="bug1" data={data} viewerId="viewer" block={null} summaryMaxChars={200} confirmed={false} />);
    expect(screen.queryByTestId("confirmations-collapsed")).toBeNull();
    expect(screen.getByText("Ada reproduced it.")).toBeInTheDocument();
    // The next-step bar says what is still needed; the panel has no banner of its own.
    expect(screen.queryByTestId("confirmation-banner")).toBeNull();
    expect(screen.queryByText(/Not confirmed yet/)).toBeNull();
  });

  it("shows the green Confirmed banner, naming who confirmed it, once confirmed", () => {
    render(<IssueConfirmationsPanel bugId="bug1" data={data} viewerId="viewer" block={null} summaryMaxChars={200} confirmed />);
    const banner = screen.getByTestId("confirmation-banner");
    expect(banner).toHaveAttribute("data-confirmed", "true");
    expect(banner).toHaveTextContent(/Ada.*Bob/);
  });
});

describe("Marketing task detail (M-UI-4)", () => {
  it("deduplicates badge when taskType name is Marketing", () => {
    render(
      <MarketingTaskHeader
        number={43}
        title="Author Technical Deep-Dive Article"
        description="Write deep-dive."
        status="open"
        substatus="open"
        taskType={{ id: "t-mkt", name: "Marketing" }}
        reward={350}
        revisionCount={0}
        maxRevisions={2}
        projectSlug={projectRef("acme", "ziki")}
        createdAt={new Date("2026-11-01T12:00:00Z")}
      />
    );
    const marketingBadges = screen.getAllByText("Marketing");
    expect(marketingBadges.length).toBe(1);
  });

  it("renders external deliverable links with domain formatting", () => {
    const deliveries: MarketingDeliveryView[] = [
      {
        id: "del-1",
        agentName: "Creative Claude",
        by: "Fabian",
        summary: "Teaser video render and social banner assets",
        description: "Uploaded assets.",
        deliverableUrls: ["https://figma.com/design/sample123"],
        screenshots: [],
        current: true,
        updatedAt: new Date("2026-11-02T10:00:00Z"),
        replies: [],
      },
    ];

    render(
      <MarketingDeliverablesPanel
        bugId="bug-1"
        deliveries={deliveries}
        isInProgress={false}
        canReply={true}
      />
    );

    const figmaLink = screen.getByRole("link", { name: /figma\.com/ });
    expect(figmaLink).toHaveAttribute("href", "https://figma.com/design/sample123");
    expect(screen.getByText("figma.com")).toBeInTheDocument();
  });

  it("shows work delivered as Markdown as a file, which opens a reader that renders it safely", async () => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn() });
    render(
      <MarketingDeliverablesPanel
        bugId="bug-1"
        canReply={false}
        deliveries={[{
          id: "del-2", agentName: "Writer", by: "Fabian", summary: "Wrote the launch post.", description: "Checked it.",
          deliverableText: "# The launch post\n\nThree words here. <script>alert(1)</script>",
          current: true, updatedAt: new Date("2026-11-02T10:00:00Z"), replies: [],
        }]}
      />,
    );

    // A file until it is opened: the work's text isn't on the page yet.
    expect(screen.queryByRole("heading", { name: "The launch post" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Delivered work.*click to open/ }));

    expect(screen.getByRole("heading", { name: "The launch post", hidden: true })).toBeInTheDocument();
    expect(document.querySelector("dialog script")).toBeNull();
  });

  it("switches tabs between pipeline sections and activates discussion on hash", () => {
    const bug = {
      id: "bug-mkt-1",
      number: 101,
      title: "Write Q4 Launch Thread on X",
      description: "Draft 8-tweet thread.",
      status: "in_progress" as const,
      substatus: "in_progress" as const,
      reward: 500,
      revisionCount: 1,
      createdAt: new Date("2026-11-04T00:00:00Z"),
      type: { id: "t2", name: "Social Copy" },
      project: { slug: projectRef("acme", "ziki") },
    };

    const { container } = render(
      <MarketingTaskDetail
        bug={bug}
        revisionLimit={2}
        hold={{
          id: "hold-1",
          status: "active",
          via: "claim",
          dispatcherName: null,
          claimedAt: new Date("2026-11-04T01:00:00Z"),
          deliverBy: null,
          agentName: "Copy Agent",
          personName: "Fabian",
          offeredAt: new Date("2026-11-04T01:00:00Z"),
          releaseAt: null,
          waitingOnOwner: false,
          hasPullRequest: false,
        }}
        agentPaused={false}
        isWatching={false}
        isIssueOwner={false}
        deliveries={[]}
        reviews={[]}
        bidsSlot={<div data-testid="bids-content">Bids Content</div>}
        commentsSlot={<div data-testid="comments-content">Comments Content</div>}
        bidsCount={1}
        commentsCount={2}
        canReply={true}
      />
    );

    const deliverablesPanel = container.querySelector("#panel-deliverables");
    const bidsPanel = container.querySelector("#panel-bids");
    const discussionPanel = container.querySelector("#panel-discussion");

    // In-progress defaults to deliverables
    expect(deliverablesPanel).not.toHaveAttribute("hidden");

    // Click Bids & Award tab
    fireEvent.click(screen.getByRole("tab", { name: /Bids & Award/i }));
    expect(bidsPanel).not.toHaveAttribute("hidden");
    expect(deliverablesPanel).toHaveAttribute("hidden");

    // Simulate #comments hash navigation
    window.location.hash = "#comments";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(discussionPanel).not.toHaveAttribute("hidden");
  });
});

describe("A decision about your work (#your-decisions)", () => {
  const closed: DecisionIssue = {
    status: "closed",
    isDeleted: false,
    reporterId: "alice",
    beneficiaryUserId: "alice",
    closeReason: "duplicate",
    closeEvidence: "Same steps and screen as #9, filed first.",
    duplicateOf: { number: 9, title: "Resources tabs are empty" },
  };
  const vote = (onBehalfOfUserId: string, by: string, votes = 1, reason = "duplicate"): DecisionSuggestion => ({
    reason, votes, summary: `${by}: #9 owns this work.`, evidence: null, onBehalfOfUserId, by, agentName: `${by}'s Claude`,
  });
  const suggestions = [vote("cara", "Cara", 2), vote("alice", "Alice"), vote("bob", "Bob"), vote("dan", "Dan", 1, "not_planned")];
  const decide = (issue: DecisionIssue, viewerId: string, list = suggestions) =>
    decisionFor({ issue, viewerId, suggestions: list, threshold: 3, decidedAt: new Date("2026-11-05T10:00:00Z") });

  it("tells the owner who closed their issue and with what: other people's votes for the reason it closed with", () => {
    const decision = decide(closed, "alice")!;
    expect(decision.voters.map((voter) => voter.by)).toEqual(["Cara", "Bob"]);
    expect(decision.votes).toBe(3);
    expect(decision.evidence).toBe(closed.closeEvidence);
    // The person it is for sees it too, not only the reporter.
    expect(decide({ ...closed, reporterId: "agent-owner" }, "alice")).not.toBeNull();
  });

  it("shows nothing to anyone else, for a withdrawal or a deleted issue, before it closes, or when only the owner voted", () => {
    expect(decide(closed, "bob")).toBeNull();
    expect(decide({ ...closed, closeReason: "withdrawn" }, "alice")).toBeNull();
    expect(decide({ ...closed, isDeleted: true }, "alice")).toBeNull();
    expect(decide({ ...closed, status: "open", closeReason: null }, "alice")).toBeNull();
    expect(decide(closed, "alice", [vote("alice", "Alice", 3)])).toBeNull();
  });

  it("sends the owner's reply with their evidence, or their agreement", async () => {
    const user = userEvent.setup({ delay: null });
    render(<DecisionCard issueId="bug1" decision={decide(closed, "alice")!} />);
    await user.click(screen.getByRole("button", { name: "I agree" }));
    expect(decisionActions.agree).toHaveBeenCalledWith("bug1");
    await user.click(screen.getByRole("button", { name: "Respond" }));
    await user.type(screen.getByLabelText(/Your side/), "Mine is about the mobile page; #9 is desktop only.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(decisionActions.respond).toHaveBeenCalledWith("bug1", "Mine is about the mobile page; #9 is desktop only."));
  });

  it("says a manager can reopen only a not-reproducible close", async () => {
    const user = userEvent.setup({ delay: null });
    const notReproducible = decide({ ...closed, closeReason: "not_reproducible", duplicateOf: null }, "alice", [vote("cara", "Cara", 3, "not_reproducible")])!;
    render(<DecisionCard issueId="bug1" decision={notReproducible} />);
    await user.click(screen.getByRole("button", { name: "Respond" }));
    expect(screen.getByText(/A manager can reopen it with your fresh reproduction/)).toBeInTheDocument();
  });

  it("folds to one line once the owner agreed", () => {
    render(<DecisionCard issueId="bug1" decision={decide({ ...closed, closeAgreedAt: new Date("2026-11-05T11:00:00Z") }, "alice")!} />);
    expect(screen.getByTestId("decision-agreed")).toHaveTextContent(/You agreed with this decision/);
    expect(screen.queryByRole("button", { name: "Respond" })).toBeNull();
  });
});
