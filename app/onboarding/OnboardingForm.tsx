"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Field = "studio_name" | "contact_wa";

type Body = {
  error?: string;
  field?: Field;
  message?: string;
  code?: string | null;
};

/**
 * Studio name + WA, posted to /api/onboarding.
 *
 * Field errors land under the input that caused them, never in a toast: `invalid_studio_name`
 * and `invalid_contact_wa` are the database's verdict (0013), and a floating message leaves
 * the user guessing which of the two boxes to fix. The route returns `field` for exactly
 * that reason — this component does not re-implement the thresholds.
 *
 * Success calls `router.refresh()`: the server component re-reads
 * `my_registration_status()` and renders the "Menunggu persetujuan" card. No manual
 * reload, and the waiting state comes from the database rather than from local state that
 * could disagree with it.
 *
 * `aria-describedby` points the input at its own error line, so a screen reader announces
 * the reason when focus returns to the field.
 */
export function OnboardingForm({
  initialStudioName,
  initialContactWa,
  changing,
  doneHref,
}: {
  initialStudioName: string;
  initialContactWa: string;
  changing: boolean;
  /**
   * Where to go after a successful save. `/onboarding?edit=1` re-renders the form it is
   * already on, which is fine while `pending` (the field values are the feedback) but not
   * while `rejected`: there the user needs to land back on the status card, where the
   * "Ajukan ulang" button is. Omitted → `router.refresh()`, the existing behaviour.
   */
  doneHref?: string;
}) {
  const router = useRouter();
  const [studioName, setStudioName] = useState(initialStudioName);
  const [contactWa, setContactWa] = useState(initialContactWa);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: Field | null; message: string } | null>(
    null,
  );
  const [formError, setFormError] = useState<Body | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setFormError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio_name: studioName, contact_wa: contactWa }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as Body | null;
        if (body?.field) {
          setFieldError({ field: body.field, message: body.message ?? "Isian ini ditolak." });
        } else {
          setFormError(body ?? { message: "Gagal menyimpan data studio." });
        }
        return;
      }

      if (doneHref) router.push(doneHref);
      else router.refresh();
    } catch {
      setFormError({ message: "Tidak bisa menghubungi server. Coba lagi." });
    } finally {
      setBusy(false);
    }
  }

  const nameError = fieldError?.field === "studio_name" ? fieldError.message : null;
  const waError = fieldError?.field === "contact_wa" ? fieldError.message : null;

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="studio_name">Nama studio</label>
        <input
          id="studio_name"
          name="studio_name"
          type="text"
          autoComplete="organization"
          required
          value={studioName}
          onChange={(e) => setStudioName(e.target.value)}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "studio_name-error" : undefined}
        />
        {nameError ? (
          <p className="field-error" id="studio_name-error" role="alert">
            {nameError}
          </p>
        ) : (
          <p className="hint">Nama yang tampil di halaman publik dan di panel admin.</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="contact_wa">Nomor WA</label>
        <input
          id="contact_wa"
          name="contact_wa"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="081234567890"
          value={contactWa}
          onChange={(e) => setContactWa(e.target.value)}
          aria-invalid={waError ? true : undefined}
          aria-describedby={waError ? "contact_wa-error" : undefined}
        />
        {waError ? (
          <p className="field-error" id="contact_wa-error" role="alert">
            {waError}
          </p>
        ) : (
          <p className="hint">Dipakai klien untuk menghubungi kamu. Boleh format +62.</p>
        )}
      </div>

      {formError ? (
        <div className="notice notice--warn" role="alert">
          <p>{formError.message ?? "Gagal menyimpan data studio."}</p>
          {formError.code ? <p className="mono">code: {formError.code}</p> : null}
        </div>
      ) : null}

      <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Menyimpan…" : changing ? "Simpan perubahan" : "Kirim data studio"}
      </button>

      {changing ? (
        <p className="center">
          <Link className="link" href="/onboarding">
            Batal, kembali ke status
          </Link>
        </p>
      ) : null}
    </form>
  );
}
