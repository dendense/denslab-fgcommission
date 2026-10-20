"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Event · Users tabs for the admin surface.
 *
 * `showUsers` comes from the server, which already asked `is_admin()` — a photographer
 * must not see a tab whose page would only redirect him back. Active state is read from
 * the pathname (this nav renders on both /admin and /users) and marked with
 * `aria-current="page"`; the CSS keys off that same attribute, so the visual state cannot
 * drift from what a screen reader announces.
 */
export function AdminNav({ showUsers }: { showUsers: boolean }) {
  const pathname = usePathname() ?? "";
  const onUsers = pathname === "/users" || pathname.startsWith("/users/");

  return (
    <nav className="admin-nav" aria-label="Navigasi admin">
      <Link className="admin-nav__tab" href="/admin" aria-current={onUsers ? undefined : "page"}>
        Event
      </Link>
      {showUsers ? (
        <Link className="admin-nav__tab" href="/users" aria-current={onUsers ? "page" : undefined}>
          Users
        </Link>
      ) : null}
    </nav>
  );
}
