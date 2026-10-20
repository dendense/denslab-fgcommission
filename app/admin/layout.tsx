import { AdminNavBar } from "@/app/_components/AdminNavBar";

export const instant = false;

/**
 * Nav bar for every /admin route.
 *
 * A layout, not a line inside `app/admin/page.tsx`, because the tab must appear on the
 * list page *and* the event form *and* the editor — one file instead of four copies.
 *
 * Not a `<main className="shell">` wrapper: every page already renders its own shell, and
 * nesting two would double the 16px padding and the 480px max width. The bar carries its
 * own centered inner box and the page keeps its layout.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
