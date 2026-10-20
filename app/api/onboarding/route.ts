// Onboarding write: `complete_registration(p_studio_name, p_contact_wa)` (0013).
//
// Session client, NOT the service role. 0013 grants execute on this function to
// `authenticated` only; the function keys off `auth.uid()` and writes only the caller's
// own `access_requests` row. A service client has no `auth.uid()` → `42501` and
// `no_registration`, which reads like a bug in the form instead of a wrong client.

import { configErrorResponse } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { isSchemaError } from "@/lib/db-errors";

type Body = { studio_name?: unknown; contact_wa?: unknown };

/**
 * POST /api/onboarding  body: { studio_name, contact_wa }
 *
 * Field errors come back as `field` so the form can put the sentence under the input that
 * caused it — `invalid_studio_name` under the name, `invalid_contact_wa` under the WA.
 * The database is the authority on both thresholds (name ≥ 2 chars, WA ≥ 8 digits);
 * duplicating them here would drift.
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json(
      { error: "invalid_request", message: "Body harus JSON." },
      { status: 400 },
    );
  }

  const studioName = typeof body.studio_name === "string" ? body.studio_name : "";
  const contactWa = typeof body.contact_wa === "string" ? body.contact_wa : "";

  try {
    const { data, error } = await guard.supabase.rpc("complete_registration", {
      p_studio_name: studioName,
      p_contact_wa: contactWa,
    });

    if (error) {
      const message = error.message ?? "";

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
      if (/invalid_studio_name/.test(message)) {
        return Response.json(
          {
            error: "invalid_studio_name",
            field: "studio_name",
            message: "Nama studio minimal 2 karakter.",
          },
          { status: 422 },
        );
      }
      if (/invalid_contact_wa/.test(message)) {
        return Response.json(
          {
            error: "invalid_contact_wa",
            field: "contact_wa",
            message: "Nomor WA minimal 8 digit angka. Contoh: 081234567890.",
          },
          { status: 422 },
        );
      }
      if (/already_decided/.test(message)) {
        return Response.json(
          {
            error: "already_decided",
            message:
              "Pendaftaranmu sudah diputuskan admin, jadi data ini tidak bisa diubah lagi.",
          },
          { status: 409 },
        );
      }
      if (/no_registration/.test(message)) {
        return Response.json(
          {
            error: "no_registration",
            message: "Akun ini tidak punya pendaftaran. Daftar dulu lewat halaman daftar.",
          },
          { status: 404 },
        );
      }

      console.error("POST /api/onboarding complete_registration", error);
      return Response.json(
        {
          error: "server_error",
          code: error.code,
          message: error.message || "Gagal menyimpan data studio.",
        },
        { status: 500 },
      );
    }

    return Response.json(
      { ok: true, registration: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("POST /api/onboarding", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
