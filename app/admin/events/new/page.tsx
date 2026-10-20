import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { isAdmin, sessionClient } from "@/lib/auth";
import { DbNotMigratedError, throwIfSchemaError } from "@/lib/db-errors";
import { requireStudio } from "@/lib/admin-session";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { DbNotReady } from "@/app/_components/DbNotReady";
import { NewEventForm } from "./NewEventForm";

export const metadata = { title: "Buat event" };

export const instant = false;

type Props = { searchParams: Promise<{ for?: string }> };

export default function Page({ searchParams }: Props) {
  return (
    <main className="shell">
      <View searchParams={searchParams} />
    </main>
  );
}

async function View({ searchParams }: Props) {
  await connection();

  try {
    return await Content(searchParams);
  } catch (err) {
    if (err instanceof MissingConfigError) return <ServerNotReady />;
    if (err instanceof DbNotMigratedError) return <DbNotReady error={err} />;
    throw err;
  }
}

/**
 * Two ways in, and they must not blur:
 *
 *   /admin/events/new            → my own event. Unchanged: `requireStudio()` gates it and
 *                                  `NewEventForm` posts to /api/admin/events (create_event,
 *                                  owner = current_photographer_id()).
 *   /admin/events/new?for=<uuid> → an event on behalf of that photographer. Admin only, and
 *                                  `requireStudio()` is deliberately NOT called: an admin
 *                                  without a studio is exactly who needs this path, and
 *                                  requireStudio() would bounce him to /admin.
 *
 * The `?for=` target is read through the RLS-scoped client (0010 grants admin a select
 * policy on `photographers`), so the name in the banner is the real studio name rather than
 * a title-case guess at the uuid.
 */
async function Content(searchParams: Props["searchParams"]) {
  const { for: forId } = await searchParams;

  if (forId) return <ForPhotographer photographerId={forId} />;

  const supabase = await sessionClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  // "Do I own a studio?" must be asked with `current_photographer_id()` (0004), NOT with a
  // plain select on `photographers`. Since 0010 grants admins a select policy on that table,
  // `.limit(1).maybeSingle()` returns *some other photographer's* row for an admin without a
  // studio — the gate would then let him into the form, and submit would fail with
  // `not_photographer` because create_event resolves the owner through this same function.
  const { data: myStudio, error: studioError } = await supabase.rpc("current_photographer_id");
  throwIfSchemaError(studioError);
  if (studioError) throw studioError;

  if (myStudio) {
    // Same gate as before this card: session + studio, else /login or /admin.
    await requireStudio();
    return <OwnEventForm />;
  }

  // Admin without a studio. Submitting would only ever fail with `not_photographer`
  // (0007 resolves the owner through current_photographer_id()), so say so here and point
  // at the page that can actually do the job.
  if (await isAdmin(supabase)) return <AdminWithoutStudio />;

  // Neither a studio nor an admin: /admin explains the pending-approval state.
  redirect("/admin");
}

function OwnEventForm() {
  return (
    <div className="stack">
      <div className="topbar">
        <Link href="/admin">← Kembali ke daftar event</Link>
      </div>

      <header className="stack">
        <p className="eyebrow">Event baru</p>
        <h1>Buat event</h1>
        <p className="lede">
          Event disimpan sebagai draf. Setelah hari dan slot siap, terbitkan supaya klien
          bisa memesan.
        </p>
      </header>

      <NewEventForm />
    </div>
  );
}

/** Admin, no studio of his own. Guided, not a dead end. */
function AdminWithoutStudio() {
  return (
    <div className="stack">
      <header className="stack">
        <p className="eyebrow">Event baru</p>
        <h1>Buat event</h1>
      </header>

      <p className="notice">
        Kamu admin tanpa studio. Pilih fotografer di halaman Users untuk membuat event.
      </p>

      <Link className="btn btn--primary" href="/users">
        Buka halaman Users
      </Link>
      <Link className="btn btn--secondary" href="/admin">
        Kembali ke daftar event
      </Link>
    </div>
  );
}

/**
 * Create on behalf of another photographer.
 *
 * The first day is NOT collected here. `create_event_day` (0007) authorises through
 * `current_photographer_id()`, so an admin cannot add a day to someone else's event, and
 * 0010 provides no admin day-write RPC. Asking for a date the form then cannot save would
 * be a lie; the event is created as a draft and the day is added by the owner (or by a
 * future admin RPC). Said out loud in the copy below.
 */
async function ForPhotographer({ photographerId }: { photographerId: string }) {
  const supabase = await sessionClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");
  if (!(await isAdmin(supabase))) redirect("/admin");

  const { data, error } = await supabase
    .from("photographers")
    .select("id, display_name, slug")
    .eq("id", photographerId)
    .maybeSingle();
  throwIfSchemaError(error);
  if (error) throw error;

  if (!data) {
    return (
      <div className="stack">
        <div className="topbar">
          <Link href="/users">← Kembali ke Users</Link>
        </div>
        <p className="notice notice--warn" role="alert">
          Fotografer itu tidak ditemukan. Mungkin sudah dihapus.
        </p>
      </div>
    );
  }

  const name = data.display_name || data.slug;

  return (
    <div className="stack">
      <div className="topbar">
        <Link href="/users">← Batal, kembali ke Users</Link>
      </div>

      <div className="card stack">
        <p className="eyebrow">Atas nama fotografer</p>
        <h1>Membuat event untuk {name}</h1>
        <p className="lede mono">{data.slug}</p>
      </div>

      <p className="notice">
        Event disimpan sebagai draf milik <strong>{name}</strong>. Hari dan slot ditambahkan
        dari halaman kelola event setelah event ini ada — admin tidak bisa menambah hari ke
        event milik studio lain.
      </p>

      <NewEventForm photographerId={data.id} />
    </div>
  );
}
