import Link from "next/link";
import { Suspense } from "react";
import { GoogleButton } from "@/app/_components/GoogleButton";
import { OAuthErrorNotice } from "./OAuthErrorNotice";

/**
 * Login page — Google only, now framed as the landing page (docs/LANDING-LOGIN.md).
 * The email/password form is gone, so this page is not a client component and does not
 * decide where the visitor goes.
 *
 * That decision lives in one place: `/auth/callback`, which already knows all five
 * outcomes (studio → /admin, admin → /admin, registration incomplete → /onboarding,
 * registration pending → /onboarding, no registration → /register?error=no_registration).
 * Doing it here as well would mean two copies of the same rule.
 *
 * Two error channels survive, both Google-only, both printed raw in the login card:
 *   GoogleButton's own box        — `signInWithOAuth` rejected (provider disabled…)
 *   OAuthErrorNotice              — GoTrue bounced back to /login with ?error_code=…
 *                                   (redirect URL not on the allow-list)
 *
 * Presentation only: the slot cards in <Preview> are a static illustration, not data and
 * not links. Their layout order below is also the screen-reader order — the two-column
 * desktop arrangement at 960px is done with grid-template-areas in globals.css, never by
 * moving a node.
 */
export default function LoginPage() {
  return (
    <main className="shell shell--wide landing">
      <header className="landing__top">
        {/* Plain <img>, not next/image: Next refuses SVG through the optimizer unless
            next.config.ts sets dangerouslyAllowSVG, and a vector needs no re-encoding.
            511×190 are the intrinsic dimensions from the file's own viewBox — the class
            only caps the display width, so the browser keeps the 2.6895 ratio. */}
        <img
          className="landing__logo"
          src="/app-logo.svg"
          alt="denslab commission"
          width={511}
          height={190}
        />
      </header>

      <div className="page">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Fotografi event matsuri</p>
          <h1 id="hero-title">Booking fotografer matsuri, tanpa ribet.</h1>
          <p className="lede">
            Klien memilih jam lewat satu tautan. Fotografer mengelola event, hari, dan slot
            dari satu panel.
          </p>
        </section>

        <section className="card login" aria-labelledby="login-title">
          <p className="eyebrow">Masuk</p>
          <h2 id="login-title">Masuk dengan akun Google</h2>
          <p className="lede">Untuk fotografer dan admin. Klien tidak perlu akun.</p>

          <Suspense fallback={null}>
            <OAuthErrorNotice />
          </Suspense>
          <GoogleButton />

          <p className="lede">
            Belum punya akun?{" "}
            <Link className="link" href="/register">
              Daftar di sini
            </Link>
          </p>
        </section>

        <section className="preview" aria-labelledby="preview-title">
          <h2 id="preview-title">Yang dilihat klien</h2>
          <div className="slots slots--grid">
            <div className="slot slot--open slot--demo">
              <span className="slot__time">10.00–10.30 WIB</span>
              <span className="slot__price">Rp150.000</span>
              <span className="slot__status">Tersedia</span>
            </div>
            <div className="slot slot--taken" aria-disabled="true">
              <span className="slot__time">11.00–11.30 WIB</span>
              <span className="slot__price">Rp150.000</span>
              <span className="slot__badge">Terisi</span>
            </div>
          </div>
          <p className="hint">
            Contoh tampilan slot. Tanpa akun, tanpa pembayaran di muka.
          </p>
        </section>

        <section className="steps" aria-labelledby="steps-title">
          <h2 id="steps-title">Cara kerjanya</h2>
          <ol className="steps__list">
            <li className="steps__item">
              <h3>Buat event dan slot</h3>
              <p className="hint">Fotografer menentukan hari, jam, dan harga tiap slot.</p>
            </li>
            <li className="steps__item">
              <h3>Bagikan tautan atau QR</h3>
              <p className="hint">
                Event terbit dengan tautan publik dan kode QR siap dipasang.
              </p>
            </li>
            <li className="steps__item">
              <h3>Klien memilih slot</h3>
              <p className="hint">
                Konfirmasi langsung tampil, lengkap dengan tombol tambah ke kalender.
              </p>
            </li>
          </ol>
        </section>
      </div>

      <footer className="landing__foot">
        {/* 6.4: byte-exact, one line — the only statement that this app charges nothing. */}
        <p className="hint">
          Pembayaran dilakukan langsung ke fotografer di lokasi. Tidak ada pembayaran di halaman ini.
        </p>
        <p className="hint">© denslab</p>
      </footer>
    </main>
  );
}
