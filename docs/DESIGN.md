# DESIGN.md — Sistem visual & inventaris UI `commission-booking`

> **Dokumen ini untuk agent yang bertugas memperindah tampilan.**
> Isinya: apa yang ada sekarang (terukur, bukan klaim), apa yang tidak konsisten, dan apa
> yang **tidak boleh** disentuh. Baca bagian 6 dulu sebelum mengubah apa pun.
>
> - Repo: `/Users/dendense/Documents/AI/commission-booking`
> - HEAD saat dokumen ditulis: **`ac624a7`**
> - Sumber kebenaran visual: **`app/globals.css`** (653 baris). Tidak ada file CSS lain.
> - Tidak ada framework CSS, tidak ada CSS-in-JS, tidak ada utility library. Kelas
>   global biasa + beberapa `style={{}}` inline.
> - Font: Geist Sans + Geist Mono lewat `next/font/google` (`app/layout.tsx`), diekspos
>   sebagai `--font-geist-sans` / `--font-geist-mono`.

---

## 1. Inventaris halaman

Aplikasi ini panel booking jasa fotografi event matsuri. Tiga peran:

| Peran | Cara masuk | Bisa apa |
|---|---|---|
| **publik** | tanpa akun, lewat link `/e/[slug]` | lihat slot, isi form booking, dapat halaman konfirmasi |
| **fotografer** | Google, sudah disetujui admin | kelola event/hari/slot miliknya sendiri |
| **admin** | Google, ada baris di `admin_users` | setujui pendaftar, lihat statistik semua studio, buat event atas nama fotografer lain |

Login **hanya lewat Google**. Tidak ada form email/password di mana pun.

### 1.1 Route UI

Dibaca dari `app/` dan diverifikasi terhadap output `next build` (24 entri route,
12 di antaranya halaman ber-UI — 11 route aplikasi + `_not-found`).

| # | Path | Berkas | Peran yang boleh masuk | Yang ditampilkan | State |
|---|---|---|---|---|---|
| 1 | `/` | `app/page.tsx` | siapa pun | tidak ada UI — `redirect("/admin")` langsung | — (307) |
| 2 | `/login` | `app/login/page.tsx` | publik (belum login) | logo `app-logo.svg`, eyebrow "Masuk", h1 "Masuk dengan akun Google", tombol Google, link ke `/register` | sukses: tombol idle · **loading**: tombol `disabled` + `aria-busy`, teks "Mengalihkan ke Google…" · **error channel A**: kotak `.notice--warn` di dalam `aria-live="polite"` dari `GoogleButton` (`signInWithOAuth` ditolak) · **error channel B**: `OAuthErrorNotice` mencetak `error_code` + `error_description` dari query string (GoTrue menolak redirect URL). Tidak ada state kosong. |
| 3 | `/register` | `app/register/page.tsx` | publik; kalau sudah login → redirect | 3 tampilan berbeda: (a) `Signup` — h1 + tombol Google + link ke `/login`; (b) `NoRegistration` — kartu "Akun ini belum punya pendaftaran." + tombol "Daftar sekarang"; (c) `Pending` — kartu "Akunmu belum disetujui admin." | kosong/sukses = (a) · error query `?error=no_registration` = (b) · sudah daftar tapi belum disetujui = (c) · redirect ke `/admin` kalau punya studio atau admin · `ServerNotReady` kalau env Supabase kosong · `DbNotReady` kalau migrasi belum ada |
| 4 | `/onboarding` | `app/onboarding/page.tsx` | session Google, **belum** punya studio | 4 tampilan: (a) form `OnboardingForm` (nama studio + nomor WA); (b) kartu "Data studio sudah dikirim." (menunggu persetujuan) + ringkasan + tombol "Ubah data studio"; (c) kartu "Akun ini tidak punya pendaftaran."; (d) kartu "Akses studio belum diberikan." (ditolak) | form = belum lengkap atau `?edit=1` · menunggu = sudah lengkap · error per-field di bawah input (`role="alert"`, `aria-invalid`, `aria-describedby`) · error form di `.notice--warn` · loading tombol "Menyimpan…" + `aria-busy` · tidak ada session → redirect `/login` · `approved` → redirect `/admin` |
| 5 | `/auth/callback` | `app/auth/callback/route.ts` | — (route handler, tanpa UI) | tidak merender apa pun; menukar `?code` jadi session lalu redirect | 5 cabang: punya studio → `/admin` · admin tanpa studio → `/admin` · registrasi belum lengkap → `/onboarding` · registrasi lengkap tapi pending → `/onboarding` · tidak ada registrasi → `/register?error=no_registration` · provider error → `/login?error_code=…` · `code` hilang/expired → `/login` |
| 6 | `/admin` | `app/admin/page.tsx` | fotografer **atau** admin | header (eyebrow "Admin"/"Fotografer", h1 nama studio, email mono), seksi "Pendaftar menunggu persetujuan" (admin saja), seksi "Event", tombol Keluar | **kosong**: `.notice--ok` "Belum ada event…" + tombol "Buat event" · **ada isi**: daftar `.event-row` + tombol "Buat event" (`btn--secondary`) · **error daftar event**: `.notice--warn` `role="alert"` · **error baca akun**: kartu "Gagal memuat akun" · **pending**: kartu "Akunmu belum disetujui admin." · **admin tanpa studio**: panel khusus + `.notice` penjelasan · loading: tidak ada skeleton (server component, `instant = false`) |
| 7 | `/admin/events/new` | `app/admin/events/new/page.tsx` | fotografer (punya studio) · admin (lewat `?for=<uuid>`) | 3 tampilan: (a) `OwnEventForm` — topbar "← Kembali ke daftar event", h1 "Buat event", form judul/lokasi/hari pertama; (b) `ForPhotographer` — kartu "Membuat event untuk {nama}", `.notice` penjelasan, form tanpa fieldset hari; (c) `AdminWithoutStudio` — `.notice` + 2 tombol | error validasi klien di `.notice--warn` `role="alert"` ("Judul tidak boleh kosong.", "Jam selesai harus setelah jam mulai.") · **orphan state**: event tersimpan tapi hari gagal → `.notice--warn` + `.lede` + tombol "Buka halaman kelola event" · loading tombol "Menyimpan…" · fotografer tidak ditemukan → `.notice--warn` "Fotografer itu tidak ditemukan." · tidak ada studio & bukan admin → redirect `/admin` |
| 8 | `/admin/events/[id]` | `app/admin/events/[id]/page.tsx` | fotografer pemilik event | topbar "← Semua event", header judul + lokasi, lalu `EventEditor`: kartu Status, seksi Hari, `QrCard` (kalau terbit) | **draf**: tombol "Terbitkan event" + `.notice--warn` "Event belum terbit" · **terbit**: tombol "Tarik event" → panel `.confirm` ("Tarik event ini?") · **terbit ganda**: `.notice--warn stack` `role="status"` menjelaskan hanya satu event yang tampil · **belum ada hari**: `.notice--warn` · **hari kosong**: `.slot-row__note` "Belum ada slot di hari ini." · error per-aksi di `.slot-row__error` `role="alert"` · busy per-tombol ("Menyimpan…", "Menghapus…", "Menarik…", "Menerbitkan…") · event asing/tidak ada → `notFound()` |
| 9 | `/users` | `app/users/page.tsx` | **admin saja**; non-admin → redirect `/admin` | h1 "Users", `.lede` penjelasan, `UsersList`: field pencarian + `role="status"` `aria-live="polite"` jumlah hasil + daftar `PhotographerCard` | **loading**: teks "Mencari…" (debounce 300 ms) · **kosong**: kartu "Tidak ada hasil" (dengan dua teks berbeda: query ada vs belum ada fotografer sama sekali) · **error**: `.notice--warn` `role="alert"` · **sukses**: kartu per fotografer berisi `<dl class="summary">` 7 baris + paragraf definisi + tombol "Buat event" · tidak ada session → `/login` |
| 10 | `/e/[slug]` | `app/e/[slug]/page.tsx` | publik, tanpa akun | `.notice--warn` kalau `?taken=1`, header `.card` (judul event, lokasi, fotografer, "Slot tersedia: N dari M"), per hari `<h2 class="day-heading">` + `.slots`, footer `.lede` 14px | **slot terbuka**: `<a class="slot slot--open">` (border aksen, hover `--accent-soft`) · **slot terisi/ditutup**: `<div class="slot slot--taken" aria-disabled="true">` + `.slot__badge` · **baru saja diambil**: `.notice--warn` `role="status"` · slug tidak ada → `notFound()` (404 nyata dari `proxy.ts`) · env kosong → `ServerNotReady` |
| 11 | `/e/[slug]/book/[slotId]` | `app/e/[slug]/book/[slotId]/page.tsx` | publik, tanpa akun | topbar "← Pilih slot lain", header `.card` (jam sebagai h1, tanggal, lokasi, harga), `BookingForm` (Nama, Nomor WhatsApp, Catatan opsional, tombol "Booking — Rp75.000") | **error per-field**: `.field-error` + `aria-invalid` + `aria-describedby` · **error form**: `.notice--warn` `role="alert"` · **409** (slot diambil orang lain): pesan + `router.replace('/e/[slug]?taken=1')` · **loading**: tombol "Memproses…" `disabled` · slot tidak ada / sudah tidak `open`: `.notice--warn` `role="status"` + tombol "Lihat slot lain" · sukses: `router.push(confirmation_url)` |
| 12 | `/booking/[icsToken]` | `app/booking/[icsToken]/page.tsx` | publik, pemegang token | `.check` (lingkaran ✓ 56px, `aria-hidden`), h1 "Booking tercatat", `.card` berisi `<dl class="summary">`, `.btn-row` 3 tombol (Google Calendar / Unduh .ics / Hubungi fotografer), `.notice--warn` soal pembayaran, tombol "Lihat jadwal lain" | **sukses** = tampilan di atas · token tidak dikenal/format salah → `notFound()` (404 nyata dari `proxy.ts`) · env kosong → kartu "Server belum siap" (sengaja bukan 404, supaya booking tidak terlihat hilang) |
| 13 | `/_not-found` | `app/not-found.tsx` | siapa pun | `.card` berisi eyebrow "404", h1 "Halaman tidak ditemukan", `.lede`, tombol "Ke halaman awal" | satu-satunya state. Dipakai untuk semua 404, termasuk rewrite dari `proxy.ts` |

