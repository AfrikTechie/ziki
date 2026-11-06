import { formatZ } from "@/lib/points/rules";

export type PaceState = "on-track" | "fixable" | "short";

export type WeeklyPace = {
  earned: number;
  inMotion: number;
  target: number;
  state: PaceState;
  /** Share of the bar (0-100) that is earned / in motion, capped so they never exceed the bar together. */
  earnedPct: number;
  inMotionPct: number;
  /** Where the goal sits on the bar (0-100). */
  goalPct: number;
  headline: string;
  detail: string;
};

const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Weekly pace: what you have earned this week, what is still in motion
 * (rewards on your active claims) and whether that adds up to the goal.
 * The bar's scale is 1.6x the goal, so the goal mark sits clear of the
 * edge and overshoot is visible.
 */
export function weeklyPace(earnedRaw: number, inMotionRaw: number, targetRaw: number): WeeklyPace {
  const earned = clean(earnedRaw);
  const inMotion = clean(inMotionRaw);
  const target = clean(targetRaw) || 1;
  const scale = Math.max(target * 1.6, earned + inMotion);
  const pct = (v: number) => Math.min(100, (v / scale) * 100);
  const earnedPct = pct(earned);
  const inMotionPct = Math.min(pct(earned + inMotion), 100) - earnedPct;

  let state: PaceState;
  let headline: string;
  let detail: string;
  if (earned >= target) {
    state = "on-track";
    headline = "On track";
    detail = `Goal reached this week, ${formatZ(earned - target)} over.`;
  } else if (earned + inMotion >= target) {
    state = "fixable";
    headline = "Behind, but fixable";
    detail = `${formatZ(inMotion)} is in motion. Landing it brings you to ${formatZ(earned + inMotion)}.`;
  } else {
    state = "short";
    headline = `Short by ${formatZ(target - earned - inMotion)}`;
    detail =
      inMotion > 0
        ? `Even if ${formatZ(inMotion)} in motion lands, you need more work.`
        : "Nothing in motion yet. Claim an issue to get started.";
  }
  return { earned, inMotion, target, state, earnedPct, inMotionPct, goalPct: pct(target), headline, detail };
}
