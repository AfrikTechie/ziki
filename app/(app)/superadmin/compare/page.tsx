import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { categoryLabel } from "@/lib/compare/catalog";
import { setPublishedAction } from "./actions";

export const metadata = { title: "Compare directory" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

function Toggle({ kind, id, published, label }: { kind: "platform" | "comparison"; id: string; published: boolean; label: string }) {
  return (
    <form action={setPublishedAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="published" value={String(!published)} />
      <button type="submit" className="text-sm text-zk-accent hover:underline" aria-label={`${published ? "Unpublish" : "Publish"} ${label}`}>
        {published ? "Unpublish" : "Publish"}
      </button>
    </form>
  );
}

export default async function AdminComparePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireSuperAdmin();
  const { saved } = await searchParams;
  const [platforms, comparisons] = await Promise.all([
    prisma.comparePlatform.findMany({ orderBy: [{ isZiki: "desc" }, { sortOrder: "asc" }, { name: "asc" }] }),
    prisma.comparison.findMany({
      orderBy: { updatedAt: "desc" },
      include: { platformA: { select: { name: true } }, platformB: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-zk-text sm:text-2xl">Compare directory</h1>
        <p className="mt-1 max-w-2xl text-sm text-zk-text2">
          The platforms and comparisons behind <Link href="/compare" className="text-zk-accent hover:underline">/compare</Link>. Add a platform and
          it can be compared with Ziki straight away; add a comparison to write its introduction, strengths and recommendations.
        </p>
        {saved ? <p role="status" className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">Saved the {saved}.</p> : null}
      </div>

      <section aria-labelledby="platforms-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="platforms-title" className="text-lg font-semibold text-zk-text">Platforms ({platforms.length})</h2>
          <Link href="/superadmin/compare/platforms/new" className="rounded-md bg-zk-accent px-3 py-1.5 text-sm font-medium text-white">Add platform</Link>
        </div>
        <ul className="divide-y divide-zk-border rounded-xl border border-zk-border bg-zk-surface">
          {platforms.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/superadmin/compare/platforms/${p.id}`} className="font-medium text-zk-text hover:underline">{p.name}</Link>
                <p className="text-xs text-zk-muted">
                  {categoryLabel(p.category)} · {p.lastVerifiedAt ? `verified ${dateFormat.format(p.lastVerifiedAt)}` : "not yet verified"} · {p.published ? "published" : "draft"}
                </p>
              </div>
              {p.isZiki ? null : <Toggle kind="platform" id={p.id} published={p.published} label={p.name} />}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="comparisons-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="comparisons-title" className="text-lg font-semibold text-zk-text">Written comparisons ({comparisons.length})</h2>
          <Link href="/superadmin/compare/comparisons/new" className="rounded-md bg-zk-accent px-3 py-1.5 text-sm font-medium text-white">Add comparison</Link>
        </div>
        {comparisons.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zk-border px-4 py-6 text-sm text-zk-text2">
            None yet. Every platform already has a Ziki comparison built from its own data; write one here to add your own text.
          </p>
        ) : (
          <ul className="divide-y divide-zk-border rounded-xl border border-zk-border bg-zk-surface">
            {comparisons.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/superadmin/compare/comparisons/${c.id}`} className="font-medium text-zk-text hover:underline">{c.title}</Link>
                  <p className="text-xs text-zk-muted">
                    /compare/{c.slug} · {c.published ? "published" : "draft"}
                  </p>
                </div>
                <Toggle kind="comparison" id={c.id} published={c.published} label={c.title} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
