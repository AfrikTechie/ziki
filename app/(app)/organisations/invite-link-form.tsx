"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { Input } from "@/components/ui/input";
import { openInviteLinkAction, type OrganisationFormResult } from "./actions";

const FORM_ID = "invite-link";

/** Paste the invite link someone sent you, to open it here (#444). */
export function InviteLinkForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const { fieldErrors, show, clear, attrs } = useFieldErrors(FORM_ID, formRef);
  const [link, setLink] = useState("");
  const [result, action, pending] = useActionState<OrganisationFormResult | undefined, FormData>(
    openInviteLinkAction,
    undefined,
  );

  useEffect(() => {
    if (!result) return;
    if (result.field) show(result);
    else clear();
  }, [result, show, clear]);

  return (
    <form ref={formRef} action={action} className="mt-4 space-y-1" noValidate>
      <label htmlFor="invite-link-input" className="block text-sm font-medium text-zk-text">
        Invite link
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="invite-link-input"
          name="link"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://ziki.dev/join/…"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={pending}
          className="font-mono text-xs sm:max-w-md"
          {...attrs("link")}
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Opening…" : "Open invite"}
        </Button>
      </div>
      <FieldError formId={FORM_ID} field="link" errors={fieldErrors} />
    </form>
  );
}
