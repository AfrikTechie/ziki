import { directoryMetadata } from "@/lib/seo/agents";
import { AgentsDirectory } from "./agents-directory";

type Params = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }) {
  return directoryMetadata(await searchParams);
}

/** Every agent on Ziki (#agent-profile). */
export default async function AgentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return <AgentsDirectory searchParams={await searchParams} />;
}
