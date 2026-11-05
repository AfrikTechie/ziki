"use client";

import Link from "next/link";
import { useProjectRef } from "@/lib/use-project-ref";
import { inUseHrefs, inUseText } from "@/lib/in-use";
import { Button } from "@/components/ui/button";

export type InUse = {
  id: string;
  name: string;
  /** Value the list filters on: the type's name. */
  filterValue: string;
  total: number;
  deleted: number;
  isActive: boolean;
};

/**
 * Shown instead of deleting an issue type that issues still use (#314):
 * why it was refused, where those issues are, and the thing to do instead.
 */
export function InUseNotice({
  inUse,
  pending,
  onDeactivate,
  onDismiss,
}: {
  inUse: InUse;
  pending: boolean;
  onDeactivate: () => void;
  onDismiss: () => void;
}) {
  const text = inUseText(inUse);
  const slug = useProjectRef()!;
  const hrefs = inUseHrefs(slug, inUse.filterValue);

  return (
    <div
      id="in-use-notice"
      role="alert"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p>{text.reason}</p>
      <p className="mt-1">
        {text.liveLink ? (
          <Link href={hrefs.live} className="font-medium underline hover:text-amber-950">
            {text.liveLink}
          </Link>
        ) : null}
        {text.liveLink && text.deletedLink ? " · " : null}
        {text.deletedLink ? (
          text.liveLink ? (
            <>
              {"plus "}
              <Link href={hrefs.deleted} className="font-medium underline hover:text-amber-950">
                {text.deletedLink}
              </Link>
              {", which still count until they are reassigned."}
            </>
          ) : (
            // Every issue using it is deleted, so the normal list would show
            // nothing at all; say so rather than offering an empty link.
            <>
              {"All of them are deleted, and still count until they are reassigned: "}
              <Link href={hrefs.deleted} className="font-medium underline hover:text-amber-950">
                {`view the ${text.deletedLink}`}
              </Link>
              {"."}
            </>
          )
        ) : null}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {inUse.isActive ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={onDeactivate}>
            {pending ? "Deactivating…" : "Deactivate instead"}
          </Button>
        ) : (
          <span className="text-amber-900">
            It is already inactive, so it can&apos;t be picked for new issues.
          </span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-sm px-1 text-xs font-medium text-amber-900 underline hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
