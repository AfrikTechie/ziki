import { redirect } from "next/navigation";

/** The earner's tasks moved to /earn/marketing (#earn-drafts); this keeps old links working. */
export default function EarnTasksRedirect() {
  redirect("/earn/marketing");
}
