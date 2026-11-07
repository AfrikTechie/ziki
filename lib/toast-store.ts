/**
 * Pure state helpers behind the toast provider.
 *
 * The provider owns the timers and the DOM; everything that decides *what the
 * list should contain* lives here so it can be tested without a browser.
 */

export type ToastTone = "success" | "error" | "info";

export type Toast = {
  id: string;
  message: React.ReactNode;
  tone: ToastTone;
};

/** How long a toast stays on screen before it dismisses itself. */
export const TOAST_DURATION_MS = 5000;

/**
 * Only ever show a few at once. A burst (clicking vote on ten rows) should
 * not build a column of toasts that covers the page it is reporting on.
 */
export const MAX_TOASTS = 3;

/** Appends a toast, dropping the oldest ones once the list is full. */
export function addToast(list: readonly Toast[], toast: Toast): Toast[] {
  const next = [...list, toast];
  return next.slice(Math.max(0, next.length - MAX_TOASTS));
}

/** Removes one toast by id. Unknown ids are a no-op, not an error. */
export function dismissToast(list: readonly Toast[], id: string): Toast[] {
  return list.filter((t) => t.id !== id);
}

/**
 * True for the error Next.js throws out of a server action that called
 * `redirect()`. It is not a failure: the page is about to navigate, and a
 * caller that wants to report success has to do it before rethrowing.
 */
export function isRedirectError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

let counter = 0;

/**
 * Ids only need to be unique within one page's lifetime, and they are used as
 * React keys, so a counter beats `crypto.randomUUID()` here: it is stable in
 * tests and cannot collide with a toast that is still animating out.
 */
export function nextToastId(): string {
  counter += 1;
  return `toast-${counter}`;
}
