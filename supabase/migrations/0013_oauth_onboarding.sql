-- 0013_oauth_onboarding.sql — kolom onboarding (studio_name, contact_wa) + RPC jalur Google
--
-- Masalah: `handle_new_user` (0005) bereaksi pada `after insert on auth.users`, jadi akun
-- yang masuk lewat Google OAuth tetap mendapat baris `access_requests` `pending` — itu
-- benar. Yang tidak ada: tempat menyimpan nama studio + nomor WA SEBELUM approval. Metadata
-- Google hanya membawa `full_name` / `avatar_url`; `display_name` dan `contact_wa` yang
-- dibaca `handle_new_user` tidak ada isinya. Akibatnya approval untuk akun Google hanya bisa
-- menghasilkan baris `photographers` dengan `display_name` null — dan baris itu yang tampil
-- di `/users` dan `/e/[slug]`.
--
-- Isi:
--   1. `access_requests.studio_name` + `access_requests.contact_wa` (nullable, `if not exists`).
--   2. `approve_access_request(uuid)` — SIGNATURE TETAP (`uuid` -> `public.photographers`).
--      Menolak `incomplete_registration` alih-alih membuat baris setengah jadi, dan memakai
--      `studio_name` sebagai `display_name` fotografer.
--   3. `public.complete_registration(text, text)` — RPC onboarding untuk baris milik sendiri.
--   4. `public.my_registration_status()` — status registrasi milik pemanggil, untuk `/onboarding`.
--
-- Asumsi:
--   * `0001_init.sql` … `0012_admin_event_ops.sql` sudah dijalankan.
--   * `access_requests` sudah punya `contact_wa` dari 0005 — `add column if not exists` di
--     bawah karena itu NO-OP untuk kolom tersebut. Dibiarkan supaya berkas ini juga benar di
--     database yang `access_requests`-nya dibuat versi 0005 yang lebih lama.
--   * `public.is_admin()` (0005) ada, `security definer` + `stable`.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- Idempotent: `add column if not exists`, `create or replace function`, revoke/grant eksplisit.
-- Tidak menyentuh tabel/policy/trigger/fungsi lain, tidak mengubah `handle_new_user`.

-- ---------------------------------------------------------------- 1. kolom onboarding

-- Nullable dan tanpa default: baris lama (sudah approved/rejected) dan baris baru dari
-- trigger tidak punya nilainya. NOT NULL di sini akan menggagalkan migrasi pada baris lama.
alter table public.access_requests add column if not exists studio_name text;
alter table public.access_requests add column if not exists contact_wa  text;

-- ---------------------------------------------------------------- 2. approve diperketat

-- Body identik dengan 0005 kecuali tiga hal:
--   * guard `incomplete_registration` sebelum insert (lihat komentar di dalam),
--   * `display_name` fotografer diambil dari `studio_name`, bukan `display_name` request,
--   * `contact_wa` yang disimpan adalah versi ter-trim.
--
-- Slug TETAP dari email seperti 0005 (`v_base` dari `lower(email)` + suffix 4 char acak).
-- Karena itu nama studio kosong tidak pernah bisa menghasilkan slug kosong: slug tidak
-- pernah diturunkan dari nama. Bentrok slug hanya mungkin lewat suffix acak; loop 5 percobaan
-- 0005 dipertahankan dan tetap melempar `slug_conflict` (bukan unique violation mentah).
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
  -- Ambang sama dengan `complete_registration()` di bawah (nama >= 2 char, WA >= 8 digit),
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
      insert into public.photographers (user_id, slug, display_name, contact_wa)
      values (v_req.user_id, v_slug, v_name, v_wa)
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

-- ---------------------------------------------------------------- 3. RPC onboarding

-- Dipanggil `/onboarding` setelah user login lewat Google. Menulis HANYA baris milik
-- `auth.uid()`; tidak ada parameter user_id, jadi tidak ada jalur untuk menyentuh baris
-- orang lain.
--
-- Idempoten: boleh dipanggil berkali-kali selama status masih `pending` — nilai lama
-- ditimpa, bukan error. Setelah admin memutuskan (`approved`/`rejected`) baris itu milik
-- admin, bukan user: `already_decided`.
create or replace function public.complete_registration(
  p_studio_name text,
  p_contact_wa  text
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

  if v_req.status <> 'pending' then
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

  update public.access_requests
     set studio_name = v_name,
         contact_wa  = v_wa
   where user_id = v_uid
  returning * into v_req;

  return v_req;
end;
$$;

revoke all on function public.complete_registration(text, text) from public;
revoke all on function public.complete_registration(text, text) from anon;
grant execute on function public.complete_registration(text, text) to authenticated;

-- ---------------------------------------------------------------- 4. RPC status sendiri

-- `/onboarding` memakai ini untuk memilih antara form dan "menunggu persetujuan".
-- Nol baris = tidak ada registrasi (mis. akun yang dibuat sebelum 0005, atau admin murni).
--
-- `email::text`: di Supabase hosted `auth.users.email` adalah `varchar(255)`. Kolom
-- `access_requests.email` di 0005 sudah `text`, jadi cast ini tidak perlu hari ini —
-- dipasang supaya `returns table (... email text ...)` tidak bisa gagal 42804 kalau
-- tipe kolomnya suatu saat berubah (pelajaran 0011).
create or replace function public.my_registration_status()
returns table (status text, studio_name text, contact_wa text, email text)
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
    select r.status, r.studio_name, r.contact_wa, r.email::text
      from public.access_requests r
     where r.user_id = auth.uid();
end;
$$;

revoke all on function public.my_registration_status() from public;
revoke all on function public.my_registration_status() from anon;
grant execute on function public.my_registration_status() to authenticated;

-- ---------------------------------------------------------------- 5. yang TIDAK diubah
--
-- * `handle_new_user()` (0005) — trigger signup tidak disentuh. Metadata Google
--   (`full_name`, `avatar_url`) sengaja tidak dipetakan ke `display_name`: nama studio
--   adalah keputusan user, bukan nama akun Google.
-- * Policy `access_requests_*` (0005). Jalur tulis user adalah `complete_registration()`
--   (`security definer`), bukan UPDATE langsung — policy `access_requests_update` tetap
--   admin-only.
-- * `reject_access_request()`, `admin_users`, `is_admin()`.
-- * `photographers` — baris baru tetap hanya dibuat `approve_access_request()`.
