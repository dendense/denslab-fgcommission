-- 0018_photographer_instagram.sql — username Instagram fotografer (kolom + RPC)
--
-- Masalah: pendaftar tidak punya tempat mengisi akun Instagram-nya, dan halaman publik
-- `/e/[slug]` tidak punya cara menampilkannya tanpa membuka tabel `photographers` ke `anon`
-- (0009 sengaja mencabut jalur itu).
--
-- Isi:
--   1. `public.photographers.instagram text` + `public.access_requests.instagram text`
--      (nullable, disimpan TANPA `@`).
--   2. `public.complete_registration(text, text, text default null)` — SIGNATURE BERUBAH
--      (parameter ke-3). Validasi + normalisasi Instagram.
--   3. `public.approve_access_request(uuid)` — SIGNATURE TETAP. Menyalin
--      `access_requests.instagram` → `photographers.instagram`.
--   4. `public.admin_photographer_stats(text)` — SIGNATURE BERUBAH: tambah kolom `instagram`.
--   5. `public.my_registration_status()` — SIGNATURE BERUBAH: tambah kolom `instagram`
--      (kolom `note` dari 0017 DIPERTAHANKAN).
--   6. `public.public_event(text)` — tambah `instagram` di dalam objek `photographer`.
--      Signature dan bentuk balikan (jsonb `{event, photographer, days}`) tidak berubah,
--      jadi `lib/types.ts` `PublicEvent` tetap valid; field baru bersifat aditif.
--
-- Asumsi:
--   * `0001_init.sql` … `0017_resubmit_access_request.sql` sudah dijalankan. 0017 wajib:
--     ia membuat ulang `my_registration_status` dengan `note`, dan versi di berkas ini
--     adalah salinan badan 0017 + `instagram` — bukan badan 0013.
--   * `public_event` (0001) SUDAH mengembalikan data fotografer di kunci
--     `photographer` (`display_name`, `contact_wa`). Karena itu Instagram ditambahkan di
--     kunci yang sama, bukan lewat RPC baru: satu pintu baca publik, dan `anon` tetap nol
--     akses ke tabel `photographers`.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--   * Tidak ada kode aplikasi yang memanggil `complete_registration` dengan tiga argumen
--     sebelum kartu UI-nya mendarat — `default null` menjaga pemanggil dua argumen tetap
--     jalan (`app/api/onboarding/route.ts` hari ini).
--
-- Idempotent: `add column if not exists`, `drop function if exists` sebelum setiap
-- fungsi yang signature/return type-nya berubah, `create or replace` untuk yang tidak,
-- revoke/grant eksplisit. Dua kali berturut-turut → `md5(pg_get_functiondef)` sama.
--
-- Yang TIDAK disentuh: `select` anon ke `photographers` (0009), column grant anon
-- (`slug, display_name, contact_wa`), policy/RLS apa pun, `book_slot`, `booking_by_token`,
-- `handle_new_user`, `reject_access_request`, `resubmit_access_request`,
-- `admin_restore_access_request`, dan seluruh RPC 0006/0007/0012/0014/0015.
--
-- Dijalankan Deny lewat Supabase SQL Editor (bukan `supabase db push`).
-- Verifikasi setelah apply:
--
--   select proname, pg_get_function_result(oid) from pg_proc
--    where proname in ('my_registration_status', 'admin_photographer_stats');
--   -- harapan: my_registration_status memuat `note` DAN `instagram`
--
--   select column_name, data_type from information_schema.columns
--    where table_name in ('photographers', 'access_requests') and column_name = 'instagram';
--   -- harapan: 2 baris, dua-duanya `text`

-- ---------------------------------------------------------------- 1. kolom

-- Nullable tanpa default: baris lama (sudah approved/rejected, fotografer lama) tidak punya
-- nilainya, jadi NOT NULL akan menggagalkan migrasi. Disimpan tanpa `@` — lihat
-- normalisasi di `complete_registration` di bawah.
alter table public.photographers  add column if not exists instagram text;
alter table public.access_requests add column if not exists instagram text;

