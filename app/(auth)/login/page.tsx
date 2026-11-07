import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { LoginForm } from "@/components/login-form";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import { AuthLegalNote, AuthSplitFrame } from "./auth-split-frame";
import { NOINDEX } from "@/lib/seo/site";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = {
  title: "Sign in",
  description: "Sign in to Ziki, the AI agent marketplace, to manage your projects and your AI agents.",
  robots: NOINDEX,
};

/**
 * Authenticated users are redirected to /bugs by middleware (`auth` wrapper).
 * Errors show fixed copy per `?error=` code only; any other query text (such
 * as the old `?reason=`) is never rendered (#118). Details are in server logs.
 * Google OAuth is the primary sign-in mechanism for Zedu Bugs.
 * Credentials stay when password auth is enabled (redesign mockup is Google-only).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    expired?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const googleConfigured = isGoogleOAuthConfigured();
  const passwordEnabled = isPasswordAuthEnabled();

  return (
    <main>
      <AuthSplitFrame
        title="Sign in to Ziki"
        description={
          passwordEnabled
            ? "Sign in with Google or your email to report, prioritize and track issues."
            : "Use your Google account to report, prioritize and track issues."
        }
        showAgentDocs
      >
        {params.expired && !params.error ? (
          <p
            className="rounded-xl bg-zk-warn-bg p-3 text-sm text-zk-warn-fg"
            role="status"
          >
            Your session ended. Sign in again to continue.
          </p>
        ) : null}

        {params.error ? (
          <div
            className="rounded-xl bg-zk-bad-bg p-3 text-sm text-zk-bad-fg"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <p className="font-medium">
              {params.error === "TwoFactor"
                ? "This account has two-factor sign-in on. Sign in with email and password, then enter the code. Google cannot skip that step."
                : params.error === "OAuthCallbackError" || params.error === "Configuration"
                  ? "Unable to complete Google sign-in. Please try again."
                  : "Authentication failed. Please try again."}
            </p>
          </div>
        ) : null}

        {passwordEnabled ? (
          <LoginForm callbackUrl={callbackUrl} googleEnabled={googleConfigured} />
        ) : googleConfigured ? (
          <GoogleSignInButton callbackUrl={callbackUrl} />
        ) : (
          <div className="rounded-xl bg-zk-warn-bg p-4 text-sm text-zk-warn-fg" role="alert">
            <p className="font-medium">Google sign-in is not configured.</p>
            <p className="mt-1">
              Set <code className="rounded bg-zk-chip px-1 font-mono">GOOGLE_CLIENT_ID</code> and
              <code className="rounded bg-zk-chip px-1 font-mono">GOOGLE_CLIENT_SECRET</code>
              in your environment to enable Google sign-in.
            </p>
            <p className="mt-2">
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-zk-accent hover:underline"
              >
                Configure in Google Cloud Console
              </a>
            </p>
          </div>
        )}

        <AuthLegalNote />
      </AuthSplitFrame>
    </main>
  );
}
