import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { isAdmin, sessionClient } from "@/lib/auth";
import { DbNotMigratedError, throwIfSchemaError } from "@/lib/db-errors";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { DbNotReady } from "@/app/_components/DbNotReady";
import { GoogleButton } from "@/app/_components/GoogleButton";
import { ResubmitButton } from "@/app/_components/ResubmitButton";

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
 * Six answers for a visitor, in this order:
 *
 *   no session                       → the Google button
 *   photographers row                → /admin
 *   no row, but is_admin() is true   → /admin  (an admin needs no studio of his own)
 *   status 'pending'                 → "Menunggu persetujuan admin"
 *   status 'rejected'                → "Pendaftaran ditolak" + the admin's note + Ajukan ulang
 *   no access_requests row           → the Google button (nothing to wait for yet)
 *
 * The two status cards read `my_registration_status()` (0017). Before this, the page
 * concluded "waiting" from "signed in ∧ no studio ∧ not admin" and never looked at the
 * status — so a rejected user was told to wait for an approval that had already happened
 * and been refused. The status is the only thing that can tell those two apart.
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

/** `my_registration_status()` (0013, `note` since 0017) — the caller's own row only. */
type Registration = {
  status: string;
  studio_name: string | null;
  contact_wa: string | null;
  email: string | null;
  note: string | null;
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

  if (!registration) {
    // Arrived from /auth/callback with a session but no row: say so here, where signup
    // lives, and keep the button — signing in again is what creates the row.
    return <NoRegistration email={auth.user.email ?? ""} fromCallback={searchError === "no_registration"} />;
  }

  if (registration.status === "rejected") {
    return <Rejected email={registration.email ?? auth.user.email ?? ""} note={registration.note} />;
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
      <p className="eyebrow">Pendaftaran tidak ditemukan</p>
      <h1>Akun ini belum punya pendaftaran.</h1>
      <p className="lede">
        {fromCallback ? "Login berhasil, tapi tidak" : "Tidak"} ada permintaan akses studio
        yang tertaut ke akun{email ? <> <strong>{email}</strong></> : null}. Masuk dengan
        Google sekali lagi supaya pendaftaranmu masuk ke antrian admin; akun Google yang
        sama akan dipakai lagi.
      </p>
      <GoogleButton />
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

/**
 * `note` is whatever `reject_access_request()` stored as `p_note` (0005) — the admin may
 * have refused without writing one, so it is optional, not "tidak ada alasan" filler.
 *
 * "Ajukan ulang" resets the row to `pending` and keeps the studio data (0017), which is why
 * this card does not ask the user to retype anything: if the admin wanted different data,
 * /onboarding is one tap away and now accepts edits while `rejected`.
 */
function Rejected({ email, note }: { email: string; note: string | null }) {
  const reason = note?.trim();

  return (
    <div className="card stack">
      <p className="eyebrow">Pendaftaran ditolak</p>
      <h1>Pendaftaranmu belum diterima admin.</h1>
      <p className="lede">
        Admin menolak permintaan akses untuk <strong>{email}</strong>. Kamu bisa memperbaiki
        data studio, lalu mengajukan ulang tanpa membuat akun baru.
      </p>

      {reason ? (
        <div className="notice notice--warn">
          <p className="eyebrow">Alasan dari admin</p>
          <p>{reason}</p>
        </div>
      ) : null}

      <ResubmitButton />

      <Link className="btn btn--secondary" href="/onboarding">
        Ubah data studio dulu
      </Link>
    </div>
  );
}
