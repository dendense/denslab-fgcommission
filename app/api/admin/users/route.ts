// GET /api/admin/users?search=…  →  admin_photographer_stats(p_search)
//
// Session client, no service role: the RPC is `security definer` but authorises on
// `is_admin()` from the caller's JWT, so a photographer calling this gets 403 not_admin.
//
// `search` goes straight to Postgres — the substring / name-or-email match happens inside
// the RPC (0010), not here and not in the browser. That is the whole point: the client must
// not be the thing that decides which rows match.

import { requireAdmin } from "@/lib/auth";
import { DbNotMigratedError } from "@/lib/db-errors";
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
          message: "Fungsi database belum ada — migrasi 0010 belum diterapkan.",
        },
        { status: 503 },
      );
    }
    console.error("admin users stats", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