**Catatan penamaan:** di kartu tugas path ini ditulis `/booking/[token]`; nama parameter
sebenarnya di repo adalah **`icsToken`** (`app/booking/[icsToken]/page.tsx`). URL-nya tetap
`/booking/<uuid>`.

### 1.2 Route API (tanpa UI — jangan disentuh)

`app/api/**` berisi **21** route handler: `admin/access-requests`, `admin/days/[dayId]`,
`admin/event-days`, `admin/event-days/[dayId]`, `admin/event-status/[eventId]`,
`admin/events`, `admin/events/[id]`, `admin/events/[id]/days`, `admin/events/[id]/publish`,
`admin/events/[id]/unpublish`, `admin/events/by-slug/[slug]`, `admin/slots`,
`admin/slots/[slotId]`, `admin/users`, `admin/users/events`, `auth/logout`, `bookings`,
`bookings/[ics_token]`, `bookings/[ics_token]/calendar.ics`, `events/[slug]`, `onboarding`.
Tidak satu pun punya tampilan.

### 1.3 Layout yang membungkus route

| Berkas | Cakupan | Isi |
|---|---|---|
| `app/layout.tsx` | semua | `<html lang="id">`, dua variabel font Geist, `themeColor: "#b33a12"`, `<body>` tanpa kelas |
| `app/admin/layout.tsx` | semua `/admin/**` | `.admin-nav-wrap` > `.admin-nav-inner` > `AdminNavBar`, lalu `{children}` |
| `app/users/layout.tsx` | `/users` | sama persis (duplikat sengaja — `/users` bukan anak `/admin`) |

`proxy.ts` (Next 16 middleware) hanya melakukan dua hal: memberi 404 nyata untuk
`/e/:slug*` dan `/booking/:token*`, dan menyegarkan cookie sesi untuk `/admin/:path*`
+ `/api/admin/:path*`.

---

## 2. Inventaris komponen

Semua komponen adalah React function component. **Tidak ada** file `components/ui/`,
tidak ada CVA, tidak ada `variants` berbasis library — varian di sini berarti kelas
pengubah yang ditulis manual di `className`.

### 2.1 `app/_components/**` — dipakai lintas halaman

| Komponen | Path | Kelas CSS | Varian / prop |
|---|---|---|---|
| `GoogleButton` | `app/_components/GoogleButton.tsx` | `.stack` (pembungkus), `.btn.btn--secondary`, `.notice.notice--warn`, `.mono` | client component. Prop: tidak ada. State: `busy` (→ `disabled` + `aria-busy` + teks "Mengalihkan ke Google…"), `error` (→ `.notice--warn` di dalam `<div aria-live="polite">`) |
| `AdminNavBar` | `app/_components/AdminNavBar.tsx` | — (hanya merender `AdminNav`) | async server component. Memanggil `is_admin()`; gagal → `showUsers = false` |
| `AdminNav` | `app/_components/AdminNav.tsx` | `.admin-nav` (`<nav aria-label="Navigasi admin">`), `.admin-nav__tab` | Prop `showUsers: boolean` → tab "Users" muncul/hilang. Varian aktif lewat `aria-current="page"` (CSS mengecek atribut itu, bukan kelas) |
| `ServerNotReady` | `app/_components/ServerNotReady.tsx` | `.card.stack`, `.lede` | statis, tanpa prop. Dipakai saat kredensial Supabase kosong |
| `DbNotReady` | `app/_components/DbNotReady.tsx` | `.card.stack`, `.eyebrow`, `.lede`, `.meta`, `.mono` | Prop `error: DbError \| DbNotMigratedError`, `children?: ReactNode` (slot aksi). Mencetak `code`, `message`, `details`, `hint` apa adanya |

### 2.2 `app/admin/**` — komponen admin

| Komponen | Path | Kelas CSS | Varian / prop |
|---|---|---|---|
| `AccessRequests` | `app/admin/AccessRequests.tsx` | `.slots`, `.slot-row`, `.slot__time`, `.slot__status`, `.mono`, `.badge.badge--draft`, `.btn-row.btn-row--inline`, `.btn.btn--primary`, `.btn.btn--secondary`, `.slot-row__error`, `.notice.notice--ok` | Prop `initial: AccessRequest[]`. **Varian kosong**: `.notice--ok` "Tidak ada pendaftar yang menunggu. Semua beres." **Varian baris**: badge "belum isi data studio" muncul kalau `studio_name`/`contact_wa` kosong. State per baris: `busy` ("Memproses…" + `disabled` + `aria-busy`), `error` (`role="alert"`) |
| `LogoutButton` | `app/admin/LogoutButton.tsx` | `.btn.btn--secondary` | tanpa prop. State `busy` → "Keluar…" |
| `QrCard` | `app/admin/QrCard.tsx` | `.card.qr`, `.lede.center`, `.notice.notice--warn`, `.mono.center`, `.qr img` | Prop `slug: string`. 3 state: `error` (`.notice--warn` "Gagal membuat QR."), `src` (gambar QR 240×240), belum siap (`.lede` "Membuat QR…") |
| `EventEditor` | `app/admin/events/[id]/EventEditor.tsx` | `.stack`, `.card.stack`, `.day-block__head`, `.badge.badge--published`/`--draft`, `.lede`, `.notice.notice--warn`, `.confirm`, `.btn-row`, `.btn-row--inline`, `.btn.btn--primary`/`--secondary`/`--danger`, `.day-block`, `.day-block__title`, `.event-row__meta`, `.slots`, `.slot-row`, `.slot__time`, `.slot__status`, `.slot-row__note`, `.slot-row__error` | Prop `event: AdminEvent`, `studioSlug: string`, `publishedEvents: PublishedRef[]`. Sub-komponen internal (tidak diekspor): `DayBlock`, `SlotRow`, `AddDayForm`, `AddSlotForm` |
| `NewEventForm` | `app/admin/events/new/NewEventForm.tsx` | `.stack`, `.field`, `.hint`, `.notice.notice--warn`, `.btn.btn--primary`/`--secondary`, `.lede` | Prop `photographerId?: string`. **Dua varian perilaku tampilan**: tanpa prop → fieldset "Hari pertama" tampil; dengan prop (`?for=`) → fieldset disembunyikan. State: `failure` (`.notice--warn` `role="alert"`), `orphan` (blok pesan + 2 tombol), `busy` |
| `_api.ts` | `app/admin/_api.ts` | — (bukan komponen) | helper `postJson<T>()`, tipe `ApiFailure` |

### 2.3 `app/users/**`

| Komponen | Path | Kelas CSS | Varian / prop |
|---|---|---|---|
| `UsersList` | `app/users/UsersList.tsx` | `.stack`, `.field`, `.hint`, `.lede`, `.notice.notice--warn`, `.card.stack`, `.slots` | Prop `initial: { stats, search }`. State: `busy` ("Mencari…"), `error`, hasil kosong (kartu "Tidak ada hasil" — dua teks berbeda), hasil ada (`.slots` > `PhotographerCard`) |
| `PhotographerCard` (internal) | `app/users/UsersList.tsx:140` | `.card.stack`, `.day-block__head`, `.badge.badge--draft.mono`, `.summary`, `.mono`, `.lede`, `.hint`, `.btn.btn--secondary` | tidak diekspor. 7 baris `<dl class="summary">`: Email, Kontak WA, Event, Event selesai, Slot, Booking, Nilai booking terisi |
| `stats.ts` | `app/users/stats.ts` | — | tipe `PhotographerStat` + `readStats()` |

### 2.4 `app/onboarding/**`

| Komponen | Path | Kelas CSS | Varian / prop |
|---|---|---|---|
| `OnboardingForm` | `app/onboarding/OnboardingForm.tsx` | `.card.stack`, `.field`, `.hint`, `.field-error`, `.notice.notice--warn`, `.mono`, `.btn.btn--primary`, `.center`, `.link` | Prop `initialStudioName: string`, `initialContactWa: string`, `changing: boolean`. `changing` mengubah label tombol ("Simpan perubahan" vs "Kirim data studio") dan menampilkan link "Batal, kembali ke status". Error per-field di bawah input masing-masing |

### 2.5 Komponen yang **tidak** ada (jangan diciptakan tanpa alasan)

Tidak ada `Button`, `Input`, `Card`, `Badge`, `Modal`, `Toast`, `Spinner`, `Skeleton`,
`Tabs`, atau `Tooltip` sebagai komponen React. Semuanya kelas CSS di atas elemen HTML
mentah. **Spinner dan skeleton tidak ada sama sekali** — loading selalu berupa teks di
dalam tombol (`"Menyimpan…"`, `"Mencari…"`, `"Memproses…"`, `"Mengalihkan ke Google…"`).

---

## 3. Sistem visual yang ada sekarang

Dicatat **apa adanya** dari `app/globals.css`. Semua kutipan di bawah adalah teks persis
dari file itu, dengan nomor barisnya.

### 3.1 Token (`:root`, baris 1–18) — dikutip utuh

```css
/* Design tokens — one accent (vermilion) + warm neutrals. No gradients. */
:root {
  --bg: #f7f5f2;
  --surface: #ffffff;
  --ink: #1a1a1a;
  --muted: #5c5650;
  --line: #e5e0d8;
  --accent: #b33a12;
  --accent-ink: #ffffff;
  --accent-soft: #fbeee8;
  --ok: #1f6b3a;
  --ok-soft: #e8f3ec;
  --warn-soft: #fdf1e3;
  --warn-ink: #8a4b06;
  --radius: 10px;
  --radius-sm: 6px;
  --max: 480px;
}
```

Itu **seluruh** token yang ada: 15 token — **12 warna**, 2 radius, 1 lebar maksimum.

**Yang tidak ada sebagai token** (semua nilai ini ditulis langsung di dalam aturan kelas):

