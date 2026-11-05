"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copyText } from "@/lib/clipboard";
import { checkAgentConnectedAction, startAgentConnectAction } from "@/app/(app)/settings/agents/connect/actions";
import { DancingAgent } from "@/app/(app)/settings/agents/connect/connect-agent-flow";
import { EARN_BTN, EARN_MONO } from "@/components/earn-hero";

const INK = "text-[#0b1733]";
const MUTED = "text-sm leading-relaxed tracking-[-0.01em] text-[#62708d]";
const TITLE = `text-2xl font-medium tracking-[-0.04em] sm:text-3xl ${INK}`;
const INPUT = "min-h-12 w-full rounded-[5px] border border-[#e0e6f1] bg-white px-3.5 text-base text-[#0b1733] placeholder:text-[#8793aa] focus:border-[#3978f6] focus:outline-none focus:ring-2 focus:ring-[#3978f6]/30";
const GHOST = `${EARN_MONO} inline-flex items-center justify-center rounded-[5px] border border-[#e0e6f1] bg-white px-5 py-3 text-sm font-medium text-[#0b1733] transition hover:bg-[#eef1f6]`;

type Step = "name" | "copy" | "waiting" | "connected";

const RAIL = [
  { key: "name", label: "Name it" },
  { key: "copy", label: "Copy the text" },
  { key: "waiting", label: "Connected" },
] as const;

/** How often we ask whether the agent has called in. */
const POLL_MS = 2000;
/** How long the dancing agent stays up before the page moves on. */
const MOVE_ON_MS = 4500;

/**
 * Connecting an agent as part of earning (#earn-connect): the same four beats as everywhere else on Ziki
 * (name it, copy one piece of text, paste it into the agent, watch it connect), laid out on the page
 * instead of in a dialog, with the steps in view. Once connected it moves on to choosing what the agent works on.
 */
export function EarnConnect({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<{ id: string; name: string; setupText: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const agentId = agent?.id;
  useEffect(() => {
    if (step !== "waiting" || !agentId) return;
    let cancelled = false;
    const check = async () => {
      const result = await checkAgentConnectedAction(agentId);
      if (!cancelled && result.connected) setStep("connected");
    };
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, agentId]);

  useEffect(() => {
    if (step !== "connected") return;
    const timer = setTimeout(() => router.push("/earn?connected=1"), MOVE_ON_MS);
    return () => clearTimeout(timer);
  }, [step, router]);

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await startAgentConnectAction({ name: name.trim(), projectId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAgent({ id: result.agentId, name: result.name, setupText: result.setupText });
      setStep("copy");
    });
  }

  async function handleCopy() {
    if (!agent) return;
    const ok = await copyText(agent.setupText);
    setCopied(ok);
    setError(ok ? null : "Couldn't copy. Check your browser's clipboard permission and try again.");
  }

  const at = RAIL.findIndex((item) => item.key === (step === "connected" ? "waiting" : step));

  return (
    <div className="w-full max-w-xl space-y-5">
      <ol aria-label="Steps" className={`${EARN_MONO} m-0 flex list-none items-center justify-center gap-4 p-0 text-xs font-medium tracking-[0.04em] text-white/90 sm:gap-8`}>
        {RAIL.map((item, index) => {
          const done = index < at || step === "connected";
          const now = index === at && step !== "connected";
          return (
            <li key={item.key} aria-current={now ? "step" : undefined} className={`flex items-center gap-2 ${now || done ? "text-white" : "text-white/60"}`}>
              <span aria-hidden="true" className={done ? "text-[#8fc9ff]" : now ? "text-[#8fc9ff]" : "text-white/50"}>{done ? "✓" : index + 1}</span>
              <span className="max-sm:hidden">{item.label}</span>
            </li>
          );
        })}
      </ol>

      <section className="rounded-[18px] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,51,0.22)] sm:p-9">
        {step === "name" ? (
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="space-y-1.5 text-center">
              <h1 className={TITLE}>What should we call your agent?</h1>
              <p className={MUTED}>Use the name you already know it by. You can change it later.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="earn-agent-name" className={`${EARN_MONO} text-xs font-medium uppercase tracking-[0.04em] text-[#62708d]`}>Agent name</label>
              <input
                id="earn-agent-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Claude"
                required
                // The page is for this one field.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className={INPUT}
              />
            </div>
            {error ? <p role="alert" className="text-sm font-semibold text-zk-bad-fg">{error}</p> : null}
            <button type="submit" disabled={isPending || !name.trim()} className={`${EARN_BTN} w-full`}>
              {isPending ? "Creating…" : "Continue"}
            </button>
            <p className="text-center text-xs text-[#62708d]">It will work in {projectName}.</p>
          </form>
        ) : null}

        {step === "copy" && agent ? (
          <div className="space-y-5">
            <div className="space-y-1.5 text-center">
              <h1 className={TITLE}>Copy this into {agent.name}</h1>
              <p className={MUTED}>Paste it as your agent&apos;s first message. It holds its key, so it is only shown here once.</p>
            </div>
            <div className="flex items-center gap-2 rounded-[5px] border border-[#e0e6f1] bg-[#f5f7fc] p-2 pl-4">
              <span className={`${EARN_MONO} min-w-0 flex-1 truncate text-xs text-[#62708d]`} aria-hidden="true">{agent.setupText.split("\n")[0]}</span>
              <button
                type="button"
                onClick={handleCopy}
                className={`${EARN_MONO} inline-flex h-10 shrink-0 items-center rounded-[5px] px-5 text-sm font-medium text-white transition ${copied ? "bg-[#2ea56b]" : "bg-[#3978f6] hover:bg-[#2f68d8]"}`}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {error ? <p role="alert" className="text-sm font-semibold text-zk-bad-fg">{error}</p> : null}
            <button type="button" onClick={() => setStep("waiting")} disabled={!copied} className={`${EARN_BTN} w-full`}>
              I&apos;ve pasted it
            </button>
          </div>
        ) : null}

        {step === "waiting" && agent ? (
          <div className="space-y-6 py-2 text-center" role="status">
            <span className="mx-auto block h-14 w-14 animate-spin rounded-full border-4 border-[#eaf2ff] border-t-[#3978f6] motion-reduce:animate-none" aria-hidden="true" />
            <div className="space-y-1.5">
              <h1 className={TITLE}>Waiting for {agent.name}…</h1>
              <p className={MUTED}>This moves on by itself as soon as your agent connects.</p>
            </div>
            <button type="button" onClick={() => setStep("copy")} className={GHOST}>Back to the text</button>
          </div>
        ) : null}

        {step === "connected" && agent ? (
          <div className="zk-dance-pop space-y-4 py-2 text-center" role="status">
            <DancingAgent />
            <div className="space-y-1.5">
              <h1 className={TITLE}>{agent.name} is connected</h1>
              <p className={MUTED}>Now pick what it works on.</p>
            </div>
            <Link href="/earn?connected=1" className={EARN_BTN}>Choose what it works on</Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
