/**
 * RPC exception → HTTP mapping for the admin write routes.
 *
 * Every name below is raised verbatim by supabase/migrations/0006_slot_write_lock.sql
 * or 0007_event_write_lock.sql (`raise exception 'name' using errcode = 'P0001'`).
 * PostgREST puts the name in `error.message`, so matching is a substring test.
 *
 * There is deliberately no `duplicate_slug` entry: `events` has no slug column
 * (0001), and no RPC in 0006/0007 can raise it.
 */

export type RpcFailure = { status: number; error: string; message: string };

const DEFAULT: Record<string, [number, string]> = {
  not_owner: [403, "Event ini bukan milikmu."],
  not_photographer: [403, "Akunmu belum disetujui admin."],
  invalid_title: [400, "Judul event wajib diisi."],
  no_days: [400, "Tambahkan minimal satu hari dulu."],
  event_has_bookings: [409, "Event ini sudah punya booking."],
  day_has_bookings: [409, "Hari ini sudah punya slot terisi klien."],
  slot_booked: [409, "Slot ini sudah terisi klien."],
  duplicate_day: [409, "Tanggal itu sudah ada di event ini."],
  duplicate_seq: [409, "Nomor slot itu sudah dipakai di hari ini."],
  event_not_found: [404, "Event tidak ditemukan."],
  day_not_found: [404, "Hari tidak ditemukan."],
  slot_not_found: [404, "Slot tidak ditemukan."],
};

/**
 * `overrides` lets a route keep the same code but a narrower sentence — e.g. the
 * slot routes say "Slot ini bukan milik akunmu." instead of "Event ini …".
 */
export function rpcFailure(
  err: { message?: string; code?: string } | null,
  overrides: Record<string, string> = {},
): RpcFailure {
  // 0006/0007 not applied yet: PostgREST answers PGRST202 instead of running anything.
  if (err?.code === "PGRST202") {
    return {
      status: 503,
      error: "not_migrated",
      message: "Fungsi database belum ada — migrasi 0006/0007 belum diterapkan.",
    };
  }

  const message = err?.message ?? "";
  for (const [name, [status, text]] of Object.entries(DEFAULT)) {
    if (message.includes(name)) {
      return { status, error: name, message: overrides[name] ?? text };
    }
  }

  return { status: 500, error: "server_error", message: "Terjadi kesalahan di server." };
}
