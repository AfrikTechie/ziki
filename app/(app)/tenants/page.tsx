import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth-helpers";
import { firstProjectRefFor } from "@/lib/project-route";
import { orgPath } from "@/lib/project-paths";
import { openInvitesFor, viewInvite } from "@/lib/invites";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/roles";
import { currentTenantIdFor } from "@/lib/tenant-context";
import {
  MEMBERSHIP_ROLE_LABELS,
  TENANT_NAME_MAX,
  tenantsForUser,
  zeduNeedsOwner,
} from "@/lib/tenants";
import { selectTenantAction, setTenantArchivedAction } from "./actions";
import { CreateTenantForm } from "./create-tenant-form";
import { AcceptInviteForm } from "./accept-invite-form";
import { InviteCard } from "./invite-card";
import { InviteLinkForm } from "./invite-link-form";
import { ZeduOwnerForm } from "./zedu-owner-form";
import { LocalTime } from "@/components/local-time";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Workspaces" };

const card = "rounded-[20px] border border-zk-border bg-zk-surface p-4 sm:p-6";

/**
 * A person's own memberships (#444): pick the tenant to work in, accept an
 * invite or open an invite link, create a tenant, or restore an archived
 * one. Nothing here administers a tenant; that is /org, for the current one.
 */
export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{
    invite?: string | string[];
    error?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const projectSlug = await firstProjectRefFor(user.id);
  // In-app invite notifications (#443) link here with the invite's id.
  const {
    invite: inviteParam,
    error: errorParam,
    notice: noticeParam,
  } = await searchParams;
  const inviteId = typeof inviteParam === "string" ? inviteParam : "";
  const error = typeof errorParam === "string" ? errorParam : "";
  const notice = typeof noticeParam === "string" ? noticeParam : "";

  const [tenants, currentTenantId, invite, zeduOwnerNeeded, openInvites] = await Promise.all([
    tenantsForUser(prisma, user.id, user.role),
    currentTenantIdFor(user.id),
    inviteId ? viewInvite(prisma, { inviteId }, user) : null,
    isSuperAdmin(user.role) ? zeduNeedsOwner(prisma) : false,
    openInvitesFor(prisma, user),
  ]);
  const listedInvites = openInvites.filter((row) => row.id !== inviteId);
  const activeTenants = tenants.filter((tenant) => !tenant.archivedAt);
  const archivedTenants = tenants.filter(
    (tenant) => tenant.archivedAt && (tenant.role === "owner" || isSuperAdmin(user.role)),
  );
  const hasTenants = activeTenants.length > 0;
  // #537: names shared by two of your tenants, so their buttons say which is which.
  const nameCounts = new Map<string, number>();
  for (const tenant of activeTenants) {
    const key = tenant.name.toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const sharesName = (name: string) => (nameCounts.get(name.toLocaleLowerCase()) ?? 0) > 1;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">
          {hasTenants ? "Choose a workspace" : "Join or create a workspace"}
        </h1>
        <p className="text-sm text-zk-text2">
          {hasTenants
            ? "A workspace is your team. A project is one product inside it."
            : "You're not in a workspace yet. Accept an invite, or create a workspace of your own."}
        </p>
      </div>

      {error ? (
        <p className="rounded-[14px] border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-[14px] border border-zk-border bg-zk-ok-bg px-3 py-2 text-sm text-zk-ok-fg">
          {notice}
        </p>
      ) : null}

      {inviteId ? (
        <InviteCard invite={invite} accept={{ inviteId }} accountEmail={user.email} />
      ) : null}

      {listedInvites.length > 0 ? (
        <section aria-labelledby="your-invites" className="overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
          <h2
            id="your-invites"
            className="border-b border-zk-border bg-zk-tint px-4 py-3 text-base font-semibold text-zk-text sm:px-6"
          >
            Invitations
          </h2>
          <ul className="divide-y divide-zk-border">
            {listedInvites.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zk-text">{row.tenant.name}</p>
                  <p className="mt-0.5 text-xs text-zk-muted">
                    {row.invitedByName} invited you · expires <LocalTime date={row.expiresAt} />
                  </p>
                </div>
                <AcceptInviteForm inviteId={row.id} tenantName={row.tenant.name} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!hasTenants && !inviteId ? (
        <>
          {/* #641: a newcomer's first step is their own workspace, explained. */}
          <section aria-labelledby="how-ziki-works" className="rounded-xl border border-zk-border bg-zk-tint p-4 sm:p-6">
            <h2 id="how-ziki-works" className="text-base font-semibold text-zk-text">
              How Ziki is organised
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-zk-text2">
              <li>
                <span className="font-medium">A workspace</span> is your team or company. Its people, projects,
                and issues stay inside it.
              </li>
              <li>
                <span className="font-medium">A project</span> is one product in that workspace, such as a web
                app or a desktop app. The switcher chooses which project&apos;s issues you see.
              </li>
            </ul>
          </section>
          <section aria-labelledby="create-tenant-first" className={card}>
            <h2 id="create-tenant-first" className="text-base font-semibold text-zk-text">
              Create your workspace
            </h2>
            <p className="mt-1 text-sm text-zk-text2">
              It takes one name. You&apos;ll be its owner, and a first project is created with it.
            </p>
            <CreateTenantForm nameMax={TENANT_NAME_MAX} />
          </section>
        </>
      ) : null}

      {hasTenants ? (
        <section aria-labelledby="your-tenants" className="overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
          <h2
            id="your-tenants"
            className="border-b border-zk-border bg-zk-tint px-4 py-3 text-base font-semibold text-zk-text sm:px-6"
          >
            Your workspaces
          </h2>
          <ul className="divide-y divide-zk-border">
            {activeTenants.map((tenant) => {
              const current = tenant.id === currentTenantId;
              return (
                <li key={tenant.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zk-text">
                      <span className="truncate">{tenant.name}</span>
                      {current ? (
                        <Badge className="rounded-full bg-zk-tint text-zk-accent ring-1 ring-zk-border">Current</Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-zk-muted">
                      {/* #537: the slug tells tenants with the same name apart. */}
                      <span className="font-mono">{tenant.slug}</span> · {MEMBERSHIP_ROLE_LABELS[tenant.role]}
                      {current && projectSlug ? (
                        <>
                          {" · "}
                          <Link href={orgPath(projectSlug)} className="text-zk-accent hover:underline">
                            {tenant.role === "member" ? "Members and projects" : "Manage organization"}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <form action={selectTenantAction}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <Button type="submit" variant={current ? "secondary" : "primary"}>
                      Open {tenant.name}
                      {sharesName(tenant.name) ? <span className="sr-only"> ({tenant.slug})</span> : null}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {archivedTenants.length > 0 ? (
        <section
          aria-labelledby="archived-tenants"
          className="overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface"
        >
          <h2
            id="archived-tenants"
            className="border-b border-zk-border bg-zk-tint px-4 py-3 text-base font-semibold text-zk-text sm:px-6"
          >
            Archived workspaces
          </h2>
          <p className="border-b border-zk-border px-4 py-3 text-sm text-zk-text2 sm:px-6">
            Archived workspaces are hidden from the switcher and can&apos;t be opened. Restore one
            to work in it again.
          </p>
          <ul className="divide-y divide-zk-border">
            {archivedTenants.map((tenant) => (
              <li
                key={tenant.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zk-text">{tenant.name}</p>
                  <p className="mt-0.5 text-xs text-zk-muted">
                    <span className="font-mono">{tenant.slug}</span> · Archived · {MEMBERSHIP_ROLE_LABELS[tenant.role]}
                  </p>
                </div>
                <form action={setTenantArchivedAction}>
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <input type="hidden" name="archived" value="false" />
                  <Button type="submit" variant="secondary">
                    Restore {tenant.name}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="join-with-invite" className={card}>
        <h2 id="join-with-invite" className="text-base font-semibold text-zk-text">
          Join with an invite
        </h2>
        <p className="mt-1 text-sm text-zk-text2">
          {hasTenants
            ? "Workspaces are invite-only. Open the link an owner or admin sent you, or paste it here."
            : "Joining your team instead? Open the invite link an owner or admin sent you, or paste it here."}
        </p>
        <InviteLinkForm />
      </section>

      {hasTenants || inviteId ? (
        <section aria-labelledby="create-tenant" className={card}>
          <h2 id="create-tenant" className="text-base font-semibold text-zk-text">
            Create a workspace
          </h2>
          <CreateTenantForm nameMax={TENANT_NAME_MAX} />
        </section>
      ) : null}

      {zeduOwnerNeeded ? (
        <section aria-labelledby="zedu-owner" className="rounded-xl border border-zk-warn-bd bg-zk-warn-bg p-4 sm:p-6">
          <h2 id="zedu-owner" className="text-base font-semibold text-zk-warn-fg">
            Ziki has no owner yet
          </h2>
          <p className="mt-1 text-sm text-zk-warn-fg">
            Everyone moved into Ziki is a member, so nobody can invite people. As the site&apos;s
            super admin, choose its first owner from its existing members.
          </p>
          <ZeduOwnerForm />
        </section>
      ) : null}
    </div>
  );
}
