import { LocalTime } from "@/components/local-time";
import { DecisionActions } from "@/components/decision-actions";
import type { YourDecision } from "@/lib/your-decision";

/**
 * "A decision about your work" (#your-decisions): shown on an issue to the
 * person it belongs to when other members' votes closed it. It answers what
 * was decided, who decided it, why and with what evidence, and lets them
 * agree or appeal. Once they agree it folds to one line.
 */
export function DecisionCard({ issueId, decision }: { issueId: string; decision: YourDecision }) {
  if (decision.agreedAt) {
    return (
      <p
        data-testid="decision-agreed"
        className="m-0 rounded-2xl border border-zk-border bg-zk-surface px-4 py-2.5 text-[13px] text-zk-text2"
      >
        <b className="font-semibold text-zk-text">{decision.headline}.</b> You agreed with this decision{" "}
        <LocalTime date={decision.agreedAt} />.
      </p>
    );
  }
  return (
    <section
      id="your-decision"
      aria-labelledby="your-decision-heading"
      data-testid="decision-card"
      className="scroll-mt-24 rounded-2xl border-2 border-zk-warn-fg/40 bg-zk-surface px-4 py-3"
    >
      <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-zk-warn-fg">A decision about your work</p>
      <h2 id="your-decision-heading" className="m-0 mt-1 text-[15px] font-extrabold leading-snug text-zk-text">
        {decision.headline}
      </h2>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-zk-muted">Who decided</dt>
        <dd className="m-0 text-zk-text">
          {decision.votes} of {decision.threshold} votes:{" "}
          {decision.voters.map((voter, index) => (
            <span key={`${voter.by}-${index}`}>
              {index > 0 ? ", " : ""}
              <b className="font-semibold">{voter.by}</b>
              {voter.agentName ? <span className="text-zk-text2"> via {voter.agentName}</span> : null}
            </span>
          ))}
        </dd>
        {decision.why ? (
          <>
            <dt className="text-zk-muted">Their reason</dt>
            <dd className="m-0 text-zk-text">{decision.why}</dd>
          </>
        ) : null}
        {decision.evidence ? (
          <>
            <dt className="text-zk-muted">Evidence given</dt>
            <dd className="m-0 break-words text-zk-text2">{decision.evidence}</dd>
          </>
        ) : null}
        {decision.decidedAt ? (
          <>
            <dt className="text-zk-muted">When</dt>
            <dd className="m-0 text-zk-text2">
              <LocalTime date={decision.decidedAt} />
            </dd>
          </>
        ) : null}
      </dl>
      <DecisionActions issueId={issueId} reopenable={decision.reopenable} />
    </section>
  );
}
