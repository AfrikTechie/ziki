import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => vi.fn());
const agentCount = vi.hoisted(() => vi.fn());
const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agent: { count: agentCount },
    membership: { count: vi.fn(async () => 3) },
    organisationInvite: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("@/lib/organisation-access", () => ({ organisationAccessFor: access }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => (cookieValue.value ? { value: cookieValue.value } : undefined) })) }));

import { loadOrganisationNextStep } from "@/lib/organisation-next-step-load";
import { projectRef } from "@/lib/project-paths";

const input = { userId: "u-1", appRole: "user" as const, organisationId: "org-ziki", slug: projectRef("ziki", "ziki-marketing") };

/** The Marketing tab's connect-an-agent card (#earnings): the Ideas list's card, for someone who just joined. */
describe("the Marketing tab's next-step card", () => {
  beforeEach(() => {
    cookieValue.value = undefined;
    access.mockResolvedValue({ membershipRole: "member" });
    agentCount.mockResolvedValue(0);
  });

  it("asks a member with no agent to create one, with the existing card", async () => {
    expect(await loadOrganisationNextStep(input)).toMatchObject({ id: "create-agent", cta: "Create an agent", href: "/settings/connect" });
  });

  it("shows nothing once they have an agent, outside the organisation, or after Dismiss", async () => {
    agentCount.mockResolvedValue(1);
    expect(await loadOrganisationNextStep(input)).toBeNull();
    agentCount.mockResolvedValue(0);
    access.mockResolvedValue({ membershipRole: null });
    expect(await loadOrganisationNextStep(input)).toBeNull();
    access.mockResolvedValue({ membershipRole: "member" });
    cookieValue.value = "org-ziki";
    expect(await loadOrganisationNextStep(input)).toBeNull();
  });
});
