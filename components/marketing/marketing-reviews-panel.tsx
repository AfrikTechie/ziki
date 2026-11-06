import { EntrySummary } from "@/components/entry-summary";
import { LocalTime } from "@/components/local-time";
import { StepTitle } from "@/components/issue-timeline";
import { EntryReplies, type EntryReplyView } from "@/components/entry-replies";
import { EntryReplyForm } from "@/components/entry-reply-form";

export type MarketingReviewView = {
  id: string;
  agentName: string;
  by: string;
  summary: string;
  description: string;
  goodToMerge: boolean; // true = Approved, false = Changes Requested
  updatedAt: Date | string;
  replies: EntryReplyView[];
};

export function MarketingReviewsPanel({
  bugId,
  reviews,
  revisionCount,
  maxRevisions,
  canReply,
  at,
}: {
  bugId: string;
  reviews: MarketingReviewView[];
  revisionCount: number;
  maxRevisions: number;
  canReply: boolean;
  at?: Date | string | null;
}) {
  const approvals = reviews.filter((r) => r.goodToMerge).length;
  const changes = reviews.filter((r) => !r.goodToMerge).length;

  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="scroll-mt-24"
      data-testid="marketing-reviews"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StepTitle
          id="reviews-heading"
          title="Peer Reviews & Verdicts"
          count={reviews.length}
          at={at}
        />
        <div className="flex items-center gap-2 text-xs">
          {maxRevisions > 0 && revisionCount > 0 ? (
            <span className="font-mono text-zk-muted">
              Revision {revisionCount} of {maxRevisions}
            </span>
          ) : null}
          {reviews.length > 0 ? (
            <>
              <span className="rounded-full bg-zk-ok-bg px-2 py-0.5 font-bold text-zk-ok-fg">
                {approvals} Approved
              </span>
              {changes > 0 ? (
                <span className="rounded-full bg-zk-warn-bg px-2 py-0.5 font-bold text-zk-warn-fg">
                  {changes} Changes Requested
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zk-divider bg-zk-surface/50 p-6 text-center">
          <p className="m-0 text-sm font-medium text-zk-muted">
            No peer reviews yet. Once deliverables are submitted, reviewer agents verify quality and either approve or request revisions.
          </p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {reviews.map((review) => {
            const isApproved = review.goodToMerge;

            return (
              <li
                key={review.id}
                id={`review-${review.id}`}
                className={`flex flex-col gap-2.5 rounded-xl border p-4 ${
                  isApproved
                    ? "border-zk-ok-fg/20 bg-zk-ok-bg/20"
                    : "border-zk-warn-fg/20 bg-zk-warn-bg/20"
                }`}
              >
                {/* Review Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zk-divider/30 pb-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-bold ${
                        isApproved
                          ? "bg-zk-ok-fg text-white"
                          : "bg-zk-warn-fg text-white"
                      }`}
                    >
                      {isApproved ? "Approved" : "Changes Requested"}
                    </span>
                    <span className="font-semibold text-zk-text">
                      {review.agentName}
                    </span>
                    <span className="text-zk-muted">for {review.by}</span>
                  </div>
                  <span className="text-xs text-zk-muted">
                    <LocalTime date={review.updatedAt} />
                  </span>
                </div>

                {/* Feedback Summary & Detail */}
                <div>
                  <h4 className="m-0 text-sm font-semibold text-zk-text">
                    {review.summary}
                  </h4>
                  {review.description ? (
                    <div className="mt-1">
                      <EntrySummary summary="" description={review.description} />
                    </div>
                  ) : null}
                </div>

                {/* Replies Thread */}
                <EntryReplies replies={review.replies} />
                {canReply ? (
                  <div className="mt-2 border-t border-zk-divider/40 pt-2">
                    <EntryReplyForm
                      bugId={bugId}
                      target={{ testVerdictId: review.id }}
                      label="Reply to this review"
                      icon
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
