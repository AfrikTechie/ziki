import { createHash } from "node:crypto";

/**
 * Error capture, first slice (#871): turn a server error into something safe to keep and group. Request bodies,
 * headers, query strings and keys never go in: only the route (with ids replaced), the method, the error's name, a
 * redacted message and the top application frames. Repeats of one failure then share a fingerprint, so a store or an
 * idea can count them instead of piling up copies. Pure and synchronous; it stores and files nothing.
 */
export type RawError = { name?: string; message?: string; stack?: string };
export type RawRequest = { path: string; method: string };

export type CapturedError = {
  route: string;
  method: string;
  name: string;
  message: string;
  frames: string[];
};

const MESSAGE_MAX = 200;
const FRAMES_KEPT = 3;

/** Strips query and hash, and replaces numbers, ids and long tokens in each path segment with `:id`. */
export function normaliseRoute(path: string): string {
  const clean = path.split("#")[0].split("?")[0] || "/";
  return clean
    .split("/")
    .map((segment) => (/^\d+$/.test(segment) || /^c[a-z0-9]{20,}$/.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment) ? ":id" : segment))
    .join("/");
}

/** Removes what must never be kept: keys and tokens, emails, URL query strings and long hex or id-like strings. */
export function redactText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bziki_[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]")
    .replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']*/g, "$1?[redacted]")
    .replace(/\b[0-9a-f]{24,}\b/gi, "[id]")
    .replace(/\bc[a-z0-9]{24}\b/g, "[id]");
}

/** `file:line` for each stack frame in the app's own code, top first, without columns or the machine's paths. */
export function appFrames(stack: string | undefined): string[] {
  if (!stack) return [];
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const match = line.match(/\(?([^()\s]+):(\d+):\d+\)?\s*$/);
    if (!match) continue;
    const file = match[1];
    if (file.includes("node_modules") || file.startsWith("node:")) continue;
    // Cut the machine's path: keep from the last app, lib, components or pages folder, else the last two parts.
    let start = -1;
    for (const m of file.matchAll(/[\\/](?:app|lib|components|pages)(?=[\\/])/g)) start = m.index! + 1;
    const tail = start >= 0 ? file.slice(start) : file.split(/[\\/]/).slice(-2).join("/");
    frames.push(`${tail.replace(/\\/g, "/")}:${match[2]}`);
    if (frames.length === FRAMES_KEPT) break;
  }
  return frames;
}

export function captureError(error: RawError, request: RawRequest): CapturedError {
  return {
    route: normaliseRoute(request.path),
    method: request.method.toUpperCase(),
    name: error.name || "Error",
    message: redactText(error.message ?? "").slice(0, MESSAGE_MAX),
    frames: appFrames(error.stack),
  };
}

/** A short stable id for one failure: the same route, method, error and top frames give the same value. */
export function fingerprintError(captured: CapturedError): string {
  return createHash("sha256")
    .update([captured.method, captured.route, captured.name, ...captured.frames].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

export type ErrorGroup = { fingerprint: string; count: number; sample: CapturedError };

/** Counts repeats of the same failure; biggest group first, ties by fingerprint. */
export function groupErrors(errors: readonly CapturedError[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const captured of errors) {
    const fingerprint = fingerprintError(captured);
    const existing = groups.get(fingerprint);
    if (existing) existing.count += 1;
    else groups.set(fingerprint, { fingerprint, count: 1, sample: captured });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.fingerprint.localeCompare(b.fingerprint));
}
