import type { Status } from "@prisma/client";

/**
 * Title suggestions for the issues search box (#671).
 *
 * Typing already filters the list after a short pause; these are the matching
 * issues shown underneath so a searcher can jump straight to one. The lookup
 * is tenant- and project-scoped in the API route, exactly like the list.
 */

export const SUGGEST_LIMIT = 5;

/** One character matches too much to be a useful suggestion. */
export const MIN_SUGGEST_LENGTH = 2;

export const MAX_SUGGEST_LENGTH = 120;

/** Debounced typing stays well under this; it only stops scripts. */
export const SUGGEST_RATE_LIMIT = { max: 120, windowMs: 60 * 1000 };

export type IssueSuggestion = {
  id: string;
  number: number;
  title: string;
  status: Status;
  /** The issue's address, `/<org>/<project>/<number>`. */
  path: string;
};

export function normalizeSuggestQuery(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, MAX_SUGGEST_LENGTH);
}

export function shouldSuggest(query: string): boolean {
  return query.length >= MIN_SUGGEST_LENGTH;
}
