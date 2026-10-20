"use client";

import { useState } from "react";
import { dateWIB, rangeWIB, rupiah } from "@/lib/format";
import type { Slot, SlotStatus } from "@/lib/types";

// The RPC behind PATCH lives in supabase/migrations/0002_slot_status.sql. When it
// is missing, PostgREST answers PGRST202 and the route degrades it to a 500 — so a
// 500 here almost always means "migration not applied", not "try again". Say that
// instead of leaving a dead button and no explanation.
const MIGRATION_HINT =
  "Migrasi 0002 belum diterapkan. Jalankan supabase/migrations/0002_slot_status.sql di SQL Editor.";

const BOOKED_REASON = "Sudah ada klien yang booking — tidak bisa ditutup.";

type RowError = { slotId: string; message: string };

/**
 * Slot list + close/open buttons.
 *
 * Why the status is held in client state instead of only coming from the server:
 * the public `public_event` RPC returns `status in ('open','booked')` only
 * (supabase/migrations/0001_init.sql), so a slot that gets closed vanishes from
 * the payload. Re-reading the server list after a close would therefore *remove*
 * the row — the operator would see the slot disappear instead of "Ditutup", and
 * there would be no button left to reopen it. The PATCH response carries the
 * updated row, so that response is the source of truth for the toggle.
 *
 * The real fix is an admin read that includes `closed` (a new RPC in
 * supabase/, owned by Deny). Until then a page reload still hides closed slots.
 */
export function AdminSlots({ slots, dayDate }: { slots: Slot[]; dayDate?: string }) {
  const [statuses, setStatuses] = useState<Record<string, SlotStatus>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<RowError | null>(null);

  const statusOf = (slot: Slot): SlotStatus => statuses[slot.id] ?? slot.status;
  const openCount = slots.filter((s) => statusOf(s) === "open").length;

  async function toggle(slot: Slot) {
    const current = statusOf(slot);
    if (current === "booked") return;
    const next: SlotStatus = current === "open" ? "closed" : "open";

    setError(null);
    setSaving(slot.id);
    try {
      const res = await fetch(`/api/admin/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });

      if (res.ok) {
        // Trust the server's own row, not the value we sent: if the RPC ever
        // normalises or refuses silently, the UI still shows the real state.
        const body = (await res.json().catch(() => null)) as { slot?: { status?: SlotStatus } } | null;
        setStatuses((prev) => ({ ...prev, [slot.id]: body?.slot?.status ?? next }));
        return;
      }

      const body = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      const code = body?.error ?? "";

      if (res.status === 409 || code === "slot_booked") {
        // Someone booked while this page was open. Mirror the server: booked wins.
        setStatuses((prev) => ({ ...prev, [slot.id]: "booked" }));
        setError({ slotId: slot.id, message: BOOKED_REASON });
        return;
      }

      if (res.status === 500 || code === "server_error") {
        setError({ slotId: slot.id, message: MIGRATION_HINT });
        return;
      }

      // 403 means the session is fine but this slot (or the whole admin surface)
      // belongs to another account — retrying will not help.
      if (res.status === 403) {
        setError({
          slotId: slot.id,
          message:
            code === "not_admin"
              ? "Akun ini bukan admin."
              : code === "not_owner"
                ? "Slot ini bukan milik akunmu."
                : body?.message || "Kamu tidak punya akses ke slot ini.",
        });
        return;
      }

      if (res.status === 401) {
        setError({ slotId: slot.id, message: "Sesi sudah berakhir. Muat ulang lalu login lagi." });
        return;
      }

      // invalid_status (400) and anything unanticipated.
      setError({
        slotId: slot.id,
        message: body?.message || "Gagal mengubah status slot. Coba lagi.",
      });
    } catch {
      setError({ slotId: slot.id, message: "Tidak bisa menghubungi server. Coba lagi." });
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="stack">
      <h2>Slot</h2>

      <p className="lede">
        {openCount} dari {slots.length} slot masih terbuka
        {dayDate ? ` · ${dateWIB(`${dayDate}T00:00:00+07:00`)}` : null}
      </p>

      <p className="notice notice--warn">
        Menutup slot menyembunyikannya dari halaman publik. Slot yang sudah terisi
        tidak bisa diubah — batalkan booking-nya lewat SQL Editor dulu.
      </p>

      <div className="slots">
        {slots.map((slot) => {
          const status = statusOf(slot);
          const booked = status === "booked";
          const busy = saving === slot.id;
          const rowError = error?.slotId === slot.id ? error.message : null;

          return (
            <div className="slot-row" key={slot.id}>
              <div>
                <div className="slot__time">{rangeWIB(slot.starts_at, slot.ends_at)}</div>
                <div className="slot__status">
                  {rupiah(slot.price_idr)} ·{" "}
                  {status === "open" ? "Terbuka" : status === "booked" ? "Terisi" : "Ditutup"}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={booked || busy}
                aria-busy={busy || undefined}
                aria-describedby={booked ? `booked-${slot.id}` : rowError ? `err-${slot.id}` : undefined}
                title={booked ? BOOKED_REASON : undefined}
                onClick={() => toggle(slot)}
              >
                {booked ? "Tidak tersedia" : busy ? "Menyimpan…" : status === "open" ? "Tutup slot" : "Buka slot"}
              </button>

              {booked ? (
                <p className="slot-row__note" id={`booked-${slot.id}`}>
                  {BOOKED_REASON}
                </p>
              ) : null}

              {rowError ? (
                <p className="slot-row__error" id={`err-${slot.id}`} role="alert">
                  {rowError}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
