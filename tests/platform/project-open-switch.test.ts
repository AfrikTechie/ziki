import { beforeEach, describe, expect, it, vi } from "vitest";

const setActiveOrganisationCookie = vi.hoisted(() => vi.fn());
const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(async () => ({ role: "user" })) },
  project: { findFirst: vi.fn(async () => ({ id: "p-1", slug: "ziki-marketing", visibility: "public", organisation: { slug: "ziki" } })) },
  membership: { findUnique: vi.fn(async () => ({ id: "m-1" })) },
  projectMembership: { findUnique: vi.fn(async () => null) },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: vi.fn(async () => ({ userId: "u-1" })) }));
vi.mock("@/lib/organisations", () => ({ setActiveOrganisationCookie }));
vi.mock("@/lib/base-path", () => ({ BASE_PATH: "" }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { GET } from "@/app/(app)/projects/[slug]/open/route";
import { withoutFlightMarker } from "@/lib/project-paths";

const url = "https://ziki.dev/projects/ziki-marketing/open?organisation=org-ziki&next=%2Fziki%2Fziki-marketing";
const params = { params: Promise.resolve({ slug: "ziki-marketing" }) };

/** Opening a project in another organisation (#project-urls) from inside the app. */
describe("switching organisation to open a project", () => {
  beforeEach(() => setActiveOrganisationCookie.mockClear());

  it("switches organisation and goes on to the page on a full page load", async () => {
    const res = await GET(new Request(url), params);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/ziki/ziki-marketing");
    expect(setActiveOrganisationCookie).toHaveBeenCalledWith("org-ziki");
  });

  it("never switches on an in-app navigation or prefetch, and asks for a full page load instead", async () => {
    for (const extra of [{}, { "next-router-prefetch": "1" }] as Record<string, string>[]) {
      const res = await GET(new Request(url, { headers: { rsc: "1", ...extra } }), params);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    }
    expect(setActiveOrganisationCookie).not.toHaveBeenCalled();
  });

  it("drops Next's _rsc marker from the address to come back to", () => {
    expect(withoutFlightMarker("/ziki/ziki-marketing?_rsc=abc")).toBe("/ziki/ziki-marketing");
    expect(withoutFlightMarker("/ziki/web/ideas?_rsc=abc&sort=new")).toBe("/ziki/web/ideas?sort=new");
    expect(withoutFlightMarker("/ziki/web/ideas?sort=new")).toBe("/ziki/web/ideas?sort=new");
    expect(withoutFlightMarker("/ziki/web")).toBe("/ziki/web");
  });
});
