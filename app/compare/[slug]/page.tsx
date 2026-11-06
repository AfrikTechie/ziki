import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { auth } from '@/auth';
import { MarketingPage } from '@/components/homepage/marketing-page';
import { JsonLd } from '@/components/json-ld';
import { PlatformBadge } from '@/components/compare/platform-badge';
import { StatusPill } from '@/components/compare/status-pill';
import '@/components/compare/compare.css';
import { buildComparison, type BuiltComparison, type PlatformData } from '@/lib/compare/build';
import { categoryShortLabel, FEATURE_STATUSES } from '@/lib/compare/catalog';
import { findCurated, findPublishedPlatform, listComparisonCards, relatedCards } from '@/lib/compare/data';
import { formatDate, verifiedText } from '@/lib/compare/format';
import { comparisonJsonLd, comparisonMetadata } from '@/lib/compare/seo';
import { canonicalPair, comparisonHref, comparisonSlug, parseComparisonSlug } from '@/lib/compare/slug';

type Loaded = { a: PlatformData; b: PlatformData; built: BuiltComparison; redirectTo: string | null };

/** Loads and builds the pair once per request, for the page and its metadata. */
const load = cache(async (rawSlug: string): Promise<Loaded | null> => {
  const parsed = parseComparisonSlug(rawSlug);
  if (!parsed) return null;
  const [first, second] = await Promise.all([findPublishedPlatform(parsed.a), findPublishedPlatform(parsed.b)]);
  if (!first || !second) return null;
  const pair = canonicalPair(first.slug, second.slug);
  const [a, b] = pair.a === first.slug ? [first, second] : [second, first];
  const curated = await findCurated(a.id, b.id);
  const wanted = comparisonSlug(pair.a, pair.b);
  let decoded = rawSlug;
  try { decoded = decodeURIComponent(rawSlug); } catch { /* parseComparisonSlug already refused it */ }
  return { a, b, built: buildComparison(a, b, curated), redirectTo: decoded === wanted ? null : comparisonHref(pair.a, pair.b) };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const loaded = await load((await params).slug);
  if (!loaded) return { title: 'Comparison not found', robots: { index: false, follow: false } };
  return comparisonMetadata(loaded.built, loaded.a, loaded.b);
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="cmp-unknown">{empty}</p>;
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

export default async function ComparisonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await load(slug);
  if (!loaded) notFound();
  if (loaded.redirectTo) permanentRedirect(loaded.redirectTo);
  const { a, b, built } = loaded;

  const [session, cards] = await Promise.all([auth(), listComparisonCards()]);
  const signedIn = Boolean(session?.user);
  const related = relatedCards(cards, built.slug, a, b);
  const rival = a.isZiki ? b : b.isZiki ? a : null;
  const visit = rival ? [rival] : [a, b];
  const sources = [...new Set([...a.sourceUrls, ...b.sourceUrls])];
  const picks = {
    a: built.recommendations.filter((r) => r.pick === 'a'),
    b: built.recommendations.filter((r) => r.pick === 'b'),
    either: built.recommendations.filter((r) => r.pick === 'either'),
  };
  const sideClass = (p: PlatformData) => (p.isZiki ? 'is-ziki' : undefined);

  return (
    <MarketingPage
      signedIn={signedIn}
      kicker="Compare"
      title={<>{a.name} <br />vs {b.name}</>}
      lede={built.summary}
      actions={<a className="th-btn th-btn-dark th-btn-lg" href="#table">See the comparison</a>}
    >
      <JsonLd data={comparisonJsonLd(built, a, b)} />

      <section className="cmp-wrap" aria-labelledby="intro-title">
        <p className="cmp-crumbs"><Link href="/compare">← All comparisons</Link></p>
        <div className="cmp-vs-head" id="intro-title">
          <span className="cmp-side"><PlatformBadge name={a.name} logoUrl={a.logoUrl} isZiki={a.isZiki} size={44} />{a.name}</span>
          <span className="cmp-vs" aria-hidden="true">vs</span>
          <span className="cmp-side"><PlatformBadge name={b.name} logoUrl={b.logoUrl} isZiki={b.isZiki} size={44} />{b.name}</span>
        </div>
        <div className="cmp-meta">
          <span>{a.name}: {verifiedText(a.lastVerifiedAt)}</span>
          <span>{b.name}: {verifiedText(b.lastVerifiedAt)}</span>
          <span>Page updated {formatDate(built.updatedAt)}</span>
        </div>
        <p className="cmp-note">{built.relationshipNote}</p>
        <div className="cmp-intro">
          {[a, b].map((p) => (
            <div key={p.id} className={sideClass(p)}>
              <h3>{p.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {categoryShortLabel(p.category)}</span></h3>
              <p>{p.description}</p>
            </div>
          ))}
        </div>
        {built.customIntro ? <p className="cmp-note">{built.customIntro}</p> : null}
      </section>

      <section className="cmp-wrap" id="table" aria-labelledby="table-title">
        <div className="cmp-head">
          <h2 id="table-title">Quick comparison</h2>
          <p>
            {built.rows.length} capabilities that apply to both. Verified answers: {a.name} {built.verifiedA} of {built.rows.length}, {b.name} {built.verifiedB} of {built.rows.length}.
            “Not verified” means nobody has checked it against the vendor’s own documentation, not that it is missing.
          </p>
        </div>
        <div className="cmp-table-wrap">
          <table className="cmp-table">
            <caption className="sr-only">{a.name} and {b.name} compared by capability</caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col" className={sideClass(a)}>{a.name}</th>
                <th scope="col" className={sideClass(b)}>{b.name}</th>
              </tr>
            </thead>
            <tbody>
              {built.rows.map((row) => (
                <tr key={row.dimension.key}>
                  <th scope="row">{row.dimension.label}<small>{row.dimension.question}</small></th>
                  {([['a', a], ['b', b]] as const).map(([side, p]) => {
                    const entry = row[side];
                    return (
                      <td key={side} className={sideClass(p)} data-label={p.name}>
                        <StatusPill status={entry.status} />
                        {entry.note ? <span className="cmp-cell-note">{entry.note}{entry.sourceUrl ? <> <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a></> : null}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cmp-legend">
          {FEATURE_STATUSES.map((s) => <StatusPill key={s.value} status={s.value} />)}
        </p>
      </section>

      <section className="cmp-wrap" aria-labelledby="detail-title">
        <div className="cmp-head"><h2 id="detail-title">Detailed comparison</h2></div>
        {built.details.length > 0 ? (
          <div>
            {built.details.map((detail) => (
              <div className="cmp-detail" key={detail.heading}>
                <h3>{detail.heading}</h3>
                <p><b>{a.name}</b>{detail.a}</p>
                <p><b>{b.name}</b>{detail.b}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="cmp-empty">No detailed notes are recorded for this pair yet. See each vendor’s own site for specifics.</p>
        )}
      </section>

      <section className="cmp-wrap" aria-labelledby="sl-title">
        <div className="cmp-head"><h2 id="sl-title">Strengths and limitations</h2></div>
        <div className="cmp-two">
          {([[a, built.strengthsA, built.limitationsA], [b, built.strengthsB, built.limitationsB]] as const).map(([p, strengths, limitations]) => (
            <div key={p.id} className={`cmp-panel ${p.isZiki ? 'is-ziki' : ''}`}>
              <h3><PlatformBadge name={p.name} logoUrl={p.logoUrl} isZiki={p.isZiki} size={30} />{p.name}</h3>
              <h4>Strengths</h4>
              <List items={strengths} empty="Not verified yet. Check the vendor’s own documentation." />
              <h4>Limitations</h4>
              <List items={limitations} empty="Not verified yet. No limitation is assumed." />
            </div>
          ))}
        </div>
      </section>

      <section className="cmp-wrap" aria-labelledby="choose-title">
        <div className="cmp-head"><h2 id="choose-title">Which platform should you choose?</h2></div>
        {built.recommendations.length > 0 ? (
          <div className="cmp-choose">
            {([[`Choose ${a.name} if you want…`, picks.a], [`Choose ${b.name} if you want…`, picks.b], ['Either can work for…', picks.either]] as const)
              .filter(([, items]) => items.length > 0)
              .map(([heading, items]) => (
                <div className="cmp-panel" key={heading}>
                  <h3>{heading}</h3>
                  <ul>{items.map((item) => <li key={item.useCase}>{item.useCase}{item.note ? <span>{item.note}</span> : null}</li>)}</ul>
                </div>
              ))}
          </div>
        ) : (
          <p className="cmp-empty">No recommendation is recorded for this pair yet.</p>
        )}
        {sources.length > 0 ? (
          <p className="cmp-sources">
            Sources: {sources.map((url, i) => <span key={url}>{i > 0 ? ', ' : ''}<a href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https?:\/\//, '')}</a></span>)}
          </p>
        ) : null}
      </section>

      <section className="cmp-wrap" aria-labelledby="cta-title">
        <div className="cmp-cta">
          <h2 id="cta-title">{rival ? `Ready to try Ziki, or see ${rival.name} first?` : 'Look closer'}</h2>
          <div className="cmp-cta-row">
            <Link className="th-btn th-btn-light" href="/">Explore Ziki</Link>
            <Link className="th-btn th-btn-dark" href={signedIn ? '/home' : '/signup'}>{signedIn ? 'Open your workspace' : 'Get started'}</Link>
            {visit.map((p) => (
              <a key={p.id} className="th-btn th-btn-light" href={p.websiteUrl} target="_blank" rel="noopener noreferrer">Visit {p.name} website</a>
            ))}
          </div>
        </div>
      </section>

      {related.length > 0 ? (
        <section className="cmp-wrap" aria-labelledby="related-title">
          <div className="cmp-head"><h2 id="related-title">Related comparisons</h2></div>
          <div className="cmp-grid">
            {related.map((card) => (
              <article className="cmp-card" key={card.slug}>
                <div className="cmp-card-logos">
                  <PlatformBadge name={card.a.name} logoUrl={card.a.logoUrl} isZiki={card.a.isZiki} />
                  <span aria-hidden="true">vs</span>
                  <PlatformBadge name={card.b.name} logoUrl={card.b.logoUrl} isZiki={card.b.isZiki} />
                </div>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
                <Link className="cmp-link" href={comparisonHref(card.a.slug, card.b.slug)}>View comparison<span className="sr-only">: {card.title}</span></Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </MarketingPage>
  );
}
