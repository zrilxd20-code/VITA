# PROPOSAL & DOKUMEN PENJELASAN KARYA LOMBA
## OTN CODING GAME COMPETITION

---

### **JUDUL KARYA:**
**VITA: Sektor Terlupakan (*The Forgotten Sector*)**  
*Top-Down Survival Horror Roguelite Multiplatform dengan Paradigma Zero External Dependencies*

* **Kategori:** Game Development / Coding Game
* **Genre:** Top-Down Survival Horror / Action Maze Roguelite
* **Target Platform:** Multiplatform (Web Browser PC/Mobile, Progressive Web App / PWA, dan Android APK)
* **Ukuran Berkas:** ~1.2 MB (Ultra-Lightweight)
* **Status Proyek:** Selesai (Chapter 1: 15 Sektor Fasilitas Bawah Tanah)

---

## 1. KONSEP DAN LATAR BELAKANG GAME

### 1.1. Latar Belakang & Masalah
Dalam perkembangan industri game modern, game berbasis mesin komersial (seperti Unity atau Unreal Engine) sering kali menghasilkan berkas berukuran sangat besar (ratusan megabita hingga gigabita) dan membutuhkan spesifikasi komputasi yang tinggi. Hal ini menciptakan hambatan akses bagi pengguna dengan perangkat berspesifikasi rendah (*low-end devices*) maupun koneksi internet terbatas.

Proyek **VITA: Sektor Terlupakan** dikembangkan untuk membuktikan bahwa pengalaman bermain game aksi horor yang mendalam, atmosferik, dan kaya fitur dapat dibangun dengan **efisiensi tingkat tinggi** menggunakan arsitektur web native mandiri.

### 1.2. Konsep Desain: *Zero External Dependencies*
Game ini dibangun dengan paradigma **Zero External Dependencies**:
1. **Visual 100% Prosedural:** Seluruh aset grafis (12 jenis monster, efek partikel darah, pendar cahaya senter, kabut horor *fog of war*, hingga amplop surat wasiat) digambar secara matematis dan prosedural melalui HTML5 Canvas 2D API tanpa mengimpor satu pun gambar `.png` atau `.jpg` eksternal.
2. **Audio 100% Sintetis:** Seluruh efek suara (langkah kaki, desing peluru, tebasan pisau, raungan monster, sirene fasilitas, hingga nada typewriter dialog) disintesis secara real-time menggunakan WebAudio API (*OscillatorNode, GainNode, BiquadFilterNode*) tanpa mengunduh berkas audio `.mp3` atau `.wav`.
3. **Efisiensi Memori & Bandwidth:** Keseluruhan aset dan logika game terkompresi hanya berukuran **1.2 MB**, dapat dimuat dalam waktu kurang dari 1 detik, serta berjalan stabil pada 60 FPS di berbagai perangkat.

### 1.3. Sinopsis Cerita (Lore Chapter 1)
Pemain terbangun sebagai **Prototype-19**, sebuah unit sibernetik berdaya tahan tinggi tanpa memori masa lalu, yang diaktifkan di kedalaman fasilitas riset biologi terlarang bernama *Sektor Terlupakan*. Fasilitas tersebut telah runtuh akibat bencana mutasi organisme *Coelum Carnis*. 

Dipandu oleh operator transmisi bernama **Alterisha**, pemain harus menyusuri 15 sektor labirin, memulihkan generator energi, dan menumbangkan entitas inti *The Monolith*. Di akhir perjalanan di samping portal evakuasi Sektor 15, terungkap sebuah surat wasiat berstempel lilin dari **Dr. Rudra**—ilmuwan pelopor yang selama ini dicari oleh Alterisha. Surat tersebut membuka tabir pengorbanan di balik pembuatan Prototype-19 dan menyajikan penutup emosional bagi perjalanan Chapter 1.

---

## 2. CARA BERMAIN DAN MEKANIK KONTROL

Game dirancang responsif dan adaptif mendeteksi perangkat input pengguna secara otomatis:

### 2.1. Kontrol Keyboard & Mouse (PC / Laptop)
* **W, A, S, D / Tombol Panah:** Menggerakkan karakter Prototype-19.
* **Kursor Mouse:** Mengarahkan bidikan senjata dan sudut senter secara presisi 360 derajat.
* **Klik Kiri / Spasi:** Menyerang atau menembakkan senjata aktif.
* **Shift Kiri:** Melakukan manuver lari cepat (*Phase Dash*) untuk menerobos kerumunan musuh.
* **Tombol Q / E:** Mengganti persenjataan taktis (Pisau Taktis, Senapan Otomatis, Peluncur Granat, Bazooka, Minigun).
* **Tombol E:** Berinteraksi dengan terminal reaktivasi generator, kotak memori robot, dan amplop wasiat.
* **Tombol ESC:** Membuka menu jeda (*Pause Menu*) dan arsip dokumen fasilitas.

