import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { requireStudio } from "@/lib/admin-session";
import { getEvent, listPublished } from "@/lib/admin-events";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { EventEditor } from "./EventEditor";

export const metadata = { title: "Kelola event" };

export const instant = false;

type Props = { params: Promise<{ id: string }> };

export default function Page({ params }: Props) {
  return (
    <main className="shell">
      <View params={params} />
    </main>
  );
}

async function View({ params }: Props) {
  await connection();

  try {
    return await Content(params);
  } catch (err) {
    if (err instanceof MissingConfigError) return <ServerNotReady />;
    throw err;
  }
}

async function Content(params: Props["params"]) {
  const { id } = await params;
  const { supabase, studio } = await requireStudio();

  // A foreign event and a missing event look the same here: RLS returns no row for
  // either, and telling them apart would confirm someone else's event id exists.
  const event = await getEvent(supabase, id);
  if (!event) notFound();

  // `public_event` serves only the newest published event per photographer. This read
  // is what lets the editor say which one that is instead of implying "terbit = tampil".
  const publishedEvents = await listPublished(supabase);

  return (
    <div className="stack">
      <div className="topbar">
        <Link href="/admin">← Semua event</Link>
      </div>

      <header className="stack">
        <p className="eyebrow">Kelola event</p>
        <h1>{event.title}</h1>
        {event.location ? <p className="lede">{event.location}</p> : null}
      </header>

      <EventEditor event={event} studioSlug={studio.slug} publishedEvents={publishedEvents} />
    </div>
  );
}
