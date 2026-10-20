// Admin-only access request queue. Session client, not service role: the RLS
// policies on `access_requests` already say "own row or admin", and the approve /
// reject RPCs enforce `is_admin()` themselves
// (supabase/migrations/0005_access_requests.sql).

import { configErrorResponse } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/bookings";

/**
 * GET /api/admin/access-requests            → pending only (the default queue)
 * GET /api/admin/access-requests?status=all → every request, any status
 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const all = new URL(request.url).searchParams.get("status") === "all";

  try {
    let query = guard.supabase
      .from("access_requests")
      .select("id,user_id,email,display_name,contact_wa,status,requested_at,decided_at,note")
      .order("requested_at", { ascending: true });

    if (!all) query = query.eq("status", "pending");

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
 * body: { request_id: uuid, action: "approve" | "reject", note?: string }
 *
 * Approve creates the photographer row (slug generated in SQL) and returns it, so
 * the caller can show the studio slug without a second round trip.
 */

type Body = { request_id?: unknown; action?: unknown; note?: unknown };

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
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (!isUuid(requestId)) {
    return Response.json(
      { error: "invalid_request", message: "request_id tidak valid." },
      { status: 400 },
    );
  }
  if (action !== "approve" && action !== "reject") {
    return Response.json(
      { error: "invalid_request", message: 'action harus "approve" atau "reject".' },
      { status: 400 },
    );
  }

  try {
    const { data, error } =
      action === "approve"
        ? await guard.supabase.rpc("approve_access_request", { p_request_id: requestId })
        : await guard.supabase.rpc("reject_access_request", {
            p_request_id: requestId,
            p_note: note,
          });

    if (error) {
      const message = error.message ?? "";
      if (/not_admin/.test(message)) {
        return Response.json(
          { error: "not_admin", message: "Hanya admin yang boleh melakukan ini." },
          { status: 403 },
        );
      }
      if (/invalid_state/.test(message)) {
        return Response.json(
          {
            error: "invalid_state",
            message:
              action === "approve"
                ? "Permintaan ini sudah ditolak sebelumnya."
                : "Permintaan ini sudah diputuskan.",
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
