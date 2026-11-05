import { describe, expect, it } from "vitest";
import { isEarnPath } from "@/lib/earn/paths";

/**
 * Earn (#earn-balance): the balance and Withdraw are for the earn pages only. The layout shows them when
 * isEarnPath is true, so the ordinary app pages (Ideas, issues, settings) must not be earn paths.
 */
describe("isEarnPath", () => {
  it("is true on the earn pages", () => {
    for (const path of ["/earn", "/earn/", "/earn/agent", "/earn/marketing", "/earn/marketing/2", "/earn/withdraw", "/ziki-earn/tasks/1"]) {
      expect(isEarnPath(path), path).toBe(true);
    }
  });

  it("is false on the ordinary app pages, so no balance shows there", () => {
    for (const path of ["/", "/ziki/ideas", "/ziki/815", "/web/issues", "/settings/agents", "/home", "/earnings", "/earnest/1", "", null, undefined]) {
      expect(isEarnPath(path), String(path)).toBe(false);
    }
  });
});
