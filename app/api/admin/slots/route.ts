// Add a slot to an event day — user session, not service role.
//
// `slots` is read-only for `authenticated` since 0006; `create_slot` is the only door.
// The new slot is always `open`: a `booked` slot only ever comes from `book_slot`.
// `duplicate_seq` comes from the unique(event_day_id, seq) constraint in 0001.

import { configErrorResponse } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/bookings";
import { rpcFailure } from "@/lib/rpc-error";

type Body = {
  event_day_id?: unknown;
  seq?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  price_idr?: unknown;
};

/** POST /api/admin/slots  body: { event_day_id, seq, starts_at, ends_at, price_idr } */
export async function POST(request: Request) {
  const guard = await requireUser();
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

  const dayId = typeof body.event_day_id === "string" ? body.event_day_id : "";
  const seq = typeof body.seq === "number" ? body.seq : Number(body.seq);
  const startsAt = typeof body.starts_at === "string" ? body.starts_at : "";
  const endsAt = typeof body.ends_at === "string" ? body.ends_at : "";
  const price = typeof body.price_idr === "number" ? body.price_idr : Number(body.price_idr);

  if (!isUuid(dayId)) {
    return Response.json(
      { error: "day_not_found", message: "Hari tidak ditemukan." },
      { status: 404 },
    );
  }
  if (!Number.isInteger(seq) || seq < 1) {
    return Response.json(
      { error: "invalid_seq", message: "Nomor slot harus bilangan bulat ≥ 1." },
      { status: 400 },
    );
  }
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return Response.json(
      { error: "invalid_time", message: "Jam slot tidak valid." },
      { status: 400 },
    );
  }
  if (endMs <= startMs) {
    return Response.json(
      { error: "invalid_time", message: "Jam selesai harus setelah jam mulai." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(price) || price < 0) {
    return Response.json(
      { error: "invalid_price", message: "Harga harus angka ≥ 0." },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await guard.supabase.rpc("create_slot", {
      p_event_day_id: dayId,
      p_seq: seq,
      p_starts_at: new Date(startMs).toISOString(),
      p_ends_at: new Date(endMs).toISOString(),
      p_price_idr: price,
    });

    if (error) {
      const failure = rpcFailure(error);
      if (failure.status === 500) console.error("create_slot failed", error);
      return Response.json(failure, { status: failure.status });
    }

    const slot = Array.isArray(data) ? data[0] : data;
    return Response.json(
      { slot },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("POST /api/admin/slots", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