- **spacing** — tidak ada `--space-*`; nilai padding/gap ditulis per kelas
- **shadow** — tidak ada `box-shadow` di seluruh file (0 kemunculan). Kedalaman dibuat
  lewat `border` + perbedaan `--surface` vs `--bg`
- **skala tipografi** — tidak ada `--text-*`; ukuran ditulis per kelas
- **durasi/easing transisi** — tidak ada `transition` di seluruh file (0 kemunculan).
  Satu-satunya perubahan halus adalah `:hover` yang berganti warna seketika
- **breakpoint** — tidak ada variabel; dua media query hardcoded: `min-width: 520px`
  (baris 599) dan `max-width: 520px` (baris 452)
- **z-index** — hanya satu nilai literal: `z-index: 10` pada `.admin-nav-wrap`

### 3.2 Warna di luar `:root` (hardcoded, tidak bisa di-tema)

12 hex unik dipakai langsung di dalam aturan kelas (bukan lewat token). Ini yang membuat
"ganti satu token" tidak cukup untuk mengubah tema:

| Hex | Dipakai di | Baris |
|---|---|---|
| `#f2efeb` | `.slot--taken` bg, `.btn--secondary:hover` bg, `.btn--secondary:disabled` bg, `.btn--danger:disabled` bg (4×) | 175, 321, 329, 570 |
| `#8a8178` | border `.slot--taken`, border `.field input/textarea`, border `.btn--secondary` (3×) | 176, 261, 317 |
| `#e7e2db` | bg `.slot--taken .slot__badge`, bg `.badge--draft`, dan disebut lagi di komentar baris 524 (3×) | 218, 523, 524 |
| `#efd7b8` | border `.notice--warn`, border `.slot-row__error`, border `.confirm` (3×) | 367, 478, 580 |
| `#4a443e` | teks `.btn--primary:disabled`, teks `.badge--draft` (2×) | 310, 524 |
| `#b9aca4` | border `.btn--secondary:disabled`, `.btn--danger:disabled` (2×) | 328, 569 |
| `#d9d3cb` | bg `.btn--primary:disabled` | 309 |
| `#96300e` | bg `.btn--primary:hover` | 303 |
| `#8f2c0b` | teks `.btn--danger` | 557 |
| `#c98d78` | border `.btn--danger` | 558 |
| `#cfe4d6` | border `.notice--ok` | 373 |

`#e8f3ec` hanya muncul sebagai nilai `--ok-soft` (baris 12) dan sekali lagi di dalam
komentar baris 529 — **tidak** dipakai sebagai nilai literal di aturan mana pun.

### 3.3 Tipografi

```css
body {
  font-family: var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

```css
.mono {
  font-family: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  overflow-wrap: anywhere;
}
```

Skala ukuran yang benar-benar dipakai (dihitung dari file, 31 kemunculan `font-size`):

| px | Kemunculan | Dipakai untuk |
|---|---|---|
| 13 | 7 | `.eyebrow`, `.hint` (dalam `.field`), `.mono`, `.slot__status`, `.slot__badge`, `.badge`, `.slot-row__note`, `.slot-row__error` |
| 14 | 4 | `.topbar`, `.field-error`, `.day-heading`, `.event-row__meta` |
| 15 | 10 | `.lede`, `.meta`, `.field label`, `.summary`, `.notice`, `.btn-row--inline .btn`, `.admin-nav__tab`, `.confirm` |
| 16 | 4 | `body`, `.btn`, `.field input/textarea` (iOS: cegah zoom), `.day-block__title` |
| 17 | 2 | `.slot__time`, `.event-row__title` |
| 18 | 2 | `h2`, `fieldset legend`/`.field-label` |
| 24 | 1 | `h1` |
| 28 | 1 | `.check` (tanda ✓) |

Bobot font: `500` (1×), `600` (16×), `650` (1× — hanya `h1`), `700` (1× — hanya `.check`).
Tidak ada `300`/`400` eksplisit; `400` adalah default `body`.

Heading global:

```css
h1 { font-size: 24px; line-height: 1.25; font-weight: 650; letter-spacing: -0.01em; }
h2 { font-size: 18px; line-height: 1.3; font-weight: 600; }
```

`.eyebrow` = 13px, `letter-spacing: 0.06em`, `text-transform: uppercase`, `--muted`.

### 3.4 Spacing

Tidak ada skala. Nilai yang muncul (dihitung dari file):

- `gap`: `2px` (1×), `4px` (2×), `6px` (3×), `8px` (2×), `10px` (7×), `12px` (1×)
- `padding`: `2px 8px` (2×), `8px 10px`, `8px 12px`, `8px 14px`, `12px` , `12px 14px` (4×),
  `12px 16px`, `14px` (2×), `16px`, `0 14px`, `0 16px`,
  `20px 16px calc(32px + env(safe-area-inset-bottom))`
- `.stack > * + * { margin-top: 12px; }` — ini satu-satunya ritme vertikal yang konsisten
- `.slots { display: grid; gap: 10px; }` — jarak antar kartu daftar
- `.meta { display: grid; gap: 6px; }`
- `.summary { display: grid; gap: 10px; }`, tiap baris `padding-bottom: 10px`

### 3.5 Radius, border, shadow

- `--radius: 10px` — **hanya** dipakai `.card`
- `--radius-sm: 6px` — `.slot`, `.slot-row`, `.event-row`, `.day-block`, `.notice`,
  `.confirm`, `.btn`, `.field input/textarea`, `.qr img`, `.slot-row__error`
- `999px` — `.badge`, `.slot__badge`, `.check`
- `0` — `.shell`, `.topbar`, `.summary`, `.admin-nav__tab`
- Border standar: `1px solid var(--line)` untuk wadah; `1px solid #8a8178` untuk batas
  kontrol (input, `.btn--secondary`, `.slot--taken`)
- **Shadow: tidak ada sama sekali.**

### 3.6 Kelas utilitas & komponen (daftar lengkap, 52 kelas)

**Layout**
| Kelas | Definisi ringkas |
|---|---|
| `.shell` | `width:100%; max-width:var(--max)` (480px); `margin:0 auto`; `padding:20px 16px calc(32px + env(safe-area-inset-bottom))`. Di `min-width:520px` → `padding-top:40px` |
| `.stack` | anak langsung berurutan diberi `margin-top:12px` |
| `.topbar` | flex, `gap:10px`, `min-height:44px`, 14px, `--muted`; `.topbar a` → inline-flex `min-height:44px`, `--accent`, weight 500 |
| `.center` | `text-align:center` |
| `.admin-nav-wrap` | `position:sticky; top:0; z-index:10`; bg `--bg`; border-bottom `--line` |
| `.admin-nav-inner` | ulangi `--max` + `padding:0 16px` (karena bar di luar `.shell`) |
| `.admin-nav` | flex, `gap:4px` |
| `.admin-nav__tab` | inline-flex, `min-height:44px`, `padding:0 14px`, 15px/600, `--muted`, border-bottom 2px transparan |
| `.admin-nav__tab:hover` | `--ink` |
| `.admin-nav__tab[aria-current="page"]` | `--accent` + border-bottom `--accent` |

**Wadah**
| Kelas | Definisi ringkas |
|---|---|
| `.card` | bg `--surface`, border `1px --line`, radius `--radius` (10px), `padding:16px` |
| `.event-row` | grid, `gap:4px`, `padding:14px`, radius 6px, `min-height:64px`; hover → bg `--accent-soft` + border `--accent` |
| `.day-block` | grid, `gap:10px`, `padding:14px`, radius 6px |
| `.day-block__head` | flex wrap, `justify-content:space-between`, `align-items:baseline`, `gap:6px` |
| `.day-block__title` | 16px/600 |
| `.slot-row` | grid `1fr auto`, `gap:8px 12px`, `padding:12px 14px`, radius 6px |
| `.slot-row .btn` | `width:auto`, `min-height:44px`, `padding:8px 12px`, 15px |
| `.slot-row__note` | `grid-column:1/-1`, 13px, line-height 1.4, `--muted` |
| `.slot-row__error` | `grid-column:1/-1`, 13px, `--warn-ink` on `--warn-soft`, border `#efd7b8`, `padding:8px 10px` |
| `.qr` | grid, `justify-items:center`, `gap:10px`; `.qr img` → `max-width:240px`, border, radius 6px |
| `.check` | 56×56, `border-radius:999px`, bg `--ok-soft`, warna `--ok`, 28px/700, `margin:8px auto 0` |

**Slot (halaman publik)**
| Kelas | Definisi ringkas |
|---|---|
| `.slots` | grid, `gap:10px` |
| `.slot` | grid `1fr auto`, `min-height:64px`, `padding:12px 14px`, radius 6px, bg `--surface`, border `1px --line` |
| `.slot--open` | border `--accent`, `cursor:pointer`; hover → bg `--accent-soft` |
| `.slot--taken` | bg `#f2efeb`, border `#8a8178`, warna `--muted`, `cursor:not-allowed` |
| `.slot__time` | 17px/600, `tabular-nums` |
| `.slot__price` | 15px/600, `tabular-nums`, rata kanan |
| `.slot__status` | `grid-column:1/-1`, 13px, `--muted`; dalam `.slot--open` → `--accent`/600 |
| `.slot__badge` | pil (`999px`), `padding:2px 8px`, 13px/600, bg `--ok-soft`, warna `--ok`; varian `.slot--taken` → bg `#e7e2db`, warna `--muted` |

