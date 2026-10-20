import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { isAdmin, sessionClient } from "@/lib/auth";
import { listEvents, slotCounts, firstDayDate, type AdminEvent } from "@/lib/admin-events";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
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
    <main className="shell">
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
    throw err;
  }
}

/**
 * Session + studio are read here rather than through requireStudio() on purpose:
 * requireStudio() sends a signed-in user without a studio row to /admin, which is this
 * page — a redirect loop. The "menunggu persetujuan" card is the real destination.
 */
async function Content() {
  const supabase = await sessionClient();

  // getUser(), not getSession(): the JWT is verified with the auth server instead
  // of trusting whatever the cookie claims.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  // RLS (0004): this select can only return the caller's own photographer row, so
  // a non-photographer gets no row rather than someone else's studio.
  const { data: me, error: meError } = await supabase
    .from("photographers")
    .select("id, slug, display_name")
    .limit(1)
    .maybeSingle();

  if (meError) {
    console.error("admin: photographers read", meError);
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

  // Signed in, but no studio yet → the signup is still sitting in the admin queue.
  if (!me) {
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

  const admin = await isAdmin(supabase);

  let events: AdminEvent[] = [];
  let listError = false;
  try {
    events = await listEvents(supabase);
  } catch (err) {
    console.error("admin: events read", err);
    listError = true;
  }

  let pending: AccessRequest[] = [];
  if (admin) {
    const { data, error } = await supabase
      .from("access_requests")
      .select("id,email,display_name,contact_wa,status,requested_at")
      .eq("status", "pending")
      .order("requested_at", { ascending: true });
    if (error) console.error("admin: access_requests read", error);
    pending = (data ?? []) as AccessRequest[];
  }

  return (
    <div className="stack">
      <header className="stack">
        <p className="eyebrow">{admin ? "Admin" : "Fotografer"}</p>
        <h1>{me.display_name || "Studio"}</h1>
        <p className="lede mono">{auth.user.email}</p>
      </header>

      {admin ? (
        <section className="stack">
          <h2>Pendaftar menunggu persetujuan</h2>
          <p className="lede">
            Menyetujui membuatkan studio untuk pendaftar itu. Menolak tidak menghapus
            akunnya — hanya menutup akses.
          </p>
          <AccessRequests initial={pending} />
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

            <div className="slots">
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
