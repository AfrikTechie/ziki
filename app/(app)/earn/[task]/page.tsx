import { notFound, redirect } from "next/navigation";
import { EARN_TASKS, zikiTaskPath } from "@/lib/earn/draft";

/** Old address (#earn-drafts): each Ziki task now has its own page in the main list, so this sends you there. */
export default async function EarnTaskRedirect({ params, searchParams }: { params: Promise<{ task: string }>; searchParams: Promise<{ p?: string }> }) {
  const { task: id } = await params;
  const index = EARN_TASKS.findIndex((task) => task.id === id);
  if (index < 0) notFound();
  const p = (await searchParams).p;
  redirect(`${zikiTaskPath(index + 1)}${p ? `?p=${encodeURIComponent(p)}` : ""}`);
}
