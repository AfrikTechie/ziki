import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MEMBERSHIP_ROLE_LABELS } from "@/lib/organisations";
import { loadOrg } from "./org-context";
import { Suspense } from "react";
import { SettingsNav } from "@/components/settings-nav";
import "@/app/(app)/settings/settings-design.css";
import { requireProject } from "@/lib/project-route";

/**
 * The organisation admin area (/<org>/<project>/org, #project-urls): everything an organisation's owners and
 * admins manage, each in one place. It always shows the organisation this
 * device is working in. Every member can open it; only owners and admins (and
 * the site super admin) see controls. Site-wide staff pages stay under /superadmin.
 */
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string; project: string }> }) {
  const { org: orgParam, project } = await params;
  // The address picks the organisation and checks access (lib/project-route.ts).
  const { project: current } = await requireProject(orgParam, project);
  const { org } = await loadOrg();

  if (!org) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Organisation</h1>
        <p className="text-sm text-zk-text2">
          You&apos;re not working in an organisation yet. Open one, accept an invite, or create your
          own, and its members, invites, projects and settings appear here.
        </p>
        <Link href="/organisations" className="text-sm font-medium text-zk-accent hover:underline">
          Your organisations
        </Link>
      </div>
    );
  }

  return (
    <div className="settings-page mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Organisation</p>
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
            <Link href="/organisations" className="font-medium text-zk-accent hover:underline">
              Switch organisation
            </Link>
          </p>
        </div>
      </div>
      {/* One Settings area: your settings and the organisation's share this sidebar (components/settings-nav.tsx). */}
      <div className="settings-layout">
        <Suspense fallback={<nav aria-label="Settings sections" className="settings-navigation" />}>
          <SettingsNav orgRef={current.ref} orgName={org.name} />
        </Suspense>
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </div>
  );
}