-- ---------------------------------------------------------------- 2. complete_registration (+instagram)
--
-- `create or replace` TIDAK bisa mengubah daftar parameter, jadi versi dua argumen
-- di-drop lebih dulu. Tanpa drop, dua fungsi dengan nama sama (`(text, text)` dan
-- `(text, text, text)`) hidup berdampingan dan PostgREST menolak panggilan dengan dua
-- argumen bernama sebagai ambigu (PGRST203) — bukan "memilih yang dua argumen".
--
-- Body = salinan 0017 (`pending` dan `rejected` boleh diisi, hanya `approved` yang
-- `already_decided`) + satu parameter dan satu blok validasi.
--
-- Instagram opsional: kosong/null → disimpan `null` (bukan string kosong), karena UI
-- membedakan "belum diisi" dari "diisi lalu dikosongkan" lewat null.
-- Yang dibuang hanya `@` di depan dan spasi tepi — spasi di tengah, `/`, `-`, karakter
-- non-IG tetap ditolak: nilai ini dipakai untuk membangun URL publik, jadi harus bersih
-- di sumbernya, bukan dibersihkan di setiap pemanggil.
-- Huruf besar TIDAK dipaksa lowercase: Instagram case-insensitive, dan username tampil
-- apa adanya seperti yang ditulis pemiliknya.
drop function if exists public.complete_registration(text, text);

create or replace function public.complete_registration(
  p_studio_name text,
  p_contact_wa  text,
  p_instagram   text default null
)
returns public.access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_req  public.access_requests;
  v_name text;
  v_wa   text;
  v_ig   text;
begin
  -- Tanpa JWT tidak ada baris yang bisa dicari; anon juga tidak punya grant execute,
  -- jadi ini hanya jaring pengaman (mis. service_role memanggil tanpa klaim sub).
  if v_uid is null then
    raise exception 'no_registration' using errcode = 'P0001';
  end if;

  -- `for update` supaya balapan dengan admin yang menekan Approve di detik yang sama
  -- berakhir pada satu urutan yang jelas: salah satu menang, yang lain melihat status
  -- terbaru (dan gagal `already_decided` kalau approval menang).
  select * into v_req from public.access_requests where user_id = v_uid for update;

  if not found then
    raise exception 'no_registration' using errcode = 'P0001';
  end if;

  -- 0017: `rejected` ikut boleh. Hanya `approved` yang menutup formulir.
  if v_req.status = 'approved' then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;

  v_name := btrim(coalesce(p_studio_name, ''));
  -- Non-digit dibuang, bukan ditolak: user menulis "+62 812-3456-789" dan itu nomor
  -- yang sama. Yang divalidasi adalah digitnya, dan yang disimpan versi digit saja
  -- (sama dengan `RegisterForm.tsx` yang juga membuang non-digit).
  v_wa   := regexp_replace(coalesce(p_contact_wa, ''), '[^0-9]', '', 'g');

  if length(v_name) < 2 then
    raise exception 'invalid_studio_name' using errcode = 'P0001';
  end if;

  if length(v_wa) < 8 then
    raise exception 'invalid_contact_wa' using errcode = 'P0001';
  end if;

  -- Instagram: opsional. `@namauser` dan ` namauser ` masuk sebagai `namauser`.
  -- Karakter yang lolos hanya yang legal di username IG: huruf, angka, titik, underscore.
  -- Panjang 1–30 = batas username Instagram.
  v_ig := btrim(coalesce(p_instagram, ''));
  if left(v_ig, 1) = '@' then
    v_ig := btrim(substr(v_ig, 2));
  end if;
  if v_ig = '' then
    v_ig := null;
  elsif v_ig !~ '^[A-Za-z0-9._]{1,30}$' then
    raise exception 'invalid_instagram' using errcode = 'P0001';
  end if;

  update public.access_requests
     set studio_name = v_name,
         contact_wa  = v_wa,
         instagram   = v_ig
   where user_id = v_uid
  returning * into v_req;

  return v_req;
end;
$$;

-- `authenticated` saja. Bukan `anon` (tanpa JWT tidak ada baris milik siapa pun), bukan
-- `service_role` (tidak punya `auth.uid()`, jadi selalu `no_registration` — memberi grant
-- hanya menyamarkan klien yang salah). Sama seperti 0013/0017.
revoke all on function public.complete_registration(text, text, text) from public;
revoke all on function public.complete_registration(text, text, text) from anon;
grant execute on function public.complete_registration(text, text, text) to authenticated;

