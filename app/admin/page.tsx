import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { isAdmin, sessionClient } from "@/lib/auth";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import type { PublicEvent } from "@/lib/types";
import { QrCard } from "./QrCard";
import { AdminSlots } from "./AdminSlots";
import { AccessRequests, type AccessRequest } from "./AccessRequests";
import { LogoutButton } from "./LogoutButton";

export const metadata = { title: "Admin — Slot & QR" };

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

  // `admin_event` returns every slot including `closed` (0003/0004) and refuses
  // events that are not this photographer's.
  const { data: eventData, error: eventError } = await supabase.rpc("admin_event", {
    p_slug: me.slug,
  });
  if (eventError) console.error("admin: admin_event", eventError);

  const payload = eventError ? null : (eventData as Omit<PublicEvent, "timezone"> | null);
  const slots = payload?.days.flatMap((d) => d.slots) ?? [];
  const firstDay = payload?.days[0]?.day_date;

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

      {payload?.event ? (
        <>
          <QrCard slug={payload.event.slug} />
          <AdminSlots slots={slots} dayDate={firstDay} />
          <p className="center">
            <Link className="btn btn--secondary" href={`/e/${payload.event.slug}`}>
              Buka halaman publik
            </Link>
          </p>
        </>
      ) : (
        <p className="notice notice--warn">
          Event belum bisa dimuat. Pastikan migrasi 0004 sudah dijalankan dan event
          milik akun ini berstatus <em>published</em>.
        </p>
      )}

      <LogoutButton />
    </div>
  );
}