**Form**
| Kelas | Definisi ringkas |
|---|---|
| `.field` | grid, `gap:6px`; `.field label` → 15px/600 |
| `fieldset legend`, `.field-label` | 18px/600, `line-height:1.3`, `margin-bottom:6px` |
| `.field .hint` | 13px, `--muted` — **hanya berlaku di dalam `.field`** |
| `.field input`, `.field textarea` | `min-height:48px`, `padding:12px`, **`font-size:16px`** (cegah zoom iOS), border `1px #8a8178`, radius 6px |
| `.field textarea` | `min-height:96px`, `resize:vertical` |
| `.field input[aria-invalid="true"]` | border `--accent` |
| `.field-error` | 14px, `--accent` |
| `.btn` | inline-flex, `width:100%`, `min-height:48px`, `padding:12px 16px`, 16px/600, radius 6px, border transparan |
| `.btn--primary` | bg `--accent`, teks `--accent-ink`; hover bg `#96300e`; disabled bg `#d9d3cb` teks `#4a443e` |
| `.btn--secondary` | bg `--surface`, teks `--ink`, border `#8a8178`; hover bg `#f2efeb`; disabled teks `--muted`, border `#b9aca4`, bg `#f2efeb` |
| `.btn--danger` | bg `--surface`, teks `#8f2c0b`, border `#c98d78`; hover bg `--accent-soft`; disabled = sama dengan secondary disabled |
| `.btn-row` | grid, `gap:10px` |
| `.btn-row--inline` | `grid-auto-flow:column` |
| `.btn-row--inline .btn` | `width:auto`, **`min-height:44px`**, `padding:8px 14px`, 15px |
| `.link` | `--accent`, 600, `underline`, `text-underline-offset:2px` |

**Notis & status**
| Kelas | Definisi ringkas |
|---|---|
| `.notice` | `padding:12px 14px`, radius 6px, 15px, border `--line`, bg `--surface` |
| `.notice--warn` | bg `--warn-soft`, border `#efd7b8`, warna `--warn-ink` |
| `.notice--ok` | bg `--ok-soft`, border `#cfe4d6`, warna `--ok` |
| `.confirm` | grid, `gap:10px`, `padding:12px 14px`, bg `--warn-soft`, border `#efd7b8`, `--warn-ink`, 15px |
| `.badge` | inline-block, `padding:2px 8px`, radius `999px`, 13px/600 |
| `.badge--draft` | bg `#e7e2db`, teks `#4a443e` |
| `.badge--published` | bg `--ok-soft`, teks `--ok` |

**Teks**
| Kelas | Definisi ringkas |
|---|---|
| `.eyebrow` | 13px, `letter-spacing:0.06em`, uppercase, `--muted` |
| `.lede` | `--muted`, 15px |
| `.meta` | grid, `gap:6px`, 15px, `--muted`; `.meta strong` → `--ink`/600 |
| `.summary` | grid, `gap:10px`, 15px; tiap `div` flex `space-between` + border-bottom |
| `.summary dt` | `--muted`, `flex:0 0 auto` |
| `.summary dd` | rata kanan, 600 |
| `.mono` | Geist Mono, 13px, `overflow-wrap:anywhere` |
| `.day-heading` | `margin:20px 0 10px`, 14px/600, `--muted` |
| `.event-row__title` | 17px/600 |
| `.event-row__meta` | 14px, `--muted` |

### 3.7 Pola layout

- **Satu kolom, mobile-first, max 480px.** Semua halaman memakai `<main class="shell">`.
- Shell pada 390px: lebar 390, padding 20/16/32 → area isi **358px**.
- Shell pada ≥520px: lebar tetap **480px**, padding atas naik ke 40px.
- Grid 2 kolom hanya di `.slot`, `.slot-row`, dan `.summary div` (flex).
- Satu-satunya media query layout: `@media (max-width: 520px)` menumpuk `.slot-row` jadi
  1 kolom, karena 3 tombol inline menyisakan ~59px untuk kolom waktu dan memaksa
  "10.00–10.30 WIB" jadi 3 baris.
- Bar admin sticky di atas, di luar `.shell`, mengulang `max-width` + padding sendiri.
- `html, body { max-width:100vw; overflow-x:hidden }` — lihat catatan di 4.3.

---

## 4. Pengukuran, bukan klaim

### 4.1 Alat & cara

| Yang diukur | Alat | Cara |
|---|---|---|
| Kontras | skrip Python sendiri, rumus WCAG 2.x (`(L1+0.05)/(L2+0.05)`, luminans relatif sRGB) | nilai fg/bg dibaca **manual dari `app/globals.css`**, lalu dihitung. Tiga skrip di `~/.hermes/profiles/momo/cache/scratch/`: `contrast.py` (46 pasangan), `contrast_extra.py` (17: klaim komentar CSS, warna logo, state hover), `c3.py` (9: fill dekoratif & batas kontrol). **Total 72 pasangan diukur**; 50 masuk tabel 4.2, 22 dilaporkan terpisah di 4.2b |
| Target sentuh | Chrome headless via CDP (`Emulation.setDeviceMetricsOverride`, `getBoundingClientRect`) | `next build` + `next start -p 3210`, lalu `document.querySelectorAll('a,button,input,textarea,select,[role=button]')` |
| Overflow | sama, CDP | `document.documentElement.scrollWidth` vs `window.innerWidth` di 390×844 |
| Computed style | sama, CDP | `getComputedStyle()` untuk memastikan kelas benar-benar menghasilkan nilai yang tertulis di CSS |

Aplikasi dijalankan di **port 3210** (`./node_modules/.bin/next start -p 3210`), bukan 3123.
Build bersih: `✓ Compiled successfully`, 0 error, 24 route.

**Yang tidak bisa diukur dan sebabnya:**

1. **Halaman ber-session (`/admin`, `/admin/events/new`, `/admin/events/[id]`, `/users`,
   `/onboarding` state form/menunggu, `/e/[slug]` dengan data, `/e/[slug]/book/[slotId]`,
   `/booking/[icsToken]` dengan data).** Login hanya lewat Google, dan Supabase hosted di
   `.env.local` tidak punya data demo (`/e/demo` → 404, `seed-demo.sql` belum dijalankan).
   Cara mengukur nanti: login Google sungguhan di browser, atau jalankan
   `supabase/seed-demo.sql` lalu ukur `/e/demo`.
   **Yang saya lakukan sebagai gantinya:** membuat harness statis
   (`~/.hermes/profiles/momo/cache/scratch/harness/index.html`) yang **menyalin markup
   persis** dari JSX halaman-halaman itu dan memuat `app/globals.css` **byte-identik**
   (sha256 `f8cc374f…` sama dengan file repo). Harness ini mengukur CSS, bukan aplikasi
   hidup — angka target sentuh dari harness ditandai `[H]` di bawah. Untuk kontras, harness
   tidak dipakai: nilainya dihitung langsung dari deklarasi CSS, jadi sama persis.
2. **State `error` dan `loading` yang butuh server sungguhan** (mis. `DbNotReady` dengan
   kode PostgREST nyata, toast 409 booking). Markup-nya terbaca dari kode; tampilannya tidak
   pernah dirender.
3. **Perilaku hover/focus di perangkat sentuh.** Dihitung dari CSS, tidak diuji di iOS/Android.

### 4.2 Tabel kontras — 50 pasangan, angka terukur

Lantai yang dipakai (WCAG 2.2 AA): **teks normal ≥ 4.5:1**, **teks besar ≥ 3:1**
(≥24px, atau ≥18.66px bold), **batas kontrol / elemen UI ≥ 3:1** (1.4.11).

#### Lulus

| Pasangan teks/latar | fg | bg | Rasio | Lantai |
|---|---|---|---|---|
| teks body | `#1a1a1a` | `#f7f5f2` | **15.99** | 4.5 |
| teks `.card` / `.slot` | `#1a1a1a` | `#ffffff` | **17.40** | 4.5 |
| `.lede` di latar halaman | `#5c5650` | `#f7f5f2` | **6.65** | 4.5 |
| `.lede` di dalam `.card` | `#5c5650` | `#ffffff` | **7.24** | 4.5 |
| `.eyebrow` di latar halaman | `#5c5650` | `#f7f5f2` | **6.65** | 4.5 |
| `.eyebrow` di dalam `.card` | `#5c5650` | `#ffffff` | **7.24** | 4.5 |
| `.topbar` / `.day-heading` | `#5c5650` | `#f7f5f2` | **6.65** | 4.5 |
| `.link` / `.topbar a` di latar halaman | `#b33a12` | `#f7f5f2` | **5.47** | 4.5 |
| `.link` di dalam `.card` | `#b33a12` | `#ffffff` | **5.95** | 4.5 |
| `.slot--open .slot__status` | `#b33a12` | `#ffffff` | **5.95** | 4.5 |
| `.slot--open:hover .slot__status` | `#b33a12` | `#fbeee8` | **5.24** | 4.5 |
| `.field-error` | `#b33a12` | `#ffffff` | **5.95** | 4.5 |
| `.btn--primary` | `#ffffff` | `#b33a12` | **5.95** | 4.5 |
| `.btn--primary:hover` | `#ffffff` | `#96300e` | **7.70** | 4.5 |
| `.btn--primary:disabled` | `#4a443e` | `#d9d3cb` | **6.46** | 4.5 |
| `.btn--secondary` | `#1a1a1a` | `#ffffff` | **17.40** | 4.5 |
| `.btn--secondary:hover` | `#1a1a1a` | `#f2efeb` | **15.18** | 4.5 |
| `.btn--secondary:disabled` | `#5c5650` | `#f2efeb` | **6.31** | 4.5 |
| `.btn--danger` | `#8f2c0b` | `#ffffff` | **8.29** | 4.5 |
| `.btn--danger:hover` | `#8f2c0b` | `#fbeee8` | **7.30** | 4.5 |
| `.btn--danger:disabled` | `#5c5650` | `#f2efeb` | **6.31** | 4.5 |
| `.notice--warn` | `#8a4b06` | `#fdf1e3` | **6.11** | 4.5 |
| `.confirm` | `#8a4b06` | `#fdf1e3` | **6.11** | 4.5 |
| `.slot-row__error` | `#8a4b06` | `#fdf1e3` | **6.11** | 4.5 |
| `.notice--ok` | `#1f6b3a` | `#e8f3ec` | **5.73** | 4.5 |
| `.badge--published` | `#1f6b3a` | `#e8f3ec` | **5.73** | 4.5 |
| `.slot__badge` (slot terbuka) | `#1f6b3a` | `#e8f3ec` | **5.73** | 4.5 |
| `.badge--draft` | `#4a443e` | `#e7e2db` | **7.45** | 4.5 |
| `.slot--taken` | `#5c5650` | `#f2efeb` | **6.31** | 4.5 |
| `.slot--taken .slot__badge` | `#5c5650` | `#e7e2db` | **5.62** | 4.5 |
| `.summary dt` | `#5c5650` | `#ffffff` | **7.24** | 4.5 |
| `.mono` di dalam `.notice--warn` | `#8a4b06` | `#fdf1e3` | **6.11** | 4.5 |
| `.admin-nav__tab` (non-aktif) | `#5c5650` | `#f7f5f2` | **6.65** | 4.5 |
| `.admin-nav__tab[aria-current]` | `#b33a12` | `#f7f5f2` | **5.47** | 4.5 |
| `.admin-nav__tab:hover` | `#1a1a1a` | `#f7f5f2` | **15.99** | 4.5 |
| `.slot--open:hover` teks | `#1a1a1a` | `#fbeee8` | **15.33** | 4.5 |
| `.event-row:hover` meta | `#5c5650` | `#fbeee8` | **6.37** | 4.5 |
| border input / textarea | `#8a8178` | `#ffffff` | **3.82** | 3.0 |
| border `.btn--secondary` | `#8a8178` | `#ffffff` | **3.82** | 3.0 |
| border `.slot--taken` vs `--bg` | `#8a8178` | `#f7f5f2` | **3.51** | 3.0 |
| border `.slot--taken` vs fill sendiri | `#8a8178` | `#f2efeb` | **3.34** | 3.0 |
| `:focus-visible` outline | `#b33a12` | `#f7f5f2` | **5.47** | 3.0 |
| `:focus-visible` outline di `.card` | `#b33a12` | `#ffffff` | **5.95** | 3.0 |

