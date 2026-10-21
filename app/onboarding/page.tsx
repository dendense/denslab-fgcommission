import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { sessionClient } from "@/lib/auth";
import { DbNotMigratedError, throwIfSchemaError } from "@/lib/db-errors";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { DbNotReady } from "@/app/_components/DbNotReady";
import { LogoutButton } from "@/app/admin/LogoutButton";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Lengkapi data studio — Booking Sesi Foto" };

// Session-dependent, like every other gate in this app.
export const instant = false;

type Props = { searchParams: Promise<{ edit?: string }> };

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

type Registration = {
  status: string;
  studio_name: string | null;
  contact_wa: string | null;
  email: string | null;
  note: string | null;
  instagram: string | null;
};

/**
 * The landing page for a Google signup.
 *
 * Reads `my_registration_status()` (0013; `note` since 0017, `instagram` since 0018) — the
 * caller's own row, `security definer`, granted to `authenticated` only. Not a select on
 * `access_requests`: that would need the caller to know his own user_id and would put the
 * "which row is mine" rule in two places.
 *
 * Branch table, top to bottom:
 *   no session                     → /login
 *   no registration row            → "tidak punya pendaftaran" + /register
 *   approved                       → /admin
 *   rejected (legacy row)          → /register, where a new registration is started; since
 *                                    0019 a rejection deletes the row, so this state is
 *                                    leftover data with no form to edit
 *   pending, fields empty          → form
 *   pending, fields filled         → waiting card (+ `?edit=1` re-opens the form)
 */
async function Content(searchParams: Props["searchParams"]) {
  const { edit } = await searchParams;
  const supabase = await sessionClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const { data: rows, error: statusError } = await supabase.rpc("my_registration_status");

  // 0013 not applied yet is "database not ready", not "you have no registration" —
  // sending a real signup back to /register would create a second account.
  throwIfSchemaError(statusError);
  if (statusError) throw statusError;

  const registration = ((rows ?? []) as Registration[])[0];

  if (!registration) {
    return (
      <div className="card stack">
        <p className="eyebrow">Onboarding</p>
        <h1>Akun ini tidak punya pendaftaran.</h1>
        <p className="lede">
          Akun <strong>{auth.user.email}</strong> sudah masuk, tapi belum ada permintaan
          akses studio yang tertaut ke akun ini. Daftar dulu supaya admin bisa meninjau.
        </p>
        <Link className="btn btn--primary" href="/register">
          Ke halaman daftar
        </Link>
        <LogoutButton />
      </div>
    );
  }

  if (registration.status === "approved") redirect("/admin");

  const studioName = registration.studio_name?.trim() ?? "";
  const contactWa = registration.contact_wa?.trim() ?? "";
  const instagram = registration.instagram?.trim() ?? "";
  const complete = studioName.length > 0 && contactWa.length > 0;

  if (registration.status === "rejected") {
    const reason = registration.note?.trim();

    return (
      <div className="card stack">
        <p className="eyebrow">Pendaftaran ditolak</p>
        <h1>Akses studio belum diberikan.</h1>
        <p className="lede">
          Admin menolak permintaan akses untuk <strong>{registration.email}</strong>.
          Pendaftaran yang ditolak sudah dihapus, jadi datanya tidak bisa diperbaiki — mulai
          pendaftaran baru dari halaman daftar.
        </p>

        {reason ? (
          <div className="notice notice--warn">
            <p className="eyebrow">Alasan dari admin</p>
            <p>{reason}</p>
          </div>
        ) : null}

        <Link className="btn btn--primary" href="/register">
          Ke halaman daftar
        </Link>

        <LogoutButton />
      </div>
    );
  }

  if (complete && edit !== "1") {
    return (
      <div className="stack">
        <div className="card stack">
          <p className="eyebrow">Menunggu persetujuan admin</p>
          <h1>Data studio sudah dikirim.</h1>
          <p className="lede">
            Admin akan meninjau pendaftaran <strong>{registration.email}</strong>. Setelah
            disetujui, halaman ini otomatis mengarah ke panel studio.
          </p>

          <div className="summary">
            <div>
              <dt>Nama studio</dt>
              <dd>{studioName}</dd>
            </div>
            <div>
              <dt>Nomor WA</dt>
              <dd className="mono">{contactWa}</dd>
            </div>
            <div>
              <dt>Instagram</dt>
              <dd className="mono">{instagram ? `@${instagram}` : "—"}</dd>
            </div>
          </div>

          <Link className="btn btn--secondary" href="/onboarding?edit=1">
            Ubah data studio
          </Link>
        </div>

        <LogoutButton />
      </div>
    );
  }

  // Prefill only from `display_name` (the column 0005's trigger fills from signup
  // metadata). Google metadata carries `full_name`, which 0013 deliberately does not map
  // to a studio name — the studio name is the user's own decision.
  const { data: own } = await supabase
    .from("access_requests")
    .select("display_name")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  return (
    <div className="stack">
      <header className="stack">
        <p className="eyebrow">Langkah terakhir</p>
        <h1>Lengkapi data studio</h1>
        <p className="lede">
          Akun <strong>{registration.email}</strong> sudah terdaftar. Isi nama studio dan
          nomor WA supaya admin bisa mengaktifkan akses dan klien bisa menghubungimu.
        </p>
      </header>

      <OnboardingForm
        initialStudioName={studioName || (own?.display_name ?? "")}
        initialContactWa={contactWa}
        initialInstagram={instagram}
        changing={complete}
      />

      <LogoutButton />
    </div>
  );
}
