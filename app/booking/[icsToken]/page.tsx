import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchBookingByToken } from "@/lib/bookings";
import { MissingConfigError } from "@/lib/supabase";
import { googleCalendarUrl } from "@/lib/ics";
import { dateWIB, rangeWIB, rupiah, waLink } from "@/lib/format";

export const metadata = { title: "Booking Terkonfirmasi" };

// No <Suspense> wrapper: this page must not stream a shell before the booking
// read, or the client sees "Memuat…" and then the 404 UI appears inside a
// response whose status was already sent. (With Cache Components the route is
// still prerendered as a partial shell, so the friendly 404 ships with a 200
// plus <meta name="robots" content="noindex"> — a real 404 status would need a
// proxy-level check, out of scope for this demo.)
export const instant = false;

type Props = { params: Promise<{ icsToken: string }> };

export default function Page({ params }: Props) {
  return (
    <main className="shell">
      <Confirmation params={params} />
    </main>
  );
}

async function Confirmation({ params }: Props) {
  const { icsToken } = await params;

  let booking;
  try {
    booking = await fetchBookingByToken(icsToken);
  } catch (err) {
    // Unknown/malformed token is a 404 like any other; an unconfigured server is
    // a real outage and must not masquerade as "your booking is gone".
    if (err instanceof MissingConfigError) {
      return (
        <div className="card stack">
          <h1>Server belum siap</h1>
          <p className="lede">
            Kredensial Supabase belum diisi di server ini. Booking kamu tidak terhapus —
            hubungi fotografer untuk konfirmasi.
          </p>
        </div>
      );
    }
    throw err;
  }

  if (!booking) notFound();

  const { slot, event, photographer } = booking;

  // Same helper and same arguments as GET /api/bookings/[ics_token], so the link on
  // this page is byte-identical to the one that route returns.
  const googleUrl = googleCalendarUrl({
    uid: booking.ics_token,
    startsAt: new Date(slot.starts_at),
    endsAt: new Date(slot.ends_at),
    summary: `Sesi Foto — ${event.title}`,
    location: event.location ?? undefined,
  });
  const icsUrl = `/api/bookings/${booking.ics_token}/calendar.ics`;

  const wa = waLink(
    photographer.contact_wa,
    `Halo ${photographer.display_name ?? ""}, saya ${booking.client_name} sudah booking sesi foto ${event.title} pada ${dateWIB(slot.starts_at)} jam ${rangeWIB(slot.starts_at, slot.ends_at)}.`,
  );

  return (
    <div className="stack">
      <div className="check" aria-hidden="true">
        ✓
      </div>

      <header className="stack center">
        <h1>Booking tercatat</h1>
        <p className="lede">
          Simpan halaman ini untuk melihat detail booking. Tautan ini satu-satunya akses
          kamu — tidak ada email konfirmasi.
        </p>
      </header>

      <section className="card">
        <dl className="summary">
          <div>
            <dt>Nama</dt>
            <dd>{booking.client_name}</dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>{event.title}</dd>
          </div>
          <div>
            <dt>Tanggal</dt>
            <dd>{dateWIB(slot.starts_at)}</dd>
          </div>
          <div>
            <dt>Jam</dt>
            <dd>{rangeWIB(slot.starts_at, slot.ends_at)}</dd>
          </div>
          <div>
            <dt>Lokasi</dt>
            <dd>{event.location ?? "—"}</dd>
          </div>
          <div>
            <dt>Fotografer</dt>
            <dd>{photographer.display_name ?? "—"}</dd>
          </div>
          <div>
            <dt>Harga</dt>
            <dd>{rupiah(slot.price_idr)}</dd>
          </div>
          {booking.notes ? (
            <div>
              <dt>Catatan</dt>
              <dd>{booking.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="btn-row">
        <a
          className="btn btn--primary"
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Tambah ke Google Calendar
        </a>
        <a className="btn btn--secondary" href={icsUrl} download>
          Unduh .ics
        </a>
        {wa ? (
          <a
            className="btn btn--secondary"
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
          >
            Hubungi fotografer
          </a>
        ) : null}
      </div>

      <p className="notice notice--warn">
        Pembayaran dilakukan langsung ke fotografer di lokasi. Tidak ada pembayaran di
        halaman ini.
      </p>

      <p className="center">
        <Link className="btn btn--secondary" href={`/e/${event.slug}`}>
          Lihat jadwal lain
        </Link>
      </p>
    </div>
  );
}
