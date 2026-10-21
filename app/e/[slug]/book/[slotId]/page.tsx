import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent } from "@/lib/public-event";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { dateWIB, rangeWIB, rupiah } from "@/lib/format";
import { BookingForm } from "./BookingForm";

export const metadata = { title: "Isi Data Booking" };

// No <Suspense> wrapper: an unknown slot should land on the 404 UI directly, not
// after a loading card. (The response status is still 200 — see the note in
// app/booking/[icsToken]/page.tsx.)
export const instant = false;

type Props = { params: Promise<{ slug: string; slotId: string }> };

// No <Suspense> here: streaming fixes the status at 200, which would turn the
// notFound() for an unknown slot into a soft 404.
export default function Page({ params }: Props) {
  return (
    <main className="shell shell--reading">
      <BookView params={params} />
    </main>
  );
}

async function BookView({ params }: Props) {
  const { slug, slotId } = await params;

  const res = await getPublicEvent(slug);
  if (!res.ok) {
    if (res.reason === "not_configured") return <ServerNotReady />;
    notFound();
  }
  const data = res.data;

  const slot = data.days.flatMap((d) => d.slots).find((s) => s.id === slotId);
  if (!slot) notFound();

  // Slot already taken or closed between the list and this page: send the client
  // back to the fresh list rather than letting them fill a form that cannot submit.
  if (slot.status !== "open") {
    return (
      <div className="stack">
        <p className="notice notice--warn" role="status">
          Slot ini sudah tidak tersedia. Silakan pilih slot lain.
        </p>
        <Link className="btn btn--secondary" href={`/e/${slug}`}>
          Lihat slot lain
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="topbar">
        <Link href={`/e/${slug}`}>← Pilih slot lain</Link>
      </div>

      <header className="card stack">
        <p className="eyebrow">{data.event.title}</p>
        <h1>{rangeWIB(slot.starts_at, slot.ends_at)}</h1>
        <div className="meta">
          <div>
            <strong>Tanggal:</strong> {dateWIB(slot.starts_at)}
          </div>
          {data.event.location ? (
            <div>
              <strong>Lokasi:</strong> {data.event.location}
            </div>
          ) : null}
          <div>
            <strong>Harga:</strong> {rupiah(slot.price_idr)}
          </div>
        </div>
      </header>

      <BookingForm
        slotId={slot.id}
        slug={slug}
        priceLabel={rupiah(slot.price_idr)}
      />
    </div>
  );
}
