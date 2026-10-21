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
  decided_at: string | null;
  note: string | null;
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

/** "3 Oktober 2026" — the decision date is what tells two rejections of the same person apart. */
function decidedOn(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * The access-request queue: two tabs, **Menunggu** (default) and **Ditolak**.
 *
 * Rejected rows used to be invisible here, because the page only ever read
 * `status='pending'` — a user an admin had refused simply disappeared from view, and the
 * admin had no way to change his mind without touching the database by hand. 0017 adds
 * `resubmit_access_request()` (the user's own way back) and `admin_restore_access_request()`
 * (this tab's button), so both sides of that decision are now reachable from the UI.
 *
 * The list arrives from the server component so the first paint is real; this component
 * only owns the tab, the per-row busy state and the error text. After a decision it
 * refreshes the route, which re-reads both lists from the DB — trusting the local copy
 * would leave a rejected row on the pending tab after a failed write.
 *
 * Tabs are local state, not `?tab=`: the server already sends both lists in one read, so a
 * URL parameter would buy nothing but a second round trip per click.
 */
export function AccessRequests({
  pending,
  rejected,
}: {
  pending: AccessRequest[];
  rejected: AccessRequest[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "rejected">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function decide(
    request: AccessRequest,
    action: "approve" | "reject" | "restore",
  ) {
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

  const rows = tab === "pending" ? pending : rejected;

  return (
    <div className="stack">
      <div className="btn-row btn-row--inline" role="tablist" aria-label="Status pendaftar">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pending"}
          className={tab === "pending" ? "btn btn--primary" : "btn btn--secondary"}
          onClick={() => setTab("pending")}
        >
          Menunggu ({pending.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "rejected"}
          className={tab === "rejected" ? "btn btn--primary" : "btn btn--secondary"}
          onClick={() => setTab("rejected")}
        >
          Ditolak ({rejected.length})
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="notice notice--ok">
          {tab === "pending"
            ? "Tidak ada pendaftar yang menunggu. Semua beres."
            : "Tidak ada pendaftaran yang ditolak."}
        </p>
      ) : (
        <div className="slots">
          {rows.map((request) => {
            const working = busy === request.id;
            const rowError = error?.id === request.id ? error.message : null;
            const waiting = needsOnboarding(request);
            const decided = decidedOn(request.decided_at);
            const reason = request.note?.trim();

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
                  {tab === "pending" && waiting ? (
                    <div className="slot__status">
                      <span className="badge badge--draft">belum isi data studio</span>
                    </div>
                  ) : null}

                  {tab === "rejected" && decided ? (
                    <div className="slot__status">Ditolak {decided}</div>
                  ) : null}
                </div>

                <div className="btn-row btn-row--inline">
                  {tab === "pending" ? (
                    <>
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
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={working}
                      aria-busy={working || undefined}
                      onClick={() => decide(request, "restore")}
                    >
                      {working ? "Memproses…" : "Pulihkan ke antrian"}
                    </button>
                  )}
                </div>

                {/* The admin's own words, printed under the row. `reject_access_request`
                    stores `p_note` verbatim and allows null, so an empty reason prints
                    nothing rather than "tanpa alasan". */}
                {tab === "rejected" && reason ? (
                  <p className="slot-row__note">Alasan: {reason}</p>
                ) : null}

                {rowError ? (
                  <p className="slot-row__error" role="alert">
                    {rowError}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
