import { cleanEnv } from "@/lib/env-clean";

type Env = Record<string, string | undefined>;

/**
 * Whether the app's own cookies get the `Secure` attribute (#514). Same rule
 * as Auth.js's session cookie in auth.config.ts: on in production, except when
 * the site runs on http://localhost (a production build tested locally).
 */
export function secureCookiesEnabled(env: Env = process.env): boolean {
  const authUrl = cleanEnv(env.AUTH_URL) || cleanEnv(env.NEXTAUTH_URL);
  return env.NODE_ENV === "production" && !authUrl?.startsWith("http://localhost");
}

/** Attributes for the app's preference cookies (active organisation, active project, theme). */
export function appCookieOptions(maxAge: number) {
  return {
    path: "/",
    maxAge,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: secureCookiesEnabled(),
  };
}
