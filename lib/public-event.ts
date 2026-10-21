import { anonClient, MissingConfigError } from "./supabase";
import type { PublicEvent } from "./types";

export type EventResult =
  | { ok: true; data: PublicEventWithInstagram }
  | { ok: false; reason: "not_found" | "not_configured" };

/**
 * `public_event` (0018) also returns `photographer.instagram`. `lib/types.ts` describes the
 * columns the app reads everywhere; the public page is the only caller that needs this one,
 * so the extra field is declared here instead of widening the shared type.
 */
export type PublicEventWithInstagram = PublicEvent & {
  photographer: PublicEvent["photographer"] & { instagram: string | null };
};

/**
 * Public event payload — the same `public_event` RPC that
 * GET /api/events/[slug] serves, called directly from the server component so
 * the first paint is real HTML instead of a client-side fetch waterfall.
 *
 * A missing Supabase credential is reported as its own reason, never as
 * "not found": telling the client their event vanished because the server is
 * unconfigured would send them re-checking a link that is fine.
 */
export async function getPublicEvent(slug: string): Promise<EventResult> {
  try {
    const { data, error } = await anonClient().rpc("public_event", { p_slug: slug });
    if (error) throw error;
    const payload = data as Omit<PublicEventWithInstagram, "timezone"> | null;
    if (!payload?.event) return { ok: false, reason: "not_found" };
    return { ok: true, data: { ...payload, timezone: "Asia/Jakarta" } };
  } catch (err) {
    if (err instanceof MissingConfigError) return { ok: false, reason: "not_configured" };
    throw err;
  }
}
