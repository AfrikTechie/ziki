import { z } from "zod";
import { MAX_POOL_CREDITS, MAX_SPLIT_TARGETS } from "@/lib/goals/pool-split";

/**
 * Goal budgets (#616): a goal owns a budget pool and splits it across issues,
 * nested goals, and agent deliverables. These schemas are the only input
 * boundary for `POST /api/v1/goals*` — the pool arithmetic lives in
 * `lib/goals/pool-split.ts`.
 */

/** A goal's lifecycle. Only `active` goals accept new splits. */
export const goalStatuses = ["active", "completed", "cancelled"] as const;
export const goalStatusSchema = z.enum(goalStatuses);
export type GoalStatusValue = z.infer<typeof goalStatusSchema>;

/** How a split computed each slice of the pool. */
export const goalSplitMethods = ["manual", "proportional", "milestone", "even"] as const;
export const goalSplitMethodSchema = z.enum(goalSplitMethods);
export type GoalSplitMethodValue = z.infer<typeof goalSplitMethodSchema>;

/** What a slice points at: an issue, a nested goal, or an agent deliverable. */
export const goalAllocationTargets = ["issue", "goal", "agent"] as const;
export const goalAllocationTargetSchema = z.enum(goalAllocationTargets);
export type GoalAllocationTargetValue = z.infer<typeof goalAllocationTargetSchema>;

const idSchema = z.string().trim().min(1).max(191);

const strictCoerceInteger = (val: unknown) => {
  if (typeof val === "number") return val;
  if (typeof val === "string" && /^\s*\d+\s*$/.test(val)) return Number(val);
  return val;
};

const credits = (label: string, max: number, min: number) =>
  z.preprocess(
    strictCoerceInteger,
    z
      .number({ message: `${label} must be a number` })
      .int(`${label} must be a whole number of credits`)
      .min(min, `${label} must be at least ${min}`)
      .max(max, `${label} must be at most ${max}`),
  );

/**
 * Optional free-text description. `""`, `null`, and an omitted field all
 * collapse to `null`; the parser always yields `string | null`, so a validated
 * create payload is complete for Prisma.
 */
const descriptionSchema = z
  .string()
  .trim()
  .max(4000, "The description must be at most 4000 characters")
  .nullable()
  .optional()
  .transform((value) => value || null);

/** Create payload for a goal (#616). The pool starts unfunded and unsplit. */
export const createGoalSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "The title must be at least 3 characters")
      .max(200, "The title must be at most 200 characters"),
    description: descriptionSchema,
    budgetPool: credits("budgetPool", MAX_POOL_CREDITS, 0),
    projectId: idSchema.optional(),
  })
  .strict();

/** The shape callers pass to `createGoal` — `description` may be omitted. */
export type CreateGoalInput = z.input<typeof createGoalSchema>;
/** The parsed, complete create payload (`description` always present). */
export type ParsedCreateGoalInput = z.output<typeof createGoalSchema>;

/**
 * One split target. Which fields are required depends on `targetType` and the
 * split `method`; `splitGoalPoolSchema.superRefine` enforces the pairing.
 */
const splitTargetSchema = z
  .object({
    targetType: goalAllocationTargetSchema,
    targetBugId: idSchema.optional(),
    targetGoalId: idSchema.optional(),
    targetAgentId: idSchema.optional(),
    /** Required for `agent` targets: the deliverable's name. */
    label: z
      .string()
      .trim()
      .min(1, "A deliverable label cannot be empty")
      .max(200, "A deliverable label must be at most 200 characters")
      .optional(),
    /** Weight (`proportional`) or percentage share (`milestone`). */
    weight: z.preprocess(
      strictCoerceInteger,
      z.number({ message: "Weight must be a number" }).int().min(0).max(1_000_000),
    ).optional(),
    /** Explicit slice for `manual` splits. */
    amount: credits("amount", MAX_POOL_CREDITS, 1).optional(),
  })
  .strict();

/**
 * Execute a pool split (#616). `amount` is the total to carve out and defaults
 * to everything still unallocated; `manual` splits leave it out and put the
 * amount on each target instead. `sourceKey` keys the whole split for
 * retries — the same key is never applied twice.
 */
