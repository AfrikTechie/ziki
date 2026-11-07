import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { loadActivity } from "@/lib/activity/queries";
import { activityIssueNumber } from "@/lib/activity/board";
import { ActivityBoard } from "./activity-board";

export const metadata = { title: "Human–Agent Activity" };

const panel = "space-y-3 rounded-2xl border border-zk-border bg-zk-surface p-4 sm:p-6";
const link = "font-semibold text-zk-accent underline-offset-2 hover:underline";

/**
 * Human–Agent Activity (#849): a status board for the person's agents. What
 * needs them first (offers to accept, deadlines close, work sent back,
 * questions), then work in progress, delivered work waiting on review or
 * merge, and what ended, with the reason in plain words.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ issue?: string | string[] }> }) {
  const user = await requireUser();
  if (!isAgentPlatformEnabled()) return <p>The agent platform is not enabled in this environment.</p>;
  const organisationId = await currentOrganisationIdFor(user.id);
  const params = await searchParams;
  const issueInput = (Array.isArray(params.issue) ? params.issue[0] : params.issue)?.trim() ?? "";
  const data = organisationId
    ? await loadActivity(user.id, organisationId, { issueNumber: activityIssueNumber(issueInput) })
    : null;

  if (!data) {
    return (
      <div className={panel}>
        <h1 className="text-2xl font-extrabold text-zk-text">Activity</h1>
        <p className="text-sm text-zk-text2">Join an organisation to see your agents&apos; activity.</p>
        <Link className={link} href="/organisations">Organisations</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 pb-10 text-zk-text">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-[1_1_280px] space-y-1">
          <h1 className="m-0 text-2xl font-extrabold">Human–Agent Activity</h1>
          <p className="m-0 text-sm text-zk-text2">
            What your agents are doing, what needs you, and how much time is left.
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-zk-muted">
            Issue
            <input
              name="issue"
              defaultValue={issueInput}
              placeholder="#123"
              inputMode="numeric"
              className="mt-1 block h-10 w-32 rounded-lg border border-zk-border bg-zk-bg px-3 text-sm text-zk-text"
            />
          </label>
          <button type="submit" className="h-10 rounded-full bg-electric-blue-strong px-4 text-sm font-semibold text-white">Filter</button>
          {issueInput ? <Link className={`${link} self-center text-sm`} href="/activity">Clear</Link> : null}
        </form>
      </header>
      <ActivityBoard data={data} renderedAt={data.loadedAt} />
    </div>
  );
}
