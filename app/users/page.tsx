import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { isAdmin, sessionClient } from "@/lib/auth";
import { DbNotMigratedError } from "@/lib/db-errors";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { DbNotReady } from "@/app/_components/DbNotReady";
import { readStats } from "./stats";
import { UsersList } from "./UsersList";

export const metadata = { title: "Users — Admin" };

// Everything here depends on the session and on a live query; no static shell.
export const instant = false;

// No <Suspense>: streaming pins the status at 200, which would turn the redirects below
// into soft ones — a photographer would see the admin shell flash before being sent away.
export default function Page() {
  return (
    <main className="shell">
      <View />
    </main>
  );
}

async function View() {
  await connection();

  try {
    return await Content();
  } catch (err) {
    if (err instanceof MissingConfigError) return <ServerNotReady />;
    if (err instanceof DbNotMigratedError) return <DbNotReady code={err.code} />;
    throw err;
  }
}

/**
 * Admin-only page, and the gate says so before reading any statistic.
 *
 * Three answers, matching the /admin gate from FIX-3:
 *   no session            → /login
 *   signed in, not admin  → /admin (which explains "belum disetujui", and is the page a
 *                            photographer actually has). A 403 page here would be a dead
 *                            end for someone who is a legitimate photographer.
 *   admin                 → the list
 *
 * `is_admin()` — the same predicate the 0010 RLS policies use — rather than a select on
 * `admin_users`, so the gate and the policies cannot disagree.
 */
async function Content() {
  const supabase = await sessionClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  if (!(await isAdmin(supabase))) redirect("/admin");

  const stats = await readStats(supabase);

  return (
    <div className="stack">
      <header className="stack">
        <p className="eyebrow">Admin</p>
        <h1>Users</h1>
        <p className="lede">
          Statistik per studio. Angka dihitung database saat halaman dimuat.
        </p>
      </header>

      <UsersList initial={{ stats, search: "" }} />
    </div>
  );
}
