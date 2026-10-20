import { anonClient, configErrorResponse } from "@/lib/supabase";

/**
 * GET /api/events/[slug] — public event data.
 *
 * Reads through the `public_event` RPC, which projects exactly the public
 * columns. A plain PostgREST embed cannot be used here: `photographers` only
 * grants anon three columns, and an embed needs `photographers.id` to join, so
 * the query would fail on the column-level grant.
 *
 * The RPC never touches `bookings`, so client_name / client_wa / ics_token can
 * not leak from this route no matter what the caller does.
 */

type Slot = {
  id: string;
  seq: number;
  starts_at: string;
  ends_at: string;
  price_idr: number;
  status: "open" | "booked";
};

type Payload = {
  event: { id: string; slug: string; title: string; location: string | null; status: string };
  photographer: { display_name: string | null; contact_wa: string | null };
  days: Array<{
    id: string;
    day_date: string;
    start_time: string;
    end_time: string;
    slots: Slot[];
  }>;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  try {
    const supabase = anonClient();

    const { data, error } = await supabase.rpc("public_event", { p_slug: slug });

    if (error) {
      console.error("GET /api/events/[slug]", error);
      return Response.json(
        { error: "server_error", message: "Gagal memuat event." },
        { status: 500 },
      );
    }

    const payload = data as Payload | null;
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
    console.error("GET /api/events/[slug]", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
