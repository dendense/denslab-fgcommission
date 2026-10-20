import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell">
      <div className="card stack">
        <p className="eyebrow">404</p>
        <h1>Halaman tidak ditemukan</h1>
        <p className="lede">
          Tautan ini tidak valid atau sudah tidak berlaku. Kalau kamu baru saja booking,
          periksa kembali tautan konfirmasi yang kamu simpan.
        </p>
        <Link className="btn btn--secondary" href="/">
          Ke halaman awal
        </Link>
      </div>
    </main>
  );
}
