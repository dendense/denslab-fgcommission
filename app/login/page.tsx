import Link from "next/link";
import { Suspense } from "react";
import { GoogleButton } from "@/app/_components/GoogleButton";
import { OAuthErrorNotice } from "./OAuthErrorNotice";

/**
 * Login page — Google only. The email/password form is gone, so this page no longer
 * needs to be a client component and no longer decides where the visitor goes.
 *
 * That decision now lives in one place: `/auth/callback`, which already knows all five
 * outcomes (studio → /admin, admin → /admin, registration incomplete → /onboarding,
 * registration pending → /onboarding, no registration → /register?error=no_registration).
 * Doing it here as well would mean two copies of the same rule.
 *
 * Two error channels survive, both Google-only:
 *   GoogleButton's own box        — `signInWithOAuth` rejected (provider disabled…)
 *   OAuthErrorNotice              — GoTrue bounced back to /login with ?error_code=…
 *                                   (redirect URL not on the allow-list)
 *
 * A visitor with no session lands here; there is nothing to gate.
 */
export default function LoginPage() {
  return (
    <main className="shell">
      <div className="stack">
        <header className="stack">
          <p className="eyebrow">Masuk</p>
          <h1>Masuk dengan akun Google</h1>
          <p className="lede">Kelola jadwal dan slot sesi foto kamu.</p>
        </header>

        <div className="stack">
          <Suspense fallback={null}>
            <OAuthErrorNotice />
          </Suspense>
          <GoogleButton />
        </div>

        <p className="center lede">
          Belum punya akun? <Link className="link" href="/register">Daftar di sini</Link>
        </p>
      </div>
    </main>
  );
}
