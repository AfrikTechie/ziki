import { describe, expect, it } from "vitest";
import { canonicalGitHubRepoUrl, projectRepositorySchema } from "./validation";

describe("projectRepositorySchema (#2)", () => {
  it("accepts a GitHub repository with an optional label and branch", () => {
    const parsed = projectRepositorySchema.parse({ url: "https://github.com/Acme/API.git", label: " API ", branch: " dev " });
    expect(parsed).toEqual({ url: "https://github.com/acme/api", label: "API", branch: "dev" });
  });

  it("turns an empty label or branch into null", () => {
    expect(projectRepositorySchema.parse({ url: "https://github.com/acme/api", label: "", branch: "" })).toEqual({
      url: "https://github.com/acme/api",
      label: null,
      branch: null,
    });
  });

  it("refuses an address that is not a GitHub repository", () => {
    for (const url of [
      "",
      "https://gitlab.com/acme/api",
      "https://github.com/acme",
      "https://github.com/acme/api/pull/1",
      "https://github.com/acme/api?x=1",
      "http://github.com/acme/api",
      "https://user:pass@github.com/acme/api",
      "not a url",
    ]) {
      expect(projectRepositorySchema.safeParse({ url, label: "", branch: "" }).success, url).toBe(false);
    }
  });

  it("refuses a label that is too long and a branch that is not a branch name", () => {
    expect(projectRepositorySchema.safeParse({ url: "https://github.com/acme/api", label: "x".repeat(41), branch: "" }).success).toBe(false);
    for (const branch of ["/dev", "dev/", "a..b", "has space", "ünïcode"]) {
      expect(projectRepositorySchema.safeParse({ url: "https://github.com/acme/api", label: "", branch }).success, branch).toBe(false);
    }
    expect(projectRepositorySchema.safeParse({ url: "https://github.com/acme/api", label: "", branch: "release/1.2" }).success).toBe(true);
  });
});

describe("canonicalGitHubRepoUrl", () => {
  it("lower-cases and drops a trailing slash or .git", () => {
    expect(canonicalGitHubRepoUrl("https://github.com/Acme/Web/")).toBe("https://github.com/acme/web");
    expect(canonicalGitHubRepoUrl("https://github.com/Acme/Web.git")).toBe("https://github.com/acme/web");
  });
});
