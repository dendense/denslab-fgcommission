"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AccessRequest = {
  id: string;
  email: string;
  display_name: string | null;
  contact_wa: string | null;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
};

/**
 * Pending queue + Approve/Reject.
 *
 * The list arrives from the server component so the first paint is real; this
 * component only owns the per-row busy state and the error text. After a decision
 * it refreshes the route, which re-reads the queue from the DB — trusting the
 * local copy would leave approved rows on screen after a failed write.
 */
export function AccessRequests({ initial }: { initial: AccessRequest[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function decide(request: AccessRequest, action: "approve" | "reject") {
    setError(null);
    setBusy(request.id);
    try {
      const res = await fetch("/api/admin/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: request.id, action }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError({
          id: request.id,
          message: body?.message || "Gagal memproses. Coba lagi.",
        });
        return;
      }

      router.refresh();
    } catch {
      setError({ id: request.id, message: "Tidak bisa menghubungi server." });
    } finally {
      setBusy(null);
    }
  }

  if (!initial.length) {
    return (
      <p className="notice notice--ok">Tidak ada pendaftar yang menunggu. Semua beres.</p>
    );
  }

  return (
    <div className="slots">
      {initial.map((request) => {
        const working = busy === request.id;
        const rowError = error?.id === request.id ? error.message : null;

        return (
          <div className="slot-row" key={request.id}>
            <div>
              <div className="slot__time">{request.display_name || "Tanpa nama"}</div>
              <div className="slot__status mono">{request.email}</div>
              {request.contact_wa ? (
                <div className="slot__status mono">{request.contact_wa}</div>
              ) : null}
            </div>

            <div className="btn-row btn-row--inline">
              <button
                type="button"
                className="btn btn--primary"
                disabled={working}
                aria-busy={working || undefined}
                onClick={() => decide(request, "approve")}
              >
                {working ? "Memproses…" : "Setujui"}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={working}
                onClick={() => decide(request, "reject")}
              >
                Tolak
              </button>
            </div>

            {rowError ? (
              <p className="slot-row__error" role="alert">
                {rowError}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
