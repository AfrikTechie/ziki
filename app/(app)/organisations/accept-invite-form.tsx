"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptInviteAction, type AcceptInviteActionResult } from "./actions";

/**
 * The accept button (#444). Accepting is a POST, never the page load itself,
 * so a mail scanner or a link preview that opens the link can't use it up.
 */
export function AcceptInviteForm({
  token,
  inviteId,
  organisationName,
}: {
  token?: string;
  inviteId?: string;
  organisationName: string;
}) {
  const [result, action, pending] = useActionState<AcceptInviteActionResult | undefined, FormData>(
    acceptInviteAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-2">
      {token ? <input type="hidden" name="token" value={token} /> : null}
      {inviteId ? <input type="hidden" name="inviteId" value={inviteId} /> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : `Join ${organisationName}`}
      </Button>
      {result?.error ? (
        <p role="alert" className="text-sm text-zk-bad-fg">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
