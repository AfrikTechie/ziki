import { redirect } from "next/navigation";
import { zikiTaskPath } from "@/lib/earn/draft";

/** Ziki tasks moved to /earn/marketing/<n> (#earn-drafts): earners do them on their own page, not an issue page. Old links still work. */
export default async function OldZikiTaskPage({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<{ step?: string; p?: string }> }) {
  const { n } = await params;
  const query = await searchParams;
  const number = Number(n);
  const qs = new URLSearchParams();
  if (query.step) qs.set("step", query.step);
  if (query.p) qs.set("p", query.p);
  redirect(`${zikiTaskPath(Number.isInteger(number) && number >= 1 ? number : 1)}${qs.size ? `?${qs}` : ""}`);
}
