import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Organisation membership (#425): reports are filed into the reporter's organisation,
 * someone with no membership can't file at all, an area from another project
 * is refused, and an issue in another organisation is "not found".
 */

vi.mock("@/lib/organisation-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisation-context")>()),
  currentOrganisationIdFor: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/organisations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisations")>()),
  setActiveOrganisationCookie: vi.fn(),
}));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));
// Tidying an idea with Claude is a network call: as with no API key, it leaves the text as typed.
vi.mock("@/lib/idea-structuring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/idea-structuring")>()),
  structureIdea: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: vi.fn(async () => ({
    organisationId: "organisation-zedu",
    organisationName: "Zedu",
    organisationSlug: "zedu",
    membershipRole: "member",
    admin: false,
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bug: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    idea: { create: vi.fn() },
    // #project-urls: the form names its project; only one in the reporter's organisation is used.
    project: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organisationId: string } }) =>
        where.id === "project-zedu" && where.organisationId === "organisation-zedu" ? { id: "project-zedu", slug: "zedu" } : null),
    },
    projectArea: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { setActiveOrganisationCookie } from "@/lib/organisations";
import { resetRateLimits } from "@/lib/rate-limit";
import { issueSwitchDestination } from "@/lib/issue-switch-destination";
import { resolveIssueWorkspaceSwitch } from "@/lib/issue-workspace-switch";
import { issueOrganisationHintFor } from "@/lib/issue-organisation-hint";
import { switchIssueWorkspaceAction } from "@/app/(app)/organisations/issue-switch-action";

const db = prisma as unknown as {
  bug: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  idea: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  projectArea: { findFirst: ReturnType<typeof vi.fn> };
  $executeRaw: ReturnType<typeof vi.fn>;
};

const sharedIssuePath = "/ziki/app/482";
const switchForm = () => form({
  issueId: "issue",
  organisationId: "b",
  returnTo: `${sharedIssuePath}?comment=c42#comment-c42`,
});

describe("switching to a shared issue's workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RATE_LIMIT_STORE", "memory");
    resetRateLimits();
    vi.mocked(auth).mockResolvedValue({ user: { id: "u" } } as never);
    vi.mocked(requireUser).mockResolvedValue({ id: "u" } as never);
    vi.mocked(setActiveOrganisationCookie).mockReset();
    db.bug.findFirst.mockReset().mockResolvedValue({
      organisationId: "b", number: 482, project: { slug: "app", organisation: { slug: "ziki" } },
    });
    vi.mocked(redirect).mockImplementation((url) => { throw new Error(`redirect:${url}`); });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("verifies access before changing workspace and opens the exact issue, query and anchor", async () => {
    await expect(switchIssueWorkspaceAction({}, switchForm())).rejects.toThrow(`redirect:${sharedIssuePath}?comment=c42#comment-c42`);
    expect(db.bug.findFirst.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(setActiveOrganisationCookie).mock.invocationCallOrder[0]);
    expect(setActiveOrganisationCookie).toHaveBeenCalledWith("b");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("retains the original issue through expired-session login without changing workspace", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(switchIssueWorkspaceAction({}, switchForm())).rejects.toThrow("redirect:/login?callbackUrl=%2Fziki%2Fapp%2F482%3Fcomment%3Dc42%23comment-c42");
    expect(setActiveOrganisationCookie).not.toHaveBeenCalled();
    expect(db.bug.findFirst).not.toHaveBeenCalled();
  });

  it("leaves the workspace unchanged when the issue or access is no longer available", async () => {
    db.bug.findFirst.mockResolvedValue(null);
    expect(await switchIssueWorkspaceAction({}, switchForm())).toHaveProperty("error");
    expect(setActiveOrganisationCookie).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns a retryable error without redirecting when cookie storage fails", async () => {
    vi.mocked(setActiveOrganisationCookie).mockRejectedValue(new Error("storage unavailable"));
    expect(await switchIssueWorkspaceAction({}, switchForm())).toEqual({ error: "We couldn't switch workspaces. Please try again." });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("rate limits repeated attempts before another access lookup or cookie change", async () => {
    db.bug.findFirst.mockResolvedValue(null);
    for (let attempt = 0; attempt < 20; attempt += 1) await switchIssueWorkspaceAction({}, switchForm());
    db.bug.findFirst.mockClear();
    expect(await switchIssueWorkspaceAction({}, switchForm())).toMatchObject({ error: expect.stringContaining("Too many attempts") });
    expect(db.bug.findFirst).not.toHaveBeenCalled();
    expect(setActiveOrganisationCookie).not.toHaveBeenCalled();
  });

  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/login", "/projects/app/open?next=/ziki/app/482", "/zedu/app/482", "/ziki/app/483", "/ziki/app/482\n", null])("rejects an unsafe or different destination: %s", (value) => {
    expect(issueSwitchDestination(sharedIssuePath, value)).toBe(sharedIssuePath);
  });

  it("retains the original issue query and comment anchor", () => {
    const destination = `${sharedIssuePath}?comment=c42&view=all#comment-c42`;
    expect(issueSwitchDestination(sharedIssuePath, destination)).toBe(destination);
  });

  it.each([{ issueId: "", organisationId: "b" }, { issueId: "issue", organisationId: "" }, { issueId: "x".repeat(192), organisationId: "b" }])("rejects malformed identifiers before querying: %j", async (input) => {
    expect(await resolveIssueWorkspaceSwitch(prisma, "u", input)).toBeNull();
    expect(db.bug.findFirst).not.toHaveBeenCalled();
  });

  it("reveals preview data only after an active membership check", async () => {
    const membership = vi.fn().mockResolvedValue(null);
    const hints = {
      bug: { findUnique: vi.fn().mockResolvedValue({ organisationId: "b", number: 482, title: "Private", substatus: "open", project: { name: "App" } }) },
      membership: { findFirst: membership },
    } as unknown as Parameters<typeof issueOrganisationHintFor>[0];
    expect(await issueOrganisationHintFor(hints, { userId: "u", activeOrganisationId: "a", issueId: "issue" })).toBeNull();
    membership.mockResolvedValue({ organisation: { id: "b", name: "Ziki", slug: "ziki" } });
    expect(await issueOrganisationHintFor(hints, { userId: "u", activeOrganisationId: "a", issueId: "issue" })).toMatchObject({ name: "Ziki", issue: { number: 482, title: "Private", projectName: "App" } });
  });
});

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
