import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { LANG_COOKIE, langFrom } from "@/app/login/lang";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "denslab - commission",
  description: "Booking sesi foto tanpa akun — pilih slot, isi nama dan nomor WhatsApp.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#b33a12",
};

/**
 * Reading the `lang` cookie here is what makes `<html lang>` correct without JavaScript:
 * the attribute ships in the server HTML, so a screen reader or a browser with scripting
 * off still gets the right language. Doing it in a client `useEffect` (the previous
 * approach) left the attribute at `id` until hydration.
 *
 * Cost: a root-layout request read makes every route render per request instead of
 * prerendering a static shell, so `instant = false` is set here to opt the whole app out
 * of the static-shell validation that Cache Components would otherwise fail on. That is
 * the documented lever for a root layout (next/dist/docs — instant.md, "Disabling static
 * shell validation"). The routes that matter are already request-time: every one of them
 * reads Supabase, and all but `/` already set `instant = false` themselves.
 */
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = langFrom((await cookies()).get(LANG_COOKIE)?.value);

  return (
    <html lang={lang} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
