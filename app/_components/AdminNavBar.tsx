import { connection } from "next/server";
import { isAdmin, sessionClient } from "@/lib/auth";
import { AdminNav } from "./AdminNav";

/**
 * The admin nav bar, with its "may I show Users?" question answered here.
 *
 * Used from `app/admin/layout.tsx` (every /admin route) and `app/users/layout.tsx` — /users
 * is a sibling of /admin, not a child, so one layout cannot cover both. One wrapper keeps
 * the is_admin() check in a single place instead of two copies that could drift.
 *
 * `await connection()` FIRST, before the session read. A layout renders before its page's
 * `connection()`, so without this the Supabase client's `Date.now()` lands in the
 * prerendered shell and Next fails the whole route with "unstable value Date.now() while
 * prerendering" — which is exactly what happened on /admin, /admin/events/new and /users
 * until this line was added. The bar is session-dependent; it has to be request-time.
 *
 * A failed session read degrades to "no Users tab" rather than throwing: the pages report
 * their own auth and migration states, and the nav must never be what breaks a page.
 */
export async function AdminNavBar() {
  await connection();

  let showUsers = false;

  try {
    showUsers = await isAdmin(await sessionClient());
  } catch {
    showUsers = false;
  }

  return <AdminNav showUsers={showUsers} />;
}