-- ---------------------------------------------------------------- 3. approve (+instagram)
--
-- Signature TETAP `(p_request_id uuid) -> public.photographers`, jadi `create or replace`
-- cukup. Body = salinan 0013 dengan satu kolom tambahan di INSERT.
--
-- Instagram disalin apa adanya dari `access_requests`: nilainya sudah dinormalisasi dan
-- divalidasi `complete_registration`, jadi memvalidasi ulang di sini hanya membuat dua
-- aturan yang bisa berbeda. Baris lama (pra-0018) berisi null → fotografer tanpa IG.
create or replace function public.approve_access_request(p_request_id uuid)
returns public.photographers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req   public.access_requests;
  v_slug  text;
  v_base  text;
  v_row   public.photographers;
  v_try   int := 0;
  v_name  text;
  v_wa    text;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  -- Row lock: dua admin menekan Approve bersamaan mengantri di sini, bukan
  -- menulis baris photographers dua kali.
  select * into v_req from public.access_requests where id = p_request_id for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_req.status = 'rejected' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- Tanpa user_id tidak ada yang bisa ditautkan ke photographers. Baris seperti ini
  -- hanya mungkin muncul dari insert manual, bukan dari trigger.
  if v_req.user_id is null then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.access_requests
     set status     = 'approved',
         decided_at = coalesce(decided_at, now()),
         decided_by = coalesce(decided_by, auth.uid())
   where id = p_request_id;

  -- Sudah punya photographer (approve kedua, atau baris yang dibuat manual)?
  -- Kembalikan yang ada — jangan sentuh profil yang mungkin sudah diubah user.
  select * into v_row from public.photographers where user_id = v_req.user_id;
  if found then
    return v_row;
  end if;

  -- 0013: tanpa nama studio + WA tidak ada baris `photographers` yang layak dibuat.
  --
  -- Diletakkan SESUDAH early-return di atas, bukan sebelum update status: yang ditolak
  -- hanya pembuatan baris baru yang setengah jadi. Approval ulang untuk user yang barisnya
  -- sudah ada (double tap admin, baris lama pra-0013) tetap 200 dan tidak menyentuh profil.
  --
  -- `raise` membatalkan seluruh statement, jadi `update ... status = 'approved'` di atas
  -- ikut rollback — request tetap `pending`, dan antrian admin tidak kehilangan pendaftar.
  --
  -- Ambang sama dengan `complete_registration()` di atas (nama >= 2 char, WA >= 8 digit),
  -- supaya baris yang lolos onboarding tidak pernah bisa ditolak di sini.
  v_name := btrim(coalesce(v_req.studio_name, ''));
  v_wa   := btrim(coalesce(v_req.contact_wa, ''));
  if length(v_name) < 2
     or length(regexp_replace(v_wa, '[^0-9]', '', 'g')) < 8 then
    raise exception 'incomplete_registration' using errcode = 'P0001';
  end if;

  -- Slug: dari email, lowercase, non-alnum → '-', maks 40 char, plus suffix 4 char
  -- dari UUID supaya dua email mirip tidak bertabrakan. Kalau suffix pun bentrok
  -- (peluangnya kecil tapi bukan nol), coba lagi — jangan gagal karena hoki.
  v_base := btrim(
    substr(regexp_replace(lower(coalesce(v_req.email, 'user')), '[^a-z0-9]+', '-', 'g'), 1, 40),
    '-'
  );
  if v_base = '' then
    v_base := 'user';
  end if;

  loop
    v_try := v_try + 1;
    v_slug := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
    begin
      insert into public.photographers (user_id, slug, display_name, contact_wa, instagram)
      values (v_req.user_id, v_slug, v_name, v_wa, v_req.instagram)
      on conflict (user_id) do nothing
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_try >= 5 then
        raise exception 'slug_conflict' using errcode = 'P0001';
      end if;
    end;
  end loop;

  -- `on conflict do nothing` pada balapan: baris sudah dibuat transaksi lain.
  if v_row.id is null then
    select * into v_row from public.photographers where user_id = v_req.user_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.approve_access_request(uuid) from public;