#### **GAGAL**

| # | Pasangan | fg | bg | Rasio | Lantai | Kenapa gagal |
|---|---|---|---|---|---|---|
| **F1** | border `.btn--danger` | `#c98d78` | `#ffffff` | **2.78** | 3.0 | Batas tombol hapus adalah satu-satunya penanda bahwa ia tombol. Di latar `--accent-soft` (hover) turun jadi **2.45**. Di halaman: `/admin/events/[id]` ("Hapus", "Hapus hari"), semua `.btn--danger:disabled` pakai border lain |
| **F2** | border `.card` | `#e5e0d8` | `#f7f5f2` | **1.21** | 3.0 | Batas kartu praktis tak terlihat terhadap latar halaman (lihat 5.2 — kartu dikenali dari fill putihnya, bukan border). Tidak melanggar 1.4.11 karena kartu bukan kontrol, tapi ini penyebab "semua terlihat datar" |
| **F3** | border `.notice--warn` | `#efd7b8` | `#fdf1e3` | **1.25** | 3.0 | Sama: batas notis tidak terbaca; notis dikenali dari warna latar |
| **F4** | border `.notice--ok` | `#cfe4d6` | `#e8f3ec` | **1.17** | 3.0 | idem |
| **F5** | border `.btn--secondary:disabled` / `.btn--danger:disabled` | `#b9aca4` | `#f2efeb` | **1.93** | 3.0 | Kontrol nonaktif **dikecualikan** 1.4.11, jadi bukan pelanggaran — tapi angkanya dicatat karena tombol nonaktif nyaris tak terlihat batasnya |
| **F6** | logo `#F97316` di latar halaman | `#F97316` | `#f7f5f2` | **2.58** | 3.0 | Bagian oranye logo `app-logo.svg` di bawah lantai elemen grafis. Di `#ffffff` = **2.80**. Logo bukan teks, jadi ambangnya 3:1. **Jangan diperbaiki dengan mengubah SVG** (lihat 6.8) |
| **F7** | `.slot--taken` fill vs `--bg` | `#f2efeb` | `#f7f5f2` | **1.05** | 3.0 | Slot terisi nyaris sama dengan latar; pembeda satu-satunya adalah border (3.34, lulus) dan badge |

**Teks: 0 pelanggaran.** Semua 37 pasangan teks lulus ≥4.5:1. Nilai terendah adalah
`#b33a12` di `#f7f5f2` = 5.47.

#### Klaim di komentar CSS vs kenyataan

`app/globals.css` memuat angka kontras di dalam komentarnya. Dua di antaranya tidak cocok
dengan warna yang benar-benar dideklarasikan:

| Komentar | Klaim | Terukur | Selisih |
|---|---|---|---|
| baris 524 `.badge--draft` | 8.4:1 | **7.45** | −0.95 (klaim terlalu tinggi) |
| baris 529 `.badge--published` | 5.3:1 | **5.73** | +0.43 (klaim terlalu rendah) |
| baris 176 `.slot--taken` border | 3.5:1 | **3.51** | cocok |
| baris 261 input border | 3.8:1 | **3.82** | cocok |
| baris 308 disabled primary | 6.5:1 | **6.46** | cocok |

Semua tetap lulus; yang salah hanya angka di komentar. Kalau agent styling menyentuh dua
aturan itu, perbaiki komentarnya juga.

#### 4.2b Sisanya: state hover dan fill dekoratif (22 pasangan, dilaporkan terpisah)

Pasangan di bawah tidak masuk tabel 4.2 karena bukan pasangan teks-latar statis. Angkanya
tetap terukur, dari `contrast_extra.py` dan `c3.py`.

**State hover yang dideklarasikan CSS** — semua lulus:

| Pasangan | Rasio | Lantai |
|---|---|---|
| `.slot--open:hover` teks di `--accent-soft` | 15.33 | 4.5 |
| `.event-row:hover` judul di `--accent-soft` | 15.33 | 4.5 |
| `.event-row:hover` meta di `--accent-soft` | 6.37 | 4.5 |
| `.admin-nav__tab:hover` | 15.99 | 4.5 |

**Fill wadah vs latar halaman** — semua di bawah 3:1, tapi **bukan pelanggaran** karena
wadah bukan kontrol dan bukan informasi yang hanya disampaikan lewat warna:

| Pasangan | Rasio | Catatan |
|---|---|---|
| `.card` fill `#ffffff` vs `--bg` | 1.09 | kartu dikenali dari fill, bukan border |
| `.slot` fill `#ffffff` vs `--bg` | 1.09 | idem |
| `.slot--taken` fill `#f2efeb` vs `--bg` | 1.05 | pembeda: border 3.34 + badge |
| `.badge--draft` fill `#e7e2db` vs `--surface` | 1.29 | chip dekoratif; teks di dalamnya 7.45 |

**Batas kontrol tambahan:**

| Pasangan | Rasio | Lantai | Verdict |
|---|---|---|---|
| `.btn--danger` border `#c98d78` vs `--accent-soft` (hover) | 2.45 | 3.0 | **FAIL** — varian hover dari F1 |
| `.btn--secondary:disabled` border `#b9aca4` vs `#f2efeb` | 1.93 | 3.0 | exempt (nonaktif) |
| `.btn--primary:disabled` fill `#d9d3cb` vs `--bg` | 1.37 | 3.0 | exempt (nonaktif) |
| border `.slot--taken` `#8a8178` vs fill `#f2efeb` | 3.34 | 3.0 | PASS |

**Warna logo vs palet desain** (dari `public/app-logo.svg`, dibaca langsung dari berkas):

| Pasangan | Rasio | Catatan |
|---|---|---|
| navy `#1B2A4A` logo vs `--ink #1a1a1a` | 1.22 | beda tipis, tapi bukan warna yang sama |
| oranye `#F97316` logo vs `--accent #b33a12` | 2.12 | jauh berbeda; logo oranye terang, UI vermilion gelap |

### 4.3 Target sentuh — lantai 44×44px

**Terukur di aplikasi hidup, 390×844, tanpa login** (ini angka sebenarnya, bukan harness):

| Halaman | Elemen | Lebar×Tinggi | Verdict |
|---|---|---|---|
| `/login` | `button.btn.btn--secondary` "Masuk dengan Google" | 358 × 50 | PASS |
| `/login` | `a.link` "Daftar di sini" | 91.7 × **19** | **FAIL** |
| `/register` | `button.btn.btn--secondary` "Masuk dengan Google" | 358 × 50 | PASS |
| `/register` | `a.link` "Masuk" | 48.3 × **19** | **FAIL** |
| `/e/<tidak-ada>` (404) | `a.btn.btn--secondary` "Ke halaman awal" | 324 × 50 | PASS |
| `/booking/<uuid-acak>` (404) | `a.btn.btn--secondary` "Ke halaman awal" | 324 × 50 | PASS |

**Halaman yang gagal: `/login` dan `/register`** — kedua `.link` di baris
"Belum punya akun? …" hanya **19px** tinggi. Penyebabnya `.link` tidak punya padding dan
tetap `display:inline` di dalam `<p class="center lede">` (15px × 1.5 = 22.5px kotak baris,
tapi bounding box link hanya setinggi teks = 19px).

Link yang sama juga dipakai di `/onboarding` ("Batal, kembali ke status"). Di sana ia
berada di dalam `<p class="center">` **tanpa** `.lede`, jadi mewarisi `body` 16px dan
tingginya **18px** — terukur di harness, tetap di bawah 44. Jadi ada **tiga** `.link`
yang gagal, dengan dua tinggi berbeda (19px dan 18px) untuk kelas yang sama.

**Terukur di harness `[H]`** (markup disalin, CSS asli, 390px): **33 kontrol, 0 gagal.**

| Kelas | Lebar×Tinggi | Contoh |
|---|---|---|
| `.admin-nav__tab` | 65.5 × 44 | tab "Event" |
| `.btn` penuh | 358 × 50 | "Buat event", "Keluar", "Tambah ke Google Calendar" |
| `.btn` dalam `.btn-row--inline` | 159 × 44 / 92.7 × 44 | "Setujui"/"Tolak", "Tutup"/"Harga"/"Hapus" |
| `.btn` dalam `.slot-row` | 92.7 × 44 | 3 tombol sejajar |
| `.topbar a` | 97.4 × 44 | "← Semua event" |
| `.event-row` | 358 × 108 | baris daftar event |
| `.slot--open` | 358 × 73 | kartu slot publik |
| `input` | 358 × 50 | field pencarian |
| `textarea` | 324 × 96 | catatan booking |

Distribusi tinggi seluruh kontrol `[H]`: 44px (14×), 50px (15×), 73/96/108/133.5 (masing-masing 1×).

