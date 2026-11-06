import Link from "next/link";
import { StatusPage, primaryActionClass } from "@/components/status-page";

/**
 * The same page whether the project doesn't exist or the viewer can't manage
 * it, so a slug doesn't reveal which projects an organisation has.
 */
export default function ProjectNotFound() {
  return (
    <StatusPage
      code="404"
      title="We couldn't find that project"
      actions={
        <Link href="/home" className={primaryActionClass}>
          Your issues
        </Link>
      }
    >
      <p>The link may be wrong, or only this organisation&apos;s admins can manage the project.</p>
    </StatusPage>
  );
}
