"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TOAST_DURATION_MS,
  addToast,
  dismissToast,
  nextToastId,
  type Toast,
  type ToastTone,
} from "@/lib/toast-store";

type Notify = (message: React.ReactNode, tone?: ToastTone) => void;

const ToastContext = createContext<Notify | null>(null);

const noop: Notify = () => {};

/**
 * Show a short confirmation or error. Safe to call from anywhere under the
 * provider; outside it this is a no-op rather than a crash, so a component
 * that is reused on a provider-less route (the link-preview shell, say) still
 * renders.
 */
export function useToast(): Notify {
  return useContext(ToastContext) ?? noop;
}

const tones: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-slate-200 bg-card text-slate-900",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => dismissToast(list, id));
  }, []);

  const notify = useCallback<Notify>(
    (message, tone = "success") => {
      const id = nextToastId();
      setToasts((list) => addToast(list, { id, message, tone }));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      );
    },
    [dismiss],
  );

  // Nothing should keep firing after the tree unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const polite = toasts.filter((t) => t.tone !== "error");
  const assertive = toasts.filter((t) => t.tone === "error");

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        Both regions are always in the DOM. A live region that is added at the
        same moment as its text is often missed by screen readers, so the
        container has to be there first and only the items may change.
      */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pb-4 sm:items-end sm:px-4">
        <ToastRegion
          label="Notifications"
          live="polite"
          toasts={polite}
          onDismiss={dismiss}
        />
        <ToastRegion
          label="Errors"
          live="assertive"
          toasts={assertive}
          onDismiss={dismiss}
        />
      </div>
    </ToastContext.Provider>
  );
}

function ToastRegion({
  label,
  live,
  toasts,
  onDismiss,
}: {
  label: string;
  live: "polite" | "assertive";
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <ol
      aria-live={live}
      aria-label={label}
      className="flex w-full max-w-sm flex-col gap-2 empty:hidden"
    >
      {toasts.map((toast) => (
        <li
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg ${tones[toast.tone]}`}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="-mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium opacity-70 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            <span className="sr-only">Dismiss</span>
            <span aria-hidden="true">✕</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
