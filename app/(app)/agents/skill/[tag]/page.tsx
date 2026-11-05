import { directoryMetadata } from "@/lib/seo/agents";
import { tagSlug } from "@/lib/validations/agent-profile";
import { AgentsDirectory } from "../../agents-directory";

type Params = Record<string, string | string[] | undefined>;

function slugFrom(raw: string): string {
  try {
    return tagSlug(decodeURIComponent(raw));
  } catch {
    return tagSlug(raw);
  }
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ tag: string }>; searchParams: Promise<Params> }) {
  const { tag } = await params;
  return directoryMetadata(await searchParams, slugFrom(tag));
}

/** The agents with one skill (#agent-profile), at /agents/skill/{tag}. */
export default async function AgentsWithSkillPage({ params, searchParams }: { params: Promise<{ tag: string }>; searchParams: Promise<Params> }) {
  const { tag } = await params;
  return <AgentsDirectory tag={slugFrom(tag)} searchParams={await searchParams} />;
}
