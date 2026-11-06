import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Sessions: sign-up and reset don't leak accounts, a reset or role change
 * ends older sessions (#208, #347), a refresh can't be forged (#389), and the
 * expired-session route signs the person out.
 */
const { deleteCookieMock } = vi.hoisted(() => ({ deleteCookieMock: vi.fn() }));
const middleware = vi.hoisted(() => ({ handler: null as null | ((request: NextRequest & { auth?: { user: { id: string } } }) => Response) }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: deleteCookieMock, get: vi.fn(), set: vi.fn() })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
  default: () => ({ auth: (handler: NonNullable<typeof middleware.handler>) => { middleware.handler = handler; return handler; } }),
}));
vi.mock("@/auth.config", () => ({ default: {} }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/mail", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/mail")>();
  return { ...real, sendMail: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    passwordResetToken: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resetRateLimits } from "@/lib/rate-limit";
import { ACTIVE_ROLE_COOKIE_NAME } from "@/lib/roles";
import { SESSION_EXPIRED_MESSAGE, resolveSessionUserId } from "@/lib/session-user";
import { acceptedSessionRefresh, sessionRefreshFor } from "@/lib/session-refresh";
import { resetPasswordAction, signupAction } from "@/app/actions/auth";
import { GET as sessionExpired } from "@/app/session-expired/route";
import "@/middleware";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  passwordResetToken: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.stubEnv("AUTH_PASSWORD_LOGIN", "true");
  vi.stubEnv("RATE_LIMIT_STORE", "memory");
});
afterEach(() => vi.unstubAllEnvs());

describe("session versions", () => {
  it("accepts a session issued at the current version", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "a@x.dev", sessionVersion: 3 } });
    db.user.findUnique.mockResolvedValue({ id: "u1", sessionVersion: 3 });
    await expect(resolveSessionUserId()).resolves.toEqual({ userId: "u1" });
  });

  it("rejects a session issued before a password reset or role change", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "a@x.dev", sessionVersion: 1 } });
    db.user.findUnique.mockResolvedValue({ id: "u1", sessionVersion: 2 });
    await expect(resolveSessionUserId()).resolves.toEqual({ error: SESSION_EXPIRED_MESSAGE });
  });

  it("fails closed when the lookup throws", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "a@x.dev", sessionVersion: 1 } });
    db.user.findUnique.mockRejectedValue(new Error("database connection error"));
    await expect(resolveSessionUserId()).resolves.toEqual({ error: SESSION_EXPIRED_MESSAGE });
  });
});

describe("session refresh after a two-factor change", () => {
  const NOW = 1_800_000_000_000;
  const token = { id: "u1", sv: 2 };

  it("moves the token at the old version to the new one, for a minute", () => {
    const refresh = sessionRefreshFor("u1", 3, NOW);
    expect(acceptedSessionRefresh(token, { sessionRefresh: refresh }, NOW)).toBe(3);
    expect(acceptedSessionRefresh(token, { sessionRefresh: refresh }, NOW + 61_000)).toBeNull();
  });

  it("won't revive a stale token, move another person's, or accept a forged refresh", () => {
    const refresh = sessionRefreshFor("u1", 3, NOW);
    expect(acceptedSessionRefresh({ id: "u1", sv: 1 }, { sessionRefresh: refresh }, NOW)).toBeNull();
    expect(acceptedSessionRefresh({ id: "u2", sv: 2 }, { sessionRefresh: refresh }, NOW)).toBeNull();
    const forged = { userId: "u1", from: 2, to: 3, expires: NOW + 1000, proof: "00".repeat(32) };
    expect(acceptedSessionRefresh(token, { sessionRefresh: forged }, NOW)).toBeNull();
    expect(acceptedSessionRefresh(token, { sessionRefresh: { ...refresh, expires: NOW + 10 ** 9 } }, NOW)).toBeNull();
  });
});

describe("password reset and sign-up", () => {
  const resetToken = "a".repeat(64);
  const input = () => form({ token: resetToken, password: "NewPassw0rd!", confirmPassword: "NewPassw0rd!" });
  const liveToken = { id: "t1", userId: "u1", usedAt: null, expiresAt: new Date(Date.now() + 60_000) };

  it("refuses a reset token another request already claimed", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(liveToken);
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ passwordResetToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), deleteMany: vi.fn() }, user: { update: vi.fn() } }),
    );
    expect((await resetPasswordAction(undefined, input()))?.error).toEqual(expect.any(String));
  });

  it("ends every other session and revokes the person's agent keys on reset", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(liveToken);
    const userUpdate = vi.fn();
    const revokeKeys = vi.fn().mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        passwordResetToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn() },
        user: { update: userUpdate },
        agentApiKey: { updateMany: revokeKeys },
      }),
    );
    await expect(resetPasswordAction(undefined, input())).rejects.toMatchObject({ to: "/login" });
    expect(userUpdate.mock.calls[0][0].data.sessionVersion).toEqual({ increment: 1 });
    expect(revokeKeys).toHaveBeenCalledWith({ where: { revokedAt: null, agent: { ownerUserId: "u1" } }, data: { revokedAt: expect.any(Date) } });
  });

  it("doesn't confirm that an email already has an account", async () => {
    const { Prisma } = await import("@prisma/client");
    db.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "6" }));
    const result = await signupAction(undefined, form({ name: "Bob", email: "bob@zendor.dev", password: "Passw0rd!234", confirmPassword: "Passw0rd!234" }));
    expect(result?.error).toEqual(expect.any(String));
    expect(result?.error).not.toMatch(/already exists/);
  });
});

describe("logout of an expired session", () => {
  it("clears the active role and signs out to the login page", async () => {
    await sessionExpired();
    expect(deleteCookieMock).toHaveBeenCalledWith(ACTIVE_ROLE_COOKIE_NAME);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/login?expired=1" });
  });
});

describe("shared issue login destinations", () => {
  it("retains issue query parameters through login", () => {
    const response = middleware.handler!(new NextRequest("https://ziki.dev/ziki/app/482?comment=c42&view=all"));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("callbackUrl")).toBe("/ziki/app/482?comment=c42&view=all");
  });

  it.each(["https://evil.test", "//evil.test", "/login?callbackUrl=/login"])("rejects unsafe or looping callbacks for a signed-in person: %s", (value) => {
    const request = Object.assign(new NextRequest(`https://ziki.dev/login?callbackUrl=${encodeURIComponent(value)}`), { auth: { user: { id: "u" } } });
    expect(new URL(middleware.handler!(request).headers.get("location")!).pathname).toBe("/home");
  });

  it("returns a signed-in person to their original issue", () => {
    const request = Object.assign(new NextRequest("https://ziki.dev/login?callbackUrl=%2Fziki%2Fapp%2F482%3Fcomment%3Dc42"), { auth: { user: { id: "u" } } });
    expect(middleware.handler!(request).headers.get("location")).toBe("https://ziki.dev/ziki/app/482?comment=c42");
  });
});
