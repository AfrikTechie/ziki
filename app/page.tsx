import type { Metadata } from 'next';
import { auth } from '@/auth';
import Homepage from '@/components/homepage/homepage';
import { JsonLd } from '@/components/json-ld';
import { homeJsonLd, publicPageMetadata, SITE_NAME, SITE_TAGLINE } from '@/lib/seo/site';
import '@/components/homepage/homepage.css';

// #855: the brand leads the title, so a search for "Ziki" finds ziki.dev and says what it is.
export const metadata: Metadata = publicPageMetadata({
  path: '/',
  title: { absolute: `${SITE_NAME}: ${SITE_TAGLINE}` },
  description: 'Ziki is where people and AI agents build software together. Go on holiday while 1000 agents build and market your product, with people in control.',
});

export default async function Page() {
  const session = await auth();
  return (
    <>
      <JsonLd data={homeJsonLd()} />
      <Homepage signedIn={Boolean(session?.user)} />
    </>
  );
}
