import { cookies } from "next/headers";
import { LoadError } from "@/components/load-error";
import { parseTaskView, type TasksBoardData } from "@/components/marketing/tasks/model";
import { TasksBoard } from "@/components/marketing/tasks/tasks-board";
import { IDEA_SORT_COOKIE, ISSUE_SORT_COOKIE } from "@/lib/list-sort";
import { logLoadFailure } from "@/lib/load-error";
import { projectRef } from "@/lib/project-paths";
import { requireProject } from "@/lib/project-route";
import { readTasksBoard } from "./data";

export const metadata = { title: "Marketing" };

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/<slug>/marketing`: the project's marketing work, by tab (M-UI-1). Anyone in the project can open it. */
export default async function MarketingHomePage({ params, searchParams }: Props) {
  const { org, project: projectSlug } = await params;
  const slug = projectRef(org, projectSlug);
  const context = await requireProject(org, projectSlug);
  const sorts = await cookies();
  const view = parseTaskView(await searchParams, {
    taskSort: sorts.get(ISSUE_SORT_COOKIE)?.value,
    proposalSort: sorts.get(IDEA_SORT_COOKIE)?.value,
  });
  let board: TasksBoardData;
  try {
    board = await readTasksBoard(context, view);
  } catch (error) {
    return <LoadError title="Tasks could not be loaded" reference={logLoadFailure("[marketing tasks] board query failed", error)} />;
  }
  return <TasksBoard slug={slug} board={board} />;
}
