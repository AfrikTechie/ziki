import type { SecuritySeverity } from "@prisma/client";

/**
 * Severity levels for private security findings (#security-findings). Plain
 * data with no server imports, so the report form can use it in the browser.
 */

export const SECURITY_SEVERITIES = ["critical", "high", "medium", "low"] as const satisfies readonly SecuritySeverity[];

export const SEVERITY_LABEL: Record<SecuritySeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** One line each, shown next to the severity picker so reporters choose consistently. */
export const SEVERITY_GUIDE: Record<SecuritySeverity, string> = {
  critical: "Anyone can take over accounts, read or change other organisations' data, or run code on the server.",
  high: "A signed-in user can reach data or actions they should not, such as another organisation's records or secrets.",
  medium: "A real weakness that needs extra conditions to exploit, such as a specific role or a user's mistake.",
  low: "Hardening: a missing header, verbose error or similar issue with little direct impact.",
};

export function isSecuritySeverity(value: unknown): value is SecuritySeverity {
  return typeof value === "string" && (SECURITY_SEVERITIES as readonly string[]).includes(value);
}
