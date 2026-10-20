-- 0004_auth_ownership.sql — kepemilikan event per fotografer (Supabase Auth) + RLS authenticated
--
-- Isi:
--   1. `photographers.user_id` → auth.users(id), unique, nullable (fotografer lama belum punya akun).
--   2. `current_photographer_id()` — satu-satunya sumber "fotografer mana yang sedang login".
--   3. Policy RLS untuk role `authenticated` di 5 tabel. Policy publik (`anon`) dari 0001
--      TIDAK disentuh: halaman /e/[slug] harus tetap jalan tanpa login.
--   4. `set_slot_status` + `admin_event` jadi user-scoped (raise `not_owner`).
--      `book_slot` dan `public_event` TIDAK diubah — keduanya jalur publik tanpa akun.
--
-- Asumsi:
--   * `0001_init.sql`, `0002_slot_status.sql`, `0003_admin_event.sql` sudah dijalankan.
--   * Schema `auth` + fungsi `auth.uid()` ada (Supabase default). Role `anon`,
--     `authenticated`, `service_role` ada (Supabase default).
--   * Hanya server yang memakai service role; browser memakai JWT user (role `authenticated`).
--
-- Idempotent: aman dijalankan ulang (add column if not exists / create or replace /
-- drop policy if exists / revoke-grant eksplisit).
--
-- CATATAN PENTING (urutan deploy): setelah migrasi ini, `set_slot_status` dan
-- `admin_event` menolak pemanggil tanpa user login (`not_owner`), termasuk service role
-- karena service role tidak punya auth.uid(). Route admin yang masih memakai service role
-- (app/api/admin/**) akan gagal sampai kartu AUTH-2 memindahkannya ke sesi user.
-- Jalankan migrasi ini bersamaan dengan deploy AUTH-2.

-- ---------------------------------------------------------------- 1. kolom kepemilikan

alter table public.photographers
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Unique index = jaminan satu akun hanya memegang satu baris fotografer, sekaligus
-- index yang dipakai `current_photographer_id()`. Satu objek, dua fungsi.
create unique index if not exists photographers_user_id_key on public.photographers (user_id);

-- Nullable supaya fotografer lama (belum punya akun) tidak rusak. Setelah semua
-- fotografer punya akun, kolom ini bisa dijadikan `not null` — jangan sekarang,
-- migrasi ini harus aman di DB yang sudah berisi data.

-- ---------------------------------------------------------------- 2. helper kepemilikan

-- security definer: dipanggil dari dalam policy, dan tanpa definer ia akan membaca
-- `photographers` lewat RLS → rekursi tak berujung (policy photographers memanggil
-- fungsi ini lagi). `stable` supaya Postgres bisa meng-cache hasilnya per statement.
-- Mengembalikan null kalau auth.uid() null (anon / service role) atau belum terhubung.
create or replace function public.current_photographer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.photographers where user_id = auth.uid();
$$;

revoke all on function public.current_photographer_id() from public;
-- anon sengaja TIDAK diberi execute: nol policy anon yang memanggilnya, dan auth.uid()
-- untuk anon selalu null sehingga hasilnya tidak berguna.
grant execute on function public.current_photographer_id() to authenticated, service_role;

-- ---------------------------------------------------------------- 3a. grant untuk authenticated
--
-- 0001 mencabut semua grant tabel dari `authenticated` dan hanya memberi `anon` akses
-- baca. Tanpa grant di bawah, policy authenticated tidak akan pernah dievaluasi —
-- PostgREST mengembalikan "permission denied for table", bukan nol baris.

grant select, insert, update, delete on table public.events     to authenticated;
grant select, insert, update, delete on table public.event_days to authenticated;
grant select, insert, update, delete on table public.slots      to authenticated;
grant select on table public.bookings to authenticated;

-- photographers: baca baris sendiri + ubah profil. `id`, `slug`, `user_id` sengaja
-- tidak masuk daftar kolom update — slug adalah URL publik, user_id adalah ikatan akun.
grant select on table public.photographers to authenticated;
grant update (display_name, contact_wa) on table public.photographers to authenticated;

-- ---------------------------------------------------------------- 3b. policy authenticated
--
-- Policy `anon` dari 0001 (events_anon_select, event_days_anon_select, slots_anon_select,
-- photographers_anon_select) dibiarkan apa adanya. Yang ditambahkan di sini terpisah,
-- khusus role `authenticated`, jadi halaman publik tidak berubah perilakunya.

-- events ---------------------------------------------------------------------------
drop policy if exists events_owner_select on public.events;
create policy events_owner_select on public.events
  for select to authenticated
  using (photographer_id = public.current_photographer_id());

drop policy if exists events_owner_insert on public.events;
create policy events_owner_insert on public.events
  for insert to authenticated
  with check (photographer_id = public.current_photographer_id());

drop policy if exists events_owner_update on public.events;
create policy events_owner_update on public.events
  for update to authenticated
  using (photographer_id = public.current_photographer_id())
  with check (photographer_id = public.current_photographer_id());

drop policy if exists events_owner_delete on public.events;
create policy events_owner_delete on public.events
  for delete to authenticated
  using (photographer_id = public.current_photographer_id());

-- event_days ----------------------------------------------------------------------
-- Kepemilikan lewat induk: event_days.event_id → events.photographer_id.
drop policy if exists event_days_owner_select on public.event_days;
create policy event_days_owner_select on public.event_days
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_days.event_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

drop policy if exists event_days_owner_insert on public.event_days;
create policy event_days_owner_insert on public.event_days
  for insert to authenticated
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_days.event_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

drop policy if exists event_days_owner_update on public.event_days;
create policy event_days_owner_update on public.event_days
  for update to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_days.event_id
        and e.photographer_id = public.current_photographer_id()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_days.event_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

drop policy if exists event_days_owner_delete on public.event_days;
create policy event_days_owner_delete on public.event_days
  for delete to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_days.event_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

-- slots ---------------------------------------------------------------------------
-- Kepemilikan lewat dua induk: slots.event_day_id → event_days.event_id → events.
drop policy if exists slots_owner_select on public.slots;
create policy slots_owner_select on public.slots
  for select to authenticated
  using (
    exists (
      select 1
      from public.event_days d
      join public.events e on e.id = d.event_id
      where d.id = slots.event_day_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

drop policy if exists slots_owner_insert on public.slots;
create policy slots_owner_insert on public.slots
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.event_days d
      join public.events e on e.id = d.event_id
      where d.id = slots.event_day_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

drop policy if exists slots_owner_update on public.slots;
create policy slots_owner_update on public.slots
  for update to authenticated
  using (
    exists (
      select 1
      from public.event_days d
      join public.events e on e.id = d.event_id
      where d.id = slots.event_day_id
        and e.photographer_id = public.current_photographer_id()
    )
  )
  with check (
    exists (
      select 1
      from public.event_days d
      join public.events e on e.id = d.event_id
      where d.id = slots.event_day_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

drop policy if exists slots_owner_delete on public.slots;
create policy slots_owner_delete on public.slots
  for delete to authenticated
  using (
    exists (
      select 1
      from public.event_days d
      join public.events e on e.id = d.event_id
      where d.id = slots.event_day_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

-- bookings ------------------------------------------------------------------------
-- Hanya SELECT, hanya untuk slot milik sendiri, dan hanya `authenticated`.
-- anon tetap nol akses (0001: RLS aktif tanpa policy = nol baris). Insert/update/delete
-- tetap hanya lewat RPC security definer — nama + nomor WhatsApp klien tidak boleh
-- bisa diubah dari PostgREST.
drop policy if exists bookings_owner_select on public.bookings;
create policy bookings_owner_select on public.bookings
  for select to authenticated
  using (
    exists (
      select 1
      from public.slots s
      join public.event_days d on d.id = s.event_day_id
      join public.events e     on e.id = d.event_id
      where s.id = bookings.slot_id
        and e.photographer_id = public.current_photographer_id()
    )
  );

-- photographers -------------------------------------------------------------------
drop policy if exists photographers_owner_select on public.photographers;
create policy photographers_owner_select on public.photographers
  for select to authenticated
  using (id = public.current_photographer_id());

drop policy if exists photographers_owner_update on public.photographers;
create policy photographers_owner_update on public.photographers
  for update to authenticated
  using (id = public.current_photographer_id())
  with check (id = public.current_photographer_id());

-- ---------------------------------------------------------------- 4a. set_slot_status user-scoped

-- Aturan lama dipertahankan: `invalid_status`, `slot_not_found`, `slot_booked`.
-- Tambahan: `not_owner` kalau slot bukan milik fotografer yang login.
-- Urutan sengaja: status → keberadaan slot → kepemilikan → booked. Slot milik orang lain
-- yang sudah booked dijawab `not_owner`, bukan `slot_booked`, supaya tidak membocorkan
-- status slot orang lain.
create or replace function public.set_slot_status(
  p_slot_id uuid,
  p_status  text
)
returns public.slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.slots;
  v_owner uuid;
begin
  if p_status is null or p_status not in ('open', 'closed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  select e.photographer_id
    into v_owner
    from public.slots s
    join public.event_days d on d.id = s.event_day_id
    join public.events e     on e.id = d.event_id
   where s.id = p_slot_id;

  if not found then
    raise exception 'slot_not_found' using errcode = 'P0001';
  end if;

  if v_owner is distinct from public.current_photographer_id() then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  -- Satu UPDATE, bukan select-lalu-update: kalau ada booking bersamaan pada slot
  -- yang sama, UPDATE menunggu row lock lalu mengevaluasi ulang `status <> 'booked'`
  -- terhadap versi baris terbaru. Nol baris = slot sudah booked.
  update public.slots
     set status = p_status
   where id = p_slot_id
     and status <> 'booked'
  returning * into v_row;

  if not found then
    raise exception 'slot_booked' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.set_slot_status(uuid, text) from public;
revoke all on function public.set_slot_status(uuid, text) from anon;
-- authenticated WAJIB punya execute: ini jalur /admin setelah login. Mencabutnya
-- membuat halaman admin mati dengan 404 "function not found" dari PostgREST.
grant execute on function public.set_slot_status(uuid, text) to authenticated;
grant execute on function public.set_slot_status(uuid, text) to service_role;

-- ---------------------------------------------------------------- 4b. admin_event user-scoped

-- Bentuk JSON identik dengan 0003 (superset `public_event`). Perubahan hanya:
-- kepemilikan event diperiksa, dan event yang bukan milik pemanggil → `not_owner`.
-- Slug yang tidak ada juga menghasilkan `not_owner` (bukan null lagi) — dari sisi
-- pemanggil, "tidak ada" dan "bukan punyamu" sama-sama bukan urusanmu.
create or replace function public.admin_event(p_slug text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not exists (
    select 1
      from public.events e
      join public.photographers p on p.id = e.photographer_id
     where p.slug = p_slug
       and e.photographer_id = public.current_photographer_id()
  ) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

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
                  where s.event_day_id = d.id  -- sengaja TANPA filter status: admin lihat semua
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
  into v_out
  from public.events e
  join public.photographers p on p.id = e.photographer_id
  where p.slug = p_slug
    and e.status = 'published'
  order by e.created_at desc
  limit 1;

  return v_out;
end;
$$;

revoke all on function public.admin_event(text) from public;
revoke all on function public.admin_event(text) from anon;
grant execute on function public.admin_event(text) to authenticated;
grant execute on function public.admin_event(text) to service_role;

-- ---------------------------------------------------------------- 5. yang TIDAK diubah
--
-- * `book_slot` dan `booking_by_token`: jalur publik/klien tanpa akun, tetap service_role only.
-- * `public_event`: halaman publik, tetap anon + service_role.
-- * Policy `*_anon_select` di 0001: tetap ada, jangan dihapus.
