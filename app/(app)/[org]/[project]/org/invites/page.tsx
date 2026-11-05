import type { Metadata } from "next";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CopyLinkButton } from "@/components/copy-link-button";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { INVITE_TTL_DAYS, canInvite, pendingInvites } from "@/lib/invites";
import { prisma } from "@/lib/prisma";
import { joinedSummary, listShareLinks, shareLinkStatusLabel } from "@/lib/share-invites";
import { MEMBERSHIP_ROLE_LABELS, tenantMembersFrom } from "@/lib/tenants";
import { revokeInviteAction, revokeShareLinkAction } from "@/app/(app)/tenants/actions";
import { loadOrg } from "../org-context";
import { OrgPageHeader, ReadOnlyNote, orgCard, orgListCard, orgListHeading } from "../org-ui";
import { InviteForm } from "./invite-form";
import { ShareLinkForm } from "./share-link-form";

export const metadata: Metadata = { title: "Invites" };

async function loadQuietly<T>(label: string, task: Promise<T>, empty: T): Promise<T> {
  try {
    return await task;
  } catch (error) {
    console.error(`[org] ${label} failed`, error);
    return empty;
  }
}

/**
 * The owners and admins a member can ask for an invite. Users are loaded
 * apart from memberships, as tenantMembersFrom explains.
 */
async function loadManagers(tenantId: string) {
  return loadQuietly(
    "managers",
    (async () => {
      const rows = await prisma.membership.findMany({
        where: { tenantId, role: { in: ["owner", "admin"] } },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        take: 20,
        select: { role: true, createdAt: true, userId: true },
      });
      if (rows.length === 0) return [];
      const people = await prisma.user.findMany({
        where: { id: { in: rows.map((row) => row.userId) } },
        select: { id: true, name: true, email: true },
      });
      return tenantMembersFrom(rows, people);
    })(),
    [],
  );
}

/**
 * The only two ways into an organization: an email invite for one person, or
 * a share link for several. Owners and admins send and revoke them here.
 */
