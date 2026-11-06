"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { PromoteOwnerResult } from "@/lib/organisations";
import { promoteZeduOwnerAction } from "./actions";

const FORM_ID = "zedu-owner";

/** The super admin names Zedu's first owner from its existing members (#444). */
export function ZeduOwnerForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const { fieldErrors, show, clear, attrs } = useFieldErrors(FORM_ID, formRef);
  const [email, setEmail] = useState("");
  const [result, action, pending] = useActionState<PromoteOwnerResult | undefined, FormData>(
    async (previous, formData) => {
      const next = await promoteZeduOwnerAction(previous, formData);
      // Toast here, not in an effect: on success the page refreshes without
      // this section, so this form unmounts before an effect would run.
      if (next.ok) toast(`${next.name} is now Ziki's owner.`, "success");
      return next;
    },
    undefined,
  );

  useEffect(() => {
    if (result && !result.ok && result.field) show({ error: result.error, field: result.field });
    else clear();
  }, [result, show, clear]);

  const formError = result && !result.ok && !result.field ? result.error : null;

  return (
    <form ref={formRef} action={action} className="mt-4 space-y-1" noValidate>
      <label htmlFor="zedu-owner-email" className="block text-sm font-medium text-zk-text">
        Member&apos;s email
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="zedu-owner-email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="lead@zedu.chat"
          autoComplete="off"
          required
          disabled={pending}
          className="sm:max-w-sm"
          {...attrs("email")}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Make owner"}
        </Button>
      </div>
      <FieldError formId={FORM_ID} field="email" errors={fieldErrors} />
      {formError ? (
        <p role="alert" className="text-sm text-zk-bad-fg">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
