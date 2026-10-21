/**
 * Copy for /login, in the two languages the toggle offers.
 *
 * Lives here, not in lib/: only this route reads it — except `LANG_COOKIE` / `langFrom`,
 * which app/layout.tsx also imports so `<html lang>` is server-rendered. Those two symbols
 * are the single source of truth for the cookie; the dictionary itself is still read only
 * by page.tsx.
 *
 * Read on the server (page.tsx) from the `lang` cookie, so the first paint already has
 * the right language. localStorage would only be readable after mount, which means every
 * refresh would flash Indonesian before switching.
 *
 * Brand strings are deliberately absent: "Photographer Commission Maker", the copyright
 * line, "WIB", "WhatsApp", "Instagram" and "Google" stay identical in both languages and
 * are written straight into the JSX.
 *
 * STATUS: both dictionaries are final. English copy comes from docs/COPY-EN.md, which
 * carries the citations for every choice — do not hand-edit a value here without reading
 * that file first, or the next reviewer cannot tell a decision from a typo.
 */

export type Lang = "id" | "en";

/** Cookie name and the only two values it may hold. */
export const LANG_COOKIE = "lang";

/** No cookie, or anything unexpected, means Indonesian. */
export function langFrom(value: string | undefined): Lang {
  return value === "en" ? "en" : "id";
}

/** BCP 47 locale per language, for Intl. Not a translation, so it lives outside the dict. */
export const locale: Record<Lang, string> = {
  id: "id-ID",
  en: "en-GB",
};

const id = {
  // hero — eyebrow is the brand line and stays hardcoded
  heroTitle: "Booking fotografer matsuri, tanpa ribet.",
  heroLede:
    "Klien memilih jam lewat satu tautan. Fotografer mengelola event, hari, dan slot dari satu panel.",

  // login card
  loginEyebrow: "Masuk",
  loginTitle: "Masuk dengan akun Google",
  loginLede: "Untuk fotografer dan admin. Klien tidak perlu akun.",
  // The Google button prints its own label and failure text; both are here now, and
  // app/_components/GoogleButton.tsx takes them as an optional prop whose default is
  // still these Indonesian strings — /register passes nothing and renders unchanged.
  googleIdle: "Masuk dengan Google",
  googleBusy: "Mengalihkan ke Google…",
  googleFailed: "Google gagal.",
  googleFailedHint: "Coba lagi, atau hubungi admin kalau terus gagal.",
  // Developer message that leaks into the user's error box when the auth server sends
  // none. Translated as-is; whether it should be user-facing at all is open in COPY-EN §9.
  oauthFallbackMessage: "Server auth tidak mengirim pesan.",
  noAccount: "Belum punya akun?",
  registerLink: "Daftar di sini",

  // preview
  previewTitle: "Yang dilihat klien",
  slotAvailable: "Tersedia",
  slotTaken: "Terisi",
  previewHint: "Contoh tampilan slot. Tanpa akun, tanpa pembayaran di muka.",

  // steps
  stepsTitle: "Cara kerjanya",
  step1Title: "Buat event dan slot",
  step1Body: "Fotografer menentukan hari, jam, dan harga tiap slot.",
  step2Title: "Bagikan tautan atau QR",
  step2Body: "Event terbit dengan tautan publik dan kode QR siap dipasang.",
  step3Title: "Klien memilih slot",
  step3Body: "Konfirmasi langsung tampil, lengkap dengan tombol tambah ke kalender.",

  // footer — the copyright line itself is a brand string, hardcoded
  footerPayment:
    "Pembayaran dilakukan langsung ke fotografer di lokasi. Tidak ada pembayaran di halaman ini.",
};

/**
 * Same keys, enforced by the type — a missing key is a compile error, which is what keeps
 * the two dictionaries the same length. Every value is from docs/COPY-EN.md §5a/§5b.
 */
const en: Record<keyof typeof id, string> = {
  heroTitle: "Matsuri photo bookings, without hassle.",
  heroLede:
    "Clients pick a time from one link. You manage events, days, and slots from one panel.",

  loginEyebrow: "Sign in",
  loginTitle: "Sign in with your Google account",
  loginLede: "For photographers and admins. Clients don't need an account.",
  googleIdle: "Sign in with Google",
  googleBusy: "Taking you to Google…",
  googleFailed: "Google sign-in failed.",
  googleFailedHint: "Try again, or contact the admin if it keeps failing.",
  oauthFallbackMessage: "The auth server sent no message.",
  noAccount: "No account yet?",
  registerLink: "Register here",

  previewTitle: "What clients see",
  slotAvailable: "Available",
  slotTaken: "Booked",
  previewHint: "Sample slots. No account, no payment up front.",

  stepsTitle: "How it works",
  step1Title: "Create an event and its slots",
  step1Body: "You set the days, times, and price for each slot.",
  step2Title: "Share the link or QR code",
  step2Body: "The event goes live with a public link and a QR code ready to post.",
  step3Title: "Clients pick a slot",
  step3Body: "The confirmation shows up right away, with an Add to calendar button.",

  footerPayment: "You pay the photographer in person. Nothing is charged on this page.",
};

export type Dict = typeof id;

export const dict: Record<Lang, Dict> = { id, en };

/**
 * Clock labels for the two demo slots. Indonesian writes 10.00, English writes 10:00 —
 * a formatting difference, not copy, so it is not part of the dictionary above. Both
 * languages are 24-hour; COPY-EN §5b says keep these exact strings.
 */
export const slotTimes: Record<Lang, readonly [string, string]> = {
  id: ["10.00–10.30 WIB", "11.00–11.30 WIB"],
  en: ["10:00–10:30 WIB", "11:00–11:30 WIB"],
};
