# DOKUMEN PENJELASAN KARYA
## VITA: FORGOTTEN SECTOR (SEKTOR TERLUPAKAN)
**Top-Down Survival Horror Maze Roguelite — 100% Procedural Web Engine**
*Diajukan untuk Penilaian Lomba Pengembangan Game / OTN*

---

### METADATA KARYA
- **Judul Game:** VITA: Forgotten Sector (Sektor Terlupakan)
- **Genre:** Top-Down Survival Horror / Roguelite Action
- **Software / Engine Pembuatan:** HTML5 Canvas 2D & Vanilla JavaScript (Pure Native Web Engine)
- **Audio Engine:** WebAudio API (100% Procedural Synthesizer, tanpa file MP3/WAV luar)
- **Target Platform:** Multi-Platform (Web Standalone Offline, PC Windows Desktop, Android Mobile)
- **Ukuran File Karya:** ± 1.2 MB (Zero External Assets Dependencies)
- **Link Main Game Online (Live Play):** https://vita-game-three.vercel.app/
- **Repositori Kode Sumber (GitHub):** https://github.com/zrilxd20-code/VITA

---

## BAB I — KONSEP & LATAR BELAKANG KARYA

### 1.1 Sinopsis Cerita (Lore & Skenario Fasilitas VITA)
Fasilitas Riset Bawah Tanah VITA (Biological Anomaly Research Facility) telah terbengkalai selama ratusan tahun setelah terjadinya insiden kebocoran biomassa nekrotik Spesimen CARNIS-07. Fasilitas ini membentang sepanjang 15 sektor labirin bawah tanah yang terisolasi dalam kegelapan pekat. Pemain terbangun sebagai PROTOTYPE-19, sebuah unit robot sibernetik berkasis titanium yang dirancang khusus dengan prosesor saraf stabil untuk menembus kabut beracun yang mematikan bagi manusia biasa.

Tugas Operatif bukan sekadar melarikan diri, melainkan melakukan **SECTOR REACTIVATION (Reaktivasi Sektor)**: menghidupkan kembali node-node daya utama di setiap sektor untuk membuka segel pintu dekompresi darurat (Airlock), mengungkap kebenaran di balik hilangnya para peneliti melalui rekaman Blackbox Data Log dan wasiat Dr. Rudra, hingga menghadapi entitas pengendali biomassa raksasa di pusat terdalam: **The Monolith**.

### 1.2 Filosofi Desain: Zero External Asset Dependencies
Sebagian besar game modern mengandalkan puluhan hingga ratusan megabyte aset gambar (.png/.jpg) dan rekaman suara eksternal (.mp3/.wav). VITA dibangun dengan prinsip revolusioner: **100% Procedural**:
1. **Grafis Prosedural:** Seluruh visual karakter, animasi langkah kaki, efek bayangan dinamis obor (Torch Lighting Raymarching), kepakan sayap, tanduk monster, hingga partikel ledakan digambar secara real-time via kode HTML5 Canvas 2D API.
2. **Audio Prosedural:** Seluruh efek suara (tebasan pisau, tembakan shotgun, ledakan granat, sengatan listrik, hingga atmosfer ketegangan) disintesis secara matematis menggunakan WebAudio API (osilator sinusoidal, gelombang gergaji, dan filter frekuensi).
3. **Ukuran Ultra Ringkas:** Seluruh game, termasuk 15 level labirin, 12 tipe monster anomali, sistem talenta, dan alur narasi penuh, hanya berukuran sekitar 1 MB dan dapat dimainkan secara instan tanpa loading lama.

---

## BAB II — MEKANIK UTAMA & FITUR UNGGULAN

