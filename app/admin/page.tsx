import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MissingConfigError } from "@/lib/supabase";
import { isAdmin, sessionClient } from "@/lib/auth";
import { DbNotMigratedError, throwIfSchemaError } from "@/lib/db-errors";
import { listEvents, slotCounts, firstDayDate, type AdminEvent } from "@/lib/admin-events";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { DbNotReady } from "@/app/_components/DbNotReady";
import { dateWIB } from "@/lib/format";
import { AccessRequests, type AccessRequest } from "./AccessRequests";
import { LogoutButton } from "./LogoutButton";

export const metadata = { title: "Admin — Event" };

// Opted out of the static-shell check: everything here depends on the session.
export const instant = false;

// No <Suspense>: streaming pins the status to 200, which would turn the redirect
// below into a soft one and flash the admin shell at a logged-out visitor.
export default function Page() {
  return (
    <main className="shell shell--wide">
      <AdminView />
    </main>
  );
}

async function AdminView() {
  // The build machine has no Supabase credentials and no session; prerendering this
  // would bake a shell instead of a request-time decision.
  await connection();

  try {
    return await Content();
  } catch (err) {
    if (err instanceof MissingConfigError) return <ServerNotReady />;
    // A missing migration is a state, not a crash: name the code instead of hanging on
    // a loading state or throwing a 500 nobody can read.
    if (err instanceof DbNotMigratedError) return <DbNotReady error={err} />;
    throw err;
  }
}

/**
 * Session + studio are read here rather than through requireStudio() on purpose:
 * requireStudio() sends a signed-in user without a studio row to /admin, which is this
 * page — a redirect loop. The "menunggu persetujuan" card is the real destination.
 *
 * Three doors, not one. An admin who has no `photographers` row of his own is still an
 * admin — that is the whole point of `admin_users` being a separate table — so the gate
 * asks `is_admin()` before deciding an account is unapproved.
 *
 * `Registration` is the shape `my_registration_status()` returns (0017 added `note`); it
 * is declared here rather than imported because this page only ever reads `status` and
 * `note` from it.
 */
type Registration = { status: string; note: string | null };

