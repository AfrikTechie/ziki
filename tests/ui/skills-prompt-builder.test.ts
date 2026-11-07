import { describe, expect, it } from "vitest";
import { buildSmartSkillPrompt, type AgentInfo } from "@/app/(app)/skills/skills-prompt-builder";
import type { SkillItem } from "@/app/(app)/skills/skills-data";

const sampleSkill: SkillItem = {
  id: "skill-playwright-1",
  slug: "playwright-e2e-browser-inspector",
  title: "Playwright E2E Browser Inspector with Full Autonomous DOM Exploration",
  icon: "browser",
  category: "testing",
  categoryLabel: "Testing & QA",
  badge: "Automated QA",
  badgeColor: "blue",
  description: "Automated Playwright runner for dynamic page verification.",
  tags: ["playwright", "e2e", "browser", "qa"],
  prompt: "You are an automated Playwright testing agent. Always verify page DOM assertions.",
  spec: {
    overview: "Runs Playwright tests headlessly against the staging URL.",
    checklist: ["Verify playwright is installed", "Run headless tests", "Collect trace"],
    sampleCommand: "npx playwright test",
    documentationUrl: "https://playwright.dev",
  },
  author: {
    name: "QA Team",
    handle: "@qateam",
  },
  createdAt: "2026-11-07T00:00:00.000Z",
};

const agents: AgentInfo[] = [
  { id: "agent-1", name: "Skill Test", username: "skill-test" },
  { id: "agent-2", name: "Backend Worker", username: "backend-bot" },
  { id: "agent-3", name: "Unpaired Agent" },
];

describe("buildSmartSkillPrompt", () => {
  it("generates a smart prompt for a specific agent with @username", () => {
    const prompt = buildSmartSkillPrompt(sampleSkill, "Skill Test", agents);

    expect(prompt).toContain("# Target Agent: Skill Test (@skill-test)");
    expect(prompt).toContain("# Skill: Playwright E2E Browser Inspector with Full Autonomous DOM Exploration");
    expect(prompt).toContain("## Step 1: Idempotency & Version Verification");
    expect(prompt).toContain("GET https://ziki.dev/api/v1/agents/me/skills");
    expect(prompt).toContain("## Step 2: Prerequisites & Local Setup");
    expect(prompt).toContain("$ npx playwright test");
    expect(prompt).toContain("You are an automated Playwright testing agent.");
    expect(prompt).toContain("## Step 3: Platform Sync (Ziki Agent Profile)");
    expect(prompt).toContain("curl -s -X PUT");
    expect(prompt).toContain("/api/v1/agents/me/skills/");
    expect(prompt).toContain("## Step 4: Final Confirmation");
    expect(prompt).toContain("https://ziki.dev/agent/skill-test/edit/skills");
  });

  it("handles agents without a username gracefully", () => {
    const prompt = buildSmartSkillPrompt(sampleSkill, "Unpaired Agent", agents);

    expect(prompt).toContain("# Target Agent: Unpaired Agent");
    expect(prompt).not.toContain("(@");
    expect(prompt).toContain("https://ziki.dev/agents/mine");
  });

  it("generates a multi-agent roster prompt when 'all' is selected", () => {
    const prompt = buildSmartSkillPrompt(sampleSkill, "all", agents);

    expect(prompt).toContain("# Target Agents: @skill-test, @backend-bot, Unpaired Agent");
    expect(prompt).toContain("## Step 1: Idempotency & Version Verification");
    expect(prompt).toContain("## Step 3: Platform Sync (Ziki Agent Profile)");
    expect(prompt).toContain("For each active agent in your organisation");
    expect(prompt).toContain("## Step 4: Final Confirmation");
    expect(prompt).toContain("Successfully applied");
  });

  it("defaults to all workspace agents when agent list is empty or targetAgent is undefined", () => {
    const prompt = buildSmartSkillPrompt(sampleSkill, undefined, []);

    expect(prompt).toContain("# Target Agents: All workspace agents");
    expect(prompt).toContain("## Step 3: Platform Sync (Ziki Agent Profile)");
  });

  it("enforces the 40-character max limit on the registered tag", () => {
    const prompt = buildSmartSkillPrompt(sampleSkill, "Skill Test", agents);

    // Extract tag from "# Registered Tag: <tag>"
    const match = prompt.match(/# Registered Tag: ([^\r\n]+)/);
    expect(match).not.toBeNull();
    const tag = match![1].trim();

    expect(tag.length).toBeLessThanOrEqual(40);
    expect(tag.startsWith("Ziki-Verified-")).toBe(true);
    expect(tag.endsWith("-")).toBe(false);
  });
});
