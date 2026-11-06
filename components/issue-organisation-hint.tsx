import Link from "next/link";
import { switchOrganisationForIssueAction } from "@/app/(app)/organisations/actions";
import type { IssueOrganisationHint } from "@/lib/issue-organisation-hint";

/**
 * Shown instead of a 404 when an issue exists in another organisation the viewer
 * belongs to (#519): names the organisation and switches to it in one click.
 */
export function IssueOrganisationSwitch({
  issueId,
  organisation,
}: {
  issueId: string;
  organisation: IssueOrganisationHint;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-10">
      <p className="text-sm text-slate-500">Ziki Issues</p>
      <h1 className="text-xl font-semibold text-slate-900">
        This issue is in {organisation.name}
      </h1>
      <p className="text-sm text-slate-600">
        You&apos;re a member of {organisation.name}, but a different organisation is active on this
        device. Switch organisation to open the issue.
      </p>
      <form action={switchOrganisationForIssueAction}>
        <input type="hidden" name="issueId" value={issueId} />
        <input type="hidden" name="organisationId" value={organisation.id} />
        <button
          type="submit"
          className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Switch to {organisation.name} and open the issue
        </button>
      </form>
      <Link href="/home" className="inline-flex text-sm font-medium text-teal-700 hover:underline">
        Back to issues
      </Link>
    </div>
  );
}
