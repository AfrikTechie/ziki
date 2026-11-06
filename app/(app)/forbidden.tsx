import Link from "next/link";
import { StatusPage, primaryActionClass } from "@/components/status-page";

export const metadata = { title: "No access" };

/**
 * Shown when a signed-in page calls forbidden(), e.g. the audit log for a
 * member who owns no agents (#447). It renders inside the app layout, which
 * already provides the page's one <main> (#567), so this has none of its own.
 */
export default function AppForbidden() {
  return (
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
  );
}
