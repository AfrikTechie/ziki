export const FOREIGN_KEY_ERRORS = {
  typeNotFound: "That type no longer exists. Please pick another.",
  assigneeNotFound: "Assignee not found",
} as const;

/**
 * Returns a user-friendly error message for Prisma foreign key constraint errors (P2003).
 * Inspects `error.meta.field_name` (or `target`) to determine which relation failed.
 */
export function getForeignKeyErrorMessage(
  errorMeta?: Record<string, unknown> | null,
): string {
  const rawField = errorMeta?.field_name ?? errorMeta?.target ?? "";
  const field = Array.isArray(rawField) ? rawField.join(" ") : String(rawField);
  if (/type/i.test(field)) {
    return FOREIGN_KEY_ERRORS.typeNotFound;
  }
  return FOREIGN_KEY_ERRORS.assigneeNotFound;
}
