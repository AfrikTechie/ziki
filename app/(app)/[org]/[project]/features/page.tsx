import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { projectPath } from "@/lib/project-paths";

export const metadata = { title: "Feature plans" };

export default async function FeaturePlansPage({ params }: { params: Promise<{ org: string; project: string }> }) {
  const { org, project: slug } = await params;
  const { user, project, canContribute } = await requireProject(org, slug);
  if (!canContribute) notFound();
  const base = projectPath(project.ref, "/features");
  const plans = await prisma.featurePlan.findMany({
    where: { projectId: project.id, OR: [{ creatorId: user.id }, { publishedAt: { not: null } }] },
    select: { id: true, title: true, creatorId: true, publishedAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 50,
  });
  return <main className="mx-auto max-w-4xl space-y-6 text-zk-text [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Feature plans</h1><p className="mt-2 max-w-2xl text-sm text-zk-text2">Turn one feature request into clear work. Reuse existing ideas and issues, choose the first usable version, and define what success looks like.</p></div><Link href={`${base}/new`} className="rounded-lg bg-zk-accent px-4 py-2 text-sm font-semibold text-white">Plan a feature</Link></div>
    <p className="text-sm text-zk-text2">Your drafts are private. Published plans are shared with project members; their new ideas go through Ziki’s existing workflow.</p>
    {plans.length ? <ul className="divide-y divide-zk-border rounded-2xl border border-zk-border bg-zk-surface">{plans.map((plan) => <li key={plan.id} className="p-5"><Link href={`${base}/${plan.id}`} className="font-semibold text-zk-accent hover:underline">{plan.title}</Link><p className="mt-1 text-sm text-zk-text2">{plan.publishedAt ? "Published plan" : "Private draft"}{plan.creatorId === user.id ? " · Yours" : ""} · Updated {plan.updatedAt.toISOString().slice(0, 10)}</p></li>)}</ul> : <div className="rounded-2xl border border-zk-border bg-zk-surface p-8"><h2 className="font-semibold">Start with the outcome you want</h2><p className="mt-2 text-sm text-zk-text2">For example: “Customers can book an available appointment and receive confirmation.” Review a proposed breakdown before creating any ideas.</p></div>}
    {plans.length === 50 ? <p className="text-sm text-zk-text2">Showing the 50 most recently updated plans.</p> : null}
  </main>;
}
