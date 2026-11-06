import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Organisations · Super admin" };

/** Every organisation on the site. Each row opens that organisation's page. */
export default async function SuperadminOrgsPage() {
  await requireSuperAdmin();
  const organisations = await prisma.organisation.findMany({
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      archivedAt: true,
      createdAt: true,
      _count: { select: { memberships: true, projects: true, agents: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zk-text sm:text-2xl">Organisations</h1>
        <p className="mt-1 text-sm text-zk-text2">
          Every organisation on the site ({organisations.length}). Open one to manage it.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zk-border bg-zk-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zk-divider text-left text-zk-muted">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 text-right font-medium">Users</th>
              <th className="px-4 py-3 text-right font-medium">Projects</th>
              <th className="px-4 py-3 text-right font-medium">Agents</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {organisations.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-zk-muted">No organisations yet.</td></tr>
            ) : null}
            {organisations.map((org) => (
              <tr key={org.slug} className="border-b border-zk-divider last:border-0 hover:bg-zk-chip">
                <td className="px-4 py-3">
                  <Link href={`/superadmin/orgs/${org.slug}`} className="font-medium text-zk-accent hover:underline">
                    {org.name}
                  </Link>
                  {org.archivedAt ? <span className="ml-2 text-xs text-zk-muted">(archived)</span> : null}
                </td>
                <td className="px-4 py-3 text-zk-text2"><code>{org.slug}</code></td>
                <td className="px-4 py-3 text-right tabular-nums text-zk-text">{org._count.memberships}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zk-text">{org._count.projects}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zk-text">{org._count.agents}</td>
                <td className="px-4 py-3 text-zk-text2"><LocalTime date={org.createdAt} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
