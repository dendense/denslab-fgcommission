/**
 * RPC exception → HTTP mapping for the admin write routes.
 *
 * Every name in `ADMIN_ERROR_STATUS` is raised verbatim by
 * supabase/migrations/0006_slot_write_lock.sql or 0007_event_write_lock.sql
 * (`raise exception 'name' using errcode = 'P0001'`). PostgREST puts the name in
 * `error.message`, so matching is a substring test.
 *
 * There is deliberately no `duplicate_slug` entry: `events` has no slug column
 * (0001/0007), and no RPC can raise it.
 *
 * Body shape: 4xx → `{ error: "<name>", message }` (name is what the client
 * branches on, message is the sentence it shows). 500 → `{ error: "internal" }`
 * and nothing else: a raw Postgres message never reaches the client.
 */

export const ADMIN_ERROR_STATUS: Record<string, number> = {
  not_owner: 403,
  not_photographer: 403,
  invalid_title: 400,
  invalid_status: 400,
  no_days: 400,
  duplicate_day: 409,
  duplicate_seq: 409,
  event_has_bookings: 409,
  day_has_bookings: 409,
  slot_booked: 409,
  event_not_found: 404,
  day_not_found: 404,
  slot_not_found: 404,
};

export const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  not_owner: "Event ini bukan milikmu.",
  not_photographer: "Akunmu belum disetujui admin.",
  invalid_title: "Judul tidak boleh kosong.",
  invalid_status: "Status tidak dikenal.",
  no_days: "Tambahkan minimal satu hari dulu.",
  duplicate_day: "Tanggal itu sudah ada di event ini.",
  duplicate_seq: "Nomor slot itu sudah dipakai di hari ini.",
  event_has_bookings: "Event ini sudah punya booking.",
  day_has_bookings: "Hari ini sudah punya slot terisi klien.",
  slot_booked: "Slot ini sudah terisi klien.",
  event_not_found: "Event tidak ditemukan.",
  day_not_found: "Hari tidak ditemukan.",
  slot_not_found: "Slot tidak ditemukan.",
};

/**
 * `overrides` keeps the same code but a narrower sentence — the slot routes say
 * "Slot ini bukan milik akunmu." instead of the generic ownership line.
 */
export function jsonError(name: string, overrides: Record<string, string> = {}): Response {
  const status = ADMIN_ERROR_STATUS[name] ?? 500;

  if (status === 500) {
    console.error("unmapped admin error", name);
    return Response.json({ error: "internal" }, { status: 500 });
  }

  return Response.json(
    { error: name, message: overrides[name] ?? ADMIN_ERROR_MESSAGES[name] ?? "Permintaan ditolak." },
    { status },
  );
}

/**
 * PostgREST error → Response. PGRST202 means the function does not exist yet
 * (a migration that creates it has not run); answering 500 there would read as a bug in
 * the route.
 *
 * The message names the code, not a migration range: the server cannot know which
 * migrations a given database is missing, and a hardcoded range ("0006/0007") sends the
 * reader looking for files that may already be applied.
 */
export function rpcErrorResponse(
  err: { message?: string; code?: string } | null,
  overrides: Record<string, string> = {},
): Response {
  if (err?.code === "PGRST202") {
    return Response.json(
      {
        error: "not_migrated",
        message:
          "Fungsi database yang dipanggil belum ada (PGRST202). Ini masalah database, " +
          "bukan salah isian — cocokkan skema dengan migrasi terakhir di repo.",
      },
      { status: 503 },
    );
  }

  const message = err?.message ?? "";
  const name = Object.keys(ADMIN_ERROR_STATUS).find((n) => message.includes(n));
  if (!name) {
    console.error("unmapped rpc error", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }

  return jsonError(name, overrides);
}
