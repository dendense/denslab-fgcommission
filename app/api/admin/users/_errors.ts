import { jsonError, rpcErrorResponse } from "@/lib/admin-errors";

/**
 * Error mapping for the two RPCs added by 0010.
 *
 * `lib/admin-errors.ts` is the one error→HTTP table, but it lists only the names raised by
 * 0006/0007; `not_admin` and `photographer_not_found` are new in 0010 and that file is not
 * mine to edit (see the card's territory split). So the two new names are answered here and
 * everything else — `invalid_title` → 400, PGRST202 → 503, unmapped → 500 — is delegated to
 * `rpcErrorResponse` unchanged.
 *
 * When those two entries do land in ADMIN_ERROR_STATUS, delete this file: no call site
 * changes, because both are `{ error, message }` with the same shape.
 */
const STATUS_0010: Record<string, number> = {
  not_admin: 403,
  photographer_not_found: 404,
};

const MESSAGES_0010: Record<string, string> = {
  not_admin: "Hanya admin yang boleh melakukan ini.",
  photographer_not_found: "Fotografer tidak ditemukan.",
};

export function rpc0010Error(err: { message?: string; code?: string } | null): Response {
  const message = err?.message ?? "";
  const name = Object.keys(STATUS_0010).find((n) => message.includes(n));

  if (name) {
    return Response.json(
      { error: name, message: MESSAGES_0010[name] },
      { status: STATUS_0010[name] },
    );
  }

  return rpcErrorResponse(err);
}

export { jsonError };
