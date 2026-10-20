import { NOT_MIGRATED_TITLE, notMigratedDetail } from "@/lib/db-errors";

/**
 * Rendered instead of the page body when the query failed because a migration has not
 * been applied. Not an error page and not a spinner: it names the code, because
 * "Memuat…" forever is what made this bug expensive to find.
 */
export function DbNotReady({ code }: { code: string }) {
  return (
    <div className="card stack">
      <p className="eyebrow">Belum siap</p>
      <h1>{NOT_MIGRATED_TITLE}</h1>
      <p className="lede">{notMigratedDetail(code)}</p>
      <p className="mono">kode error: {code}</p>
    </div>
  );
}
