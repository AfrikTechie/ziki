import Link from "next/link";
import { StatusPage, primaryActionClass } from "@/components/status-page";

/**
 * The same page whether the person doesn't exist or shares no organisation with
 * the viewer (#503), so guessing ids tells nobody who has an account.
 */
export default function PersonNotFound() {
  return (
    <StatusPage
      code="404"
      title="We couldn't find that person"
      actions={
        <Link href="/workers" className={primaryActionClass}>
          Go to ranking
        </Link>
      }
    >
      <p>The link may be wrong, or you don&apos;t share an organisation with them.</p>
    </StatusPage>
  );
}
