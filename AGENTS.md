VITA - AI Agent Context & Repository Guide

Dokumen ini ditujukan khusus untuk **AI Coding Assistant & Agent** (Google Antigravity, Gemini, OpenCode, Claude, Cursor, dll.) agar dapat memahami arsitektur, konvensi, dan aturan proyek **VITA** dengan cepat dan akurat.

---

1. Ringkasan Proyek

* **Nama Proyek**: VITA (*Sektor Terlupakan / Forgotten Sector*)
* **Genre**: Top-Down Survival Horror Maze Roguelite / Action.
* **Paradigma Utama**: **Web-Only (v2.0)** dengan prinsip **Zero External Asset Dependencies** (semua visual monster, efek pencahayaan, partikel, hingga audio efek digenerasi 100% secara prosedural).

---

2. Peta Berkas & Struktur Repositori

```
vita/
├── index.html          # Satu halaman web: Hub + game (div #homeView + #gameView)
├── manifest.webmanifest# Manifest PWA (installable via http)
├── sw.js               # Service worker network-first dengan cache offline fallback (http saja)
├── icon.svg            # Ikon prosedural SVG lokal
├── version.json        # Versi rilis (polling update PWA)
├── package.json        # Script Node stdlib: dev/relay/check/test/icons/bump + build:www/cap:sync/apk:debug
├── tools/              # Tooling Node tanpa dependency (serve/relay/check/gen-icons/bump)
│   ├── serve.mjs       # Dev server statis http (wajib untuk SW/PWA)
│   ├── relay.mjs       # Server relay WebSocket co-op tanpa dependency (handshake RFC 6455 + codec frame)
│   ├── check.mjs       # Cek sintaks + scope global + parity & cakupan i18n + secret scan
│   ├── check_html.cjs  # Verifikasi HTML well-formed (deteksi tag belum tertutup)
│   ├── gen-icons.mjs   # Generator ikon PWA reproducible (fs+zlib saja)
│   ├── gen-android-icons.mjs # Generator ikon launcher Android + splash gelap (memakai ulang seni gen-icons.mjs)
│   ├── build-www.mjs   # Builder dist/ — whitelist runtime eksplisit (tanpa metadata repo/TypeScript)
│   └── bump-version.mjs# Sinkron versi rilis satu perintah
├── .github/workflows/  # CI: npm run check + npm test (ci.yml) & build APK cloud (android.yml)
├── capacitor.config.json # Konfigurasi shell Capacitor (appId, webDir=dist, androidScheme=https)
├── android/            # Proyek Android Capacitor yang di-commit (ikon/splash sudah bertema)
├── Dockerfile          # Image relay minimal (node:20-alpine, hanya COPY relay, USER node)
├── .dockerignore       # Whitelist build context (hanya tools/relay.mjs)
├── render.yaml         # Render Blueprint: relay Node free-tier (auto-deploy + health check /)
├── vercel.json         # Konfigurasi deploy front-end Vercel (security headers)
├── LICENSE             # Lisensi MIT
├── css/
│   ├── tokens.css      # Design tokens industri (dimuat pertama, global :root)
│   ├── home.css        # Gaya Hub, di-scope #homeView (kecuali :root/* global)
│   └── game.css        # Gaya game & HUD, di-scope #gameView (body.hud-hidden tetap global)
├── js/
│   ├── home.js         # Logika Hub (var ember di-namespace: emberCanvas/EW/EH)
│   ├── prologue.js     # Script narasi cutscene prolog sebelum Level 1 (edit cerita di sini)
│   ├── supabase.js     # REST client Supabase (tanpa hardcoded key; config di localStorage)
│   ├── game.js         # Logika game (10.000+ baris: canvas render, BFS AI, WebAudio, sentuh)
│   └── modules/        # [Eksperimental/Roadmap] Modul TypeScript terpisah (persiapan refactoring)
├── script.md           # Naskah cerita, karakter, dan dialog (kanon narasi — jangan diubah tanpa izin)
├── supabase_schema.sql # Skema PostgreSQL, check constraint, dan kebijakan RLS
├── tests/              # Suite audit keamanan & QA web (test_web_security_qa.js: 29 modul — XSS, avatar, callsign, data lokal korup, batas level, schema Supabase, BFS anti-softlock, kecerahan Hub, aksesibilitas dialog, aksesibilitas keyboard, kelengkapan i18n, kinerja loop Hub & prefers-reduced-motion, live region status async, ketahanan loop game/anti-freeze, interaksi modal memori robot, dunia deterministik ber-seed untuk co-op online, pemisahan simulasi vs render untuk arsitektur host-authoritative, abstraksi pemain multi via players[] & host index 0, serialisasi snapshot & rekonsiliasi state, lobi co-op & transport relay WebSocket, lockup logo Hub prosedural yang diterapkan konsisten ke judul menu in-game (mulai/jeda/gugur/menang) & guard hemat gerak, kontrak protokol relay WebSocket tanpa dependency & wiring klien co-op, normalisasi alamat relay & parsing/pembentukan tautan undangan co-op, kontrak artefak deploy relay (Docker/Render) & lisensi MIT, kontrak pengemasan Android/Capacitor (bundel whitelist, ikon/splash prosedural, CI APK))
├── AGENTS.md           # [Berkas Ini] Panduan sistem & aturan khusus untuk AI Agent
└── README.md           # Dokumentasi proyek untuk pengembang & pemain
```

