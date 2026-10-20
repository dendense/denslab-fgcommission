export function ServerNotReady() {
  return (
    <div className="card stack">
      <h1>Server belum siap</h1>
      <p className="lede">
        Kredensial Supabase belum diisi di server ini, jadi jadwal belum bisa dimuat.
        Data tidak hilang — hubungi fotografer kalau kamu butuh konfirmasi.
      </p>
    </div>
  );
}
