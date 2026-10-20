import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { anonClient, MissingConfigError, publicEnv, serviceClient } from "@/lib/supabase";
import { isUuid } from "@/lib/bookings";

/**
 * Two jobs, one file (Next 16 allows a single proxy):
 *
 * 1. Real 404s for the two public dynamic routes.
 *    Every page in this app is a Partial Prerender (cacheComponents is on), so the
 *    streamed shell locks the status at 200 before the server component ever calls
 *    notFound(). /e/nope and /booking/<foreign-token> showed the "not found" UI
 *    with HTTP 200 — indexable by crawlers. The status has to be decided before
 *    render, which is exactly what a proxy is for.
 *
 * 2. Session refresh for the admin surface.
 *    Server Components cannot write cookies, so an expired access token refreshed
 *    inside app/admin/page.tsx would be refreshed again on every single request.
 *    Here the rotated cookies land on the response, once.
 *
 * Runtime: Node.js — the Next 16 proxy default. Setting `runtime` in this file
 * throws, so it is not (and must not be) declared here.
 *
 * Cost: the matcher lists the paths below, so static assets and every other route
 * pay nothing.
 *
 * Failure policy: only a *successful query returning nothing* produces a 404.
 * A missing credential or a network/DB error falls through to normal rendering —
 * turning a valid page into a 404 because Supabase hiccuped would be worse than
 * the soft 404 this fixes.
 */

// Never throw out of the proxy: an exception here fails the whole request, so a
// Supabase outage would take the site down instead of degrading to a soft 404.
async function eventExists(slug: string): Promise<boolean> {
  try {
    const { data, error } = await anonClient().rpc("public_event", { p_slug: slug });
    if (error) return true;
    return !!(data as { event?: unknown } | null)?.event;
  } catch {
    return true;
  }
}

async function bookingExists(token: string): Promise<boolean> {
  if (!isUuid(token)) return false;
  try {
    const { data, error } = await serviceClient().rpc("booking_by_token", { p_token: token });
    if (error) return true;
    return !!data;
  } catch {
    return true;
  }
}

/**
 * Rotates the session cookie if the access token is past its refresh margin.
 * Returns the response to send, or null when nothing was written (the caller can
 * then fall through to NextResponse.next()).
 */
async function refreshSession(request: NextRequest): Promise<NextResponse | null> {
  let response: NextResponse | null = null;
  try {
    const { url, key } = publicEnv();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          response ??= NextResponse.next({ request });
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // Touching the session is what triggers a refresh; the result is not needed here
    // because the page re-reads it (and verifies it) with getUser().
    await supabase.auth.getSession();
  } catch (err) {
    // Missing config or an auth-server hiccup must not break the page: the page's own
    // getUser() check is the real gate, and it will redirect to /login.
    if (!(err instanceof MissingConfigError)) {
      console.error("proxy: session refresh", err);
    }
    return response;
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const [head, value] = segments;

  if (head === "admin" || (head === "api" && value === "admin")) {
    const refreshed = await refreshSession(request);
    if (refreshed) return refreshed;
    return NextResponse.next();
  }

  let found = true;
  if (head === "e" && value) found = await eventExists(value);
  else if (head === "booking" && value) found = await bookingExists(value);

  if (found) return NextResponse.next();

  // Rewrite (not redirect): the URL the visitor typed stays in the address bar,
  // but the response is a genuine 404 carrying not-found.tsx.
  return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
}

export const config = {
  matcher: ["/e/:slug*", "/booking/:token*", "/admin/:path*", "/api/admin/:path*"],
};
