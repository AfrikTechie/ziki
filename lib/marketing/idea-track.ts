import type { WorkTrack } from "@prisma/client";
import { marketingIdeaFieldsSchema } from "@/lib/validations/marketing";

/**
 * `track` and `rationale` on a new idea (docs/ziki-for-agents.md, "Propose a
 * marketing task"). An idea is product work unless it says otherwise. A
 * marketing idea must say why it is worth doing; a product idea takes no
 * rationale. The agent API and the web form both read new ideas through
 * here, so they accept and refuse the same things.
 */
export type IdeaTrackFields = { track: WorkTrack; rationale: string | null };

export type IdeaTrackResult =
  | { ok: true; value: IdeaTrackFields }
  | { ok: false; field: "track" | "rationale"; message: string };

const TRACKS: readonly string[] = ["product", "marketing"] satisfies readonly WorkTrack[];

const given = (value: unknown) => value !== undefined && value !== null && value !== "";

export function parseIdeaTrack(input: { track?: unknown; rationale?: unknown }): IdeaTrackResult {
  const track = given(input.track) ? input.track : "product";
  if (typeof track !== "string" || !TRACKS.includes(track)) {
    return { ok: false, field: "track", message: "track must be product or marketing." };
  }
  if (track === "product") {
    if (given(input.rationale)) {
      return { ok: false, field: "rationale", message: "rationale is only for marketing ideas." };
    }
    return { ok: true, value: { track: "product", rationale: null } };
  }
  const parsed = marketingIdeaFieldsSchema.safeParse({ track, rationale: input.rationale });
  if (!parsed.success) {
    return { ok: false, field: "rationale", message: parsed.error.issues[0]?.message ?? "Say why this is worth doing." };
  }
  return { ok: true, value: { track: "marketing", rationale: parsed.data.rationale } };
}

/**
 * Whether an issue type may go on an idea of `track`. Marketing task types
 * never appear on product work, and product types can't be used on marketing
 * work. A type saved before types had a track is product.
 */
export function typeFitsTrack(typeTrack: WorkTrack | null | undefined, track: WorkTrack): boolean {
  return (typeTrack ?? "product") === track;
}

/** The `422 wrong_track` message for a type on the other track. */
export function wrongTrackMessage(track: WorkTrack): string {
  return track === "marketing"
    ? "typeId is a product issue type. A marketing idea takes one of the project's marketing task types."
    : "typeId is a marketing task type. It can't be used on a product idea.";
}
