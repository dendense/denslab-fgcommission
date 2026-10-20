"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { rupiah } from "@/lib/format";
import type { PhotographerStat } from "./stats";

type Payload = { stats: PhotographerStat[]; search: string };

const DEBOUNCE_MS = 300;

/**
 * Search box + result cards.
 *
 * The search runs on the server: every keystroke (after 300ms of quiet) hits
 * /api/admin/users?search=…, which calls `admin_photographer_stats(p_search)`. Rows are
 * never filtered in this component — `p_search` does the name/email substring match in
 * Postgres, so what is on screen is what the database matched.
 *
 * `initial` is the first page render (server-rendered), so the list is populated before any
 * JavaScript runs and an empty query needs no extra request on mount.
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
  const seq = useRef(0);

  useEffect(() => {
    // The server render already answered this exact query.
    if (query.trim() === shownFor) return;

    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query.trim())}`, {
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
        setShownFor(payload?.search ?? query.trim());
      } catch {
        if (mine === seq.current) setError("Tidak bisa menghubungi server. Coba lagi.");
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, shownFor]);

  const term = shownFor.trim();

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
          ? "Mencari…"
          : term
            ? `${rows.length} fotografer cocok dengan “${term}”`
            : `${rows.length} fotografer`}
      </p>

      {error ? (
        <p className="notice notice--warn" role="alert">
          {error}
        </p>
      ) : null}

      {rows.length === 0 && !busy ? (
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
        <div className="slots">
          {rows.map((row) => (
            <PhotographerCard key={row.photographer_id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One photographer. Numbers come from the RPC as-is — nothing here sums or derives money.
 *
 * Two labels are deliberately careful:
 *  - "Nilai booking terisi" + "belum tentu sudah dibayar": `revenue_idr` is the price of
 *    booked slots, and this project has no payments table. Calling it revenue or income
 *    would claim money that may never have moved.
 *  - "Event selesai" carries its definition inline: every day of the event is in the past
 *    (WIB). It is not the `closed` status, which means the event was withdrawn.
 */
function PhotographerCard({ row }: { row: PhotographerStat }) {
  return (
    <article className="card stack">
      <div className="day-block__head">
        <h2>{row.display_name || "(tanpa nama)"}</h2>
        <span className="badge badge--draft mono">{row.slug}</span>
      </div>

      <dl className="summary">
        <div>
          <dt>Email</dt>
          <dd>
            {row.email ? (
              <span className="mono">{row.email}</span>
            ) : (
              /* A photographer row without user_id has no account yet — 0010 returns
                 NULL for the email. "belum punya akun" says that; an empty cell would
                 read as a rendering bug. */
              <span className="lede">belum punya akun</span>
            )}
          </dd>
        </div>

        <div>
          <dt>Kontak WA</dt>
          <dd>{row.contact_wa ? <span className="mono">{row.contact_wa}</span> : "—"}</dd>
        </div>

        <div>
          <dt>Event</dt>
          <dd>
            {row.events_total}
            <span className="hint"> · {row.events_published} terbit</span>
          </dd>
        </div>

        <div>
          <dt>Event selesai</dt>
          <dd>{row.events_done}</dd>
        </div>

        <div>
          <dt>Slot</dt>
          <dd>{row.slots_total}</dd>
        </div>

        <div>
          <dt>Booking</dt>
          <dd>{row.bookings_total}</dd>
        </div>

        <div>
          <dt>Nilai booking terisi</dt>
          <dd>
            {/* NULL = no booked slot at all (sum over no rows). "—" not "Rp0": zero would
                claim a real total of zero, when the honest statement is "nothing filled". */}
            {row.revenue_idr === null ? "—" : rupiah(row.revenue_idr)}
          </dd>
        </div>
      </dl>

      {/* The two definitions that make the numbers above honest. They live here, not inline
          in the <dt>: a label long enough to hold the explanation pushes the value out of
          the row at 390px (`.summary div` is a flex row with `dt: flex 0 0 auto`). */}
      <p className="hint">
        <strong>Nilai booking terisi</strong> = harga slot yang sudah dipesan — belum tentu
        sudah dibayar, proyek ini belum mencatat pembayaran. <strong>Event selesai</strong> =
        semua hari event sudah lewat; bukan status ditutup.
      </p>

      <Link
        className="btn btn--secondary"
        href={`/admin/events/new?for=${row.photographer_id}`}
      >
        Buat event
      </Link>
    </article>
  );
}
