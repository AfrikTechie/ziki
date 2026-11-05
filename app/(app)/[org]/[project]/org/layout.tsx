import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MEMBERSHIP_ROLE_LABELS } from "@/lib/tenants";
import { loadOrg } from "./org-context";
import { OrgTabs } from "./org-tabs";
import { requireProject } from "@/lib/project-route";

/**
 * The organization admin area (/<org>/<project>/org, #project-urls): everything an organization's owners and
 * admins manage, each in one place. It always shows the organization this
 * device is working in. Every member can open it; only owners and admins (and
 * the site super admin) see controls. Site-wide staff pages stay under /superadmin.
 */
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string; project: string }> }) {
  const { org: orgParam, project } = await params;
  // The address picks the organisation and checks access (lib/project-route.ts).
  await requireProject(orgParam, project);
  const { org } = await loadOrg();

  if (!org) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Organization</h1>
        <p className="text-sm text-zk-text2">
          You&apos;re not working in an organization yet. Open one, accept an invite, or create your
          own, and its members, invites, projects and settings appear here.
        </p>
        <Link href="/tenants" className="text-sm font-medium text-zk-accent hover:underline">
          Your workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Organization</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-2xl font-extrabold tracking-tight text-zk-text">{org.name}</h1>
            <Badge className="rounded-full bg-zk-chip text-zk-text2">
              <span className="sr-only">Your role: </span>
              {MEMBERSHIP_ROLE_LABELS[org.role]}
            </Badge>
          </div>
          <p className="text-sm text-zk-text2">
            <span className="font-mono">{org.slug}</span>
            {" · "}
            <Link href="/tenants" className="font-medium text-zk-accent hover:underline">
              Switch organization
            </Link>
          </p>
        </div>
        <OrgTabs />
      </div>
      {children}
    </div>
  );
}
