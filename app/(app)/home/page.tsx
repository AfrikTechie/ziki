import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentOrgPathFor, firstProjectRefFor } from "@/lib/project-route";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { ideasPath } from "@/lib/project-paths";
import { EARN_ORGANISATION_SLUG } from "@/lib/earn/draft";

/**
 * `/home`: where Ziki sends you when no project is named (after sign-in, from
 * a 404, from the logo with no project, and when you switch organisation). It
 * opens the Ideas of the current organisation's default project (Web when it has
 * one), its Projects page when it has no projects yet, or the organisation picker
 * when there is no organisation. The Ziki Earn organisation has no builders'
 * pages to open: its front door is /earn/home, so that is where it opens.
 */
export default async function HomePage() {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (organisationId) {
    const organisation = await prisma.organisation.findUnique({ where: { id: organisationId }, select: { slug: true } });
    if (organisation?.slug === EARN_ORGANISATION_SLUG) redirect("/earn/home");
  }
  const slug = await firstProjectRefFor(user.id);
  if (slug) redirect(ideasPath(slug));
  redirect((await currentOrgPathFor(user.id)) ?? "/organisations");
}
