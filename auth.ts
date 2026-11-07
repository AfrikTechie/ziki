import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { headers } from "next/headers";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/issue";
import authConfig from "@/auth.config";
import { cleanEnv } from "@/lib/env-clean";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { upsertGoogleUser, type GoogleAccount } from "@/lib/google-user";
import { isGoogleEmailAllowed, getGoogleAllowlist } from "@/lib/google-allowlist";
import { clientIpFrom, consumeAuthRateLimit } from "@/lib/rate-limit";
import { TwoFactorInvalidError, TwoFactorRequiredError } from "@/lib/auth-errors";
import { isTwoFactorEnabled, verifySecondFactor } from "@/lib/two-factor";
import { googleSignInBlockedByTwoFactor } from "@/lib/google-two-factor";
import { acceptedSessionRefresh } from "@/lib/session-refresh";
import { recordSignInFailure, recordSignInSuccess } from "@/lib/user-sessions";

const googleClientId = cleanEnv(
  process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID,
);
const googleClientSecret = cleanEnv(
  process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET,
);
const googleConfigured = Boolean(googleClientId) && Boolean(googleClientSecret);
// Google-only in production; see lib/auth-mode.ts for the AUTH_PASSWORD_LOGIN flag.
const passwordAuthEnabled = isPasswordAuthEnabled();

if (process.env.NODE_ENV !== "test") {
  console.log("[auth:config] Initializing NextAuth with Google OAuth status:", {
    googleConfigured,
    passwordAuthEnabled,
    clientIdPresent: Boolean(googleClientId),
    clientSecretPresent: Boolean(googleClientSecret),
    clientIdPrefix: googleClientId ? `${googleClientId.slice(0, 12)}…` : "none",
  });
  if (googleConfigured && !getGoogleAllowlist().configured) {
    console.warn(
      "[auth:config] GOOGLE_ALLOWED_EMAILS / GOOGLE_ALLOWED_DOMAINS are not set — " +
        "any Google account can sign in and be auto-provisioned (#223). " +
        "Set an allowlist before exposing this deployment publicly.",
    );
  }
}