**Kesimpulan:** lantai 44px sudah dipenuhi semua tombol, input, tab, dan baris daftar.
Yang gagal hanya `.link` teks inline (18–19px, tiga tempat: `/login`, `/register`,
`/onboarding`). Itu satu-satunya cacat target sentuh di aplikasi.

### 4.4 Overflow horizontal di 390px

Syarat: `document.documentElement.scrollWidth == window.innerWidth`.

| Halaman | innerWidth | scrollWidth | Verdict |
|---|---|---|---|
| `/login` | 390 | 390 | PASS |
| `/register` | 390 | 390 | PASS |
| `/e/<tidak-ada>` (404) | 390 | 390 | PASS |
| `/booking/<uuid-acak>` (404) | 390 | 390 | PASS |
| harness `[H]` semua blok (A–F) | 390 | 390 | PASS |

Juga diuji di 519 / 520 / 768px: `scrollWidth == innerWidth` di ketiganya; `.shell` tetap
480px di atas 520 (benar), `padding-top` naik 20→40 pada 520 (benar), dan `.slot-row`
berubah dari 1 kolom (`328px`) ke 2 kolom (`262px 144px`) tepat di 520 (benar).

**Peringatan penting — PASS ini sebagian karena dipaksa.** `app/globals.css:32–36`:

```css
html,
body {
  max-width: 100vw;
  overflow-x: hidden;
}
```

Uji tekanan dengan string tanpa spasi (email/URL panjang) di dalam `.summary dd`, `.hint`,
dan `<code>` menghasilkan `scrollWidth` tetap **390** — tapi `getBoundingClientRect()`
elemen yang meluber menunjukkan `right: 528` pada `.summary dd`. Artinya isinya **terpotong
diam-diam**, bukan muat. `.mono` punya `overflow-wrap: anywhere` sehingga aman; `.summary dd`
**tidak punya** aturan itu. Di `/booking/[icsToken]`, `<dd>{event.title}</dd>` adalah teks
biasa tanpa `.mono` — judul event yang panjang tanpa spasi akan terpotong, bukan membungkus.

Jadi: **kriteria `scrollWidth == innerWidth` lulus, tapi bukan bukti tidak ada konten yang
hilang.** Jangan jadikan PASS ini alasan untuk menghapus `overflow-x: hidden`.

---

## 5. Inkonsistensi yang ditemukan

Diurutkan dari yang paling sering terlihat. Semua nilai di bawah **terukur**, bukan
perkiraan. Path + angka.

### 5.1 `.hint` punya tiga ukuran berbeda tergantung di mana ia berada

`.field .hint` (satu-satunya aturan `.hint` di CSS, baris 247) hanya berlaku **di dalam
`.field`**. Di tempat lain `.hint` adalah kelas tanpa aturan, sehingga mewarisi `body`
16px dan warna `--ink`. Terukur di harness:

| Lokasi | Path | font-size | weight | warna |
|---|---|---|---|---|
| `.field .hint` | `app/users/UsersList.tsx:84`, `app/onboarding/OnboardingForm.tsx:104,128`, `app/admin/events/new/NewEventForm.tsx:163,178,206`, `EventEditor.tsx:610,645` | **13px** | 400 | `#5c5650` |
| `dd > span.hint` | `app/users/UsersList.tsx:172` (`· 2 terbit`) | **15px** | **600** | `#1a1a1a` |
| `p.hint` di luar `.field` | `app/users/UsersList.tsx:204` (paragraf definisi "Nilai booking terisi = …"), `app/e/[slug]/book/[slotId]/BookingForm.tsx:167` ("Tanpa akun, tanpa pembayaran di muka.") | **16px** | 400 | `#1a1a1a` |

Efeknya: paragraf penjelasan terpenting di `/users` — yang menjelaskan bahwa angka itu
belum tentu dibayar — dirender 16px `#1a1a1a` (sebesar teks body, sewarna teks utama),
padahal niatnya sebagai catatan kecil. Di `/booking` baris "Tanpa akun…" juga 16px.

### 5.2 `.card` 10px radius + border tak terlihat, `.slot`/`.event-row`/`.day-block` 6px

| Kelas | Path contoh | radius | padding | border |
|---|---|---|---|---|
| `.card` | `app/users/UsersList.tsx:142`, `app/e/[slug]/page.tsx:52`, `app/booking/[icsToken]/page.tsx:85`, `app/onboarding/page.tsx:118` | **10px** | **16px** | `#e5e0d8` (1.21:1 — tak terlihat) |
| `.slot-row` | `app/admin/AccessRequests.tsx:93`, `EventEditor.tsx:385` | **6px** | **12px 14px** | `#e5e0d8` |
| `.event-row` | `app/admin/page.tsx:183` | **6px** | **14px** | `#e5e0d8` |
| `.day-block` | `EventEditor.tsx:240,487` | **6px** | **14px** | `#e5e0d8` |

Empat kelas "kotak" dengan empat kombinasi radius/padding berbeda. Di satu halaman
`/admin/events/[id]`, `.card` (16px, 10px radius) dan `.day-block` (14px, 6px radius)
berdampingan — sudutnya tidak sejajar dan tepi dalamnya tidak lurus.

### 5.3 `.btn` punya padding dan tinggi berbeda di tiga konteks

`.btn` dasar `padding:12px 16px; min-height:48px`. Dua konteks menimpanya:

| Konteks | padding | min-height | font-size | Path |
|---|---|---|---|---|
| `.btn` penuh (default) | **12px 16px** | **48px** | 16px | `app/admin/page.tsx:207`, `app/booking/[icsToken]/page.tsx:133`, `EventEditor.tsx:105` (`.btn-row` di dalam `.confirm`) |
| `.btn-row--inline .btn` | **8px 14px** | **44px** | 15px | `EventEditor.tsx:280,295,414,424,529,654`, `AccessRequests.tsx:110` |
| `.slot-row .btn` | **8px 12px** | **44px** | 15px | `EventEditor.tsx:414` (di dalam `.slot-row`, menang atas `8px 14px`) |

Bukti paling jelas: **tiga tombol berlabel "Batal"** di `/admin/events/[id]`, terukur di
harness pada 390px:

| Lokasi di markup | Lebar×Tinggi | padding | font-size |
|---|---|---|---|
| `.confirm > .btn-row` (`EventEditor.tsx:105–122`) | **328 × 50** | 12px 16px | 16px |
| `.day-block > .btn-row--inline` (`EventEditor.tsx:280–292`) | **136.3 × 44** | 8px 14px | 15px |
| `.slot-row > .btn-row--inline` (`EventEditor.tsx:414–421`) | **144 × 44** | 8px 12px | 15px |

Tiga tombol, satu label, tiga ukuran — di satu halaman.

### 5.4 `.btn--danger` tidak punya padding sendiri, jadi ia mengikuti konteksnya

`.btn--danger` hanya menetapkan `background`/`color`/`border-color`; padding-nya datang
dari aturan konteks. Karena `.slot-row .btn` lebih spesifik daripada `.btn-row--inline .btn`,
**tombol danger di dalam `.slot-row` memakai 8px 12px**, sedangkan **di dalam `.day-block`
memakai 8px 14px**. Terukur di harness:

| Tombol | Konteks | padding | Lebar×Tinggi |
|---|---|---|---|
| "Hapus hari" (nonaktif) | `.day-block > .btn-row--inline` | **8px 14px** | 162.3 × 44 |
| "Hapus" (aktif) | `.slot-row > .btn-row--inline` | **8px 12px** | 92.7 × 44 |

Jadi di `/admin/events/[id]` ada dua tombol destruktif dengan padding horizontal berbeda
(14 vs 12) — bukan karena keputusan desain, tapi karena kedalaman selektornya beda.

### 5.5 `.mono` mengubah ukuran teks yang ditempeli

`.mono` menetapkan `font-size: 13px`. Karena itu menempelkan `.mono` ke elemen yang
seharusnya 15px atau 17px **mengecilkannya**:

| Path | Elemen | Tanpa `.mono` | Dengan `.mono` |
|---|---|---|---|
| `app/admin/page.tsx:141` | `<p class="lede mono">` email | 15px | **13px** |
| `app/admin/events/new/page.tsx:178` | `<p class="lede mono">` slug | 15px | **13px** |
| `app/users/UsersList.tsx:145` | `<span class="badge badge--draft mono">` slug | 13px | 13px (kebetulan sama) |
| `app/admin/AccessRequests.tsx:96,98` | `<div class="slot__status mono">` | 13px | 13px |

Dua `.lede.mono` di atas jadi lebih kecil dari `.lede` biasa di halaman yang sama.

### 5.6 Jarak antar-blok tidak konsisten: 10px vs 12px

- `.stack > * + *` → **12px**
- `.slots` (grid) → **10px**
- `.meta` (grid) → **6px**
- `.summary` (grid) → **10px**, ditambah `padding-bottom:10px` per baris
- `.day-block` (grid) → **10px**
- `.btn-row` (grid) → **10px**

Di `/admin`, seksi Event memakai `.stack` (12px) untuk jarak antar seksi tapi `.slots`
(10px) untuk jarak antar kartu event — dua ritme berdampingan. Di `/admin/events/[id]`,
`.card` (16px padding) berisi `.stack` 12px, sementara `.day-block` (14px padding) berisi
grid 10px.

### 5.7 Tiga kelas "baris daftar" yang secara visual seharusnya sama, tapi tidak

| Kelas | Path | grid | padding | radius | min-height | hover |
|---|---|---|---|---|---|---|
| `.slot` | `app/e/[slug]/page.tsx:94` | `1fr auto` | 12px 14px | 6px | **64px** | hanya `.slot--open` |
| `.slot-row` | `AccessRequests.tsx:93`, `EventEditor.tsx:385` | `1fr auto` → **1fr** di ≤520px | 12px 14px | 6px | — | **tidak ada** |
| `.event-row` | `app/admin/page.tsx:183` | `1fr` (grid, bukan 2 kolom) | 14px | 6px | **64px** | bg `--accent-soft` + border `--accent` |

