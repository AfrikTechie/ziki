import { LocalTime } from "@/components/local-time";
import { ACCEPT_INVITE_ERRORS, type InviteView } from "@/lib/invites";
import { AcceptInviteForm } from "./accept-invite-form";

const notice = "rounded-xl border border-zk-warn-bd bg-zk-warn-bg p-4 text-sm text-zk-warn-fg";

/**
 * One invite, as the signed-in person may see it (#444). Who sent it and
 * which organisation it's for are shown only to the account it was sent to; to
 * anyone else holding the link, an invite names nothing.
 */
export function InviteCard({
  invite,
  accept,
  accountEmail,
}: {
  invite: InviteView | null;
  /** How the accept button finds the invite again. */
  accept: { token: string } | { inviteId: string };
  accountEmail?: string | null;
}) {
  if (!invite) {
    return (
      <p role="status" className={notice}>
        {ACCEPT_INVITE_ERRORS.invalid}
      </p>
    );
  }

  const { details } = invite;
  if (!details) {
    // A valid link, opened by an account it wasn't sent to.
    const message =
      invite.state === "accepted"
        ? ACCEPT_INVITE_ERRORS.used
        : invite.state === "expired"
          ? ACCEPT_INVITE_ERRORS.expired
          : `This invite was sent to ${invite.maskedEmail}${
              accountEmail ? `, and you're signed in as ${accountEmail}` : ""
            }. Sign out, then sign in with the invited address to accept it.`;
    return (
      <p role="status" className={notice}>
        {message}
      </p>
    );
  }

  const { organisation, invitedByName, alreadyMember } = details;

  // Already a member: nothing to say, the organisation is in your list.
  if (alreadyMember) return null;

  if (invite.state !== "pending") {
    return (
      <p role="status" className={notice}>
        {invite.state === "expired"
          ? `Your invite to ${organisation.name} has expired. Ask ${invitedByName} for a new one.`
          : ACCEPT_INVITE_ERRORS.used}
      </p>
    );
  }

  return (
    <section
      aria-labelledby="invite-heading"
      className="space-y-4 rounded-xl border border-zk-border bg-zk-tint p-4 sm:p-6"
    >
      <div className="space-y-1">
        <h2 id="invite-heading" className="text-base font-semibold text-zk-text">
          {invitedByName} invited you to join {organisation.name}
        </h2>
        <p className="text-sm text-zk-text2">
          You&apos;ll join as a member and can see and file its issues. The invite expires{" "}
          <LocalTime date={invite.expiresAt} />.
        </p>
      </div>
      <AcceptInviteForm organisationName={organisation.name} {...accept} />
    </section>
  );
}