export const { handlers, auth, signIn, signOut, unstable_update: updateSession } = NextAuth({
  ...authConfig,
  providers: [
    ...(googleConfigured
      ? [
          Google({
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
          }),
        ]
      : []),

    ...(passwordAuthEnabled
      ? [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "Authenticator or backup code", type: "text" },
      },
      async authorize(credentials, request) {
        if (!isPasswordAuthEnabled()) {
          return null;
        }
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        // Per-email and per-IP limit on password attempts (#207). Every
        // password sign-in comes through here, whichever entry point it used.
        // Shared across instances (#296).
        const limit = await consumeAuthRateLimit("login", {
          email: parsed.data.email,
          ip: request ? clientIpFrom(request) : null,
        });
        if (!limit.allowed) {
          console.warn("[auth] password sign-in rate limited", { email: parsed.data.email });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });

        if (!user?.passwordHash) {
          return null;
        }

        const reqHeaders =
          request?.headers ?? (await headers().catch(() => null));

        const valid = await compare(
          parsed.data.password,
          user.passwordHash,
        );
        if (!valid) {
          await recordSignInFailure({
            userId: user.id,
            status: "failed_password",
            headers: reqHeaders,
          });
          return null;
        }

        // Second step (#648). Only reached with the right password, so these
        // errors say nothing to someone guessing passwords. The check lives
        // here, not in the form, so a direct POST to the credentials callback
        // cannot skip it.
        if (await isTwoFactorEnabled(user.id)) {
          const code = typeof credentials?.totp === "string" ? credentials.totp : "";
          if (!code.trim()) throw new TwoFactorRequiredError();
          if (!(await verifySecondFactor(user.id, code))) {
            await recordSignInFailure({
              userId: user.id,
              status: "failed_two_factor",
              headers: reqHeaders,
            });
            throw new TwoFactorInvalidError();
          }
        }

        const sessionId = await recordSignInSuccess({
          userId: user.id,
          sessionVersion: user.sessionVersion,
          headers: reqHeaders,
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          sessionVersion: user.sessionVersion,
          ...(sessionId ? { sessionId } : {}),
        };
      },
    }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      const email =
        (typeof user?.email === "string" && user.email) || null;
      if (!isGoogleEmailAllowed(email)) {
        const allowlist = getGoogleAllowlist();
        console.warn(
          `[auth] Google sign-in denied for ${email}: ` +
            (allowlist.configured
              ? "address is not on GOOGLE_ALLOWED_EMAILS / GOOGLE_ALLOWED_DOMAINS"
              : "no allowlist configured but email is missing"),
        );
        return false;
      }
      // Password accounts with two-factor on must use email, password, and the
      // code. Google must not open the session by itself (#388).
      if (email && (await googleSignInBlockedByTwoFactor(email))) {
        console.warn(`[auth] Google sign-in refused for ${email}: two-factor is on`);
        const blockedUser = await prisma.user
          .findUnique({ where: { email: email.toLowerCase() }, select: { id: true } })
          .catch(() => null);
        if (blockedUser) {
          await recordSignInFailure({
            userId: blockedUser.id,
            status: "failed_2fa_required",
            headers: await headers().catch(() => null),
          });
        }
        return "/login?error=TwoFactor";
      }
      return true;
    },
    async jwt({ token, user, account, profile, trigger, session }) {
      if (account?.provider === "google") {
        const email =
          typeof profile?.email === "string"
            ? profile.email.toLowerCase()
            : typeof user?.email === "string"
              ? user.email.toLowerCase()
              : null;
        if (email) {
          // Defence in depth (#223): the signIn callback should already have
          // denied disallowed addresses, but never reach the upsert without
          // an explicit allowlist pass.
          if (!isGoogleEmailAllowed(email)) {
            throw new Error(
              `Google sign-in denied for ${email}: not on the allowlist`,
            );
          }
          if (await googleSignInBlockedByTwoFactor(email)) {
            throw new Error(
              `Google sign-in refused for ${email}: two-factor is enabled`,
            );
          }
          const name =
            (typeof profile?.name === "string" && profile.name) ||
            user?.name ||
            email.split("@")[0];
          const image =
            (typeof profile?.picture === "string" && profile.picture) ||
            (typeof user?.image === "string" ? user.image : undefined);
          // Google's own verified-email claim drives safe linking (#736).
          const emailVerified =
            typeof profile?.email_verified === "boolean"
              ? profile.email_verified
              : false;

          let dbUser: GoogleAccount | null = null;
          let lastError: unknown;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              dbUser = await upsertGoogleUser({ email, name, image, emailVerified });
              break;
            } catch (dbError) {
              lastError = dbError;
              console.error(`[auth] Google user save attempt ${attempt} failed:`, dbError);
              if (attempt < 3) {
                await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
              }
            }
          }

          if (!dbUser) {
            throw lastError instanceof Error
              ? lastError
              : new Error("Google sign-in could not save the user");
          }

          const googleSessionId = await recordSignInSuccess({
            userId: dbUser.id,
            sessionVersion: dbUser.sessionVersion,
            headers: await headers().catch(() => null),
          });

          token.email = email;
          token.name = dbUser.name || name;
          token.id = dbUser.id;
          token.sub = dbUser.id;
          token.role = dbUser.role;
          token.sv = dbUser.sessionVersion;
          if (googleSessionId) {
            token.sid = googleSessionId;
          }
          return token;
        }
      }

      if (user?.id) {
        token.id = user.id;
        token.sub = user.id;
      }
      if (user?.role) {
        token.role = user.role;
      }
      if (typeof user?.sessionVersion === "number") {
        token.sv = user.sessionVersion;
      }
      if (typeof user?.sessionId === "string" && user.sessionId) {
        token.sid = user.sessionId;
      }

      // The session that signed the others out keeps working (Ziki #389). Only a
      // server-signed refresh moves the version; see lib/session-refresh.ts.
      if (trigger === "update") {
        const refreshed = acceptedSessionRefresh(token, session);
        if (refreshed !== null) {
          token.sv = refreshed;
          const refreshedSid = (session as { sessionId?: unknown } | null | undefined)?.sessionId;
          if (!token.sid && typeof refreshedSid === "string" && refreshedSid) {
            token.sid = refreshedSid;
          }
        }
      }

      // Keep a stale token (#655). Edge middleware never reads the database, so
      // dropping the session here leaves the cookie in place and /login bounces
      // straight back to /home. requireUser compares sessionVersion and role,
      // then /session-expired is what actually clears the cookie.
      const userId = (token.id ?? token.sub) as string | undefined;
      if (userId && !user) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, sessionVersion: true },
          });
          if (dbUser) {
            const tokenVersion = typeof token.sv === "number" ? token.sv : 0;
            const roleMatches = !token.role || token.role === dbUser.role;
            if (tokenVersion === dbUser.sessionVersion && roleMatches) {
              token.role = dbUser.role;
              token.sv = dbUser.sessionVersion;
            }
          }
        } catch {
          // If database check errors, do not crash; token remains
        }
      }

      return token;
    },
  },
});
