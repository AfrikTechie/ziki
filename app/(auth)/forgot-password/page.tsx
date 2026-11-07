import Link from "next/link";
import { notFound } from "next/navigation";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { AuthSplitFrame } from "../login/auth-split-frame";
import { NOINDEX } from "@/lib/seo/site";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Forgot password", robots: NOINDEX };

export default function ForgotPasswordPage() {
  if (!isPasswordAuthEnabled()) notFound();

  return (
    <main>
      <AuthSplitFrame
        panelLabel="Forgot password"
        title="Forgot password"
        description={"Enter your email and we'll send a reset link if an account exists."}
      >
        <ForgotPasswordForm />
        <p className="text-center text-sm text-zk-muted">
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-zk-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthSplitFrame>
    </main>
  );
}
