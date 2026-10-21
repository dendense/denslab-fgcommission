import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { GoogleButton } from "@/app/_components/GoogleButton";
import { OAuthErrorNotice } from "./OAuthErrorNotice";
import { LangToggle } from "./LangToggle";
import { LANG_COOKIE, dict, langFrom, locale, slotTimes } from "./lang";

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
 *
 * Language: the `lang` cookie is read here, on the server, so the HTML that arrives is
 * already in the right language — no flash of Indonesian on an English refresh. The
 * dictionary is in ./lang.ts and only this route imports it.
 */

// The rendered language depends on a request cookie, so there is no static shell to
// prerender — same reason /register, /onboarding and /admin set this. Blocking the route
// is the point: a Suspense placeholder would mean streaming a guess (Indonesian) and then
// swapping it, which is exactly the flash the cookie exists to avoid.
export const instant = false;

/**
 * The demo day. Fixed on purpose: the slots below are an illustration, not availability,
 * so a live date would invite the reader to think 7 November is bookable. Formatted with
 * Intl rather than written out, because the month name differs per language and hardcoding
 * "November" twice would be the one string nobody updates when a language is added.
 */
const DEMO_DAY = new Date("2026-11-07T10:00:00+07:00");

export default async function LoginPage() {
  const lang = langFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = dict[lang];
  const times = slotTimes[lang];

  const day = new Intl.DateTimeFormat(locale[lang], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(DEMO_DAY);

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
        <LangToggle lang={lang} />
      </header>

      <div className="page">
        <section className="hero" aria-labelledby="hero-title">
          {/* Brand line, identical in both languages. */}
          <p className="eyebrow">Photographer Commission Maker</p>
          <h1 id="hero-title">{t.heroTitle}</h1>
          <p className="lede">{t.heroLede}</p>
        </section>

        <section className="card login" aria-labelledby="login-title">
          <p className="eyebrow">{t.loginEyebrow}</p>
          <h2 id="login-title">{t.loginTitle}</h2>
          <p className="lede">{t.loginLede}</p>

          <Suspense fallback={null}>
            <OAuthErrorNotice
              labels={{ failed: t.googleFailed, failedHint: t.googleFailedHint }}
            />
          </Suspense>
          <GoogleButton
            labels={{
              idle: t.googleIdle,
              busy: t.googleBusy,
              failed: t.googleFailed,
              failedHint: t.googleFailedHint,
              fallbackMessage: t.oauthFallbackMessage,
            }}
          />

          <p className="lede">
            {t.noAccount}{" "}
            <Link className="link" href="/register">
              {t.registerLink}
            </Link>
          </p>
        </section>

        <section className="preview" aria-labelledby="preview-title">
          <h2 id="preview-title">{t.previewTitle}</h2>
          {/* The day the sample slots belong to. Same .day-heading treatment as the public
              event page, so "this is a date heading" reads the same on both. */}
          <p className="day-heading">{day}</p>
          <div className="slots slots--grid">
            <div className="slot slot--open slot--demo">
              <span className="slot__time">{times[0]}</span>
              <span className="slot__price">Rp150.000</span>
              <span className="slot__status">{t.slotAvailable}</span>
            </div>
            <div className="slot slot--taken" aria-disabled="true">
              <span className="slot__time">{times[1]}</span>
              <span className="slot__price">Rp150.000</span>
              <span className="slot__badge">{t.slotTaken}</span>
            </div>
          </div>
          <p className="hint">{t.previewHint}</p>
        </section>

        <section className="steps" aria-labelledby="steps-title">
          <h2 id="steps-title">{t.stepsTitle}</h2>
          <ol className="steps__list">
            <li className="steps__item">
              <h3>{t.step1Title}</h3>
              <p className="hint">{t.step1Body}</p>
            </li>
            <li className="steps__item">
              <h3>{t.step2Title}</h3>
              <p className="hint">{t.step2Body}</p>
            </li>
            <li className="steps__item">
              <h3>{t.step3Title}</h3>
              <p className="hint">{t.step3Body}</p>
            </li>
          </ol>
        </section>
      </div>

      <footer className="landing__foot">
        {/* 6.4: byte-exact, one line — the only statement that this app charges nothing. */}
        <p className="hint">{t.footerPayment}</p>
        <p className="hint">© denslab - Cinemichi Production</p>
      </footer>
    </main>
  );
}