---

3. Arsitektur Teknis

A. Versi Web (`index.html` + `css/` + `js/`)
1. **Zero External Assets**:
   - **Visual**: Menggunakan HTML5 Canvas 2D API murni. Monster (Slime, Bat, Crawl, Ghost, Harvester, Dark Knight, Dragon, Lich, Beholder, Mimic, Final Boss, The Monolith) memiliki bentuk, tanduk, mahkota, kepakan sayap, dan partikel sendiri.
   - **Audio**: Prosedural menggunakan **WebAudio API** (`AudioContext`, `OscillatorNode`, `GainNode`). Tidak ada file `.mp3` atau `.wav` eksternal.
2. **Pathfinding & AI**:
   - Algoritma **Breadth-First Search (BFS)** pada grid labirin (`bfsPath()`).
   - Menggunakan **pre-allocated shared buffers** (`bfsPrev` dan `bfsQueue` via `ensureBfsBuffers()`) untuk mencegah alokasi memori berulang dan Garbage Collection stuttering.
   - Dilengkapi sistem *Separation Forces* (Boids repulsion) agar monster tidak bertumpuk di satu titik koordinat.
3. **State & Persistence**:
   - Tersimpan di `localStorage` dengan key `'vita_save'`:
     ```json
     {
       "volume": 70,
       "brightness": 100,
       "lang": "id",
       "difficulty": "normal",
       "quality": "hd"
     }
     ```
   - Rekor skor/waktu tersimpan di `localStorage` dengan key `'vita_high'`.
4. **Kinerja HUD (frame budget)**:
   - Semua akses elemen HUD per-frame wajib lewat `hudEl(id)` (cache referensi + validasi `isConnected`); tulisan teks lewat `setHudText()` yang meniadakan mutasi DOM bila nilainya tidak berubah.
   - Warna tier HP bar, lebar bar boss, dan fill cooldown senjata bersifat *change-detected* (dilacak via `dataset`/nilai terakhir). Jangan menulis `style`/`classList` tiap frame tanpa cek perubahan.
   - Hindari `Array.prototype.filter()/map()` yang mengalokasi array baru di jalur per-frame bila ada alternatif loop penghitung.
5. **Aksesibilitas**:
   - Semua modal non-native terdaftar pada *focus manager* (`js/home.js`, MutationObserver): otomatis mendapat `role="dialog"`, `aria-modal`, focus trap, dan pengembalian fokus saat ditutup.
   - Kontrol non-native (kartu device, blok start screen) wajib memiliki `role="button"` + `tabindex="0"` (dan `aria-pressed` bila bersifat toggle) serta dapat diaktifkan lewat **Enter/Space**.

