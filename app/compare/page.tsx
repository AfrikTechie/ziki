import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/auth';
import { MarketingPage } from '@/components/homepage/marketing-page';
import { JsonLd } from '@/components/json-ld';
import { CompareBuilder, type PlatformOption } from '@/components/compare/compare-builder';
import { PlatformBadge } from '@/components/compare/platform-badge';
import '@/components/compare/compare.css';
import { COMPARE_CATEGORIES, COMPARE_DIMENSIONS, featureOf, isCompareCategory } from '@/lib/compare/catalog';
import { listComparisonCards, listPublishedPlatforms, type ComparisonCard } from '@/lib/compare/data';
import { directoryJsonLd, directoryMetadata } from '@/lib/compare/seo';
import { comparisonHref } from '@/lib/compare/slug';

export const metadata: Metadata = directoryMetadata();

function Card({ card }: { card: ComparisonCard }) {
  return (
    <article className="cmp-card">
      <div className="cmp-card-logos">
        <PlatformBadge name={card.a.name} logoUrl={card.a.logoUrl} isZiki={card.a.isZiki} />
        <span aria-hidden="true">vs</span>
        <PlatformBadge name={card.b.name} logoUrl={card.b.logoUrl} isZiki={card.b.isZiki} />
      </div>
      <h3>{card.title}</h3>
      <p>{card.description}</p>
      <Link className="cmp-link" href={comparisonHref(card.a.slug, card.b.slug)}>View comparison<span className="sr-only">: {card.title}</span></Link>
    </article>
  );
}

export default async function CompareDirectoryPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const [session, query] = await Promise.all([auth(), searchParams]);
  const signedIn = Boolean(session?.user);
  const category = query.category && isCompareCategory(query.category) ? query.category : null;

  const [platforms, cards] = await Promise.all([listPublishedPlatforms(), listComparisonCards()]);
  const options: PlatformOption[] = platforms.map((p) => ({ slug: p.slug, name: p.name, category: p.category, logoUrl: p.logoUrl, isZiki: p.isZiki }));
  const ziki = platforms.find((p) => p.isZiki) ?? null;

  const popular = cards.filter((c) => c.popular).slice(0, 8);
  const inCategory = (card: ComparisonCard) => !category || card.a.category === category || card.b.category === category;
  const listed = cards.filter(inCategory).sort((x, y) => x.title.localeCompare(y.title));
  const countFor = (value: string) => cards.filter((c) => c.a.category === value || c.b.category === value).length;
  const why = ziki
    ? COMPARE_DIMENSIONS.map((dimension) => ({ dimension, entry: featureOf(ziki.features, dimension.key) })).filter(
        ({ entry }) => (entry.status === 'available' || entry.status === 'partial') && entry.note,
      )
    : [];

  return (
    <MarketingPage
      signedIn={signedIn}
      kicker="Compare"
      title={<>Ziki vs the rest. <br />Find the right AI platform.</>}
      lede="Explore how Ziki compares with other AI platforms, agent builders and automation tools. Compare features, capabilities, workflows and use cases to make an informed decision."
      actions={<a className="th-btn th-btn-dark th-btn-lg" href="#builder">Explore comparisons</a>}
    >
      <JsonLd data={directoryJsonLd(cards.length)} />

      <section className="cmp-wrap" id="builder" aria-labelledby="builder-title">
        <div className="cmp-head">
          <h2 id="builder-title">Pick two platforms</h2>
          <p>Search the catalogue, filter by type, and open a side-by-side comparison. Ziki can be either side.</p>
        </div>
        <CompareBuilder options={options} />
      </section>

      <section className="cmp-wrap" id="popular" aria-labelledby="popular-title">
        <div className="cmp-head">
          <h2 id="popular-title">Popular comparisons</h2>
        </div>
        {popular.length > 0 ? (
          <div className="cmp-grid">{popular.map((card) => <Card key={card.slug} card={card} />)}</div>
        ) : (
          <p className="cmp-empty">No popular comparisons are featured yet.</p>
        )}
        <div className="cmp-more"><a className="th-btn th-btn-light" href="#all">View all comparisons</a></div>
      </section>

      <section className="cmp-wrap" id="categories" aria-labelledby="categories-title">
        <div className="cmp-head">
          <h2 id="categories-title">Browse by category</h2>
          <p>Platforms aren’t all rivals. Each category groups products that solve the same kind of problem.</p>
        </div>
        <nav className="cmp-tiles" aria-label="Comparison categories">
          {COMPARE_CATEGORIES.map((c) => (
            <Link key={c.value} className="cmp-tile" href={`/compare?category=${c.value}#all`} aria-current={category === c.value ? 'true' : undefined}>
              <b>{c.label}</b>
              <span>{countFor(c.value)} comparisons</span>
            </Link>
          ))}
        </nav>
      </section>

      <section className="cmp-wrap" id="all" aria-labelledby="all-title">
        <div className="cmp-head">
          <h2 id="all-title">{category ? `${COMPARE_CATEGORIES.find((c) => c.value === category)?.label} comparisons` : 'All comparisons'}</h2>
          {category ? <p><Link className="cmp-link" href="/compare#all" style={{ color: 'var(--green)' }}>Show every category</Link></p> : null}
        </div>
        {listed.length > 0 ? (
          <div className="cmp-grid">{listed.map((card) => <Card key={card.slug} card={card} />)}</div>
        ) : (
          <p className="cmp-empty">Nothing in this category yet. Platforms are added as they’re verified.</p>
        )}
      </section>

      <section className="cmp-wrap" id="why" aria-labelledby="why-title">
        <div className="cmp-head">
          <h2 id="why-title">Why compare Ziki?</h2>
          <p>What Ziki does, as documented on this site and in its product. Where something isn’t verified, a comparison says so instead of guessing.</p>
        </div>
        {why.length > 0 ? (
          <div className="cmp-why">
            {why.map(({ dimension, entry }) => (
              <div key={dimension.key}>
                <h3>{dimension.label}</h3>
                <p>{entry?.note}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="cmp-empty">Ziki’s capabilities will appear here once the catalogue is loaded.</p>
        )}
      </section>
    </MarketingPage>
  );
}
