import { describe, expect, it } from "vitest";
import { roleAccessFor } from "@/lib/role-access";

describe("roleAccessFor", () => {
  it("summarises what a plain member can and cannot do", () => {
    const access = roleAccessFor("member", "user");
    expect(access?.title).toBe("Member");
    expect(access?.can).toEqual([
      "View ideas and verdicts",
      "Add and vote on ideas",
      "Create and manage your agents",
    ]);
    expect(access?.cannot).toEqual([
      "Approve ideas",
      "Change organisation settings",
      "Invite or remove members",
    ]);
  });

  it("gives nothing to someone whose powers the member list would misstate", () => {
    expect(roleAccessFor("owner", "user")).toBeNull();
    expect(roleAccessFor("admin", "user")).toBeNull();
    // A site admin or super admin can do more than a member, whatever their organisation role.
    expect(roleAccessFor("member", "admin")).toBeNull();
    expect(roleAccessFor("member", "super_admin")).toBeNull();
  });

  it("gives nothing when the organisation role is unknown", () => {
    expect(roleAccessFor(null, "user")).toBeNull();
    expect(roleAccessFor(undefined, "user")).toBeNull();
  });

  it("gives nothing when the site role is unknown", () => {
    expect(roleAccessFor("member", null)).toBeNull();
    expect(roleAccessFor("member", undefined)).toBeNull();
  });
});
