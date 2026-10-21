"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";

/**
 * "Daftar sebagai fotografer" — `start_registration()` (0019), called from the browser.
 *
 * Since 0019 a rejection DELETES the `access_requests` row, and the 0005 trigger only fires
 * on a new `auth.users` row — so logging in again creates nothing. This RPC is the only way
 * an account without a row can put itself back in the admin queue, which is why the card
 * offers a button instead of telling the user to sign in again.
 *
 * No API route: the function is granted to `authenticated` and keys off `auth.uid()`, so the
 * session cookie IS the authorisation.
 *
 * `router.refresh()` rather than local state: the page re-reads `my_registration_status()`
 * and renders the "Menunggu persetujuan" card, so what the user sees comes from the row that
 * was just written.
 *
 * The two refusals are named: `already_pending` means the queue already holds this account
 * (double tap, second tab) and a refresh shows the waiting card; `already_approved` means a
 * studio exists and `/admin` is the real destination. `PGRST202` means 0019 is not applied
 * yet — a database state, said as such, not as "coba lagi".
 */
export function StartRegistrationButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const { error: rpcError } = await browserClient().rpc("start_registration");

      if (rpcError) {
        const message = rpcError.message ?? "";
        if (/already_pending/.test(message)) {
          router.refresh();
          return;
        }
        if (/already_approved/.test(message)) {
          router.push("/admin");
          return;
        }
        setError(
          rpcError.code === "PGRST202"
            ? "Aplikasi belum siap — migrasi database belum lengkap."
            : "Pendaftaran tidak bisa dimulai. Coba muat ulang halaman.",
        );
        return;
      }

      router.refresh();
    } catch {
      setError("Tidak bisa menghubungi server. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn--primary"
        onClick={start}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? "Mendaftarkan…" : "Daftar sebagai fotografer"}
      </button>

      <div aria-live="polite">
        {error ? (
          <p className="notice notice--warn" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
