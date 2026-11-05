// @vitest-environment jsdom
"use client";

import axe from "axe-core";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { labelInNameMismatches } from "@/lib/a11y/label-in-name";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EntryReplyForm } from "@/components/entry-reply-form";
import { CreateBugForm } from "@/components/create-issue-form";
import { UserSearch } from "@/components/user-search";
import { VoteButton } from "@/components/vote-button";
import { WebhookManagement } from "@/components/webhook-management";
import { createWebhookAction, listWebhooksAction } from "@/app/actions/webhooks";
import { OnScreenGuide } from "@/components/support-guide/on-screen-guide";
import { getPageGuidance, searchSupportAnswers } from "@/components/support-guide/support-guide-data";
import { projectRef } from "@/lib/project-paths";

vi.mock("@/app/actions/issues", () => ({
  addCommentAction: vi.fn(),
  createBugAction: vi.fn(),
  toggleVoteAction: vi.fn(),
}));

vi.mock("@/app/(app)/points/disputes/actions", () => ({
  openDisputeAction: vi.fn(),
}));

vi.mock("@/app/(app)/questions/actions", () => ({
  answerQuestionAction: vi.fn(),
}));

vi.mock("@/app/actions/webhooks", () => ({
  createWebhookAction: vi.fn(),
  deleteWebhookAction: vi.fn(),
  listWebhooksAction: vi.fn(),
  reEnableWebhookAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ project: "acme" }),
  usePathname: () => "/",
}));

beforeAll(() => {
  // axe probes a canvas to detect icon-font ligatures. jsdom's getContext
  // throws "Not implemented" and floods stderr; a minimal stub lets the check
  // degrade quietly instead of erroring.
  window.HTMLCanvasElement.prototype.getContext = (() =>
    ({
      font: "",
      measureText: () => ({ width: 0 }),
    })) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
});

afterEach(() => cleanup());

/** Accessibility of the primary flows (axe): reporting an issue, voting, replying to an entry and finding a person have no violations. */
/**
 * axe-core needs a layout engine for two checks, and jsdom has none:
 * - `color-contrast` needs real computed colours and canvas.
 * - `region` assumes a full page with landmarks; these are isolated widgets.
 * - `label-content-name-mismatch` needs layout to decide which text is visible,
 *   so expectNoA11yViolations checks that from the text instead.
 * Everything else runs normally.
 */
const AXE_OPTIONS: axe.RunOptions = {
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
  },
};

/** Render a node, run axe over it, and fail with the readable violation list. */
async function expectNoA11yViolations(node: HTMLElement) {
  const results = await axe.run(node, AXE_OPTIONS);
  const violations = results.violations.map(
    (v) => `${v.id} (${v.impact ?? "n/a"}): ${v.help}`,
  );
  // axe skips label-in-name here: jsdom reports no visible text. Check it from the text.
  for (const mismatch of labelInNameMismatches(node)) {
    violations.push(
      `label-content-name-mismatch (serious): visible text "${mismatch.visible}" is not in the accessible name "${mismatch.name}"`,
    );
  }
  expect(violations).toEqual([]);
}

const users = [{ id: "u1", name: "Alice", role: "user" as const }];

