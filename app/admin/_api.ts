"use client";

/**
 * Shared fetch helper for the admin write routes.
 *
 * The routes answer { error, message } on failure (see lib/rpc-error.ts). Everything
 * the UI shows for a rejected write comes from that message, so the same sentence is
 * never written twice and the server stays the single source of wording.
 */
export type ApiFailure = { error: string; message: string };

export async function postJson<T>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): Promise<{ ok: true; data: T } | { ok: false; failure: ApiFailure }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "DELETE" ? undefined : JSON.stringify(body),
    });

    const payload = (await res.json().catch(() => null)) as
      | (T & { error?: string; message?: string })
      | null;

    if (!res.ok) {
      return {
        ok: false,
        failure: {
          error: payload?.error ?? "server_error",
          message:
            payload?.message ||
            (res.status === 401
              ? "Sesi sudah berakhir. Muat ulang lalu login lagi."
              : "Gagal menyimpan. Coba lagi."),
        },
      };
    }

    return { ok: true, data: (payload ?? {}) as T };
  } catch {
    return {
      ok: false,
      failure: { error: "network", message: "Tidak bisa menghubungi server. Coba lagi." },
    };
  }
}
