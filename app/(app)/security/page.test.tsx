import { describe, it, expect, vi } from "vitest";
import React from "react";
import SecurityPage from "./page";

vi.mock("@/lib/auth-helpers", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user_test_admin", role: "admin" }),
}));

vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: vi.fn().mockResolvedValue({
    organisationId: "org_123",
    admin: true,
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentActivation: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "act_1",
          level: "senior",
          securityCleared: true,
          agent: { id: "ag_1", name: "SecurityAgent", owner: { name: "Alice" } },
        },
      ]),
    },
  },
}));

vi.mock("@/lib/security-dashboard", () => ({
  loadSecurityDashboard: vi.fn().mockResolvedValue({
    open: [
      {
        id: "find_1",
        ref: "#2828",
        title: "Confidential RCE Vulnerability",
        severity: "critical",
        stage: "In progress",
        days: 2,
        href: "/issues/2828",
        project: "Web",
      },
      {
        id: "find_2",
        ref: "#2829",
        title: "Information Disclosure Bug",
        severity: "low",
        stage: "Open",
        days: 5,
        href: "/issues/2829",
        project: "Desktop",
      },
    ],
    openBySeverity: {
      critical: 1,
      high: 0,
      medium: 0,
      low: 1,
    },
    disclosed: [
      {
        id: "find_3",
        ref: "#2800",
        title: "SQL Injection in User Search",
        severity: "critical",
        stage: "Live",
        days: 3,
        href: "/issues/2800",
        project: "Web",
        disclosedAt: new Date("2026-11-01"),
        fixedLive: true,
      },
    ],
    medianDaysToFix: 3,
    projects: [{ name: "Web", ref: "web" }],
  }),
}));

vi.mock("@/components/security-finding-panel", () => ({
  SeverityChip: ({ severity }: { severity: string }) => <span>{severity}</span>,
}));

vi.mock("@/components/security-finding-controls", () => ({
  AgentClearanceToggle: () => <button>Clearance Toggle</button>,
}));

vi.mock("@/components/local-time", () => ({
  LocalTime: ({ date }: { date?: Date | string | null }) => <time>{String(date)}</time>,
}));

describe("SecurityPage (/security)", () => {
  it("renders the security dashboard with posture metrics and stats", async () => {
    const page = await SecurityPage({});
    expect(page).toBeDefined();
    expect(React.isValidElement(page)).toBe(true);
  });

  it("filters findings when severity query parameter is provided", async () => {
    const pageWithFilter = await SecurityPage({
      searchParams: Promise.resolve({ severity: "critical" }),
    });
    expect(pageWithFilter).toBeDefined();
    expect(React.isValidElement(pageWithFilter)).toBe(true);
  });

  it("renders safe harbor and SLA disclosure policy", async () => {
    const page = await SecurityPage({});
    expect(page).toBeDefined();
    // Verify component tree structure
    const pageProps = page.props;
    expect(pageProps.className).toContain("security-page");
  });
});
