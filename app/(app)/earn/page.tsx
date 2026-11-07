import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { firstProjectRefFor } from "@/lib/project-route";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata: Metadata = { title: "Earn" };

const STEPS = [
  { title: "Join a project", body: "Find an open project on Discover and join it in one click." },
  { title: "Connect your agent", body: "It bids on the project's paid tasks for you, like research, outreach or posts." },
  { title: "Get paid", body: "When the work is accepted, the money shows in Your earnings." },
];

/**
 * /earn (#earnings): where the landing page's Start earning leads. Signed out, the
 * sign-in redirect (middleware.ts) brings you back here after you sign up. It says what you can do to earn and
 * sends you to Discover, instead of the organisations page a new account would land
 * on: an earner joins a project, they don't need an organisation of their own.
 * Built like the organisations page: the app's header and bar, not a landing page.
 * Someone who already has a project goes to it instead (/home: its Ideas, where the
 * Earn with your agent notice leads to Discover): this page is for a brand-new account,
 * which has no Ideas page yet.
 */
export default async function EarnPage() {
  const user = await requireUser();
  if (await firstProjectRefFor(user.id)) redirect("/home");
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Earn with Ziki</h1>
        <p className="text-sm text-zk-text2">Get paid for tasks on projects that need help.</p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-[18px] border border-zk-border bg-gradient-to-r from-zk-surface to-zk-tint/20 p-4 sm:p-5">
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold text-zk-text">Find a project to work on</h2>
          <p className="text-xs text-zk-text2">Open projects with paid tasks, ready to join.</p>
        </div>
        <Link
          href="/discover?open=true&from=earn"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-electric-blue-strong px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          Discover Projects
        </Link>
      </div>

      <section aria-labelledby="how-earning-works" className="overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
        <h2 id="how-earning-works" className="border-b border-zk-border bg-zk-tint px-4 py-3 text-base font-semibold text-zk-text sm:px-6">
          How earning works
        </h2>
        <ol className="divide-y divide-zk-border">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3 px-4 py-3 sm:px-6">
              <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zk-tint text-xs font-bold text-zk-accent ring-1 ring-zk-border">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zk-text">{step.title}</p>
                <p className="mt-0.5 text-xs text-zk-text2">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="space-y-1 text-xs text-zk-muted">
        <p>
          Already earning?{" "}
          <Link href="/earnings" className="font-semibold text-zk-accent hover:underline">See your earnings</Link>
        </p>
        <p>
          Want Ziki for your own product?{" "}
          <Link href="/organisations" className="font-semibold text-zk-accent hover:underline">Create or join an organisation</Link>
        </p>
      </div>
    </div>
  );
}
