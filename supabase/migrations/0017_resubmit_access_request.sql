-- 0017_resubmit_access_request.sql — user yang ditolak bisa mengajukan ulang; status jujur
--
-- Masalah: `handle_new_user` (0005) hanya menyala pada INSERT ke `auth.users`. User yang
-- ditolak sudah punya baris di `auth.users`, jadi login ulang TIDAK membuat baris
-- `access_requests` baru — baris lamanya tetap `rejected`. Akibatnya:
--
--   * antrian `/admin` (`where status='pending'`) tidak pernah menampilkannya lagi,
--   * `/register` menyimpulkan "menunggu persetujuan" dari "login ∧ bukan fotografer ∧
--     bukan admin" tanpa membaca status, jadi user ditolak melihat pesan yang salah,
--   * `complete_registration` (0013) menolak `rejected` dengan `already_decided`, sehingga
--     user tidak bisa memperbaiki data studio yang jadi alasan penolakan.
--
-- Isi:
--   1. `public.resubmit_access_request()` — user mengembalikan barisnya `rejected` → `pending`.
--   2. `public.my_registration_status()` — SIGNATURE BERUBAH: tambah kolom `note`.
--   3. `public.complete_registration(text, text)` — `pending` DAN `rejected` boleh diisi;
--      hanya `approved` yang `already_decided`.
--   4. `public.admin_restore_access_request(uuid)` — admin mengembalikan baris `rejected`
--      ke antrian tanpa menunggu user login.
--
-- Asumsi:
--   * `0001_init.sql` … `0015_admin_event_read.sql` sudah dijalankan (0005 + 0013 wajib:
--     tabel `access_requests`, `is_admin()`, `complete_registration`, `my_registration_status`).
--   * `0016` (instagram) BELUM ada saat berkas ini ditulis. Kalau nanti `0016` menambah
--     kolom ke `RETURNS TABLE my_registration_status`, migrasi ITU yang harus menyertakan
--     `note` juga — `drop function` di sini akan menghapus kolom yang tidak disebut ulang.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- Idempotent: `create or replace` untuk tiga fungsi, `drop function if exists` + create
-- untuk `my_registration_status` (signature berubah), revoke/grant eksplisit. Dijalankan
-- dua kali berturut-turut menghasilkan `md5(pg_get_functiondef)` yang sama.
--
-- Otorisasi: satu-satunya penentu adalah `auth.uid()` (fungsi user) dan `public.is_admin()`
-- (fungsi admin). Grant execute bukan izin — ia hanya pintu; guard di dalam yang memutuskan.

-- ---------------------------------------------------------------- 1. resubmit (user)

-- `security definer` karena policy `access_requests_update` (0005) hanya mengizinkan admin
-- UPDATE. User tidak punya jalur tulis langsung ke tabelnya — dan itu tetap begitu sesudah
-- migrasi ini: satu-satunya cara user mengubah barisnya adalah RPC ini dan
-- `complete_registration`, keduanya menulis HANYA baris milik `auth.uid()`.
--
-- `studio_name` dan `contact_wa` SENGAJA tidak disentuh: penolakan biasanya karena admin
-- ingin data diperbaiki, bukan dihapus. User tidak perlu mengisi ulang, dan `approve` (0013)
-- tetap bisa membuat studio dari data yang sudah ada.
--
-- `requested_at = now()`: pengajuan ulang adalah permintaan baru, jadi ia masuk ke belakang
-- antrian (antrian diurutkan `requested_at` menaik), bukan menyerobot posisi lamanya.
-- `decided_at`/`decided_by`/`note` di-null-kan: baris ini belum diputuskan siapa pun, dan
-- alasan penolakan yang lama tidak boleh menempel pada pengajuan yang baru.
create or replace function public.resubmit_access_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.access_requests;
begin
  -- Tanpa JWT tidak ada baris yang bisa dicari. anon juga tidak punya grant execute; ini
  -- jaring pengaman untuk pemanggil tanpa klaim `sub` (mis. service_role).
  if v_uid is null then
    raise exception 'no_registration' using errcode = 'P0001';
  end if;

  -- `for update`: balapan dengan admin yang menekan Tolak/Setujui di detik yang sama
  -- berakhir pada satu urutan yang jelas, bukan pada dua tulisan yang saling menimpa.
  select * into v_req from public.access_requests where user_id = v_uid for update;

  if not found then
    raise exception 'no_registration' using errcode = 'P0001';
  end if;

  -- Hanya `rejected` yang boleh diajukan ulang. `pending` berarti sudah di antrian
  -- (memanggil dua kali tidak boleh menghasilkan dua permintaan), `approved` berarti
  -- aksesnya sudah ada — keduanya `not_rejected`, bukan error internal.
  if v_req.status <> 'rejected' then
    raise exception 'not_rejected' using errcode = 'P0001';
  end if;

  update public.access_requests
     set status       = 'pending',
         requested_at = now(),
         decided_at   = null,
         decided_by   = null,
         note         = null
   where id = v_req.id;
end;
$$;

