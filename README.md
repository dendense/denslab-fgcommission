# denslab — commission booking

Aplikasi booking sesi foto tanpa akun: fotografer mempublikasikan event beserta slot waktunya, klien
memilih slot lalu mengisi nama dan nomor WhatsApp, lalu mendapat halaman booking + berkas kalender.
Pemilik studio mengelola event, slot, dan permintaan akses lewat `/admin`.

## Status

🔴 **Arsip** — repo dipindah ke `~/Documents/AI/_archive/commission-booking` dan tidak dikembangkan lagi.
Kode terakhir: commit `4dc47fc` ("feat(booking): tombol hubungi fotografer lewat Instagram").
Tidak ada konfigurasi deploy di repo (tidak ada `vercel.json` maupun `.vercel/`), jadi **status deploy
tidak bisa dipastikan dari repo**. Alasan pengarsipan **tidak tercatat di repo** — tidak ada catatan di
`README.md`, `docs/`, `AGENTS.md`, maupun pesan commit.

## Kebutuhan

- **Node.js 22+** — `@supabase/supabase-js` 2.118.0 butuh `>=22.0.0`; `next` 16.4.2 butuh `>=20.9.0`.
  `package.json` tidak punya field `engines`, jadi batas ini berasal dari lockfile.
- **npm** — repo hanya punya `package-lock.json` (lockfileVersion 3). Tidak ada `pnpm-lock.yaml`,
  `yarn.lock`, atau `bun.lockb`.
- Project Supabase + tiga env var di bagian Konfigurasi.

## Cara jalan

```bash
npm ci
cp .env.local.example .env.local    # lalu isi nilainya
npm run dev                         # = next dev -p 3123
```

Dev server di **http://localhost:3123** (bukan 3000). `/` tidak punya halaman marketing — langsung
redirect ke `/admin`. Halaman publik ada di `/e/<slug>`.

Perintah lain, persis dari `package.json`:

```bash
npm run build     # next build
npm run start     # next start
npm run lint      # eslint
```

Self-check ICS (opsional, dari header `scripts/check-ics.ts`):

```bash
node --experimental-strip-types scripts/check-ics.ts
```

## Struktur

- `app/` — App Router: `/e/[slug]` (event publik), `/e/[slug]/book/[slotId]` (form booking),
  `/booking/[icsToken]` (detail booking + unduh kalender), `/admin`, `/login`, `/register`,
  `/onboarding`, `/users`.
- `app/api/` — route handler: booking publik, admin (event, day, slot, akses, users), auth, ICS.
- `lib/` — klien Supabase, tipe, ICS, helper admin dan sesi.
- `supabase/migrations/` — 19 migrasi SQL (skema, RLS, RPC).
- `proxy.ts` — proxy Next 16: 404 nyata untuk `/e/:slug` dan `/booking/:token`, plus refresh sesi admin.
- `scripts/check-ics.ts` — self-check `lib/ics.ts` (WIB → UTC).
- `docs/` — catatan desain: `DESIGN.md`, `DESIGN-NEW.md`, `LANDING-LOGIN.md`, `COPY-EN.md`.

## Konfigurasi

| Env var | Wajib | Fungsi |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ya | URL project Supabase, dipakai server dan browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ya | anon key, semua baca publik lewat RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | ya | server-only, `serviceClient()` — menembus RLS untuk tulis booking |
| `SUPABASE_ANON_KEY` | tidak | nama cadangan untuk anon key kalau var `NEXT_PUBLIC_*` tidak diisi |

`SUPABASE_SERVICE_ROLE_KEY` jangan pernah diberi prefix `NEXT_PUBLIC_`. Tanpa env yang lengkap,
`lib/supabase.ts` melempar `MissingConfigError` dan route membalas 503 `not_configured`.

## Database

**19** migrasi di `supabase/migrations/` (dihitung dengan `ls -1 supabase/migrations/*.sql | wc -l`).
Nomor `0016` tidak ada — lompat dari `0015` ke `0017`.

**7** tabel: `events`, `event_days`, `slots`, `bookings`, `photographers`, `admin_users`,
`access_requests`.

Migrasi tidak dijalankan otomatis. Terapkan berurutan lewat SQL editor Supabase (tidak ada skrip
migrasi di repo). Skema awal ada di `0001_init.sql`; RLS dinyalakan di `0001` dan `0005`.

## Catatan

- Login dan registrasi hanya lewat Google OAuth (`app/_components/GoogleButton.tsx`). Tidak ada login
  email/password. `app/auth/callback/route.ts` menangani callback-nya.
- `next.config.ts` mengunci `turbopack.root` ke `__dirname`; tanpa itu Next memakai `package-lock.json`
  liar di home directory.
- `next dev` menulis ulang blok di `AGENTS.md`; perubahan itu normal, bukan sisa edit manual.
- `.env.local` ada di folder ini secara lokal dan di-gitignore; template-nya `.env.local.example`.
- `git remote -v` menunjuk ke `https://github.com/dendense/denslab-finance` — nama `denslab-fgcommission`
  tidak muncul di mana pun dalam repo.
- `node_modules` tidak ada di folder arsip ini; jalankan `npm ci` dulu sebelum `npm run dev` atau `build`.
