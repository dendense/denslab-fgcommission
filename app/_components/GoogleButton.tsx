"use client";

import { useState } from "react";
import { browserClient } from "@/lib/supabase-browser";

type OAuthError = { code: string; message: string };

/**
 * "Masuk dengan Google" — the only way in. There is no email/password form to fall back
 * to, so this button is the whole auth surface of /login and /register.
 *
 * `redirectTo` is built from `window.location.origin`, not from an env var: the same
 * build runs on localhost and on the deployed host, and Supabase only accepts a
 * callback URL that is on its allow-list. A hardcoded host breaks one of the two
 * silently.
 *
 * The error prints `code` + `message`. A generic "gagal masuk dengan Google" hides the
 * two failures that actually happen here — provider not enabled (`validation_failed`,
 * "Unsupported provider: provider is not enabled") and a redirect URL missing from the
 * allow-list. Same reason DbNotReady prints the PostgREST code instead of a sentence.
 *
 * `aria-live` on the error box: the button stays in place and the failure appears under
 * it, so a screen-reader user who is not focused on that spot still hears it.
 */
export function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OAuthError | null>(null);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const { error: oauthError } = await browserClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });

      // On success the browser is already on its way to Google; leaving `busy` set is
      // what keeps the button from looking tappable again mid-navigation.
      if (oauthError) {
        setError({
          code: oauthError.code ?? oauthError.name ?? "oauth_error",
          message: oauthError.message || "Server auth tidak mengirim pesan.",
        });
        setBusy(false);
      }
    } catch (err) {
      setError({
        code: err instanceof Error ? err.name : "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn--secondary"
        onClick={start}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? "Mengalihkan ke Google…" : "Masuk dengan Google"}
      </button>

      <div aria-live="polite">
        {error ? (
          <div className="notice notice--warn">
            <p>
              <strong>Google gagal.</strong> Coba lagi, atau hubungi admin kalau terus
              gagal.
            </p>
            <p className="mono">code: {error.code}</p>
            <p className="mono">message: {error.message}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
