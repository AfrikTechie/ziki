import { LocalTime } from "@/components/local-time";
import { HeartbeatReopenAlert } from "@/components/heartbeat-reopen-alert";
import type { HoldVia, IssueHold } from "@/lib/issue-holders";

const VIA_TEXT: Record<HoldVia, string> = {
  bid: "won its bid",
  assigned: "assigned",
  offer: "accepted an offer",
  claim: "claimed it",
};

function viaText(hold: IssueHold): string {
  return hold.via === "assigned" && hold.dispatcherName ? `assigned by ${hold.dispatcherName}` : VIA_TEXT[hold.via];
}

function BigIcon({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-electric-blue-strong text-white">
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

/**
 * Who has the issue, on its own above the Conversation: the agent whose
 * active claim holds it. The page shows it only for an active claim; a
 * pending offer is in the next-step bar alone, and an Open issue nobody has
 * says so in its bids panel. Earlier holders aren't listed: offers that lapsed
 * and released claims only crowded it. Read from the claims (`IssueClaim`),
 * the one record of who has the work.
 */
export function AwardBox({ hold, agentPaused, bugId, isWatching, isIssueOwner }: { hold: IssueHold; agentPaused: boolean; bugId: string; isWatching: boolean; isIssueOwner: boolean }) {
  return (
    <section aria-labelledby="award-heading" data-testid="award-box">
      <div className="flex items-start gap-3.5 rounded-2xl border-2 border-electric-blue-strong bg-zk-tint px-4 py-3.5">
        <BigIcon>
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
          <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
        </BigIcon>
        <div className="min-w-0">
          <h3 id="award-heading" className="m-0 text-base font-extrabold text-zk-text">
            Awarded to {hold.agentName}
          </h3>
          <p className="m-0 mt-0.5 text-[13px] text-zk-text2">
            For {hold.personName} · {viaText(hold)}
            {hold.claimedAt ? (
              <>
                {" "}· claimed <LocalTime date={hold.claimedAt} />
              </>
            ) : null}
            {hold.deliverBy ? (
              <>
                {" "}· due <LocalTime date={hold.deliverBy} />
              </>
            ) : null}
          </p>
        </div>
      </div>
      {hold.hasPullRequest ? (
        <p className="mt-3 rounded-xl border border-zk-border bg-zk-surface px-4 py-3 text-sm text-zk-text2">Fix submitted · waiting for review.</p>
      ) : (
        <HeartbeatReopenAlert
          bugId={bugId}
          releaseAt={hold.releaseAt?.toISOString() ?? null}
          isWatching={isWatching}
          isIssueOwner={isIssueOwner}
          paused={hold.waitingOnOwner}
          agentPaused={agentPaused}
        />
      )}
    </section>
  );
}
