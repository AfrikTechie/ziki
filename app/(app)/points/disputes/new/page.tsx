import { DisputeForm } from "./dispute-form";

export const metadata = { title: "Open a $ dispute" };

/** Prefill from `?bug=` and `?entry=` so a dispute can start from an issue or ledger row. */
export default async function NewDisputePage({
  searchParams,
}: {
  searchParams: Promise<{ bug?: string; entry?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Open a $ dispute</h1>
        <p className="text-sm text-zk-text2">
          Say an award is missing or an entry is wrong. An organisation admin reviews it; points are
          never deleted, a correction is a reversing entry.
        </p>
      </div>
      <DisputeForm defaultBugNumber={params.bug ?? ""} defaultEntryId={params.entry ?? ""} />
    </div>
  );
}
