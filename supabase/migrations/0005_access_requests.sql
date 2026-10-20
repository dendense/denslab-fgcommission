-- 0005_access_requests.sql — pendaftaran terbuka + approval admin
--
-- Isi:
--   1. `access_requests` — satu baris per akun baru, dibuat otomatis oleh trigger
--      pada `auth.users`. Status: pending → approved | rejected.
--   2. `admin_users` — daftar akun yang boleh menyetujui. Tanpa seed (lihat catatan).
--   3. `is_admin()` — dipakai policy dan di dalam fungsi approve/reject.
--   4. `approve_access_request()` / `reject_access_request()` — keputusan admin,
--      approve sekaligus membuat baris `photographers` untuk user itu.
--   5. RLS + grant untuk kedua tabel, dan trigger `after insert on auth.users`.
--
-- Asumsi:
--   * `0001_init.sql` … `0004_auth_ownership.sql` sudah dijalankan. Khususnya
--     `photographers.user_id` + unique index `photographers_user_id_key` dari 0004 —
--     `on conflict (user_id)` di bawah bergantung pada index itu.
--   * Schema `auth` + `auth.users` + `auth.uid()` ada (Supabase default).
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- ADMIN PERTAMA — tidak bisa di-seed di sini: baris `admin_users` butuh UUID dari
-- `auth.users`, dan UUID itu baru ada setelah akun `denyfarras@gmail.com` dibuat lewat
-- /register. Setelah akun itu ada, Deny menautkannya manual (sekali, di SQL Editor):
--
--   insert into public.admin_users (user_id)
--   select id from auth.users where email = 'denyfarras@gmail.com'
--   on conflict (user_id) do nothing;
--
-- Sebelum baris itu ada, TIDAK ADA yang bisa approve — termasuk Deny. Itu disengaja:
-- grant execute ke `authenticated` bukan izin, `is_admin()` yang menentukan.
--
-- Idempotent: aman dijalankan ulang (create table if not exists / create or replace /
-- drop policy if exists / drop trigger if exists / revoke-grant eksplisit).

-- ---------------------------------------------------------------- 1. tabel

create table if not exists public.access_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid unique references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  contact_wa   text,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users (id) on delete set null,
  note         text
);

-- Antrian admin: yang pending, terlama dulu. Partial index supaya baris yang sudah
-- diputuskan tidak ikut tumbuh di dalam index.
create index if not exists access_requests_pending_idx
  on public.access_requests (requested_at)
  where status = 'pending';

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 2. is_admin()

-- security definer: dipanggil dari dalam policy `access_requests`, dan tanpa definer
-- ia akan membaca `admin_users` lewat RLS → rekursi (policy admin_users memanggil
-- fungsi ini lagi). `stable` supaya hasilnya bisa di-cache per statement.
-- auth.uid() null (anon / service role) → exists(...) false → bukan admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------- 3. grant tabel

-- 0001 mencabut grant `authenticated` di semua tabel lama; tabel baru di sini
-- eksplisit diberikan, dan anon dicabut eksplisit. Tanpa grant, policy tidak pernah
-- dievaluasi — PostgREST menjawab "permission denied", bukan nol baris.
grant select, insert, update, delete on table public.access_requests to authenticated;
grant select on table public.admin_users to authenticated;

revoke all on table public.access_requests from anon;
revoke all on table public.admin_users from anon;

-- service_role: bypassrls only skips policies, not table grants. Supabase's default
-- privileges already hand it ALL on new public tables, but relying on that makes the
-- migration's behaviour depend on project-level defaults — state it here instead.
-- This is the one role that may write `admin_users` (how Deny links the first admin).
grant select, insert, update, delete on table public.access_requests to service_role;
grant select, insert, update, delete on table public.admin_users    to service_role;

alter table public.access_requests enable row level security;
alter table public.admin_users    enable row level security;

-- ---------------------------------------------------------------- 4. RLS

-- access_requests ---------------------------------------------------------------
-- Select: baris sendiri, atau semua baris kalau admin (halaman /admin).
drop policy if exists access_requests_select on public.access_requests;
create policy access_requests_select on public.access_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Insert: hanya baris sendiri. Baris normalnya dibuat oleh trigger, tapi policy ini
-- menjaga kalau klien mengirim sendiri (mis. trigger belum jalan) — tetap tidak bisa
-- menulis baris milik orang lain.
drop policy if exists access_requests_insert on public.access_requests;
create policy access_requests_insert on public.access_requests
  for insert to authenticated
  with check (user_id = auth.uid());

