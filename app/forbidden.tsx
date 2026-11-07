import Link from "next/link";
import { StatusPage, primaryActionClass } from "@/components/status-page";
import { NOINDEX } from "@/lib/seo/site";

export const metadata = { title: "No access", robots: NOINDEX };

/** A page the signed-in person may not open, e.g. the audit log (#447). Sent with status 403. */
export default function Forbidden() {
  return (
    <main className="min-h-screen bg-slate-50 px-4">
      <StatusPage
        code="403"
        title="You don't have access to this page"
        actions={
          <Link href="/home" className={primaryActionClass}>
            Go to issues
          </Link>
        }
      >
        <p>Ask an organisation owner or admin if you need it.</p>
      </StatusPage>
    </main>
  );
}
