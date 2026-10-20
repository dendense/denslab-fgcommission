"use client";

import Link from "next/link";
import { useState } from "react";
import { browserClient } from "@/lib/supabase-browser";
import { waValid } from "@/lib/format";
import { GoogleButton } from "@/app/_components/GoogleButton";

/**
 * The signup form itself. Rendered by ./page.tsx only for a visitor without a session —
 * the gate (who may see this) lives in the server component, so a signed-in user gets an
 * HTTP redirect instead of this form.
 *
 * Open signup: anyone can create an account; nobody gets a studio until an admin approves
 * it (supabase/migrations/0005_access_requests.sql). After success this does NOT navigate
 * to /admin — the account has no access yet. It says so and stops.
 */
export function RegisterForm() {
  const [form, setForm] = useState({ email: "", password: "", name: "", wa: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!form.email.trim()) return setError("Email wajib diisi.");
    if (form.password.length < 8) return setError("Password minimal 8 karakter.");
    if (!form.name.trim()) return setError("Nama wajib diisi.");
    if (!waValid(form.wa)) return setError("Nomor WhatsApp tidak valid. Contoh: 081234567890.");

    setBusy(true);
    try {
      const { error: signUpError } = await browserClient().auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: {
            display_name: form.name.trim(),
            contact_wa: form.wa.replace(/[^\d]/g, ""),
          },
        },
      });

      if (signUpError) {
        setError(
          /already|registered|exists/i.test(signUpError.message)
            ? "Email ini sudah terdaftar. Coba login."
            : "Pendaftaran gagal. Coba lagi.",
        );
        return;
      }

      setDone(true);
    } catch {
      setError("Tidak bisa menghubungi server. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="shell">
        <div className="card stack">
          <div className="check" aria-hidden="true">✓</div>
          <h1 className="center">Pendaftaran diterima.</h1>
          <p className="lede center">
            Tunggu persetujuan admin. Setelah disetujui, kamu bisa login dan mulai
            mengelola jadwal studio.
          </p>
          <p className="center">
            <Link className="btn btn--secondary" href="/login">Ke halaman login</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="stack">
        <header className="stack">
          <p className="eyebrow">Daftar</p>
          <h1>Buat akun fotografer</h1>
          <p className="lede">
            Akun baru perlu disetujui admin sebelum bisa dipakai. Isi data di bawah,
            kami kabari setelah aktif.
          </p>
        </header>

        <div className="stack">
          <GoogleButton />
          <p className="center lede">
            atau isi data di bawah. Akun Google langsung masuk antrian persetujuan tanpa
            perlu mengisi nama dan nomor WA di sini — data studio dilengkapi di halaman
            berikutnya.
          </p>
        </div>

        <form className="card stack" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={set("email")}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={set("password")}
            />
            <p className="hint">Minimal 8 karakter.</p>
          </div>

          <div className="field">
            <label htmlFor="name">Nama</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={form.name}
              onChange={set("name")}
            />
            <p className="hint">Nama yang tampil di halaman publik.</p>
          </div>

          <div className="field">
            <label htmlFor="wa">Nomor WhatsApp</label>
            <input
              id="wa"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="081234567890"
              value={form.wa}
              onChange={set("wa")}
            />
            <p className="hint">Dipakai klien untuk menghubungi kamu.</p>
          </div>

          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Mengirim…" : "Daftar"}
          </button>
        </form>

        <p className="center lede">
          Sudah punya akun? <Link className="link" href="/login">Masuk</Link>
        </p>
      </div>
    </main>
  );
}