`.event-row` dan `.slot` sama-sama `<a>` yang bisa diklik dan sama-sama `min-height:64px`,
tapi padding-nya 14px vs 12px 14px. `.slot-row` tidak punya hover sama sekali padahal ia
adalah baris terpadat di aplikasi.

### 5.8 Dua baris ringkasan `<dl>` dengan struktur berbeda untuk data yang sama

`/booking/[icsToken]` dan `/users` sama-sama memakai `.summary`, tapi:

- `/booking/[icsToken]` (`page.tsx:86`): `.card` > `<dl class="summary">` — `<dl>` sebagai anak langsung kartu, tanpa `.stack`
- `/users` (`UsersList.tsx:148`): `.card.stack` > `<dl class="summary">` — `.stack` menambah `margin-top:12px` pada `<dl>`, dan `<dt>`/`<dd>` di dalamnya memakai `<span class="mono">` yang mengecilkan nilai jadi 13px sedangkan `/booking` menampilkan nilai 15px/600

Hasilnya: baris "Email" di `/users` bernilai 13px mono, sedangkan baris "Nama" di
`/booking` bernilai 15px/600 sans. Dalam satu aplikasi, `<dl class="summary">` punya dua
tampilan nilai.

### 5.9 Logo: warna di luar palet, dan klaim plat putih tidak ada di berkasnya

`app/login/page.tsx` (perubahan belum ter-commit, +11 baris) menampilkan
`public/app-logo.svg` selebar maksimum 180px (terukur: **180 × 66.9**, rasio 2.6897 sesuai
`viewBox="0 0 511 190"`).

Warna di dalam SVG: **`#1B2A4A`** (navy, wordmark) dan **`#F97316`** (oranye, 2 path).
Keduanya **tidak ada di `:root`**. Navy `#1B2A4A` vs `--ink #1a1a1a` = 1.22:1 (beda tipis,
tapi beda); oranye `#F97316` vs `--accent #b33a12` = 2.12:1 (jauh berbeda — logo memakai
oranye terang, UI memakai vermilion gelap).

Oranye logo di latar `--bg` = **2.58:1** (gagal lantai 3:1 untuk elemen grafis), di
`--surface` = **2.80:1**.

**Koreksi terhadap kartu tugas:** kartu menyebut SVG ini punya "plat putih penuh
(`<rect fill="#ffffff">`) di atas latar `#f7f5f2`". Berkasnya **tidak memuat `<rect>` sama
sekali** dan **tidak memuat `#ffffff`** (0 kemunculan `rect`, 0 kemunculan `fff`). Isinya
hanya `<svg>`, `<metadata>` (manifest C2PA), `<title>`, dan 3 `<path>`. Jadi tidak ada plat
putih yang perlu dihilangkan — latarnya transparan. Batas keras "jangan ubah SVG" tetap
berlaku apa adanya (lihat 6.8).

### 5.10 `.admin-nav__tab` aktif memakai tiga penanda, tapi `.slot--open` hanya satu

`.admin-nav__tab[aria-current="page"]` sengaja memakai **warna + weight + underline 2px**
(komentar baris 647–648 menjelaskan ini supaya bertahan di greyscale). Prinsip yang sama
tidak diterapkan di tempat lain:

- `.slot--open` → hanya `border-color: var(--accent)`. Tidak ada weight, tidak ada ikon.
  Di greyscale, slot terbuka dan slot terisi hanya dibedakan oleh rasio border 3.51 vs 3.34.
- `.badge--published` vs `.badge--draft` → hanya warna (`#1f6b3a`/`#e8f3ec` vs
  `#4a443e`/`#e7e2db`). Tidak ada ikon atau bentuk pembeda.
- `.slot__status` dalam `.slot--open` → warna `--accent` + weight 600 (dua penanda, baik).

---

## 6. 🔴 Batas keras untuk agent styling

Bagian ini adalah **izin yang diberikan dan izin yang tidak diberikan**. Kalau ragu,
anggap tidak diizinkan dan tanyakan ke Deny.

### 6.1 Nol perubahan perilaku

Hanya **CSS, kelas, dan markup presentasional**. **Nol** perubahan pada:

- logika (kondisi, perhitungan, validasi, urutan cabang)
- query (Supabase, PostgREST, RPC)
- route (path, redirect, `notFound()`, `router.push/replace/refresh`)
- tipe data, prop yang diteruskan, nilai state
- teks yang tampil, kecuali diperbaiki ejaannya dan itu pun harus dilaporkan

Kalau sebuah perubahan visual menuntut perubahan logika, itu **bukan tugas styling** —
laporkan ke Deny, jangan dikerjakan.

### 6.2 Nol sentuh berkas-berkas ini

```
supabase/**
app/api/**
lib/**
proxy.ts
next.config.ts
package.json
package-lock.json
```

Termasuk `supabase/migrations/**` dan `supabase/seed-demo.sql`. Jangan jalankan migrasi.
Jangan menyentuh Supabase hosted.

### 6.3 Google-only auth

Login **hanya lewat Google** (`GoogleButton` → `signInWithOAuth({ provider: "google" })`).
**Jangan menambahkan form email/password dalam bentuk apa pun** — tidak sebagai fallback,
tidak sebagai "opsi lain", tidak sebagai komentar, tidak sebagai tombol nonaktif.
`/login` dan `/register` masing-masing hanya boleh punya satu tombol masuk: tombol Google.

### 6.4 Teks yang tidak boleh diubah (membawa makna)

| Teks | Lokasi | Kenapa |
|---|---|---|
| **"Nilai booking terisi"** + **"belum tentu sudah dibayar"** | `app/users/UsersList.tsx:192` (`<dt>`), `:205` (paragraf definisi) | `revenue_idr` adalah `sum(price_idr)` atas slot yang **sudah dipesan**. Proyek ini **tidak punya tabel pembayaran**. Menamainya "Pendapatan", "Revenue", "Pemasukan", "Penghasilan", atau "Terjual" akan mengklaim uang yang mungkin belum pernah berpindah. **Jangan pernah** mengubahnya jadi "Pendapatan". |
| **"Menunggu persetujuan admin"** | `app/onboarding/page.tsx:119` (eyebrow) | Ini status sebenarnya: pendaftaran sudah dikirim, admin belum memutuskan. Bukan "Berhasil", bukan "Selesai", bukan "Aktif". |
| **"belum isi data studio"** | `app/admin/AccessRequests.tsx:105` (badge) | Menandai pendaftar yang `studio_name`/`contact_wa`-nya kosong. Tombol "Setujui" **tetap ditampilkan** (sengaja, lihat komentar baris 100–102) dan RPC yang menolak dengan `incomplete_registration`. Jangan sembunyikan badge ini, jangan ubah jadi "Lengkapi data" (itu perintah, bukan keadaan). |
| **`incomplete_registration`** | `app/api/admin/access-requests/route.ts:124,127` → tampil lewat `slot-row__error` | Kode error yang dikembalikan server saat `approve_access_request()` menolak. Muncul apa adanya di UI. Jangan diubah jadi kalimat ramah — kode inilah yang memberi tahu Deny apa yang harus diperbaiki. |
| "Slot ini sudah terisi klien — harga dan jadwalnya terkunci." | `EventEditor.tsx:10` (`BOOKED_REASON`) | Menjelaskan kenapa tiga tombol nonaktif. Jangan diringkas jadi "Terkunci". |
| "Pembayaran dilakukan langsung ke fotografer di lokasi. Tidak ada pembayaran di halaman ini." | `app/booking/[icsToken]/page.tsx:148–151` | Satu-satunya pernyataan bahwa aplikasi tidak menagih apa pun. Jangan dihapus, jangan diubah jadi "Pembayaran aman". |
| "Tanpa akun, tanpa pembayaran di muka." | `BookingForm.tsx:167` | Janji ke klien publik. |
| "Tarik event ini?" + penjelasan bahwa tautan klien akan 404 | `EventEditor.tsx:100–103` | Konfirmasi tindakan yang mematikan link yang sudah dibagikan. Jangan diperhalus jadi "Lanjutkan?". |
| `code:` / `message:` / `details:` / `hint:` | `GoogleButton`, `OAuthErrorNotice`, `DbNotReady`, `OnboardingForm` | Nilai diagnostik mentah dari PostgREST/GoTrue. Jangan diterjemahkan, jangan disembunyikan di balik disclosure, jangan dipotong. |

### 6.5 Pertahankan semua atribut aksesibilitas

Jumlah kemunculan saat ini: `aria-describedby` 12×, `aria-busy` 9×, `aria-invalid` 5×,
`aria-current` 3×, `aria-live` 3×, `aria-disabled` 1×, `aria-hidden` 1×, `aria-label` 1×,
`role="alert"` 16×, `role="status"` 4×.

**Jangan menghapus, mengganti nama, atau memindahkan** satu pun. Khususnya:

- `aria-describedby` + `aria-invalid` pada input adalah yang membuat error per-field
  terbaca screen reader. Error per-field **wajib tetap di bawah inputnya sendiri**
  (`OnboardingForm`, `BookingForm`), bukan dipindah ke toast atau ke atas form.
- `role="alert"` pada `.field-error`, `.notice--warn`, `.slot-row__error` — jangan diganti
  jadi `aria-live` saja, dan jangan dihapus karena "berisik".
- `aria-live="polite"` pada `UsersList` (`:91`) dan `GoogleButton` (`:68`) — ini yang
  mengumumkan "Mencari…" dan kegagalan OAuth.
- `aria-current="page"` pada `.admin-nav__tab` — CSS **mengecek atribut ini**
  (`.admin-nav__tab[aria-current="page"]`, baris 649). Menggantinya dengan kelas
  `.is-active` akan mematikan indikator tab aktif.
- `aria-disabled="true"` pada `.slot--taken` (`app/e/[slug]/page.tsx:106`).
- `aria-hidden="true"` pada `.check` (`app/booking/[icsToken]/page.tsx:73`) — tanda ✓
  dekoratif, teksnya sudah ada di `<h1>`.
- `alt` pada logo: `alt="denslab commission"` (`app/login/page.tsx:33`). Jangan diganti
  `alt=""` dan jangan dihapus.
- `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` — jangan
  dihapus atau dibuat `outline: none` tanpa pengganti yang setara.

