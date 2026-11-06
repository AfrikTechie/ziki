"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { setWalletAddressAction, type WalletResult } from "@/app/actions/settings";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { useToast } from "@/components/ui/toast";

const FORM_ID = "wallet-address";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function walletValid(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || EVM_ADDRESS.test(trimmed);
}

/**
 * Set the EVM address points could later be sent to (#618).
 *
 * Saving an empty field clears it. Only you can change yours: the server takes
 * the account from the session, not from this form.
 */
export function WalletAddressForm({ initialAddress }: { initialAddress: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const { fieldErrors, show, clear, attrs } = useFieldErrors(FORM_ID, formRef);
  const [address, setAddress] = useState(initialAddress);
  const [savedAddress, setSavedAddress] = useState(initialAddress);
  const [result, action, pending] = useActionState<WalletResult | undefined, FormData>(
    async (previous, formData) => {
      const next = await setWalletAddressAction(previous, formData);
      if (next.ok) {
        const saved = next.walletAddress ?? "";
        setAddress(saved);
        setSavedAddress(saved);
      }
      return next;
    },
    undefined,
  );

  const trimmed = address.trim();
  const valid = walletValid(address);
  const dirty = trimmed !== savedAddress.trim();
  const saveDisabled = pending || !valid || !dirty;

  const hint =
    trimmed === ""
      ? "An EVM address (0x followed by 40 hex characters) where your $ could be sent one day. Leave it empty and save to clear it."
      : valid
        ? "Looks like a valid EVM address."
        : `That doesn't look right — it should be 0x followed by 40 hex characters (${Math.max(0, trimmed.length - 2)}/40).`;

  const hintClass =
    trimmed === ""
      ? "text-zk-muted font-medium"
      : valid
        ? "text-zk-ok-fg font-bold"
        : "text-zk-bad-fg font-bold";

  useEffect(() => {
    if (!result) return;
    if (result.ok) {
      clear();
      toast(result.walletAddress ? "Wallet address saved." : "Wallet address cleared.", "success");
    } else {
      show({
        error: result.error ?? "Enter a valid EVM address.",
        field: result.field,
        fieldErrors: result.fieldErrors,
      });
      document.getElementById("walletAddress")?.focus();
    }
  }, [result, show, clear, toast]);

  return (
    <form ref={formRef} action={action} className="space-y-3.5" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-bold text-zk-text">Wallet</h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-zk-muted">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Only you and organisation admins can see it
        </span>
      </div>
      <label htmlFor="walletAddress" className="flex flex-col gap-1.5 text-[13px] font-bold text-zk-text">
        Wallet address
        <span className="flex flex-wrap gap-2.5">
          <input
            id="walletAddress"
            name="walletAddress"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            className={`h-[46px] min-w-0 flex-1 rounded-xl border bg-zk-surface px-3.5 font-mono text-sm text-zk-text outline-none focus-visible:ring-2 focus-visible:ring-electric-blue sm:min-w-[260px] ${
              valid ? "border-zk-border" : "border-zk-bad-fg"
            }`}
            {...attrs("walletAddress")}
          />
          <button
            type="submit"
            disabled={saveDisabled}
            className={`h-[46px] rounded-full px-5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
              saveDisabled
                ? "cursor-not-allowed bg-zk-chip text-zk-muted"
                : "bg-electric-blue-strong text-white hover:brightness-105"
            }`}
          >
            {pending ? "Saving…" : "Save address"}
          </button>
        </span>
      </label>
      <FieldError formId={FORM_ID} field="walletAddress" errors={fieldErrors} />
      <p className={`text-xs leading-relaxed ${hintClass}`}>{hint}</p>
    </form>
  );
}
