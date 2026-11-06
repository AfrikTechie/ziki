import type { Metadata } from "next";
import Link from "next/link";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";
import { auth } from "@/auth";
import { selectOrganisationAction } from "@/app/(app)/organisations/actions";
import { requireUser } from "@/lib/auth-helpers";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { isInviteToken } from "@/lib/invites";
import { prisma } from "@/lib/prisma";
import {
  SHARE_LINK_ERRORS,
  previewShareLink,
  shareJoinPath,
  shareLinkAudience,
} from "@/lib/share-invites";
import { AuthSplitFrame } from "../../login/auth-split-frame";
import { AutoJoin } from "./auto-join";

export const metadata: Metadata = {
  title: "Join",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code in SHARE_LINK_ERRORS) return SHARE_LINK_ERRORS[code as keyof typeof SHARE_LINK_ERRORS];
  return null;
}

/**
 * Where a shareable invite link lands. Guests see the organisation and sign
 * in with Google; signing in creates an account when they don't have one,
 * then attaches the organisation. The link is not used until that POST.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { token } = await params;
  const { error: errorParam } = await searchParams;
  const errorCode = typeof errorParam === "string" ? errorParam : undefined;
  const error = errorMessage(errorCode);

  if (!isInviteToken(token)) {
    return (
      <main>
        <AuthSplitFrame
          panelLabel="Join"
          title="Join organisation"
          description={SHARE_LINK_ERRORS.invalid}
        >
          <p role="status" className="text-sm text-zk-warn-fg">
            {SHARE_LINK_ERRORS.invalid}
          </p>
        </AuthSplitFrame>
      </main>
    );
  }

  const session = await auth();
  const user = session?.user ? await requireUser() : null;
  const preview = await previewShareLink(prisma, token, user ? { id: user.id } : undefined);
  const callbackUrl = shareJoinPath(token);

  if (!preview) {
    return (
      <main>
        <AuthSplitFrame
          panelLabel="Join"
          title="Join organisation"
          description={SHARE_LINK_ERRORS.invalid}
        >
          <p role="status" className="text-sm text-zk-warn-fg">
            {SHARE_LINK_ERRORS.invalid}
          </p>
        </AuthSplitFrame>
      </main>
    );
  }

  return (
    <main>
      <AuthSplitFrame
        panelLabel="Join"
        title={`Join ${preview.organisation.name}`}
        description={
          <>
            {preview.invitedByName} invited you to {preview.organisation.name} on Ziki. You&apos;ll
            join as a member.
          </>
        }
      >
        {error ? (
          <p role="alert" className="rounded-xl bg-zk-warn-bg p-3 text-sm text-zk-warn-fg">
            {error}
          </p>
        ) : null}

        {preview.alreadyMember && user ? (
          <div className="space-y-3">
            <p className="text-sm text-zk-text2">
              You&apos;re already a member of{" "}
              <strong className="text-zk-text">{preview.organisation.name}</strong>.
            </p>
            <form action={selectOrganisationAction}>
              <input type="hidden" name="organisationId" value={preview.organisation.id} />
              <Button
                type="submit"
                className="h-12 w-full bg-electric-blue-strong text-base font-bold text-white hover:bg-electric-blue focus-visible:ring-electric-blue"
              >
                Open {preview.organisation.name}
              </Button>
            </form>
          </div>
        ) : preview.state !== "open" ? (
          <p role="status" className="rounded-xl bg-zk-warn-bg p-3 text-sm text-zk-warn-fg">
            {
              SHARE_LINK_ERRORS[
                preview.state === "expired"
                  ? "expired"
                  : preview.state === "revoked"
                    ? "revoked"
                    : "used"
              ]
            }
          </p>
        ) : user ? (
          <AutoJoin token={token} organisationName={preview.organisation.name} auto={!error} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-zk-text2">{shareLinkAudience(preview)}</p>
            <p className="text-sm text-zk-text2">
              The link expires <LocalTime date={preview.expiresAt} />. Sign in with Google — if
              you don&apos;t have an account yet, one is created — and {preview.organisation.name} is
              added to it.
            </p>
            <GoogleSignInButton callbackUrl={callbackUrl} />
            {isPasswordAuthEnabled() ? (
              <p className="text-center text-sm text-zk-muted">
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                  className="font-semibold text-zk-accent hover:underline"
                >
                  Sign in with email instead
                </Link>
              </p>
            ) : null}
          </div>
        )}
      </AuthSplitFrame>
    </main>
  );
}