async function Content() {
  const supabase = await sessionClient();

  // getUser(), not getSession(): the JWT is verified with the auth server instead
  // of trusting whatever the cookie claims.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  // "Do I own a studio?" must be asked with `current_photographer_id()` (0004), NOT with a
  // plain select on `photographers`. Since 0010 added `photographers_admin_select`
  // (`using (is_admin())`), `.limit(1).maybeSingle()` returns *some other* photographer's
  // row for an admin — this page then greeted him with a stranger's studio name and listed
  // every studio's events. The RPC is also the predicate create_event (0007) uses, so the
  // gate here cannot disagree with the write path.
  const { data: studioId, error: idError } = await supabase.rpc("current_photographer_id");

  // Read the row by primary key: `id` came from the caller's own session, so it can only
  // be the caller's studio.
  let me: { id: string; slug: string; display_name: string | null } | null = null;
  let meError = idError;
  if (!idError && studioId) {
    const read = await supabase
      .from("photographers")
      .select("id, slug, display_name")
      .eq("id", studioId)
      .maybeSingle();
    me = read.data;
    meError = read.error;
  }

  if (meError) {
    console.error("admin: photographers read", meError);
    throwIfSchemaError(meError);
    return (
      <div className="card stack">
        <h1>Gagal memuat akun</h1>
        <p className="lede">
          Data fotografer tidak bisa dibaca. Coba muat ulang; kalau tetap gagal,
          hubungi admin.
        </p>
        <LogoutButton />
      </div>
    );
  }

  // Branch 2: no studio row. Admin or not — that is the question this page used to skip.
  if (!me) {
    const admin = await isAdmin(supabase);

    if (!admin) {
      // Signed in, not a photographer, not an admin. Two different accounts land here and
      // they must not get the same sentence: `pending` is in the queue, `rejected` was
      // already decided against. 0017 added `note` to `my_registration_status()`, so this
      // page can say which — before, a rejected user was told to wait for a decision that
      // had already been made. No row at all (a pre-0005 account) falls through to the
      // waiting text, because /register is where that gets fixed.
      const { data: rows, error: statusError } = await supabase.rpc("my_registration_status");
      throwIfSchemaError(statusError);
      if (statusError) throw statusError;

      const registration = ((rows ?? []) as Registration[])[0];

      if (registration?.status === "rejected") {
        const reason = registration.note?.trim();
        return (
          <div className="card stack">
            <p className="eyebrow">Pendaftaran ditolak</p>
            <h1>Akses studio belum diberikan.</h1>
            <p className="lede">
              Admin menolak permintaan akses untuk <strong>{auth.user.email}</strong>.
              Pendaftaran yang ditolak sudah dihapus, jadi mulai pendaftaran baru dari
              halaman daftar.
            </p>
            {reason ? (
              <div className="notice notice--warn">
                <p className="eyebrow">Alasan dari admin</p>
                <p>{reason}</p>
              </div>
            ) : null}
            <Link className="btn btn--primary" href="/register">
              Buka halaman daftar
            </Link>
            <LogoutButton />
          </div>
        );
      }

      return (
        <div className="card stack">
          <p className="eyebrow">Menunggu persetujuan</p>
          <h1>Akunmu belum disetujui admin.</h1>
          <p className="lede">
            Pendaftaran untuk <strong>{auth.user.email}</strong> sudah masuk. Admin akan
            meninjau dan mengaktifkan akses studio.
          </p>
          <LogoutButton />
        </div>
      );
    }

    return <AdminWithoutStudio email={auth.user.email ?? ""} supabase={supabase} />;
  }

  const admin = await isAdmin(supabase);

  let events: AdminEvent[] = [];
  let listError = false;
  try {
    events = await listEvents(supabase);
  } catch (err) {
    console.error("admin: events read", err);
    if (err instanceof DbNotMigratedError) throw err;
    listError = true;
  }

  const queue = admin ? await readQueue(supabase) : { pending: [] };

  return (
    <div className="stack">
      <header className="stack">
        <p className="eyebrow">{admin ? "Admin" : "Fotografer"}</p>
        <h1>{me.display_name || "Studio"}</h1>
        <p className="lede mono">{auth.user.email}</p>
      </header>

      {admin ? (
        <section className="stack">
          <h2>Pendaftar</h2>
          <p className="lede">
            Menyetujui membuatkan studio untuk pendaftar itu. Menolak <strong>menghapus</strong>{" "}
            pendaftarannya — akun Google-nya tetap ada, tapi dia harus mendaftar ulang dari
            awal lewat tombol di halaman daftar.
          </p>
          <AccessRequests pending={queue.pending} />
        </section>
      ) : null}

      <section className="stack">
        <h2>Event</h2>

        {listError ? (
          <p className="notice notice--warn" role="alert">
            Daftar event gagal dimuat. Coba muat ulang; kalau tetap gagal, hubungi admin.
          </p>
        ) : events.length === 0 ? (
          <>
            <p className="notice notice--ok">
              Belum ada event. Buat event pertamamu, lalu tambahkan hari dan slot supaya
              klien bisa memesan.
            </p>
            <Link className="btn btn--primary" href="/admin/events/new">
              Buat event
            </Link>
          </>
        ) : (
          <>
            <p className="lede">
              Ketuk event untuk mengatur hari, slot, dan tautan publiknya.
            </p>

            <div className="slots slots--events">
              {events.map((event) => {
                const { total, booked } = slotCounts(event);
                const day = firstDayDate(event);
                return (
                  <Link className="event-row" href={`/admin/events/${event.id}`} key={event.id}>
                    <span className="event-row__title">{event.title}</span>
                    <span className="event-row__meta">
                      {day ? dateWIB(`${day}T00:00:00+07:00`) : "Belum ada hari"}
                    </span>
                    <span className="event-row__meta">
                      <span
                        className={`badge badge--${
                          event.status === "published" ? "published" : "draft"
                        }`}
                      >
                        {event.status === "published"
                          ? "Terbit"
                          : event.status === "closed"
                            ? "Ditutup"
                            : "Draf"}
                      </span>{" "}
                      · {total} slot · {booked} terisi
                    </span>
                  </Link>
                );
              })}
            </div>

            <Link className="btn btn--secondary" href="/admin/events/new">
              Buat event
            </Link>
          </>
        )}
      </section>

      <LogoutButton />
    </div>
  );
}

/**
 * The queue: pending rows only, in arrival order.
 *
 * `rejected` used to be read here too (0017 made it actionable). 0019 deletes the row on
 * rejection, so there is nothing to list and no restore button to offer — reading a status
 * that no longer exists would only produce an always-empty tab.
 *
 * A missing `access_requests` table is "not migrated", not "empty": `throwIfSchemaError`
 * turns it into the DbNotReady card instead of an empty queue.
 */
async function readQueue(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("access_requests")
    .select("id,email,display_name,studio_name,contact_wa,status,requested_at")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  if (error) {
    console.error("admin: access_requests pending read", error);
    throwIfSchemaError(error);
  }

  return { pending: (data ?? []) as AccessRequest[] };
}

/**
 * Admin, but no studio of his own: the queue is the job, events are not — every event
 * belongs to a `photographers` row, and this account has none. Explained, not blank.
 */
async function AdminWithoutStudio({
  email,
  supabase,
}: {
  email: string;
  supabase: SupabaseClient;
}) {
  const queue = await readQueue(supabase);

  return (
    <div className="stack">
      <header className="stack">
        <p className="eyebrow">Admin</p>
        <h1>Panel admin</h1>
        <p className="lede mono">{email}</p>
      </header>

      <section className="stack">
        <h2>Pendaftar</h2>
        <p className="lede">
          Menyetujui membuatkan studio untuk pendaftar itu. Menolak <strong>menghapus</strong>{" "}
          pendaftarannya — akun Google-nya tetap ada, tapi dia harus mendaftar ulang dari
          awal lewat tombol di halaman daftar.
        </p>
        <AccessRequests pending={queue.pending} />
      </section>

      <section className="stack">
        <h2>Event</h2>
        <p className="notice">
          Kamu admin. Untuk membuat event sendiri, tautkan akunmu ke baris fotografer —
          setiap event dimiliki satu studio, dan akun ini belum punya.
        </p>
      </section>

      <LogoutButton />
    </div>
  );
}
