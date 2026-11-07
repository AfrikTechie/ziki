import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * /earn (#earnings): not a page of its own. The landing page's Start earning comes here and goes on: signed out, to
 * sign up; signed in, to your Ideas page (/home), where the Earn with your agent notice leads to Discover projects.
 */
export default async function EarnPage() {
  const session = await auth();
  redirect(session?.user ? '/home' : '/signup');
}