revoke all on function public.approve_access_request(uuid) from anon;
grant execute on function public.approve_access_request(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. admin_photographer_stats (+instagram)
--
-- Signature BERUBAH di sisi hasil (`returns table`), dan Postgres menolak `create or
-- replace` yang mengganti tipe balikan — jadi drop dulu, lalu create ulang + grant ulang
-- (grant ikut hilang bersama fungsinya). Body = salinan 0011 (yang membawa kedua cast
-- `::text` / `::bigint`) + satu kolom.
--
-- `p.instagram::text`: kolomnya dibuat `text` di bagian 1, jadi cast ini no-op hari ini.
-- Dipasang dengan alasan yang sama seperti `u.email::text` di 0011: `returns table
-- (... instagram text ...)` gagal 42804 kalau kolomnya ternyata `varchar` (mis. sudah
-- dibuat manual di dashboard sebelum migrasi ini).
drop function if exists public.admin_photographer_stats(text);

create function public.admin_photographer_stats(p_search text default null)
returns table (
  photographer_id  uuid,
  slug             text,
  display_name     text,
  contact_wa       text,
  instagram        text,
  email            text,
  has_account      boolean,
  events_total     int,
  events_published int,
  events_done      int,
  slots_total      int,
  bookings_total   int,
  revenue_idr      bigint,
  last_event_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  return query
  select
    q.photographer_id,
    q.slug,
    q.display_name,
    q.contact_wa,
    q.instagram,
    q.email,
    q.has_account,
    q.events_total,
    q.events_published,
    q.events_done,
    q.slots_total,
    q.bookings_total,
    q.revenue_idr,
    q.last_event_at
  from (
    select
      p.id                                                as photographer_id,
      p.slug                                              as slug,
      p.display_name                                      as display_name,
      p.contact_wa                                        as contact_wa,
      p.instagram::text                                   as instagram,
      u.email::text                                       as email,
      (p.user_id is not null)                             as has_account,
      coalesce(ev.events_total, 0)::int                   as events_total,
      coalesce(ev.events_published, 0)::int               as events_published,
      coalesce(ev.events_done, 0)::int                    as events_done,
      coalesce(sl.slots_total, 0)::int                    as slots_total,
      coalesce(bk.bookings_total, 0)::int                 as bookings_total,
      sl.revenue_idr                                      as revenue_idr,
      ev.last_event_at                                    as last_event_at
    from public.photographers p
    left join auth.users u on u.id = p.user_id
    left join lateral (
      select
        count(*)                                                              as events_total,
        count(*) filter (where e.status = 'published')                        as events_published,
        count(*) filter (
          where last_day.max_day is not null
            and last_day.max_day < (now() at time zone 'Asia/Jakarta')::date
        )                                                                     as events_done,
        max(e.created_at)                                                     as last_event_at
      from public.events e
      left join lateral (
        select max(d.day_date) as max_day
        from public.event_days d
        where d.event_id = e.id
      ) last_day on true
      where e.photographer_id = p.id
    ) ev on true
    left join lateral (
      select
        count(*)                                                     as slots_total,
        (sum(s.price_idr) filter (where s.status = 'booked'))::bigint as revenue_idr
      from public.slots s
      join public.event_days d on d.id = s.event_day_id
      join public.events e     on e.id = d.event_id
      where e.photographer_id = p.id
    ) sl on true
    left join lateral (
      select count(*) as bookings_total
      from public.bookings b
      join public.slots s      on s.id = b.slot_id
      join public.event_days d on d.id = s.event_day_id
      join public.events e     on e.id = d.event_id
      where e.photographer_id = p.id
    ) bk on true
    where p_search is null
       or btrim(p_search) = ''
       or p.display_name ilike '%' || p_search || '%'
       or u.email        ilike '%' || p_search || '%'
  ) q
  order by q.revenue_idr desc nulls last, q.display_name asc;
end;
$$;

-- Sama seperti 0010: `authenticated` saja, `anon` dicabut eksplisit. `is_admin()` di dalam
-- fungsi yang memutuskan, bukan grant-nya.
revoke all on function public.admin_photographer_stats(text) from public;
revoke all on function public.admin_photographer_stats(text) from anon;
grant execute on function public.admin_photographer_stats(text) to authenticated;

-- ---------------------------------------------------------------- 5. my_registration_status (+instagram)
--
-- Signature BERUBAH (`instagram` ditambahkan) → drop + create + grant ulang.
--
-- Body = salinan 0017, termasuk kolom `note`. JANGAN kembali ke versi 0013: `note` dipakai
-- `/register`, `/onboarding`, dan `/admin` untuk menampilkan alasan penolakan; menghilangkannya
-- di sini akan membuat 0018 memundurkan 0017.
--
-- `email::text` dan `instagram::text`: alasan yang sama seperti di 0011/0013 — `returns
-- table` tidak melakukan cast implisit, jadi tipe sumber yang berbeda (hosted `varchar(255)`
-- untuk email, kolom manual untuk instagram) akan gagal 42804 saat perencanaan query.
drop function if exists public.my_registration_status();

create function public.my_registration_status()
returns table (status text, studio_name text, contact_wa text, email text, note text, instagram text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  return query
    select r.status, r.studio_name, r.contact_wa, r.email::text, r.note, r.instagram::text
      from public.access_requests r
     where r.user_id = auth.uid();
end;
$$;

revoke all on function public.my_registration_status() from public;
revoke all on function public.my_registration_status() from anon;
grant execute on function public.my_registration_status() to authenticated;

-- ---------------------------------------------------------------- 6. public_event (+instagram)
--
-- `public_event` SUDAH mengembalikan data fotografer di kunci `photographer`
-- (`display_name`, `contact_wa`), jadi Instagram masuk ke kunci yang sama. Ini pilihan
-- yang disengaja dibanding RPC baru `public_photographer_instagram(slug)`:
--
--   * satu pintu baca publik. RPC kedua berarti dua tempat yang harus tetap sepakat soal
--     "fotografer mana yang boleh tampil" (event `published`), dan `lib/public-event.ts`
--     plus `proxy.ts` sudah memanggil `public_event` — satu round-trip, bukan dua;
--   * bentuk balikan TIDAK berubah: `jsonb {event, photographer, days}`, hanya satu kunci
--     baru di dalam `photographer`. `Omit<PublicEvent, "timezone">` di
--     `lib/public-event.ts` tetap valid (field ekstra diabaikan), jadi nol perubahan klien;
--   * `anon` tetap nol akses ke tabel `photographers` — 0009 tidak disentuh, column grant
--     anon tidak diperluas. Instagram keluar HANYA lewat proyeksi fungsi ini, untuk event
--     yang `published`, sama seperti `contact_wa` hari ini.
--
-- Signature dan `returns jsonb` tidak berubah → `create or replace` cukup.
create or replace function public.public_event(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id',          e.id,
      'slug',        p.slug,
      'title',       e.title,
      'location',    e.location,
      'status',      e.status
    ),
    'photographer', jsonb_build_object(
      'display_name', p.display_name,
      'contact_wa',   p.contact_wa,
      'instagram',    p.instagram
    ),
    'days', coalesce(
      (
        select jsonb_agg(day_obj order by day_date)
        from (
          select
            d.day_date,
            jsonb_build_object(
              'id',         d.id,
              'day_date',   d.day_date,
              'start_time', d.start_time,
              'end_time',   d.end_time,
              'slots', coalesce(
                (
                  select jsonb_agg(
                           jsonb_build_object(
                             'id',        s.id,
                             'seq',       s.seq,
                             'starts_at', s.starts_at,
                             'ends_at',   s.ends_at,
                             'price_idr', s.price_idr,
                             'status',    s.status
                           )
                           order by s.seq
                         )
                  from public.slots s
                  where s.event_day_id = d.id
                    and s.status in ('open', 'booked')  -- 'closed' tidak ditampilkan
                ),
                '[]'::jsonb
              )
            ) as day_obj
          from public.event_days d
          where d.event_id = e.id
        ) days_q
      ),
      '[]'::jsonb
    )
  )
  from public.events e
  join public.photographers p on p.id = e.photographer_id
  where p.slug = p_slug
    and e.status = 'published'
  order by e.created_at desc
  limit 1;
$$;

-- Grant tidak berubah dari 0001 — ditulis ulang supaya berkas ini tetap benar sendiri.
revoke all on function public.public_event(text) from public;
grant execute on function public.public_event(text) to anon, service_role;

-- ---------------------------------------------------------------- 7. catatan apply
--
-- `instagram` TIDAK masuk ke column grant anon untuk `photographers` (0009/0001):
-- `grant select (slug, display_name, contact_wa)` dibiarkan apa adanya. Menambah kolomnya
-- di sana akan membuat `select instagram from photographers` berhasil untuk anon tanpa
-- filter event `published` — persis kebocoran yang ditutup 0009.
