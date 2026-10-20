"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Logout button. Posts to /api/auth/logout so the cookies are cleared server-side. */
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn btn--secondary" onClick={logout} disabled={busy}>
      {busy ? "Keluar…" : "Keluar"}
    </button>
  );
}
