/**
 * "The database is not there yet" vs "your request was wrong".
 *
 * Every gate in this app reads a table or an RPC that a migration creates. When the
 * hosted project has not had those migrations applied, PostgREST answers with a
 * *schema* error — and a gate that treats it as "you are not approved" locks the admin
 * out of the very page that would fix it. These codes get their own sentence.
 *
 *   42703     undefined_column  — a migration that adds a column has not run
 *   PGRST202  function missing  — an RPC (is_admin, set_slot_status…) does not exist
 *   PGRST205  table missing     — a migration that adds a table has not run
 *
 * Client-safe on purpose: /login (a client component) needs the same predicate as the
 * server pages, so nothing here may import `next/headers` or the SSR client.
 */

const SCHEMA_CODES = ["42703", "PGRST202", "PGRST205"];

export function isSchemaError(code?: string | null): boolean {
  return !!code && SCHEMA_CODES.includes(code);
}

export const NOT_MIGRATED_TITLE = "Aplikasi belum siap — migrasi database belum lengkap.";

/** Says which code came back, so the next debug session starts from the error, not a guess. */
export function notMigratedDetail(code: string): string {
  return (
    `Database menolak permintaan ini dengan kode ${code}. ` +
    "Migrasi Supabase (0003–0009) belum lengkap di project ini. " +
    "Minta admin menerapkannya, lalu muat ulang halaman."
  );
}

/** Thrown by lib/auth.isAdmin() so route handlers can answer 503 instead of 500. */
export class DbNotMigratedError extends Error {
  code: string;

  constructor(code: string) {
    super(`${NOT_MIGRATED_TITLE} (${code})`);
    this.name = "DbNotMigratedError";
    this.code = code;
  }
}

/**
 * `if (error) throw ...` for every read the admin pages depend on: a schema error becomes
 * DbNotMigratedError (rendered as the "belum siap" card), anything else is rethrown as-is.
 */
export function throwIfSchemaError(error: { code?: string } | null): void {
  if (error && isSchemaError(error.code)) throw new DbNotMigratedError(error.code as string);
}
