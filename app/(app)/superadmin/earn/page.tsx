import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZ } from "@/lib/points/rules";
import { EARN_TASKS } from "@/lib/earn/draft";
import { EarnReviewActions } from "@/components/earn-review-row";

export const metadata = { title: "Earn tasks" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/**
 * Staff check what earners send in (#earn-tasks): each submitted marketing
 * task, with its proof, oldest first. Confirming pays the earner; sending it
 * back says why and lets them fix it and send it again.
 */
export default async function SuperadminEarnPage() {
  await requireSuperAdmin();
  const [waiting, decided] = await Promise.all([
    prisma.earnTaskProgress.findMany({
      where: { status: "submitted" },
      orderBy: { submittedAt: "asc" },
      take: 100,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.earnTaskProgress.findMany({
      where: { status: { in: ["confirmed", "rejected"] } },
      orderBy: { decidedAt: "desc" },
      take: 20,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);
  const task = (key: string) => EARN_TASKS.find((candidate) => candidate.id === key);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/superadmin/users" className="font-medium text-teal-700 hover:underline">
            ← Site admin
          </Link>
        </p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">Earn tasks</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Marketing tasks earners have sent in. Confirming one pays the earner its amount, once. Sending one back tells them why.
        </p>
      </div>

      <section aria-labelledby="waiting" className="space-y-3">
        <h2 id="waiting" className="text-sm font-semibold text-slate-900">Waiting for checking ({waiting.length})</h2>
        {waiting.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-card p-4 text-sm text-slate-600">Nothing is waiting.</p>
        ) : (
          <ul className="m-0 list-none space-y-3 p-0">
            {waiting.map((row) => {
              const def = task(row.taskKey);
              return (
                <li key={row.id} className="space-y-3 rounded-xl border border-slate-200 bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{def?.title ?? row.taskKey}</p>
                    <p className="text-xs text-slate-500">{def ? formatZ(def.pay) : null}{row.submittedAt ? ` · sent ${dateTime.format(row.submittedAt)} UTC` : null}</p>
                  </div>
                  <p className="text-xs text-slate-600">{row.user.name} · {row.user.email}</p>
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{row.proof}</p>
                  <EarnReviewActions userId={row.userId} taskKey={row.taskKey} pay={def ? formatZ(def.pay) : "$0"} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="decided" className="space-y-3">
        <h2 id="decided" className="text-sm font-semibold text-slate-900">Recently decided</h2>
        {decided.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-card p-4 text-sm text-slate-600">Nothing decided yet.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-slate-200 rounded-xl border border-slate-200 bg-card p-0">
            {decided.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span className="text-slate-800">{row.user.name} · {task(row.taskKey)?.title ?? row.taskKey}</span>
                <span className={row.status === "confirmed" ? "text-emerald-800" : "text-red-800"}>
                  {row.status === "confirmed" ? "Confirmed" : `Sent back${row.note ? `: ${row.note}` : ""}`}
                  {row.decidedAt ? ` · ${dateTime.format(row.decidedAt)} UTC` : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