export const splitGoalPoolSchema = z
  .object({
    method: goalSplitMethodSchema,
    amount: credits("amount", MAX_POOL_CREDITS, 1).optional(),
    sourceKey: z
      .string()
      .trim()
      .min(1, "sourceKey cannot be empty")
      .max(191, "sourceKey must be at most 191 characters")
      .optional(),
    targets: z
      .array(splitTargetSchema)
      .min(1, "A split needs at least one target")
      .max(MAX_SPLIT_TARGETS, `A split can have at most ${MAX_SPLIT_TARGETS} targets`),
    projectId: idSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    value.targets.forEach((target, index) => {
      const path = ["targets", index];
      // Every target names exactly its own kind of destination.
      if (target.targetType === "issue" && !target.targetBugId) {
        ctx.addIssue({ code: "custom", path: [...path, "targetBugId"], message: "An issue target needs targetBugId." });
      }
      if (target.targetType === "goal" && !target.targetGoalId) {
        ctx.addIssue({ code: "custom", path: [...path, "targetGoalId"], message: "A goal target needs targetGoalId." });
      }
      if (target.targetType === "agent" && !target.label) {
        ctx.addIssue({ code: "custom", path: [...path, "label"], message: "An agent target needs a deliverable label." });
      }
      if (target.targetType !== "issue" && target.targetBugId) {
        ctx.addIssue({ code: "custom", path: [...path, "targetBugId"], message: "targetBugId is only for issue targets." });
      }
      if (target.targetType !== "goal" && target.targetGoalId) {
        ctx.addIssue({ code: "custom", path: [...path, "targetGoalId"], message: "targetGoalId is only for goal targets." });
      }
      if (target.targetType !== "agent" && target.targetAgentId) {
        ctx.addIssue({ code: "custom", path: [...path, "targetAgentId"], message: "targetAgentId is only for agent targets." });
      }

      // The method decides which per-target numbers are meaningful.
      if (value.method === "manual") {
        if (!target.amount) {
          ctx.addIssue({ code: "custom", path: [...path, "amount"], message: "A manual split needs an amount on every target." });
        }
        if (target.weight !== undefined) {
          ctx.addIssue({ code: "custom", path: [...path, "weight"], message: "A manual split does not take weights." });
        }
      } else if (value.method === "even") {
        if (target.amount !== undefined) {
          ctx.addIssue({ code: "custom", path: [...path, "amount"], message: "An even split computes amounts itself." });
        }
        if (target.weight !== undefined) {
          ctx.addIssue({ code: "custom", path: [...path, "weight"], message: "An even split does not take weights." });
        }
      } else {
        if (target.amount !== undefined) {
          ctx.addIssue({ code: "custom", path: [...path, "amount"], message: `${value.method} splits compute amounts themselves.` });
        }
        if (target.weight === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "weight"],
            message: `A ${value.method} split needs a weight on every target.`,
          });
        } else if (value.method === "milestone" && target.weight > 100) {
          ctx.addIssue({ code: "custom", path: [...path, "weight"], message: "A milestone share cannot exceed 100." });
        }
      }
    });

    // Manual splits say how much per target; the others take one total.
    if (value.method === "manual" && value.amount !== undefined) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "A manual split puts the amount on each target, not at the top level." });
    }
    if (value.method === "milestone") {
      const total = value.targets.reduce((sum, target) => sum + (target.weight ?? 0), 0);
      if (value.targets.length && total !== 100) {
        ctx.addIssue({ code: "custom", path: ["targets"], message: `Milestone shares must total exactly 100, got ${total}.` });
      }
    }
  });

export type SplitGoalPoolInput = z.infer<typeof splitGoalPoolSchema>;

/** Status transition a person or agent can apply to a goal (#616). */
export const updateGoalStatusSchema = z
  .object({
    status: goalStatusSchema,
  })
  .strict();

export type UpdateGoalStatusInput = z.infer<typeof updateGoalStatusSchema>;