### 2.1 Mekanik Reaktivasi Sektor (Sector Node Reactivation Puzzle)
Di setiap sektor labirin, pintu evakuasi (Airlock Exit) terkunci oleh protokol darurat. Pemain wajib mencari dan mereaktivasi seluruh Power Node yang tersebar di labirin. Node yang belum aktif memancarkan aura merah berkedip (Offline/Corrupted). Saat disentuh, pemain akan membuka Terminal Reactivation Puzzle dengan 4 jenis protokol acak:
- **Tipe A (Kalibrasi Tegangan / Voltage):** Pemain harus memilih nilai voltase cadangan yang tepat untuk menstabilkan konverter sirkuit.
- **Tipe B (Dekripsi Arsip Fasilitas):** Pertanyaan keamanan lore rahasia fasilitas VITA berdasarkan log penelitian yang ditemukan.
- **Tipe C (Urutan Sandi Frekuensi):** Pemain merekonstruksi urutan kode sandi numerik (4 digit) yang teracak.
- **Tipe D (Saklar Daya Biner):** Pemain menyelaraskan kombinasi 4 saklar biner (1 / 0) sesuai pola target sistem darurat.

*Catatan Bahaya Predator:* Teka-teki terminal dibatasi oleh timer mundur (12 detik). Jika gagal atau waktu habis, terjadi korsleting listrik yang mengurangi HP pemain dan memicu alarm yang memanggil monster terdekat.

### 2.2 AI Monster Berbasis Breadth-First Search (BFS) & Separation Boids
Monster di dalam labirin tidak bergerak secara acak. Mereka ditenagai algoritma Breadth-First Search (BFS) pada grid labirin dengan alokasi memori bersama (pre-allocated shared buffer) untuk mencegah lagging / stuttering. Sistem ini dipadukan dengan gaya tolak-menolak Boids Separation Forces sehingga kawanan monster mengepung pemain secara cerdas tanpa bertumpuk di satu koordinat.

### 2.3 Keanekaragaman 12 Spesimen Monster Anomali
Setiap monster memiliki pola serang, bentuk prosedural, kecepatan, dan kemampuan unik:
- **Amoeboid Slime:** Membelah diri menjadi unit kecil saat menerima serangan fatal.
- **Vesper Bat:** Predator lincah bersayap yang mampu bermanuver cepat di koridor sempit.
- **Phantasm Ghost:** Entitas spektral yang mampu menembus dinding labirin secara berkala.
- **Bio-Harvester (Mini-Boss Sektor 5 & 10):** Menembakkan duri asam radial berkekuatan tinggi.
- **Decoy Mimic:** Menyamar sebagai peti logistik amunisi dan menyergap pemain dari jarak dekat.
- **The Monolith (Final Boss Sektor 15):** Inti biomekanik raksasa dengan 3 fase serangan mematikan.

### 2.4 Pohon Talenta Permanen, Mode Co-op 4 Pemain & Arsenal 6 Senjata
Pemain dapat mengumpulkan Nanite Core dari monster yang dikalahkan untuk membuka peningkatan permanen pada Operative Talent Tree (peningkatan regenerasi HP, kapasitas amunisi, durasi Phase Dash, dan efisiensi sensor radar) serta memodifikasi senjata di Bengkel Senjata (Workbench) yang tersimpan persisten antar-sesi bermain. Selain mode Kampanye 15 Sektor, tersedia juga **Mode Arena Survival (Endless Horde)** dan **Operasi Co-op Online (hingga 4 Pemain)** berbasis WebSocket relay mandiri.

---

## BAB III — PANDUAN CARA BERMAIN & KONTROL

### 3.1 Alur Permainan (Core Game Loop)
1. **Penyusupan Labirin:** Masuki sektor baru dengan protokol pencahayaan bergantian (Light Protocol & Dark Protocol dengan obor dinamis).
2. **Eksplorasi & Reaktivasi:** Jelajahi lorong, temukan seluruh Power Node / Generator Sektor, dan reaktivasi untuk membuka segel pintu keluar.
3. **Pertahanan & Taktik Tempur:** Hadapi kawanan monster menggunakan 6 jenis senjata modular (Pisau Taktis, Senapan Serbu AP, Granat Bio-EMP, Bazooka Berat, Perisai Kinetik, dan Minigun Vulcan). Manfaatkan tombol Phase Dash untuk menerobos bahaya tanpa terluka.
4. **Evakuasi (Airlock Extraction):** Setelah seluruh node aktif, pintu keluar sektor terbuka dan pemain dapat berpindah ke sektor berikutnya.

### 3.2 Tata Letak Kontrol Permainan

