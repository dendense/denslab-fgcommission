-- 0001_init.sql — booking commission fotografer (demo: 1 event, 1 fotografer, tanpa pembayaran)
--
-- Isi: 5 tabel (photographers, events, event_days, slots, bookings), RLS + policy,
--      dan satu RPC atomik `book_slot` yang dipakai POST /api/bookings.
--
-- Asumsi:
--   * Dijalankan di Supabase (Postgres 15+), schema `public`, extension pgcrypto tersedia
--     (gen_random_uuid sudah built-in sejak PG13, jadi tidak perlu create extension).
--   * Role `anon` dan `service_role` ada (Supabase default).
--   * Service role key hanya dipakai server-side di API route, tidak pernah ke browser.
--   * Timezone penyimpanan: timestamptz (UTC di disk). Tampilan WIB diurus aplikasi.
--
-- Idempotent: aman dijalankan ulang (create table if not exists / drop policy if exists).

-- ---------------------------------------------------------------- tabel

create table if not exists public.photographers (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  display_name text,
  contact_wa   text,
  created_at   timestamptz not null default now()
);

create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers (id) on delete cascade,
  title           text not null,
  location        text,
  status          text not null default 'draft'
                  check (status in ('draft', 'published', 'closed')),
  created_at      timestamptz not null default now()
);

create index if not exists events_photographer_id_idx on public.events (photographer_id);

create table if not exists public.event_days (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  day_date   date not null,
  start_time time not null,
  end_time   time not null
);

create index if not exists event_days_event_id_idx on public.event_days (event_id);

create table if not exists public.slots (
  id           uuid primary key default gen_random_uuid(),
  event_day_id uuid not null references public.event_days (id) on delete cascade,
  seq          int not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  price_idr    int not null check (price_idr >= 0),
  status       text not null default 'open'
               check (status in ('open', 'booked', 'closed')),
  unique (event_day_id, seq)
);

create index if not exists slots_event_day_id_idx on public.slots (event_day_id);

create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null unique references public.slots (id) on delete cascade,
  client_name text not null,
  client_wa   text not null,
  notes       text,
  ics_token   uuid not null default gen_random_uuid() unique,
  created_at  timestamptz not null default now()
);

-- `slot_id unique` adalah jaring pengaman terakhir: satu slot maksimal satu booking,
-- ditegakkan DB, bukan oleh kode aplikasi.

-- ---------------------------------------------------------------- RLS

alter table public.photographers enable row level security;
alter table public.events        enable row level security;
alter table public.event_days    enable row level security;
alter table public.slots         enable row level security;
alter table public.bookings      enable row level security;

-- Grants default Supabase memberi anon `all` ke tabel public; cabut dulu supaya
-- yang berlaku hanya yang kita tulis di bawah.
revoke all on table public.photographers from anon, authenticated;
revoke all on table public.events        from anon, authenticated;
revoke all on table public.event_days    from anon, authenticated;
revoke all on table public.slots         from anon, authenticated;
revoke all on table public.bookings      from anon, authenticated;

-- photographers: halaman publik hanya butuh slug + nama + kontak WA.
-- RLS itu row-level, jadi pembatasan kolom dilakukan lewat column-level GRANT:
-- `select *` dari anon akan gagal, hanya tiga kolom ini yang bisa dibaca.
grant select (slug, display_name, contact_wa) on table public.photographers to anon;

-- events / event_days / slots: boleh dibaca anon hanya untuk event yang published.
grant select on table public.events     to anon;
grant select on table public.event_days to anon;
grant select on table public.slots      to anon;

drop policy if exists photographers_anon_select on public.photographers;
create policy photographers_anon_select on public.photographers
  for select to anon
  using (true);

drop policy if exists events_anon_select on public.events;
create policy events_anon_select on public.events
  for select to anon
  using (status = 'published');

drop policy if exists event_days_anon_select on public.event_days;
create policy event_days_anon_select on public.event_days
  for select to anon
  using (
    exists (
      select 1 from public.events e
      where e.id = event_days.event_id and e.status = 'published'
    )
  );

drop policy if exists slots_anon_select on public.slots;
create policy slots_anon_select on public.slots
  for select to anon
  using (
    exists (
      select 1
      from public.event_days d
      join public.events e on e.id = d.event_id
      where d.id = slots.event_day_id and e.status = 'published'
    )
  );

