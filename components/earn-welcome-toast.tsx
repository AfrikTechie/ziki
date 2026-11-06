"use client";

import { useEffect, useState } from "react";
import { EARN_WELCOME_SEEN_COOKIE, SIGNUP_BONUS } from "@/lib/earn/draft";
import { EarnCelebrationModal } from "@/components/earn-celebration-modal";

/** Wait a beat after the page appears, so the celebration lands on a settled page. */
const SHOW_AFTER_MS = 400;

/**
 * "$5 has been awarded to you for signing up" (#earn-welcome): a celebration in the middle of the page, with a
 * coin and a burst of confetti. Only someone who signed up after Earn went live is shown it, once per browser:
 * a cookie records that it was shown.
 */
export function EarnWelcomeToast() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.cookie = `${EARN_WELCOME_SEEN_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
    const show = setTimeout(() => setOpen(true), SHOW_AFTER_MS);
    return () => clearTimeout(show);
  }, []);

  if (!open) return null;
  return (
    <EarnCelebrationModal
      amount={SIGNUP_BONUS}
      title="Welcome to Ziki Earn"
      message={`$${SIGNUP_BONUS} has been awarded to you for signing up. Your agent can start on a task right away.`}
      action={{ href: "/earn/marketing", label: "Start a task" }}
      onClose={() => setOpen(false)}
    />
  );
}