B. Persistence Web (`localStorage`)
1. **Pengaturan**: key `'vita_save'` (volume, brightness, lang, difficulty, quality).
2. **Supabase config**: key `'vita_supabase_config'` (hanya dari input user, tanpa hardcoded secret).
3. **Rekor**: key `'vita_high'`.
4. **Override relay co-op**: key `'vita_relay_url'` (opsional, mis. `ws://192.168.1.10:8080`).

C. Co-op Online (Host-Authoritative, maks 4 pemain)
1. **Pemisahan simulasi vs render**: `stepSimulation()` memperbarui seluruh state game, lalu
   `stepLocalVisuals()`/`stepCamera()`/`updatePerfCounters()`/`renderFrame()` menangani efek
   lokal & presentasi. Host menjalankan simulasi otoritatif; klien hanya memprediksi.
2. **Dunia deterministik ber-seed**: `netSessionSeed` (dari URL) di-hash FNV-1a → `mulberry32`
   yang dipasang sementara HANYA selama `buildLevelWorld()` berjalan (`initLevel()`), sehingga
   labirin & spawn monster identik di semua peer. Single-player tak berubah (`netSessionSeed=null`).
3. **Abstraksi pemain multi**: state pemain diwadahi `players[]` (sparse), pemain lokal ditandai
   `localPlayerIndex` (host = 0). Tamu mempertahankan indeks 1..3 yang diberikan relay; slot yang
   belum terisi diisi bertahap dari snapshot host.
4. **Transport relay**: `tools/relay.mjs` — server WebSocket **tanpa dependency** (handshake
   RFC 6455 + codec frame, hanya `node:http`/`node:crypto`/`node:url`). Relay men-scope pesan per
   `roomId`, menetapkan indeks peer (host=0, tamu 1..3), dan menstempel ulang `peerIndex`/`from`
   pada setiap pesan yang diteruskan agar host dapat mengatribusikan `INPUT`/`PING`. Batas:
   `MAX_PLAYERS=4`, `MAX_MESSAGE_BYTES=256KB`, `MAX_ROOMS=500`. Jalankan dengan `npm run relay`.
5. **Protokol klien** (`js/game.js`): `JOIN` → `WELCOME` (ke tamu) + `PEER_JOIN` (ke peer lain);
   `INPUT` & `SNAPSHOT` (20 Hz) mengalir host↔tamu; `START_GAME` disiarkan host; `PEER_LEAVE`
   saat disconnect.
6. **Konfigurasi alamat & undangan**: alamat relay diketik di lobi (`#coopRelayInput`, tombol
   `applyCoopRelayInput()`), disimpan ke `localStorage['vita_relay_url']`. Presedensi:
   input → tersimpan → default `ws://localhost:8080`. Normalisasi lewat `normalizeCoopRelayUrl()`
   (trim; `http(s)://` → `ws(s)://`; validasi regex; tolak skema/karakter injeksi & panjang >256).
   Halaman `https:` menaikkan `ws://` → `wss://` (hindari mixed content). Host dapat membagikan
   tautan undangan `…/?coop=CODE&relay=…` (`buildCoopInviteLink()`), dan `parseCoopInvite()`
   memvalidasi ulang kode + relay saat dibuka (dikonsumsi sekali via `coopInviteConsumed`).
7. **Deploy relay (artefak siap pakai)**: `Dockerfile` (node:20-alpine, hanya `COPY tools/relay.mjs`,
   `USER node`, `EXPOSE 8080`), `.dockerignore` (whitelist), `render.yaml` (Render Blueprint
   free-tier, `startCommand: node tools/relay.mjs`, `healthCheckPath: /`), dan `vercel.json`
   (front-end). Relay menghormati `env.PORT`. Tanpa kredensial akun, deploy tetap harus dijalankan
   oleh pemilik repo (lihat catatan README).

D. Pengemasan Android (Capacitor, APK di CI)
1. **Shell native**: `capacitor.config.json` (`appId com.zrilxd20.vita`, `appName VITA`,
   `webDir dist`, `server.androidScheme = https`, `android.allowMixedContent = false`).
   Proyek `android/` **di-commit** (identitas + ikon/splash sudah final) agar CI hanya mengompilasi.
