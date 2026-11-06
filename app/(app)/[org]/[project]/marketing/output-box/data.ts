import "server-only";
import { prisma } from "@/lib/prisma";
import type { ProjectContext } from "@/lib/project-route";
import { deliveryFiles, type LibraryItem } from "@/components/marketing/library/model";

/** The caller must resolve access with requireProject; every read remains organisation/project scoped. */
export async function readLibrary({ project, organisationId }: ProjectContext): Promise<LibraryItem[]> {
  const tasks = await prisma.bug.findMany({
    where: { projectId: project.id, organisationId, isDeleted: false, track: "marketing", status: "resolved", substatus: "published" },
    orderBy: [{ number: "desc" }, { id: "asc" }],
    select: {
      id: true, number: true, title: true,
      deliveries: {
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 1,
        select: { summary: true, deliverableText: true, deliverableUrls: true, agent: { select: { name: true } } },
      },
      // A manager's accepting review is the publication event (M-API-5).
      mergeReviews: { where: { verdict: "accept" }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 1, select: { updatedAt: true } },
      // Resolve metadata only for files explicitly named in deliverableUrls.
      // Do not expose screenshots or all task attachments as approved work.
      attachments: { select: { id: true, filename: true, contentType: true, size: true } },
    },
  });
  return tasks.flatMap((task) => {
    const delivery = task.deliveries[0];
    if (!delivery) return [];
    const files = deliveryFiles(delivery.deliverableUrls, task.attachments, delivery.deliverableText);
    return [{
      id: task.id, number: task.number, title: task.title, summary: delivery.summary,
      agent: delivery.agent.name, publishedAt: task.mergeReviews[0]?.updatedAt.toISOString() ?? null, files,
    }];
  });
}
