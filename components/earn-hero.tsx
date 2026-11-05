import Image from "next/image";
import Link from "next/link";

/** The home page's mono type, for small labels and buttons. */
export const EARN_MONO = "font-[family-name:var(--font-geist-mono)]";

/** The home page's dark button (its `th-btn-dark th-btn-lg`): ink, mono type, a small radius. */
export const EARN_BTN =
  `${EARN_MONO} inline-flex items-center justify-center rounded-[5px] bg-[#0b0b0c] px-6 py-4 text-[15px] font-medium tracking-[0.02em] text-white transition hover:bg-[#26272b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3978f6] disabled:opacity-60`;

/**
 * The look of the earn pages that stand on their own (#earn-landing, #earn-connect): the home page's hero. Its
 * photo and shade, its brand mark and Inter type, its mono nav link. No site header, agents bar or footer.
 * `fit` makes it exactly one screen with no scrolling (the landing); without it the page grows with its content
 * (the connect steps).
 */
export function EarnHero({
  link,
  fit = false,
  children,
}: {
  link: { href: string; label: string };
  fit?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${fit ? "h-dvh overflow-hidden" : "min-h-dvh"} bg-white p-3 [font-family:var(--font-inter),sans-serif] sm:p-5`}>
      <section className={`relative isolate flex flex-col overflow-hidden rounded-[18px] text-white ${fit ? "h-full" : "min-h-[calc(100dvh-1.5rem)] sm:min-h-[calc(100dvh-2.5rem)]"}`}>
        <Image src="/homepage/hero-sea.webp" alt="" fill priority sizes="100vw" className="-z-20 object-cover [object-position:50%_54%]" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgba(4,22,52,.5)_0%,rgba(4,22,52,.18)_42%,rgba(4,22,52,0)_65%),linear-gradient(180deg,rgba(4,22,52,.22),transparent_26%)]"
        />

        <header className="flex items-center justify-between gap-4 px-4 pt-4 sm:px-8 sm:pt-5">
          <Link href="/" aria-label="Ziki home" className="flex items-center gap-[11px] text-xl font-medium tracking-[-0.03em] text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-white">
              <Image src="/homepage/ziki-mark.svg" width={22} height={22} alt="" />
            </span>
            Ziki
          </Link>
          <Link href={link.href} className={`${EARN_MONO} text-xs font-medium uppercase tracking-[0.04em] text-white/90 underline-offset-[5px] transition-colors hover:text-white hover:underline`}>
            {link.label}
          </Link>
        </header>

        {children}
      </section>
    </div>
  );
}
