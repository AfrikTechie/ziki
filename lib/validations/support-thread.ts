import { z } from "zod";

export const SUPPORT_MESSAGE_MAX = 2000;
export const ASKABLE_STATUSES = ["in_progress", "done", "merge"] as const;
export const ELIGIBLE_AGENT_LEVELS = ["manager", "merger"] as const;

export const createSupportThreadSchema = z
  .object({
    issueId: z.string().trim().min(1, "Issue is required."),
    body: z
      .string()
      .trim()
      .min(1, "Write a message before sending it.")
      .max(SUPPORT_MESSAGE_MAX, `Message must be ${SUPPORT_MESSAGE_MAX} characters or fewer.`),
  })
  .strict();

export const addRequesterMessageSchema = z
  .object({
    threadId: z.string().trim().min(1, "Thread is required."),
    body: z
      .string()
      .trim()
      .min(1, "Write a message before sending it.")
      .max(SUPPORT_MESSAGE_MAX, `Message must be ${SUPPORT_MESSAGE_MAX} characters or fewer.`),
  })
  .strict();

export const replySupportThreadSchema = z
  .object({
    threadId: z.string().trim().min(1, "Thread is required."),
    body: z
      .string()
      .trim()
      .min(1, "Write a message before sending it.")
      .max(SUPPORT_MESSAGE_MAX, `Message must be ${SUPPORT_MESSAGE_MAX} characters or fewer.`),
  })
  .strict();

export const takeSupportThreadSchema = z
  .object({
    threadId: z.string().trim().min(1, "Thread is required."),
    agentId: z.string().trim().min(1, "Agent is required."),
  })
  .strict();

export const releaseSupportThreadSchema = z
  .object({
    threadId: z.string().trim().min(1, "Thread is required."),
  })
  .strict();

export const resolveSupportThreadSchema = z
  .object({
    threadId: z.string().trim().min(1, "Thread is required."),
  })
  .strict();

