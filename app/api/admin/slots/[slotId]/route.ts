// Admin slot toggle — user session, not service role.
//
// Since 0004 the `set_slot_status` RPC authorises against `auth.uid()` and raises
// `not_owner` for anyone else, so the service role key (no `auth.uid()`) can no
// longer drive this route. The session client carries the logged-in photographer's
// JWT, which is exactly what the RPC checks.

import { configErrorResponse } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/bookings";

/**
 * PATCH /api/admin/slots/[slotId]
 * body: { status: "open" | "closed" }
 *
 * All rules live in the `set_slot_status` RPC (supabase/migrations/0002_slot_status.sql,
 * user-scoped by 0004): status validation, ownership, and refusal to touch a slot
 * that already has a booking. This route only maps the RPC's exceptions to HTTP codes.
 */

type Body = { status?: unknown };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slotId: string }> },
) {
  const { slotId } = await params;

  // Auth first: an anonymous caller must not learn whether a slot id exists.
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  if (!isUuid(slotId)) {
    return Response.json(
      { error: "not_found", message: "Slot tidak ditemukan." },
      { status: 404 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json(
      { error: "invalid_request", message: "Body harus JSON." },
      { status: 400 },
    );
  }

  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (status !== "open" && status !== "closed") {
    return Response.json(
      { error: "invalid_status", message: 'status harus "open" atau "closed".' },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await guard.supabase.rpc("set_slot_status", {
      p_slot_id: slotId,
      p_status: status,
    });

    if (error) {
      const message = error.message ?? "";

      if (/not_owner/.test(message)) {
        // 403, not 400: the caller is logged in, the slot just isn't theirs. The UI
        // shows a different message for this than for a malformed request.
        return Response.json(
          { error: "not_owner", message: "Slot ini bukan milik akunmu." },
          { status: 403 },
        );
      }
      if (/slot_not_found/.test(message)) {
        return Response.json(
          { error: "not_found", message: "Slot tidak ditemukan." },
          { status: 404 },
        );
      }
      if (/slot_booked/.test(message)) {
        return Response.json(
          {
            error: "slot_booked",
            message: "Slot ini sudah punya booking. Batalkan booking dulu.",
          },
          { status: 409 },
        );
      }
      if (/invalid_status/.test(message)) {
        return Response.json(
          { error: "invalid_status", message: 'status harus "open" atau "closed".' },
          { status: 400 },
        );
      }

      console.error("set_slot_status failed", error);
      return Response.json(
        { error: "server_error", message: "Gagal mengubah status slot." },
        { status: 500 },
      );
    }

    const slot = Array.isArray(data) ? data[0] : data;
    if (!slot) {
      return Response.json(
        { error: "not_found", message: "Slot tidak ditemukan." },
        { status: 404 },
      );
    }

    return Response.json({ slot }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("PATCH /api/admin/slots/[slotId]", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
