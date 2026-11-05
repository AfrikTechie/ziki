"use client";

import { useEffect, useState } from "react";
import { EARN_WELCOME_SEEN_COOKIE, SIGNUP_BONUS } from "@/lib/earn/draft";

/** Wait a beat after the page appears, then stay long enough to read it. */
const SHOW_AFTER_MS = 500;
const STAY_MS = 6500;
/** The slide-out takes this long; the toast is removed once it has finished. */
const LEAVE_MS = 600;

/**
 * "$5 has been awarded to you for signing up" (#earn-welcome): a toast, not a pop-up. It slides up from the
 * bottom of the page in the home page's blue, stays a few seconds and slides away, and it can be dismissed. Only
 * someone who signed up after Earn went live is shown it, once per browser: a cookie records that it was shown.
 */
export function EarnWelcomeToast() {
  const [mounted, setMounted] = useState(true);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    document.cookie = `${EARN_WELCOME_SEEN_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
    const show = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    const hide = setTimeout(() => setShown(false), SHOW_AFTER_MS + STAY_MS);
    const remove = setTimeout(() => setMounted(false), SHOW_AFTER_MS + STAY_MS + LEAVE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
      clearTimeout(remove);
    };
  }, []);

  if (!mounted) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[72px] sm:pt-[84px]">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-[12px] bg-[#3978f6] py-3 pl-4 pr-2 text-white shadow-[0_14px_36px_rgba(57,120,246,0.38)] transition-[opacity,transform] duration-[600ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          shown ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0"
        }`}
      >
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-medium">${SIGNUP_BONUS}</span>
        <p className="text-sm font-medium leading-snug tracking-[-0.01em]">
          ${SIGNUP_BONUS} has been awarded to you for signing up.
        </p>
        <button
          type="button"
          onClick={() => setShown(false)}
          aria-label="Dismiss"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
