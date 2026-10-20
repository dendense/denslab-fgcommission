import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { isAdmin, sessionClient } from "@/lib/auth";
import { DbNotMigratedError, throwIfSchemaError } from "@/lib/db-errors";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { DbNotReady } from "@/app/_components/DbNotReady";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Daftar — Booking Sesi Foto" };

// The answer depends on the session cookie, so this page cannot be a static shell.
export const instant = false;

/**
 * Public signup page, gated in front: someone who already holds a session has nothing to
 * do here, and the form must not even be sent to them.
 *
 * Three answers for a signed-in visitor, matching the /login and /admin gates:
 *
 *   photographers row                → /admin
 *   no row, but is_admin() is true   → /admin  (an admin needs no studio of his own)
 *   no row, not an admin             → "menunggu persetujuan" (signup is in the queue)
 *   no session                       → the form, exactly as before
 *
 * The gate is here rather than in the browser so the redirect is a real HTTP one and the
 * form markup never leaves the server for a signed-in user.
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

async function Content(searchParams: Props["searchParams"]) {
  const { error: searchError } = await searchParams;

  const supabase = await sessionClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  // No session: the public path. This is the page's reason to exist.
  if (authError || !auth.user) return <RegisterForm />;

  // Arrived from /auth/callback with a session but no `access_requests` row: say so here,
  // where the form is, instead of leaving them on a page that looks like a fresh signup.
  if (searchError === "no_registration") return <NoRegistration />;

  const { data: studioId, error: studioError } = await supabase.rpc("current_photographer_id");

  // A schema error is "database not ready", never "you are not approved" — it renders the
  // card that prints the PostgREST code instead of a wrong verdict.
  throwIfSchemaError(studioError);
  if (studioError) throw studioError;

  if (studioId) redirect("/admin");

  if (await isAdmin(supabase)) redirect("/admin");

  // Signed in, no studio, not an admin: the signup is in the approval queue.
  return <Pending email={auth.user.email ?? ""} />;
}

function NoRegistration() {
  return (
    <div className="card stack">
      <p className="eyebrow">Pendaftaran tidak ditemukan</p>
      <h1>Akun ini belum punya pendaftaran.</h1>
      <p className="lede">
        Login berhasil, tapi tidak ada permintaan akses studio yang tertaut ke akun ini.
        Daftar dulu supaya admin bisa meninjau; akun yang sama akan dipakai lagi.
      </p>
      <Link className="btn btn--primary" href="/register">
        Daftar sekarang
      </Link>
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
    </div>
  );
}
