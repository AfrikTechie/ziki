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
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), updateSession: vi.fn() }));
vi.mock("@/lib/mail", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/mail")>();
  return { ...real, sendMail: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    userSession: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    loginHistory: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    securityAuditEvent: { create: vi.fn(async () => ({})) },
    passwordResetToken: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { auth, signOut, updateSession } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resetRateLimits } from "@/lib/rate-limit";
import { ACTIVE_ROLE_COOKIE_NAME } from "@/lib/roles";
import { SESSION_EXPIRED_MESSAGE, resolveSessionUserId } from "@/lib/session-user";
import { acceptedSessionRefresh, sessionRefreshFor } from "@/lib/session-refresh";
import { resetPasswordAction, signupAction } from "@/app/actions/auth";
import { signOutOtherSessionsAction, signOutSessionAction } from "@/app/actions/settings";
import {
  buildLoginHistoryCsv,
  legacySessionKey,
  maskIpAddress,
  parseRequestClient,
} from "@/lib/user-sessions";
import { GET as sessionExpired } from "@/app/session-expired/route";
import { isPublicPath } from "@/middleware";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  userSession: {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  loginHistory: { create: ReturnType<typeof vi.fn> };
  securityAuditEvent: { create: ReturnType<typeof vi.fn> };
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

describe("signed-out public project routes (#859)", () => {
  it.each([
    "/zedu/web",
    "/zedu/web/report",
    "/zedu/web/track/private-token",
    "/api/public/projects/zedu/web/ideas",
  ])("allows %s through session middleware", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it("does not make similarly named private routes public", () => {
    expect(isPublicPath("/projects/zedu/web")).toBe(false);
    expect(isPublicPath("/zedu/web/reporter")).toBe(false);
    expect(isPublicPath("/api/projects/zedu/web/ideas")).toBe(false);
  });
});

describe("active sessions and login history", () => {
  it("accepts an unrevoked tracked session and rejects a revoked one", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "a@x.dev", sessionVersion: 2, sessionId: "s-live" },
    });
    db.user.findUnique.mockResolvedValue({ id: "u1", sessionVersion: 2 });
    db.userSession.findUnique.mockResolvedValueOnce({
      id: "s-live",
      userId: "u1",
      sessionVersion: 2,
      revokedAt: null,
      lastActiveAt: new Date(),
    });
    await expect(resolveSessionUserId()).resolves.toEqual({ userId: "u1" });

    db.userSession.findUnique.mockResolvedValueOnce({
      id: "s-live",
      userId: "u1",
      sessionVersion: 2,
      revokedAt: new Date(),
      lastActiveAt: new Date(),
    });
    await expect(resolveSessionUserId()).resolves.toEqual({ error: SESSION_EXPIRED_MESSAGE });
  });

  it("revokes another active session on the account and refuses to revoke the current device", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", name: "Ada", email: "a@x.dev", role: "user", sessionVersion: 1, sessionId: "s-current" },
    });
    db.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Ada",
      email: "a@x.dev",
      image: null,
      role: "user",
      sessionVersion: 1,
    });
    db.userSession.findUnique.mockResolvedValue({
      id: "s-current",
      userId: "u1",
      sessionVersion: 1,
      revokedAt: null,
      lastActiveAt: new Date(),
    });
    db.userSession.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(signOutSessionAction("s-current")).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/this device/i),
    });

    await expect(signOutSessionAction("s-other")).resolves.toEqual({ ok: true });
    expect(db.userSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s-other", userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(db.securityAuditEvent.create).toHaveBeenCalledWith({
      data: { userId: "u1", type: "session.revoked" },
    });
  });

  it("bumps sessionVersion, revokes other sessions, keeps this device active, and refreshes the JWT", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-that-is-long-enough-for-hashing");
    mockAuth.mockResolvedValue({
      user: { id: "u1", name: "Ada", email: "a@x.dev", role: "user", sessionVersion: 4, sessionId: "s-current" },
    });
    db.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Ada",
      email: "a@x.dev",
      image: null,
      role: "user",
      sessionVersion: 4,
    });
    db.userSession.findUnique.mockResolvedValue({
      id: "s-current",
      userId: "u1",
      sessionVersion: 4,
      revokedAt: null,
      lastActiveAt: new Date(),
    });

    const txUserUpdate = vi.fn().mockResolvedValue({ sessionVersion: 5 });
    const txSessionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txAuditCreate = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: txUserUpdate },
        userSession: { updateMany: txSessionUpdateMany },
        securityAuditEvent: { create: txAuditCreate },
      }),
    );

    await expect(signOutOtherSessionsAction()).resolves.toEqual({ ok: true });
    expect(txUserUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    expect(txSessionUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: "u1", id: { not: "s-current" }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(txSessionUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "s-current", userId: "u1" },
      data: { sessionVersion: 5, lastActiveAt: expect.any(Date), revokedAt: null },
    });
    expect(updateSession).toHaveBeenCalledTimes(1);
    // Must not revalidate inside the same POST before Set-Cookie reaches the browser.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("masks IPs, parses client hints, and neutralises spreadsheet formulas in CSV export", () => {
    expect(maskIpAddress("102.89.44.19")).toBe("102.89.xx.xx");
    expect(maskIpAddress("2001:0db8:85a3::8a2e:0370:7334")).toBe("2001:0db8::xxxx");

    const win11 = parseRequestClient(
      new Headers({
        "x-forwarded-for": "102.89.44.19",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-platform-version": '"15.0.0"',
        "cf-ipcity": "Ikorodu",
        "cf-region": "Lagos",
        "cf-ipcountry": "NG",
      }),
    );
    expect(win11.sessionDevice).toBe("Chrome on Windows 11");
    expect(win11.historyDevice).toBe("Chrome · Windows 11");
    expect(win11.deviceType).toBe("laptop");
    expect(win11.maskedIp).toBe("102.89.xx.xx");
    expect(win11.sessionLocation).toBe("Ikorodu, Lagos, Nigeria");
    expect(win11.historyLocation).toBe("Ikorodu, NG");

    const android = parseRequestClient(
      new Headers({
        "x-forwarded-for": "105.112.10.4",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14; Oppo) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        "cf-ipcity": "Ikorodu",
        "cf-ipcountry": "NG",
      }),
    );
    expect(android.sessionDevice).toBe("Chrome on Android (Oppo)");
    expect(android.deviceType).toBe("mobile");

    const csv = buildLoginHistoryCsv([
      {
        createdAt: new Date("2026-11-04T09:37:00.000Z"),
        status: "failed_password",
        device: "=CMD|' /C calc'!A0",
        ipAddress: "45.134.xx.xx",
        location: "Amsterdam, NL",
      },
    ]);
    expect(csv).toContain(`"Nov 4, 2026 · 09:37","Failed · wrong password","'=CMD|' /C calc'!A0","45.134.xx.xx","Amsterdam, NL"`);

    // Next.js 16's `await headers()` returns a HeadersAdapter proxy where `"headers" in h` is true
    // and `h.headers` is a plain IncomingHttpHeaders object without `.get()`.
    vi.stubEnv("AUTH_SECRET", "test-secret-that-is-long-enough-for-hashing");
    const rawNextHeaders = new Headers({
      host: "localhost:3001",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
    });
    const nextReadonlyHeaders = new Proxy(rawNextHeaders, {
      has(target, prop) {
        return prop === "headers" || prop in target;
      },
      get(target, prop) {
        if (prop === "headers") return { host: "localhost:3001" };
        const val = Reflect.get(target, prop, target);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
    const parsedProxy = parseRequestClient(nextReadonlyHeaders);
    expect(parsedProxy.maskedIp).toBe("127.0.xx.xx");
    expect(parsedProxy.sessionLocation).toBe("Local network");
    expect(legacySessionKey("u1", nextReadonlyHeaders)).toMatch(/^[0-9a-f]{64}$/);
  });
});
