# LANDING-LOGIN.md — Spesifikasi halaman landing + login `commission-booking`

> Turunan dari `DESIGN.md` (bagian 6, 7, 8). Dokumen ini untuk agent yang mengerjakan
> tampilan `/login` sebagai halaman landing sederhana. **Baca bagian 0 dulu.**
>
> - Referensi visual (prototipe statis): https://claude.ai/artifact/Rj1kbVxwq9CeJBs5Jy2Hf7
> - Sumber token dan aturan: `DESIGN.md` 7.3–7.6. Kalau ada konflik, `DESIGN.md` bagian 6 menang.

---

## 0. Lingkup dan batas (wajib dibaca)

1. **Ini perubahan presentasional untuk `/login`**, bukan rute baru. `/` tetap
   `redirect("/admin")`. Menjadikan landing sebagai halaman `/` berarti mengubah redirect
   (6.1, "route") dan itu **keputusan Deny**, bukan tugas styling.
2. **Satu-satunya cara masuk: tombol Google** (6.3). Tidak ada email/password, tidak sebagai
   fallback, tidak sebagai tombol nonaktif.
3. `app/login/page.tsx` punya **+11 baris belum ter-commit** (logo). Jangan di-revert, di-stage,
   atau di-commit; koordinasikan dengan Deny sebelum mengubahnya (6.8, 6.10).
4. **`public/app-logo.svg` tidak diubah** (6.8). Pakai lewat `<img>` seperti sekarang, `alt`
   tetap `"denslab commission"`. Catatan: logo bernavy `#1B2A4A` tidak terbaca di latar gelap,
   jadi tema gelap (bagian 5) butuh keputusan Deny soal versi logo. Sampai itu diputuskan,
   **jangan kerjakan tema gelap**.
5. Semua yang tidak ada di sini mengikuti `DESIGN.md` bagian 6: nol logika, nol query, nol
   paket/font baru, nol perubahan teks di 6.4, semua atribut ARIA dipertahankan.
6. Yang boleh dikerjakan: `app/globals.css`, `className` dan markup presentasional (6.10, 6.11).

---

## 1. Struktur halaman

Urutan DOM (juga urutan baca screen reader). Jangan diubah oleh CSS.

```
<main class="shell shell--wide">
  <header class="top">                 logo (app-logo.svg) + link "Daftar"
  <section class="hero">               eyebrow, h1, lede
  <section class="login card">         eyebrow "Masuk", judul, lede, GoogleButton, link daftar
  <section class="preview">            judul, 2 contoh slot, caption
  <section class="steps">              judul, <ol> 3 langkah
  <footer>                             catatan pembayaran + © denslab
</main>
```

Heading: satu `h1` (hero). Kartu login, preview, dan langkah memakai `h2`; judul langkah `h3`.
`GoogleButton` tetap komponen yang ada (client component, prop kosong): **jangan ditulis ulang**,
hanya dibungkus dan diberi kelas.

---

## 2. Teks

| Elemen | Teks | Catatan |
|---|---|---|
| Eyebrow hero | Fotografi event matsuri | baru |
| `h1` | Booking fotografer matsuri, tanpa ribet. | baru |
| Lede hero | Klien memilih jam lewat satu tautan. Fotografer mengelola event, hari, dan slot dari satu panel. | baru |
| Eyebrow kartu | Masuk | **dipertahankan** dari `/login` |
| Judul kartu | Masuk dengan akun Google | **dipertahankan** dari `/login` (jadi `h2`) |
| Lede kartu | Untuk fotografer dan admin. Klien tidak perlu akun. | baru |
| Tombol | Masuk dengan Google | milik `GoogleButton`, jangan diubah |
| Tombol, busy | Mengalihkan ke Google… | milik `GoogleButton`, jangan diubah |
| Link | Belum punya akun? **Daftar di sini** | **dipertahankan**, tujuan `/register` |
| Judul preview | Yang dilihat klien | baru |
| Caption preview | Contoh tampilan slot. Tanpa akun, tanpa pembayaran di muka. | kalimat kedua = 6.4, kata per kata |
| Judul langkah | Cara kerjanya | baru |
| Langkah 1 | **Buat event dan slot** — Fotografer menentukan hari, jam, dan harga tiap slot. | baru |
| Langkah 2 | **Bagikan tautan atau QR** — Event terbit dengan tautan publik dan kode QR siap dipasang. | baru |
| Langkah 3 | **Klien memilih slot** — Konfirmasi langsung tampil, lengkap dengan tombol tambah ke kalender. | baru |
| Footer | Pembayaran dilakukan langsung ke fotografer di lokasi. Tidak ada pembayaran di halaman ini. | **6.4, kata per kata, jangan diubah** |

Teks `code:` / `message:` / `details:` / `hint:` dari `OAuthErrorNotice` dan `GoogleButton`
tetap ditampilkan mentah di kartu login, di bawah tombol, tidak disembunyikan atau dipotong.
Contoh slot di preview adalah **ilustrasi statis**, bukan data: beri `aria-disabled` pada slot
terisi dan jangan jadikan tautan.

---

## 3. State kartu login

| State | Tampilan | Atribut yang harus ada |
|---|---|---|
| idle | tombol `btn--secondary` penuh | — |
| busy | tombol `disabled`, teks "Mengalihkan ke Google…", penanda putar CSS murni (`::after`) | `aria-busy="true"` |
| error A (OAuth ditolak) | `.notice--warn` di bawah tombol | dalam `<div aria-live="polite">` dari `GoogleButton` |
| error B (query `error_code`) | `OAuthErrorNotice` mencetak `error_code` + `error_description` | `role="alert"` sesuai kode saat ini |

