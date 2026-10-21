// GET  /api/admin/users?search=…  →  admin_photographer_stats(p_search)
// POST /api/admin/users           →  archive_photographer | unarchive_photographer |
//                                     delete_photographer  (all 0019)
//
// Session client, no service role: the RPCs are `security definer` but authorise on
// `is_admin()` from the caller's JWT, so a photographer calling this gets 403 not_admin.
//
// `search` goes straight to Postgres — the substring / name-or-email match happens inside
// the RPC (0010), not here and not in the browser. That is the whole point: the client must
// not be the thing that decides which rows match.

import { requireAdmin } from "@/lib/auth";
import { DbNotMigratedError, isSchemaError } from "@/lib/db-errors";
import { isUuid } from "@/lib/bookings";
import { readStats } from "@/app/users/stats";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams.get("search") ?? "";

  try {
    const stats = await readStats(guard.supabase, search);
    return Response.json({ stats, search: search.trim() }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof DbNotMigratedError) {
      return Response.json(
        {
          error: "not_migrated",
          // The code, message, details and hint travel together: `details` is what names
          // the column and the type, and it is the reason this screen was undiagnosable.
          code: err.db.code,
          message: err.db.message ?? "Database menolak permintaan ini.",
          details: err.db.details,
          hint: err.db.hint,
        },
        { status: 503 },
      );
    }
    console.error("admin users stats", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}

/** The three 0019 RPCs, all `(p_photographer_id uuid) → void`. */
const ACTIONS = {
  archive: "archive_photographer",
  unarchive: "unarchive_photographer",
  delete: "delete_photographer",
} as const;

type Action = keyof typeof ACTIONS;

/**
 * The refusals each RPC can raise, in the words the admin needs.
 *
 * `photographer_has_events` is the one that matters: `events.photographer_id` is
 * `on delete cascade` (0001), so without that guard one DELETE would take the studio's
 * events, days, slots and bookings with it. The UI must never offer a "force" path past
 * this answer — archiving is the action for a studio with history.
 */
const REFUSALS: Record<string, { status: number; message: string }> = {
  not_admin: { status: 403, message: "Hanya admin yang boleh melakukan ini." },
  not_found: { status: 404, message: "Fotografer tidak ditemukan. Muat ulang halaman." },
  already_archived: { status: 409, message: "Fotografer ini sudah diarsipkan." },
  not_archived: { status: 409, message: "Fotografer ini tidak sedang diarsipkan." },
  photographer_has_events: {
    status: 409,
    message: "Fotografer ini punya event. Arsipkan saja.",
  },
};

/**
 * POST /api/admin/users  body: { photographer_id: uuid, action: "archive"|"unarchive"|"delete" }
 *
 * Separate from the GET so the search read stays read-only. Every action is keyed by the
 * photographer id from the body — there is no "current studio" path here, because /users is
 * an admin screen acting on other people's rows.
 */
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: { photographer_id?: unknown; action?: unknown };
  try {
    body = (await request.json()) as { photographer_id?: unknown; action?: unknown };
  } catch {
    return Response.json(
      { error: "invalid_request", message: "Body harus JSON." },
      { status: 400 },
    );
  }

  const photographerId = typeof body.photographer_id === "string" ? body.photographer_id : "";
  const action = typeof body.action === "string" ? body.action : "";

  if (!isUuid(photographerId)) {
    return Response.json(
      { error: "invalid_request", message: "photographer_id tidak valid." },
      { status: 400 },
    );
  }
  if (!(action in ACTIONS)) {
    return Response.json(
      { error: "invalid_request", message: 'action harus "archive", "unarchive", atau "delete".' },
      { status: 400 },
    );
  }

  try {
    const { error } = await guard.supabase.rpc(ACTIONS[action as Action], {
      p_photographer_id: photographerId,
    });

    if (error) {
      // PGRST202 = 0019 not applied. Say so; do not surface the raw code to the admin.
      if (isSchemaError(error.code)) {
        return Response.json(
          {
            error: "not_migrated",
            code: error.code,
            message: "Aplikasi belum siap — migrasi database belum lengkap.",
          },
          { status: 503 },
        );
      }

      const message = error.message ?? "";
      const name = Object.keys(REFUSALS).find((n) => message.includes(n));
      if (name) {
        return Response.json(
          { error: name, message: REFUSALS[name].message },
          { status: REFUSALS[name].status },
        );
      }

      console.error(`admin users ${action}`, error);
      return Response.json(
        { error: "internal", message: "Gagal memproses. Coba lagi." },
        { status: 500 },
      );
    }

    return Response.json({ ok: true, action }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof DbNotMigratedError) {
      return Response.json(
        {
          error: "not_migrated",
          code: err.db.code,
          message: "Aplikasi belum siap — migrasi database belum lengkap.",
        },
        { status: 503 },
      );
    }
    console.error(`admin users ${action}`, err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
