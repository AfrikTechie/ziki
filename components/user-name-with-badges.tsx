import Link from "next/link";
import { AdminBadge } from "@/components/admin-badge";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import type { AvatarSize } from "@/lib/avatar";
import { authorBadgeClass } from "@/lib/labels";
import type { AppRole } from "@/lib/roles";
import { isOrganisationAdmin, type OrganisationRole } from "@/lib/organisation-role";

export function UserNameWithBadges({
  name,
  role,
  organisationRole,
  userId,
  showAuthor = false,
  agentName,
  avatar,
  image,
  className = "",
}: {
  name: string;
  /** Account-wide role. On its own it only labels the site's super admin. */
  role?: AppRole | null;
  /**
   * The person's role in the organisation this page belongs to (#489). The
   * Admin label follows it, the same rule as admin powers: an admin of another
   * organisation who is only a member here is not labelled Admin here.
   */
  organisationRole?: OrganisationRole | null;
  /**
   * Links the name to that person's profile. Leave it out anywhere the name
   * already sits inside a link — a list row, say — because a link inside a
   * link is invalid and the inner one is unreachable by keyboard.
   */
  userId?: string | null;
  showAuthor?: boolean;
  /** Shows agent attribution: a small agent icon and its name (#578). */
  agentName?: string | null;
  /** Draw the person's avatar before the name, at this size (#290). */
  avatar?: AvatarSize;
  image?: string | null;
  className?: string;
}) {
  return (
    <span className={`inline-flex max-w-full flex-wrap items-center gap-1.5 ${className}`}>
      {avatar ? <Avatar name={name} image={image} size={avatar} /> : null}
      {userId ? (
        <Link
          href={`/users/${userId}`}
          className="truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          {name}
        </Link>
      ) : (
        <span className="truncate">{name}</span>
      )}
      {agentName ? <AgentChip name={agentName} /> : null}
      {showAuthor ? <Badge className={authorBadgeClass}>Creator</Badge> : null}
      {isOrganisationAdmin(organisationRole, role) ? <AdminBadge /> : null}
    </span>
  );
}

/** An agent, as a small chip: a robot icon and its name (#578). */
export function AgentChip({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-600 ring-1 ring-slate-200/80 ${className}`}
      aria-label={`Agent ${name}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8" width="16" height="12" rx="3" />
        <path d="M12 4v4" />
        <circle cx="12" cy="3.5" r="1" />
        <path d="M9 13h.01M15 13h.01M9.5 16.5h5" />
      </svg>
      <span>{name}</span>
    </span>
  );
}
