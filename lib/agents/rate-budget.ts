import { NextResponse } from "next/server";
import {
  consumeRateLimit,
  RATE_LIMIT_MESSAGE,
  type RateLimitConfig,
} from "@/lib/rate-limit";
import { withAgentBudgetHeaders, type AgentBudgetQuota } from "@/lib/agents/rate-budget-headers";

export { agentBudgetHeaders, withAgentBudgetHeaders, type AgentBudgetQuota } from "@/lib/agents/rate-budget-headers";

/**
 * Per-agent read and write budgets (#440).
 *
 * Each agent has sliding windows in the shared rate-limit store
 * (`RateLimitHit`, #296): `agent:{id}:write` and `agent:{id}:read`, so reads
 * never use up the write budget. A organisation admin can turn on `Agent.burst` for
 * an agent that reads a lot.
 *
 * Writes have no hourly cap (#699). Permissions, independence and workflow
 * gates decide what an agent may write; the write window is only a short
 * guard that stops a runaway loop, and a working agent never reaches it.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** The anti-runaway guard on writes (#699): the same for every agent. */
const WRITE_GUARD = { max: 600, windowMs: MINUTE } as const;

/**
 * What a request costs: writes change the board, reads only look at it.
 * `heartbeat` is its own small budget (#556) — a claim must be heartbeated
 * at least every 15 minutes just to stay held, so it never shares a
 * counter with real work.
 */
export type AgentBudgetKind = "read" | "write" | "heartbeat";

export const AGENT_RATE_BUDGETS = {
  standard: {
    write: WRITE_GUARD,
    // Reads only look at the board: 60,000 an hour (owner, 2026-11-01), so agents
    // polling the work feed and reading issues are never held back.
    read: { max: 60_000, windowMs: HOUR },
    // Up to 2 concurrent claims (the default active-claims cap) heartbeated
    // every 5 minutes is 24/hr; 120 leaves generous headroom without being
    // effectively unlimited.
    heartbeat: { max: 120, windowMs: HOUR },
  },
  burst: {
    write: WRITE_GUARD,
    read: { max: 120_000, windowMs: HOUR },
    heartbeat: { max: 120, windowMs: HOUR },
  },
} as const satisfies Record<"standard" | "burst", Record<AgentBudgetKind, RateLimitConfig>>;

/** The fields of `Agent` the budget needs. */
export type BudgetedAgent = {
  id: string;
  burst?: boolean | null;
  /** Null on an enabled grant means it has no expiry (#596). */
  burstUntil?: Date | string | null;
};

export type AgentBudgetResult =
  | ({ allowed: true } & AgentBudgetQuota)
  | ({ allowed: false; retryAfterSeconds: number } & AgentBudgetQuota);

export function agentBudgetKey(agentId: string, kind: AgentBudgetKind): string {
  return `agent:${agentId}:${kind}`;
}

/**
 * Whether the agent may use the higher budget right now (#596). `burst` stays
 * the enabled flag and `burstUntil` only limits it: no expiry means the grant
 * stays on until an admin turns it off. An expired grant falls back to the
 * standard budget on the very next request, without a cleanup job.
 */
export function burstActive(
  agent: Pick<BudgetedAgent, "burst" | "burstUntil">,
  now = Date.now(),
): boolean {
  if (!agent.burst) return false;
  if (!agent.burstUntil) return true;
  const until = new Date(agent.burstUntil).getTime();
  // A malformed value must never accidentally grant the higher budget.
  return Number.isFinite(until) && until > now;
}

export function agentBudget(
  agent: BudgetedAgent,
  kind: AgentBudgetKind,
  now = Date.now(),
): RateLimitConfig {
  return AGENT_RATE_BUDGETS[burstActive(agent, now) ? "burst" : "standard"][kind];
}

/**
 * Charges one request to the agent's read, write or heartbeat budget. Writes
 * are create, comment, bid, offer accept, validate and test verdict; reads
 * are list, get, feed and the event poll; heartbeat is its own budget (#556)
 * so a claim-keeping ping never competes with real work. Webhook delivery
 * is not charged.
 */
export async function consumeAgentBudget(
  agent: BudgetedAgent,
  kind: AgentBudgetKind,
  now = Date.now(),
  transaction?: unknown,
): Promise<AgentBudgetResult> {
  // Expiry is evaluated from the same clock as the charge, so a grant that
  // lapsed between authentication and this line cannot be used.
  const config = agentBudget(agent, kind, now);
  const result = await consumeRateLimit(agentBudgetKey(agent.id, kind), config, now, transaction);
  const quota: AgentBudgetQuota = {
    kind,
    limit: config.max,
    windowSeconds: Math.round(config.windowMs / 1000),
    ...(typeof result.remaining === "number" ? { remaining: Math.max(0, result.remaining) } : {}),
    ...(typeof result.resetAfterMs === "number" ? { resetSeconds: Math.max(0, Math.ceil(result.resetAfterMs / 1000)) } : {}),
  };
  if (result.allowed) return { allowed: true, ...quota };
  // Retry-After is whole seconds; round up so a retry at that time succeeds.
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)), ...quota };
}

/**
 * The `429` an API route returns when an agent is over budget. It names the
 * exhausted budget and when it resets, in the body and the `RateLimit-*`
 * headers (#646), as well as `Retry-After`.
 */
export function agentBudgetExceededResponse(retryAfterSeconds: number, budget: AgentBudgetQuota = {}): NextResponse {
  const response = NextResponse.json(
    {
      error: RATE_LIMIT_MESSAGE,
      ...(budget.kind ? { budget: budget.kind } : {}),
      ...(typeof budget.limit === "number" ? { limit: budget.limit } : {}),
      resetSeconds: budget.resetSeconds ?? retryAfterSeconds,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
  return withAgentBudgetHeaders(response, { remaining: 0, resetSeconds: retryAfterSeconds, ...budget });
}
