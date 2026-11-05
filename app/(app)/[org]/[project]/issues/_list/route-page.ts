/** The query string of a list page's search params, for its own address (#project-urls). */
export function queryOf(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}