describe("component accessibility (axe)", () => {
  it("VoteButton has no violations", async () => {
    const { container } = render(<VoteButton bugId="b1" voteCount={3} />);
    await expectNoA11yViolations(container);
  });

  it("EntryReplyForm has no violations", async () => {
    const { container } = render(<EntryReplyForm bugId="b1" target={{ bidId: "bid1" }} label="Reply to this bid" />);
    await expectNoA11yViolations(container);
  });

  it("CreateBugForm has no violations", async () => {
    const { container } = render(
      <CreateBugForm projectSlug={projectRef("zedu", "acme")}
        users={users}
        types={[{ id: "t1", name: "Bug" }]}
        isAdmin
      />,
    );
    await expectNoA11yViolations(container);
  });

  it("CreateBugForm quick report in the modal has no violations (#report-modal)", async () => {
    const { container } = render(
      <CreateBugForm projectSlug={projectRef("zedu", "acme")}
        users={users}
        types={[{ id: "t1", name: "Bug" }]}
        isAdmin={false}
        currentUserId="u1"
        variant="modal"
        reportedFrom="/acme/issues/open"
      />,
    );
    await expectNoA11yViolations(container);
  });

  it("UserSearch has no violations", async () => {
    const { container } = render(<UserSearch />);
    await expectNoA11yViolations(container);
  });

  it("keeps the signing-secret dialog modal and restores focus when it closes", async () => {
    const originalShowModal = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "showModal",
    );
    const originalClose = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "close",
    );
    let previousFocus: HTMLElement | null = null;
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        previousFocus = document.activeElement as HTMLElement | null;
        this.setAttribute("open", "");
        this.querySelector<HTMLElement>("button")?.focus();
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
        previousFocus?.focus();
      },
    });

    try {
      vi.mocked(listWebhooksAction).mockResolvedValue({
        ok: true,
        subscriptions: [],
        agents: [{ id: "agent-1", name: "Test agent", avatar: null }],
      });
      vi.mocked(createWebhookAction).mockResolvedValue({
        ok: true,
        secret: "secret-for-test",
        subscription: {
          id: "webhook-1",
          url: "https://example.test/hooks/ziki",
          enabled: true,
          failureCount: 0,
          disabledAt: null,
          createdAt: new Date(),
          lastError: null,
          lastErrorAt: null,
          lastDeliveredAt: null,
          agent: { id: "agent-1", name: "Test agent", avatar: null },
        },
      });

      const user = userEvent.setup();
      render(<WebhookManagement />);
      await user.click(await screen.findByRole("radio", { name: "Test agent" }));
      await user.type(
        screen.getByRole("textbox", { name: "HTTPS endpoint URL" }),
        "https://example.test/hooks/ziki",
      );
      await user.click(screen.getByRole("button", { name: "Add webhook" }));

      const dialog = await screen.findByRole("dialog", {
        name: "Copy your signing secret now",
      });
      expect(dialog).toHaveAttribute("open");
      expect(dialog.contains(document.activeElement)).toBe(true);

      fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "HTTPS endpoint URL" }),
      );
    } finally {
      if (originalShowModal) {
        Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
      } else {
        delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
      }
      if (originalClose) {
        Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
      } else {
        delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
      }
    }
  });

  describe("Customer Support Guide", () => {
    it("resolves route context guidance for homepage, issues, ideas, and tickets", () => {
      const home = getPageGuidance("/");
      expect(home.contextKey).toBe("home");
      expect(home.pageName).toContain("Homepage");

      const issues = getPageGuidance("/acme/issues");
      expect(issues.contextKey).toBe("issues");
      expect(issues.pageName).toContain("Issues");

      const ideas = getPageGuidance("/acme/ideas");
      expect(ideas.contextKey).toBe("ideas");
      expect(ideas.pageName).toContain("Ideas");

      const ticket = getPageGuidance("/acme/123");
      expect(ticket.contextKey).toBe("issue-detail");
    });

    it("answers user questions about agents, issues, your call, and feeling lost", () => {
      expect(searchSupportAnswers("I feel lost where do I start?").text).toContain("Ziki is designed for humans");
      expect(searchSupportAnswers("What are agents doing?").text).toContain("Autonomous agents in Ziki");
      expect(searchSupportAnswers("What does Your Call mean?").text).toContain("Your Call");
      expect(searchSupportAnswers("How do points and rewards work?").text).toContain("Rewards in Ziki");
    });

    it("returns direct page navigation shortcuts for page queries", () => {
      const issuesNav = searchSupportAnswers("take me to issues", projectRef("demo", "demo"));
      expect(issuesNav.actions).toBeDefined();
      expect(issuesNav.actions?.[0].href).toBe("/demo/demo/issues/all");

      const ideasNav = searchSupportAnswers("take me to ideas", projectRef("demo", "demo"));
      expect(ideasNav.actions).toBeDefined();
      expect(ideasNav.actions?.[0].href).toBe("/demo/demo/ideas");
    });

    it("renders the support guide with accessible ARIA label and toggle button", async () => {
      render(<OnScreenGuide />);
      const guide = screen.getByRole("complementary", { name: "Customer Support Guide" });
      expect(guide).toBeInTheDocument();

      const toggleBtn = screen.getByRole("button", { name: "Toggle Ziki Customer Support Guide" });
      expect(toggleBtn).toBeInTheDocument();

      fireEvent.click(toggleBtn);
      expect(screen.getAllByText(/Ziki Support Guide/i).length).toBeGreaterThanOrEqual(1);
    });
  });

});
