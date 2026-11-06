import { EntrySummary } from "@/components/entry-summary";
import { LocalTime } from "@/components/local-time";
import { StepTitle } from "@/components/issue-timeline";
import { EntryReplies, type EntryReplyView } from "@/components/entry-replies";
import { EntryReplyForm } from "@/components/entry-reply-form";
import { DeliveredWork } from "@/components/marketing/delivered-work";

export type MarketingDeliveryView = {
  id: string;
  agentName: string;
  by: string;
  summary: string;
  description: string;
  deliverableText?: string | null;
  deliverableUrls?: string[];
  screenshots?: string[];
  testResults?: string | null;
  current: boolean;
  updatedAt: Date | string;
  replies: EntryReplyView[];
};

function formatDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

export function MarketingDeliverablesPanel({
  bugId,
  deliveries,
  isInProgress = false,
  workerName,
  canReply,
  at,
}: {
  bugId: string;
  deliveries: MarketingDeliveryView[];
  isInProgress?: boolean;
  workerName?: string | null;
  canReply: boolean;
  at?: Date | string | null;
}) {
  return (
    <section
      id="deliverables"
      aria-labelledby="deliverables-heading"
      className="scroll-mt-24"
      data-testid="marketing-deliverables"
    >
      <StepTitle
        id="deliverables-heading"
        title="Marketing Deliverables"
        count={deliveries.length}
        at={at}
      />

      {deliveries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zk-divider bg-zk-surface/50 p-6 text-center">
          <p className="m-0 text-sm font-medium text-zk-muted">
            {isInProgress
              ? `Work is in progress${workerName ? ` by ${workerName}` : ""}. Deliverables will appear here once submitted.`
              : "No deliverables submitted yet."}
          </p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {deliveries.map((delivery) => {
            const urls = delivery.deliverableUrls ?? [];
            const screenshots = delivery.screenshots ?? [];

            return (
              <li
                key={delivery.id}
                id={`delivery-${delivery.id}`}
                className="relative flex flex-col gap-3 rounded-xl border border-zk-ok-fg/20 bg-zk-ok-bg/30 p-4"
              >
                {/* Delivery Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zk-ok-fg/10 pb-2.5 pr-8">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-bold ${
                        delivery.current
                          ? "bg-zk-ok-fg text-white"
                          : "bg-zk-chip text-zk-text2"
                      }`}
                    >
                      {delivery.current ? "Delivered" : "Earlier Revision"}
                    </span>
                    <span className="font-semibold text-zk-text">
                      {delivery.agentName}
                    </span>
                    <span className="text-zk-muted">for {delivery.by}</span>
                  </div>
                  <span className="text-xs text-zk-muted">
                    <LocalTime date={delivery.updatedAt} />
                  </span>
                </div>

                {/* Summary & Description */}
                <div>
                  <h4 className="m-0 text-sm font-semibold text-zk-text">
                    {delivery.summary}
                  </h4>
                  <div className="mt-1">
                    <EntrySummary summary="" description={delivery.description} />
                  </div>
                </div>

                {/* The delivered work and its links */}
                {urls.length > 0 || delivery.deliverableText ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-zk-muted">
                      Delivered Links & Work
                    </span>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {delivery.deliverableText ? (
                        <DeliveredWork text={delivery.deliverableText} title={delivery.summary} from={`${delivery.agentName} for ${delivery.by}`} />
                      ) : null}
                      {urls.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-center justify-between gap-2 rounded-lg border border-zk-divider bg-zk-surface p-2.5 text-xs font-medium text-zk-text transition hover:border-teal-500 hover:bg-teal-50/50 dark:hover:bg-teal-950/20"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="rounded bg-teal-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-teal-800 dark:bg-teal-900/50 dark:text-teal-200">
                              {formatDomain(url)}
                            </span>
                            <span className="truncate text-zk-text group-hover:text-zk-accent">
                              {url}
                            </span>
                          </div>
                          <span className="text-zk-muted group-hover:text-zk-accent">↗</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Screenshots & Visual Evidence */}
                {screenshots.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-zk-muted">
                      Visual Proof
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {screenshots.map((src, i) => (
                        <a
                          key={i}
                          href={src}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-zk-divider bg-zk-surface transition hover:opacity-90"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt={`Deliverable proof ${i + 1}`}
                            className="h-20 w-32 object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Replies Thread */}
                <EntryReplies replies={delivery.replies} />
                {canReply ? (
                  <div className="mt-2 border-t border-zk-divider/50 pt-2">
                    <EntryReplyForm
                      bugId={bugId}
                      target={{ deliveryId: delivery.id }}
                      label="Leave feedback on this delivery"
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
