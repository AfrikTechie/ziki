import Link from "next/link";
import {
  StatusPage,
  primaryActionClass,
} from "@/components/status-page";
import { NOINDEX } from "@/lib/seo/site";

export const metadata = { title: "Page not found", robots: NOINDEX };

/** Any URL the app doesn't have a route for (#214). */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 px-4">
      <StatusPage
        code="404"
        title="This page doesn't exist"
        actions={
          <Link href="/home" className={primaryActionClass}>
            Go to issues
          </Link>
        }
      >
        <p>Check the address, or head back to the issues list.</p>
      </StatusPage>
    </main>
  );
}
