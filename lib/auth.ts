import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { configErrorResponse, publicEnv } from "./supabase";
import { DbNotMigratedError, isSchemaError } from "./db-errors";

/**
 * Supabase client bound to the request's session cookie — the replacement for the
 * service role client in every admin path.
 *
 * Why this exists: since 0004, `set_slot_status` / `admin_event` authorise against
 * `auth.uid()`, and the service role has no `auth.uid()` — every call would come
 * back `not_owner`. A user-session client carries the JWT, so the RPCs see the real
 * photographer and RLS applies to plain table reads too.
 *
 * One client per request: it holds a storage snapshot, so reusing it across
 * requests would serve one user's session to another.
 */
export async function sessionClient(): Promise<SupabaseClient> {
  const { url, key } = publicEnv();
  const store = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components cannot write cookies. The refresh still happened in
          // memory and proxy.ts persists it on the way out, so a swallowed write
          // here is not a lost login — only a duplicate refresh on the next read.
        }
      },
    },
  });
}

/**
 * `true` only for a signed-in user with a row in `admin_users`.
 *
 * RPC `is_admin()` (0005, security definer, grant `authenticated`) rather than a select
 * on `admin_users`: it is the same predicate the RLS policies use, so the gate and the
 * policies cannot disagree, and it answers `false` for anon instead of erroring.
 *
 * Throws DbNotMigratedError when the function itself is missing — 0005 not applied is
 * "database not ready", never "this account is not an admin".
 */
export async function isAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    if (isSchemaError(error.code)) throw new DbNotMigratedError(error.code as string);
    throw error;
  }
  return data === true;
}

export type Guard =
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; response: Response };

function deny(status: number, error: string, message: string): Guard {
  return { ok: false, response: Response.json({ error, message }, { status }) };
}

/**
 * Route guard: no session → 401.
 *
 * `getUser()` (not `getSession()`) because it verifies the JWT with the auth
 * server; `getSession()` trusts whatever the cookie says.
 */
export async function requireUser(): Promise<Guard> {
  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return deny(401, "unauthorized", "Perlu login untuk melakukan ini.");
    }
    return { ok: true, supabase, user: data.user };
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return { ok: false, response: cfg };
    throw err;
  }
}

/**
 * Route guard: no session → 401, signed in but not an admin → 403 `not_admin`.
 *
 * The two codes are deliberately different — the UI must be able to tell "log in"
 * apart from "you are logged in and still not allowed".
 */
export async function requireAdmin(): Promise<Guard> {
  const guard = await requireUser();
  if (!guard.ok) return guard;

  try {
    if (!(await isAdmin(guard.supabase))) {
      return deny(403, "not_admin", "Hanya admin yang boleh melakukan ini.");
    }
  } catch (err) {
    console.error("requireAdmin", err);
    if (err instanceof DbNotMigratedError) {
      return deny(503, "not_migrated", "Aplikasi belum siap — migrasi database belum lengkap.");
    }
    return deny(500, "server_error", "Terjadi kesalahan di server.");
  }

  return guard;
}
