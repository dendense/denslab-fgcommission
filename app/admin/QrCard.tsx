"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/**
 * QR renders client-side so the encoded URL is whatever origin the page is served
 * from — localhost during the demo, the real domain after deploy. No server round
 * trip, and the image is a plain PNG the photographer can screenshot for a story.
 */
export function QrCard({ slug }: { slug: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const target = `${window.location.origin}/e/${slug}`;
    setUrl(target);
    QRCode.toDataURL(target, { width: 512, margin: 2, errorCorrectionLevel: "M" })
      .then(setSrc)
      .catch(() => setError(true));
  }, [slug]);

  return (
    <section className="card qr">
      <h2>QR halaman publik</h2>
      <p className="lede center">
        Tempel di story atau cetak. Klien memindai, langsung masuk ke daftar slot.
      </p>
      {error ? (
        <p className="notice notice--warn">Gagal membuat QR. Muat ulang halaman.</p>
      ) : src ? (
        /* eslint-disable-next-line @next/next/no-img-element -- data URL, next/image adds nothing */
        <img src={src} alt={`QR code menuju ${url}`} width={240} height={240} />
      ) : (
        <p className="lede">Membuat QR…</p>
      )}
      <p className="mono center">{url}</p>
    </section>
  );
}
