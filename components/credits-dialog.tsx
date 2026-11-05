"use client";

import { useRef } from "react";
import { OPEN_CONSENT_EVENT } from "@/components/consent-banner";

/** The people who made Ziki (#credits). Add a row here to add a name to the credits. */
export const CREATORS: Array<{ name: string; role: string }> = [
  { name: "Mark Essien", role: "Creator" },
  { name: "Hamzat Adebayo", role: "Creator" },
];

/** The roll, top to bottom, like the end of an old film. */
const ROLL: Array<{ heading?: string; lines: string[] }> = [
  { heading: "ZIKI", lines: ["Issue tracking for teams", "and their AI agents"] },
  { heading: "Created by", lines: CREATORS.map((c) => c.name) },
  { heading: "Built with", lines: ["Next.js", "React", "Prisma", "PostgreSQL", "Tailwind CSS"] },
  { heading: "Starring", lines: ["Every agent that ever", "confirmed, bid, delivered", "or reviewed an issue"] },
  { heading: "Special thanks", lines: ["Everyone who reported a bug"] },
  { lines: ["Human-led. AI-assisted."] },
];

/**
 * The version number in the bottom bar (#credits). Clicking it opens the
 * credits: the names rolling up the screen, a table of the creators, and the
 * cookie settings.
 */
export function VersionCredits({ version, className = "" }: { version: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} title="Credits and cookie settings" className={className}>
        {version}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="credits-title"
        className="m-auto w-[min(92vw,520px)] overflow-hidden rounded-2xl border border-zinc-700 bg-black p-0 text-zinc-100 shadow-2xl backdrop:bg-black/70"
      >
        <style>{`
          @keyframes ziki-credits-roll { from { transform: translateY(0); } to { transform: translateY(-50%); } }
          .ziki-credits-roll { animation: ziki-credits-roll 28s linear infinite; }
          .ziki-credits-window:hover .ziki-credits-roll { animation-play-state: paused; }
          @media (prefers-reduced-motion: reduce) { .ziki-credits-roll { animation: none; } }
        `}</style>
        <div className="px-6 pt-5">
          <h2 id="credits-title" className="text-center font-serif text-xs uppercase tracking-[0.4em] text-zinc-400">
            Credits · {version}
          </h2>
        </div>
        {/* The roll: two copies one after the other, so it loops without a jump. Hover pauses it. */}
        <div
          className="ziki-credits-window relative mt-3 h-64 overflow-hidden"
          style={{ maskImage: "linear-gradient(transparent, black 18%, black 82%, transparent)", WebkitMaskImage: "linear-gradient(transparent, black 18%, black 82%, transparent)" }}
          aria-hidden="true"
        >
          <div className="ziki-credits-roll">
            {[0, 1].map((copy) => (
              <div key={copy} className="space-y-9 py-24 text-center font-serif">
                {ROLL.map((block, index) => (
                  <div key={index} className="space-y-1">
                    {block.heading ? (
                      <p className={block.heading === "ZIKI" ? "text-4xl font-bold tracking-[0.3em] text-amber-200" : "text-[11px] uppercase tracking-[0.35em] text-zinc-500"}>
                        {block.heading}
                      </p>
                    ) : null}
                    {block.lines.map((line) => (
                      <p key={line} className="text-lg tracking-wide text-zinc-100">{line}</p>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-zinc-800 px-6 py-4">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">The creators of Ziki</caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <th scope="col" className="pb-2 font-medium">Name</th>
                <th scope="col" className="pb-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {CREATORS.map((creator) => (
                <tr key={creator.name} className="border-t border-zinc-800">
                  <td className="py-2 font-semibold text-zinc-100">{creator.name}</td>
                  <td className="py-2 text-zinc-400">{creator.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex items-center justify-between gap-3">
            {/* Closes the credits first, so the banner isn't hidden behind them. */}
            <button
              type="button"
              onClick={() => {
                dialog.current?.close();
                window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
              }}
              className="text-xs text-zinc-400 underline hover:text-zinc-100"
            >
              Cookie settings
            </button>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="rounded-full border border-zinc-600 px-4 py-1.5 text-xs font-bold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-amber-200"
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
