import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { configErrorResponse, publicEnv } from "@/lib/supabase";

/**
 * POST /api/auth/logout — clears the session cookies.
 *
 * A route handler (not a server action) so the logout button can stay a plain
 * form/button on any page without turning the page into a client boundary.
 */
export async function POST() {
  try {
    const { url, key } = publicEnv();
    const store = await cookies();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) store.set(name, value, options);
        },
      },
    });

    await supabase.auth.signOut();

    // Belt and braces: signOut only clears cookies it knows about. Any `sb-*-auth-token`
    // left behind (older chunk layout, interrupted write) would resurrect the session.
    for (const cookie of store.getAll()) {
      if (cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token")) {
        store.delete(cookie.name);
      }
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("POST /api/auth/logout", err);
    return NextResponse.json(
      { error: "server_error", message: "Gagal keluar." },
      { status: 500 },
    );
  }
}
