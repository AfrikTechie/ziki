import type { Metadata } from "next";
import { settableLevels } from "@/lib/agents/levels";
import { prisma } from "@/lib/prisma";
import { MEMBERSHIP_ROLE_LABELS, tenantMembersFrom } from "@/lib/tenants";
import { loadOrg } from "../org-context";
import { OrgPageHeader, ReadOnlyNote } from "../org-ui";
import { MemberList, type OrgMember } from "./member-list";

export const metadata: Metadata = { title: "Members" };

const MEMBER_LIMIT = 1000;

/**
 * Memberships and users are loaded apart so a membership whose user row is
 * gone is skipped rather than failing the page (see tenantMembersFrom).
 */
async function loadMembers(tenantId: string): Promise<OrgMember[]> {
  try {
    const rows = await prisma.membership.findMany({
      where: { tenantId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      take: MEMBER_LIMIT,
      select: { role: true, createdAt: true, userId: true },
    });
    if (rows.length === 0) return [];
    const userIds = rows.map((row) => row.userId);
    const [people, agents] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, image: true, role: true },
      }),
      prisma.agent.findMany({
        where: { tenantId, ownerUserId: { in: userIds }, revokedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, level: true, ownerUserId: true },
      }),
    ]);
    const agentsByOwner = new Map<string, OrgMember["agents"]>();
    for (const agent of agents) {
      const list = agentsByOwner.get(agent.ownerUserId) ?? [];
      list.push({ id: agent.id, name: agent.name, level: agent.level });
      agentsByOwner.set(agent.ownerUserId, list);
    }
    return tenantMembersFrom(rows, people).map((member) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      role: member.role,
      roleLabel: MEMBERSHIP_ROLE_LABELS[member.role],
      siteSuperAdmin: member.user.role === "super_admin",
      joinedAt: member.createdAt.toISOString(),
      agents: agentsByOwner.get(member.user.id) ?? [],
    }));
  } catch (error) {
    console.error("[org] member list failed", error);
    return [];
  }
}

/** Who is in the organization, their roles and agents, and leaving it. */
export default async function OrgMembersPage() {
  const { user, org } = await loadOrg();
  if (!org) return null;

  const members = await loadMembers(org.id);
  const ownerCount = members.filter((member) => member.role === "owner").length;

  return (
    <div className="space-y-4">
      <OrgPageHeader title="Members">
        Everyone in {org.name}. Roles apply only here: someone who is an admin elsewhere is a
        member here until an owner promotes them. Owners change roles; owners and admins can
        remove people. Agents have their own class, which owners and admins set per agent.
      </OrgPageHeader>
      {org.admin ? null : (
        <ReadOnlyNote>
          You can see who is here and leave the organization. Only owners and admins can change
          roles or remove people.
        </ReadOnlyNote>
      )}
      <MemberList
        tenantId={org.id}
        tenantName={org.name}
        viewerId={user.id}
        members={members}
        ownerCount={ownerCount}
        canChangeRoles={org.owner}
        canRemove={org.admin}
        agentLevels={org.admin ? settableLevels({ isOwner: false, isTenantAdmin: true }) : []}
      />
    </div>
  );
}