-- bookings: NOL akses anon, dan sengaja tidak ada policy sama sekali.
-- Alasannya: tabel ini menyimpan nama + nomor WhatsApp klien. Kalau ada satu saja
-- policy select untuk anon, seluruh baris booking (termasuk kontak klien) bisa
-- diambil orang lewat PostgREST hanya dengan anon key yang ada di bundle browser.
-- Klien mengakses datanya sendiri lewat /api/bookings/[ics_token] — token UUID acak
-- yang hanya dia pegang — dan route itu memakai service role di server.
-- Insert juga hanya lewat RPC `book_slot` (security definer) dari service role.
-- RLS aktif + nol policy = nol baris untuk anon/authenticated, tanpa perlu policy "false".

-- Service role TIDAK diberi grant tabel apa pun: kedua jalur server (booking dan
-- baca-token) lewat fungsi security definer di bawah. Least privilege, dan tidak
-- ada jalur yang bisa lupa memfilter.

-- ---------------------------------------------------------------- RPC data publik

-- Halaman publik butuh event + hari + slot + tiga kolom fotografer. Query
-- PostgREST biasa dengan embed `photographers(...)` akan menabrak column-level
-- grant di atas (embed butuh membaca photographers.id untuk join), jadi data
-- publik disajikan lewat satu fungsi dengan proyeksi kolom eksplisit.
--
-- security definer: fungsi berjalan sebagai owner, jadi RLS tidak dievaluasi di
-- dalamnya — karena itu filter `status = 'published'` ditulis eksplisit di sini.
-- Fungsi ini tidak pernah menyentuh tabel bookings: tidak ada nama klien maupun
-- nomor WhatsApp yang bisa keluar dari jalur publik.
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
      'contact_wa',   p.contact_wa
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

revoke all on function public.public_event(text) from public;
grant execute on function public.public_event(text) to anon, service_role;

-- ---------------------------------------------------------------- RPC booking atomik

-- Satu transaksi: UPDATE slot yang masih open, lalu INSERT booking.
-- Kalau UPDATE tidak mengenai baris (slot sudah booked/closed/tidak ada), raise
-- sehingga INSERT tidak pernah terjadi dan tidak ada booking tanpa slot ter-book.
--
-- Race condition: dua pemanggil bersamaan pada slot yang sama akan serialize di row
-- lock UPDATE. Pemanggil kedua menunggu commit pemanggil pertama, lalu Postgres
-- mengevaluasi ulang WHERE `status = 'open'` terhadap versi baris terbaru — sudah
-- 'booked', jadi nol baris, FOUND = false, exception, rollback. Tidak ada read-lalu-write.
create or replace function public.book_slot(
  p_slot_id     uuid,
  p_client_name text,
  p_client_wa   text,
  p_notes       text default null
)
returns table (booking_id uuid, ics_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_token      uuid := gen_random_uuid();
begin
  update public.slots
     set status = 'booked'
   where id = p_slot_id
     and status = 'open';

  if not found then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  insert into public.bookings (slot_id, client_name, client_wa, notes, ics_token)
  values (p_slot_id, p_client_name, p_client_wa, p_notes, v_token)
  returning id into v_booking_id;

  return query select v_booking_id, v_token;
end;
$$;

revoke all on function public.book_slot(uuid, text, text, text) from public;
revoke all on function public.book_slot(uuid, text, text, text) from anon, authenticated;
grant execute on function public.book_slot(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------- RPC baca token

-- Data konfirmasi untuk satu booking, dicari lewat ics_token. Token UUID acak
-- adalah satu-satunya kredensial klien, jadi fungsi ini mengembalikan tepat satu
-- baris atau null. Dieksekusi hanya oleh service role dari server; anon tidak
-- punya grant execute, sehingga token tidak bisa ditebak lewat PostgREST.
create or replace function public.booking_by_token(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'ics_token',   b.ics_token,
    'client_name', b.client_name,
    'notes',       b.notes,
    'created_at',  b.created_at,
    'slot', jsonb_build_object(
      'id',        s.id,
      'starts_at', s.starts_at,
      'ends_at',   s.ends_at,
      'price_idr', s.price_idr
    ),
    'event', jsonb_build_object(
      'title',    e.title,
      'location', e.location,
      'slug',     p.slug
    ),
    'photographer', jsonb_build_object(
      'display_name', p.display_name,
      'contact_wa',   p.contact_wa
    )
  )
  from public.bookings b
  join public.slots s         on s.id = b.slot_id
  join public.event_days d    on d.id = s.event_day_id
  join public.events e        on e.id = d.event_id
  join public.photographers p on p.id = e.photographer_id
  where b.ics_token = p_token;
$$;

revoke all on function public.booking_by_token(uuid) from public;
revoke all on function public.booking_by_token(uuid) from anon, authenticated;
grant execute on function public.booking_by_token(uuid) to service_role;
