"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { waValid } from "@/lib/format";
import type { ApiError, BookingCreated } from "@/lib/types";

type FieldErrors = { client_name?: string; client_wa?: string; notes?: string };

export function BookingForm({
  slotId,
  slug,
  priceLabel,
}: {
  slotId: string;
  slug: string;
  priceLabel: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [wa, setWa] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (name.trim().length < 2 || name.trim().length > 80) {
      next.client_name = "Nama harus 2–80 karakter.";
    }
    if (!waValid(wa)) {
      next.client_wa = "Nomor WA tidak valid. Contoh: 081234567890.";
    }
    if (notes.trim().length > 500) {
      next.notes = "Catatan maksimal 500 karakter.";
    }
    return next;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    // Client validation is a courtesy; the server decides. Both run.
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_id: slotId,
          client_name: name.trim(),
          client_wa: wa.trim(),
          notes: notes.trim(),
        }),
      });

      if (res.status === 201) {
        const ok = (await res.json()) as BookingCreated;
        router.push(ok.confirmation_url);
        return;
      }

      // 409: someone took the slot between page load and submit. Say it plainly
      // and go back to the list, which re-fetches fresh slot status server-side.
      if (res.status === 409) {
        setFormError("Slot ini baru saja diambil. Silakan pilih slot lain.");
        router.replace(`/e/${slug}?taken=1`);
        router.refresh();
        return;
      }

      const body = (await res.json().catch(() => null)) as ApiError | null;
      if (res.status === 400 && body?.field) {
        setErrors({ [body.field]: body.message } as FieldErrors);
        setPending(false);
        return;
      }
      setFormError(body?.message ?? "Gagal menyimpan booking. Coba lagi.");
      setPending(false);
    } catch {
      setFormError("Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.");
      setPending(false);
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit} noValidate>
      {formError ? (
        <p className="notice notice--warn" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="client_name">Nama</label>
        <input
          id="client_name"
          name="client_name"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.client_name ? "true" : undefined}
          aria-describedby={errors.client_name ? "err-name" : undefined}
        />
        {errors.client_name ? (
          <span className="field-error" id="err-name">
            {errors.client_name}
          </span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="client_wa">Nomor WhatsApp</label>
        <input
          id="client_wa"
          name="client_wa"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="081234567890"
          value={wa}
          onChange={(e) => setWa(e.target.value)}
          aria-invalid={errors.client_wa ? "true" : undefined}
          aria-describedby={errors.client_wa ? "err-wa" : "hint-wa"}
        />
        {errors.client_wa ? (
          <span className="field-error" id="err-wa">
            {errors.client_wa}
          </span>
        ) : (
          <span className="hint" id="hint-wa">
            Format 08… atau +628…
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="notes">Catatan (opsional)</label>
        <textarea
          id="notes"
          name="notes"
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-invalid={errors.notes ? "true" : undefined}
          aria-describedby={errors.notes ? "err-notes" : undefined}
        />
        {errors.notes ? (
          <span className="field-error" id="err-notes">
            {errors.notes}
          </span>
        ) : null}
      </div>

      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? "Memproses…" : `Booking — ${priceLabel}`}
      </button>
      <p className="hint center">Tanpa akun, tanpa pembayaran di muka.</p>
    </form>
  );
}
