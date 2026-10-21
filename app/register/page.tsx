import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { isAdmin, sessionClient } from "@/lib/auth";
import { DbNotMigratedError, throwIfSchemaError } from "@/lib/db-errors";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { DbNotReady } from "@/app/_components/DbNotReady";
import { GoogleButton } from "@/app/_components/GoogleButton";
import { StartRegistrationButton } from "@/app/_components/StartRegistrationButton";

export const metadata = { title: "Daftar — Booking Sesi Foto" };

// The answer depends on the session cookie, so this page cannot be a static shell.
export const instant = false;

/**
 * Public signup page, gated in front: someone who already holds a session has nothing to
 * do here, and the Google button must not even be sent to them.
 *
 * Signup is Google-only. The account is created by Supabase from the Google identity, the
 * `handle_new_user` trigger (0005) puts it in the approval queue, and the studio name +
 * WhatsApp number are filled in afterwards on /onboarding — never here.
 *
 * Five answers for a visitor, in this order:
 *
 *   no session                       → the Google button
 *   photographers row                → /admin
 *   no row, but is_admin() is true   → /admin  (an admin needs no studio of his own)
 *   status 'pending'                 → "Menunggu persetujuan admin"
 *   no access_requests row           → "Daftar sebagai fotografer" (start_registration)
 *
 * A legacy `rejected` row is treated as no row at all: since 0019 a rejection DELETES the
 * row, so `rejected` only survives as leftover data in a database that has not been cleaned
 * up. The user's route back is the same one: start a new registration.
 *
 * The waiting card reads `my_registration_status()` (0017/0018), which answers from the
 * caller's own row only. Before 0017 this page concluded "waiting" from "signed in ∧ no
 * studio ∧ not admin" and never looked at the status.
 *
 * The gate is here rather than in the browser so the redirect is a real HTTP one and the
 * button markup never leaves the server for a signed-in user.
 *
 * "Do I own a studio?" is `current_photographer_id()` (0004), NOT a select on
 * `photographers`: since 0010 added `photographers_admin_select` (`using (is_admin())`),
 * `.limit(1)` answers with *some other* photographer's row for an admin.
 *
 * A schema error is not "not approved" — it means the database is not ready, and it gets
 * the card that prints the PostgREST code instead of a wrong verdict.
 */
type Props = { searchParams: Promise<{ error?: string }> };

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

/** `my_registration_status()` (0013) — the caller's own row only. */
type Registration = {
  status: string;
  studio_name: string | null;
  contact_wa: string | null;
  email: string | null;
};

async function Content(searchParams: Props["searchParams"]) {
  const { error: searchError } = await searchParams;

  const supabase = await sessionClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  // No session: the public path. This is the page's reason to exist.
  if (authError || !auth.user) return <Signup />;

  const { data: studioId, error: studioError } = await supabase.rpc("current_photographer_id");

  // A schema error is "database not ready", never "you are not approved" — it renders the
  // card that prints the PostgREST code instead of a wrong verdict.
  throwIfSchemaError(studioError);
  if (studioError) throw studioError;

  if (studioId) redirect("/admin");

  if (await isAdmin(supabase)) redirect("/admin");

  const { data: rows, error: statusError } = await supabase.rpc("my_registration_status");

  // Same rule as above: 0017 not applied yet is a database state, not a verdict about
  // this account. Sending a real signup back to the Google button would be a second
  // account, so the code gets printed instead.
  throwIfSchemaError(statusError);
  if (statusError) throw statusError;

  const registration = ((rows ?? []) as Registration[])[0];

  // A legacy `rejected` row falls in here on purpose: 0019 makes rejection delete the row,
  // so `rejected` is leftover data, not a state this page can act on. The card below is the
  // only route back into the queue.
  if (!registration || registration.status === "rejected") {
    return (
      <NoRegistration
        email={registration?.email ?? auth.user.email ?? ""}
        fromCallback={searchError === "no_registration"}
      />
    );
  }

  // `pending` is the only remaining status: `approved` would have a studio row and was
  // redirected above. Anything unrecognised is treated as waiting — the queue read is
  // `status='pending'`, so that is where the row actually is.
  return <Pending email={registration.email ?? auth.user.email ?? ""} />;
}

function Signup() {
  return (
    <div className="stack">
      <header className="stack">
        <p className="eyebrow">Daftar</p>
        <h1>Daftar dengan akun Google</h1>
        <p className="lede">
          Pendaftaran memakai akun Google. Setelah masuk, isi nama studio dan nomor WA di
          halaman berikutnya — akun baru perlu disetujui admin sebelum bisa dipakai.
        </p>
      </header>

      <GoogleButton />

      <p className="center lede">
        Sudah punya akun? <Link className="link" href="/login">Masuk</Link>
      </p>
    </div>
  );
}

function NoRegistration({ email, fromCallback }: { email: string; fromCallback: boolean }) {
  return (
    <div className="card stack">
      <p className="eyebrow">Belum terdaftar</p>
      <h1>Daftar sebagai fotografer.</h1>
      <p className="lede">
        {fromCallback ? "Login berhasil, tapi tidak" : "Tidak"} ada permintaan akses studio
        yang tertaut ke akun{email ? <> <strong>{email}</strong></> : null}. Tekan tombol di
        bawah untuk masuk ke antrian admin; akun Google yang sama akan dipakai lagi.
      </p>
      <StartRegistrationButton />
    </div>
  );
}

function Pending({ email }: { email: string }) {
  return (
    <div className="card stack">
      <p className="eyebrow">Menunggu persetujuan</p>
      <h1>Akunmu belum disetujui admin.</h1>
      <p className="lede">
        Pendaftaran{email ? <> untuk <strong>{email}</strong></> : null} sudah masuk, jadi
        tidak perlu mendaftar lagi. Admin akan meninjau dan mengaktifkan akses studio.
      </p>
      <Link className="btn btn--secondary" href="/onboarding">
        Lengkapi data studio
      </Link>
    </div>
  );
}