| Aksi Permainan | Kontrol PC (Keyboard & Mouse) | Kontrol Mobile / Tablet (Layar Sentuh) |
| :--- | :--- | :--- |
| **Pergerakan Karakter** | Tombol W, A, S, D atau Tombol Panah | Virtual Analog Joystick (Sisi Kiri Layar) |
| **Arah Bidikan** | Arah Kursor Mouse (360 Derajat Bebas) | Bidikan Otomatis Cerdas (Smart Auto-Aim) |
| **Serangan / Menembak** | Klik Kiri Mouse atau Tombol Spasi | Tombol Sentuh Serang [ATTACK] |
| **Phase Dash (Menghindar)** | Tombol Shift | Tombol Sentuh [DASH] |
| **Ganti Senjata** | Tombol Angka 1–6, Q, E, atau Scroll Mouse | Tombol Sentuh [SWAP] Bar Senjata |
| **Interaksi Node / Generator** | Dekati Node / Klik Opsi Terminal | Sentuh Node / Sentuh Opsi Layar Terminal |
| **Jeda Permainan** | Tombol ESC atau P | Tombol Sentuh [PAUSE] di Sudut Kanan Atas |

---

## BAB IV — PROSES & METODOLOGI PEMBUATAN

### 4.1 Tahapan Pengembangan (Development Pipeline)
1. **Tahap 1 — Perancangan Algoritma Inti:** Perancangan generator labirin berbasis Recursive Backtracker dan Depth-First Search ber-seed PRNG (Mulberry32) untuk menjamin labirin terbuat secara deterministik dan selalu memiliki jalan keluar (bebas softlock).
2. **Tahap 2 — Canvas 2D Rendering Engine:** Pembuatan sistem kamera dinamis (Smooth Camera Following), sistem pencahayaan radial obor berbasis gradien matematika, dan rendering visual partikel darah organik.
3. **Tahap 3 — Desain Audio Prosedural:** Pemrograman modul WebAudio API murni untuk menghasilkan efek suara tembakan, desis biomassa, hingga frekuensi radio transmisi komunikasi.
4. **Tahap 4 — Desain UI/UX, Lokalisasi Dwibahasa & Aksesibilitas:** Penerapan sistem token CSS modular, dukungan dwibahasa penuh (**520 kunci terjemahan paritas 100% Indonesia & Inggris**), optimasi kontrol sentuh ganda (joystick + tombol aksi), dan kepatuhan WAI-ARIA (seluruh modal dialog memiliki role, focus trap, dan label aksesibel).
5. **Tahap 5 — QA & Pengujian Keamanan:** Pembuatan automated test suite (**32 modul uji mandiri**) untuk mengaudit pencegahan injeksi XSS, integritas save data localStorage, kestabilan loop 60 FPS, determinisme co-op, anti-softlock labirin BFS, serta simulasi headless penuh Sektor 1–15 dan mode Endless Survival bebas crash.

### 4.2 Alat & Teknologi yang Digunakan
- **Bahasa Pemrograman:** JavaScript Modern (ES6+), HTML5, CSS3 murni (Vanilla, tanpa library/framework bloated).
- **APIs Inti:** HTML5 Canvas 2D API, WebAudio API, LocalStorage Web API, Touch Events API.
- **Alat Pengujian & Build:** Node.js Standard Library (tools verifikasi sintaks, checker paritas i18n, generator bundel web).

---

## BAB V — KESIMPULAN & NILAI KEUNGGULAN KARYA
VITA: Forgotten Sector membuktikan bahwa game aksi roguelite yang mendalam, memiliki grafis atmosferik, efek pencahayaan dinamis, kecerdasan buatan monster yang kompleks, dan audio sintetis yang hidup dapat diwujudkan secara 100% mandiri (self-contained) tanpa bergantung pada aset gambar maupun rekaman suara luar.

Dengan ukuran yang ultra-ringkas (± 1.2 MB), dukungan dwibahasa penuh (Indonesia & Inggris), serta kemampuan berjalan secara mulus di berbagai perangkat (komputer desktop maupun smartphone), karya ini siap diuji dan memberikan pengalaman bermain yang menantang, mendalam, dan berkesan bagi para juri.

---