### 2.2. Kontrol Layar Sentuh (Mobile Smartphone / Tablet)
* **Virtual Joystick Analog Kiri:** Mengarahkan pergerakan karakter dengan sensitivitas adaptif.
* **Virtual Joystick / Tombol Aksi Kanan:** Mengontrol bidikan senjata, tembakan, dan tombol manuver *Dash*.
* **Editor Tata Letak Kustom (*Custom Touch Layout*):** Pemain di smartphone dapat memindahkan letak seluruh tombol virtual di layar sesuai kenyamanan tangan masing-masing.

---

## 3. FITUR-FITUR UNGGULAN

1. **15 Sektor Labirin Prosedural dengan Algoritma BFS:**
   Setiap sektor labirin dibangun dengan konektivitas terjamin bebas jalan buntu (*anti-softlock*) melalui validasi Breadth-First Search (BFS).
2. **Ekosistem 12 Predator Anomali Unik:**
   Setiap monster memiliki tingkah laku (AI) khusus: *Amoeboid Slime* (kerumunan lambat), *Carnis Hound* (penyerang cepat), *Shadow Lurker* (berkamuflase di kegelapan), *Bile Spitter* (penembak asam jarak jauh), hingga *The Monolith* (Apex Boss berfase ganda).
3. **Pohon Talenta Permanen (*Operative Talent Tree*):**
   Pemain dapat mengumpulkan *Inti Nanit* dari eliminasi monster untuk meningkatkan atribut secara permanen (Jalur Tempur, Jalur Ketahanan, dan Jalur Taktis).
4. **Sistem Pemilihan Kartu Roguelite (*Arsenal Augmentation*):**
   Setiap kali menyelesaikan sebuah sektor, pemain diberikan 3 pilihan kartu augmentasi acak untuk meningkatkan daya hancur senjata atau efisiensi bertahan hidup.
5. **Multiplayer Online Co-op (Hingga 4 Pemain):**
   Mendukung permainan bersama secara real-time via koneksi WebSocket ringan dengan sistem lobi kode 4-karakter, sinkronisasi input deterministik, dan mekanik penyelamatan rekan (*revive downed operative*).
6. **Dukungan Bilingual Penuh (Bahasa Indonesia & English):**
   Seluruh antarmuka, dialog narasi, kartu deskripsi talenta, dan surat wasiat tersedia secara sinkron dalam dua bahasa.

---

## 4. PROSES PEMBUATAN DAN ASPEK TEKNIS

### 4.1. Arsitektur Perangkat Lunak
* **Frontend:** Vanilla HTML5, CSS3 Modern (Custom Design Tokens), dan Modern JavaScript (ES6+). Tanpa ketergantungan library eksternal untuk menjamin portabilitas absolut.
* **Grafik Komputasi:** HTML5 Canvas 2D dengan buffer terisolasi (*double buffering logic*) dan pelacakan koordinat kamera berbasis lerp linier.
* **Sintesis Audio:** WebAudio API dengan routing bus audio kustom untuk efek reverb ruang bawah tanah dan modulasi frekuensi dinamis.
* **Konektivitas Jaringan:** Native WebSocket Client terhubung ke server relay mandiri tanpa framework pihak ketiga.

### 4.2. Pengujian Mutu & Keamanan (*Software Quality Assurance*)
Kualitas kode dijaga melalui rangkaian automated test mandiri sebanyak **30 Modul Audit Keamanan dan Fungsionalitas**, meliputi:
* Pencegahan XSS Injection dan sanitasi input.
* Audit algoritma navigasi BFS anti-softlock.
* Pengujian rekonsiliasi state multiplayer dan determinisme seed PRNG (*mulberry32*).
* Aksesibilitas navigasi keyboard (WAI-ARIA compliance) dan mode hemat gerak (*prefers-reduced-motion*).

---

## 5. KESIMPULAN

Proyek **VITA: Sektor Terlupakan** mendemonstrasikan bahwa rekayasa perangkat lunak web yang optimal mampu menghadirkan game berkualitas tinggi, berbobot narasi kuat, dan berfitur lengkap tanpa membebani perangkat keras pengguna. Karya ini siap dipublikasikan baik sebagai aplikasi web instan maupun aplikasi mobile mandiri.