export default async function OrgInvitesPage() {
  const { user, org } = await loadOrg();
  if (!org) return null;

  // Invites are checked against the membership itself, as lib/invites.ts does.
  const membership = await loadQuietly(
    "membership",
    prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: org.id, userId: user.id } },
      select: { role: true },
    }),
    null,
  );
  const canManage = canInvite(membership?.role);

  if (!canManage) {
    const managers = await loadManagers(org.id);
    return (
      <div className="space-y-4">
        <OrgPageHeader title="Invites">
          People join {org.name} only by an invite: an email invite for one person, or an invite
          link for several.
        </OrgPageHeader>
        <ReadOnlyNote>Only owners and admins can invite people. Ask one of them to invite your teammate.</ReadOnlyNote>
        <section aria-labelledby="org-managers" className={orgCard}>
          <h3 id="org-managers" className="text-base font-semibold text-zk-text">
            Owners and admins
          </h3>
          {managers.length === 0 ? (
            <p className="mt-1 text-sm text-zk-text2">Nobody here can invite people yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {managers.map((manager) => (
                <li key={manager.user.id} className="flex items-center gap-2 text-sm text-zk-text">
                  <span className="truncate">{manager.user.name ?? manager.user.email}</span>
                  <Badge className="rounded-full bg-zk-chip text-zk-text2">{MEMBERSHIP_ROLE_LABELS[manager.role]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const [invites, shareLinks] = await Promise.all([
    loadQuietly("invites", pendingInvites(prisma, org.id), []),
    loadQuietly("share links", listShareLinks(prisma, org.id), []),
  ]);

  return (
    <div className="space-y-6">
      <OrgPageHeader title="Invites">
        People join {org.name} only by an invite. Send an email invite to one person, or share an
        invite link with several. Revoking either stops it working at once.
      </OrgPageHeader>

      <section aria-labelledby="invite-someone" className={orgCard}>
        <h3 id="invite-someone" className="text-base font-semibold text-zk-text">
          Invite by email
        </h3>
        <p className="mt-1 text-sm text-zk-text2">
          For one person. The link works once, only for the address you enter, and expires after{" "}
          {INVITE_TTL_DAYS} days.
        </p>
        <InviteForm tenantId={org.id} />
      </section>

      <section aria-labelledby="pending-invites" className={orgListCard}>
        <h3 id="pending-invites" className={orgListHeading}>
          Pending email invites
        </h3>
        {invites.length === 0 ? (
          <p className="px-4 py-4 text-sm text-zk-text2 sm:px-6">
            No invites waiting to be accepted. Invites you send appear here until they&apos;re used,
            revoked or expire.
          </p>
        ) : (
          <ul className="divide-y divide-zk-border">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zk-text">{invite.email}</p>
                  <p className="mt-0.5 text-xs text-zk-muted">
                    Invited by {invite.invitedByName} · expires <LocalTime date={invite.expiresAt} />
                  </p>
                </div>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <ConfirmSubmitButton
                    aria-label={`Revoke the invite for ${invite.email}`}
                    confirm={{
                      title: `Revoke the invite for ${invite.email}?`,
                      body: "Their link stops working at once. You can send a new invite later.",
                      confirmLabel: "Revoke invite",
                    }}
                  >
                    Revoke
                  </ConfirmSubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="share-link" className={orgCard}>
        <h3 id="share-link" className="text-base font-semibold text-zk-text">
          Invite link
        </h3>
        <p className="mt-1 text-sm text-zk-text2">
          Share one link instead of typing each email. Anyone who opens it and signs in with Google
          joins as a member — a new Google account is created if they don&apos;t have one, and this
          organization is added to it. Pick how long the link lasts and how many people can use it.
          Once that limit is reached, or you revoke the link, it stops working.
        </p>
        <ShareLinkForm tenantId={org.id} />
        <ul className="mt-4 divide-y divide-zk-border border-t border-zk-border">
          {shareLinks.length === 0 ? (
            <li className="pt-4 text-sm text-zk-text2">No invite links yet. Create one above to share it.</li>
          ) : (
            shareLinks.map((link) => {
              const who = joinedSummary(link.joinedNames, link.useCount);
              const statusClass =
                link.state === "open"
                  ? "bg-zk-tint text-zk-accent ring-1 ring-zk-border"
                  : link.state === "revoked"
                    ? "bg-zk-bad-bg text-zk-bad-fg"
                    : "bg-zk-chip text-zk-text2";
              const name = link.label || "Invite link";
              return (
                <li key={link.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zk-text">
                      <span className="truncate">{name}</span>
                      <Badge className={statusClass}>{shareLinkStatusLabel(link.state)}</Badge>
                    </p>
                    <p className="text-xs text-zk-muted">
                      {link.useCount} joined{link.maxUses != null ? ` of ${link.maxUses}` : ""}
                      {who ? ` · ${who}` : ""}
                      {" · "}
                      {link.state === "expired" ? "expired" : "expires"} <LocalTime date={link.expiresAt} />
                      {" · "}
                      {link.invitedByName}
                    </p>
                    {link.url ? (
                      <p className="truncate font-mono text-xs text-zk-text2">{link.url}</p>
                    ) : (
                      <p className="text-xs text-zk-muted">This link can&apos;t be shown. Revoke it and create another.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {link.url ? <CopyLinkButton url={link.url} label="invite" /> : null}
                    {link.state === "open" ? (
                      <form action={revokeShareLinkAction}>
                        <input type="hidden" name="linkId" value={link.id} />
                        <ConfirmSubmitButton
                          aria-label={`Revoke invite link${link.label ? ` ${link.label}` : ""}`}
                          confirm={{
                            title: `Revoke ${name}?`,
                            body: "Nobody else can join with it. People who already joined stay members.",
                            confirmLabel: "Revoke link",
                          }}
                        >
                          Revoke
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </div>
  );
}
