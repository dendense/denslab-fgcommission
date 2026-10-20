import { AdminNavBar } from "@/app/_components/AdminNavBar";

export const instant = false;

/**
 * /users is a sibling of /admin, not a child, so `app/admin/layout.tsx` cannot cover it.
 * Same bar, rendered the same way (outside the page's own `<main className="shell">` so the
 * two pages do not disagree about where the bar sits).
 */
export default function UsersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="admin-nav-wrap">
        <div className="admin-nav-inner">
          <AdminNavBar />
        </div>
      </div>
      {children}
    </>
  );
}
