"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AccessRequest = {
  id: string;
  email: string;
  display_name: string | null;
  studio_name: string | null;
  contact_wa: string | null;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
};

/**
 * Who this request is, in one line.
 *
 * `studio_name` first: that is the name the applicant chose for himself and the one
 * `approve_access_request()` (0013) writes to `photographers.display_name`. `display_name`
 * is what 0005's trigger copied out of signup metadata — a Google signup has none (Google
 * sends `full_name`), which is why this queue used to show "Tanpa nama". Email is the last
 * resort: it always exists, and it is what Deny would search by anyway.
 */
function identityOf(request: AccessRequest): string {
  return (
    request.studio_name?.trim() ||
    request.display_name?.trim() ||
    request.email ||
    "Tanpa nama"
  );
}

/** Onboarding (0013) fills both; either one missing makes Approve fail. */
function needsOnboarding(request: AccessRequest): boolean {
  return !request.studio_name?.trim() || !request.contact_wa?.trim();
}

/**
 * The access-request queue: pending rows only.
 *
 * Since 0019 a rejection DELETES the row, so there is no "Ditolak" tab and no restore
 * button — a refused applicant is not in the database at all, and their way back is
 * `start_registration()` on /register. The tab and the button were removed rather than left
 * pointing at a dropped RPC.
 *
 * Reject is destructive and irreversible, so it asks first, and the sentence names the
 * account plus what the user has to do next. `window.confirm` is enough: one button, one
 * decision, nothing else to keep in sync.
 *
 * The list arrives from the server component so the first paint is real; this component
 * only owns the per-row busy state and the error text. After a decision it refreshes the
 * route, which re-reads the queue from the DB — trusting the local copy would leave a
 * deleted row on screen after a failed write.
 */
export function AccessRequests({ pending }: { pending: AccessRequest[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function decide(request: AccessRequest, action: "approve" | "reject") {
    if (
      action === "reject" &&
      !window.confirm(
        `Tolak dan hapus pendaftaran ${request.email}? User harus mendaftar ulang dari awal.`,
      )
    ) {
      return;
    }

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

  if (pending.length === 0) {
    return <p className="notice notice--ok">Tidak ada pendaftar yang menunggu. Semua beres.</p>;
  }

  return (
    <div className="slots">
      {pending.map((request) => {
        const working = busy === request.id;
        const rowError = error?.id === request.id ? error.message : null;

        return (
          <div className="slot-row" key={request.id}>
            <div>
              <div className="slot__time">{identityOf(request)}</div>
              <div className="slot__status mono">{request.email}</div>
              {request.contact_wa ? (
                <div className="slot__status mono">{request.contact_wa}</div>
              ) : null}

              {/* Shown, not enforced: the Approve button stays visible and the RPC's
                  `incomplete_registration` is what explains the refusal. Hiding the
                  button would leave Deny wondering why this row has none. */}
              {needsOnboarding(request) ? (
                <div className="slot__status">
                  <span className="badge badge--draft">belum isi data studio</span>
                </div>
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
                className="btn btn--danger"
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
