// Edit or delete a slot — user session, not service role.
//
// `slots` is read-only for `authenticated` since 0006. Three RPCs behind this path:
//   PATCH  { status }                          → set_slot_status  (0002 + 0004)
//   PATCH  { price_idr?, starts_at?, ends_at? } → update_slot      (0006)
//   DELETE                                     → delete_slot      (0006)
// The UI never offers price/time edits on a `booked` slot, but the RPC refuses them
// anyway (`slot_booked`) — the rule lives in the database, not in a disabled button.

import { configErrorResponse } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/bookings";
import { rpcErrorResponse } from "@/lib/admin-errors";

const SLOT_OVERRIDES = { not_owner: "Slot ini bukan milik akunmu." };

type Body = {
  status?: unknown;
  price_idr?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
};

/**
 * PATCH /api/admin/slots/[slotId]
 * body: { status: "open" | "closed" } | { price_idr?, starts_at?, ends_at? }
 */
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
      { error: "slot_not_found", message: "Slot tidak ditemukan." },
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

  try {
    // Status toggle: its own RPC, its own validation.
    if (body.status !== undefined) {
      const status = typeof body.status === "string" ? body.status.trim() : "";
      if (status !== "open" && status !== "closed") {
        return Response.json(
          { error: "invalid_status", message: 'status harus "open" atau "closed".' },
          { status: 400 },
        );
      }

      const { data, error } = await guard.supabase.rpc("set_slot_status", {
        p_slot_id: slotId,
        p_status: status,
      });

      if (error) return rpcErrorResponse(error, SLOT_OVERRIDES);

      const slot = Array.isArray(data) ? data[0] : data;
      return Response.json({ slot }, { headers: { "Cache-Control": "no-store" } });
    }

    // Price / time edit.
    const price = body.price_idr === undefined ? null : Number(body.price_idr);
    const startsAt = typeof body.starts_at === "string" ? body.starts_at : null;
    const endsAt = typeof body.ends_at === "string" ? body.ends_at : null;

    if (price !== null && (!Number.isInteger(price) || price < 0)) {
      return Response.json(
        { error: "invalid_price", message: "Harga harus angka ≥ 0." },
        { status: 400 },
      );
    }
    for (const iso of [startsAt, endsAt]) {
      if (iso !== null && !Number.isFinite(Date.parse(iso))) {
        return Response.json(
          { error: "invalid_time", message: "Jam slot tidak valid." },
          { status: 400 },
        );
      }
    }
    if (price === null && startsAt === null && endsAt === null) {
      return Response.json(
        { error: "invalid_request", message: "Tidak ada yang diubah." },
        { status: 400 },
      );
    }

    const { data, error } = await guard.supabase.rpc("update_slot", {
      p_slot_id: slotId,
      p_price_idr: price,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
    });

    if (error) return rpcErrorResponse(error, SLOT_OVERRIDES);

    const slot = Array.isArray(data) ? data[0] : data;
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

/** DELETE /api/admin/slots/[slotId] — refused when the slot is booked (`slot_booked`). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slotId: string }> },
) {
  const { slotId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  if (!isUuid(slotId)) {
    return Response.json(
      { error: "slot_not_found", message: "Slot tidak ditemukan." },
      { status: 404 },
    );
  }

  try {
    const { error } = await guard.supabase.rpc("delete_slot", { p_slot_id: slotId });

    if (error) return rpcErrorResponse(error, SLOT_OVERRIDES);

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("DELETE /api/admin/slots/[slotId]", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
