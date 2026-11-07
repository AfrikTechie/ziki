import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { ideaPath, projectPath } from "@/lib/project-paths";
import { issuePath } from "@/lib/issue-ref";
import { stateLabel } from "@/lib/labels";
import { featureDraftSchema } from "@/lib/validations/feature-plan";
import { featureWorkState } from "@/lib/feature-plans";
import { FeaturePlanEditor, PublishFeaturePlan } from "../feature-plan-editor";

export const metadata = { title: "Feature plan" };
const issueSelect = { id: true, number: true, title: true, projectId: true, isDeleted: true, status: true, substatus: true } as const;

export default async function FeaturePlanPage({ params, searchParams }: {
  params: Promise<{ org: string; project: string; id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { org, project: slug, id } = await params;
  const { user, project, canContribute } = await requireProject(org, slug);
  if (!canContribute) notFound();
  const plan = await prisma.featurePlan.findFirst({
    where: { id, projectId: project.id, OR: [{ creatorId: user.id }, { publishedAt: { not: null } }] },
    include: { items: { include: {
      idea: { select: { id: true, number: true, title: true, projectId: true, isDeleted: true, status: true, issue: { select: issueSelect } } },
      bug: { select: issueSelect },
    } } },
  });
  if (!plan) notFound();
  const draft = featureDraftSchema.parse(plan.draft);
  const base = projectPath(project.ref, "/features");
  const own = plan.creatorId === user.id;
  if (own && !plan.publishedAt && (await searchParams).edit === "1") {
    return <main className="mx-auto max-w-4xl space-y-6 text-zk-text [overflow-wrap:anywhere]"><h1 className="text-2xl font-bold">Edit feature plan</h1><FeaturePlanEditor key={`${id}:${plan.version}`} projectId={project.id} basePath={base} initial={{ id: plan.id, version: plan.version, title: plan.title, request: plan.request, draft }} /></main>;
  }
  // References that were removed or moved out of the project must not leak their title or state.
  const items = plan.items.map((item) => ({ ...item,
    idea: item.idea?.projectId === project.id ? { ...item.idea, issue: item.idea.issue?.projectId === project.id ? item.idea.issue : null } : null,
    bug: item.bug?.projectId === project.id ? item.bug : null,
  }));
  // Let the owner inspect selected work on the review page before publishing a link.
  const pending = draft.tasks.map((task, position) => ({ task, position }))
    .filter(({ task, position }) => task.existing && !items.some((item) => item.position === position));
  const pendingIds = (kind: string) => pending.flatMap(({ task }) => task.existing?.startsWith(`${kind}:`) ? [task.existing.split(":")[1]] : []);
  const [selectedIdeas, selectedIssues] = await Promise.all([
    pendingIds("idea").length ? prisma.idea.findMany({
      where: { id: { in: pendingIds("idea") }, projectId: project.id, isDeleted: false, track: "product" },
      select: { id: true, number: true, title: true, projectId: true, isDeleted: true, status: true, issue: { select: issueSelect } },
    }) : Promise.resolve([]),
    pendingIds("issue").length ? prisma.bug.findMany({
      where: { id: { in: pendingIds("issue") }, projectId: project.id, isDeleted: false, track: "product" }, select: issueSelect,
    }) : Promise.resolve([]),
  ]);
  const previews = pending.map(({ task, position }) => ({
    position,
    idea: selectedIdeas.find((idea) => task.existing === `idea:${idea.id}`) ?? null,
    bug: selectedIssues.find((issue) => task.existing === `issue:${issue.id}`) ?? null,
  }));
  const firstPositions = draft.tasks.flatMap((task, position) => task.scope === "first" ? [position] : []);
  const onProd = items.filter((item) => {
    const state = featureWorkState(item);
    return firstPositions.includes(item.position) && state.kind === "issue" && state.status === "resolved" && state.substatus === "on_prod";
  }).length;
  return <main className="mx-auto max-w-4xl space-y-6 text-zk-text [overflow-wrap:anywhere]">
    <header className="space-y-3"><Link href={base} className="text-sm text-zk-accent hover:underline">All feature plans</Link><div className="flex flex-wrap items-start justify-between gap-3"><h1 className="text-2xl font-bold">{plan.title}</h1>{own && !plan.publishedAt ? <Link className="rounded-lg border border-zk-border px-4 py-2 text-sm font-semibold" href={`${base}/${id}?edit=1`}>Edit draft</Link> : null}</div><p className="text-sm text-zk-text2">{plan.publishedAt ? "Published plan · Shared with project members" : "Private draft · No work has been published"}</p></header>
    <section className="space-y-3 rounded-2xl border border-zk-border bg-zk-surface p-5"><h2 className="font-semibold">The feature outcome</h2><p className="whitespace-pre-wrap text-sm">{draft.outcome}</p><details><summary className="cursor-pointer text-sm text-zk-text2">Original request</summary><p className="mt-2 whitespace-pre-wrap text-sm">{plan.request}</p></details></section>
    <section className="space-y-3 rounded-2xl border border-zk-border bg-zk-surface p-5"><h2 className="font-semibold">Definition of done</h2><ul className="list-disc space-y-2 pl-5 text-sm">{draft.definitionOfDone.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul><p className="text-sm text-zk-text2">These are the end-to-end success criteria. Linked work statuses do not automatically verify this outcome.</p>{plan.publishedAt ? <p className="text-sm font-semibold">{onProd} of {firstPositions.length} first-version work items reported live on production.</p> : null}</section>
    {(["first", "later"] as const).map((scope) => {
      const tasks = draft.tasks.map((task, position) => ({ task, position })).filter(({ task }) => task.scope === scope);
      if (!tasks.length) return null;
      const unpublished = tasks.filter(({ position }) => !items.some((item) => item.position === position));
      return <section key={scope} className="space-y-4" aria-labelledby={`scope-${scope}`}>
        <h2 id={`scope-${scope}`} className="text-lg font-semibold">{scope === "first" ? "First usable version" : "Later improvements"}</h2>
        <p className="text-sm text-zk-text2">{scope === "first" ? "The core work selected for the feature’s first version." : "Optional follow-up work. Unpublished items are not offered to agents through this plan; linking work does not pause its existing workflow."}</p>
        <ol className="space-y-3">{tasks.map(({ task, position }) => {
          const receipt = items.find((item) => item.position === position);
          const target = receipt ?? previews.find((item) => item.position === position);
          const state = target ? featureWorkState(target) : null;
          const issue = target?.bug ?? (!target?.idea?.isDeleted && target?.idea?.issue?.projectId === project.id ? target.idea.issue : null);
          const href = state?.kind === "issue" && issue ? issuePath(project.ref, issue.number) : state?.kind === "idea" && target?.idea ? ideaPath(project.ref, target.idea.number) : null;
          const workLabel = state?.kind === "issue" && issue ? `Issue #${issue.number} · ${stateLabel(issue.substatus)}` : state?.kind === "idea" ? `Idea #${target?.idea?.number} · ${state.status}` : state ? "Selected work is unavailable" : "New idea · Not published";
          const label = !receipt && task.existing ? `${workLabel} · Not linked yet` : workLabel;
          return <li key={position} className="space-y-3 rounded-2xl border border-zk-border bg-zk-surface p-5"><h3 className="font-semibold">{task.title}</h3><p className="whitespace-pre-wrap text-sm">{task.description}</p><ul className="list-disc space-y-1 pl-5 text-sm">{task.acceptanceCriteria.map((criterion, i) => <li key={i}>{criterion}</li>)}</ul>{href ? <Link className="text-sm font-semibold text-zk-accent hover:underline" href={href}>{label}</Link> : <p className="text-sm text-zk-text2">{label}</p>}{task.existing ? <p className="text-xs text-zk-text2">Reuses existing work; this plan does not change its requirements. Verify that it meets the criteria above.</p> : null}</li>;
        })}</ol>
        {own && unpublished.length && (scope === "first" || plan.publishedAt) ? <PublishFeaturePlan projectId={project.id} id={id} version={plan.version} scope={scope} newIdeas={unpublished.filter(({ task }) => !task.existing).length} links={unpublished.filter(({ task }) => task.existing).length} /> : null}
      </section>;
    })}
  </main>;
}
