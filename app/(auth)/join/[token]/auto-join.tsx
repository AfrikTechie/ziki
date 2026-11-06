"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { acceptShareLinkAction } from "@/app/(app)/organisations/actions";

/**
 * Joining is a POST, so opening the link (or a preview bot fetching it) does
 * not spend a use. Once the person is signed in, submit that POST for them:
 * Google sign-in returns here, and the organisation is attached without a
 * second click. The button is the fallback when the browser does not run it.
 */
export function AutoJoin({
  token,
  organisationName,
  auto = true,
}: {
  token: string;
  organisationName: string;
  /** False after a failed attempt, so a refresh doesn't immediately retry. */
  auto?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (auto) formRef.current?.requestSubmit();
  }, [auto]);

  return (
    <form ref={formRef} action={acceptShareLinkAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <p role="status" className="text-sm text-zk-text2">
        {auto
          ? `Adding ${organisationName} to your account…`
          : `You're signed in. Join ${organisationName} to add it to your account.`}
      </p>
      <Button
        type="submit"
        className="h-12 w-full bg-electric-blue-strong text-base font-bold text-white hover:bg-electric-blue focus-visible:ring-electric-blue"
      >
        Join {organisationName}
      </Button>
    </form>
  );
}