## BAB VI — PANDUAN PRESENTASI 5 MENIT & TANYA-JAWAB JURI (OTN 2026)
*Bagian ini dirancang sesuai rubrik penilaian resmi Lomba Cipta Game OTN 2026: **Aspek Teknis (20%)**, **Kreativitas & Inovasi (25%)**, **Desain & Interaktivitas (20%)**, dan **Presentasi & Tanya-Jawab (35%)**.*

### 6.1 Susunan Alur Presentasi 5 Menit (Pembagian Waktu Ideal)

| Waktu | Fokus Pembahasan | Poin Utama yang Ditunjukkan di Layar (Live Demo) | Bobot Rubrik |
| :--- | :--- | :--- | :--- |
| **Menit 0:00 – 0:45** | **Pembukaan & Konsep Inovasi** | Tampilkan Hub `#homeView`, jelaskan bahwa VITA adalah game *Survival Horror Roguelite* yang **100% Prosedural (Zero External Assets)**: tanpa file gambar `.png`/`.jpg` atau suara `.mp3` luar, sehingga berukuran hanya ±1.2 MB dan bebas 100% dari pelanggaran hak cipta aset. | **Kreativitas & Inovasi (25%)** |
| **Menit 0:45 – 1:45** | **Desain UI/UX, Dwibahasa & Kemudahan Kontrol** | Buka modal **Bestiary** (12 monster prosedural), **Talent Tree**, dan **Pengaturan** (tunjukkan pergantian bahasa instan Indonesia ↔ Inggris dengan 520 kunci terjemahan). Klik `MASUKI LABIRIN` → Layar Mulai `#startScreen` → `MAIN SEKARANG`. | **Desain & Interaktivitas (20%)** |
| **Menit 1:45 – 3:00** | **Demo Gameplay Inti & Arsitektur Teknis** | Tunjukkan **Sektor 1** (papan tutorial holografis, aktivasi generator walk-over, panah kompas pintu keluar). Lalu tekan tombol **`[~]` (Panel Admin/Jump)** untuk melompat ke **Sektor 10** (memori robot + Boss Mother Harvester) dan **Sektor 15** (surat wasiat Dr. Rudra + Final Boss *The Monolith*). | **Aspek Teknis (20%)** |
| **Menit 3:00 – 5:00** | **Tanya-Jawab Dewan Juri (Q&A)** | Jawab pertanyaan juri secara lugas mengenai cara kerja algoritma labirin, kecerdasan buatan monster (BFS), sintesis suara WebAudio, dan proses pembuatan. | **Presentasi (35%)** |

### 6.2 Kunci Jawaban Singkat untuk Pertanyaan Juri (Cheat Sheet Q&A)
1. **"Bagaimana cara membuat gambar monster dan suara tembakan tanpa file gambar atau MP3?"**
   - *Jawaban:* "Seluruh bentuk monster digambar menggunakan rumus geometri dan kurva matematika secara *real-time* (60 frame per detik) di atas **HTML5 Canvas 2D**. Sedangkan suara tembakan, langkah kaki, dan musik atmosfer dibuat menggunakan **WebAudio API** dengan menggabungkan gelombang suara (*oscillator* sinus, *sawtooth*, dan *noise filter*) langsung dari prosesor browser."
2. **"Bagaimana memastikan labirin yang diacak tidak pernah buntu (softlock)?"**
   - *Jawaban:* "Labirin dibangkitkan dengan algoritma *Recursive Backtracker* ber-seed deterministik (**Mulberry32**), lalu diverifikasi oleh algoritma pencarian jalur **Breadth-First Search (BFS)** untuk memastikan setiap generator daya dan pintu keluar selalu terhubung dari titik muncul pemain. Kami juga mengujinya secara otomatis lewat 32 modul *automated test*."
3. **"Bagaimana peran kamu dalam memanfaatkan AI selama proses pembuatan?"**
   - *Jawaban:* "Saya berperan sebagai *Game Director* dan *System Architect*: merancang konsep cerita 15 sektor, menentukan mekanik *walk-over generator*, menyeimbangkan tingkat kesulitan 12 monster, menguji setiap tombol dan alur layar dari awal sampai tamat, serta mengarahkan AI secara bertahap untuk mengimplementasikan dan memperbaiki logika kode hingga lulus seluruh 32 pengujian teknis."