### 6.6 Ambang aksesibilitas adalah lantai, bukan target

- **Kontras teks ≥ 4.5:1**, teks besar ≥ 3:1, batas kontrol ≥ 3:1. Angka di 4.2 adalah
  **minimum yang harus dipertahankan**. Tidak boleh turun satu pun.
- **Target sentuh ≥ 44×44px.** Tombol, input, dan tab sudah 44–50px. Jangan ada yang turun
  di bawah 44. Tiga `.link` yang sekarang 18–19px (`/login`, `/register`, `/onboarding`)
  sebaiknya dinaikkan, bukan dijadikan pembenaran untuk yang lain.
- Kalau mengganti warna, hitung ulang kontrasnya dan laporkan angkanya. Jangan mengandalkan
  "kelihatannya masih terbaca".

### 6.7 Nol overflow horizontal di 390px

Setelah setiap perubahan, `document.documentElement.scrollWidth` harus tetap **390** pada
viewport 390px, di **setiap** halaman.

Ingat 4.4: PASS saat ini sebagian karena `html, body { overflow-x: hidden }`. Jangan
menghapus aturan itu, dan jangan menganggap PASS berarti tidak ada konten terpotong.
Elemen yang berpotensi terpotong dan belum punya `overflow-wrap`: `.summary dd` (dipakai
untuk judul event di `/booking/[icsToken]`).

### 6.8 `public/app-logo.svg` jangan diubah

Berkas ini **untracked** di git dan **jangan diubah** — jangan diedit, jangan di-commit,
jangan diganti, jangan dihapus.

Isinya (terverifikasi): `viewBox="0 0 511 190"`, warna `#1B2A4A` dan `#F97316`, latar
**transparan** — **tidak ada `<rect>` dan tidak ada `#ffffff`**. Kartu tugas menyebut ada
plat putih penuh di atas latar `#f7f5f2`; berkasnya tidak memuat itu (lihat 5.9).

Kalau agent styling ingin mengubah tampilan logo — menghilangkan latar, mengganti warna
oranye agar lolos 3:1, memotong padding internal, atau membuat versi monokrom — itu
**keputusan Deny, bukan keputusan bebas**. Ajukan, jangan kerjakan.

Yang **boleh** dilakukan tanpa menyentuh SVG-nya: mengubah pembungkusnya di
`app/login/page.tsx` (mis. `maxWidth`, jarak). Tapi ingat `app/login/page.tsx` punya
**+11 baris belum ter-commit** — jangan di-revert, jangan di-commit, dan koordinasikan
dengan Deny sebelum mengubah berkas itu.

### 6.9 Nol install paket baru

**Tanpa framework CSS baru** (jangan tambahkan Tailwind, Bootstrap, Open Props, Pico,
UnoCSS, atau apa pun). **Tanpa font eksternal** (jangan tambah Google Fonts baru, jangan
impor dari CDN). **Tanpa** icon library, animation library, atau PostCSS plugin baru.
`package.json` tidak boleh berubah sama sekali.

Semua yang dibutuhkan sudah ada: `app/globals.css` + `next/font` (Geist Sans/Mono).

### 6.10 Berkas yang boleh diubah

Yang **boleh**: `app/globals.css`, dan `className` / markup presentasional di
`app/**/*.tsx`. Yang **tidak boleh** disebut di 6.2 dan 6.8.

`app/login/page.tsx` sedang punya perubahan belum ter-commit (+11 baris, logo). Jangan
di-revert, jangan di-commit, jangan di-stage.

---

## 7. Arah perbaikan yang disarankan

Maksimal 10 poin, urut dampak terbesar. Ini **saran**, bukan implementasi — tidak ada kode
CSS lengkap di sini.

**1. Naikkan `.link` ke target sentuh 44px.**
*Kenapa:* satu-satunya pelanggaran target sentuh yang nyata — terukur 19px di `/login` dan
`/register`, 18px di `/onboarding`; jempol di ponsel akan salah tekan.
*Di mana:* `app/login/page.tsx:51`, `app/register/page.tsx:106`,
`app/onboarding/OnboardingForm.tsx:145`. Perbaikan bisa murni di `.link` (padding vertikal
+ `display:inline-flex`), tanpa menyentuh markup.

**2. Beri `.hint` satu aturan global, bukan hanya `.field .hint`.**
*Kenapa:* paragraf penjelasan terpenting di `/users` — "belum tentu sudah dibayar" —
sekarang 16px `#1a1a1a`, jadi terbaca sebagai teks utama, bukan catatan. Ini juga
menyebabkan tiga ukuran berbeda untuk satu kelas (13/15/16px).
*Di mana:* `app/users/UsersList.tsx:172,204`, `app/e/[slug]/book/[slotId]/BookingForm.tsx:167`.

**3. Satukan skala radius dan padding wadah.**
*Kenapa:* empat kelas kotak dengan empat kombinasi berbeda (`.card` 10px/16px,
`.day-block` 6px/14px, `.event-row` 6px/14px, `.slot-row` 6px/12px14px) membuat sudut tidak
sejajar saat berdampingan, dan border `#e5e0d8` (1.21:1) terlalu samar untuk menutupi
perbedaan itu.
*Di mana:* `app/admin/events/[id]/EventEditor.tsx`, `app/admin/page.tsx`,
`app/users/UsersList.tsx`. Perbaikan di `globals.css` saja.

**4. Perbaiki kontras border `.btn--danger` (F1: 2.78:1, hover 2.45:1).**
*Kenapa:* satu-satunya kontrol yang batasnya gagal lantai 3:1. Tombol hapus jadi tidak
terbaca sebagai tombol — berbahaya justru karena ia destruktif.
*Di mana:* `.btn--danger` di `EventEditor.tsx:300,443` ("Hapus hari", "Hapus"). Naikkan
kontras border, atau beri fill yang membedakannya dari latar.

**5. Beri `.badge` penanda selain warna.**
*Kenapa:* `.admin-nav__tab` sengaja memakai warna + weight + underline agar bertahan di
greyscale (komentar baris 647–648), tapi `.badge--published` vs `.badge--draft` hanya beda
warna. Status event adalah informasi yang harus terbaca tanpa warna.
*Di mana:* `app/admin/page.tsx:190`, `EventEditor.tsx:78`. Tambah bentuk/ikon/border, bukan
warna baru.

**6. Seragamkan ukuran tombol: satu padding, satu tinggi, satu ukuran font.**
*Kenapa:* `.btn` muncul dalam tiga ukuran karena dua konteks menimpanya dengan nilai
berbeda. Bukti paling telanjang: tiga tombol "Batal" di `/admin/events/[id]` berukuran
328×50, 136.3×44, dan 144×44 (5.3). `.btn--danger` juga ikut berubah padding tergantung
kedalaman selektor (5.4).
*Di mana:* `.btn` / `.btn-row--inline .btn` / `.slot-row .btn` di `globals.css`;
pemakaian di `EventEditor.tsx:280,414,529,654`, `AccessRequests.tsx:110`.

**7. Pisahkan `.mono` dari ukuran font.**
*Kenapa:* `.mono` menetapkan 13px, jadi `.lede.mono` di `/admin` (15px → 13px) lebih kecil
dari `.lede` biasa di halaman yang sama. Kelas tipografi seharusnya tidak mengubah ukuran.
*Di mana:* `app/admin/page.tsx:141`, `app/admin/events/new/page.tsx:178`,
`app/users/UsersList.tsx:153,165`.

**8. Beri `.slot--open` penanda kedua selain border.**
*Kenapa:* prinsip yang sudah dipakai di tab admin belum dipakai di sini. Di greyscale,
slot terbuka (border 3.51) dan slot terisi (border 3.34) hampir identik — padahal ini
satu-satunya keputusan yang harus diambil klien di halaman publik.
*Di mana:* `app/e/[slug]/page.tsx:94` (`.slot--open`). Weight judul waktu, atau ikon, atau
fill berbeda.

**9. Tambahkan `overflow-wrap` pada nilai `.summary dd`.**
*Kenapa:* `.mono` sudah punya `overflow-wrap:anywhere`, `.summary dd` belum. Judul event
panjang tanpa spasi di `/booking/[icsToken]` terpotong diam-diam karena
`html,body{overflow-x:hidden}` menyembunyikan luberannya (terukur: `right:528` pada viewport
390).
*Di mana:* `.summary dd` di `globals.css`, dipakai `app/booking/[icsToken]/page.tsx:94`,
`app/users/UsersList.tsx:148`.

**10. Rapikan jarak antar-blok jadi satu ritme.**
*Kenapa:* `.stack` 12px vs `.slots`/`.summary`/`.day-block`/`.btn-row` 10px vs `.meta` 6px.
Di `/admin` dua ritme ini berdampingan dalam satu seksi.
*Di mana:* semua halaman; perbaikan murni di `globals.css`.

---

## Lampiran: cara mereproduksi angka di dokumen ini

```bash
cd /Users/dendense/Documents/AI/commission-booking

# 1. Build + jalankan di port selain 3123 (3123 milik app Deny, jangan dipakai)
./node_modules/.bin/next build
./node_modules/.bin/next start -p 3210

# 2. Kontras (nilai dibaca dari app/globals.css, bukan dikira)
python3 ~/.hermes/profiles/momo/cache/scratch/contrast.py
python3 ~/.hermes/profiles/momo/cache/scratch/contrast_extra.py

# 3. Target sentuh + overflow di 390px: Chrome headless + CDP
#    Emulation.setDeviceMetricsOverride width=390 height=844 mobile=true
#    lalu query: a,button,input,textarea,select,[role=button]
#    dan bandingkan document.documentElement.scrollWidth vs innerWidth

# 4. Harness untuk halaman ber-session (markup disalin, CSS asli byte-identik)
open ~/.hermes/profiles/momo/cache/scratch/harness/index.html
```

`~/.hermes/profiles/momo/cache/scratch/` adalah direktori cache sesi; kalau sudah dibersihkan,
skrip kontras bisa dibuat ulang dari tabel 4.2 — semua nilai fg/bg di tabel itu dikutip
langsung dari `app/globals.css`.
