import { requireSuperAdmin } from "@/lib/auth-helpers";
import { SuperadminSidebar } from "@/components/superadmin-sidebar";

/**
 * /superadmin is for site staff only: site roles, every organisation on the
 * site, and platform points. Everything an organisation's owners and admins
 * manage lives in /org.
 *
 * Admin pages have loading skeletons (#291), which make them stream, and a
 * redirect thrown from a page after its shell has been sent becomes a 200
 * with a client-side redirect instead of a 307. Guarding in the layout runs
 * before the loading boundary, so anyone else still gets the real redirect.
 * Each page keeps its own guard as well.
 */
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  await requireSuperAdmin();
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <SuperadminSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
