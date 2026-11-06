import Link from "next/link";
import { StatusPage, primaryActionClass } from "@/components/status-page";

/** A redesign proposal that doesn't exist or belongs to another organisation. */
export default function RedesignNotFound() {
  return (
    <StatusPage
      code="404"
      title="We couldn't find that redesign proposal"
      actions={
        <Link href="/inbox?tab=escalations" className={primaryActionClass}>
          Escalations
        </Link>
      }
    >
      <p>The link may be wrong, or the proposal may belong to another organisation.</p>
    </StatusPage>
  );
}
