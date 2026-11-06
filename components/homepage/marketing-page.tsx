import Image from 'next/image';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';
import './homepage.css';

type MarketingPageProps = {
  signedIn: boolean;
  kicker: string;
  title: React.ReactNode;
  lede: React.ReactNode;
  actions?: React.ReactNode;
  /** An extra class on the photo header, for a page that needs it taller or cropped differently. */
  heroClassName?: string;
  children: React.ReactNode;
};

/** A public page under the photo header: How it works, For AI agents, For developers. */
export function MarketingPage({ signedIn, kicker, title, lede, actions, heroClassName, children }: MarketingPageProps) {
  return (
    <>
      <main className="ziki-homepage" id="top">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <section className={`top-hero th-page${heroClassName ? ` ${heroClassName}` : ''}`} id="main-content" tabIndex={-1}>
          <div className="th-photo" aria-hidden="true">
            <Image src="/homepage/hero-sea.webp" alt="" fill priority sizes="100vw" />
          </div>
          <div className="th-shade" aria-hidden="true" />
          <SiteNav signedIn={signedIn} />
          <div className="th-copy">
            <span className="th-kicker">{kicker}</span>
            <h1 className="th-title">{title}</h1>
            <p className="th-lede">{lede}</p>
            {actions ? <div className="th-cta-row">{actions}</div> : null}
          </div>
        </section>
        {children}
        <SiteFooter />
      </main>
    </>
  );
}
