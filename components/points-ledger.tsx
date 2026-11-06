import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import type { PointEntriesPage } from "@/lib/points/entries";
import { formatZ } from "@/lib/points/rules";

export function PointsLedger({ page, profileId, from, to, error }: {
  page: PointEntriesPage | null; profileId: string; from?: string; to?: string; error?: boolean;
}) {
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  if (page?.nextCursor) query.set("cursor", page.nextCursor);
  return (
    <section aria-labelledby="ledger-heading" className="rounded-[20px] border border-zk-border bg-zk-surface p-4 sm:p-5">
      <h2 id="ledger-heading" className="text-sm font-semibold text-zk-text">$ history</h2>
      <p className="mt-1 text-sm text-zk-text2">Your organisation ledger, including corrections. Issue details appear only when available.</p>
      <form method="get" className="my-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-zk-text2">From (UTC)<input type="date" name="from" defaultValue={from?.slice(0, 10)} className="mt-1 block rounded-xl border border-zk-border p-2" /></label>
        <label className="text-sm text-zk-text2">To (UTC)<input type="date" name="to" defaultValue={to?.slice(0, 10)} className="mt-1 block rounded-xl border border-zk-border p-2" /></label>
        <button className="rounded-full border border-zk-border bg-zk-surface px-3.5 py-2 text-sm font-medium text-zk-text focus-visible:outline-2 focus-visible:outline-offset-2" type="submit">Apply dates</button>
        <Link href={`/users/${profileId}#ledger-heading`} className="rounded p-2 text-sm text-zk-accent underline focus-visible:outline-2 focus-visible:outline-offset-2">Reset</Link>
      </form>
      {error ? <p role="alert" className="text-sm text-zk-bad-fg">Invalid dates or page cursor. Reset the filters and try again.</p> : !page?.items.length ? <p className="text-sm text-zk-text2">No points entries in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Ledger entries, newest first</caption>
            <thead><tr>{["Date", "Source", "Role", "Issue", "$"].map(label => <th key={label} scope="col" className="px-2 py-2 font-medium text-zk-text2">{label}</th>)}</tr></thead>
            <tbody>{page.items.map(entry => <tr key={entry.id} className="border-t border-zk-border">
              <td className="whitespace-nowrap px-2 py-2"><LocalTime date={entry.createdAt} /></td>
              <td className="px-2 py-2">{entry.source}</td><td className="px-2 py-2">{entry.role}</td>
              <td className="min-w-40 px-2 py-2">{entry.issue ? <Link className="rounded text-zk-accent underline focus-visible:outline-2 focus-visible:outline-offset-2" href={entry.issue.path}>#{entry.issue.number} {entry.issue.title}</Link> : entry.idea ? <Link className="rounded text-zk-accent underline focus-visible:outline-2 focus-visible:outline-offset-2" href={entry.idea.path}>Idea #{entry.idea.number} {entry.idea.title}</Link> : "Unavailable or non-issue source"}</td>
              <td className="px-2 py-2 font-medium tabular-nums">{entry.points > 0 ? "+" : ""}{formatZ(entry.points)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {page?.nextCursor ? <Link className="mt-4 inline-block rounded text-sm text-zk-accent underline focus-visible:outline-2 focus-visible:outline-offset-2" href={`/users/${profileId}?${query}#ledger-heading`}>Older entries</Link> : null}
    </section>
  );
}
