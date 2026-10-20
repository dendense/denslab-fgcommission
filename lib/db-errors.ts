/**
 * "The database is not there yet" vs "your request was wrong".
 *
 * Every gate in this app reads a table or an RPC that a migration creates. When the
 * hosted project has not had those migrations applied — or a function's declared return
 * type disagrees with its body — PostgREST answers with a *schema* error. A gate that
 * treats that as "you are not approved" locks the admin out of the very page that would
 * fix it, and a page that rethrows it prints the raw object at the user. These codes get
 * their own sentence.
 *
 *   42703     undefined_column  — a column a migration adds is not there
 *   42804     datatype mismatch — the function's declared return type ≠ its query
 *   PGRST202  function missing  — an RPC (is_admin, current_photographer_id…) does not exist
 *   PGRST205  table missing     — a table a migration adds is not there
 *
 * Client-safe on purpose: /login (a client component) needs the same predicate as the
 * server pages, so nothing here may import `next/headers` or the SSR client.
 */

/** Shape of a PostgREST error. Every field except `code` is optional in practice. */
export type DbError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const SCHEMA_CODES = ["42703", "42804", "PGRST202", "PGRST205"];

export function isSchemaError(code?: string | null): boolean {
  return !!code && SCHEMA_CODES.includes(code);
}

/**
 * What each code means, when the meaning is unambiguous. Keyed by code rather than by a
 * hardcoded list of migration numbers: the app cannot know which migration a given
 * database is missing, and guessing (the old "0003–0009" sentence) sent the reader
 * looking for files that had already been applied.
 */
const CODE_MEANINGS: Record<string, string> = {
  "42703": "kolom yang diminta tidak ada di database",
  "42804": "tipe hasil query tidak cocok dengan tipe balikan yang dideklarasikan fungsi",
  PGRST202: "fungsi yang dipanggil tidak ada di database",
  PGRST205: "tabel yang diminta tidak ada di database",
};

export const NOT_MIGRATED_TITLE = "Database menolak permintaan ini.";

/** Says which code came back, so the next debug session starts from the error, not a guess. */
export function notMigratedDetail(code: string): string {
  const meaning = CODE_MEANINGS[code];
  return (
    `Ini masalah database, bukan salah isian — tidak ada yang perlu diubah di form. ` +
    (meaning ? `Kode ${code}: ${meaning}. ` : `Kode ${code}. `) +
    "Perbaikannya di sisi database: cocokkan skema dengan migrasi terakhir di repo, " +
    "lalu muat ulang halaman."
  );
}

/**
 * Thrown by lib/auth.isAdmin() so route handlers can answer 503 instead of 500.
 * Carries the whole PostgREST error, not just the code: `details` is what names the
 * exact column and type, and dropping it is why 42804 was undiagnosable from the screen.
 */
export class DbNotMigratedError extends Error {
  /** The original PostgREST error — what DbNotReady renders. */
  readonly db: DbError;

  constructor(error: DbError | string) {
    const db: DbError = typeof error === "string" ? { code: error } : error;
    super(`${NOT_MIGRATED_TITLE} (${db.code ?? "unknown"})`);
    this.name = "DbNotMigratedError";
    this.db = db;
  }

  get code(): string {
    return this.db.code ?? "unknown";
  }
}

/**
 * `if (error) throw ...` for every read the admin pages depend on: a schema error becomes
 * DbNotMigratedError (rendered as the "belum siap" card), anything else is rethrown as-is.
 */
export function throwIfSchemaError(error: DbError | null): void {
  if (error && isSchemaError(error.code)) throw new DbNotMigratedError(error);
}
