"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dateWIB, rangeWIB, rupiah } from "@/lib/format";
import type { AdminDay, AdminEvent, AdminSlot, PublishedRef } from "@/lib/admin-events";
import { QrCard } from "@/app/admin/QrCard";
import { postJson, type ApiFailure } from "../../_api";

const BOOKED_REASON = "Slot ini sudah terisi klien — harga dan jadwalnya terkunci.";

/** Day date + "HH:MM" (WIB) → ISO instant. Asia/Jakarta has no DST, so +07:00 is exact. */
function jakartaIso(dayDate: string, time: string): string {
  return new Date(`${dayDate}T${time}:00+07:00`).toISOString();
}

type Send = (
  key: string,
  url: string,
  body: unknown,
  method?: "POST" | "PATCH" | "DELETE",
) => Promise<ApiFailure | null>;

/**
 * Everything that changes an event, in one client component.
 *
 * All writes go through /api/admin/** (session client → 0006/0007 RPCs). A successful
 * write refreshes the route instead of patching local state: the slot and booked counts
 * feed the event list too, and a locally-invented row would drift from the database.
 */
export function EventEditor({
  event,
  studioSlug,
  publishedEvents,
}: {
  event: AdminEvent;
  studioSlug: string;
  publishedEvents: PublishedRef[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  const published = event.status === "published";
  const days = [...(event.event_days ?? [])].sort((a, b) => a.day_date.localeCompare(b.day_date));

  // public_event serves exactly one event per photographer (newest created_at wins), so
  // a second published event is not "also live" — it is invisible. `publishedEvents` is
  // already newest-first, so [0] is what /e/[slug] shows right now.
  const shown = publishedEvents[0] ?? null;
  const shadowed = publishedEvents.length > 1;
  const isShown = shown?.id === event.id;

  /** One write, one busy key. Returns the failure, or null after a refresh. */
  const send: Send = async (key, url, body, method = "POST") => {
    setBusy(key);
    const res = await postJson(url, body, method);
    setBusy(null);
    if (!res.ok) return res.failure;
    router.refresh();
    return null;
  };

  async function setStatus(action: "publish" | "unpublish") {
    setFailure(null);
    const f = await send(`status:${action}`, `/api/admin/event-status/${event.id}`, { action });
    if (f) setFailure(f);
    else setConfirmUnpublish(false);
  }

  return (
    <div className="stack">
      {/* ------------------------------------------------------------ status */}
      <section className="card stack">
        <div className="day-block__head">
          <h2>Status</h2>
          <span className={`badge badge--${published ? "published" : "draft"}`}>
            {published ? "Terbit" : event.status === "closed" ? "Ditutup" : "Draf"}
          </span>
        </div>

        <p className="lede">
          {published
            ? shadowed && !isShown
              ? "Event ini terbit, tapi bukan yang tampil di halaman publik — lihat peringatan di bawah."
              : "Halaman publik aktif dan bisa dipesan klien."
            : "Event masih draf — klien belum bisa membuka halaman publiknya."}
        </p>

        {failure ? (
          <p className="notice notice--warn" role="alert">
            {failure.message}
          </p>
        ) : null}

        {published ? (
          confirmUnpublish ? (
            <div className="confirm">
              <p>
                <strong>Tarik event ini?</strong> Halaman publik dan QR akan berhenti
                berfungsi. Klien yang sudah menyimpan tautannya akan melihat halaman tidak
                ditemukan.
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={busy === "status:unpublish"}
                  aria-busy={busy === "status:unpublish" || undefined}
                  onClick={() => setStatus("unpublish")}
                >
                  {busy === "status:unpublish" ? "Menarik…" : "Ya, tarik event"}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setConfirmUnpublish(false)}
                >
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setFailure(null);
                setConfirmUnpublish(true);
              }}
            >
              Tarik event
            </button>
          )
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy === "status:publish"}
            aria-busy={busy === "status:publish" || undefined}
            onClick={() => setStatus("publish")}
          >
            {busy === "status:publish" ? "Menerbitkan…" : "Terbitkan event"}
          </button>
        )}
      </section>

      {/* ------------------------------------------------------------ days */}
      <section className="stack">
        <h2>Hari</h2>
        <p className="lede">
          Tanggal dan jam sesi. Slot dibuat per hari; hari yang punya slot terisi tidak bisa
          dihapus.
        </p>

        {days.length === 0 ? (
          <p className="notice notice--warn">
            Belum ada hari. Tambahkan satu hari dulu — event tanpa hari tidak bisa
            diterbitkan.
          </p>
        ) : (
          days.map((day) => <DayBlock key={day.id} day={day} busy={busy} send={send} />)
        )}

        <AddDayForm eventId={event.id} busy={busy} send={send} />
      </section>

      {/* ------------------------------------------------------------ public link */}
      {published ? (
        <>
          {shadowed ? (
            <div className="notice notice--warn stack" role="status">
              <p>
                <strong>Ada {publishedEvents.length} event terbit.</strong> Halaman publik
                hanya menampilkan <strong>satu</strong> event per fotografer — yang paling
                baru dibuat.
              </p>
              <p>
                {isShown ? (
                  <>
                    Saat ini yang tampil: <strong>{shown?.title}</strong> (event ini).
                  </>
                ) : (
                  <>
                    Saat ini yang tampil: <strong>{shown?.title}</strong> — bukan event ini.
                    Selama event lain itu terbit, pengunjung <code>/e/{studioSlug}</code>{" "}
                    tidak akan melihat event ini. Tarik event lain itu, atau terbitkan
                    ulang event ini kalau memang mau menampilkannya.
                  </>
                )}
              </p>
            </div>
          ) : null}
          <QrCard slug={studioSlug} />
        </>
      ) : (
        <p className="notice notice--warn">Event belum terbit — halaman publik belum aktif.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ day block */

function DayBlock({ day, busy, send }: { day: AdminDay; busy: string | null; send: Send }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = [...(day.slots ?? [])].sort((a, b) => a.seq - b.seq);
  const hasBooked = slots.some((s) => s.status === "booked");

  async function saveDay(form: FormData) {
    const dayDate = String(form.get("day_date") ?? "");
    const startTime = String(form.get("start_time") ?? "");
    const endTime = String(form.get("end_time") ?? "");
    if (endTime <= startTime) {
      setError("Jam selesai harus setelah jam mulai.");
      return;
    }
    setError(null);
    const f = await send(
      `day:${day.id}`,
      `/api/admin/event-days/${day.id}`,
      { day_date: dayDate, start_time: startTime, end_time: endTime },
      "PATCH",
    );
    if (f) setError(f.message);
    else setEditing(false);
  }

  async function removeDay() {
    setError(null);
    const f = await send(`day:del:${day.id}`, `/api/admin/event-days/${day.id}`, {}, "DELETE");
    if (f) setError(f.message);
  }

  return (
    <div className="day-block">
      <div className="day-block__head">
        <span className="day-block__title">{dateWIB(`${day.day_date}T00:00:00+07:00`)}</span>
        <span className="event-row__meta">
          {day.start_time.slice(0, 5)}–{day.end_time.slice(0, 5)} WIB · {slots.length} slot
        </span>
      </div>

      {editing ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDay(new FormData(e.currentTarget));
          }}
        >
          <div className="field">
            <label htmlFor={`d-${day.id}`}>Tanggal</label>
            <input id={`d-${day.id}`} name="day_date" type="date" defaultValue={day.day_date} required />
          </div>
          <div className="field">
            <label htmlFor={`s-${day.id}`}>Jam mulai</label>
            <input
              id={`s-${day.id}`}
              name="start_time"
              type="time"
              defaultValue={day.start_time.slice(0, 5)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`e-${day.id}`}>Jam selesai</label>
            <input
              id={`e-${day.id}`}
              name="end_time"
              type="time"
              defaultValue={day.end_time.slice(0, 5)}
              required
            />
          </div>
          <div className="btn-row btn-row--inline">
            <button
              className="btn btn--primary"
              type="submit"
              disabled={busy === `day:${day.id}`}
              aria-busy={busy === `day:${day.id}` || undefined}
            >
              {busy === `day:${day.id}` ? "Menyimpan…" : "Simpan hari"}
            </button>
            <button className="btn btn--secondary" type="button" onClick={() => setEditing(false)}>
              Batal
            </button>
          </div>
        </form>
      ) : (
        <div className="btn-row btn-row--inline">
          <button className="btn btn--secondary" type="button" onClick={() => setEditing(true)}>
            Ubah hari
          </button>
          <button
            className="btn btn--danger"
            type="button"
            disabled={hasBooked || busy === `day:del:${day.id}`}
            aria-describedby={hasBooked ? `day-lock-${day.id}` : undefined}
            onClick={removeDay}
          >
            {busy === `day:del:${day.id}` ? "Menghapus…" : "Hapus hari"}
          </button>
        </div>
      )}

      {hasBooked ? (
        <p className="slot-row__note" id={`day-lock-${day.id}`}>
          Hari ini sudah punya slot terisi — hapus booking-nya dulu kalau memang perlu
          menghapus hari.
        </p>
      ) : null}

      {error ? (
        <p className="slot-row__error" role="alert">
          {error}
        </p>
      ) : null}

      {/* --------------------------------------------------------- slots */}
      <div className="slots">
        {slots.length === 0 ? (
          <p className="slot-row__note">Belum ada slot di hari ini.</p>
        ) : (
          slots.map((slot) => <SlotRow key={slot.id} slot={slot} busy={busy} send={send} />)
        )}
      </div>

      {adding ? (
        <AddSlotForm
          day={day}
          nextSeq={slots.reduce((max, s) => Math.max(max, s.seq), 0) + 1}
          busy={busy}
          send={send}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button className="btn btn--secondary" type="button" onClick={() => setAdding(true)}>
          Tambah slot
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ slot row */

function SlotRow({ slot, busy, send }: { slot: AdminSlot; busy: string | null; send: Send }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const booked = slot.status === "booked";
  const working = busy === `slot:${slot.id}` || busy === `slot:del:${slot.id}`;

  async function toggle() {
    setError(null);
    const next = slot.status === "open" ? "closed" : "open";
    const f = await send(`slot:${slot.id}`, `/api/admin/slots/${slot.id}`, { status: next }, "PATCH");
    if (f) setError(f.message);
  }

  async function savePrice(form: FormData) {
    const price = Number(String(form.get("price_idr") ?? "").replace(/\D/g, ""));
    if (!Number.isInteger(price) || price < 0) {
      setError("Harga harus angka.");
      return;
    }
    setError(null);
    const f = await send(`slot:${slot.id}`, `/api/admin/slots/${slot.id}`, { price_idr: price }, "PATCH");
    if (f) setError(f.message);
    else setEditing(false);
  }

  async function remove() {
    setError(null);
    const f = await send(`slot:del:${slot.id}`, `/api/admin/slots/${slot.id}`, {}, "DELETE");
    if (f) setError(f.message);
  }

  return (
    <div className="slot-row">
      <div>
        <div className="slot__time">{rangeWIB(slot.starts_at, slot.ends_at)}</div>
        <div className="slot__status">
          Slot {slot.seq} · {rupiah(slot.price_idr)} ·{" "}
          {slot.status === "open" ? "Terbuka" : booked ? "Terisi" : "Ditutup"}
        </div>
      </div>

      {editing ? (
        <form
          className="stack"
          style={{ gridColumn: "1 / -1" }}
          onSubmit={(e) => {
            e.preventDefault();
            void savePrice(new FormData(e.currentTarget));
          }}
        >
          <div className="field">
            <label htmlFor={`p-${slot.id}`}>Harga (Rupiah)</label>
            <input
              id={`p-${slot.id}`}
              name="price_idr"
              type="text"
              inputMode="numeric"
              defaultValue={String(slot.price_idr)}
              required
            />
          </div>
          <div className="btn-row btn-row--inline">
            <button className="btn btn--primary" type="submit" disabled={working}>
              {working ? "Menyimpan…" : "Simpan harga"}
            </button>
            <button className="btn btn--secondary" type="button" onClick={() => setEditing(false)}>
              Batal
            </button>
          </div>
        </form>
      ) : (
        <div className="btn-row btn-row--inline">
          <button
            className="btn btn--secondary"
            type="button"
            disabled={booked || working}
            aria-describedby={booked ? `lock-${slot.id}` : undefined}
            onClick={toggle}
          >
            {slot.status === "open" ? "Tutup" : "Buka"}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={booked || working}
            aria-describedby={booked ? `lock-${slot.id}` : undefined}
            onClick={() => setEditing(true)}
          >
            Harga
          </button>
          <button
            className="btn btn--danger"
            type="button"
            disabled={booked || working}
            aria-describedby={booked ? `lock-${slot.id}` : undefined}
            onClick={remove}
          >
            Hapus
          </button>
        </div>
      )}

      {booked ? (
        <p className="slot-row__note" id={`lock-${slot.id}`}>
          {BOOKED_REASON}
        </p>
      ) : null}

      {error ? (
        <p className="slot-row__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ add forms */

function AddDayForm({ eventId, busy, send }: { eventId: string; busy: string | null; send: Send }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = `newday:${eventId}`;

  if (!open) {
    return (
      <button className="btn btn--secondary" type="button" onClick={() => setOpen(true)}>
        Tambah hari
      </button>
    );
  }

  return (
    <form
      className="day-block"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const startTime = String(form.get("start_time") ?? "");
        const endTime = String(form.get("end_time") ?? "");
        if (endTime <= startTime) {
          setError("Jam selesai harus setelah jam mulai.");
          return;
        }
        setError(null);
        const f = await send(key, "/api/admin/event-days", {
          event_id: eventId,
          day_date: String(form.get("day_date") ?? ""),
          start_time: startTime,
          end_time: endTime,
        });
        if (f) setError(f.message);
        else setOpen(false);
      }}
    >
      <h3 className="day-block__title">Hari baru</h3>

      <div className="field">
        <label htmlFor="new-day-date">Tanggal</label>
        <input id="new-day-date" name="day_date" type="date" required />
      </div>
      <div className="field">
        <label htmlFor="new-day-start">Jam mulai</label>
        <input id="new-day-start" name="start_time" type="time" required defaultValue="09:00" />
      </div>
      <div className="field">
        <label htmlFor="new-day-end">Jam selesai</label>
        <input id="new-day-end" name="end_time" type="time" required defaultValue="17:00" />
      </div>

      {error ? (
        <p className="slot-row__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="btn-row btn-row--inline">
        <button
          className="btn btn--primary"
          type="submit"
          disabled={busy === key}
          aria-busy={busy === key || undefined}
        >
          {busy === key ? "Menyimpan…" : "Simpan hari"}
        </button>
        <button className="btn btn--secondary" type="button" onClick={() => setOpen(false)}>
          Batal
        </button>
      </div>
    </form>
  );
}

function AddSlotForm({
  day,
  nextSeq,
  busy,
  send,
  onDone,
}: {
  day: AdminDay;
  nextSeq: number;
  busy: string | null;
  send: Send;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const key = `newslot:${day.id}`;

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const seq = Number(form.get("seq"));
        const start = String(form.get("start_time") ?? "");
        const end = String(form.get("end_time") ?? "");
        const price = Number(String(form.get("price_idr") ?? "").replace(/\D/g, ""));

        if (!Number.isInteger(seq) || seq < 1) {
          setError("Nomor slot harus bilangan bulat ≥ 1.");
          return;
        }
        if (end <= start) {
          setError("Jam selesai harus setelah jam mulai.");
          return;
        }
        if (!Number.isInteger(price) || price < 0) {
          setError("Harga harus angka.");
          return;
        }

        setError(null);
        const f = await send(key, "/api/admin/slots", {
          event_day_id: day.id,
          seq,
          starts_at: jakartaIso(day.day_date, start),
          ends_at: jakartaIso(day.day_date, end),
          price_idr: price,
        });
        if (f) setError(f.message);
        else onDone();
      }}
    >
      <div className="field">
        <label htmlFor={`seq-${day.id}`}>Nomor slot</label>
        <input
          id={`seq-${day.id}`}
          name="seq"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          defaultValue={nextSeq}
          required
        />
        <p className="hint">Urutan tampil di halaman publik. Harus unik per hari.</p>
      </div>

      <div className="field">
        <label htmlFor={`ns-${day.id}`}>Jam mulai</label>
        <input
          id={`ns-${day.id}`}
          name="start_time"
          type="time"
          required
          defaultValue={day.start_time.slice(0, 5)}
        />
      </div>

      <div className="field">
        <label htmlFor={`ne-${day.id}`}>Jam selesai</label>
        <input
          id={`ne-${day.id}`}
          name="end_time"
          type="time"
          required
          defaultValue={day.end_time.slice(0, 5)}
        />
      </div>

      <div className="field">
        <label htmlFor={`np-${day.id}`}>Harga (Rupiah)</label>
        <input
          id={`np-${day.id}`}
          name="price_idr"
          type="text"
          inputMode="numeric"
          defaultValue="75000"
          required
        />
        <p className="hint">Tampil sebagai {rupiah(75000)}.</p>
      </div>

      {error ? (
        <p className="slot-row__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="btn-row btn-row--inline">
        <button
          className="btn btn--primary"
          type="submit"
          disabled={busy === key}
          aria-busy={busy === key || undefined}
        >
          {busy === key ? "Menyimpan…" : "Simpan slot"}
        </button>
        <button className="btn btn--secondary" type="button" onClick={onDone}>
          Batal
        </button>
      </div>
    </form>
  );
}
