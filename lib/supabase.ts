import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class MissingConfigError extends Error {
  constructor(missing: string[]) {
    super(`Supabase env not configured: ${missing.join(", ")}`);
    this.name = "MissingConfigError";
  }
}

function env(...names: string[]): { url: string; key: string } {
  const missing: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  const key = names.map((n) => process.env[n]).find((v) => !!v) ?? "";
  if (!key) missing.push(names[0]);
  if (missing.length) throw new MissingConfigError(missing);
  return { url, key };
}

/**
 * Service role client — bypasses RLS. Server-only: never import this from a
 * client component. Used for writes (bookings) and for the private read behind
 * an ics_token.
 */
export function serviceClient(): SupabaseClient {
  const { url, key } = env("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Anon client — every read goes through RLS. Public endpoints use this so a
 * policy regression shows up as an empty result instead of a silent leak.
 */
export function anonClient(): SupabaseClient {
  const { url, key } = env("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * URL + anon key, for callers that build their own client. Only lib/auth.ts uses
 * this today: the session client has to be created per request with the request's
 * cookies, so it cannot live here (this module is also imported by proxy.ts).
 */
export function publicEnv(): { url: string; key: string } {
  return env("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
}

/** Maps a thrown config error to a 503 body; returns null when it is not one. */
export function configErrorResponse(err: unknown): Response | null {
  if (err instanceof MissingConfigError) {
    return Response.json(
      { error: "not_configured", message: "Server Supabase belum dikonfigurasi." },
      { status: 503 },
    );
  }
  return null;
}
