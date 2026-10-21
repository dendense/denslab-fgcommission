"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotographerStat } from "./stats";

type Payload = { stats: PhotographerStat[]; search: string };

const DEBOUNCE_MS = 300;

/**
 * Search box + one row per photographer, with archive / unarchive / delete.
 *
 * The search runs on the server: every keystroke (after 300ms of quiet) hits
 * /api/admin/users?search=…, which calls `admin_photographer_stats(p_search)`. Rows are
 * never filtered here — `p_search` does the name/email substring match in Postgres, so what
 * is on screen is what the database matched.
 *
 * Writes go to the same route (POST) and then re-read the *current* search, not the initial
 * one: after archiving, the row must come back marked, and after deleting, it must be gone —
 * both come from the database, not from a local flag that could disagree with it.
 *
 * Ordering is presentational only: active rows first, archived rows last, each group keeping
 * the RPC's order. Archived rows are never hidden — `/users` is the only place "Pulihkan"
 * can live.
 *
 * Stale responses are dropped by sequence number, not by abort: a slow "st" answering after
 * a fast "studio" would otherwise overwrite the newer results.
 */
export function UsersList({ initial }: { initial: Payload }) {
  const [rows, setRows] = useState(initial.stats);
  const [query, setQuery] = useState(initial.search);
  const [shownFor, setShownFor] = useState(initial.search);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (term: string) => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(term)}`, {
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as
        | (Payload & { error?: string; message?: string })
        | null;

      if (mine !== seq.current) return;

      if (!res.ok) {
        setError(payload?.message ?? "Pencarian gagal. Coba lagi.");
        return;
      }
      setRows(payload?.stats ?? []);
      setShownFor(payload?.search ?? term);
    } catch {
      if (mine === seq.current) setError("Tidak bisa menghubungi server. Coba lagi.");
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    // The server render already answered this exact query.
    if (query.trim() === shownFor) return;

    const timer = setTimeout(() => void load(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, shownFor, load]);

  async function act(row: PhotographerStat, action: "archive" | "unarchive" | "delete") {
    const studio = row.display_name || row.slug;

    if (action === "delete" && !window.confirm(`Hapus ${studio}? Fotografer dengan event tidak bisa dihapus.`)) {
      return;
    }

    setRowError(null);
    setWorking(row.photographer_id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photographer_id: row.photographer_id, action }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setRowError({
          id: row.photographer_id,
          message: body?.message ?? "Gagal memproses. Coba lagi.",
        });
        return;
      }

      await load(shownFor);
    } catch {
      setRowError({ id: row.photographer_id, message: "Tidak bisa menghubungi server." });
    } finally {
      setWorking(null);
    }
  }

  const term = shownFor.trim();

  // Active first, archived last; `sort` is stable, so the RPC's order survives inside each
  // group.
  const ordered = [...rows].sort(
    (a, b) => Number(a.archived_at != null) - Number(b.archived_at != null),
  );

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="search">Cari fotografer</label>
        <input
          id="search"
          name="search"
          type="search"
          autoComplete="off"
          placeholder="Nama studio atau email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby="search-hint"
        />
        <p className="hint" id="search-hint">
          Substring, tidak peka huruf besar-kecil. Kosongkan untuk melihat semua.
        </p>
      </div>

      {/* Announced, not shouted: the count and the busy state both matter to a screen
          reader user who cannot see the list re-render. */}
      <p className="lede" role="status" aria-live="polite">
        {busy
          ? "Memuat…"
          : term
            ? `${rows.length} fotografer cocok dengan “${term}”`
            : `${rows.length} fotografer`}
      </p>

      {error ? (
        <p className="notice notice--warn" role="alert">
          {error}
        </p>
      ) : null}

      {ordered.length === 0 && !busy ? (
        <div className="card stack">
          <h2>Tidak ada hasil</h2>
          <p className="lede">
            {term ? (
              <>
                Tidak ada nama studio atau email yang mengandung <strong>“{term}”</strong>.
                Coba kata lain, atau kosongkan kolom pencarian.
              </>
            ) : (
              "Belum ada fotografer terdaftar."
            )}
          </p>
        </div>
      ) : (
        /* Focusable region: at 390px the table is wider than the screen, and a keyboard user
           needs somewhere to put focus before the arrow keys can scroll it. */
        <div className="table-wrap" role="region" aria-label="Daftar fotografer" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Studio</th>
                <th scope="col">Instagram</th>
                <th scope="col">WA</th>
                <th scope="col">Status</th>
                <th scope="col">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => {
                // `!= null` (loose) on purpose: a database that has not had 0019 applied
                // returns no `archived_at` at all, and `undefined !== null` would label
                // every studio as archived.
                const archived = row.archived_at != null;
                const isWorking = working === row.photographer_id;
                const err = rowError?.id === row.photographer_id ? rowError.message : null;

                return (
                  <tr key={row.photographer_id} data-archived={archived || undefined}>
                    <th scope="row">{row.display_name || row.slug}</th>
                    <td data-label="Instagram">
                      {row.instagram ? (
                        <a
                          className="link mono"
                          href={`https://www.instagram.com/${row.instagram}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          @{row.instagram}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="mono" data-label="WA">
                      {row.contact_wa || "—"}
                    </td>
                    <td data-label="Status">
                      <span className={`badge badge--${archived ? "draft" : "published"}`}>
                        {archived ? "Diarsipkan" : "Aktif"}
                      </span>
                    </td>
                    <td>
                      <div className="btn-row btn-row--inline">
                        {archived ? (
                          <button
                            type="button"
                            className="btn btn--secondary"
                            disabled={isWorking}
                            aria-busy={isWorking || undefined}
                            onClick={() => act(row, "unarchive")}
                          >
                            Pulihkan
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--secondary"
                            disabled={isWorking}
                            aria-busy={isWorking || undefined}
                            onClick={() => act(row, "archive")}
                          >
                            Arsipkan
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--danger"
                          disabled={isWorking}
                          onClick={() => act(row, "delete")}
                        >
                          Hapus
                        </button>
                      </div>

                      {err ? (
                        <p className="slot-row__error" role="alert">
                          {err}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
