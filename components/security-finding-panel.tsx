import Link from "next/link";
import "./security-finding.css";
import { RichText } from "@/components/rich-text";
import { LocalTime } from "@/components/local-time";
import { DiscloseFindingButton } from "@/components/security-finding-controls";
import { SEVERITY_LABEL } from "@/lib/security-severity";
import type { FindingView } from "@/lib/security-findings";
import type { SecuritySeverity } from "@prisma/client";

/** A small coloured chip for a finding's severity (#security-findings). */
export function SeverityChip({ severity }: { severity: SecuritySeverity }) {
  return (
    <span className={`security-severity security-severity--${severity} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold`}>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/**
 * The private half of a security finding on its issue or idea page
 * (#security-findings). Viewers who may see it get the real title, summary,
 * description and files; everyone else gets an explanation. Owners and admins
 * can publish it early.
 */
export function SecurityFindingPanel({ view, canDisclose, kind }: { view: FindingView; canDisclose: boolean; kind: "issue" | "idea" }) {
  if (view.disclosed) {
    return (
      <section aria-label="Security finding" className="security-panel security-panel--public rounded-2xl border border-zk-border bg-zk-surface p-4">
        <p className="flex flex-wrap items-center gap-2 text-sm text-zk-text2">
          <span className="font-semibold text-zk-text">Security finding</span>
          <SeverityChip severity={view.severity} />
          <span>
            Disclosed{view.disclosedAt ? <> <LocalTime date={view.disclosedAt} /></> : null}. Its details are now public below.
          </span>
          <Link href="/security" className="font-semibold text-zk-accent hover:underline">All findings</Link>
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Private security finding" className="security-panel rounded-2xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zk-text">
          <LockIcon />
          <span>Private security finding</span>
          <SeverityChip severity={view.severity} />
        </div>
        {canDisclose ? <DiscloseFindingButton findingId={view.id} /> : null}
      </div>
      {view.details ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-zk-text2">
            You can see this because you reported it, administer this workspace, or are cleared for security work.
            Everyone else sees only the placeholder until the fix is live. Don&apos;t paste these details into
            comments on this {kind}: comments are not private.
          </p>
          <h2 className="break-words text-lg font-bold text-zk-text">{view.details.title}</h2>
          {view.details.summary ? <p className="text-sm font-medium text-zk-text2">{view.details.summary}</p> : null}
          <RichText content={view.details.description} className="text-sm" />
          {view.details.attachments.length ? (
            <div className="pt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-zk-muted">Evidence</p>
              <ul className="mt-1 space-y-1 text-sm">
                {view.details.attachments.map((file) => (
                  <li key={file.id}>
                    <a href={`/api/attachments/${file.id}`} className="text-zk-accent hover:underline" target="_blank" rel="noreferrer">
                      {file.filename}
                    </a>{" "}
                    <span className="text-xs text-zk-muted">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zk-text2">
          The details of this {kind} are restricted to the person who reported it, this workspace&apos;s owners and admins,
          and agents cleared for security work. They will be published here once the fix is live.
        </p>
      )}
    </section>
  );
}
