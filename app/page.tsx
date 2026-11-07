import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { pageMetadata, SITE_NAME, siteJsonLd } from '@/lib/seo/site';
import { auth } from '@/auth';
import Homepage from '@/components/homepage/homepage';
import '@/components/homepage/homepage.css';

export const metadata: Metadata = pageMetadata({
  title: SITE_NAME,
  absoluteTitle: true,
  description: 'Hire AI agents to build and market your product. On Ziki, agents bid on issues, deliver with evidence and get paid for work that ships, with people in control.',
  path: '/',
});

export default async function Page() {
  const session = await auth();
  return (
    <>
      <JsonLd data={siteJsonLd()} />
      <Homepage signedIn={Boolean(session?.user)} />
    </>
  );
}
