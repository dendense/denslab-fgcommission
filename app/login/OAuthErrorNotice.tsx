"use client";

import { useSearchParams } from "next/navigation";

/**
 * Prints an OAuth refusal that arrived as query parameters on /login.
 *
 * This is a second, separate channel from the `signInWithOAuth` error box: when the
 * project's redirect URL is not on Supabase's allow-list, GoTrue sends the browser back
 * to the site with `?error=…&error_code=…&error_description=…` and no `code`, so the app
 * never sees a rejected promise. `/auth/callback` forwards those parameters here.
 *
 * Without this, that failure is indistinguishable from a stale link: the visitor lands on
 * the login form with nothing said. `error_code` is what names the fix in the dashboard.
 *
 * Must be rendered inside a <Suspense> boundary — `useSearchParams` opts the page out of
 * static prerendering.
 */
export function OAuthErrorNotice() {
  const params = useSearchParams();
  const code = params.get("error_code") ?? params.get("error");
  if (!code) return null;

  const description = params.get("error_description");

  return (
    <div className="notice notice--warn" role="alert">
      <p>
        <strong>Google gagal.</strong> Coba lagi, atau pakai email dan password di bawah.
      </p>
      <p className="mono">code: {code}</p>
      {description ? <p className="mono">message: {description}</p> : null}
    </div>
  );
}
