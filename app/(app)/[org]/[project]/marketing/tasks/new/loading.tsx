const bone = "rounded bg-zk-border motion-safe:animate-pulse";

/** The new marketing task form while its task types load. */
export default function LoadingNewMarketingTask() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-10" aria-busy="true" aria-label="Propose a marketing task">
      <p role="status" className="sr-only">
        Loading the form…
      </p>
      <div className={`${bone} h-8 w-72`} aria-hidden="true" />
      <div className="space-y-7 rounded-3xl border border-zk-border bg-zk-surface p-6 sm:p-8" aria-hidden="true">
        <div className={`${bone} h-10 w-full`} />
        <div className={`${bone} h-10 w-full`} />
        <div className={`${bone} h-24 w-full`} />
        <div className={`${bone} h-48 w-full`} />
      </div>
    </div>
  );
}
