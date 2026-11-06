import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { EMPTY_PLATFORM, platformToValues } from "@/lib/compare/admin-values";
import { PlatformForm } from "@/components/compare/admin-forms";

export const metadata = { title: "Compare platform" };
export const dynamic = "force-dynamic";

export default async function AdminPlatformPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const platform = id === "new" ? null : await prisma.comparePlatform.findUnique({ where: { id } });
  if (id !== "new" && !platform) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm"><Link href="/superadmin/compare" className="font-medium text-zk-accent hover:underline">← Compare directory</Link></p>
        <h1 className="mt-2 text-xl font-semibold text-zk-text sm:text-2xl">{platform ? platform.name : "Add platform"}</h1>
      </div>
      <PlatformForm initial={platform ? platformToValues(platform) : EMPTY_PLATFORM} isZiki={Boolean(platform?.isZiki)} />
    </div>
  );
}
