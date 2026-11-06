import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { viewInvite } from "@/lib/invites";
import { prisma } from "@/lib/prisma";
import { InviteCard } from "../../invite-card";

/*
 * The token is in this page's URL, so it never goes out in a Referer header,
 * and it stays out of search engines.
 */
export const metadata: Metadata = {
  title: "Invite",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Where an invite link lands (#444). Opening it shows the invite and changes
 * nothing; joining takes a click, so a mail scanner that follows the link
 * can't use it up.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const user = await requireUser();
  const { token } = await params;
  const invite = await viewInvite(prisma, { token }, user);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href="/organisations" className="text-sm text-zk-accent hover:underline">
          ← Your organisations
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Invite</h1>
      </div>
      <InviteCard invite={invite} accept={{ token }} accountEmail={user.email} />
    </div>
  );
}
