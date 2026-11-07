import { z } from "zod";

export const featureScope = z.enum(["first", "later"]);
export const featureRequestSchema = z.object({
  title: z.string().trim().min(3).max(120),
  request: z.string().trim().min(20).max(4000),
});
const criteria = z.array(z.string().trim().min(3).max(200)).min(1).max(4);
export const featureTaskSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(1200),
  acceptanceCriteria: criteria,
  scope: featureScope,
  // These references are suggestions, never trusted without a project-scoped lookup.
  existing: z.string().regex(/^(idea|issue):[a-zA-Z0-9_-]{1,64}$/).nullable(),
});
export const featureDraftSchema = z.object({
  outcome: z.string().trim().min(10).max(600),
  definitionOfDone: criteria,
  tasks: z.array(featureTaskSchema).min(1).max(8),
}).superRefine((draft, ctx) => {
  if (!draft.tasks.some((task) => task.scope === "first")) {
    ctx.addIssue({ code: "custom", path: ["tasks"], message: "Keep at least one item in the first version." });
  }
  const references = draft.tasks.flatMap((task) => task.existing ? [task.existing] : []);
  if (new Set(references).size !== references.length) {
    ctx.addIssue({ code: "custom", path: ["tasks"], message: "Link each existing work item only once." });
  }
});
export type FeatureRequest = z.infer<typeof featureRequestSchema>;
export type FeatureDraft = z.infer<typeof featureDraftSchema>;
export type FeatureScope = z.infer<typeof featureScope>;

/** Published ideas carry the overall outcome as context, not just their isolated task. */
export function featureIdeaDescription(request: FeatureRequest, draft: FeatureDraft, index: number, planUrl: string) {
  const task = draft.tasks[index];
  return `## Summary\n${task.description}\n\n## Proposed solution\n${task.title}\n\n## Acceptance criteria\n${task.acceptanceCriteria.map((line) => `- [ ] ${line}`).join("\n")}\n\n## Feature outcome\n${draft.outcome}\n\n## Feature definition of done\nThese criteria describe the overall feature. This idea covers only the work item and acceptance criteria above.\n${draft.definitionOfDone.map((line) => `- [ ] ${line}`).join("\n")}\n\nPart of [${request.title.replace(/[\[\]\\]/g, "")}](${planUrl}) · ${task.scope === "first" ? "First version" : "Later improvement"}. The original request is kept in the feature plan.`;
}