2. **Bundel web**: `tools/build-www.mjs` menyalin **whitelist eksplisit** ke `dist/` — daftar
   diselaraskan dengan precache `CORE` di `sw.js` + `sw.js`/`version.json`; `js/modules/*.ts`,
   `tests/`, `tools/`, `script.md`, dan metadata repo **tidak pernah** ikut.
3. **Aset ikon/splash**: `tools/gen-android-icons.mjs` **mengimpor** `Canvas`/`drawContent`/
   `makeIcon` dari `tools/gen-icons.mjs` (tanpa duplikasi encoder PNG, tanpa aset eksternal):
   ikon legacy 48dp (membulat), round 48dp, lapisan adaptive 108dp **transparan di sudut**,
   dan 11 `splash.png` berlatar `#0a0a12` (dimensi dipertahankan). `gen-icons.mjs` menulis ikon
   PWA hanya saat dijalankan langsung (`invokedDirectly` + `import.meta.url`).
4. **CI**: `.github/workflows/android.yml` — Node 22 + JDK 21 (Capacitor menetapkan
   `JavaVersion.VERSION_21`) + `npm ci` → `npm run build:www` → `npx cap sync android` →
   `gradlew assembleDebug` → artifact **`vita-debug-apk`** (`if-no-files-found: error`),
   tanpa secret. APK **tidak** dapat dibangun lokal di mesin tanpa JDK/Android SDK.
5. **Batasan APK**: origin WebView `https://localhost` → klien menaikkan semua `ws://` ke `wss://`,
   jadi relay LAN plain `ws://` **tidak** berfungsi (pakai tunnel TLS/`wss://`). Tautan undangan
   `?coop=…` tidak berguna di dalam APK (origin `https://localhost`); masukkan kode kamar manual.
6. **Dependency**: Capacitor hanya `devDependencies` (versi dipin). Tidak ada `dependencies`
   runtime — dijaga oleh TEST 27.

E. Pengemasan Desktop PC (Tauri, Windows .EXE / .MSI di CI)
1. **Shell native desktop**: `src-tauri/` (`tauri.conf.json`, `Cargo.toml`, `src/main.rs`, `build.rs`).
   Menghasilkan aplikasi mandiri Windows ultra-ringan menggunakan runtime native WebView2.
   Jendela berdimensi 1280×800 (resizable, min 800×600, center).
2. **Bundel web**: Menggunakan direktori `dist/` hasil `npm run build:www` (`distDir: "../dist"`).
3. **Aset ikon**: `tools/gen-desktop-icons.mjs` memakai ulang seni prosedural dari `tools/gen-icons.mjs`
   menghasilkan `32x32.png`, `128x128.png`, `128x128@2x.png` (256px), `icon.png` (512px), dan `icon.ico`
   tanpa dependensi eksternal (`npm run icons:desktop`).
4. **CI**: `.github/workflows/desktop.yml` — Windows runner (`windows-latest`) + Rust stable + Node 22
   → `npm ci` → `npm run build:www` → `npx @tauri-apps/cli@1.5.14 build` → mengunggah artifact
   **`vita-windows-x64`** (`vita.exe` dan installer `.msi`).
5. **Aturan Dual Platform**: Jika user menyebut "versi apk" atau "apk" tanpa menspesifikasikan mobile
   atau PC, instruksi berlaku untuk **keduanya (Mobile APK & PC/Tauri)**.

---



F. Aturan Alur Navigasi, Desain Logo Konsisten, & Pembaruan Otomatis
1. **Alur Masuk Game**: Tombol `ENTER THE LABYRINTH` di Hub (`#homeView`) **WAJIB** membawa pengguna ke Menu Layar Mulai (`#startScreen`) terlebih dahulu (`proceedToWebGame(false)`). Dilarang melompat langsung ke loop kanvas / gameplay tanpa klik tombol `PLAY NOW` di layar mulai.
2. **Lockup Logo VITA Konsisten**:
   - Seluruh menu (`#homeView`, `#startScreen`, `#pauseScreen`, `#deathScreen`, `#winScreen`) menggunakan lockup visual resmi VITA yang seragam: emblem heksagonal isometrik dengan monogram "V" dan titik inti putih, wordmark 3D ekstrusi merah, serta subtitle `FORGOTTEN SECTOR` ber-letter-spacing lebar.