-- Update/delete: HANYA admin. User tidak boleh mengubah status/note-nya sendiri.
-- Catatan: `with check` sengaja sama dengan `using` — admin pun tidak bisa memindah
-- baris menjadi milik user lain.
drop policy if exists access_requests_update on public.access_requests;
create policy access_requests_update on public.access_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists access_requests_delete on public.access_requests;
create policy access_requests_delete on public.access_requests
  for delete to authenticated
  using (public.is_admin());

-- admin_users -------------------------------------------------------------------
-- Hanya baris sendiri, hanya SELECT. Nol policy insert/update/delete: RLS aktif tanpa
-- policy = nol baris, jadi tidak ada jalur tulis dari PostgREST untuk siapa pun.
-- service_role (bypassrls) tetap bisa, dan Deny menaut admin pertama lewat SQL Editor.
drop policy if exists admin_users_select on public.admin_users;
create policy admin_users_select on public.admin_users
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------- 5. approve / reject

-- approve_access_request(p_request_id) → baris photographers
--
-- Idempotent-safe: kalau user itu sudah punya baris photographers, tidak ada baris
-- kedua (`on conflict (user_id) do nothing`), dan yang dikembalikan adalah baris yang
-- sudah ada. Memanggil dua kali pada request yang sama TIDAK melempar invalid_state —
-- hasil pertama sudah `approved`, dan permintaan yang sama dari admin yang sama
-- (double tap, retry jaringan) harus berakhir dengan keadaan yang sama, bukan error.
--
-- `invalid_state` hanya untuk request yang sudah `rejected`: approval tidak boleh
-- diam-diam membalik keputusan sebelumnya.
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
      insert into public.photographers (user_id, slug, display_name, contact_wa)
      values (v_req.user_id, v_slug, v_req.display_name, v_req.contact_wa)
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

-- reject_access_request(p_request_id, p_note) → baris access_requests
--
-- Alasan penolakan (`p_note`) disimpan supaya user yang bertanya "kenapa" tidak
-- harus ditelusuri dari memori. Request yang sudah diputuskan tidak bisa ditolak lagi.
create or replace function public.reject_access_request(
  p_request_id uuid,
  p_note       text default null
)
returns public.access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.access_requests;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  select * into v_req from public.access_requests where id = p_request_id for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.access_requests
     set status     = 'rejected',
         note       = p_note,
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_request_id
  returning * into v_req;

  return v_req;
end;
$$;

revoke all on function public.approve_access_request(uuid) from public;
revoke all on function public.approve_access_request(uuid) from anon;
grant execute on function public.approve_access_request(uuid) to authenticated;

revoke all on function public.reject_access_request(uuid, text) from public;
revoke all on function public.reject_access_request(uuid, text) from anon;
grant execute on function public.reject_access_request(uuid, text) to authenticated;

-- anon sengaja nol execute: tanpa sesi tidak ada yang bisa diputuskan, dan
-- `is_admin()` untuk anon selalu false. Grant di atas bukan izin — fungsi sendiri
-- yang menegakkan `is_admin()`.

-- ---------------------------------------------------------------- 6. trigger signup

-- Supabase pattern: security definer + `set search_path = public`, supaya trigger yang
-- berjalan di dalam skema `auth` bisa menulis ke `public.access_requests` tanpa
-- memberi `authenticated` grant tulis ke `auth.users`. Fungsi ini milik pemilik
-- migrasi (postgres), jadi ia melewati RLS — memang perlu, karena pada saat trigger
-- berjalan belum ada JWT pengguna.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.access_requests (user_id, email, display_name, contact_wa)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'contact_wa', '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger tidak butuh grant EXECUTE (Postgres tidak memeriksanya saat trigger menyala),
-- jadi cabut default PUBLIC: fungsi ini tidak boleh jadi pintu tulis manual.
revoke all on function public.handle_new_user() from public;

-- Kalau akun dibuat ulang dengan email yang sama setelah dihapus, baris lama ikut
-- terhapus oleh `on delete cascade` di `access_requests.user_id` — trigger membuat
-- baris baru yang masih `pending`. Tidak ada keadaan "approved hantu".

-- ---------------------------------------------------------------- 7. yang TIDAK diubah
--
-- * Policy `*_anon_select` di 0001, dan policy `authenticated` di 0004.
-- * `book_slot`, `booking_by_token`, `public_event`, `admin_event`, `set_slot_status`.
-- * `photographers` — baris baru hanya dibuat oleh `approve_access_request()`.