revoke all on function public.resubmit_access_request() from public;
revoke all on function public.resubmit_access_request() from anon;
grant execute on function public.resubmit_access_request() to authenticated;

-- ---------------------------------------------------------------- 2. status sendiri (+note)

-- Signature berubah (`note` ditambahkan), jadi `create or replace` TIDAK cukup: Postgres
-- menolak mengganti tipe balikan sebuah fungsi. Drop dulu, lalu create ulang + grant ulang
-- (grant ikut hilang bersama fungsinya).
--
-- `note` = alasan penolakan yang ditulis `reject_access_request()` (0005, `p_note`). Null
-- kalau admin menolak tanpa alasan, dan null lagi setelah resubmit — jadi UI memperlakukan
-- null dan string kosong sama.
--
-- `email::text`: di Supabase hosted `auth.users.email` adalah `varchar(255)`; cast ini
-- menjaga `returns table (... email text ...)` tidak gagal 42804 kalau tipe kolom berubah
-- (pelajaran 0011).
drop function if exists public.my_registration_status();

create function public.my_registration_status()
returns table (status text, studio_name text, contact_wa text, email text, note text)
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
    select r.status, r.studio_name, r.contact_wa, r.email::text, r.note
      from public.access_requests r
     where r.user_id = auth.uid();
end;
$$;

revoke all on function public.my_registration_status() from public;
revoke all on function public.my_registration_status() from anon;
grant execute on function public.my_registration_status() to authenticated;

-- ---------------------------------------------------------------- 3. complete_registration

-- Body identik dengan 0013 kecuali SATU baris: guard status.
--
-- Sebelumnya `status <> 'pending'` → `already_decided`, sehingga user `rejected` tidak bisa
-- memperbaiki data studio yang justru jadi alasan penolakan — dan tidak ada jalan lain,
-- karena policy UPDATE tabelnya admin-only. Sekarang `pending` dan `rejected` sama-sama
-- boleh diisi; hanya `approved` yang menolak: setelah studio dibuat, baris itu bukan lagi
-- formulir pendaftaran.
--
-- Nilai lama tetap ditimpa, bukan error — memanggil berkali-kali selama belum `approved`
-- adalah perilaku yang benar (user memperbaiki isiannya).
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

-- ---------------------------------------------------------------- 4. admin restore

-- Kenapa RPC baru, bukan UPDATE langsung dari route admin (policy
-- `access_requests_update` dari 0005 sebenarnya sudah mengizinkan admin menulis tabel ini):
-- aturan transisi status adalah logika, bukan izin. Kalau route TypeScript yang menulis
-- `status='pending', decided_at=null, …`, aturan itu jadi sumber kebenaran kedua di luar
-- SQL, dan `approve`/`reject`/`resubmit` di masa depan harus tahu tentangnya. Bentuknya
-- sengaja mengikuti `approve_access_request`/`reject_access_request`: guard `is_admin()`,
-- row lock, `raise` dengan kode yang bisa diterjemahkan route.
--
-- `requested_at` TIDAK diubah: ini permintaan yang sama, bukan pengajuan baru, jadi ia
-- kembali ke posisi lamanya di antrian. (Bandingkan `resubmit_access_request()`, yang
-- memang pengajuan baru dan karena itu memakai `now()`.)
--
-- `note` di-null-kan: alasan penolakan yang sudah dibatalkan tidak boleh tampil sebagai
-- alasan pada permintaan yang kembali menunggu.
create or replace function public.admin_restore_access_request(p_request_id uuid)
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

  -- Hanya baris yang ditolak. `pending` sudah di antrian, `approved` sudah punya studio —
  -- mengembalikannya ke antrian akan membuat admin menyetujui dua kali.
  if v_req.status <> 'rejected' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.access_requests
     set status     = 'pending',
         decided_at = null,
         decided_by = null,
         note       = null
   where id = p_request_id
  returning * into v_req;

  return v_req;
end;
$$;

revoke all on function public.admin_restore_access_request(uuid) from public;
revoke all on function public.admin_restore_access_request(uuid) from anon;
grant execute on function public.admin_restore_access_request(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. yang TIDAK diubah
--
-- * `handle_new_user()` (0005) — trigger signup tetap `after insert` saja. Menambahkan
--   cabang "insert or update" di sana akan membuat setiap refresh token menulis ulang
--   baris yang sudah diputuskan admin, dan itu bukan yang diminta.
-- * `approve_access_request()` (0013) dan `reject_access_request()` (0005) — perilakunya
--   tidak berubah. `approve` tetap `invalid_state` untuk `rejected` (keputusan admin tidak
--   dibalik diam-diam; jalurnya `resubmit` atau `admin_restore`), `reject` tetap
--   `pending`-only dan tetap menulis `note`.
-- * Policy `access_requests_*` (0005) dan `admin_users` — tidak ada policy baru. Semua
--   jalur tulis di atas `security definer` dengan guard sendiri.
-- * `photographers` — baris baru tetap hanya dibuat `approve_access_request()`.
