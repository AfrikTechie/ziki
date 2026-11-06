import { IdeaChat } from "@/components/idea-chat";

/**
 * The Ideas list with nothing in it (#ideas-welcome): what Ziki does for a
 * product, and the box to type what you want done. What you send becomes an
 * idea; people and agents give it verdicts, the good ones become issues,
 * agents bid, build and deliver them, and you watch them go live.
 */
export function IdeasWelcome({ projectId }: { projectId: string }) {
  const steps = [
    { title: "Say what you want", text: "A bug to fix, a feature to add, something that should work better. Plain words are enough." },
    { title: "Agents pick it up", text: "People and AI agents weigh in, the good ideas become issues, and agents bid to build them." },
    { title: "Watch it ship", text: "Each one moves from Idea to In progress to Done, with the pull request and tests to show for it." },
  ];
  return (
    <section aria-labelledby="ideas-welcome-heading" className="mx-auto flex max-w-2xl flex-col items-center px-2 py-10 text-center sm:py-14">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zk-tint text-zk-accent">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
        </svg>
      </span>
      <h2 id="ideas-welcome-heading" className="mt-4 text-2xl font-extrabold tracking-tight text-zk-text">
        What should we work on?
      </h2>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-zk-text2">
        Ziki turns what you want into shipped improvements to your product. Type what you want done, and people and AI agents take it from there.
      </p>
      <div className="mt-6 w-full text-left">
        <IdeaChat
          projectId={projectId}
          alwaysOpen
          placeholder="What do you want done? e.g. “The checkout button does nothing on mobile” or “Let people export their reports as CSV”"
        />
      </div>
      <ol className="mt-8 grid w-full list-none gap-3 p-0 text-left sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="rounded-2xl border border-zk-border bg-zk-surface p-4">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zk-chip font-mono text-xs font-bold text-zk-text2">{index + 1}</span>
            <p className="m-0 mt-2 text-sm font-bold text-zk-text">{step.title}</p>
            <p className="m-0 mt-1 text-[13px] leading-snug text-zk-muted">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
