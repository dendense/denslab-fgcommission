import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent } from "@/lib/public-event";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { dateWIB, rangeWIB, rupiah } from "@/lib/format";
import type { Slot } from "@/lib/types";

export const metadata = { title: "Jadwal Sesi Foto" };

// No <Suspense> wrapper: the event read must finish before anything is painted,
// so an unknown slug goes straight to the 404 UI instead of flashing a loading
// card first.
export const instant = false;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ taken?: string }>;
};

// No <Suspense> wrapper on purpose: a streamed response is fixed at 200, so a
// notFound() inside a boundary would ship a "404 page" with a 200 status.
export default function Page({ params, searchParams }: Props) {
  return (
    <main className="shell shell--reading">
      <EventView params={params} searchParams={searchParams} />
    </main>
  );
}

async function EventView({ params, searchParams }: Props) {
  const { slug } = await params;
  const { taken } = await searchParams;

  const res = await getPublicEvent(slug);
  if (!res.ok) {
    if (res.reason === "not_configured") return <ServerNotReady />;
    notFound();
  }
  const data = res.data;

  const allSlots = data.days.flatMap((d) => d.slots);
  const totalOpen = allSlots.filter((s) => s.status === "open").length;

  return (
    <div className="stack">
      {taken ? (
        <p className="notice notice--warn" role="status">
          Slot ini baru saja diambil. Silakan pilih slot lain.
        </p>
      ) : null}

      <header className="card stack">
        <p className="eyebrow">Booking sesi foto</p>
        <h1>{data.event.title}</h1>
        <div className="meta">
          {data.event.location ? (
            <div>
              <strong>Lokasi:</strong> {data.event.location}
            </div>
          ) : null}
          <div>
            <strong>Fotografer:</strong> {data.photographer.display_name ?? "—"}
          </div>
          <div>
            <strong>Slot tersedia:</strong> {totalOpen} dari {allSlots.length}
          </div>
        </div>
      </header>

      {data.days.map((day) => (
        <section key={day.id}>
          <h2 className="day-heading">{dateWIB(`${day.day_date}T00:00:00+07:00`)}</h2>
          <div className="slots slots--grid">
            {day.slots.map((slot) => (
              <SlotCard key={slot.id} slot={slot} slug={slug} />
            ))}
          </div>
        </section>
      ))}

      <p className="hint">
        Semua jam dalam WIB (Asia/Jakarta). Tidak perlu membuat akun.
      </p>
    </div>
  );
}

function SlotCard({ slot, slug }: { slot: Slot; slug: string }) {
  const time = rangeWIB(slot.starts_at, slot.ends_at);
  const price = rupiah(slot.price_idr);

  if (slot.status === "open") {
    return (
      <Link className="slot slot--open" href={`/e/${slug}/book/${slot.id}`}>
        <span className="slot__time">{time}</span>
        <span className="slot__price">{price}</span>
        <span className="slot__status">Tersedia — ketuk untuk pilih</span>
      </Link>
    );
  }

  // `booked` stays visible and inert: the client needs to see which slots are gone.
  // `closed` is filtered out by the public RPC today; this branch keeps it inert if
  // that payload ever includes it.
  return (
    <div className="slot slot--taken" aria-disabled="true">
      <span className="slot__time">{time}</span>
      <span className="slot__price">{price}</span>
      <span className="slot__badge">{slot.status === "booked" ? "Terisi" : "Ditutup"}</span>
    </div>
  );
}
