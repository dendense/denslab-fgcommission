/** Display helpers. All times render in Asia/Jakarta and say "WIB" out loud. */

export const TZ = "Asia/Jakarta";

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const moneyFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function timeWIB(iso: string): string {
  return `${timeFmt.format(new Date(iso))} WIB`;
}

export function rangeWIB(startIso: string, endIso: string): string {
  return `${timeFmt.format(new Date(startIso))}–${timeFmt.format(new Date(endIso))} WIB`;
}

export function dateWIB(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function rupiah(idr: number): string {
  // "Rp75.000", no space: the card's house style, and it keeps the admin slot editor
  // and the public page reading the same string.
  return `Rp${moneyFmt.format(idr)}`;
}

/** Indonesian mobile: 08…, +628…, or 628…. Mirrors the server's normaliseWa. */
export const WA_RE = /^(?:\+62|62|0)8\d{7,12}$/;

export function waValid(raw: string): boolean {
  return WA_RE.test(raw.replace(/[\s\-().]/g, ""));
}

/** wa.me wants digits only, with country code and no plus. */
export function waLink(contactWa: string | null, text: string): string | null {
  if (!contactWa) return null;
  const digits = contactWa.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
