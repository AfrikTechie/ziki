import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { comparisonToValues, EMPTY_COMPARISON } from "@/lib/compare/admin-values";
import { ComparisonForm } from "@/components/compare/admin-forms";

export const metadata = { title: "Compare comparison" };
export const dynamic = "force-dynamic";

export default async function AdminComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const [comparison, platforms] = await Promise.all([
    id === "new" ? null : prisma.comparison.findUnique({ where: { id } }),
    prisma.comparePlatform.findMany({ orderBy: [{ isZiki: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  if (id !== "new" && !comparison) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm"><Link href="/superadmin/compare" className="font-medium text-zk-accent hover:underline">← Compare directory</Link></p>
        <h1 className="mt-2 text-xl font-semibold text-zk-text sm:text-2xl">{comparison ? comparison.title : "Add comparison"}</h1>
      </div>
      <ComparisonForm initial={comparison ? comparisonToValues(comparison) : EMPTY_COMPARISON} platforms={platforms} />
    </div>
  );
}
