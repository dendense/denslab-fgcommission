"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson, type ApiFailure } from "../../_api";

/**
 * Create event + its first day.
 *
 * Two RPCs, deliberately not wrapped in a transaction: `create_event` returns a draft
 * event and `create_event_day` attaches the day. If the day fails, the draft event
 * stays — and this form says so with a link to it. Silently rolling back would hide a
 * real event the photographer can still finish editing; there is no delete-and-retry
 * RPC call in the UI to undo it, and the draft is harmless (it is not published).
 *
 * No description field: `events` has no description column (0001).
 *
 * `photographerId` switches the submit to the admin "on behalf of" path — a different route
 * and RPC, and no first day in the same submit. Without the prop the behaviour is exactly
 * what it was before (create_event + create_event_day).
 */
export function NewEventForm({ photographerId }: { photographerId?: string } = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  // Set when the event landed but the day did not: the draft exists, so the message
  // must link to it instead of inviting a retry that would create a second event.
  const [orphan, setOrphan] = useState<{ id: string; message: string } | null>(null);

  // Admin creating on behalf of a photographer: different RPC, different route, and no day
  // in the same submit (0007's create_event_day cannot write to someone else's event).
  const forOther = !!photographerId;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const title = String(form.get("title") ?? "").trim();
    const location = String(form.get("location") ?? "").trim();
    const dayDate = String(form.get("day_date") ?? "");
    const startTime = String(form.get("start_time") ?? "");
    const endTime = String(form.get("end_time") ?? "");

    setFailure(null);
    setOrphan(null);

    if (!title) {
      setFailure({ error: "invalid_title", message: "Judul tidak boleh kosong." });
      return;
    }

    if (forOther) {
      setBusy(true);
      const created = await postJson<{ event: { id: string } }>("/api/admin/users/events", {
        photographer_id: photographerId,
        title,
        location: location || null,
      });

      if (!created.ok) {
        setBusy(false);
        setFailure(created.failure);
        return;
      }

      const id = created.data.event?.id;
      if (!id) {
        setBusy(false);
        setFailure({ error: "server_error", message: "Event dibuat tapi id-nya tidak terbaca." });
        return;
      }

      router.push(`/admin/events/${id}`);
      return;
    }

    if (!dayDate) {
      setFailure({ error: "invalid_date", message: "Tanggal hari pertama wajib diisi." });
      return;
    }
    // Checked here as well as on the server: the server's invalid_time answer arrives
    // only after create_event already landed, which would leave a junk draft behind.
    // Catching it in the browser keeps that draft from existing at all; the server
    // rule stays the source of truth for the API.
    if (endTime <= startTime) {
      setFailure({ error: "invalid_time", message: "Jam selesai harus setelah jam mulai." });
      return;
    }

    setBusy(true);

    const created = await postJson<{ event: { id: string } }>("/api/admin/events", {
      title,
      location: location || null,
    });

    if (!created.ok) {
      setBusy(false);
      setFailure(created.failure);
      return;
    }

    const eventId = created.data.event?.id;
    if (!eventId) {
      setBusy(false);
      setFailure({ error: "server_error", message: "Event dibuat tapi id-nya tidak terbaca." });
      return;
    }

    // Canonical nested route (app/api/admin/events/[id]/days). The older flat
    // /api/admin/event-days adapter exists only for the editor written by an earlier
    // run; new code uses the path the event id belongs in.
    const day = await postJson(`/api/admin/events/${eventId}/days`, {
      day_date: dayDate,
      start_time: startTime,
      end_time: endTime,
    });

    if (!day.ok) {
      setBusy(false);
      setOrphan({ id: eventId, message: day.failure.message });
      return;
    }

    router.push(`/admin/events/${eventId}`);
  }

  if (orphan) {
    return (
      <div className="stack">
        <p className="notice notice--warn" role="alert">
          Event tersimpan sebagai draf, tapi hari gagal ditambahkan. Tambahkan hari di
          halaman kelola event.
        </p>
        <p className="lede">
          Penyebabnya: {orphan.message} Event tidak dihapus — buka event-nya untuk
          melengkapi hari dari sana.
        </p>
        <a className="btn btn--primary" href={`/admin/events/${orphan.id}`}>
          Buka halaman kelola event
        </a>
        <a className="btn btn--secondary" href="/admin">
          Kembali ke daftar event
        </a>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="title">Judul event</label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={120}
          autoComplete="off"
          placeholder="Sesi foto keluarga"
          aria-describedby="title-hint"
        />
        <p className="hint" id="title-hint">
          Nama yang dilihat klien di halaman publik.
        </p>
      </div>

      <div className="field">
        <label htmlFor="location">Lokasi</label>
        <input
          id="location"
          name="location"
          type="text"
          maxLength={160}
          autoComplete="off"
          placeholder="Studio, Bandung"
        />
        <p className="hint">Boleh dikosongkan kalau belum pasti.</p>
      </div>

      {/* The day fieldset is hidden on the ?for= path: create_event_day (0007) only writes
          to an event owned by the caller, so a date typed here would be discarded. Better
          to not ask than to silently drop an answer. */}
      {forOther ? null : (
        <fieldset className="stack" style={{ border: 0 }}>
          <legend className="field-label">Hari pertama</legend>
          <p className="lede">
            Event tanpa hari tidak bisa diterbitkan. Hari lain bisa ditambahkan setelahnya.
          </p>

          <div className="field">
            <label htmlFor="day_date">Tanggal</label>
            <input id="day_date" name="day_date" type="date" required />
          </div>

          <div className="field">
            <label htmlFor="start_time">Jam mulai</label>
            <input id="start_time" name="start_time" type="time" required defaultValue="09:00" />
          </div>

          <div className="field">
            <label htmlFor="end_time">Jam selesai</label>
            <input id="end_time" name="end_time" type="time" required defaultValue="17:00" />
          </div>

          <p className="hint">Jam dalam WIB (Asia/Jakarta).</p>
        </fieldset>
      )}

      {failure ? (
        <p className="notice notice--warn" role="alert">
          {failure.message}
        </p>
      ) : null}

      <button className="btn btn--primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Menyimpan…" : "Simpan event"}
      </button>
    </form>
  );
}
