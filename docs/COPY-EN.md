# COPY-EN — bahasa Inggris untuk UI `/login`

Riset bahasa Inggris untuk halaman `/login` di `commission-booking`. Bukan terjemahan kata per kata:
yang dicari adalah bagaimana produk nyata menulis elemen-elemen ini, lalu aturannya diturunkan dari
kutipan, bukan dari selera.

**Kesimpulan di depan:**

1. Tombol Google di `/login` harus **`Sign in with Google`**, bukan `Continue with Google`. Google
   hanya mensahkan tiga string, dan `Continue with` dipakai produk yang menggabungkan daftar+masuk
   dalam satu tombol. Di sini `/register` adalah halaman terpisah, jadi kasusnya sign-in murni.
2. Nada di dalam produk (label status, error, tombol) itu **datar dan pendek**. "Hangat" milik halaman
   marketing, dan `/login` hanya boleh meminjam satu kalimat hangat — di hero, bukan di kartu login.
3. Kata yang dilarang bukan opini: GOV.UK punya daftar resmi "Words to avoid" dengan penggantinya, dan
   Wikipedia punya daftar kata yang frekuensinya melonjak di teks LLM per generasi model.

---

## 0. Inventaris teks `/login` — apa yang dihitung

Teks statis di `/login` datang dari **lima** berkas, bukan satu:

