"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserClient } from "@/lib/supabase-browser";

/**
 * Login form. Text is Indonesian, matching the rest of the app.
 *
 * The post-login decision is made here rather than in the server page because the
 * session cookie only exists after the browser client has written it — redirecting
 * from a server component in the same round trip would race that write.
 *
 * "Belum disetujui" is a real state, not an error: signup is open, access is not.
 * A user who is not a photographer yet stays on this page with a logout button so
 * they are not stuck in a redirect loop between /login and /admin.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = browserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        setError("Email atau password salah.");
        return;
      }

      // RLS: this select can only see the caller's own photographer row.
      const { data, error: rowError } = await supabase
        .from("photographers")
        .select("id")
        .limit(1);

      if (rowError) {
        setError("Gagal memeriksa status akun. Coba lagi.");
        return;
      }
      if (!data?.length) {
        setPending(true);
        return;
      }

      // Client-side navigation is safe here: the browser client has already written
      // the session cookie before `signInWithPassword` resolved, and `router.refresh()`
      // makes the destination render on the server with that cookie.
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Tidak bisa menghubungi server. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    // browserClient().auth.signOut(), not a server route: the browser client keeps
    // the session in memory and its auto-refresh would rewrite the cookies after a
    // server-side-only sign-out, resurrecting the session. Signing out through the
    // client that holds it is what actually ends it.
    await browserClient().auth.signOut();
    setPending(false);
    setPassword("");
    router.refresh();
  }

  if (pending) {
    return (
      <main className="shell">
        <div className="card stack">
          <p className="eyebrow">Menunggu persetujuan</p>
          <h1>Akunmu belum disetujui admin.</h1>
          <p className="lede">
            Pendaftaranmu sudah masuk. Admin akan meninjau dan mengaktifkan akses
            studio. Kamu bisa login lagi setelah disetujui.
          </p>
          <button type="button" className="btn btn--secondary" onClick={logout}>
            Keluar
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="stack">
        <header className="stack">
          <p className="eyebrow">Masuk</p>
          <h1>Login fotografer</h1>
          <p className="lede">Kelola jadwal dan slot sesi foto kamu.</p>
        </header>

        <form className="card stack" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Memeriksa…" : "Masuk"}
          </button>
        </form>

        <p className="center lede">
          Belum punya akun? <Link className="link" href="/register">Daftar di sini</Link>
        </p>
      </div>
    </main>
  );
}
