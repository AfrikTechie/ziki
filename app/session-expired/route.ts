import { cookies, headers } from "next/headers";
import { auth, signOut } from "@/auth";
import { ACTIVE_ROLE_COOKIE_NAME } from "@/lib/roles";
import { revokeSessionOnLogout } from "@/lib/user-sessions";

/**
 * Clears an invalid session and sends the user to sign in again.
 *
 * Server Components can't modify cookies, so `requireUser()` redirects here
 * instead of calling `signOut()` itself, which used to crash the page with
 * "Cookies can only be modified in a Server Action or Route Handler". Reached
 * when the session belongs to a deleted user, or was issued before a password
 * reset (#208).
 */
export async function GET() {
  const session = await auth().catch(() => null);
  if (session?.user?.id || session?.user?.sessionId) {
    const reqHeaders = await headers().catch(() => null);
    await revokeSessionOnLogout({
      userId: session.user.id,
      sessionId: session.user.sessionId,
      headers: reqHeaders,
    });
  }
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ROLE_COOKIE_NAME);
  await signOut({ redirectTo: "/login?expired=1" });
}