3. **Kompilasi Dual-Platform Cloud**:
   - Android APK selesai dalam ~1,5 menit via GitHub Actions (`.github/workflows/android.yml`).
   - Windows Desktop Tauri membutuhkan ~3–5 menit via GitHub Actions (`.github/workflows/desktop.yml`) karena kompilasi native biner Rust.
4. **Pemberitahuan Update In-App**:
   - Seluruh rilis (Web/PC/APK) membaca versi rilis via `version.json`.
   - WebView native mengakses cloud dengan header CORS yang telah diizinkan di `vercel.json`.
   - Pengecekan manual disediakan lewat tombol `[ ↻ CEK PEMBARUAN ]` di modal Facility Settings (`checkVitaUpdateManual()`).
5. **Kontrol Sentuh Murni di HP**:
   - Pada mode sentuh HP (`touch-on`), kursor/crosshair ditiadakan, synthetic mousedown diabaikan, dan bidikan/gerakan murni dipandu oleh analog virtual joystick (`touchMove.dx, touchMove.dy`) serta tombol aksi on-screen.

4. Aturan Penting untuk AI Agent (Golden Rules)

1. **JANGAN Tambahkan Aset Gambar/Suara Eksternal**:
   - Selalu pertahankan sifat *self-contained / procedural*. Jika butuh efek visual atau suara baru, buat menggunakan Canvas rendering math atau fungsi WebAudio sintetis (`blip()`).
2. **Pertahankan Sistem Bilingual (i18n)**:
   - Kode mendukung **Bahasa Indonesia (`id`)** dan **English (`en`)**.
    - Jika menambahkan label, tombol, teks pesan, atau modal baru, wajib menyediakannya di kamus `T.id` dan `T.en` pada `js/game.js`.
3. **Jaga Efisiensi Memori di Web**:
   - Jangan membuat instansiasi array besar (`new Int16Array(...)` atau `new Array(10000)`) di dalam fungsi yang dipanggil per-frame atau per-monster. Gunakan *shared scratch buffers*.
4. **Konsistensi Pengaturan (*Difficulty*)**:
   - `difficulty` memiliki 3 tingkatan: `'easy'`, `'normal'`, `'hard'`.
   - Nilai ini memengaruhi kecepatan, HP, damage, dan jarak deteksi monster. Pastikan setiap penambahan tipe musuh baru tetap menghormati multiplier ini.

---

5. VITA - AI Project Rules (Kebijakan Wajib)

General
- Jangan menghapus fitur yang masih bekerja.
- Jangan mengubah file yang tidak berhubungan dengan task.
- Baca struktur project sebelum perubahan besar.
- Jangan menambah dependency tanpa alasan.
- Jangan menyimpan API key, password, token, atau secret di source code.
- Jangan menganggap kode aman hanya karena tidak ada error.

Backend
- Semua input dari user dianggap tidak terpercaya.
- Validasi input sebelum diproses.
- Gunakan parameterized query.
- Pisahkan API, service, model, database, dan security.
- Jangan expose data sensitif melalui response atau error message.

Security
- Periksa authentication dan authorization.
- Periksa input validation.
- Periksa injection.
- Periksa XSS/CSRF jika relevan.
- Periksa path traversal.
- Periksa secret exposure.
- Periksa dependency vulnerabilities.
- Temuan CRITICAL/HIGH wajib diperbaiki sebelum commit.

Testing
- Setelah perubahan jalankan test.
- Bug yang sudah diperbaiki harus memiliki regression test jika memungkinkan.

Git
- Jangan melakukan commit sebelum test selesai.
- Jangan menghapus history Git.

---

6. Perintah Menjalankan & Validasi

