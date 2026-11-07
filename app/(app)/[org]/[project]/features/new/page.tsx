import { notFound } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { projectPath } from "@/lib/project-paths";
import { FeaturePlanEditor } from "../feature-plan-editor";

export const metadata = { title: "Plan a feature" };

export default async function NewFeaturePlanPage({ params }: { params: Promise<{ org: string; project: string }> }) {
  const { org, project: slug } = await params;
  const { project, canContribute } = await requireProject(org, slug);
  if (!canContribute) notFound();
  return <main className="mx-auto max-w-4xl space-y-6 text-zk-text [overflow-wrap:anywhere]">
    <header><h1 className="text-2xl font-bold">Plan a feature</h1><p className="mt-2 text-sm text-zk-text2">Have another feature in mind? Describe your idea and constraints. AI suggests a practical first version, later improvements, and a clear definition of done using your project context.</p></header>
    <FeaturePlanEditor projectId={project.id} basePath={projectPath(project.ref, "/features")} />
  </main>;
}
