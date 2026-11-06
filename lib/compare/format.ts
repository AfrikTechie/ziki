const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** "Last verified 5 November 2026", or a plain admission when nobody has checked. */
export function verifiedText(date: Date | null): string {
  return date ? `Last verified ${formatDate(date)}` : "Not yet verified";
}
