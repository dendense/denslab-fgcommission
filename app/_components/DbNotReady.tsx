import {
  DbNotMigratedError,
  NOT_MIGRATED_TITLE,
  notMigratedDetail,
  type DbError,
} from "@/lib/db-errors";

/**
 * Rendered instead of the page body when the query failed because of the database, not
 * because of what the user typed. Not an error page and not a spinner: it prints the
 * PostgREST `code`, `message`, `details` and `hint` as labelled text, because
 * "Memuat…" forever — and a raw `{code, details, hint, message}` object — is what made
 * this class of bug expensive to find.
 *
 * `details` is the line that names the exact column and type ("Returned type character
 * varying(255) does not match expected type text in column 5"), so it is never dropped.
 *
 * Accepts either the raw PostgREST error or the DbNotMigratedError that wraps it — the
 * wrapper's own `.message` is a sentence, not the database's, and printing it here is how
 * the readable card would silently lose the one field that diagnoses the failure.
 *
 * `children` is the action slot: a page that can log the user out puts that button here.
 */
export function DbNotReady({
  error,
  children,
}: {
  error: DbError | DbNotMigratedError;
  children?: React.ReactNode;
}) {
  const db: DbError = error instanceof DbNotMigratedError ? error.db : error;
  const code = db.code ?? "unknown";

  return (
    <div className="card stack">
      <p className="eyebrow">Belum siap</p>
      <h1>{NOT_MIGRATED_TITLE}</h1>
      <p className="lede">{notMigratedDetail(code)}</p>

      <div className="meta">
        <p className="mono">code: {code}</p>
        {db.message ? <p className="mono">message: {db.message}</p> : null}
        {db.details ? <p className="mono">details: {db.details}</p> : null}
        {db.hint ? <p className="mono">hint: {db.hint}</p> : null}
      </div>

      {children}
    </div>
  );
}
