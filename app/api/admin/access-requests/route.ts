// Admin-only access request queue. Session client, not service role: the RLS
// policies on `access_requests` already say "own row or admin", and the approve /
// reject RPCs enforce `is_admin()` themselves
// (supabase/migrations/0005_access_requests.sql).

import { configErrorResponse } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/bookings";

/**
 * GET /api/admin/access-requests            → pending only (the queue)
 * GET /api/admin/access-requests?status=all → every request, any status
 *
 * `?status=rejected` was removed with the rejected tab: since 0019 a rejection deletes the
 * row, so that filter can only ever answer with an empty list.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const status = new URL(request.url).searchParams.get("status");

  try {
    let query = guard.supabase
      .from("access_requests")
      .select("id,user_id,email,display_name,studio_name,contact_wa,status,requested_at,decided_at,note")
      .order("requested_at", { ascending: true });

    if (status !== "all") {
      query = query.eq("status", "pending");
    }

    const { data, error } = await query;
    if (error) {
      console.error("GET /api/admin/access-requests", error);
      return Response.json(
        { error: "server_error", message: "Gagal memuat daftar pendaftar." },
        { status: 500 },
      );
    }

    return Response.json(
      { requests: data ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("GET /api/admin/access-requests", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/access-requests
 * body: { request_id: uuid, action: "approve" | "reject" }
 *
 * Approve creates the photographer row (slug generated in SQL) and returns it, so
 * the caller can show the studio slug without a second round trip.
 *
 * Reject DELETES the request row (0019) and the function returns `void`, so the response
 * body carries `result: null` for it. That is the honest answer — the row is gone, and
 * returning a copy would make the UI print "rejected" for something no longer in the queue.
 *
 * `p_note` is not sent: 0019 keeps the parameter only so old callers do not fail PGRST202,
 * and throws the value away. Sending it would pretend a reason was stored.
 */

type Body = { request_id?: unknown; action?: unknown };

const ACTIONS = ["approve", "reject"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json(
      { error: "invalid_request", message: "Body harus JSON." },
      { status: 400 },
    );
  }

  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const action = typeof body.action === "string" ? body.action : "";

  if (!isUuid(requestId)) {
    return Response.json(
      { error: "invalid_request", message: "request_id tidak valid." },
      { status: 400 },
    );
  }
  if (!ACTIONS.includes(action as Action)) {
    return Response.json(
      { error: "invalid_request", message: 'action harus "approve" atau "reject".' },
      { status: 400 },
    );
  }

  try {
    const { data, error } =
      action === "approve"
        ? await guard.supabase.rpc("approve_access_request", { p_request_id: requestId })
        : await guard.supabase.rpc("reject_access_request", { p_request_id: requestId });

    if (error) {
      const message = error.message ?? "";
      if (/not_admin/.test(message)) {
        return Response.json(
          { error: "not_admin", message: "Hanya admin yang boleh melakukan ini." },
          { status: 403 },
        );
      }
      if (/invalid_state/.test(message)) {
        const text =
          action === "approve"
            ? "Permintaan ini sudah diputuskan."
            : "Pendaftaran ini sudah diputuskan, jadi tidak bisa ditolak lagi. Muat ulang halaman.";
        return Response.json({ error: "invalid_state", message: text }, { status: 409 });
      }
      if (/incomplete_registration/.test(message)) {
        return Response.json(
          {
            error: "incomplete_registration",
            message:
              "Pendaftar ini belum mengisi nama studio dan nomor WA, jadi studio belum bisa dibuat. Minta dia melengkapi data di halaman onboarding.",
          },
          { status: 409 },
        );
      }
      if (/not_found/.test(message)) {
        return Response.json(
          { error: "not_found", message: "Permintaan tidak ditemukan." },
          { status: 404 },
        );
      }

      console.error(`${action}_access_request failed`, error);
      return Response.json(
        { error: "server_error", message: "Gagal memproses permintaan." },
        { status: 500 },
      );
    }

    return Response.json(
      { ok: true, action, result: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("POST /api/admin/access-requests", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
