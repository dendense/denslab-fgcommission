import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — carries the user's session in cookies, so the same
 * cookie is what the server components and route handlers read. No service role
 * key here: everything this client does is subject to RLS.
 *
 * Lazily created once per tab; `createBrowserClient` is not free and re-creating it
 * on every render would drop the in-memory session between calls.
 */
let client: SupabaseClient | null = null;

export function browserClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase env not configured in this build.");
    client = createBrowserClient(url, key);
  }
  return client;
}