| # | Berkas | SHA-256 (saat dibaca, 2026-10-21) | Yang disumbang |
|---|---|---|---|
| 1 | `app/login/lang.ts` | `f4a62fa739dcbe71f025d150fe639aca787f3ccd` | 19 key kamus (`id` + `en`) + 2 label jam |
| 2 | `app/login/page.tsx` | `afca4ade797fb9102e987883dcb9546f67d4b53b` | 4 string hardcoded + 1 `alt` |
| 3 | `app/login/LangToggle.tsx` | `a0285d8c787e66d856f1b5a117409f09feb544ca` | 2 label (`ID`/`EN`) + 1 `aria-label` |
| 4 | `app/_components/GoogleButton.tsx` | `bc0613bf44d36540c07b52b17355ec531a4dd716` | 3 label tombol + 1 pesan gagal + 1 fallback |
| 5 | `app/login/OAuthErrorNotice.tsx` | `0f3a598ecdf99937440c24c70bd080c284eba2dd` | 1 blok error (duplikat #4) + 2 prefix teknis |

**Cara memastikan tidak ada yang terlewat** (tiga grep, dijalankan 2026-10-21):

```
$ grep -oE '^  [A-Za-z0-9_]+:' app/login/lang.ts | sed 's/[: ]//g' | sort -u | nl
     1  en          <- bukan key, nama blok
     2  footerPayment
     3  heroLede
     4  heroTitle
     5  id          <- bukan key, nama blok
     6  loginEyebrow
     7  loginLede
     8  loginTitle
     9  noAccount
    10  previewHint
    11  previewTitle
    12  registerLink
    13  slotAvailable
    14  slotTaken
    15  step1Body
    16  step1Title
    17  step2Body
    18  step2Title
    19  step3Body
    20  step3Title
    21  stepsTitle
    → 21 - 2 nama blok = 19 key kamus

$ grep -nE '>[A-Za-z©][^<>{]*<|alt="[^"]*"|aria-label="[^"]*"' app/login/page.tsx
55:          alt="denslab commission"
65:          <p className="eyebrow">Photographer Commission Maker</p>
95:              <span className="slot__price">Rp150.000</span>
100:              <span className="slot__price">Rp150.000</span>
129:        <p className="hint">© denslab - Cinemichi Production</p>

$ grep -nE 'label: "|aria-label=' app/login/LangToggle.tsx
8:  { value: "id", label: "ID" },
9:  { value: "en", label: "EN" },
41:    <div className="lang" role="group" aria-label="Bahasa / Language">

$ grep -nE '\{busy \? |<strong>|code: |message: |\|\| "' app/_components/GoogleButton.tsx
43:          message: oauthError.message || "Server auth tidak mengirim pesan.",
65:        {busy ? "Mengalihkan ke Google…" : "Masuk dengan Google"}
72:              <strong>Google gagal.</strong> Coba lagi, atau hubungi admin kalau terus
75:            <p className="mono">code: {error.code}</p>
76:            <p className="mono">message: {error.message}</p>

$ grep -nE '<strong>|code: |message: ' app/login/OAuthErrorNotice.tsx
29:        <strong>Google gagal.</strong> Coba lagi, atau hubungi admin kalau terus gagal.
31:      <p className="mono">code: {code}</p>
32:      {description ? <p className="mono">message: {description}</p> : null}
```

Total: **19 key kamus + 13 string non-kamus = 32 string**, dikelompokkan jadi 26 baris keputusan di
bawah (yang duplikat digabung, yang byte-identik ditandai "pertahankan").

> ⚠️ `app/_components/GoogleButton.tsx` **berubah saat kartu ini berjalan** (100 baris → 82 baris, prop
> `labels` hilang) dan `app/login/page.tsx` juga (`138` → `133` baris) — ada worker lain di `app/login/**`.
> SHA di atas diambil ulang di akhir run dan **cocok** dengan isi berkas saat dokumen ini selesai ditulis
> (`shasum` dijalankan dua kali, hasil sama). Kalau LOGIN-4 jalan setelah ini dan SHA-nya berbeda, teks
> Indonesia di kolom 2 yang menang, bukan dokumen ini.

---

## 1. Konvensi tombol OAuth — bukti

### 1a. Google sendiri menyarankan apa

Dari **Sign in with Google Branding Guidelines** (halaman menyatakan *"Last updated 2026-07-07 UTC"*),
https://developers.google.com/identity/branding-guidelines:

> "To encourage users to click the button, we recommend the call-to-action text **"Sign in with Google",
> "Sign up with Google", or "Continue with Google"**. Localization of this text to match the language of
> your app or website is permitted and encouraged to provide a better user experience."

> "It should be clear to the user that they are signing into your app or signing up for your app with
> their Google credentials, not signing up or registering for a Google Account on your app."

> "Don't Use the term "Google" by itself in the button to represent the action of Sign in with Google."

> "The button must always include the standard color for the Google "G"."

Jadi: **tiga** string yang disahkan, dan `"Google"` sendirian sebagai label tombol dilarang.

### 1b. Empat nilai `data-text`, dan mana yang default

Dari **Sign in with Google HTML API reference** (*"Last updated 2026-09-01 UTC"*),
https://developers.google.com/identity/gsi/web/reference/html-reference — bagian
*Element with class "g_id_signin" → data-text*:

> "The button text. The default value is `signin_with`."

| Nilai | Label yang dirender |
|---|---|
| `signin_with` (**default**) | "Sign in with Google" |
| `signup_with` | "Sign up with Google" |
| `continue_with` | "Continue with Google" |
| `signin` | "Sign in" |

Dari halaman yang sama, bagian `data-context` (untuk One Tap) — tiga konteks yang Google sediakan:
`signin` → "Sign in to", `signup` → "Sign up to", `use` → "Use".

### 1c. Produk nyata memakai apa — 7 kutipan persis

| # | Produk | Kutipan persis | Di mana di halaman | URL |
|---|---|---|---|---|
| 1 | Cal.com | `Continue with Google` | `<button ... data-testid="continue-with-google-button">…Continue with Google</button>` | https://cal.com/signup |
| 2 | Cal.com (kamus i18n) | `"signin_with_google":"Sign in with Google"` **dan** `"signup_with_google":"Sign up with Google"` | `packages/i18n/locales/en/common.json` | https://raw.githubusercontent.com/calcom/cal.com/main/packages/i18n/locales/en/common.json |
| 3 | Vercel | `Continue with Google` | `aria-label="Continue with Google" data-testid="login/google-button"` | https://vercel.com/login |
| 4 | Calendly | `Continue with Google` | payload tombol: `"label":[0,"Continue with Google"]`, `"type":[0,"oauth-login-secondary"]` | https://calendly.com/signup |
| 5 | Grammarly | `Sign in with Google` | `<span class="…textWithArrow…">Sign in with Google</span>` | https://www.grammarly.com/signin |
| 6 | Tumblr | `Continue with Google` | `<a href="/auth/google…"><div class="FOMdK">Continue with Google</div></a>` | https://www.tumblr.com/login |
| 7 | Miro | `Sign up with Google` | `"welcomeonboard.signup-with-google-cta":"Sign up with Google"` | https://miro.com/login/ |

Kutipan 1, 3, 4, 5, 6, 7 diambil langsung dari HTML halaman yang di-fetch (2026-10-21) — atribut
`aria-label`, `data-testid`, dan string locale, bukan teks marketing.

**Yang paling umum di sampel ini: `Continue with Google` (4 dari 7).** Tapi itu bukan alasan memilihnya.

### 1d. Kapan `Continue with` benar, dan kenapa bukan di sini

Satu-satunya alasan yang bisa dipertanggungjawabkan untuk `Continue with` adalah **satu tombol untuk dua
alur** (masuk + daftar). Bukti paling jelas dari praktisi, UX StackExchange
(https://ux.stackexchange.com/questions/148443/using-a-single-button-for-sign-in-and-sign-up/148458):

> ""*Continue with...*" seems to be the best and most comprehensive label for when the use-case includes
> both Signing in and Signing up."
>
> "Google says you should use "*Sign in with Google*" with their button (or "*Sign up with Google*" when
> the use-cases are separated)"

Di `/login` kasusnya **terpisah**: kartu login punya tautan sendiri `Belum punya akun? → Daftar di sini`
menuju `/register`, dan `/register` punya `<h1>Daftar dengan akun Google</h1>`. Artinya pengunjung
`/login` yang tidak punya akun sudah punya jalan keluar yang eksplisit.

**Keputusan: `Sign in with Google`.** Tiga alasan, semuanya bisa diperiksa:

1. Itu nilai `data-text` default Google (`signin_with`) — https://developers.google.com/identity/gsi/web/reference/html-reference
2. Google mensahkan string itu untuk alur yang memang sign-in — https://developers.google.com/identity/branding-guidelines
3. `Continue with` menjanjikan "lanjut ke mana saja", padahal `/login` hanya punya satu tujuan yang
   sudah ditentukan `/auth/callback`; pengunjung tanpa registrasi malah dilempar ke `/register`.

Tambahan dari GOV.UK style guide (https://www.gov.uk/guidance/style-guide/a-to-z-of-gov-uk-style#sign-in-or-log-in):

> "Use sign in rather than log in (verb) for calls-to-action where users enter their details to access a
> service."

→ `Sign in`, bukan `Log in`, bukan `Sign In`, bukan `SIGN IN`.

### 1e. Temuan kepatuhan — bukan copy, tapi harus dicatat

Tombol di `GoogleButton.tsx` sekarang **tidak memuat logo "G" sama sekali** (`className="btn btn--secondary"`,
isi hanya teks). Branding Guidelines menyatakan:

> "The button must always include the standard color for the Google "G"."

dan

> "Don't Use the Google icon or logo by itself without the button boundary and without text to indicate
> the user action."

Yang dilarang eksplisit adalah logo-tanpa-teks; teks-tanpa-logo tidak disebut sebagai "Do". Untuk
verifikasi aplikasi Google, tombol kustom wajib mengikuti pedoman warna/logo. **[PERLU KEPUTUSAN]** —
bukan wilayah kartu copy, tapi jangan diam-diam: kalau tombolnya tidak pernah dirender lewat GIS SDK,
ini risiko saat app verification.

---

## 2. Pola teks pemesanan slot — bukti

Empat produk booking, kutipan persis. Perhatikan **panjangnya**: judul bagian 2–4 kata, label status
1–2 kata, dan kalimat lengkap hanya muncul saat ada yang harus dilakukan pengguna.

### 2a. Cal.com — kamus i18n resmi (paling kuat, bisa di-grep)

Sumber: https://raw.githubusercontent.com/calcom/cal.com/main/packages/i18n/locales/en/common.json
(di-fetch 2026-10-21, 319.953 byte)

| Peran | Key | Kutipan persis |
|---|---|---|
| Judul bagian waktu | `date_and_time` | `"Date & time"` |
| Label aksi pilih jam | `select_time` | `"Select time"` |
| Slot kosong | `no_available_slots` | `"No available slots"` |
| Semua slot habis (hari itu) | `all_booked_today` | `"All booked."` |
| Slot direbut orang lain | `booking_conflict_error` | `"This slot is no longer available. Please return to the previous page and select another time."` |
| Konfirmasi sebelum kirim | `confirm_your_details` | `"Confirm your details"` |
| Judul halaman konfirmasi | `booking_confirmation` | `"Confirm your {{eventTypeTitle}} with {{profileName}}"` |
| Setelah berhasil (instan) | `booking_confirmed` | `"Your booking has been confirmed"` |
| Setelah berhasil (perlu approval) | `booking_submitted` | `"Your booking has been submitted"` |
| Tombol pasca-booking | `add_to_calendar` | `"Add to calendar"` |
| Status milik host | — | `"Booked (awaiting host)"`, `"Booked by"` |

Halaman hidup (https://cal.com/rick, di-fetch 2026-10-21 via text-extraction proxy) merender:
`"Available times for Wednesday, October 21, 2026"`, `"Today"`, `"12h 24h"`, `"Select..."`.

### 2b. Calendly — halaman booking hidup

Sumber: https://calendly.com/woo-service/30min?month=2026-10&date=2026-10-22 (di-fetch 2026-10-21)

Kutipan persis dari halaman:
- Judul bagian: `"Select a Date & Time"` (Title Case, satu-satunya di sampel ini yang Title Case)
- Umpan balik setelah tanggal diklik: `"Times for October 22 are now displayed"`
- Label kontrol: `"Time zone"`, `"UTC Time"`, `"(6:57am)"`
- Judul hari: `"Thursday, October 22"`
- Teks penyelenggara (bukan Calendly, ditulis user): `"Kindly ensure all fields are completed to allow us to assist you effectively during our call."` — contoh bagus kenapa copy template terasa mesin: tiga kalimat formal untuk satu form.

Label tombol akhir di Calendly adalah `Schedule Event` (dikutip di
https://community.calendly.com/how-do-i-40/how-do-i-check-someones-availability-to-schedule-a-meeting-4557:
"fill out the booking form and click schedule event") — **[TIDAK TERVERIFIKASI]** langsung dari halaman
booking; halaman butuh klik slot dulu dan render-nya JS.

### 2c. OpenTable — widget reservasi

Sumber: https://www.opentable.com/widget/reservation/canvas?lang=en-US&rid=1076725 (di-fetch 2026-10-21)

Kutipan persis: `"Find a Table"`, `"Today"`, `"Back"`, `"1:00 AM"`, `"2 people"`.

Catatan akses: `https://www.opentable.com/` mengembalikan **403 Forbidden** (Akamai, `Reference #18.8f4ddb17`)
— jadi yang dikutip hanya widget yang bisa diakses. Label party size adalah `"2 people"` (angka + satuan),
bukan "Party size: 2".

### 2d. Resy

Sumber: https://resy.com/cities/new-york-ny/venues/le-bernardin (di-fetch 2026-10-21)

Kutipan persis: `"Guests"`, `"Time"`, `"Book Your Le Bernardin Reservation Now on Resy"` (judul tab),
`"Need to Know"` (blok kebijakan restoran).

Dari beranda (https://resy.com/): `"Book Tonight"`, `"Your next favorite restaurant is a few taps away."`

### 2e. Dua lagi untuk melengkapi pola

- **Booksy** (https://www.booksy.com/, 2026-10-21): `"Book with the best, near you"` dan
  `"Booksy is a free beauty scheduling app and makes appointments easy to find and book within seconds.
  No more phone tag. Book anytime, from anywhere, 24/7."`
- **Fresha** (https://www.fresha.com/, 2026-10-21): judul `"Instantly book salons and spas nearby"`,
  navigasi `"Log in or sign up"`.

### 2f. Yang diturunkan dari pola ini

| Pertanyaan | Jawaban dari bukti |
|---|---|
| Kalimat lengkap atau frasa pendek? | **Frasa pendek** untuk judul/label/status (`"Date & time"`, `"Select time"`, `"No available slots"`, `"All booked."`, `"Add to calendar"`). **Kalimat lengkap** hanya untuk pesan yang menuntut tindakan (`"This slot is no longer available. Please return to the previous page and select another time."`) dan untuk konfirmasi hasil (`"Your booking has been confirmed"`). |
| Imperatif atau deklaratif? | **Imperatif** untuk yang pengguna lakukan (`Select time`, `Confirm your details`, `Find a Table`). **Deklaratif** untuk keadaan (`Your booking has been confirmed`, `No available slots`, `All booked.`). |
| Ada titik di akhir? | Label/status: **tidak** (`"No available slots"`), kecuali `"All booked."` — satu-satunya titik di set label Cal.com. Kalimat penuh: **ya**. |
| Sebut "preferred"/"pilihan Anda"? | **Tidak pernah.** Nol dari empat produk memakai "preferred". Yang ada `"Select time"`. |

---

## 3. Nada untuk audiens kreatif — bukti, dan di mana batasnya

### 3a. Kutipan

**Pixieset** — https://www.pixieset.com/ (2026-10-21)
> "Designed for photographers. Built to help you grow."
> "The ultimate photo gallery that redefined the industry."
> "Client Gallery turns every photo delivery into an unforgettable brand moment."
> "Everything you need. All in one place."

**ShootProof** — https://www.shootproof.com/features/ (2026-10-21)
> "Beautiful Galleries You and Your Clients Will Love"
> "Become a Smooth Operator"
> "Get paid daily, weekly, or monthly, plus never chase down an invoice again!"
> "Build a photography portfolio in seconds, without any learning curve."

**Tave / VSCO Workspace** — https://tave.com/ (2026-10-21)
> "Grow Your Business, Not Your To-Do List"
> "Allow your clients to schedule consults or book sessions completely unassisted."

**Studio Ninja** — https://www.studioninja.co/ (2026-10-21)
> "AUTOMATE YOUR BUSINESS. RECLAIM YOUR TIME."
> "Booking clients while you sleep"
> "No credit card. No contracts. Just powerful results."

**HoneyBook** — https://www.honeybook.com/features (2026-10-21)
> "Everything you need to go from lead to payment"
> "Manage every client, project, and payment all in one place."

### 3b. Batas antara ramah dan marketing-speak

Membandingkan dua register di produk yang **sama**:

| Register | Contoh | Tempatnya |
|---|---|---|
| Marketing (boleh hangat, boleh hiperbola) | Pixieset `"unforgettable brand moment"`; Studio Ninja `"Booking clients while you sleep"`; ShootProof `"Become a Smooth Operator"` | halaman jualan, jauh dari alur kerja |
| Produk (datar, pendek, faktual) | Cal.com `"Select time"`, `"No available slots"`, `"All booked."` | di dalam alur, saat pengguna sedang mengerjakan sesuatu |

Batasnya bukan "seberapa hangat", tapi **di mana pengguna berada**. Kalimat hangat dibolehkan saat
pengguna membaca; kalimat hangat jadi gangguan saat pengguna sedang mengisi form atau menunggu hasil.

Mailchimp menyatakan prinsip ini sebagai aturan, bukan preferensi
(https://styleguide.mailchimp.com/voice-and-tone/):

> "We are plainspoken. We understand the world our customers are living in: one muddled by hyperbolic
> language, upsells, and over-promises. We strip all that away and value clarity above all."

> "Mailchimp's tone is usually informal, but it's always more important to be clear than entertaining."

> "Your tone also changes depending on the emotional state of the person you're addressing. You wouldn't
> want to use the same tone of voice with someone who's scared or upset as you would with someone who's
> laughing."

Terjemahan untuk `/login`: halaman ini **campuran** — hero itu marketing (boleh satu kalimat hangat),
kartu login dan blok error itu produk (nol kehangatan). Pengguna yang baru gagal login sedang "scared or
upset", bukan "laughing".

Batas atas kehangatan yang masih wajar, dari sampel: **tiga negasi pendek** — Studio Ninja
`"No credit card. No contracts. Just powerful results."` Lewat dari itu (`"unforgettable brand moment"`)
sudah marketing, dan itu hanya boleh di halaman jualan.

---

## 4. Kata dan frasa yang dilarang

Empat sumber, semuanya bisa diperiksa. Kolom "Pengganti" untuk GOV.UK adalah pengganti **yang ditulis
GOV.UK sendiri**, bukan karangan saya.

### 4a. GOV.UK — "Words to avoid"

Sumber: https://www.gov.uk/guidance/style-guide/a-to-z-of-gov-uk-style#words-to-avoid
Halaman menyatakan: *"Plain English is mandatory for all of GOV.UK so avoid using these words:"*

| # | Dilarang | Pengganti (kutipan GOV.UK) |
|---|---|---|
| 1 | `empower` | "use 'allow' or 'give permission'" |
| 2 | `leverage` | "use 'influence' or 'use'" |
| 3 | `utilise` | "use 'use'" |
| 4 | `facilitate` | "say something specific about how you're helping" |
| 5 | `deliver` | "use 'make', 'create', 'provide' or a more specific term" |
| 6 | `robust` | "use 'well thought out' or 'comprehensive'" |
| 7 | `streamline` | "use 'simplify' or 'remove unnecessary administration'" |
| 8 | `transform` | "describe what you're doing to change the thing" |
| 9 | `foster` | "use 'encourage' or 'help'" |
| 10 | `drive` (metafora) | "use 'create', 'cause' or 'encourage' instead (you can only drive vehicles, not schemes or people)" |
| 11 | `key` | "usually not needed but can use 'important' or 'significant'" |
| 12 | `impact` | "use 'have an effect on' or 'influence'" |
| 13 | `initiate` | "use 'start' or 'begin'" |
| 14 | `progress` | "use 'work on' or 'develop' or 'make progress'" |
| 15 | `promote` | "use 'recommend' or 'support'" |
| 16 | `collaborate` | "use 'work with'" |
| 17 | `combat` | "use 'solve', 'fix' or something more specific" |
| 18 | `tackle` | "use 'stop', 'solve' or 'deal with'" |
| 19 | `going/moving forward` | "use 'from now on' or 'in the future'" |
| 20 | `slim down` | "use 'make smaller' or 'reduce the size'" |

Ditambah aturan payung dari halaman yang sama:

> "Avoid using metaphors - they do not say what you actually mean and lead to slower comprehension of
> your content."

### 4b. Wikipedia "Signs of AI writing" — kosakata per generasi model

Sumber: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (2026-10-21). Halaman ini
mendaftar kata yang frekuensinya melonjak di teks LLM, **per era model** — jadi daftar lama sudah basi:

| Era | Kata yang menandai |
|---|---|
| 2023 – pertengahan 2024 (GPT-4) | Additionally, boasts, bolstered, crucial, delve, emphasizing, enduring, garner, intricate/intricacies, interplay, key, landscape, meticulously, pivotal, underscore, tapestry, testament, valuable, vibrant |
| Pertengahan 2024 – pertengahan 2025 (GPT-4o) | align with, bolstered, crucial, emphasizing, enhance, enduring, fostering, highlighting, pivotal, showcasing, underscore, vibrant |
| Pertengahan 2025 – pertengahan 2026 (GPT-5) | emphasizing, enhance, highlighting, showcasing |
| Pertengahan 2026 ke atas (GPT-6) | challenge, clearer, dependable, echoed, foster, leverage, matters, multifaceted, practical, prioritize, quietly, steady, universally |

Halaman itu juga menulis peringatan yang relevan: *"the signal is **density, not any single hit**"* —
satu "unlock" bukan bukti, tiga kata bertanda dalam empat baris adalah sidik jari.

Contoh nyata yang **ditandai di artikel Wikipedia sungguhan** (bukan contoh buatan):

> "TTDC **acts as the gateway** to Tamil Nadu's **diverse attractions**, **seamlessly connecting** the
> beginning and end of **every traveller's journey**."

> "the temple **fosters a sense of connection and shared purpose**"

Dari daftar "Words to watch" di halaman yang sama: `stands/serves as`, `is a testament/reminder`,
`a crucial/pivotal/vital/significant/key role/moment`, `underscores/highlights its importance`.

### 4c. Praktisi — frasa utuh, bukan cuma kata

**Krirox, `anti-ai-slop`** — https://github.com/Krirox/anti-ai-slop-skills/blob/main/SKILL.md

> "**Banned phrases** (instant slop tell): 'Seamlessly,' 'effortlessly,' 'seamless integration';
> 'Unlock the power of,' 'unleash your potential'; 'Revolutionize,' 'transform,' 'elevate,' 'empower';
> 'In the fast-paced [anything]'; 'Whether you're a [X] or a [Y]...'; 'Take your [X] to the next level';
> 'The future of [X] is here'; Any sentence with three em-dashes; Parallel triplets: 'Faster. Smarter.
> Better.'"

> "**Replace with**: Specific numbers… Named subjects… Concrete verbs: 'imports,' 'exports,' 'splits,'
> 'merges,' 'queues' — not 'leverages,' 'facilitates,' 'enables'"

**real-simple-labs, `ai-writing-tells`** —
https://github.com/real-simple-labs/parker-brain/blob/main/creative-strategy-context/ai-writing-tells.md

> "The families: importance-inflators ('pivotal,' 'crucial,' 'testament'), texture words ('vibrant,'
> 'meticulous,' 'intricate,' 'seamless'), transformation verbs ('elevate,' 'unlock,' 'empower,'
> 'transform,' 'revolutionize'), and brochure adjectives ('renowned,' 'unparalleled,' 'groundbreaking')."
>
> "WRONG (AI): 'Unlock effortless comfort with our meticulously crafted denim.'
> RIGHT: 'These are the first jeans I haven't thought about all day.'"

**Wikipedia user essay, AI Slop Detection (mengutip Simon Hoiberg)** —
https://en.wikipedia.org/wiki/User:Guy_Macon/AI_Slop_Detection

> "V-09 Seamless and robust — Seamless, robust, cutting-edge, state-of-the-art, best-in-class,
> world-class. Bad: 'a seamless, robust solution.' Better: 'it syncs in under a second and hasn't gone
> down this year.'"
>
> "V-08 Elevate and enhance — Elevate, enhance, empower, supercharge, unlock, amplify. Bad: 'Elevate your
> content strategy.' Better: Name the result: 'Post three times a week without writing on weekends.'"

**Code Wave, "How to spot an AI-generated website"** —
https://code-wave.co.za/blog/how-to-spot-ai-generated-websites

> "Buttons | 'Get Started' and 'Learn More' on every page | 'Request a quote' or 'WhatsApp us' with a
> real next step"
>
> "The 'It is not just X, it is Y' formula: 'This is not just a website, it is a digital experience.'"

### 4d. Daftar terlarang final untuk `/login` (20 entri)

| # | Dilarang | Kenapa | Pengganti | Sumber |
|---|---|---|---|---|
| 1 | `seamless`, `seamlessly` | ditandai di artikel Wikipedia nyata; masuk banned list praktisi | sebut apa yang tidak terputus: "one link", "no forms to fill" | Wikipedia AI writing (contoh TTDC); Krirox |
| 2 | `effortless` | tekstur kosong | "one tap", atau hapus | Krirox |
| 3 | `empower` | GOV.UK resmi | `allow`, `give permission` | GOV.UK |
| 4 | `elevate` | transformation verb | sebut hasilnya | Guy Macon V-08 |
| 5 | `unlock` | transformation verb | sebut hasilnya | Guy Macon V-08; parker-brain |
| 6 | `leverage` | GOV.UK resmi | `use`, `influence` | GOV.UK |
| 7 | `utilise` | GOV.UK resmi | `use` | GOV.UK |
| 8 | `facilitate` | GOV.UK resmi | sebut caranya secara spesifik | GOV.UK |
| 9 | `streamline` | GOV.UK resmi | `simplify` | GOV.UK |
| 10 | `robust` | GOV.UK resmi | `well thought out`, `comprehensive` | GOV.UK |
| 11 | `transform` | GOV.UK resmi | deskripsikan perubahan | GOV.UK |
| 12 | `foster` | GOV.UK resmi **dan** daftar GPT-6 | `encourage`, `help` | GOV.UK; Wikipedia |
| 13 | `pivotal`, `crucial`, `key` (sebagai penguat) | importance-inflator | hapus, atau `important` kalau benar-benar penting | Wikipedia (3 era); GOV.UK |
| 14 | `delve`, `tapestry`, `testament` | kosakata GPT-4 | hapus | Wikipedia |
| 15 | `vibrant`, `meticulous`, `intricate` | texture words | hapus | parker-brain; Wikipedia |
| 16 | `showcase`, `highlight`, `emphasize` | kosakata GPT-4o/5 | `show`, atau sebut apa yang ditunjukkan | Wikipedia |
| 17 | `preferred` (mis. "your preferred slot") | nol dari 4 produk booking memakainya; menambah kata tanpa menambah info | hapus — `Select time` | Cal.com `"Select time"` |
| 18 | `Step 1:`, `Step 2:` di dalam heading | `<ol>` sudah menomori; mengulang penanda = kata sia-sia | hapus prefix | Cal.com `"Confirm your details"`, `"Add to calendar"` |
| 19 | `Get started`, `Learn more` (sebagai label tombol) | label yang tidak menyebut aksi | sebut aksinya: `Sign in with Google`, `Register here` | VA.gov ("Not this: Get started"); Code Wave |
| 20 | `experience` (sebagai objek: "booking experience") | membungkus fakta jadi abstraksi | sebut faktanya | Krirox ("empty claims"); Mailchimp ("hyperbolic language, upsells, and over-promises") |

Pelengkap: **em dash** di dalam string UI. Wikipedia mencatat "much more period and comma usage" sebagai
penanda era GPT-6, dan Krirox menambahkan "Any sentence with three em-dashes". Aturan di sini: **nol em
dash di string UI** — pakai titik. (Komentar kode di repo ini penuh em dash; itu di luar cakupan, karena
bukan teks yang dibaca pengguna.)

---

## 5. Tabel keputusan per elemen

Kolom "Sumber" menunjuk ke bagian 1–4 di dokumen ini, yang masing-masing memuat URL.

### 5a. Kamus `lang.ts` — 19 key

| key | Teks Indonesia (kutipan apa adanya) | Usulan Inggris | Alasan | Sumber |
|---|---|---|---|---|
| `heroTitle` | `Booking fotografer matsuri, tanpa ribet.` | `Matsuri photo bookings, without hassle.` | Dua frasa, satu fakta konkret ("matsuri photo bookings") + satu ketiadaan konkret. Pola dua kalimat pendek ini sama dengan Pixieset `"Designed for photographers. Built to help you grow."` [override Deny 2026-10-21 — versi riset memakai frasa "back-and-forth"] | §3a Pixieset; §4a (hindari metafora) |
| `heroLede` | `Klien memilih jam lewat satu tautan. Fotografer mengelola event, hari, dan slot dari satu panel.` | `Clients pick a time from one link. You manage events, days, and slots from one panel.` | Dua kalimat deklaratif, subjek–verba–objek. Kalimat kedua jadi orang kedua ("You") karena pembacanya fotografer. "one link" / "one panel" mempertahankan paralelisme ID tanpa jadi triplet slogan | §4a (aktif, "you"); §3a Cal.com (pendek) |
| `loginEyebrow` | `Masuk` | `Sign in` | Eyebrow = label, bukan kalimat. `Sign in` dua kata, sentence case. `Log in` ditolak GOV.UK | §1d GOV.UK sign-in-or-log-in |
| `loginTitle` | `Masuk dengan akun Google` | `Sign in with your Google account` | "your" menegaskan akun milik pembaca, dan membedakan heading ini dari label tombol di bawahnya (yang tidak boleh diberi "your" karena itu string resmi Google) | §1a; §4a ("you") |
| `loginLede` | `Untuk fotografer dan admin. Klien tidak perlu akun.` | `For photographers and admins. Clients don't need an account.` | Dua kalimat pendek. "don't need an account" adalah fakta yang bisa diperiksa, dan menghapus pertanyaan pertama klien | §3a Cal.com (deklaratif untuk keadaan) |
| `noAccount` | `Belum punya akun?` | `No account yet?` | Tiga kata + tanda tanya. Tanda tanya boleh di body copy; larangan tanda baca Stripe hanya untuk label tombol | §3b Stripe (batasan); §2f |
| `registerLink` | `Daftar di sini` | `Register here` | Imperatif + penunjuk lokasi, mempertahankan struktur ID. Tautan inline, bukan tombol — VA.gov: "For simple navigation to lead people between pages, use links instead of buttons" | §3b VA.gov; §4d #19 |
| `previewTitle` | `Yang dilihat klien` | `What clients see` | Frasa nomina tiga kata, nol tanda baca. Sejajar dengan `Date & time` (Cal.com) dan `Need to Know` (Resy) | §2a; §2d |
| `slotAvailable` | `Tersedia` | `Available` | Satu kata. Label status tidak pakai titik | §2a (`"No available slots"`); §2f |
| `slotTaken` | `Terisi` | `Booked` | Satu kata. `Booked` dipakai domain ini (Cal.com `"Booked by"`, `"Booked (awaiting host)"`), bukan `Taken` yang ambigu | §2a |
| `previewHint` | `Contoh tampilan slot. Tanpa akun, tanpa pembayaran di muka.` | `Sample slots. No account, no payment up front.` | Kalimat pertama menyatakan ini ilustrasi (jujur: kartu di bawah bukan data). Kalimat kedua pola negasi-pendek yang lazim di produk nyata | §3b Studio Ninja (`"No credit card. No contracts."`) |
| `stepsTitle` | `Cara kerjanya` | `How it works` | Tiga kata, tanpa titik dua. Judul bagian tidak perlu mengiklankan isinya | §2a; §2b (`"Select a Date & Time"`) |
| `step1Title` | `Buat event dan slot` | `Create an event and its slots` | Imperatif {verba}+{objek}. Nol prefix "Step 1" — `<ol>` sudah menomori | §3b Stripe ("{verb} + {noun}"); §4d #18 |
| `step1Body` | `Fotografer menentukan hari, jam, dan harga tiap slot.` | `You set the days, times, and price for each slot.` | ID memakai orang ketiga ("Fotografer"); Inggris jadi orang kedua karena pembacanya fotografer itu. Verba konkret `set`, bukan `define`/`determine` | §4a ("you"); §4c (verba konkret) |
| `step2Title` | `Bagikan tautan atau QR` | `Share the link or QR code` | Imperatif. "QR" sendirian adalah singkatan internal; "QR code" adalah istilah yang dicari orang | §3b Stripe; §4a (plain English) |
| `step2Body` | `Event terbit dengan tautan publik dan kode QR siap dipasang.` | `The event goes live with a public link and a QR code ready to post.` | ID pasif ("terbit"); Inggris aktif. `post` dipilih, bukan `print` — ID hanya bilang "siap dipasang", jadi jangan menambah klaim soal cetak | §4a (aktif) |
| `step3Title` | `Klien memilih slot` | `Clients pick a slot` | Deklaratif, karena pelakunya klien, bukan pembaca. Campuran imperatif/deklaratif antar-langkah disengaja: langkah 1–2 tindakan pembaca, langkah 3 tindakan klien. Pola campuran ini ada di Cal.com (`"Confirm your details"` imperatif vs `"Your booking has been confirmed"` deklaratif) | §2a; §2f |
| `step3Body` | `Konfirmasi langsung tampil, lengkap dengan tombol tambah ke kalender.` | `The confirmation shows up right away, with an Add to calendar button.` | Nama tombolnya dikutip persis dari Cal.com (`"Add to calendar"`) supaya orang mencari tombol dengan string yang sama. "shows up right away" menggantikan "langsung tampil" tanpa kata "instant/seamless" | §2a (`add_to_calendar`) |
| `footerPayment` | `Pembayaran dilakukan langsung ke fotografer di lokasi. Tidak ada pembayaran di halaman ini.` | `You pay the photographer in person. Nothing is charged on this page.` | ID pasif ("dilakukan"); Inggris aktif + orang kedua. Ini satu-satunya pernyataan bahwa aplikasi tidak menagih, jadi harus paling tidak ambigu — "Nothing is charged on this page" menyebut subjek yang jelas | §4a (aktif, "you") |

### 5b. String di luar kamus — 13

| key (usulan nama) | Teks Indonesia (kutipan apa adanya) | Usulan Inggris | Alasan | Sumber |
|---|---|---|---|---|
| `logoAlt` | `denslab commission` | *(pertahankan)* | Sudah Inggris, dan itu nama merek. Merek tidak diterjemahkan | §1a (merek tetap); §5c |
| `brandLine` | `Photographer Commission Maker` | *(pertahankan, byte-identik)* | String merek. `lang.ts` menyatakannya sengaja tidak masuk kamus | §1a |
| `price` | `Rp150.000` (×2) | *(pertahankan)* | Mata uangnya rupiah. Jangan dikonversi jadi `$` atau `IDR 150,000` — itu mengubah fakta, bukan menerjemahkan | §4a (jangan ubah fakta) |
| `copyright` | `© denslab - Cinemichi Production` | *(pertahankan, byte-identik)* | String merek | §1a |
| `langOptionId` | `ID` | *(pertahankan)* | Kode bahasa, bukan kata | — |
| `langOptionEn` | `EN` | *(pertahankan)* | Kode bahasa, bukan kata | — |
| `langGroupLabel` | `Bahasa / Language` | *(pertahankan)* | Sudah bilingual; `aria-label` tidak boleh diterjemahkan per-bahasa karena pembaca layar perlu tahu ada dua pilihan | — |
| `googleIdle` | `Masuk dengan Google` | `Sign in with Google` | String resmi Google, nilai `data-text` default. **Bukan** `Continue with`, karena `/register` adalah halaman terpisah | §1a, §1b, §1d |
| `googleBusy` | `Mengalihkan ke Google…` | `Taking you to Google…` | Menyebut apa yang terjadi, orang kedua. `Redirecting` ditolak karena jargon; elipsis `…` dipertahankan (sudah ada di ID) | §4a (plain English, "you") |
| `googleFailed` | `Google gagal.` | `Google sign-in failed.` | ID bilang "Google gagal", padahal Google tidak gagal — sign-in-nya yang gagal. Subjek harus tepat: ini juga yang membedakan dari kegagalan lain di halaman | §2a (pesan menyebut apa yang gagal) |
| `googleFailedHint` | `Coba lagi, atau hubungi admin kalau terus gagal.` | `Try again, or contact the admin if it keeps failing.` | Imperatif + jalur eskalasi konkret. Pola sama dengan Cal.com: masalah dulu, instruksi kedua | §2a (`booking_conflict_error`) |
| `oauthFallbackMessage` | `Server auth tidak mengirim pesan.` | `The auth server sent no message.` | Ini pesan developer yang bocor ke kotak error pengguna (lihat komentar di `GoogleButton.tsx`: kode + pesan sengaja dicetak mentah). Diterjemahkan apa adanya, tapi **[PERLU KEPUTUSAN]** apakah tetap user-facing | §2a |
| `oauthPrefixes` | `code:` / `message:` | *(pertahankan, byte-identik)* | Token teknis. Kartu LOGIN-4 menetapkannya tetap di kedua bahasa | — |

**Aturan konsistensi:** `OAuthErrorNotice.tsx` mencetak blok error yang sama dengan `GoogleButton.tsx`
(`Google gagal.` + `Coba lagi, atau hubungi admin kalau terus gagal.`). Keduanya harus memakai **satu**
pasang string, bukan dua versi. Saat ini keduanya duplikat literal — sumber drift di kemudian hari.

**Catatan `slotTimes`:** `en` sudah `["10:00–10:30 WIB", "11:00–11:30 WIB"]` — 24 jam, titik dua,
`WIB` dipertahankan karena zonanya memang WIB, bukan dikonversi. Pertahankan.

---

## 6. Aturan gaya — 12 butir, tiap butir ada sitasinya

1. **Label tombol = imperatif {verba} + {objek}, sentence case, tanpa tanda baca akhir.**
   Stripe: *"Use the {verb} + {noun} formula for labels. For example, Update customer."* dan
   *"Use sentence case"* dan *"Avoid punctuation — Avoid periods, exclamation points, and question marks."*
   — https://docs.stripe.com/stripe-apps/components/button
   VA.gov: *"Make it an action."* — *"Like this: Create an account"* / *"Not this: Get started"*
   — https://dev-design.va.gov/4785/content-style-guide/button-labels

2. **Teks tombol Google hanya boleh salah satu dari tiga string resmi, dan `Sign in with Google` kalau
   daftar ada di halaman terpisah.**
   Google: *"we recommend the call-to-action text "Sign in with Google", "Sign up with Google", or
   "Continue with Google"."* — https://developers.google.com/identity/branding-guidelines
   Default `data-text` adalah `signin_with` — https://developers.google.com/identity/gsi/web/reference/html-reference
   GOV.UK: *"Use sign in rather than log in (verb) for calls-to-action where users enter their details to
   access a service."* — https://www.gov.uk/guidance/style-guide/a-to-z-of-gov-uk-style#sign-in-or-log-in

3. **Sapa pembaca dengan "you"; jangan tulis "the photographer" kalau yang dimaksud pembacanya.**
   GOV.UK: *"Address the user as 'you' where possible and avoid using gendered pronouns like 'he' and
   'she'."* — https://www.gov.uk/guidance/style-guide/a-to-z-of-gov-uk-style
   Stripe: *"Use second person — When referring to the user within a button or link, always use second
   person personal pronouns."*

4. **Kalimat aktif, bukan pasif.**
   GOV.UK: *"Use the active rather than passive voice. This will help us write concise, clear content."*
   Mailchimp: *"Use active voice. Avoid passive voice."* — https://styleguide.mailchimp.com/voice-and-tone/

5. **Sentence case di semua tempat, termasuk heading.**
   GOV.UK: *"Always use sentence case, even in page titles and service names."*
   Stripe: *"Use sentence case. This applies for most cases except proper nouns and phrases."*

6. **Satu kata untuk status, kalimat lengkap hanya kalau pengguna harus bertindak.**
   Cal.com: `"No available slots"`, `"All booked."`, `"Add to calendar"` (pendek) vs
   `"This slot is no longer available. Please return to the previous page and select another time."`
   (panjang, karena ada tindakan) — https://raw.githubusercontent.com/calcom/cal.com/main/packages/i18n/locales/en/common.json

7. **Pesan error menyebut apa yang gagal, lalu apa yang harus dilakukan — dalam urutan itu.**
   Cal.com: *"This slot is no longer available. Please return to the previous page and select another
   time."* (masalah → instruksi)
   Mailchimp: *"consider the reader's state of mind… You wouldn't want to use the same tone of voice with
   someone who's scared or upset as you would with someone who's laughing."*

8. **Sebut angka dan hal spesifik, bukan kata sifat.**
   Krirox: *"Replace with: Specific numbers: 'Cuts onboarding from 6 weeks to 3 days for the 47 ops teams
   using it'"* — https://github.com/Krirox/anti-ai-slop-skills/blob/main/SKILL.md
   Guy Macon / Simon Hoiberg: *"Better: 'it syncs in under a second and hasn't gone down this year.'"* —
   https://en.wikipedia.org/wiki/User:Guy_Macon/AI_Slop_Detection

9. **String merek dan token teknis tidak diterjemahkan dan tidak diubah byte-nya.**
   Google: *"Regardless of the text, you can't change the size or color of the Google "G" logo."* — merek
   punya bentuk tetap — https://developers.google.com/identity/branding-guidelines
   GOV.UK: *"Ampersand — Use and rather than &, unless it's a department's logo image or a company's name
   as it appears"* — nama perusahaan ditulis apa adanya.

10. **Kata abstrak diganti kata kerja konkret; kalau sebuah kata ada di daftar GOV.UK, ganti dengan
    pengganti yang mereka tulis.**
    GOV.UK: *"Plain English is mandatory for all of GOV.UK so avoid using these words: … empower, use
    'allow' or 'give permission' … utilise, use 'use' … streamline, use 'simplify'"* —
    https://www.gov.uk/guidance/style-guide/a-to-z-of-gov-uk-style#words-to-avoid
    Mailchimp: *"We are plainspoken… We strip all that away and value clarity above all."*

11. **Nol em dash di string UI, nol triplet paralel, nol "not just X, but Y".**
    Wikipedia: penanda era GPT-6 termasuk *"much more period and comma usage"* —
    https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
    Krirox: *"Any sentence with three em-dashes; Parallel triplets: 'Faster. Smarter. Better.'"*
    Code Wave: *"The 'It is not just X, it is Y' formula: 'This is not just a website, it is a digital
    experience.'"* — https://code-wave.co.za/blog/how-to-spot-ai-generated-websites

12. **Anggaran kehangatan: satu kalimat hangat per layar, dan tidak pernah di label status atau error.**
    Batas atas yang masih wajar: Studio Ninja *"No credit card. No contracts. Just powerful results."*
    (tiga negasi pendek) — https://www.studioninja.co/
    Di dalam alur, register-nya datar: Cal.com `"Select time"`, `"All booked."`
    Batasnya ditentukan posisi pengguna, bukan jumlah kata manis: Mailchimp *"it's always more important to
    be clear than entertaining."*

---

## 7. Tiga contoh sebelum / sesudah

### Contoh 1 — tombol masuk

| | |
|---|---|
| ❌ Sebelum | `Enter with Google` |
| ✅ Sesudah | `Sign in with Google` |

**Kenapa berubah.** "Enter with Google" bukan aksi yang terjadi — pengguna tidak *masuk ke* Google, ia
autentikasi *dengan* akun Google lalu kembali ke aplikasi. Google hanya mensahkan tiga string dan ini
bukan salah satunya (*"we recommend the call-to-action text "Sign in with Google", "Sign up with Google",
or "Continue with Google""*). `Sign in` juga dipilih di atas `Log in` menurut GOV.UK: *"Use sign in rather
than log in (verb) for calls-to-action where users enter their details to access a service."*

### Contoh 2 — judul bagian pemilihan slot

| | |
|---|---|
| ❌ Sebelum | `Step 1: Select your preferred schedule` |
| ✅ Sesudah | `Select time` |

**Kenapa berubah.** Tiga masalah dalam lima kata: (a) `Step 1:` mengulang penanda yang sudah dibuat
`<ol>`; (b) `preferred` tidak menambah informasi — nol dari empat produk booking yang saya kutip
memakainya, Cal.com menulis `"Select time"`; (c) `schedule` ambigu (jadwal? kalender? slot?), sementara
kamus Cal.com membedakan `"Date & time"` (judul bagian) dari `"Select time"` (aksi). Stripe:
*"Use the {verb} + {noun} formula for labels."*

### Contoh 3 — hero

| | |
|---|---|
| ❌ Sebelum | `Seamless booking experience that empowers your photography business` |
| ✅ Sesudah | `Matsuri photo bookings, without hassle.` |

**Kenapa berubah.** Tiga kata terlarang dalam sebelas kata: `seamless` (ditandai di artikel Wikipedia
nyata — *"seamlessly connecting the beginning and end of every traveller's journey"*), `empower` (GOV.UK:
*"use 'allow' or 'give permission'"*), `experience` (membungkus fakta jadi abstraksi). Nol fakta yang bisa
diperiksa. Versi baru menyebut produknya (matsuri photo bookings) dan satu hal yang hilang (back-and-forth)
— keduanya bisa dibuktikan di halaman ini: satu tautan, satu panel, tanpa akun klien. Pola dua frasa
pendek ini sama dengan Pixieset: *"Designed for photographers. Built to help you grow."*

---

## 8. URL yang dikunjungi (semua diakses 2026-10-21)

**Google / OAuth**
1. https://developers.google.com/identity/branding-guidelines — *Last updated 2026-07-07*
2. https://developers.google.com/identity/gsi/web/reference/html-reference — *Last updated 2026-09-01*
3. https://developers.google.com/identity/gsi/web/guides/display-button — *Last updated 2025-05-19*
4. https://cal.com/signup
5. https://raw.githubusercontent.com/calcom/cal.com/main/packages/i18n/locales/en/common.json
6. https://vercel.com/login
7. https://calendly.com/signup
8. https://www.grammarly.com/signin
9. https://www.tumblr.com/login
10. https://miro.com/login/
11. https://ux.stackexchange.com/questions/148443/using-a-single-button-for-sign-in-and-sign-up/148458
12. https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple

**Produk booking**
13. https://cal.com/rick
14. https://calendly.com/woo-service/30min?month=2026-10&date=2026-10-22
15. https://community.calendly.com/how-do-i-40/how-do-i-check-someones-availability-to-schedule-a-meeting-4557
16. https://www.opentable.com/widget/reservation/canvas?lang=en-US&rid=1076725
17. https://www.opentable.com/ — **403 Forbidden** (Akamai, `Reference #18.8f4ddb17`), tidak dipakai
18. https://resy.com/cities/new-york-ny/venues/le-bernardin
19. https://resy.com/
20. https://www.booksy.com/
21. https://www.fresha.com/

**Produk fotografer / kreatif**
22. https://www.pixieset.com/
23. https://www.shootproof.com/features/
24. https://tave.com/
25. https://www.studioninja.co/
26. https://www.honeybook.com/features

**Panduan gaya dan kritik AI-slop**
27. https://www.gov.uk/guidance/style-guide/a-to-z-of-gov-uk-style
28. https://styleguide.mailchimp.com/voice-and-tone/
29. https://docs.stripe.com/stripe-apps/components/button
30. https://dev-design.va.gov/4785/content-style-guide/button-labels
31. https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
32. https://en.wikipedia.org/wiki/User:Guy_Macon/AI_Slop_Detection
33. https://github.com/Krirox/anti-ai-slop-skills/blob/main/SKILL.md
34. https://github.com/real-simple-labs/parker-brain/blob/main/creative-strategy-context/ai-writing-tells.md
35. https://code-wave.co.za/blog/how-to-spot-ai-generated-websites

**Gagal / tidak bisa diverifikasi**
- https://www.opentable.com/ — 403 (lihat #17)
- `docs.stripe.com/style-guide` dan `docs.stripe.com/style` — 404. Panduan Stripe yang dipakai di dokumen
  ini adalah halaman komponen Button (#29), bukan style guide umum.
- Label tombol akhir Calendly (`Schedule Event`) — **[TIDAK TERVERIFIKASI]** langsung dari halaman booking;
  hanya dari komunitas Calendly (#15).
- `www.pixieset.com/client-galleries/` — mengembalikan 404/CRAWL_NOT_FOUND; dipakai beranda (#22) dan
  `/features/client-gallery/`.

---

## 9. Yang belum diputuskan

1. **[PERLU KEPUTUSAN]** Tombol Google tidak memuat logo "G". Google: *"The button must always include the
   standard color for the Google "G"."* — risiko saat app verification, bukan risiko copy.
2. **[PERLU KEPUTUSAN]** `oauthFallbackMessage` (`Server auth tidak mengirim pesan.`) adalah pesan
   developer yang tampil ke pengguna. Diterjemahkan apa adanya di dokumen ini; kalau mau dijadikan copy
   pengguna, bentuknya harus lain.
3. **[PERLU KEPUTUSAN]** `OAuthErrorNotice.tsx` dan `GoogleButton.tsx` menduplikasi literal blok error yang
   sama. Inggrisnya harus satu pasang string; siapa yang jadi sumber tunggalnya ditentukan di kartu kode,
   bukan di sini.
