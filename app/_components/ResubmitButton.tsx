"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";

/**
 * "Ajukan ulang" — `resubmit_access_request()` (0017), called straight from the browser.
 *
 * No API route: the function is granted to `authenticated` only and keys off `auth.uid()`,
 * so the browser session cookie IS the authorization. An intermediate route would add a
 * file that can only forward the same call.
 *
 * `router.refresh()` rather than local state: the page re-reads `my_registration_status()`
 * and renders the "Menunggu persetujuan" card, so what the user sees comes from the
 * database that just changed — not from a flag this component set.
 *
 * The three refusals are named instead of lumped into "gagal": `not_rejected` means the
 * queue already moved (double tap, another tab, or an admin decided meanwhile), and
 * `PGRST202` means 0017 is not applied — telling the user "coba lagi" for either would
 * send them in circles.
 */
export function ResubmitButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resubmit() {
    setError(null);
    setBusy(true);
    try {
      const { error: rpcError } = await browserClient().rpc("resubmit_access_request");
      if (rpcError) {
        const message = rpcError.message ?? "";
        if (/not_rejected/.test(message)) {
          setError(
            "Pendaftaran ini sudah ada di antrian atau sudah disetujui. Muat ulang halaman untuk melihat status terbaru.",
          );
        } else if (/no_registration/.test(message)) {
          setError("Akun ini tidak punya pendaftaran. Daftar dulu lewat tombol Google.");
        } else if (rpcError.code === "PGRST202") {
          setError("Fitur ini belum aktif di database (migrasi 0017 belum dijalankan).");
        } else {
          setError(rpcError.message || "Gagal mengajukan ulang. Coba lagi.");
        }
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tidak bisa menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn--primary"
        onClick={resubmit}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? "Mengajukan…" : "Ajukan ulang"}
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
