import { statusLabel, type FeatureStatus } from "@/lib/compare/catalog";

const MARK: Record<FeatureStatus, string> = {
  available: "✓",
  partial: "◐",
  not_available: "✕",
  not_verified: "?",
};

/** A status as a symbol and a word, so the meaning never rests on colour alone. */
export function StatusPill({ status }: { status: FeatureStatus }) {
  return (
    <span className={`cmp-status cmp-status-${status}`}>
      <span aria-hidden="true">{MARK[status]}</span>
      {statusLabel(status)}
    </span>
  );
}