* **Uji Sintaksis & Keamanan Web**:
  ```bash
  npm run check
  npm test
  ```
  (`npm run check` menjalankan `check.mjs` — sintaks + scope global gabungan + parity & cakupan i18n + secret scan — lalu `check_html.cjs` untuk well-formedness HTML; `npm test` menjalankan `test_web_security_qa.js`: 27 modul audit QA/security/BFS/a11y/perf/determinisme/sim-render/players-abstraction/snapshot-relay/coop-lobby/relay-protocol/logo-lockup/in-game-menu-titles/relay-config-invite/deploy-license/android-packaging).

* **Menjalankan & Menguji Co-op Online (host-authoritative, maks 4 pemain)**:
  ```bash
  npm run dev     # terminal 1: game statis → http://localhost:8000
  npm run relay   # terminal 2: relay WebSocket → ws://localhost:8080 (atau -- --port <n>)
  ```
  Buka `http://localhost:8000` di 2+ tab/perangkat: host membuat kamar (dapat kode 4 karakter)
  lalu tamu memasukkan kode tersebut di tab "Gabung". Alamat relay diisi di kolom lobi
  (tersimpan ke `localStorage['vita_relay_url']`); host juga bisa membagikan tautan undangan
  `…/?coop=CODE&relay=…` yang otomatis mengisi kode. Halaman `https://` tidak boleh membuka
  `ws://` (mixed content) sehingga resolver klien menaikkannya ke `wss://`. Tanpa relay berjalan, lobi
  hanya menampilkan galat koneksi (tidak ada peer yang bisa bergabung).

* **Deploy Relay Online (`wss://`)**:
  ```bash
  docker build -t vita-relay . && docker run --rm -p 8080:8080 -e PORT=8080 vita-relay
  # atau: Render Dashboard → New → Blueprint → pilih repo (render.yaml) → Apply
  # atau: PORT=8080 node tools/relay.mjs
  ```
  Front-end statis dapat dihosting di Vercel (lihat `vercel.json`). Hasil deploy relay
  (`wss://<service>.onrender.com`) ditempel ke kolom "Alamat Relay" di lobi co-op.
  Deploy cloud butuh kredensial pemilik repo sehingga tidak dapat dijalankan otomatis oleh agent.

* **Membangun APK Android (Capacitor, tanpa toolchain lokal)**:
  ```bash
  npm run build:www   # dist/ whitelist (18 berkas runtime)
  npm run cap:sync    # salin dist/ ke android/app/src/main/assets/public
  # Opsi utama: push ke GitHub → Actions → "VITA Android APK" → Run workflow
  #   → unduh artifact "vita-debug-apk" (app-debug.apk)
  # Opsi lokal (butuh JDK 21 + Android SDK): npm run apk:debug
  ```
  `android/` di-commit sehingga CI tidak membuat ulang identitas/ikon. APK memakai origin
  `https://localhost`; relay **wajib** `wss://` (tunnel TLS), plain `ws://` LAN tidak didukung.
  Tautan undangan `?coop=…` tidak berguna di APK — masukkan kode kamar secara manual.
  Capacitor adalah `devDependencies` saja; runtime web tetap zero-dependency (dijaga TEST 27).

* **Membangun Aplikasi PC Windows (Tauri, tanpa toolchain lokal)**:
  ```bash
  npm run icons:desktop # regenerasi aset icon src-tauri/icons jika seni berubah
  npm run build:www     # dist/ whitelist runtime
  # Opsi utama: push ke GitHub → Actions → "VITA Windows Desktop (Tauri)" → Run workflow
  #   → unduh artifact "vita-windows-x64" (vita.exe & installer .msi)
  # Opsi lokal (butuh Rust stable): npx @tauri-apps/cli@1.5.14 build
  ```
  `src-tauri/` dikonfigurasi membaca langsung dari `dist/`. Runner GitHub Actions mengompilasi
  kode biner native x64 Windows dengan WebView2 runtime, menghasilkan installer `.msi` dan `.exe`
  mandiri tanpa membutuhkan compiler lokal di mesin pengembang.



