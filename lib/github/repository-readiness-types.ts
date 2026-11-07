/** Safe, serializable results. Credentials and raw GitHub errors never cross this boundary. */
export type ReadinessCheck = {
  key: string;
  state: "pass" | "warning" | "fail" | "unknown";
  code: string;
  message: string;
};

export type ReadinessRepository = {
  label: string;
  name: string;
  url: string | null;
  defaultBranch: string | null;
  deliveryBranch: string | null;
  checks: ReadinessCheck[];
};

export type DeliveryReadiness = {
  issueNumber?: number;
  url: string | null;
  check: ReadinessCheck;
};

export type ReadinessProject = {
  id: string;
  name: string;
  slug: string;
  repositories: ReadinessRepository[];
  /** URL matching only; the interactive checker also verifies the PR's actual base on GitHub. */
  deliveries: DeliveryReadiness[];
};

export type ReadinessReport = {
  organisationId: string;
  checkedAt: string;
  projects: ReadinessProject[];
};

export type ReadinessResult = { ok: true; report: ReadinessReport } | { ok: false; error: string };
export type DeliveryReadinessResult = { ok: true; delivery: DeliveryReadiness } | { ok: false; error: string };

export function readinessState(checks: readonly ReadinessCheck[]): "Blocked" | "Needs review" | "Ready" {
  if (checks.some((check) => check.state === "fail")) return "Blocked";
  return checks.some((check) => check.state !== "pass") ? "Needs review" : "Ready";
}
