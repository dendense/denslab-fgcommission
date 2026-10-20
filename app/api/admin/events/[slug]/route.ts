// Admin event read — user session, not service role.
//
// `admin_event` (supabase/migrations/0004_auth_ownership.sql) checks the event
// belongs to `current_photographer_id()` and raises `not_owner` otherwise. The
// service role has no `auth.uid()`, so it would be refused; the session client is
// the only caller that works.

import { configErrorResponse } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import type { PublicEvent } from "@/lib/types";

/**
 * GET /api/admin/events/[slug] — admin event payload, every slot included.
 *
 * Same JSON shape as GET /api/events/[slug] (both come from a function with the
 * same projection), but through `admin_event`, which does not filter out `closed`
 * slots. The public route is untouched on purpose: closed slots must stay
 * invisible to clients.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const { data, error } = await guard.supabase.rpc("admin_event", {
      p_slug: slug,
    });

    if (error) {
      if (/not_owner/.test(error.message ?? "")) {
        return Response.json(
          { error: "not_owner", message: "Event ini bukan milik akunmu." },
          { status: 403 },
        );
      }
      console.error("GET /api/admin/events/[slug]", error);
      return Response.json(
        { error: "server_error", message: "Gagal memuat event." },
        { status: 500 },
      );
    }

    const payload = data as Omit<PublicEvent, "timezone"> | null;
    if (!payload?.event) {
      return Response.json(
        { error: "not_found", message: "Event tidak ditemukan." },
        { status: 404 },
      );
    }

    return Response.json(
      { ...payload, timezone: "Asia/Jakarta" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("GET /api/admin/events/[slug]", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
