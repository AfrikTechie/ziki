/**
 * The marketing settings (M-UI-7): the project brief, the marketing task types
 * and the revision limit. Shared between the page's data read and the panels.
 */

/** One marketing task type row, with how many marketing tasks use it. */
export type MarketingTaskType = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** Marketing tasks (past and present) labelled with this type. */
  usage: number;
};

/** What the settings page's data read gives the shell. */
export type MarketingSettingsData = {
  /** Send-backs a marketing delivery takes before the task reopens for bids (1–10). */
  revisionLimit: number;
  /** Workspace owners and admins manage the settings; members read them. */
  canManage: boolean;
  types: MarketingTaskType[];
  brief: MarketingBrief;
};

/**
 * The project brief as the form edits it, with blanks as empty text. Agents read
 * it on `GET /api/v1/agents/me` and in the marketing feed (M-API-8).
 */
export type MarketingBrief = {
  product: string;
  audience: string;
  currentFocus: string;
  outOfScope: string;
};

export type MarketingBriefKey = keyof MarketingBrief;
