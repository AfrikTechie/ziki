import { BASE_PATH } from "@/lib/base-path";

export const CONTENT_TYPES = ["All", "Graphics", "Videos", "Articles", "PDFs", "Docs", "Links"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export type LibraryFile = {
  id: string;
  url: string;
  name: string;
  kind: Exclude<ContentType, "All">;
  contentType: string | null;
  size: number | null;
  downloadable: boolean;
  local: boolean;
  /** The work itself, for work delivered as Markdown. It has no url to open. */
  text?: string;
};
export type LibraryItem = {
  id: string;
  number: number;
  title: string;
  summary: string;
  agent: string;
  publishedAt: string | null;
  files: LibraryFile[];
};
export type LibraryResult = { ok: true; items: LibraryItem[] } | { ok: false };
export type FileMetadata = { id: string; filename: string; contentType: string; size: number };

/** Never turn an arbitrary stored URL into an executable or credential-bearing link. */
export function safeDeliverableUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function kindOf(path: string, contentType: string | null): Exclude<ContentType, "All"> {
  const mime = contentType?.split(";")[0].toLowerCase();
  if (mime?.startsWith("image/") && mime !== "image/svg+xml") return "Graphics";
  if (mime?.startsWith("video/")) return "Videos";
  if (mime === "application/pdf") return "PDFs";
  if (mime) return "Docs";
  if (/\.(png|jpe?g|gif|webp|avif)$/i.test(path)) return "Graphics";
  if (/\.(mp4|webm|ogv|mov)$/i.test(path)) return "Videos";
  if (/\.pdf$/i.test(path)) return "PDFs";
  if (/\.(docx?|txt|md|csv|xlsx?|pptx?|zip)$/i.test(path)) return "Docs";
  if (/\/(blog|articles?|posts?)\//i.test(path)) return "Articles";
  return "Links";
}

/** Only what the delivery itself carries or names appears here; task evidence isn't a deliverable. */
export function deliveryFiles(urls: string[], attachments: FileMetadata[] = [], text?: string | null): LibraryFile[] {
  const written: LibraryFile[] = text
    ? [{ id: "work", url: "", name: "Delivered work", kind: "Articles", contentType: "text/markdown", size: null, downloadable: false, local: false, text }]
    : [];
  return [...written, ...[...new Set(urls)].flatMap((raw, index): LibraryFile[] => {
    // Local uploaded files may be named by their authenticated serving route.
    const localMatch = /^(?:\/bug-tracker)?\/api\/(?:v1\/)?attachments\/([a-z0-9-]+)$/i.exec(raw);
    const metadata = localMatch ? attachments.find((file) => file.id === localMatch[1]) : undefined;
    if (localMatch && !metadata) return [];
    const safe = metadata ? `${BASE_PATH}/api/attachments/${encodeURIComponent(metadata.id)}` : safeDeliverableUrl(raw);
    if (!safe) return [];
    const parsed = new URL(safe, "https://local.invalid");
    let name = parsed.hostname;
    try { name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname); } catch { /* Keep a safe display name for malformed escapes. */ }
    const kind = kindOf(parsed.pathname, metadata?.contentType ?? null);
    return [{
      id: metadata?.id ?? `url-${index}`, url: safe, name: metadata?.filename ?? name,
      kind, contentType: metadata?.contentType ?? null, size: metadata?.size ?? null,
      downloadable: Boolean(metadata) || ["Graphics", "Videos", "PDFs", "Docs"].includes(kind),
      local: Boolean(metadata),
    }];
  })];
}

export function filterLibrary(items: LibraryItem[], search: string, type: ContentType, oldest: boolean): LibraryItem[] {
  const query = search.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const matchesType = type === "All" || item.files.some((file) => file.kind === type);
    const haystack = [item.title, item.summary, item.number, `#${item.number}`, item.agent, ...item.files.flatMap((file) => [file.name, file.text ?? ""])].join(" ").toLocaleLowerCase();
    return matchesType && (!query || haystack.includes(query));
  }).sort((a, b) => {
    // Missing publication dates stay last in either direction, rather than inventing a date.
    if (!a.publishedAt) return b.publishedAt ? 1 : a.id.localeCompare(b.id);
    if (!b.publishedAt) return -1;
    const diff = Date.parse(a.publishedAt) - Date.parse(b.publishedAt);
    return (oldest ? diff : -diff) || a.id.localeCompare(b.id);
  });
}
