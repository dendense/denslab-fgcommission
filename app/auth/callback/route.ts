import { NextResponse, type NextRequest } from "next/server";
import { isAdmin, sessionClient } from "@/lib/auth";
import { isSchemaError } from "@/lib/db-errors";

/**
 * GET /auth/callback — the OAuth landing point.
 *
 * Supabase redirects here with `?code=…`; the code is exchanged for a session with
 * `exchangeCodeForSession`, which is the half of PKCE that needs the verifier cookie the
 * browser client wrote before leaving for Google. The session client (user JWT), never
 * the service role: `my_registration_status()` and `complete_registration()` (0013) are
 * granted to `authenticated` only, and a service client would answer 42501 with no
 * `auth.uid()` to explain it.
 *
 * Where the visitor lands — five branches, in this order:
 *
 *   photographers row                        → /admin
 *   is_admin() and no studio of his own      → /admin
 *   registration row, onboarding incomplete  → /onboarding   (form)
 *   registration row, complete but pending   → /onboarding   (waiting card)
 *   no registration row                      → /register?error=no_registration
 *
 * A schema error (0013 not applied yet) is not "no registration": `my_registration_status`
 * missing sends the visitor to /onboarding, whose own read renders the DbNotReady card
 * with the PostgREST code instead of silently re-registering them.
 */
/**
 * Origin for the redirects below.
 *
 * `new URL(request.url).origin`, same as Supabase's own callback example. On Vercel
 * `request.url` is the public URL the browser asked for; under `next start` it is the
 * server's own hostname, which is why the harness talks to `localhost` and not
 * `127.0.0.1` — a redirect to a different spelling of the same host is still correct,
 * just not the one a 127.0.0.1 probe expects.
 */
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const params = new URL(request.url).searchParams;
  const code = params.get("code");

  // Google/GoTrue report a refusal by redirecting HERE with `error`, `error_code` and
  // `error_description` — no `code` at all. Two real cases: the provider is not enabled
  // in the project, and `redirectTo` is missing from the URL allow-list. Forwarding them
  // to /login (which prints code + message) is the difference between "coba lagi" forever
  // and knowing what to switch on in the dashboard.
  const providerError = params.get("error_code") ?? params.get("error");
  if (providerError) {
    const target = new URL(`${origin}/login`);
    target.searchParams.set("error_code", providerError);
    const description = params.get("error_description");
    if (description) target.searchParams.set("error_description", description);
    return NextResponse.redirect(target);
  }

  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await sessionClient();

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    // Nothing useful to show on /login beyond "try again": the code is single-use and
    // expires in minutes, so a retry is always the right action.
    console.error("GET /auth/callback exchange", exchangeError);
    return NextResponse.redirect(`${origin}/login`);
  }

  const { data: studioId, error: studioError } = await supabase.rpc("current_photographer_id");
  if (studioError) {
    if (!isSchemaError(studioError.code)) {
      console.error("GET /auth/callback current_photographer_id", studioError);
    }
    return NextResponse.redirect(`${origin}/onboarding`);
  }
  if (studioId) return NextResponse.redirect(`${origin}/admin`);

  try {
    if (await isAdmin(supabase)) return NextResponse.redirect(`${origin}/admin`);
  } catch (err) {
    console.error("GET /auth/callback is_admin", err);
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  const { data: rows, error: regError } = await supabase.rpc("my_registration_status");
  if (regError) {
    if (!isSchemaError(regError.code)) {
      console.error("GET /auth/callback my_registration_status", regError);
    }
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  const registration = (rows ?? [])[0];
  if (!registration) {
    return NextResponse.redirect(`${origin}/register?error=no_registration`);
  }

  // Incomplete (form) and complete-but-pending (waiting card) are the same page: it
  // reads the row itself and picks the view, so the rule lives in one place.
  return NextResponse.redirect(`${origin}/onboarding`);
}