Penanda putar tidak mengubah teks tombol. Matikan lewat `prefers-reduced-motion`.

---

## 4. Token

Pakai token `DESIGN.md` 7.3 apa adanya. Kalau Fase 0–2 di 7.8 belum dikerjakan, nilai lama
boleh dipakai dulu; struktur halaman ini tidak bergantung pada nilai.

| Kebutuhan | Token |
|---|---|
| Latar halaman | `--bg` |
| Kartu | `--surface`, border `--line`, radius `--radius` (12px), `--shadow-2` |
| Kontrol dan baris | radius `--radius-sm` (8px), border kontrol `--line-strong` |
| Jam slot / judul | `--fs-title` (19px), bobot 600, `tabular-nums` |
| Teks utama / sekunder | `--fs-body` 16px, `--fs-ui` 15px, `--fs-caption` 13px |
| `h1` | `--fs-display`, bobot 600, `letter-spacing: -0.01em`, `text-wrap: balance` |
| Jarak | skala `--space-*`: rapat 8–12px, antar-seksi 24–48px |
| Lebar | `--max-wide` 1040px, `padding-inline: var(--gutter)` |

Hanya **satu aksen** (`--accent`): untuk batang dan status slot terbuka, link, dan nomor
langkah. Tombol Google tetap `btn--secondary` (netral), sama seperti `/login` sekarang.

---

## 5. Responsif (mobile-first, hanya `min-width`)

| Lebar | Tata letak |
|---|---|
| <520px | satu kolom: hero → login → preview → langkah. Slot 1 kolom. Langkah bertumpuk, dipisah garis tipis |
| 520–767px | slot 2 kolom |
| ≥768px | padding atas `--space-7`; kartu login `padding: --space-6`; langkah 3 kolom |
| ≥960px | dua kolom: hero + preview di kiri, kartu login di kanan (`position: sticky`); langkah selebar penuh di bawah |

```css
.page{display:grid;gap:var(--space-6);
  grid-template-areas:"hero" "login" "preview" "steps"}
@media (min-width:960px){
  .page{grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr);
    grid-template-areas:"hero login" "preview login" "steps steps";align-items:start}
  .login{position:sticky;top:var(--space-5)}}
```

- Penataan memakai `grid-template-areas`, **bukan** mengubah urutan DOM.
- `overflow-x: hidden` pada `html, body` **tetap** (6.7). Tambahkan `min-width: 0` pada anak grid
  dan `overflow-wrap: anywhere` pada teks yang bisa panjang.
- Target sentuh ≥44px di semua lebar: `.link` dibuat `inline-flex; min-height: 44px`
  (sekaligus memperbaiki temuan 1 di 7.7).
- Tinggi layar penuh memakai `100dvh`; `env(safe-area-inset-*)` tetap dipertahankan.
- Uji di 360, 390, 520, 768, 1024, 1440px.

---

## 6. Kartu slot "karcis" (hanya CSS)

| Elemen | Slot terbuka | Slot terisi |
|---|---|---|
| Latar | `--surface` | `--surface-sunken` |
| Border | `--accent` + batang kiri `box-shadow: inset 4px 0 0 var(--accent)` | `--line-strong` |
| Jam | bobot 600 | bobot 500, `--muted` |
| Harga | rata kanan, garis putus-putus di kirinya (`border-left: 1px dashed var(--line-strong)`) | sama |
| Status | "Tersedia", `--accent`, 600 | badge "Terisi" (`.slot__badge`, `--chip`) |

Pembeda slot terbuka vs terisi ada **empat**: batang, bobot, fill, warna (bukan hanya border,
temuan 8 di 7.7), jadi tetap terbaca di greyscale. Tidak ada hover/angkat karena ini ilustrasi.

---

## 7. Aksesibilitas

- Tiap `section` diberi `aria-labelledby` ke judulnya. Landmark: `header`, `main`, `footer`.
- `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` tidak dihapus.
- `aria-live="polite"` di bawah tombol Google dan `aria-busy` pada tombol dipertahankan.
- Slot terisi: `aria-disabled="true"`. Logo: `alt="denslab commission"`.
- Semua jumlah atribut ARIA di 6.5 harus sama setelah perubahan (atau naik, tidak turun).
- Gerak: transisi hanya warna, border, bayangan, dan `transform` kecil, dengan
  `@media (prefers-reduced-motion: reduce)` yang mematikannya.

---

## 8. Definisi selesai

1. Teks di 6.4 tidak berubah; teks "dipertahankan" di bagian 2 persis sama dengan sekarang.
2. Satu-satunya kontrol masuk adalah tombol Google; tidak ada email/password dalam bentuk apa pun.
3. `scrollWidth == innerWidth` di 360, 390, 520, 768, 1024, 1440px, dan string panjang tanpa
   spasi **membungkus**, bukan terpotong.
4. Kontras: teks ≥4.5:1, batas kontrol ≥3:1; hitung ulang bila ada warna yang diganti (6.6).
5. Semua kontrol ≥44×44px, termasuk dua `.link` di halaman ini.
6. Dengan `prefers-reduced-motion: reduce`, tidak ada animasi yang berjalan.
7. Tidak ada gradien, efek kaca, emoji/ikon dekoratif, atau hue baru (7.2).
8. Tidak ada perubahan di `supabase/**`, `app/api/**`, `lib/**`, `proxy.ts`, `next.config.ts`,
   `package.json`, `package-lock.json`, dan `public/app-logo.svg`.
9. `next build` bersih, 24 route, urutan Tab tidak berubah.
