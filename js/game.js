// Safe Canvas roundRect polyfill for cross-browser & mobile webview compatibility
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
        if (!radii) radii = 0;
        let r = typeof radii === 'number' ? radii : ((Array.isArray(radii) && radii.length) ? radii[0] : 0);
        r = Math.min(Math.max(0, r), Math.abs(w) / 2, Math.abs(h) / 2);
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
    };
}

const canvas = document.getElementById('gameCanvas');
const mainCtx = canvas.getContext('2d');
let ctx = mainCtx; // konteks aktif: dialihkan ke buffer pixel saat render dunia
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

// ---- Cache elemen HUD (dipanggil tiap frame) ----
// gameLoop()/updateUI()/renderWeaponHUD() berjalan ~60x/detik; query DOM berulang
// membuang waktu. Referensi disimpan lalu divalidasi lewat isConnected, sehingga
// tetap benar walau markup HUD di-render ulang (mis. daftar slot senjata).
const _hudCache = new Map();
function hudEl(id) {
    const el = _hudCache.get(id);
    if (el && el.isConnected) return el;
    const found = document.getElementById(id) || null;
    if (found) _hudCache.set(id, found); else _hudCache.delete(id);
    return found;
}
// Tulis teks hanya saat nilainya berubah, menghindari mutasi DOM mubazir tiap frame.
function setHudText(el, value) {
    const str = String(value);
    if (el && el.textContent !== str) el.textContent = str;
}

let W, H;
// ---- Pixel-art pipeline (100% prosedural, tanpa aset eksternal) ----
// Dunia digambar ke buffer kecil lalu di-upscale tanpa smoothing,
// sehingga seluruh art vektor menjadi chunky pixel ala retro.
const PIXEL_SCALES = { smooth: 2, retro: 3, chunky: 4 }; // 2 = halus, 3 = chunky retro, 4 = ekstra kasar
let PIXEL = 3;
function applyPixelScale() {
    const q = (settings && PIXEL_SCALES[settings.quality]) ? settings.quality : 'retro';
    PIXEL = PIXEL_SCALES[q];
    sizePixelBuffer();
}
const pix = document.createElement('canvas');
const pctx = pix.getContext('2d');
let PW = 0, PH = 0;
function sizePixelBuffer() {
    PW = Math.max(1, Math.ceil(W / PIXEL));
    PH = Math.max(1, Math.ceil(H / PIXEL));
    pix.width = PW;
    pix.height = PH;
    pctx.imageSmoothingEnabled = false;
}
function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    sizePixelBuffer();
}
resize();
window.addEventListener('resize', resize);

const CELL = 32;
const LEVELS = 15;

let gameState = 'menu';
let currentLevel = 0;
let maze = [];
let mazeW, mazeH;
let player, monsters, particles, projectiles;
let keys = {};
let totalKills = 0;
let totalTime = 0;
let levelStartTime = 0;
let cameraX = 0, cameraY = 0;
function getGameZoom() {
    return (currentLevel === LEVELS - 1) ? 0.60 : 1.0;
}
let fogOfWar = [];
let visitedTiles = [];
const MAX_MINIMAP_TILES = 4096;
const exploredCells = new Int8Array(MAX_MINIMAP_TILES);
let dashCooldown = 0;
let attackCooldown = 0;
let screenShake = 0;
let hurtFlash = 0;
// Hit-stop sinematik: bekukan dunia 2-4 frame saat kill agar pukulan terasa berat.
let hitStop = 0;
// Hormati prefers-reduced-motion: goyangan layar dimatikan agar tidak memicu mual.
const REDUCE_MOTION = (typeof window.matchMedia === 'function') && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function addShake(n) {
    if (!REDUCE_MOTION && (!settings || settings.screenShake !== false)) screenShake = Math.max(screenShake, n);
}
// Status joystick sentuh (objek bersama, tanpa alokasi per-frame).
const touchMove = { active: false, id: -1, dx: 0, dy: 0 };
let levelTransition = false;
let artifacts = [];
let exitPos = null;
let wreckedRobot = null;
let coinsCollected = 0;
let floatingTexts = [];
let lockMsgCooldown = 0;
let menuDemo = true;
let mouseX = 0, mouseY = 0, mouseActive = false, mouseTime = 0, isMouseDown = false;
let traps = [];
let shockwaves = [];
let gasClouds = [];
let brassCasings = [];
let medPods = [];
let thermalTrails = [];
let playerFootstepDist = 0;
// Live Field Tutorial state (Sektor 1 non-intrusive protocol)
let tutorialActive = false;
let tutorialStep = 0;
let tutorialMoveDist = 0;
// ---- MODUL 6: PERFORMANCE & ARCHITECTURE DIAGNOSTICS (Zero-GC Pools & Culling) ----
let debugOverlayOpen = false;
let perfLastTime = performance.now();
let perfFrameCount = 0;
let perfFps = 60.0;
let perfFrameTime = 16.6;
let culledCount = 0;
let renderedCount = 0;
function toggleDebugOverlay() {
    debugOverlayOpen = !debugOverlayOpen;
}




// ---- Pengaturan & procedural audio (WebAudio) ----
const VITA_SAVE_KEY = 'vita_save';
const VITA_HIGH_KEY = 'vita_high';
const VITA_DIFFS = ['easy', 'normal', 'hard'];
const VITA_QUALS = ['smooth', 'retro', 'chunky'];
// Tabel sentral difficulty (satu sumber kebenaran — Golden Rule #4).
// speed: easy < normal < hard | stat (HP/ATK): easy < normal < hard
// detect: radius deteksi monster, hard melihat lebih jauh.
const DIFF_SPEED_MULT = { easy: 0.8, normal: 1.0, hard: 1.2 };
const DIFF_STAT_MULT = { easy: 0.75, normal: 1.0, hard: 1.3 };
const DIFF_DETECT_MULT = { easy: 0.85, normal: 1.0, hard: 1.2 };
function getDiffSpeedMult() {
    return DIFF_SPEED_MULT[settings.difficulty] ?? 1.0;
}
function getDiffStatMult() {
    return DIFF_STAT_MULT[settings.difficulty] ?? 1.0;
}
function getDiffDetectMult() {
    return DIFF_DETECT_MULT[settings.difficulty] ?? 1.0;
}

// === MODULE 3: SEKTOR ENVIRONMENTAL MODIFIERS ===
// Setiap pasangan sektor memiliki identitas mekanik unik.
// torchMult: pengali radius senter (< 1 = lebih gelap)
// detectMult: pengali deteksi monster (> 1 = lebih agresif)
// speedMult: pengali kecepatan player (< 1 = lebih lambat)
// fogTint: warna tint overlay lingkungan (RGBA)
// heartbeat: apakah efek detak jantung aktif
const SEKTOR_MODS = [
    // Sektor 1-2: Tutorial Zone — pemain belajar, koridor lebar
    { torchMult: 1.15, detectMult: 0.75, speedMult: 1.0, fogTint: null, heartbeat: false },
    { torchMult: 1.10, detectMult: 0.80, speedMult: 1.0, fogTint: null, heartbeat: false },
    // Sektor 3-4: Spore Fog — visibilitas berkurang progresif
    { torchMult: 0.85, detectMult: 1.0, speedMult: 1.0, fogTint: 'rgba(40,80,20,0.08)', heartbeat: false },
    { torchMult: 0.80, detectMult: 1.0, speedMult: 0.95, fogTint: 'rgba(40,80,20,0.12)', heartbeat: false },
    // Sektor 5-6: Harvester Nests — lantai lengket, player melambat
    { torchMult: 0.90, detectMult: 1.0, speedMult: 0.88, fogTint: 'rgba(80,15,15,0.06)', heartbeat: false },
    { torchMult: 0.85, detectMult: 1.05, speedMult: 0.85, fogTint: 'rgba(80,15,15,0.08)', heartbeat: false },
    // Sektor 7-8: Eldritch Whisper — distorsi halus, monster lebih agresif
    { torchMult: 0.82, detectMult: 1.15, speedMult: 1.0, fogTint: 'rgba(60,20,80,0.07)', heartbeat: false },
    { torchMult: 0.78, detectMult: 1.20, speedMult: 1.0, fogTint: 'rgba(60,20,80,0.10)', heartbeat: false },
    // Sektor 9-10: Apex Territory — monster sangat peka, Mother Harvester
    { torchMult: 0.75, detectMult: 1.35, speedMult: 1.0, fogTint: 'rgba(90,10,10,0.06)', heartbeat: true },
    { torchMult: 0.72, detectMult: 1.45, speedMult: 0.95, fogTint: 'rgba(90,10,10,0.09)', heartbeat: true },
    // Sektor 11-12: Deep Dark — sangat gelap, hanya mata monster yang bersinar
    { torchMult: 0.60, detectMult: 1.30, speedMult: 1.0, fogTint: 'rgba(0,0,0,0.12)', heartbeat: true },
    { torchMult: 0.55, detectMult: 1.35, speedMult: 0.92, fogTint: 'rgba(0,0,0,0.15)', heartbeat: true },
    // Sektor 13-14: Sacrificial Threshold — screen pulse merah, detak jantung kencang
    { torchMult: 0.65, detectMult: 1.40, speedMult: 0.90, fogTint: 'rgba(120,0,0,0.10)', heartbeat: true },
    { torchMult: 0.62, detectMult: 1.50, speedMult: 0.88, fogTint: 'rgba(120,0,0,0.14)', heartbeat: true },
    // Sektor 15: The Monolith Arena — full arena boss (override terpisah)
    { torchMult: 1.0, detectMult: 1.0, speedMult: 1.0, fogTint: 'rgba(140,10,0,0.05)', heartbeat: true }
];
function getSektorMod(level) {
    return SEKTOR_MODS[Math.max(0, Math.min(SEKTOR_MODS.length - 1, level))] || SEKTOR_MODS[0];
}
function sanitizeSettings(raw) {
    const s = (raw && typeof raw === 'object') ? raw : {};
    let volume = Math.round(Number(s.volume));
    if (!Number.isFinite(volume)) volume = 70;
    volume = Math.max(0, Math.min(100, volume));

    let sfxVolume = Math.round(Number(s.sfxVolume));
    if (!Number.isFinite(sfxVolume)) sfxVolume = 80;
    sfxVolume = Math.max(0, Math.min(100, sfxVolume));

    let bgmVolume = Math.round(Number(s.bgmVolume));
    if (!Number.isFinite(bgmVolume)) bgmVolume = 70;
    bgmVolume = Math.max(0, Math.min(100, bgmVolume));

    const muted = !!s.muted;

    let brightness = Math.round(Number(s.brightness));
    if (!Number.isFinite(brightness)) brightness = 100;
    brightness = Math.max(30, Math.min(180, brightness)); // selaras dengan index.html

    const difficulty = VITA_DIFFS.includes(s.difficulty) ? s.difficulty : 'normal';
    const lang0 = s.lang === 'id' ? 'id' : 'en';
    const quality = VITA_QUALS.includes(s.quality) ? s.quality : 'retro';

    const deviceMode = (s.deviceMode === 'pc' || s.deviceMode === 'mobile' || s.deviceMode === 'ask') ? s.deviceMode : 'ask';
    const autoAim = (s.autoAim !== undefined) ? !!s.autoAim : true;
    const haptic = (s.haptic !== undefined) ? !!s.haptic : true;
    const screenShake = (s.screenShake !== undefined) ? !!s.screenShake : true;
    const showMinimap = (s.showMinimap !== undefined) ? !!s.showMinimap : true;
    const showFps = (s.showFps !== undefined) ? !!s.showFps : false;

    let touchScale = Math.round(Number(s.touchScale));
    if (!Number.isFinite(touchScale)) touchScale = 100;
    touchScale = Math.max(70, Math.min(140, touchScale));

    let touchOpacity = Math.round(Number(s.touchOpacity));
    if (!Number.isFinite(touchOpacity)) touchOpacity = 85;
    touchOpacity = Math.max(30, Math.min(100, touchOpacity));

    return {
        volume, sfxVolume, bgmVolume, muted,
        brightness, difficulty, lang: lang0, quality,
        deviceMode, autoAim, haptic, screenShake, showMinimap, showFps,
        touchScale, touchOpacity
    };
}
let settings;
try {
    settings = sanitizeSettings(JSON.parse(localStorage.getItem(VITA_SAVE_KEY) || '{}'));
} catch (err) {
    settings = sanitizeSettings({});
}
persistSettings();
function persistSettings() {
  try { localStorage.setItem(VITA_SAVE_KEY, JSON.stringify(settings)); } catch (e) {}
  // Jaga salinan home.js (homeSettings) tetap sinkron: kedua panel tulis ke
  // key localStorage yang sama tapi pegang objek in-memory masing-masing.
  try {
    if (typeof homeSettings !== 'undefined' && typeof sanitizeHomeSettings === 'function') {
      homeSettings = sanitizeHomeSettings(JSON.parse(localStorage.getItem(VITA_SAVE_KEY) || '{}'));
    }
  } catch (e) {}
}
function brightnessMul() {
    const b = Number(settings.brightness);
    if (!Number.isFinite(b)) return 1;
    return Math.min(1.4, Math.max(0.2, (200 - b) / 100));
}

// ---- Bahasa (id / en) ----
let lang = (settings.lang === 'id') ? 'id' : 'en';
const T = {
    id: {
        ui_level: 'Level:', ui_mode: 'Mode:', ui_diff: 'Kesulitan:', ui_hp: 'HP:', ui_atk: 'Attack:',
        ui_monster: 'Monster:', ui_artifact: 'Artefak:', ui_exit: 'Exit:', ui_time: 'Waktu:',
        mode_light: 'TERANG', mode_dark: 'GELAP',
        exit_open: 'TERBUKA', exit_locked: 'TERKUNCI',
        ctrl_bar: 'WASD / Panah / Joystick: Gerak | SPACE / KLIK: Serang | SHIFT: Dash | ESC: Jeda | M: Bisukan',
        pause_title: 'JEDA OPERASI', resume: 'LANJUT', restart: 'ULANGI DARI AWAL', main_menu: 'MENU UTAMA',
        start_subtitle: 'Sektor Terlupakan — 15 Sektor Roguelite', play_now: 'MAIN SEKARANG',
        settings: 'PENGATURAN', how_to_play: 'CARA MAIN',
        volume: 'Volume', brightness: 'Kecerahan', language: 'Bahasa', close: 'Tutup',
        diff_label: 'Kesulitan', diff_easy: 'Mudah', diff_normal: 'Normal', diff_hard: 'Sulit',
        quality: 'Kualitas', quality_smooth: 'Halus', quality_retro: 'Retro', quality_chunky: 'Kasar',
        ctrl1: 'WASD / Panah: bergerak', ctrl2: 'SPACE / Klik: menyerang', ctrl3: 'SHIFT: dash kebal — tembus jebakan & serangan',
        ctrl4: 'Kumpulkan semua artefak lalu menuju pintu keluar.',
        death_title: '[ SUBJEK TERMINASI // GUGUR ]', death_level_lbl: 'Sektor tercapai:', death_kills_lbl: 'Anomali dinetralisir:',
        retry: 'DARI AWAL', retry_level: 'ULANGI LEVEL INI',
        muted_on: 'Suara mati (tekan M untuk nyalakan)', muted_off: 'Suara nyala',
        win_title: '[ SEKTOR BERSIH // FASILITAS AMAN ]', win_sub: 'Semua 15 sektor & The Monolith telah ditaklukkan!',
        win_kills_lbl: 'Total anomali dinetralisir:', win_time_lbl: 'Waktu total:',
        win_best_lbl: 'Rekor terbaik:', play_again: 'MAIN LAGI',
        win_grade_lbl: 'Peringkat:', new_best: '[ REKOR BARU TERTINGGI ]',
        announce_light: 'PROTOKOL: TERANG', announce_dark: 'PROTOKOL: GELAP',
        exit_locked_label: 'AIRLOCK TERKUNCI', need_more_artifacts: 'Butuh {n} artefak lagi',
        msg_exit_locked: 'Airlock terkunci! Cari {n} artefak lagi!',
        arrow_artifact: 'ARTEFAK', arrow_exit: 'EXIT',
        trap_hit: 'Jebakan Duri! -{n} HP', level_up: 'NAIK TINGKAT! HP+{h} ATK+{a}',
        death_time_lbl: 'Waktu bermain:', ui_bpm: 'BIOMETRIK:', death_cause_lbl: 'Penyebab Kematian:',
        death_stamp: 'SUBJEK: DIMANGSA', win_stamp: 'SEKTOR DIBERSIHKAN',
        admin_btn: 'ADMIN & PILIH SEKTOR', admin_login_title: 'LOGIN ADMIN',
        admin_login_desc: 'Masukkan kode konsol fasilitas untuk membuka akses admin.',
        admin_code_lbl: 'Kode', admin_enter: 'MASUK', admin_cancel: 'Batal',
        admin_wrong: 'Kode salah! Akses ditolak.',
        admin_panel_title: 'PANEL ADMIN // FASILITAS',
        admin_panel_desc: 'Lompat ke level / boss mana pun untuk testing.',
        admin_boss: 'UJI THE MONOLITH (LV 15)', admin_unlock: 'BUKA AIRLOCK EXIT',
        admin_god_on: 'PROTOKOL KEBAL: ON', admin_god_off: 'PROTOKOL KEBAL: OFF',
        admin_kill: 'PURGE SEMUA MONSTER', admin_logout: 'LOGOUT ADMIN',
        admin_jump_msg: 'Lompat ke Sektor ', admin_welcome: 'Konsol admin aktif.',
        admin_weapons_title: 'UJI PERSENJATAAN (ARSENAL)',
        admin_perks_title: 'UJI SKILL & PERK OPERATIF',
        admin_unlock_all_perks: 'AKTIFKAN SEMUA SKILL (MAKS)',
        admin_all_perks_msg: 'SEMUA 8 SKILL TAKTIS DIAKTIFKAN',
        admin_arsenal_modal_btn: 'ARSENAL ADMIN [~]',
        admin_weapon_equipped: 'SENJATA DIPASANG: {w}',
        admin_perk_added: 'SKILL DITAMBAHKAN: {p}',
        admin_autofill: 'ISI OTOMATIS',
        admin_modal_title: 'ARSENAL TAKTIS ADMIN',
        admin_modal_sub: 'Lompat ke sektor mana pun atau langsung uji perlengkapan tempur.',
        admin_modal_jump: 'LOMPAT KE SEKTOR / CHAPTER (1-15)',
        admin_modal_weapons: 'PERSENJATAAN',
        admin_modal_perks: 'SKILL & PERK OPERATIF',
        admin_modal_close: 'TUTUP [ESC]',
        admin_chapter_fmt: 'Sektor {n}',
        settings_reset_default: 'KEMBALIKAN PENGATURAN KE BAWAAN',
        boss_threat: 'PREDATOR PUNCAK TERDETEKSI',
        settings_sec_audio: 'SUARA & AUDIO',
        settings_master_vol: 'Volume Utama',
        settings_sfx_vol: 'Efek Suara (SFX)',
        settings_bgm_vol: 'Musik & Suasana',
        settings_mute: 'Bisukan Semua Suara',
        settings_sec_controls: 'KONTROL & TATA LETAK',
        settings_device_mode: 'Mode Perangkat',
        settings_dev_ask: 'Tanyakan Setiap Masuk',
        settings_dev_pc: 'PC / Desktop (Keyboard & Mouse)',
        settings_dev_mobile: 'HP / Tablet (Layar Sentuh)',
        settings_auto_aim: 'Bantuan Bidik Sentuh (Auto-Aim)',
        settings_haptic: 'Getaran Haptik HP (Vibration)',
        settings_touch_scale: 'Ukuran Tombol HP',
        settings_touch_opacity: 'Transparansi Tombol',
        settings_btn_edit_layout: 'Atur Letak Tombol HP',
        settings_btn_reset_layout: 'Kembalikan Tombol Bawaan',
        settings_sec_display: 'TAMPILAN & GRAFIS',
        settings_torch_bright: 'Kecerahan Obor (Torch)',
        settings_visual_style: 'Gaya Visual Pixel',
        settings_screen_shake: 'Goyangan Layar (Screen Shake)',
        settings_minimap: 'Tampilkan Radar Mini-map',
        settings_show_fps: 'Tampilkan Indikator FPS',
        settings_sec_gameplay: 'GAMEPLAY & SISTEM',
        settings_interface_lang: 'Bahasa Antarmuka',
        settings_diff_level: 'Tingkat Kesulitan',
        settings_save_close: 'SIMPAN & TUTUP',
        settings_editor_scale: 'Ukuran:',
        settings_editor_opacity: 'Transparansi:',
        settings_editor_default: 'BAWAAN',
        settings_editor_cancel: 'BATAL',
        settings_editor_save: 'SIMPAN',
        pause_settings_title: 'PENGATURAN FASILITAS',
        // Arsenal & Sistem Senjata Antar-Level
        armory_title: 'PILIH PASOKAN SENJATA BARU',
        armory_eyebrow: 'ARSENAL OPERATIF // PROTOKOL PENAHANAN ANOMALI',
        armory_sub: 'Tingkat anomali sektor meningkat. Ambil satu persenjataan taktis untuk melanjutkan misi:',
        armory_choose: 'PILIH SENJATA INI',
        armory_owned: 'SUDAH DIMILIKI',
        armory_claim: 'PASOKAN DITERIMA: {w}!',
        weapon_knife: 'Pisau Taktis',
        weapon_knife_role: 'Melee Jarak Dekat',
        weapon_knife_desc: 'Tebasan pisau bedah cepat tanpa amunisi. Mementalkan anomali dalam jarak sangat dekat.',
        weapon_rifle: 'Senapan Taktis',
        weapon_rifle_role: 'Presisi Jarak Jauh',
        weapon_rifle_desc: 'Menembakkan peluru berkecepatan tinggi lurus ke arah bidikan dengan akurasi presisi tinggi.',
        weapon_grenade: 'Granat Biologis EMP',
        weapon_grenade_role: 'Ledakan Pantul Area (AoE)',
        weapon_grenade_desc: 'Dilempar memantul di lorong dan meledak area luas setelah 1 detik atau saat terkena anomali.',
        weapon_bazooka: 'Peluncur Roket Berat',
        weapon_bazooka_role: 'Artileri Berat Anti-Brute',
        weapon_bazooka_desc: 'Meluncurkan roket berhulu ledak tinggi dengan jejak asap. Meledak dahsyat saat menabrak target/dinding.',
        weapon_shield: 'Perisai Kinetik',
        weapon_shield_role: 'Pertahanan & Pemantul',
        weapon_shield_desc: 'Mengaktifkan kubah neon pelindung kebal 2.5 detik. Memusnahkan peluru musuh dan mementalkan monster.',
        weapon_minigun: 'Vulcan Rotary Minigun',
        weapon_minigun_role: 'Hujan Peluru Beruntun',
        weapon_minigun_desc: 'Menembakkan rentetan peluru cepat beruntun tanpa jeda. Waspadai panas berlebih (overheat)!',
        spec_dmg: 'Kerusakan',
        spec_rate: 'Laju Tembak',
        spec_range: 'Jangkauan',
        spec_special: 'Sifat Khas',
        weapon_overheated: 'SENJATA OVERHEAT!',
        weapon_switch_hint: '1-5 / Q / E / Scroll: Ganti Senjata',
        skill_backstab: 'CRITICAL BACKSTAB! 2.2x',
        skill_pulse: 'KINETIC PULSE DISCHARGE!',
        skill_purge: 'THERMAL PURGE STEAM!',
        armory_choose_perk: 'PASANG AUGMENTASI INI',
        perk_claim: 'AUGMENTASI AKTIF: {p}!',
        perk_nano_name: 'Lapisan Zirah Nanit',
        perk_nano_role: 'Pertahanan & Bio-Regenerasi',
        perk_nano_desc: 'Menyematkan struktur nanit peredam impak: Max HP +50, memulihkan HP secara instan, dan mereduksi 25% kerusakan yang diterima.',
        perk_adren_name: 'Injektor Adrenalin Servo',
        perk_adren_role: 'Kelincahan & Phase Dash',
        perk_adren_desc: 'Stimulan neuromuskular sintetis: Kecepatan lari meningkat 18% dan waktu cooldown Phase Dash dipangkas separuh.',
        perk_plasma_name: 'Munisi Plasma Hyper-Charge',
        perk_plasma_role: 'Daya Rusak Taktis Global',
        perk_plasma_desc: 'Menyelimuti seluruh proyektil dan bilah senjata dengan energi plasma superpanas, mendongkrak ATK seluruh senjata +30%.',
        perk_cryo_name: 'Penyerap Panas Cryo-Vent',
        perk_cryo_role: 'Disipasi Termal & Cooldown',
        perk_cryo_desc: 'Kondensor pendingin nitrogen cair: memotong cooldown seluruh serangan 35% dan mengurangi akumulasi panas Minigun 50%.',
        // Prologue Cutscene
        prologue_skip: 'LEWATI ▸▸',
        prologue_continue: 'TEKAN TOMBOL APAPUN UNTUK MELANJUTKAN',
        prologue_classify: 'RAHASIA TERTINGGI // HANYA UNTUK PERSONEL BERWENANG',
        prologue_date: 'LOG INSIDEN — HARI KE-0 // FASILITAS VITA',
        prologue_title: 'SEKTOR TERLUPAKAN',
        // Combat Adrenaline & Anomaly Lore
        combo_double: 'ELIMINASI GANDA',
        combo_triple: 'ELIMINASI TIGA',
        combo_carnage: 'BANTAIAN // CARNAGE',
        combo_godlike: 'TAK TERBENDUNG // OVERKILL',
        lore_disc_found: 'DATA DISC DITEMUKAN',
        barrel_detonated: 'BIOHAZARD MELEDAK',
        boss_monolith_phase1: 'FASE I // INTI RUNIK',
        boss_monolith_phase2: 'FASE II // MATA KOSMIK',
        boss_monolith_phase3: 'FASE III // AMUKAN NOVA',
        obj_collect: 'KUMPULKAN ARTEFAK', obj_exit: 'MENUJU EXIT // AIRLOCK TERBUKA',
        tut_move: 'WASD / Joystick: bergerak — kumpulkan artefak berpendar',
        tut_attack: 'SPACE / Klik: serang ke arah kursor. SHIFT: dash kebal!',
        tut_exit: 'Semua artefak didapat! Cari portal EXIT hijau sekarang!',
        perk_vamp_name: 'Sifon Biomassa Nanit',
        perk_vamp_role: 'Regenerasi Darah & Combo',
        perk_vamp_desc: 'Setiap anomali yang dinetralisir memulihkan +12 HP (+20 HP saat combo multi-kill).',
        perk_rico_name: 'Matriks Defleksi Plasma',
        perk_rico_role: 'Peluru Pantul Sudut',
        perk_rico_desc: 'Peluru senjata memantul dari dinding lorong hingga 2 kali dengan lontaran percikan energi neon.',
        perk_emp_name: 'Empas Kejut Kinetik',
        perk_emp_role: 'Gelombang Kejut Dash',
        perk_emp_desc: 'Melakukan Phase Dash memancarkan gelombang kejut EMP yang mementalkan dan melumpuhkan musuh terdekat.',
        perk_therm_name: 'Saluran Api Termal',
        perk_therm_role: 'Jejak Plasma Pembakar',
        perk_therm_desc: 'Phase Dash meninggalkan jejak api plasma membakar yang melukai anomali pengejar di lorong.',
        medpod_heal: '+60 HP [RUANG NANIT MEDIS DIAKTIFKAN]',
        codex_title: 'ARSIP DOKUMEN RAHASIA',
        codex_btn: 'ARSIP RAHASIA',
        codex_empty: 'Belum ada data disc yang ditemukan. Jelajahi lorong labirin!',
        status_poisoned: 'KERACUNAN NEUROTOKSIN',
        status_burning: 'TERBAKAR',
        status_frozen: 'MEMBEKU',
        status_stunned: 'LUMPUH',
        weak_point_hit: 'TITIK LEMAH TERKENA! 2.5x',
        monolith_weak_exposed: 'INTI KOSMIK MONOLITH TERBUKA — SERANG SEKARANG',
        mimic_ambush: 'PENYAMARAN TERBONGKAR — MIMIC MENYERGAP',
        dark_knight_riposte: 'PERTAHANAN BALASAN!',
        dragon_firestorm: 'SEMBURAN API NAGA!',
        lich_summon: 'PEMANGGILAN ARWAH GELAP!',
        beholder_sweep: 'SOROTAN SINAR KOSMIK!',
        tut_step1_badge: 'PROTOKOL 01 // LOKOMOSI',
        tut_step1_msg: 'Gunakan WASD / Tombol Panah / Joystick sentuh untuk menggerakkan drone BMPT',
        tut_step1_sub: 'Kalibrasi roda & track...',
        tut_step1_done: 'SISTEM LOKOMOSI TERKALIBRASI',
        tut_step2_badge: 'PROTOKOL 02 // PENDORONG OVERDRIVE',
        tut_step2_msg: 'Tekan SHIFT / Tombol Dash untuk melesat kebal & menghindari bahaya',
        tut_step2_sub: 'Uji sistem pendorong dash...',
        tut_step2_done: 'PENDORONG OVERDRIVE AKTIF',
        tut_step3_badge: 'PROTOKOL 03 // WEAPON POD',
        tut_step3_msg: 'Klik Kiri / SPASI / Tombol Serang untuk mengaktifkan gergaji termal',
        tut_step3_sub: 'Uji modul senjata taktis...',
        tut_step3_done: 'MODUL SENJATA TERKALIBRASI',
        tut_step4_badge: 'PROTOKOL 04 // DIREKTIF MISI',
        tut_step4_msg: 'Kumpulkan semua Anomali Artefak di labirin untuk membuka pintu exit',
        tut_step4_sub: 'Anomali terdeteksi di radar minimap',
        tut_step4_done: 'DIREKTIF MISI DITERIMA',
        tut_skip: 'LEWATI [ESC]',
        device_modal_title: 'PILIH MODE KONTROL',
        device_modal_desc: 'Sebelum masuk ke dalam sektor, pilih skema kontrol yang sesuai dengan perangkat Anda:',
        device_pc_title: 'PC / DESKTOP (KEYBOARD & MOUSE)',
        device_pc_desc: 'WASD / Panah untuk bergerak, Klik Kiri / Spasi untuk menyerang, Shift untuk Dash. Layar bersih tanpa tombol virtual.',
        device_pc_rec: 'Keyboard & Mouse',
        device_mobile_title: 'HP / TABLET (LAYAR SENTUH)',
        device_mobile_desc: 'Virtual Analog Joystick di kiri & Tombol Aksi di kanan. Posisi tombol di layar bisa dipindah-pindah sesuka hati.',
        device_mobile_rec: 'Layar Sentuh',
        device_remember: 'Ingat pilihan ini (dapat diubah kapan saja di Pengaturan)',
        device_btn_enter: 'MASUK KE MISI',
        pause_edit_layout_btn: 'UBAH POSISI TOMBOL HP',
        layout_editor_title: 'ATUR LETAK TOMBOL SENTUH',
        layout_editor_hint: 'Geser tombol di layar ke posisi yang paling nyaman.',
        layout_saved_toast: 'Tata letak tombol HP disimpan.',
        layout_reset_toast: 'Tata letak tombol HP dikembalikan ke posisi default.',
        robot_continue: 'LANJUTKAN MISI ▸'
    },
    en: {
        ui_level: 'Level:', ui_mode: 'Mode:', ui_diff: 'Difficulty:', ui_hp: 'HP:', ui_atk: 'Attack:',
        ui_monster: 'Monster:', ui_artifact: 'Artifacts:', ui_exit: 'Exit:', ui_time: 'Time:',
        mode_light: 'LIGHT', mode_dark: 'DARK',
        exit_open: 'OPEN', exit_locked: 'LOCKED',
        ctrl_bar: 'WASD / Arrows / Joystick: Move | SPACE / CLICK: Attack | SHIFT: Dash | ESC: Pause | M: Mute',
        pause_title: 'OPERATION PAUSED', resume: 'RESUME', restart: 'RESTART LEVEL', main_menu: 'MAIN MENU',
        start_subtitle: 'Forgotten Sector — 15 Roguelite Sectors', play_now: 'PLAY NOW',
        settings: 'SETTINGS', how_to_play: 'HOW TO PLAY',
        volume: 'Volume', brightness: 'Brightness', language: 'Language', close: 'Close',
        diff_label: 'Difficulty', diff_easy: 'Easy', diff_normal: 'Normal', diff_hard: 'Hard',
        quality: 'Quality', quality_smooth: 'Smooth', quality_retro: 'Retro', quality_chunky: 'Chunky',
        ctrl1: 'WASD / Arrows: move', ctrl2: 'SPACE / Click: attack', ctrl3: 'SHIFT: phase dash — invincible, pass traps & hits',
        ctrl4: 'Collect all artifacts, then reach the exit portal.',
        death_title: '[ SUBJECT TERMINATED // DEAD ]', death_level_lbl: 'Sector reached:', death_kills_lbl: 'Monsters neutralized:',
        retry: 'FROM START', retry_level: 'RETRY LEVEL',
        muted_on: 'Muted (press M to unmute)', muted_off: 'Sound on',
        win_title: '[ SECTOR PURGED // FACILITY SECURE ]', win_sub: 'All 15 sectors conquered & The Monolith neutralized!',
        win_kills_lbl: 'Total monsters neutralized:', win_time_lbl: 'Total time:',
        win_best_lbl: 'Best record:', play_again: 'PLAY AGAIN',
        win_grade_lbl: 'Rank:', new_best: '[ NEW BEST RECORD ]',
        announce_light: 'PROTOCOL: LIGHT', announce_dark: 'PROTOCOL: DARK',
        exit_locked_label: 'EXIT LOCKED', need_more_artifacts: 'Need {n} more artifacts',
        msg_exit_locked: 'Airlock locked! Find {n} more artifacts!',
        arrow_artifact: 'ARTIFACT', arrow_exit: 'EXIT',
        trap_hit: 'Spike Trap! -{n} HP', level_up: 'LEVEL UP! HP+{h} ATK+{a}',
        death_time_lbl: 'Play time:', ui_bpm: 'BIOMETRIC:', death_cause_lbl: 'Cause of Death:',
        death_stamp: 'SUBJECT: TERMINATED', win_stamp: 'SECTOR PURGED',
        admin_btn: 'ADMIN & CHAPTER SELECT', admin_login_title: 'ADMIN LOGIN',
        admin_login_desc: 'Enter the facility console code to unlock admin access.',
        admin_code_lbl: 'Code', admin_enter: 'ENTER', admin_cancel: 'Cancel',
        admin_wrong: 'Wrong code! Access denied.',
        admin_panel_title: 'ADMIN PANEL // FACILITY',
        admin_panel_desc: 'Jump to any level / boss for testing.',
        admin_boss: 'TEST THE MONOLITH (LV 15)', admin_unlock: 'UNLOCK EXIT AIRLOCK',
        admin_god_on: 'INVULNERABLE: ON', admin_god_off: 'INVULNERABLE: OFF',
        admin_kill: 'PURGE ALL MONSTERS', admin_logout: 'LOGOUT ADMIN',
        admin_jump_msg: 'Jumped to Sector ', admin_welcome: 'Admin mode active.',
        admin_weapons_title: 'TEST WEAPON ARSENAL',
        admin_perks_title: 'TEST OPERATIVE PERKS & SKILLS',
        admin_unlock_all_perks: 'UNLOCK ALL SKILLS (MAX)',
        admin_all_perks_msg: 'ALL 8 TACTICAL SKILLS ACTIVATED',
        admin_arsenal_modal_btn: 'ADMIN ARSENAL [~]',
        admin_weapon_equipped: 'WEAPON EQUIPPED: {w}',
        admin_perk_added: 'SKILL ADDED: {p}',
        admin_autofill: 'AUTO-FILL',
        admin_modal_title: 'ADMIN TACTICAL ARSENAL',
        admin_modal_sub: 'Jump to any sector or field-test combat equipment directly.',
        admin_modal_jump: 'JUMP TO SECTOR / CHAPTER (1-15)',
        admin_modal_weapons: 'WEAPONS',
        admin_modal_perks: 'OPERATIVE SKILLS & PERKS',
        admin_modal_close: 'CLOSE [ESC]',
        admin_chapter_fmt: 'Sector {n}',
        settings_reset_default: 'RESET ALL SETTINGS TO DEFAULT',
        boss_threat: 'APEX PREDATOR DETECTED',
        settings_sec_audio: 'AUDIO & SOUND',
        settings_master_vol: 'Master Volume',
        settings_sfx_vol: 'Sound Effects (SFX)',
        settings_bgm_vol: 'Music & Atmosphere',
        settings_mute: 'Mute All Audio',
        settings_sec_controls: 'CONTROLS & LAYOUT',
        settings_device_mode: 'Device Mode',
        settings_dev_ask: 'Ask on Every Launch',
        settings_dev_pc: 'PC / Desktop (Keyboard & Mouse)',
        settings_dev_mobile: 'Mobile / Tablet (Touchscreen)',
        settings_auto_aim: 'Touch Aim Assist (Auto-Aim)',
        settings_haptic: 'Haptic Feedback (Vibration)',
        settings_touch_scale: 'Touch Button Size',
        settings_touch_opacity: 'Button Opacity',
        settings_btn_edit_layout: 'Customize Touch Buttons',
        settings_btn_reset_layout: 'Reset Button Layout',
        settings_sec_display: 'DISPLAY & GRAPHICS',
        settings_torch_bright: 'Torch Brightness',
        settings_visual_style: 'Pixel Visual Style',
        settings_screen_shake: 'Screen Shake',
        settings_minimap: 'Minimap Radar',
        settings_show_fps: 'Show FPS Indicator',
        settings_sec_gameplay: 'GAMEPLAY & SYSTEM',
        settings_interface_lang: 'Interface Language',
        settings_diff_level: 'Difficulty Level',
        settings_save_close: 'SAVE & CLOSE',
        settings_editor_scale: 'Size:',
        settings_editor_opacity: 'Opacity:',
        settings_editor_default: 'DEFAULT',
        settings_editor_cancel: 'CANCEL',
        settings_editor_save: 'SAVE',
        pause_settings_title: 'FACILITY SETTINGS',
        // Arsenal & Inter-Level Weapon System
        armory_title: 'SELECT NEW WEAPON SUPPLY',
        armory_eyebrow: 'OPERATIVE ARSENAL // ANOMALY CONTAINMENT PROTOCOL',
        armory_sub: 'Sector anomaly level rising. Requisition one tactical armament to proceed:',
        armory_choose: 'SELECT THIS WEAPON',
        armory_owned: 'ALREADY OWNED',
        armory_claim: 'SUPPLY ACQUIRED: {w}!',
        weapon_knife: 'Tactical Knife',
        weapon_knife_role: 'Close Melee',
        weapon_knife_desc: 'Rapid scalpel swipe requiring no ammo. Knocks back biological anomalies at very close range.',
        weapon_rifle: 'Tactical Rifle',
        weapon_rifle_role: 'Long-Range Precision',
        weapon_rifle_desc: 'Fires high-velocity rounds straight toward your crosshair with pinpoint accuracy.',
        weapon_grenade: 'Biological EMP Grenade',
        weapon_grenade_role: 'Bouncing Area Blast (AoE)',
        weapon_grenade_desc: 'Bounces off corridor walls and detonates with wide AoE blast after 1s or on direct contact.',
        weapon_bazooka: 'Heavy Rocket Launcher',
        weapon_bazooka_role: 'Anti-Brute Heavy Artillery',
        weapon_bazooka_desc: 'Launches heavy warhead rocket with smoke trail. Detonates with massive blast on target/wall impact.',
        weapon_shield: 'Kinetic Shield',
        weapon_shield_role: 'Defense & Deflection',
        weapon_shield_desc: 'Activates invulnerable neon dome for 2.5s. Destroys monster bullets and knocks back charging foes.',
        weapon_minigun: 'Vulcan Rotary Minigun',
        weapon_minigun_role: 'Rapid Bullet Storm',
        weapon_minigun_desc: 'Unleashes rapid continuous ballistic stream. Beware of weapon overheating!',
        spec_dmg: 'Damage',
        spec_rate: 'Fire Rate',
        spec_range: 'Range',
        spec_special: 'Trait',
        weapon_overheated: 'WEAPON OVERHEATED!',
        weapon_switch_hint: '1-5 / Q / E / Scroll: Switch Weapon',
        skill_backstab: 'CRITICAL BACKSTAB! 2.2x',
        skill_pulse: 'KINETIC PULSE DISCHARGE!',
        skill_purge: 'THERMAL PURGE STEAM!',
        armory_choose_perk: 'EQUIP THIS AUGMENTATION',
        perk_claim: 'AUGMENTATION ACTIVE: {p}!',
        perk_nano_name: 'Nanite Armor Plating',
        perk_nano_role: 'Defense & Bio-Regeneration',
        perk_nano_desc: 'Integrates impact-absorbing nanite fibers: +50 Max HP, instant full heal, and 25% incoming damage reduction.',
        perk_adren_name: 'Adrenaline Servo Injector',
        perk_adren_role: 'Agility & Rapid Phase Dash',
        perk_adren_desc: 'Synthetic neuromuscular stimulant: Movement speed increased by 18% and Phase Dash cooldown cut in half.',
        perk_plasma_name: 'Hyper-Charge Plasma Munitions',
        perk_plasma_role: 'Global Tactical Firepower',
        perk_plasma_desc: 'Envelops all rounds and knife blades in superheated plasma radiation, boosting all weapon ATK by +30%.',
        perk_cryo_name: 'Cryo-Vent Heat Sinks',
        perk_cryo_role: 'Thermal Dissipation & Cooldown',
        perk_cryo_desc: 'Liquid cryogenic cooling condenser: reduces all attack cooldowns by 35% and cuts Minigun heat generation by 50%.',
        // Prologue Cutscene
        prologue_skip: 'SKIP ▸▸',
        prologue_continue: 'PRESS ANY KEY TO CONTINUE',
        prologue_classify: 'TOP SECRET // AUTHORIZED PERSONNEL ONLY',
        prologue_date: 'INCIDENT LOG — DAY ZERO // VITA FACILITY',
        prologue_title: 'FORGOTTEN SECTOR',
        // Combat Adrenaline & Anomaly Lore
        combo_double: 'DOUBLE KILL',
        combo_triple: 'TRIPLE KILL',
        combo_carnage: 'CARNAGE',
        combo_godlike: 'UNSTOPPABLE // OVERKILL',
        lore_disc_found: 'DATA DISC RECOVERED',
        barrel_detonated: 'BIOHAZARD DETONATION',
        boss_monolith_phase1: 'PHASE I // RUNIC CORE',
        boss_monolith_phase2: 'PHASE II // COSMIC EYE',
        boss_monolith_phase3: 'PHASE III // BERSERK NOVA',
        obj_collect: 'COLLECT ARTIFACTS', obj_exit: 'GO TO EXIT // AIRLOCK OPEN',
        tut_move: 'WASD / Joystick: move — collect glowing artifacts',
        tut_attack: 'SPACE / Click: attack toward cursor. SHIFT: invincible dash!',
        tut_exit: 'All artifacts secured! Find the green EXIT portal now!',
        perk_vamp_name: 'Nanite Bio-Siphon',
        perk_vamp_role: 'Blood Regen & Combo',
        perk_vamp_desc: 'Every eliminated anomaly restores +12 HP (+20 HP during multi-kill combo).',
        perk_rico_name: 'Plasma Deflection Matrix',
        perk_rico_role: 'Angled Bullet Ricochet',
        perk_rico_desc: 'Weapon rounds bounce off labyrinth walls up to 2 times with neon energy sparks.',
        perk_emp_name: 'Kinetic EMP Discharge',
        perk_emp_role: 'Dash Shockwave Stun',
        perk_emp_desc: 'Performing Phase Dash discharges a radial kinetic EMP shockwave that stuns and repels nearby foes.',
        perk_therm_name: 'Thermal Exhaust Trail',
        perk_therm_role: 'Incendiary Plasma Trail',
        perk_therm_desc: 'Phase Dash leaves a scorching plasma trail that burns pursuing anomalies in corridors.',
        medpod_heal: '+60 HP [NANITE MED-CHAMBER ACTIVATED]',
        codex_title: 'CLASSIFIED ARCHIVES CODEX',
        codex_btn: 'CLASSIFIED ARCHIVES',
        codex_empty: 'No data discs recovered yet. Search the labyrinth corridors!',
        status_poisoned: 'NEUROTOXIN POISONED',
        status_burning: 'BURNING',
        status_frozen: 'FROZEN',
        status_stunned: 'STUNNED',
        weak_point_hit: 'WEAK POINT HIT! 2.5x',
        monolith_weak_exposed: 'MONOLITH CORE EXPOSED — STRIKE NOW',
        mimic_ambush: 'DISGUISE BROKEN — MIMIC AMBUSH',
        dark_knight_riposte: 'RIPOSTE COUNTER-ATTACK!',
        dragon_firestorm: 'DRAGON FIRESTORM!',
        lich_summon: 'DARK SPIRIT SUMMON!',
        beholder_sweep: 'COSMIC EYE BEAM SWEEP!',
        tut_step1_badge: 'PROTOCOL 01 // LOCOMOTION',
        tut_step1_msg: 'Use WASD / Arrow Keys / Touch Joystick to navigate the BMPT drone',
        tut_step1_sub: 'Calibrating tracks & wheels...',
        tut_step1_done: 'LOCOMOTION SYSTEM CALIBRATED',
        tut_step2_badge: 'PROTOCOL 02 // OVERDRIVE THRUSTERS',
        tut_step2_msg: 'Press SHIFT / Dash Button to surge invincibly past danger',
        tut_step2_sub: 'Testing dash thrusters...',
        tut_step2_done: 'OVERDRIVE THRUSTERS ACTIVE',
        tut_step3_badge: 'PROTOCOL 03 // WEAPON POD',
        tut_step3_msg: 'Left Click / SPACEBAR / Attack Button to strike with thermal saw',
        tut_step3_sub: 'Testing tactical weapon module...',
        tut_step3_done: 'WEAPON MODULE CALIBRATED',
        tut_step4_badge: 'PROTOCOL 04 // MISSION DIRECTIVE',
        tut_step4_msg: 'Collect all glowing Artifact Anomalies to unlock the sector exit',
        tut_step4_sub: 'Anomalies detected on minimap radar',
        tut_step4_done: 'MISSION DIRECTIVE ACKNOWLEDGED',
        tut_skip: 'SKIP [ESC]',
        device_modal_title: 'SELECT CONTROL MODE',
        device_modal_desc: 'Before entering the sector, choose the control scheme suited for your device:',
        device_pc_title: 'PC / DESKTOP (KEYBOARD & MOUSE)',
        device_pc_desc: 'WASD / Arrows to navigate, Left Click / Space to strike, Shift to Dash. Clean screen without virtual buttons.',
        device_pc_rec: 'Keyboard & Mouse',
        device_mobile_title: 'MOBILE / TABLET (TOUCHSCREEN)',
        device_mobile_desc: 'Virtual Analog Joystick on left & Action Buttons on right. Button positions can be freely customized.',
        device_mobile_rec: 'Touchscreen',
        device_remember: 'Remember this choice (can be changed anytime in Settings)',
        device_btn_enter: 'ENTER MISSION',
        pause_edit_layout_btn: 'CUSTOMIZE TOUCH BUTTONS',
        layout_editor_title: 'TOUCH BUTTON LAYOUT',
        layout_editor_hint: 'Drag the on-screen buttons to the positions you prefer.',
        layout_saved_toast: 'Mobile button layout saved.',
        layout_reset_toast: 'Mobile button layout restored to default.',
        robot_continue: 'CONTINUE MISSION ▸'
    }
};

const WEAPONS = {
    knife: {
        id: 'knife',
        code: '[MEL-01]',
        icon: '<svg viewBox="0 0 24 24"><path d="M19.14 7.25L16.75 4.86a1.996 1.996 0 0 0-2.83 0L3.29 15.5a1.996 1.996 0 0 0 0 2.83l2.39 2.39c.78.78 2.05.78 2.83 0L19.14 10.08a1.996 1.996 0 0 0 0-2.83z"/></svg>',
        nameKey: 'weapon_knife',
        roleKey: 'weapon_knife_role',
        descKey: 'weapon_knife_desc',
        cooldown: 20,
        type: 'melee',
        shortTag: 'PISAU',
        shortTagEn: 'KNIFE',
        specs: { dmg: 'Sedang (1.0x)', rate: 'Cepat (3.0/s)', range: 'Dekat (42px)', special: 'Critical Backstab 2.2x' },
        specsEn: { dmg: 'Medium (1.0x)', rate: 'Fast (3.0/s)', range: 'Close (42px)', special: 'Critical Backstab 2.2x' }
    },
    rifle: {
        id: 'rifle',
        code: '[TAC-02]',
        icon: '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm2 4h12v2H6zm-3 4h18v2H3zm5 4h8v2H8z"/></svg>',
        nameKey: 'weapon_rifle',
        roleKey: 'weapon_rifle_role',
        descKey: 'weapon_rifle_desc',
        cooldown: 24,
        type: 'ranged',
        shortTag: 'RIFLE',
        shortTagEn: 'RIFLE',
        specs: { dmg: 'Tinggi (1.4x)', rate: 'Sedang (2.5/s)', range: 'Jauh (560px)', special: 'Tembus 2 Musuh (Railgun)' },
        specsEn: { dmg: 'High (1.4x)', rate: 'Medium (2.5/s)', range: 'Long (560px)', special: '2-Target Piercing (Railgun)' }
    },
    grenade: {
        id: 'grenade',
        code: '[EXP-03]',
        icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="7"/><path d="M12 7V3m-2 0h4m-5 4h6"/></svg>',
        nameKey: 'weapon_grenade',
        roleKey: 'weapon_grenade_role',
        descKey: 'weapon_grenade_desc',
        cooldown: 75,
        type: 'throwable',
        shortTag: 'GREN',
        shortTagEn: 'GREN',
        specs: { dmg: 'Area Besar (1.75x)', rate: 'Lambat (0.8/s)', range: 'Menengah Pantul', special: 'EMP Shockwave + Gas Spora' },
        specsEn: { dmg: 'AoE Blast (1.75x)', rate: 'Slow (0.8/s)', range: 'Mid (Bounce)', special: 'EMP Wave + Toxic Gas Cloud' }
    },
    bazooka: {
        id: 'bazooka',
        code: '[HVY-04]',
        icon: '<svg viewBox="0 0 24 24"><path d="M2 10h14l4-3v10l-4-3H2v-4zm18-1l2 3-2 3V9z"/></svg>',
        nameKey: 'weapon_bazooka',
        roleKey: 'weapon_bazooka_role',
        descKey: 'weapon_bazooka_desc',
        cooldown: 115,
        type: 'heavy',
        shortTag: 'BAZK',
        shortTagEn: 'BAZK',
        specs: { dmg: 'Masif (2.6x)', rate: 'Sangat Lambat', range: 'Jarak Jauh', special: 'Ledakan Kluster 3 Arah' },
        specsEn: { dmg: 'Massive (2.6x)', rate: 'Very Slow', range: 'Long Range', special: '3-Way Cluster Detonation' }
    },
    shield: {
        id: 'shield',
        code: '[DEF-05]',
        icon: '<svg viewBox="0 0 24 24"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z"/></svg>',
        nameKey: 'weapon_shield',
        roleKey: 'weapon_shield_role',
        descKey: 'weapon_shield_desc',
        cooldown: 160,
        type: 'defense',
        shortTag: 'SHLD',
        shortTagEn: 'SHLD',
        specs: { dmg: 'Pulse Stun (0.95x)', rate: 'Durasi 2.5s', range: 'Aura Tubuh (36px)', special: 'Kinetic Pulse Discharge' },
        specsEn: { dmg: 'Pulse Stun (0.95x)', rate: '2.5s Duration', range: 'Body Aura (36px)', special: 'Kinetic Pulse Discharge' }
    },
    minigun: {
        id: 'minigun',
        code: '[ROT-06]',
        icon: '<svg viewBox="0 0 24 24"><path d="M3 13h4v4H3zm6-3h4v10H9zm6-5h4v18h-4zm5 3h1v12h-1z"/></svg>',
        nameKey: 'weapon_minigun',
        roleKey: 'weapon_minigun_role',
        descKey: 'weapon_minigun_desc',
        cooldown: 6,
        type: 'rapid',
        shortTag: 'MINI',
        shortTagEn: 'MINI',
        specs: { dmg: 'DPS Cepat (0.45x)', rate: 'Ekstrem (10/s)', range: 'Jarak Jauh', special: 'Laras Membara & Steam Vent' },
        specsEn: { dmg: 'Fast DPS (0.45x)', rate: 'Extreme (10/s)', range: 'Long Range', special: 'Glowing Barrel & Steam Vent' }
    }
};

const TACTICAL_PERKS = {
    nano_plating: {
        id: 'nano_plating',
        code: '[DEF-AUG]',
        icon: '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.41-3.03 8.54-7 9.53-3.97-.99-7-5.12-7-9.53V6.3l7-3.12z"/></svg>',
        nameKey: 'perk_nano_name',
        roleKey: 'perk_nano_role',
        descKey: 'perk_nano_desc',
        specs: { dmg: 'Armor +30%', rate: 'Instan Full Heal', range: '+50 Max HP', special: 'Reduksi Kerusakan 25%' },
        specsEn: { dmg: 'Armor +30%', rate: 'Instant Full Heal', range: '+50 Max HP', special: 'Damage Reduction 25%' }
    },
    adrenaline: {
        id: 'adrenaline',
        code: '[MOB-AUG]',
        icon: '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
        nameKey: 'perk_adren_name',
        roleKey: 'perk_adren_role',
        descKey: 'perk_adren_desc',
        specs: { dmg: 'Dash Cd -50%', rate: 'Mobilitas Tinggi', range: 'Speed +18%', special: 'Kecepatan Lari & Phase Dash Gesit' },
        specsEn: { dmg: 'Dash Cd -50%', rate: 'High Mobility', range: 'Speed +18%', special: 'Agile Run Speed & Rapid Dash' }
    },
    plasma: {
        id: 'plasma',
        code: '[OFF-AUG]',
        icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
        nameKey: 'perk_plasma_name',
        roleKey: 'perk_plasma_role',
        descKey: 'perk_plasma_desc',
        specs: { dmg: 'Global ATK +30%', rate: 'Damage +30%', range: 'Proyektil Kuat', special: 'Plasma Rupture & Amp' },
        specsEn: { dmg: 'Global ATK +30%', rate: 'Damage +30%', range: 'High Energy', special: 'Plasma Rupture & Amp' }
    },
    cryo_vent: {
        id: 'cryo_vent',
        code: '[TEC-AUG]',
        icon: '<svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z"/></svg>',
        nameKey: 'perk_cryo_name',
        roleKey: 'perk_cryo_role',
        descKey: 'perk_cryo_desc',
        specs: { dmg: 'Cooldown -35%', rate: 'Anti-Overheat', range: 'Vent Steam Blast', special: 'Sirkulasi Pendingin Cepat' },
        specsEn: { dmg: 'Cooldown -35%', rate: 'Anti-Overheat', range: 'Vent Steam Blast', special: 'Rapid Thermal Dissipation' }
    },
    vampiric: {
        id: 'vampiric',
        code: '[BIO-AUG]',
        icon: '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
        nameKey: 'perk_vamp_name',
        roleKey: 'perk_vamp_role',
        descKey: 'perk_vamp_desc',
        specs: { dmg: '+12 HP / Kill', rate: '+20 HP Combo', range: 'Sifon Biologis', special: 'Regenerasi Sel Cepat' },
        specsEn: { dmg: '+12 HP / Kill', rate: '+20 HP Combo', range: 'Bio-Siphon', special: 'Rapid Cell Regeneration' }
    },
    ricochet: {
        id: 'ricochet',
        code: '[OPT-AUG]',
        icon: '<svg viewBox="0 0 24 24"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>',
        nameKey: 'perk_rico_name',
        roleKey: 'perk_rico_role',
        descKey: 'perk_rico_desc',
        specs: { dmg: 'Pantulan Dinding', rate: '2x Defleksi', range: 'Percikan Neon', special: 'Proyektil Memantul Sudut' },
        specsEn: { dmg: 'Wall Ricochet', rate: '2x Deflection', range: 'Neon Sparks', special: 'Angled Kinetic Bounce' }
    },
    kinetic_emp: {
        id: 'kinetic_emp',
        code: '[EMP-AUG]',
        icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-7.07l-2.83 2.83M7.76 16.24l-2.83 2.83m14.14 0l-2.83-2.83M7.76 7.76L4.93 4.93"/></svg>',
        nameKey: 'perk_emp_name',
        roleKey: 'perk_emp_role',
        descKey: 'perk_emp_desc',
        specs: { dmg: 'Radius Stun 80px', rate: 'Saat Phase Dash', range: 'Gelombang Kejut', special: 'Lumpuhkan Musuh Sekitar' },
        specsEn: { dmg: '80px Stun Radius', rate: 'On Phase Dash', range: 'Shockwave Wave', special: 'Paralyze Nearby Enemies' }
    },
    thermal_trail: {
        id: 'thermal_trail',
        code: '[ENG-AUG]',
        icon: '<svg viewBox="0 0 24 24"><path d="M19.48 12.35c-1.57-4.08-7.16-4.3-5.81-10.23C8.6 3.4 5.92 7.7 7.02 12.02c.73 2.87 2.97 4.97 5.76 5.48-3.03.68-5.32 3.19-5.32 6.27 0 .41.04.81.12 1.2 2.76 1.8 6.64 1.76 9.4-.09 2.5-1.68 3.59-4.8 2.5-7.53z"/></svg>',
        nameKey: 'perk_therm_name',
        roleKey: 'perk_therm_role',
        descKey: 'perk_therm_desc',
        specs: { dmg: 'Jejak Api Membakar', rate: 'Durasi 2 Detik', range: 'Koridor Sempit', special: 'Bakar Monster Pengejar' },
        specsEn: { dmg: 'Scorching Fire Trail', rate: '2s Duration', range: 'Choke Points', special: 'Ignite Pursuing Enemies' }
    }
};
function tt(key, params) {
    let str = (T[lang] && T[lang][key]) || T.id[key] || key;
    if (params && typeof params === 'object') {
        for (const k in params) {
            str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
        }
    }
    return str;
}
function aTypeName(type) { return lang === 'en' ? (type.nameEn || type.name) : type.name; }
function setLang(value) {
    lang = value === 'en' ? 'en' : 'id';
    settings.lang = lang;
    persistSettings();
    applyLang();
    checkContinueBtn();
    const hLang = document.getElementById('homeLanguage');
    if (hLang) hLang.value = lang;
    const gLang = document.getElementById('gLanguage');
    if (gLang) gLang.value = lang;
    if (typeof player !== 'undefined' && player) updateUI();
}
function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
        const v = tt(el.getAttribute('data-i18n'));
        if (v) el.textContent = v;
    });
    document.getElementById('lblLevel').textContent = tt('ui_level');
    document.getElementById('lblMode').textContent = tt('ui_mode');
    if (document.getElementById('lblDiff')) document.getElementById('lblDiff').textContent = tt('ui_diff');
    document.getElementById('lblHp').textContent = tt('ui_hp');
    document.getElementById('lblAtk').textContent = tt('ui_atk');
    document.getElementById('lblMonster').textContent = tt('ui_monster');
    document.getElementById('lblArtifact').textContent = tt('ui_artifact');
    document.getElementById('lblExit').textContent = tt('ui_exit');
    document.getElementById('lblTime').textContent = tt('ui_time');
    document.getElementById('controlsText').textContent = tt('ctrl_bar');
    document.getElementById('pauseTitle').textContent = tt('pause_title');
    document.getElementById('pauseResume').textContent = tt('resume');
    document.getElementById('pauseRestart').textContent = tt('restart');
    document.getElementById('pauseMenu').textContent = tt('main_menu');
    document.getElementById('startSubtitle').textContent = tt('start_subtitle');
    const bStart = document.getElementById('btnStartText') || document.getElementById('btnStart');
    if (bStart) bStart.textContent = tt('play_now');
    const bSet = document.getElementById('btnSettingsText') || document.getElementById('btnSettings');
    if (bSet) bSet.textContent = tt('settings');
    document.getElementById('btnControls').textContent = tt('how_to_play');
    document.getElementById('sVol').textContent = tt('volume');
    document.getElementById('sBright').textContent = tt('brightness');
    document.getElementById('sLang').textContent = tt('language');
    const sDiff = document.getElementById('sDiff');
    if (sDiff) sDiff.textContent = tt('diff_label');
    const diffSel = document.getElementById('gDifficulty');
    if (diffSel) {
        diffSel.options[0].text = tt('diff_easy');
        diffSel.options[1].text = tt('diff_normal');
        diffSel.options[2].text = tt('diff_hard');
    }
    const sQual = document.getElementById('sQuality');
    if (sQual) sQual.textContent = tt('quality');
    const qualSel = document.getElementById('gQuality');
    if (qualSel && qualSel.options.length >= 3) {
        qualSel.options[0].text = tt('quality_smooth');
        qualSel.options[1].text = tt('quality_retro');
        qualSel.options[2].text = tt('quality_chunky');
    }
    document.getElementById('gSettingsClose').textContent = tt('close');
    document.getElementById('controlsClose').textContent = tt('close');
    document.getElementById('ctrl1').textContent = tt('ctrl1');
    document.getElementById('ctrl2').textContent = tt('ctrl2');
    document.getElementById('ctrl3').textContent = tt('ctrl3');
    document.getElementById('ctrl4').textContent = tt('ctrl4');
    document.getElementById('deathTitle').textContent = tt('death_title');
    document.getElementById('deathLevelLbl').textContent = tt('death_level_lbl');
    document.getElementById('deathKillsLbl').textContent = tt('death_kills_lbl');
    const dtl = document.getElementById('deathTimeLbl');
    if (dtl) dtl.textContent = tt('death_time_lbl');
    const lblBpm = document.getElementById('lblBpm');
    if (lblBpm) lblBpm.textContent = tt('ui_bpm');
    const dcLbl = document.getElementById('deathCauseLbl');
    if (dcLbl) dcLbl.textContent = tt('death_cause_lbl');
    const dStamp = document.getElementById('deathStamp');
    if (dStamp) dStamp.textContent = tt('death_stamp');
    const wStamp = document.getElementById('winStamp');
    if (wStamp) wStamp.textContent = tt('win_stamp');
    const btnRetryTxt = document.getElementById('btnRetryText') || document.getElementById('btnRetry');
    if (btnRetryTxt) btnRetryTxt.textContent = tt('retry');
    const btnRetryLvlTxt = document.getElementById('btnRetryLevelText') || document.getElementById('btnRetryLevel');
    if (btnRetryLvlTxt) btnRetryLvlTxt.textContent = tt('retry_level');
    document.getElementById('winTitle').textContent = tt('win_title');
    document.getElementById('winSub').textContent = tt('win_sub');
    document.getElementById('winKillsLbl').textContent = tt('win_kills_lbl');
    document.getElementById('winTimeLbl').textContent = tt('win_time_lbl');
    document.getElementById('winBestLbl').textContent = tt('win_best_lbl');
    const winGradeLbl = document.getElementById('winGradeLbl');
    if (winGradeLbl) winGradeLbl.textContent = tt('win_grade_lbl');
    const newBestBadge = document.getElementById('newBestBadge');
    if (newBestBadge) newBestBadge.textContent = tt('new_best');
    const bAgain = document.getElementById('btnAgainText') || document.getElementById('btnAgain');
    if (bAgain) bAgain.textContent = tt('play_again');
    const bAdmin = document.getElementById('btnAdminText') || document.getElementById('btnAdmin');
    if (bAdmin) bAdmin.textContent = tt('admin_btn');
    const aLT = document.getElementById('adminLoginTitle');
    if (aLT) aLT.textContent = tt('admin_login_title');
    const aLD = document.getElementById('adminLoginDescText') || document.getElementById('adminLoginDesc');
    if (aLD) aLD.textContent = tt('admin_login_desc');
    const aAF = document.getElementById('adminAutoFillBtn');
    if (aAF) aAF.textContent = tt('admin_autofill');
    const aCL = document.getElementById('adminCodeLbl');
    if (aCL) aCL.textContent = tt('admin_code_lbl');
    const aLG = document.getElementById('adminLoginGo');
    if (aLG) aLG.textContent = tt('admin_enter');
    const aLC = document.getElementById('adminLoginCancel');
    if (aLC) aLC.textContent = tt('admin_cancel');
    const aPT = document.getElementById('adminPanelTitle');
    if (aPT) aPT.textContent = tt('admin_panel_title');
    const aPD = document.getElementById('adminPanelDesc');
    if (aPD) aPD.textContent = tt('admin_panel_desc');
    const aBB = document.getElementById('adminBossBtn');
    if (aBB) aBB.textContent = tt('admin_boss');
    const aUB = document.getElementById('adminUnlockBtn');
    if (aUB) aUB.textContent = tt('admin_unlock');
    const aGB = document.getElementById('adminGodBtn');
    if (aGB) aGB.textContent = godmode ? tt('admin_god_on') : tt('admin_god_off');
    const aKB = document.getElementById('adminKillBtn');
    if (aKB) aKB.textContent = tt('admin_kill');
    const aWT = document.getElementById('adminWeaponsTitle');
    if (aWT) aWT.textContent = tt('admin_weapons_title');
    const aPK = document.getElementById('adminPerksTitle');
    if (aPK) aPK.textContent = tt('admin_perks_title');
    const aUA = document.getElementById('adminUnlockAllBtn');
    if (aUA) aUA.textContent = tt('admin_unlock_all_perks');
    const pAA = document.getElementById('pauseAdminArsenalText');
    if (pAA) pAA.textContent = tt('admin_arsenal_modal_btn');
    const aLO = document.getElementById('adminLogoutBtn');
    if (aLO) aLO.textContent = tt('admin_logout');
    const pCT = document.getElementById('pauseCustomizeTouchText');
    if (pCT) pCT.textContent = tt('pause_edit_layout_btn');
    const bThreat = document.getElementById('bossHudThreat');
    if (bThreat) bThreat.textContent = tt('boss_threat');
    const dBtn = document.getElementById('deviceBtnEnter');
    if (dBtn) dBtn.textContent = tt('device_btn_enter');
    const dMT = document.getElementById('deviceModalTitle');
    if (dMT) dMT.textContent = tt('device_modal_title');
    const dMD = document.getElementById('deviceModalDesc');
    if (dMD) dMD.textContent = tt('device_modal_desc');
    const dPT = document.getElementById('devicePcTitle');
    if (dPT) dPT.textContent = tt('device_pc_title');
    const dPR = document.getElementById('devicePcRec');
    if (dPR) dPR.textContent = tt('device_pc_rec');
    const dPD = document.getElementById('devicePcDesc');
    if (dPD) dPD.textContent = tt('device_pc_desc');
    const dMtT = document.getElementById('deviceMobileTitle');
    if (dMtT) dMtT.textContent = tt('device_mobile_title');
    const dMtR = document.getElementById('deviceMobileRec');
    if (dMtR) dMtR.textContent = tt('device_mobile_rec');
    const dMtD = document.getElementById('deviceMobileDesc');
    if (dMtD) dMtD.textContent = tt('device_mobile_desc');
    const dRem = document.getElementById('deviceRememberText');
    if (dRem) dRem.textContent = tt('device_remember');
    if (typeof updateStartScreenDevicePill === 'function') updateStartScreenDevicePill(settings.deviceMode, settings.lang);
    if (typeof updateUI === 'function' && typeof player !== 'undefined' && player) updateUI();
}

let audioCtx = null;
let masterGain = null;
function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        const v = Number(settings.volume);
        masterGain.gain.value = (settings && settings.muted) ? 0 : (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 0.7);
        masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}
function getSfxGain() {
    return (settings && settings.sfxVolume !== undefined ? settings.sfxVolume : 80) / 100;
}
function getBgmGain() {
    return (settings && settings.bgmVolume !== undefined ? settings.bgmVolume : 70) / 100;
}
function triggerHaptic(type = 'light') {
    if (settings && settings.haptic === false) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
            if (type === 'hit') navigator.vibrate([35, 45, 35]);
            else if (type === 'dash') navigator.vibrate(22);
            else if (type === 'kill') navigator.vibrate([28, 28]);
            else navigator.vibrate(15);
        } catch (_) {}
    }
}
let lastVolPreviewTime = 0;
function setMasterVolume(vol, preview = false) {
    let v = Math.round(Number(vol));
    if (!Number.isFinite(v)) return;
    settings.volume = Math.max(0, Math.min(100, v));
    try {
        const ac = ensureAudio();
        if (ac && masterGain) {
            const finalVol = (settings && settings.muted) ? 0 : (settings.volume / 100);
            masterGain.gain.setValueAtTime(finalVol, ac.currentTime);
        }
    } catch (_) {}
    const gVol = document.getElementById('gVolume');
    if (gVol && Number(gVol.value) !== settings.volume) gVol.value = settings.volume;
    const hVol = document.getElementById('homeVolume');
    if (hVol && Number(hVol.value) !== settings.volume) hVol.value = settings.volume;
    const pVol = document.getElementById('pauseVolume');
    if (pVol && Number(pVol.value) !== settings.volume) pVol.value = settings.volume;
    const gVolVal = document.getElementById('gVolumeVal');
    if (gVolVal) gVolVal.textContent = settings.volume + '%';
    const hVolVal = document.getElementById('homeVolumeVal');
    if (hVolVal) hVolVal.textContent = settings.volume + '%';
    const pVolVal = document.getElementById('pauseVolumeVal');
    if (pVolVal) pVolVal.textContent = settings.volume + '%';
    if (typeof homeSettings !== 'undefined') homeSettings.volume = settings.volume;
    persistSettings();

    if (preview && settings.volume > 0 && !settings.muted) {
        const now = Date.now();
        if (now - lastVolPreviewTime > 110) {
            lastVolPreviewTime = now;
            sCinematicUI('click');
        }
    }
}

function applyBrightness(val) {
    let b = (val !== undefined) ? Math.round(Number(val)) : Math.round(Number(settings.brightness));
    if (!Number.isFinite(b)) b = 100;
    settings.brightness = Math.max(30, Math.min(180, b));

    const factor = (settings.brightness / 100).toFixed(2);
    const canvas = document.getElementById('gameCanvas');
    if (canvas) canvas.style.filter = `brightness(${factor})`;
    const minimap = document.getElementById('minimap');
    if (minimap) minimap.style.filter = `brightness(${factor})`;
    // Ambience Hub (homeView) ikut meredup/terang lewat satu CSS custom property,
    // supaya lapisan latar tetap mempertahankan filter blur()-nya masing-masing.
    // (Dulu baris ini menargetkan id '#emberCanvas' yang tidak pernah ada.)
    const homeView = document.getElementById('homeView');
    if (homeView) homeView.style.setProperty('--hub-bright', factor);

    const gBri = document.getElementById('gBrightness');
    if (gBri && Number(gBri.value) !== settings.brightness) gBri.value = settings.brightness;
    const hBri = document.getElementById('homeBrightness');
    if (hBri && Number(hBri.value) !== settings.brightness) hBri.value = settings.brightness;
    const pBri = document.getElementById('pauseBrightness');
    if (pBri && Number(pBri.value) !== settings.brightness) pBri.value = settings.brightness;
    const gBriVal = document.getElementById('gBrightnessVal');
    if (gBriVal) gBriVal.textContent = settings.brightness + '%';
    const hBriVal = document.getElementById('homeBrightnessVal');
    if (hBriVal) hBriVal.textContent = settings.brightness + '%';
    const pBriVal = document.getElementById('pauseBrightnessVal');
    if (pBriVal) pBriVal.textContent = settings.brightness + '%';
    if (typeof homeSettings !== 'undefined') homeSettings.brightness = settings.brightness;

    persistSettings();
}
let activeSfxCount = 0;
const MAX_CONCURRENT_SFX = 12;
function blip(freq0, freq1, dur, type, vol) {
    try {
        const ac = ensureAudio();
        if (!ac) return;
        // Adaptive audio throttle: limit concurrent WebAudio nodes if CPU is dropping frames
        const maxSfx = (typeof perfFps !== 'undefined' && perfFps < 40) ? 6 : MAX_CONCURRENT_SFX;
        if (activeSfxCount >= maxSfx) return;

        const osc = ac.createOscillator();
        const g = ac.createGain();
        const filter = ac.createBiquadFilter();
        const f0 = Number(freq0), f1 = Number(freq1), d = Number(dur);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(d) || d <= 0) return;
        const vv = Number(vol);
        const baseVol = (Number.isFinite(vv) ? vv : 0.7) * getSfxGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(Math.max(1, f0), ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), ac.currentTime + d);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.min(2200, Math.max(f0, f1) * 1.6), ac.currentTime);
        g.gain.setValueAtTime(baseVol, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
        osc.connect(filter);
        filter.connect(g);
        g.connect(masterGain || ac.destination);

        activeSfxCount++;
        osc.onended = () => {
            activeSfxCount = Math.max(0, activeSfxCount - 1);
        };
        osc.start();
        osc.stop(ac.currentTime + dur);
    } catch (e) {
        activeSfxCount = Math.max(0, activeSfxCount - 1);
    }
}

// ---- ATMOSFERIK HOROR SINEMATIK: Subterranean Rumble + Desolate Conduit Wind ----
let ambientOsc1 = null, ambientOsc2 = null, ambientGain = null, ambientNoiseSrc = null, ambientFilter = null;
let ambientCreakTimer = null;

function playAmbientDrone() {
    try {
        if (gameState !== 'playing' || menuDemo) {
            stopAmbientDrone();
            return;
        }
        const ac = ensureAudio();
        if (ambientOsc1) return;
        const now = ac.currentTime;
        const master = Number(settings.volume);
        const mvol = Number.isFinite(master) ? Math.max(0, Math.min(100, master)) / 100 : 0.7;
        if (mvol <= 0.01) return;

        // 1. Sub-bass binaural tension rumble (40Hz & 42.5Hz menghasilkan getaran psikologis 2.5Hz)
        ambientOsc1 = ac.createOscillator();
        ambientOsc2 = ac.createOscillator();
        ambientGain = ac.createGain();
        const subFilter = ac.createBiquadFilter();

        ambientOsc1.type = 'sine';
        ambientOsc1.frequency.setValueAtTime(40, now);
        ambientOsc2.type = 'sine';
        ambientOsc2.frequency.setValueAtTime(42.5, now);

        subFilter.type = 'lowpass';
        subFilter.frequency.setValueAtTime(110, now);

        ambientGain.gain.setValueAtTime(0.09, now);

        ambientOsc1.connect(subFilter);
        ambientOsc2.connect(subFilter);
        subFilter.connect(ambientGain);
        ambientGain.connect(masterGain || ac.destination);

        ambientOsc1.start(now);
        ambientOsc2.start(now);

        // 2. Desah lorong dingin fasilitas terbengkalai (Cold Airflow Noise)
        try {
            const windCount = Math.floor(ac.sampleRate * 2.0);
            const windBuf = ac.createBuffer(1, windCount, ac.sampleRate);
            const windData = windBuf.getChannelData(0);
            for (let i = 0; i < windCount; i++) {
                windData[i] = (Math.random() * 2 - 1) * 0.35;
            }
            ambientNoiseSrc = ac.createBufferSource();
            ambientNoiseSrc.buffer = windBuf;
            ambientNoiseSrc.loop = true;

            ambientFilter = ac.createBiquadFilter();
            ambientFilter.type = 'bandpass';
            ambientFilter.frequency.setValueAtTime(340, now);
            ambientFilter.Q.setValueAtTime(2.5, now);

            const windGain = ac.createGain();
            windGain.gain.setValueAtTime(0.065, now);

            ambientNoiseSrc.connect(ambientFilter);
            ambientFilter.connect(windGain);
            windGain.connect(masterGain || ac.destination);
            ambientNoiseSrc.start(now);
        } catch (_) {}

        // 3. Prosedural derit logam & atmosfer lingkungan per sektor
        function scheduleNextCreak() {
            if (!ambientOsc1) return;
            const nextSec = 10 + Math.random() * 15;
            ambientCreakTimer = setTimeout(() => {
                if (ambientOsc1 && gameState === 'playing' && !menuDemo) {
                    try {
                        const lvl = (typeof currentLevel === 'number') ? currentLevel : 0;
                        if (lvl <= 3) {
                            // Sektor 0-3: Derelict Pipes - Water drip & pipe creaks
                            playProceduralWaterDrip();
                            if (Math.random() < 0.5) {
                                const creakFreq = 70 + Math.random() * 35;
                                playOccultTone(creakFreq, creakFreq * 0.6, 1.6, 0.2, 'triangle');
                            }
                        } else if (lvl <= 7) {
                            // Sektor 4-7: Harvester Biomass - Organic gurgling
                            playProceduralBioGurgle();
                        } else if (lvl <= 11) {
                            // Sektor 8-11: Industrial Reactor - Steam hiss & transformer hum
                            playProceduralSteamHiss();
                        } else if (lvl <= 14) {
                            // Sektor 12-14: Sacrificial Threshold - Distant void wails
                            playOccultTone(110 + Math.random() * 40, 55, 2.2, 0.25, 'sine');
                            playNoiseBurst(0.8, 520, 60, 3.5, 0.18, 'bandpass');
                        } else {
                            // Sektor 15: Monolith Sanctum - Subterranean infrasound rumble
                            playOccultTone(45, 28, 2.8, 0.35, 'sawtooth');
                        }
                    } catch (e) {}
                    scheduleNextCreak();
                }
            }, nextSec * 1000);
        }
        scheduleNextCreak();
    } catch (e) {}
}

function stopAmbientDrone() {
    try {
        if (ambientCreakTimer) {
            clearTimeout(ambientCreakTimer);
            ambientCreakTimer = null;
        }
        if (ambientGain && audioCtx) {
            try { ambientGain.gain.setValueAtTime(0, audioCtx.currentTime); } catch (_) {}
        }
        if (ambientOsc1) {
            try { ambientOsc1.stop(); ambientOsc1.disconnect(); } catch (_) {}
            ambientOsc1 = null;
        }
        if (ambientOsc2) {
            try { ambientOsc2.stop(); ambientOsc2.disconnect(); } catch (_) {}
            ambientOsc2 = null;
        }
        if (ambientNoiseSrc) {
            try { ambientNoiseSrc.stop(); ambientNoiseSrc.disconnect(); } catch (_) {}
            ambientNoiseSrc = null;
        }
        ambientGain = null;
        ambientFilter = null;
        stopProceduralOST();
    } catch (e) {}
}

// ---- ADAPTIVE PROCEDURAL DARK SYNTH OST ENGINE (100% WebAudio Synthesizer) ----
let ostActive = false;
let ostStep = 0;
let ostInterval = null;
let ostDroneOsc1 = null, ostDroneOsc2 = null, ostDroneGain = null;
let ostFilter = null;

function startProceduralOST() {
    try {
        if (ostActive || gameState !== 'playing' || menuDemo) return;
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        ostActive = true;
        const now = ac.currentTime;

        // Base D minor dark analog pad drone
        ostDroneOsc1 = ac.createOscillator();
        ostDroneOsc2 = ac.createOscillator();
        ostDroneGain = ac.createGain();
        ostFilter = ac.createBiquadFilter();

        ostDroneOsc1.type = 'sawtooth';
        ostDroneOsc2.type = 'triangle';
        ostDroneOsc1.frequency.setValueAtTime(55, now); // A1
        ostDroneOsc2.frequency.setValueAtTime(73.42, now); // D2

        ostFilter.type = 'lowpass';
        ostFilter.frequency.setValueAtTime(260, now);
        ostFilter.Q.setValueAtTime(3.0, now);

        const mvol = Math.max(0, Math.min(100, master)) / 100;
        ostDroneGain.gain.setValueAtTime(0.055 * mvol, now);

        ostDroneOsc1.connect(ostFilter);
        ostDroneOsc2.connect(ostFilter);
        ostFilter.connect(ostDroneGain);
        ostDroneGain.connect(masterGain || ac.destination);

        ostDroneOsc1.start(now);
        ostDroneOsc2.start(now);

        // Dynamic 4-State Procedural OST Engine (128 BPM = ~117ms per step)
        // 1. Exploration Mode | 2. Combat Engagement | 3. Apex Boss | 4. Critical Health Tension
        const dMinorScale = [73.42, 87.31, 110, 130.81, 146.83, 174.61, 220, 261.63];
        const ambientChimes = [293.66, 349.23, 440, 523.25, 587.33]; // D4, F4, A4, C5, D5
        ostStep = 0;
        if (ostInterval) clearInterval(ostInterval);
        ostInterval = setInterval(() => {
            if (!ostActive || gameState !== 'playing' || !player) return;
            try {
                const curAc = ensureAudio();
                const curVol = (Number(settings.volume) || 0) / 100;
                if (curVol <= 0) return;

                const isBoss = (currentLevel === 4 || currentLevel === 9 || currentLevel === LEVELS - 1);
                const isCombat = (typeof closestMonsterDist !== 'undefined' && closestMonsterDist < 7.5 * CELL) || isBoss;
                const isLowHp = (player.hp <= player.maxHp * 0.35);

                const tNow = curAc.currentTime;
                ostStep++;

                // State 4: Low HP Tension Tinnitus Whistle (Gentle high frequency dread)
                if (isLowHp && ostStep % 16 === 0) {
                    const tinOsc = curAc.createOscillator();
                    const tinGain = curAc.createGain();
                    tinOsc.type = 'sine';
                    tinOsc.frequency.setValueAtTime(3600, tNow);
                    tinGain.gain.setValueAtTime(0.018 * curVol, tNow);
                    tinGain.gain.exponentialRampToValueAtTime(0.0001, tNow + 1.2);
                    tinOsc.connect(tinGain);
                    tinGain.connect(masterGain || curAc.destination);
                    tinOsc.start(tNow);
                    tinOsc.stop(tNow + 1.25);
                }

                // State 1: Exploration Ambient Sparse Chimes
                if (!isCombat && !isBoss) {
                    if (ostStep % 8 === 0 && Math.random() < 0.45) {
                        const chimeFreq = ambientChimes[Math.floor(Math.random() * ambientChimes.length)];
                        const chimeOsc = curAc.createOscillator();
                        const chimeGain = curAc.createGain();
                        chimeOsc.type = 'sine';
                        chimeOsc.frequency.setValueAtTime(chimeFreq, tNow);
                        chimeGain.gain.setValueAtTime(0.035 * curVol, tNow);
                        chimeGain.gain.exponentialRampToValueAtTime(0.0001, tNow + 0.8);
                        chimeOsc.connect(chimeGain);
                        chimeGain.connect(masterGain || curAc.destination);
                        chimeOsc.start(tNow);
                        chimeOsc.stop(tNow + 0.85);
                    }
                    return; // Exploration maintains quiet tense atmospheric silence
                }

                // State 2 & 3: Combat / Boss Driving Bass & Percussion
                const freq = dMinorScale[ostStep % dMinorScale.length];
                const arpOsc = curAc.createOscillator();
                const arpGain = curAc.createGain();
                const arpFilt = curAc.createBiquadFilter();

                arpOsc.type = isBoss ? 'sawtooth' : 'triangle';
                arpOsc.frequency.setValueAtTime(freq * (isBoss ? 0.5 : 1.0), tNow);

                arpFilt.type = 'lowpass';
                const cutoff = isBoss ? 850 : 580;
                arpFilt.frequency.setValueAtTime(cutoff, tNow);
                arpFilt.frequency.exponentialRampToValueAtTime(120, tNow + 0.12);

                const noteVol = (isBoss ? 0.085 : 0.065) * curVol;
                arpGain.gain.setValueAtTime(noteVol, tNow);
                arpGain.gain.exponentialRampToValueAtTime(0.0001, tNow + 0.14);

                arpOsc.connect(arpFilt);
                arpFilt.connect(arpGain);
                arpGain.connect(masterGain || curAc.destination);

                arpOsc.start(tNow);
                arpOsc.stop(tNow + 0.15);

                // Hi-Hat / Ballistic Noise Tick in Combat
                if (ostStep % 2 === 0) {
                    const tickCount = Math.floor(curAc.sampleRate * 0.03);
                    const tickBuf = curAc.createBuffer(1, tickCount, curAc.sampleRate);
                    const td = tickBuf.getChannelData(0);
                    for (let i = 0; i < tickCount; i++) td[i] = (Math.random() * 2 - 1) * Math.exp(-i / (tickCount * 0.2));
                    const tickSrc = curAc.createBufferSource();
                    tickSrc.buffer = tickBuf;
                    const tickFilt = curAc.createBiquadFilter();
                    tickFilt.type = 'highpass';
                    tickFilt.frequency.setValueAtTime(5000, tNow);
                    const tickGain = curAc.createGain();
                    tickGain.gain.setValueAtTime((isBoss ? 0.05 : 0.03) * curVol, tNow);
                    tickSrc.connect(tickFilt);
                    tickFilt.connect(tickGain);
                    tickGain.connect(masterGain || curAc.destination);
                    tickSrc.start(tNow);
                    tickSrc.stop(tNow + 0.035);
                }

                // Boss Industrial Kick Pulse
                if (isBoss && ostStep % 4 === 0) {
                    const kickOsc = curAc.createOscillator();
                    const kickGain = curAc.createGain();
                    kickOsc.type = 'sine';
                    kickOsc.frequency.setValueAtTime(135, tNow);
                    kickOsc.frequency.exponentialRampToValueAtTime(32, tNow + 0.09);
                    kickGain.gain.setValueAtTime(0.24 * curVol, tNow);
                    kickGain.gain.exponentialRampToValueAtTime(0.001, tNow + 0.12);
                    kickOsc.connect(kickGain);
                    kickGain.connect(masterGain || curAc.destination);
                    kickOsc.start(tNow);
                    kickOsc.stop(tNow + 0.13);
                }
            } catch (e) {}
        }, 117);

    } catch (e) {}
}

function stopProceduralOST() {
    try {
        ostActive = false;
        if (ostInterval) {
            clearInterval(ostInterval);
            ostInterval = null;
        }
        if (ostDroneOsc1) {
            ostDroneOsc1.stop();
            ostDroneOsc1.disconnect();
            ostDroneOsc1 = null;
        }
        if (ostDroneOsc2) {
            ostDroneOsc2.stop();
            ostDroneOsc2.disconnect();
            ostDroneOsc2 = null;
        }
        ostDroneGain = null;
        ostFilter = null;
    } catch (e) {}
}

// Chirp Frekuensi Radio Militer Taktis (Incoming Comms Chatter)
function sCommsBeep() {
    try {
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        const now = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.setValueAtTime(1800, now + 0.05);
        g.gain.setValueAtTime(0.12, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(g);
        g.connect(masterGain || ac.destination);
        osc.start(now);
        osc.stop(now + 0.13);
    } catch (e) {}
}

// Dekoding Data Disc Rahasia (Terminal Stream Chirp)
function sDataDecode() {
    try {
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        const now = ac.currentTime;
        [800, 1200, 1600, 2400].forEach((f, i) => {
            const osc = ac.createOscillator();
            const g = ac.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f, now + i * 0.04);
            g.gain.setValueAtTime(0.08, now + i * 0.04);
            g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.05);
            osc.connect(g);
            g.connect(masterGain || ac.destination);
            osc.start(now + i * 0.04);
            osc.stop(now + i * 0.04 + 0.06);
        });
    } catch (e) {}
}

// ---- IN-MISSION COMMS TRANSCEIVER CONTROLLER ----
let commsTimer = null;
let commsTypeTimer = null;
function triggerComms(data) {
    if (!data) return;
    const box = document.getElementById('commsBox');
    if (!box) return;
    sCommsBeep();
    const sender = document.getElementById('commsSender');
    const freq = document.getElementById('commsFreq');
    const body = document.getElementById('commsBody');
    if (sender) sender.textContent = data.speaker || 'TRANSMISSION';
    if (freq) freq.textContent = data.callsign ? ('CALLSIGN: ' + data.callsign) : 'FREQ: 142.85 MHz';

    const fullText = (lang === 'id' && data.text_id) ? data.text_id : (data.text_en || '');
    if (body) {
        body.textContent = '';
        box.style.display = 'block';
        let idx = 0;
        if (commsTypeTimer) clearInterval(commsTypeTimer);
        commsTypeTimer = setInterval(() => {
            if (idx < fullText.length) {
                body.textContent += fullText[idx];
                idx++;
            } else {
                clearInterval(commsTypeTimer);
                commsTypeTimer = null;
            }
        }, 18);
    }
    if (commsTimer) clearTimeout(commsTimer);
    commsTimer = setTimeout(() => {
        box.style.display = 'none';
        commsTimer = null;
    }, 7500);
}

// ---- CLASSIFIED LORE MODAL CONTROLLER ----
function openLoreModal(log) {
    if (!log) return;
    sDataDecode();
    try {
        const archive = JSON.parse(localStorage.getItem('vita_lore_archive') || '[]');
        if (!archive.includes(log.id)) {
            archive.push(log.id);
            localStorage.setItem('vita_lore_archive', JSON.stringify(archive));
        }
    } catch (e) {}
    const modal = document.getElementById('loreModal');
    if (!modal) return;
    const titleEl = document.getElementById('loreTitleText');
    const authorEl = document.getElementById('loreMetaAuthor');
    const contentEl = document.getElementById('loreContentText');
    if (titleEl) titleEl.textContent = (lang === 'id' && log.title_id) ? log.title_id : (log.title_en || 'DATA DISC');
    if (authorEl) authorEl.textContent = 'AUTHOR / SOURCE: ' + (log.author || 'UNKNOWN');
    if (contentEl) contentEl.textContent = (lang === 'id' && log.body_id) ? log.body_id : (log.body_en || '');
    modal.classList.add('open');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    showCursor();
    gameState = 'paused';
}
function closeLoreModal() {
    const modal = document.getElementById('loreModal');
    if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
        modal.style.opacity = '0';
    }
    hideCursor();
    if (gameState === 'paused') gameState = 'playing';
}

// ---- CLASSIFIED CODEX ARCHIVES CONTROLLER ----
function openCodexModal() {
    sDataDecode();
    const modal = document.getElementById('codexModal');
    if (!modal) return;
    modal.classList.add('open');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    showCursor();
    if (gameState === 'playing') gameState = 'paused';

    const titleEl = document.getElementById('codexTitleText');
    if (titleEl) titleEl.textContent = tt('codex_title');

    renderCodexLogsList();
}

function closeCodexModal() {
    const modal = document.getElementById('codexModal');
    if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
        modal.style.opacity = '0';
    }
    hideCursor();
    if (gameState === 'paused') gameState = 'playing';
}

// ============================================================
// LEVEL 1 LIVE FIELD TUTORIAL CONTROLLER (SEKTOR 1 PROTOCOLS)
// ============================================================
function sTutorialStep() {
    try {
        const ac = ensureAudio();
        if (!ac) return;
        const now = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880.00, now + 0.08); // A5
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(g);
        g.connect(masterGain || ac.destination);
        osc.start(now);
        osc.stop(now + 0.36);
    } catch (_) {}
}

function initTutorial() {
    if (currentLevel !== 0 || menuDemo) {
        hideTutorial();
        return;
    }
    const done = localStorage.getItem('vita_tutorial_done') === 'true';
    if (done) {
        hideTutorial();
        return;
    }
    tutorialActive = true;
    tutorialStep = 0;
    tutorialMoveDist = 0;
    updateTutorialUI();
}

function updateTutorialUI() {
    const banner = document.getElementById('tutorialBanner');
    if (!banner) return;
    if (!tutorialActive) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'block';
    const badge = document.getElementById('tutStepBadge');
    const msg = document.getElementById('tutMsg');
    const sub = document.getElementById('tutSub');
    const icon = document.getElementById('tutIcon');
    const status = document.getElementById('tutStatus');
    const skipBtn = banner.querySelector('.tutorial-skip-btn');
    if (skipBtn) skipBtn.textContent = tt('tut_skip');

    if (tutorialStep === 0) {
        if (badge) badge.textContent = tt('tut_step1_badge');
        if (msg) msg.textContent = tt('tut_step1_msg');
        if (sub) sub.textContent = `${lang === 'id' ? 'Kalibrasi roda & track' : 'Calibrating tracks'}: ${Math.min(50, Math.floor(tutorialMoveDist))}/50px`;
        if (icon) icon.textContent = '✥';
        if (status) {
            status.textContent = `${Math.min(50, Math.floor(tutorialMoveDist))}/50px`;
            status.className = 'tutorial-status-indicator';
        }
    } else if (tutorialStep === 1) {
        if (badge) badge.textContent = tt('tut_step2_badge');
        if (msg) msg.textContent = tt('tut_step2_msg');
        if (sub) sub.textContent = tt('tut_step2_sub');
        if (icon) icon.textContent = '◎';
        if (status) {
            status.textContent = 'READY';
            status.className = 'tutorial-status-indicator';
        }
    } else if (tutorialStep === 2) {
        if (badge) badge.textContent = tt('tut_step3_badge');
        if (msg) msg.textContent = tt('tut_step3_msg');
        if (sub) sub.textContent = tt('tut_step3_sub');
        if (icon) icon.textContent = '✧';
        if (status) {
            status.textContent = 'ARMED';
            status.className = 'tutorial-status-indicator';
        }
    } else if (tutorialStep === 3) {
        if (badge) badge.textContent = tt('tut_step4_badge');
        if (msg) msg.textContent = tt('tut_step4_msg');
        const rem = artifacts ? artifacts.filter(a => !a.collected).length : 0;
        if (sub) sub.textContent = (lang === 'id' ? `Anomali artefak tersisa: ${rem}` : `Remaining artifacts: ${rem}`);
        if (icon) icon.textContent = '◆';
        if (status) {
            status.textContent = 'ACTIVE';
            status.className = 'tutorial-status-indicator';
        }
    }
}

function advanceTutorialStep(fromStep) {
    if (!tutorialActive || tutorialStep !== fromStep) return;
    sTutorialStep();
    const status = document.getElementById('tutStatus');
    if (status) {
        status.textContent = '✓ OK';
        status.className = 'tutorial-status-indicator success';
    }
    tutorialStep++;
    if (tutorialStep >= 4) {
        localStorage.setItem('vita_tutorial_done', 'true');
        setTimeout(() => {
            hideTutorial();
        }, 3200);
    } else {
        setTimeout(() => {
            updateTutorialUI();
        }, 600);
    }
}

function skipTutorial() {
    tutorialActive = false;
    localStorage.setItem('vita_tutorial_done', 'true');
    hideTutorial();
}

function hideTutorial() {
    tutorialActive = false;
    const banner = document.getElementById('tutorialBanner');
    if (banner) banner.style.display = 'none';
}

function renderCodexLogsList(selectedId) {
    const listEl = document.getElementById('codexLogsList');
    if (!listEl || typeof LORE_DATA_LOGS === 'undefined') return;
    let unlocked = [];
    try {
        unlocked = JSON.parse(localStorage.getItem('vita_lore_archive') || '[]');
    } catch (e) {}

    listEl.innerHTML = '';
    const firstDecrypted = LORE_DATA_LOGS.find(l => unlocked.includes(l.id));
    const activeId = selectedId || (firstDecrypted ? firstDecrypted.id : (LORE_DATA_LOGS[0] ? LORE_DATA_LOGS[0].id : null));

    LORE_DATA_LOGS.forEach(log => {
        const isUnlocked = unlocked.includes(log.id);
        const item = document.createElement('div');
        item.className = 'codex-log-item' + (log.id === activeId ? ' active' : '') + (!isUnlocked ? ' locked' : '');
        const title = isUnlocked
            ? ((lang === 'id' && log.title_id) ? log.title_id : log.title_en)
            : `[ENCRYPTED - SECTOR ${log.level + 1}]`;
        item.innerHTML = `
            <div class="codex-log-num">${log.id.toUpperCase()}</div>
            <div class="codex-log-name">${title}</div>
            <div class="codex-log-status">${isUnlocked ? 'DECRYPTED' : 'LOCKED'}</div>
        `;
        item.onclick = () => {
            if (isUnlocked) {
                sDataDecode();
                renderCodexLogsList(log.id);
                displayCodexLog(log);
            }
        };
        listEl.appendChild(item);
    });

    const activeLog = LORE_DATA_LOGS.find(l => l.id === activeId);
    if (activeLog && unlocked.includes(activeLog.id)) {
        displayCodexLog(activeLog);
    } else {
        const bodyEl = document.getElementById('codexReaderContent');
        if (bodyEl) {
            bodyEl.innerHTML = `<div class="codex-empty-msg">${tt('codex_empty')}</div>`;
        }
    }
}

function displayCodexLog(log) {
    const bodyEl = document.getElementById('codexReaderContent');
    if (!bodyEl || !log) return;
    const title = (lang === 'id' && log.title_id) ? log.title_id : log.title_en;
    const author = log.author || 'UNKNOWN';
    const text = (lang === 'id' && log.body_id) ? log.body_id : (log.body_en || '');

    bodyEl.innerHTML = `
        <div class="codex-stamp">TOP SECRET // CLASSIFIED</div>
        <h3 class="codex-doc-title">${title}</h3>
        <div class="codex-doc-meta">SOURCE / AUTHOR: ${author} &bull; SECTOR ${log.level + 1}</div>
        <div class="codex-doc-body">${text}</div>
    `;
}

// ---- COMBAT ADRENALINE COMBO SYSTEM ----
let comboCount = 0;
let comboTimer = 0;
function registerComboKill() {
    comboCount++;
    comboTimer = 180; // 3 seconds at 60fps
    if (comboCount >= 2) {
        const banner = document.getElementById('comboBanner');
        const countEl = document.getElementById('comboCount');
        const titleEl = document.getElementById('comboTitle');
        if (banner && countEl && titleEl) {
            countEl.textContent = 'x' + comboCount;
            let title = tt('combo_double');
            if (comboCount === 3) title = tt('combo_triple');
            else if (comboCount === 4) title = tt('combo_carnage');
            else if (comboCount >= 5) title = tt('combo_godlike');
            titleEl.textContent = title;
            banner.style.display = 'block';
            banner.style.animation = 'none';
            banner.offsetHeight; // trigger reflow
            banner.style.animation = 'comboPop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
        }
        gainExp(comboCount * 4);
    }
}
function hideComboBanner() {
    const banner = document.getElementById('comboBanner');
    if (banner) banner.style.display = 'none';
}

// ---- VOLATILE BIOHAZARD BARRELS ----
let barrels = [];
let dataDiscs = [];

function detonateBarrel(b) {
    if (!b || b.exploded) return;
    b.exploded = true;
    sExplosion();
    addShake(14);
    addShockwave(b.x, b.y, 110, '#ff9900', 25);
    addParticle(b.x, b.y, '#ff4400', 30, 6, 35);
    addParticle(b.x, b.y, '#ffff00', 20, 5, 25);
    addGasCloud(b.x, b.y, 45, '#ff5500', 120);

    // Damage surrounding monsters
    monsters.forEach(m => {
        if (m.hp > 0 && dist(b, m) < 95) {
            attackMonster(m, player.atk * 2.5);
        }
    });

    // Damage player if caught in blast
    if (dist(b, player) < 80 && !player.dashing && player.invincible <= 0) {
        player.hp = Math.max(1, player.hp - Math.round(player.maxHp * 0.25));
        sHurt();
        addShake(15);
    }

    floatingTexts.push({
        x: b.x, y: b.y - 15,
        text: tt('barrel_detonated'),
        color: '#ffaa00', life: 50, maxLife: 50
    });
}

// ---- CINEMATIC EPILOGUE CUTSCENE CONTROLLER ----
let epilogueCallback = null;
function playEpilogueCutscene(onComplete) {
    epilogueCallback = onComplete;
    stopProceduralOST();
    sWin();
    const screen = document.getElementById('epilogueScreen');
    const content = document.getElementById('epilogueContent');
    const btn = document.getElementById('epilogueContinueBtn');
    if (!screen || !content) {
        if (onComplete) onComplete();
        return;
    }
    screen.style.display = 'flex';
    const isId = (lang === 'id');
    const script = (typeof EPILOGUE_SCRIPT !== 'undefined') ? EPILOGUE_SCRIPT : null;
    const intro = script ? (isId ? script.intro_id : script.intro_en) : 'SECTOR 15 PURGED';
    const lines = script ? (isId ? script.lines_id : script.lines_en) : ['The labyrinth is quiet.'];

    let html = `<div class="prologue-header"><span class="prologue-classify">${isId ? 'MISI SELESAI // FASILITAS AMAN' : 'MISSION COMPLETE // FACILITY SECURE'}</span><span class="prologue-date">${isId ? 'EPILOG NARRATIF' : 'NARRATIVE EPILOGUE'}</span></div>`;
    html += `<div class="prologue-glitch" data-text="${intro}" style="margin-bottom:18px">${intro}</div>`;
    lines.forEach((l, i) => {
        html += `<div class="prologue-line narrator" style="opacity:0;animation:fadeInLine 0.9s forwards;animation-delay:${0.8 + i * 1.4}s;margin-bottom:12px">${l}</div>`;
    });
    content.innerHTML = html;
    if (btn) {
        btn.style.opacity = '0';
        setTimeout(() => {
            btn.style.opacity = '1';
            btn.style.transition = 'opacity 0.8s';
        }, (lines.length * 1400) + 1200);
    }
}
function finishEpilogue() {
    const screen = document.getElementById('epilogueScreen');
    if (screen) screen.style.display = 'none';
    if (epilogueCallback) {
        const cb = epilogueCallback;
        epilogueCallback = null;
        cb();
    }
}

// Tebasan Pisau Taktis: Desir Angin Aerodinamis Tajam & Gesekan Bilah Baja
function sKnifeSlash() {
    try {
        playNoiseBurst(0.12, 3200, 380, 3.2, 0.48, 'bandpass');
        playOccultTone(360, 90, 0.08, 0.32, 'triangle');
    } catch(e) {}
}

// Penggantian Senjata: Denting Mekanikal Bolt & Kokangan Taktis Militer
function sWeaponSwitch() {
    try {
        playNoiseBurst(0.06, 2200, 340, 2.4, 0.38, 'bandpass');
        playOccultTone(150, 45, 0.06, 0.35, 'sine');
    } catch(e) {}
}

// Buka Airlock / Transisi Level: Pelepasan Hidrolik Pneumatik Berat & Pintu Sekat Besi
function sExitOpen() {
    try {
        playNoiseBurst(0.75, 1800, 60, 2.8, 0.75, 'lowpass');
        playOccultTone(95, 22, 0.6, 0.85, 'sine');
        playOccultTone(140, 36, 0.45, 0.6, 'sawtooth');
    } catch(e) {}
}

// Kemenangan Game: Klimaks Horor Sinematik (Dark Ambient Brass & Harmonic Sub-Resonance)
function sWin() {
    try {
        const ac = ensureAudio();
        const master = Number(settings.volume);
        const mvol = Number.isFinite(master) ? Math.max(0, Math.min(100, master)) / 100 : 0.7;
        if (mvol <= 0.01) return;

        // Akor D-minor rendah sinematik (55Hz, 110Hz, 164.8Hz) dengan decay panjang
        playOccultTone(55, 48, 3.2, 0.9, 'sawtooth');
        playOccultTone(110, 98, 2.8, 0.65, 'sine');
        playOccultTone(164.8, 146.8, 2.6, 0.5, 'triangle');
        playNoiseBurst(2.2, 800, 60, 3.0, 0.65, 'lowpass');
    } catch(e) {}
}

// Audio UI Sinematik Taktil (Tombol Konsol Militer, Meredam Beep Arkade Menjadi Impuls Sub-Bass)
function sCinematicUI(type) {
    try {
        const ac = ensureAudio();
        const now = ac.currentTime;
        const master = Number(settings.volume);
        if (master <= 0) return;

        if (type === 'click') {
            // Tekanan tombol konsol taktil berbobot (280Hz->65Hz + klik akustik renyah)
            const osc = ac.createOscillator();
            const g = ac.createGain();
            const f = ac.createBiquadFilter();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(280, now);
            osc.frequency.exponentialRampToValueAtTime(65, now + 0.045);
            f.type = 'lowpass';
            f.frequency.setValueAtTime(1500, now);
            g.gain.setValueAtTime(0.55, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
            osc.connect(f); f.connect(g); g.connect(masterGain || ac.destination);
            osc.start(now); osc.stop(now + 0.05);
            playNoiseBurst(0.025, 1400, 320, 2.0, 0.4, 'bandpass');
        } else if (type === 'open') {
            // Pergeseran sekat pneumatik
            playNoiseBurst(0.2, 950, 280, 2.2, 0.52, 'bandpass');
            playOccultTone(220, 80, 0.16, 0.45, 'sine');
        } else if (type === 'close') {
            // Kunci sekat mekanikal
            playNoiseBurst(0.12, 850, 180, 2.5, 0.48, 'lowpass');
            playOccultTone(180, 60, 0.12, 0.5, 'triangle');
        } else if (type === 'save') {
            // Konfirmasi enkripsi biometrik
            playOccultTone(260, 260, 0.22, 0.55, 'sine');
            playOccultTone(520, 520, 0.3, 0.45, 'sine');
            playNoiseBurst(0.08, 1400, 450, 2.0, 0.3, 'bandpass');
        } else if (type === 'denied') {
            // Tolakan hidrolik berat / penolakan akses
            playOccultTone(140, 50, 0.2, 0.8, 'sawtooth');
            playNoiseBurst(0.2, 600, 100, 3.5, 0.65, 'lowpass');
        }
    } catch(e) {}
}

let lastHeartbeatTime = 0;
function playOrganicHeartbeat(intensity) {
    try {
        if (gameState !== 'playing' || menuDemo) return;
        const ac = ensureAudio();
        const now = ac.currentTime;
        const master = Number(settings.volume);
        if (master <= 0) return;

        [0, 0.14].forEach(delay => {
            const osc = ac.createOscillator();
            const g = ac.createGain();
            const filter = ac.createBiquadFilter();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(82, now + delay);
            osc.frequency.exponentialRampToValueAtTime(42, now + delay + 0.12);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(240, now + delay);

            const vol = 0.45 + intensity * 0.45;
            g.gain.setValueAtTime(vol, now + delay);
            g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.15);

            osc.connect(filter);
            filter.connect(g);
            g.connect(masterGain || ac.destination);

            osc.start(now + delay);
            osc.stop(now + delay + 0.16);
        });
    } catch (e) {}
}

// ---- PROSEDURAL HORROR SOUND ENGINE (Spatial Distance & Stereo Positional WebAudio) ----
// Menghitung atenuasi jarak (jauh-dekat), peredaman dinding (lowpass), serta panning stereo kiri-kanan
function getSpatialAudio(pos, maxDist = 13 * CELL) {
    if (!pos || pos.x === undefined || pos.y === undefined) {
        return { volMult: 1.0, pan: 0, filterCutoff: 20000, muted: false };
    }
    if (gameState !== 'playing' || menuDemo || !player) {
        return { volMult: 0, pan: 0, filterCutoff: 100, muted: true };
    }
    const dx = pos.x - player.x;
    const dy = pos.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d >= maxDist) {
        return { volMult: 0, pan: 0, filterCutoff: 100, muted: true };
    }
    // Atenuasi jarak non-linear: dekat jernih & bergetar, jauh mengecil lembut
    const norm = d / maxDist;
    const volMult = Math.pow(1 - norm, 1.35);
    // Panning stereo horizontal: monster di kiri/kanan terdengar presisi di headset/speaker
    const panRange = 8.5 * CELL;
    const pan = Math.max(-0.85, Math.min(0.85, dx / panRange));
    // Damping akustik lorong: suara jauh teredam dinding labirin (lowpass ~320Hz), suara dekat renyah
    const filterCutoff = 320 + Math.pow(1 - norm, 1.8) * 8500;
    return { volMult, pan, filterCutoff, muted: false };
}

function playNoiseBurst(dur, f0, f1, q, vol, filterType, pos) {
    try {
        const spatial = getSpatialAudio(pos);
        if (spatial.muted || spatial.volMult <= 0.001) return;
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        const effVol = (Number.isFinite(vol) ? vol : 0.6) * spatial.volMult;
        if (effVol <= 0.001) return;

        const count = Math.floor(ac.sampleRate * Math.max(0.02, dur));
        const buf = ac.createBuffer(1, count, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < count; i++) {
            d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (count * 0.42));
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        const flt = ac.createBiquadFilter();
        flt.type = filterType || 'lowpass';
        const startFreq = Math.min(Math.max(20, f0), spatial.filterCutoff);
        const endFreq = Math.min(Math.max(20, f1), spatial.filterCutoff);
        flt.frequency.setValueAtTime(startFreq, ac.currentTime);
        flt.frequency.exponentialRampToValueAtTime(endFreq, ac.currentTime + dur);
        flt.Q.setValueAtTime(q || 2.5, ac.currentTime);
        const g = ac.createGain();
        g.gain.setValueAtTime(effVol, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
        src.connect(flt);
        flt.connect(g);

        let finalNode = g;
        if (ac.createStereoPanner && spatial.pan !== 0) {
            const panner = ac.createStereoPanner();
            panner.pan.setValueAtTime(spatial.pan, ac.currentTime);
            g.connect(panner);
            finalNode = panner;
        }
        finalNode.connect(masterGain || ac.destination);
        src.start(ac.currentTime);
        src.stop(ac.currentTime + dur);
    } catch (e) {}
}

function playOccultTone(freq0, freq1, dur, vol, type, pos) {
    try {
        const spatial = getSpatialAudio(pos);
        if (spatial.muted || spatial.volMult <= 0.001) return;
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        const effVol = (Number.isFinite(vol) ? vol : 0.5) * spatial.volMult;
        if (effVol <= 0.001) return;

        const osc = ac.createOscillator();
        const g = ac.createGain();
        const f = ac.createBiquadFilter();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq0, ac.currentTime);
        if (freq1) osc.frequency.exponentialRampToValueAtTime(freq1, ac.currentTime + dur);
        f.type = 'lowpass';
        f.frequency.setValueAtTime(Math.min(Math.max(freq0 * 2.5, 300), spatial.filterCutoff), ac.currentTime);
        g.gain.setValueAtTime(effVol, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
        osc.connect(f);
        f.connect(g);

        let finalNode = g;
        if (ac.createStereoPanner && spatial.pan !== 0) {
            const panner = ac.createStereoPanner();
            panner.pan.setValueAtTime(spatial.pan, ac.currentTime);
            g.connect(panner);
            finalNode = panner;
        }
        finalNode.connect(masterGain || ac.destination);
        osc.start();
        osc.stop(ac.currentTime + dur);
    } catch (e) {}
}

// ---- MODUL 5: CRITICAL HIT SATISFYING AUDIO IMPACT ----
function sCritHit(pos) {
    try {
        const spatial = getSpatialAudio(pos);
        if (spatial.muted || spatial.volMult <= 0.001) return;
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        const now = ac.currentTime;
        const effVol = (master / 100) * spatial.volMult * 0.85;

        // 1. Crystalline Harmonic Ping (Stacked Triad Overtones: 880Hz, 1320Hz, 1760Hz)
        [880, 1320, 1760].forEach((freq, idx) => {
            const osc = ac.createOscillator();
            const g = ac.createGain();
            const f = ac.createBiquadFilter();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.015);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + idx * 0.015 + 0.18);
            f.type = 'bandpass';
            f.frequency.setValueAtTime(Math.min(freq * 1.2, spatial.filterCutoff), now);
            f.Q.setValueAtTime(4.0, now);
            g.gain.setValueAtTime(effVol * 0.35, now + idx * 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.015 + 0.22);
            osc.connect(f);
            f.connect(g);
            if (ac.createStereoPanner && spatial.pan !== 0) {
                const p = ac.createStereoPanner();
                p.pan.setValueAtTime(spatial.pan, now);
                g.connect(p);
                p.connect(masterGain || ac.destination);
            } else {
                g.connect(masterGain || ac.destination);
            }
            osc.start(now + idx * 0.015);
            osc.stop(now + idx * 0.015 + 0.25);
        });

        // 2. Heavy Concussive Sub-Bass Body Impact
        playOccultTone(145, 32, 0.18, 0.9, 'sawtooth', pos);
        playNoiseBurst(0.12, 4200, 240, 3.5, 0.7, 'bandpass', pos);
    } catch (_) {}
}

// Procedural Environmental Audio Generator (Sector Specific)
function playProceduralWaterDrip() {
    try {
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0 || gameState !== 'playing' || menuDemo) return;
        const now = ac.currentTime;
        const pan = (Math.random() - 0.5) * 1.5;
        const freq = 1200 + Math.random() * 600;

        const osc = ac.createOscillator();
        const g = ac.createGain();
        const f = ac.createBiquadFilter();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.45, now + 0.04);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.8, now + 0.09);

        f.type = 'lowpass';
        f.frequency.setValueAtTime(3200, now);

        g.gain.setValueAtTime(0.08 * (master / 100), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

        osc.connect(f);
        f.connect(g);

        if (ac.createStereoPanner) {
            const p = ac.createStereoPanner();
            p.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, pan)), now);
            g.connect(p);
            p.connect(masterGain || ac.destination);
        } else {
            g.connect(masterGain || ac.destination);
        }

        osc.start(now);
        osc.stop(now + 0.14);
    } catch (_) {}
}

function playProceduralBioGurgle() {
    try {
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0 || gameState !== 'playing' || menuDemo) return;
        const now = ac.currentTime;
        const pan = (Math.random() - 0.5) * 1.4;
        const dur = 0.35 + Math.random() * 0.25;

        playNoiseBurst(dur, 450, 90, 4.0, 0.18 * (master / 100), 'lowpass', { x: player.x + pan * 150, y: player.y + (Math.random() - 0.5) * 100 });
        playOccultTone(85, 35, dur * 0.8, 0.15 * (master / 100), 'sawtooth', { x: player.x + pan * 150, y: player.y + (Math.random() - 0.5) * 100 });
    } catch (_) {}
}

function playProceduralSteamHiss() {
    try {
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0 || gameState !== 'playing' || menuDemo) return;
        const pan = (Math.random() - 0.5) * 1.6;
        playNoiseBurst(0.65, 2800, 350, 1.8, 0.14 * (master / 100), 'bandpass', { x: player.x + pan * 200, y: player.y });
    } catch (_) {}
}

// Artefak Kuno / Anomali Biologis: Lonceng Misterius Tibet Eerie Dissonance (Bukan Blip Arkade)
function sArtifact() {
    try {
        // Nada dissonan ganda (216Hz dan 224Hz menghasilkan 8Hz pulsating acoustic dread)
        playOccultTone(216, 214, 1.8, 0.45, 'sine');
        playOccultTone(224, 222, 1.8, 0.42, 'sine');
        // Sub-harmonic drone di latar belakang
        playOccultTone(54, 52, 2.2, 0.55, 'triangle');
        playNoiseBurst(0.4, 800, 120, 4.0, 0.18, 'bandpass');
    } catch (e) {}
}

// Sobekan Daging & Tulang Retak (Visceral Flesh Hit)
function sHit() {
    try {
        playNoiseBurst(0.14, 1600, 95, 4.5, 0.65, 'lowpass');
        playOccultTone(145, 34, 0.16, 0.5, 'sawtooth');
        playOccultTone(52, 24, 0.18, 0.75, 'sine');
    } catch (e) {}
}

// Luka Pemain: Hantaman Organ Tubuh Berat & Tersedak Sakit
function sHurt() {
    try {
        // Hantaman organ tumpul (38Hz sub-punch)
        playOccultTone(78, 28, 0.28, 0.95, 'sine');
        playNoiseBurst(0.24, 900, 75, 3.5, 0.75, 'lowpass');
        // Statis radio glitch mendadak
        sStaticBurst();
    } catch (e) {}
}

// Dash: Pergeseran Fase Hampa Udara / Exhale Seram
function sDash() {
    try {
        playNoiseBurst(0.22, 280, 1750, 2.8, 0.48, 'bandpass');
        playOccultTone(160, 45, 0.2, 0.35, 'sine');
    } catch (e) {}
}

// Biometrik Rendah: Denyut Jantung Vaskular Sub-Bass Horror
function sHeartbeat() {
    try {
        playOccultTone(64, 36, 0.08, 0.58, 'sine');
        setTimeout(() => {
            playOccultTone(52, 30, 0.11, 0.65, 'sine');
        }, 125);
    } catch (e) {}
}

// Langkah Kaki Operatif Prosedural: Refleksi Ubin Baja vs Biomassa
function sFootstep() {
    try {
        const isFlesh = (currentLevel >= 4 && currentLevel <= 6) || (currentLevel >= 12);
        if (isFlesh) {
            playNoiseBurst(0.035, 480, 110, 2.8, 0.10, 'lowpass');
        } else {
            playNoiseBurst(0.025, 1500, 320, 3.2, 0.08, 'bandpass');
            playOccultTone(160, 100, 0.02, 0.06, 'triangle');
        }
    } catch (e) {}
}

// Kapsul Nanit Medis: Sintesis Gelombang Rehidrasi Sel Tubuh
function sMedPod() {
    try {
        playOccultTone(280, 560, 0.28, 0.45, 'sine');
        setTimeout(() => playOccultTone(440, 880, 0.32, 0.5, 'sine'), 100);
        setTimeout(() => playOccultTone(660, 1320, 0.42, 0.4, 'triangle'), 220);
    } catch (e) {}
}

// Defleksi Plasma: Denting Logam Memantul Dinding Koridor
function sRicochet() {
    try {
        playOccultTone(1350, 680, 0.06, 0.32, 'triangle');
        playNoiseBurst(0.035, 3400, 950, 5.0, 0.2, 'bandpass');
    } catch (e) {}
}

// Pintu Terkunci: Tolakan Pneumatik Berat Fasilitas & Besi Karat
function sLocked() {
    try {
        playOccultTone(120, 32, 0.28, 0.7, 'triangle');
        playNoiseBurst(0.2, 450, 80, 4.0, 0.55, 'lowpass');
        setTimeout(() => {
            playOccultTone(95, 26, 0.24, 0.6, 'triangle');
            playNoiseBurst(0.16, 380, 60, 3.5, 0.45, 'lowpass');
        }, 120);
    } catch (e) {}
}

// Gugur / Subjek Terminasi: Cardiac Arrest Flatline Horror
function sDie() {
    try {
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        // Ledakan statis robekan terakhir
        playNoiseBurst(0.4, 2200, 60, 2.0, 0.9, 'lowpass');
        playOccultTone(110, 18, 0.9, 0.85, 'sawtooth');

        // Nada EKG Flatline menembus sunyi (780Hz dingin tak bernyawa)
        setTimeout(() => {
            try {
                const osc = ac.createOscillator();
                const g = ac.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(780, ac.currentTime);
                g.gain.setValueAtTime(0.45, ac.currentTime);
                g.gain.setValueAtTime(0.45, ac.currentTime + 1.8);
                g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 2.8);
                osc.connect(g);
                g.connect(masterGain || ac.destination);
                osc.start();
                osc.stop(ac.currentTime + 2.8);
            } catch (err) {}
        }, 300);
    } catch (e) {}
}

// Senjata: Rifle Taktis dengan Dentuman Concussive Berat
function sRifle() {
    playNoiseBurst(0.12, 3200, 200, 1.8, 0.85, 'lowpass');
    playOccultTone(210, 45, 0.1, 0.7, 'sawtooth');
    playOccultTone(75, 30, 0.14, 0.85, 'sine');
}

function sPiercingRifle() {
    playNoiseBurst(0.16, 4500, 400, 3.0, 0.9, 'bandpass');
    playOccultTone(680, 80, 0.18, 0.8, 'sawtooth');
    playOccultTone(85, 32, 0.18, 0.9, 'sine');
}

function sGrenadeToss() {
    playNoiseBurst(0.15, 600, 180, 2.0, 0.35, 'bandpass');
    playOccultTone(180, 90, 0.14, 0.4, 'triangle');
}

function sExplosion(isBazooka) {
    const v = isBazooka ? 1.0 : 0.85;
    playNoiseBurst(isBazooka ? 0.8 : 0.55, 1200, 40, 3.5, v, 'lowpass');
    playOccultTone(140, 22, isBazooka ? 0.8 : 0.5, v * 0.9, 'sawtooth');
    playOccultTone(55, 16, isBazooka ? 0.9 : 0.6, v, 'sine');
}

function sEMPBlast() {
    playNoiseBurst(0.5, 3000, 80, 4.5, 0.75, 'bandpass');
    playOccultTone(450, 35, 0.45, 0.8, 'sawtooth');
    sStaticBurst();
}

function sClusterPop() {
    playNoiseBurst(0.15, 1800, 110, 3.0, 0.55, 'lowpass');
    playOccultTone(220 + Math.random() * 80, 45, 0.14, 0.6, 'sawtooth');
}

function sBazookaLaunch() {
    playNoiseBurst(0.35, 1400, 120, 2.5, 0.85, 'lowpass');
    playOccultTone(95, 240, 0.22, 0.7, 'sawtooth');
}

function sShieldOn() {
    playOccultTone(280, 680, 0.3, 0.6, 'sine');
    playOccultTone(680, 920, 0.25, 0.5, 'triangle');
}

function sShieldDeflect() {
    playOccultTone(1100, 480, 0.12, 0.7, 'triangle');
    playNoiseBurst(0.1, 2800, 600, 4.0, 0.5, 'bandpass');
}

function sShieldDischarge() {
    playNoiseBurst(0.45, 1600, 60, 4.0, 0.9, 'lowpass');
    playOccultTone(160, 28, 0.4, 0.95, 'sawtooth');
}

function sMinigun() {
    playNoiseBurst(0.06, 2400, 180, 2.2, 0.45, 'lowpass');
    playOccultTone(180 + Math.random() * 60, 60, 0.05, 0.4, 'sawtooth');
}

function sSteamVent() {
    playNoiseBurst(0.35, 3500, 600, 1.8, 0.5, 'bandpass');
}

function sBackstab() {
    playNoiseBurst(0.24, 2800, 100, 4.5, 0.95, 'lowpass');
    playNoiseBurst(0.18, 900, 75, 4.0, 0.85, 'bandpass');
    playOccultTone(540, 40, 0.22, 0.85, 'sawtooth');
    playOccultTone(75, 22, 0.28, 0.95, 'sine');
}

function sWeaponUnlock() {
    playOccultTone(330, 440, 0.25, 0.6, 'triangle');
    setTimeout(() => playOccultTone(440, 660, 0.3, 0.7, 'triangle'), 110);
}

// Sobekan Daging Basah Alami (khas Vita Carnis)
function sFleshHit() {
    try {
        playNoiseBurst(0.18, 1400, 80, 5.0, 0.7, 'lowpass');
        playOccultTone(120, 30, 0.18, 0.55, 'sawtooth');
        playOccultTone(60, 22, 0.2, 0.75, 'sine');
    } catch (e) {}
}

// Sirene Peringatan Darurat Global (EAS Two-Tone Header 853Hz & 960Hz)
function sEASAlarm() {
    try {
        const ac = ensureAudio();
        const now = ac.currentTime;
        const master = Number(settings.volume);
        if (master <= 0) return;

        [853, 960].forEach(freq => {
            const osc = ac.createOscillator();
            const g = ac.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            g.gain.setValueAtTime(0.28, now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
            osc.connect(g);
            g.connect(masterGain || ac.destination);
            osc.start(now);
            osc.stop(now + 1.6);
        });
    } catch (e) {}
}

// Raungan Sub-Bass Resonan Kolosal The Monolith (Coelum Carnis Sky Trumpet)
function sMonolithRoar() {
    try {
        const ac = ensureAudio();
        const now = ac.currentTime;
        const master = Number(settings.volume);
        if (master <= 0) return;

        // Vita Carnis Coelum Carnis Sky Trumpet: Nada dissonan 75Hz & 112.5Hz
        const osc1 = ac.createOscillator();
        const osc2 = ac.createOscillator();
        const filter = ac.createBiquadFilter();
        const g = ac.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(75, now);
        osc1.frequency.exponentialRampToValueAtTime(54, now + 2.8);
        osc2.frequency.setValueAtTime(112.5, now);
        osc2.frequency.exponentialRampToValueAtTime(82, now + 2.8);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(420, now);
        filter.frequency.exponentialRampToValueAtTime(75, now + 2.8);
        filter.Q.setValueAtTime(3.5, now);

        g.gain.setValueAtTime(0.85, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 2.9);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(g);
        g.connect(masterGain || ac.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 3.0);
        osc2.stop(now + 3.0);
        playNoiseBurst(1.8, 600, 50, 4.0, 0.65, 'lowpass');
    } catch (e) {}
}

// Hentakan Gempa Seismik Ground Slam The Monolith (28Hz Sub-Bass Quake)
function sMonolithSlam() {
    playOccultTone(85, 28, 0.9, 1.0, 'sine');
    playOccultTone(125, 36, 0.8, 0.85, 'sawtooth');
    playNoiseBurst(0.75, 950, 45, 4.5, 0.95, 'lowpass');
}

// Klik biosensor / geiger analog saat mendekati anomali biologis (halus, tidak menusuk telinga)
let lastGeigerTime = 0;
function sGeigerClick() {
    try {
        if (gameState !== 'playing' || menuDemo) return;
        const ac = ensureAudio();
        const now = ac.currentTime;
        if (now - lastGeigerTime < 0.22) return;
        lastGeigerTime = now;
        const master = Number(settings.volume);
        if (master <= 0) return;
        // Klik analog hangat frekuensi rendah-menengah
        playNoiseBurst(0.015, 860, 220, 2.5, 0.22, 'bandpass');
    } catch (e) {}
}

// Gangguan statis radio / noise analog saat diserang fatal
function sStaticBurst() {
    try {
        if (gameState !== 'playing' || menuDemo) return;
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        const dur = 0.14;
        const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.45));
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        const filter = ac.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(800, ac.currentTime);
        filter.Q.setValueAtTime(1.5, ac.currentTime);
        const gain = ac.createGain();
        gain.gain.setValueAtTime(0.38, ac.currentTime);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain || ac.destination);
        src.start();
    } catch (e) {}
}

// Generator Vokalisasi Predator Organik (Guttural Larynx & Vocal Formant Synthesizer)
// Menghasilkan geraman dada berat, resonansi kerongkongan parau, dan auman buas (BUKAN decitan tikus)
function playGutturalGrowl(params, pos) {
    try {
        const spatial = getSpatialAudio(pos);
        if (spatial.muted || spatial.volMult <= 0.001) return;
        const ac = ensureAudio();
        const master = Number(settings.volume);
        if (master <= 0) return;
        const effVol = (params.vol || 0.6) * spatial.volMult;
        if (effVol <= 0.001) return;

        const now = ac.currentTime;
        const dur = params.dur || 0.5;
        const f0 = Math.max(35, params.f0 || 55); // Nada dasar dada rendah
        const f1 = Math.max(25, params.f1 || 35);
        const growlRate = params.growlRate || 20; // LFO getaran pita suara / uvula monster

        // 1. Osilator Pita Suara Kerongkongan (Larynx Sawtooth sub-bass)
        const osc = ac.createOscillator();
        osc.type = params.type || 'sawtooth';
        osc.frequency.setValueAtTime(f0, now);
        osc.frequency.exponentialRampToValueAtTime(f1, now + dur);

        // 2. Modulasi Getaran Kerongkongan (Throat Tremor / Larynx LFO)
        const lfo = ac.createOscillator();
        const lfoGain = ac.createGain();
        lfo.frequency.setValueAtTime(growlRate, now);
        lfoGain.gain.setValueAtTime(f0 * 0.42, now);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        // 3. Resonansi Rongga Tenggorokan (Formant 1: 180-320Hz)
        const f1Filter = ac.createBiquadFilter();
        f1Filter.type = 'bandpass';
        f1Filter.frequency.setValueAtTime(Math.min(params.formant1 || 260, spatial.filterCutoff), now);
        f1Filter.Q.setValueAtTime(3.6, now);

        // 4. Resonansi Rahang & Mulut (Formant 2: 450-680Hz)
        const f2Filter = ac.createBiquadFilter();
        f2Filter.type = 'lowpass';
        f2Filter.frequency.setValueAtTime(Math.min(params.formant2 || 550, spatial.filterCutoff), now);
        f2Filter.Q.setValueAtTime(2.2, now);

        // 5. Tremolo Serak Parau (Gravelly Throat Flutter)
        const tremolo = ac.createGain();
        const tremLfo = ac.createOscillator();
        const tremDepth = ac.createGain();
        tremLfo.frequency.setValueAtTime(growlRate * 0.85, now);
        tremDepth.gain.setValueAtTime(0.35, now);
        tremLfo.connect(tremDepth);
        tremDepth.connect(tremolo.gain);

        // 6. Amplop Volume
        const mainGain = ac.createGain();
        mainGain.gain.setValueAtTime(0.001, now);
        mainGain.gain.exponentialRampToValueAtTime(effVol, now + Math.min(0.08, dur * 0.25));
        mainGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(f1Filter);
        f1Filter.connect(f2Filter);
        f2Filter.connect(tremolo);
        tremolo.connect(mainGain);

        let finalNode = mainGain;
        if (ac.createStereoPanner && spatial.pan !== 0) {
            const panner = ac.createStereoPanner();
            panner.pan.setValueAtTime(spatial.pan, now);
            mainGain.connect(panner);
            finalNode = panner;
        }
        finalNode.connect(masterGain || ac.destination);

        osc.start(now);
        lfo.start(now);
        tremLfo.start(now);
        osc.stop(now + dur);
        lfo.stop(now + dur);
        tremLfo.stop(now + dur);

        // 7. Gesekan udara nafas basah / desisan predator
        if (params.rasp) {
            playNoiseBurst(dur * 0.85, 320, 60, 2.0, effVol * 0.5, 'lowpass', pos);
        }
    } catch (e) {}
}

// Suara Monster Seram & Organik Sejati (Vokalisasi Binatang Buas & Body Horror Vita Carnis)
const MONSTER_SOUNDS = {
    'Slime': (m) => {
        // Wet bubbling squelch & acid digestion bubbles
        playGutturalGrowl({ f0: 72, f1: 34, dur: 0.42, growlRate: 18, formant1: 210, formant2: 430, vol: 0.68, rasp: true }, m);
        [0, 0.08, 0.16].forEach(d => {
            setTimeout(() => {
                const bFreq = 280 + Math.random() * 120;
                playOccultTone(bFreq, bFreq * 0.5, 0.06, 0.35, 'sine', m);
            }, d * 1000);
        });
    },
    'Bat': (m) => {
        // Ultrasonic echolocation chirps (FM high-sweep) + leathery wing flutter
        playOccultTone(1900, 850, 0.07, 0.45, 'sine', m);
        setTimeout(() => playOccultTone(2200, 1100, 0.06, 0.4, 'sine', m), 45);
        playNoiseBurst(0.22, 1400, 180, 2.5, 0.45, 'lowpass', m);
    },
    'Crawl': (m) => {
        // Bone-cracking mandibular scuttle & hungry flesh predator snarling
        playGutturalGrowl({ f0: 64, f1: 32, dur: 0.38, growlRate: 26, formant1: 280, formant2: 580, vol: 0.8, rasp: true }, m);
        playNoiseBurst(0.12, 1800, 420, 3.5, 0.55, 'bandpass', m);
    },
    'Ghost': (m) => {
        // Ethereal choral howling wind & weeping spirit lamentation
        playOccultTone(174.6, 92, 0.85, 0.48, 'sine', m);
        playOccultTone(185, 98, 0.85, 0.42, 'sine', m);
        playNoiseBurst(0.45, 380, 85, 2.0, 0.32, 'bandpass', m);
    },
    'Harvester': (m) => {
        // Uncanny imitation of a suffering human vocal cord from flesh branch nodes
        playGutturalGrowl({ f0: 90, f1: 44, dur: 0.65, growlRate: 20, formant1: 310, formant2: 560, vol: 0.78, rasp: true }, m);
    },
    'Mother Harvester': (m) => {
        // Sub-bass infrasonic flesh dome vibration & massive spore cloud vent
        playGutturalGrowl({ f0: 52, f1: 26, dur: 1.25, growlRate: 14, formant1: 200, formant2: 420, vol: 0.95, rasp: true }, m);
        playOccultTone(88, 38, 0.8, 0.6, 'triangle', m);
        playNoiseBurst(0.55, 600, 50, 4.0, 0.5, 'lowpass', m);
    },
    'Dark Knight': (m) => {
        // Heavy rusted steel plate collision & grinding shield rim
        playOccultTone(210, 85, 0.18, 0.75, 'triangle', m);
        playNoiseBurst(0.24, 2800, 160, 3.2, 0.65, 'bandpass', m);
        playGutturalGrowl({ f0: 68, f1: 36, dur: 0.4, growlRate: 16, formant1: 230, formant2: 460, vol: 0.6, rasp: true }, m);
    },
    'Dragon': (m) => {
        // Cavernous seismic ancient roar & crackling volcanic flame expulsion
        playGutturalGrowl({ f0: 48, f1: 24, dur: 1.2, growlRate: 13, formant1: 170, formant2: 360, vol: 0.95, rasp: true }, m);
        playNoiseBurst(0.45, 1800, 80, 2.5, 0.6, 'lowpass', m);
    },
    'Lich': (m) => {
        // Demonic necrotic incantation whisper & cursed tolling death bell
        playOccultTone(146.8, 73.4, 0.7, 0.55, 'triangle', m);
        playOccultTone(220, 110, 0.65, 0.4, 'sine', m);
        playNoiseBurst(0.32, 850, 120, 3.5, 0.35, 'bandpass', m);
    },
    'Beholder': (m) => {
        // Binaural alien psychic resonance & undulating frequency warp
        playOccultTone(116.5, 78, 0.75, 0.52, 'sine', m);
        playOccultTone(123.5, 82, 0.75, 0.48, 'sine', m);
        playOccultTone(233, 155, 0.6, 0.38, 'triangle', m);
    },
    'Mimic': (m) => {
        // Chilling faux-human choking gasp snapping into a vicious predator roar
        playOccultTone(340, 95, 0.18, 0.65, 'sawtooth', m);
        playGutturalGrowl({ f0: 68, f1: 32, dur: 0.6, growlRate: 24, formant1: 320, formant2: 640, vol: 0.85, rasp: true }, m);
    },
    'Final Boss': (m) => {
        playGutturalGrowl({ f0: 44, f1: 22, dur: 1.3, growlRate: 15, formant1: 150, formant2: 340, vol: 1.0, rasp: true }, m);
        sStaticBurst();
    },
    'The Monolith': (m) => {
        sMonolithRoar();
    }
};

let lastGlobalMonsterSound = 0;
function monsterSound(m) {
    if (gameState !== 'playing' || menuDemo || !m) return;
    if (m.name === 'Mimic') return; // Mimic kanon adalah silent stalker, tidak meraung sembarangan!
    const now = Date.now();
    // Throttle global: cegah penumpukan suara monster di frame yang berdekatan
    if (now - lastGlobalMonsterSound < 850) return;
    const f = MONSTER_SOUNDS[m.name];
    if (f) {
        lastGlobalMonsterSound = now;
        f(m);
    }
}

function loadHigh() {
    try {
        const h = JSON.parse(localStorage.getItem(VITA_HIGH_KEY) || '{}');
        if (!h || typeof h !== 'object') return {};
        const out = {};
        const bt = Number(h.bestTime);
        if (Number.isFinite(bt) && bt >= 0) out.bestTime = bt;
        const bk = Math.floor(Number(h.bestKills));
        if (Number.isFinite(bk) && bk >= 0) out.bestKills = bk;
        const ll = Math.floor(Number(h.lastLevel));
        if (Number.isFinite(ll) && ll >= 0 && ll < LEVELS) out.lastLevel = ll;
        if (Array.isArray(h.savedWeapons)) out.savedWeapons = h.savedWeapons.filter(w => typeof w === 'string');
        if (typeof h.savedCurrentWeapon === 'string') out.savedCurrentWeapon = h.savedCurrentWeapon;
        if (Array.isArray(h.savedPerks)) out.savedPerks = h.savedPerks.filter(p => typeof p === 'string');
        if (Number.isFinite(Number(h.savedExp))) out.savedExp = Number(h.savedExp);
        if (Number.isFinite(Number(h.savedPLevel))) out.savedPLevel = Number(h.savedPLevel);
        if (h.sectorDeaths && typeof h.sectorDeaths === 'object') out.sectorDeaths = h.sectorDeaths;
        if (h.clearedLevels && typeof h.clearedLevels === 'object') out.clearedLevels = h.clearedLevels;
        return out;
    } catch (e) { return {}; }
}
function saveHigh(h) {
    try {
        if (!h || typeof h !== 'object') return;
        localStorage.setItem(VITA_HIGH_KEY, JSON.stringify(h));
    } catch (e) {}
}

// ============================================================
// SUBTLE DIFFICULTY ADAPTATION SYSTEM (Dynamic Pity & Scaling)
// ============================================================
let currentAdaptation = {
    deaths: 0,
    extraMedPod: false,
    monsterCountReduction: 0,
    monsterSpeedMult: 1.0,
    monsterHpMult: 1.0
};
let artifactMagnetTimer = 0;

function trackDeathForAdaptation(level) {
    const lvl = Math.max(0, Math.min(LEVELS - 1, Math.floor(Number(level) || 0)));
    const h = loadHigh();
    if (!h.sectorDeaths || typeof h.sectorDeaths !== 'object') h.sectorDeaths = {};
    h.sectorDeaths[lvl] = (Number(h.sectorDeaths[lvl]) || 0) + 1;
    saveHigh(h);
}

function applyAdaptation(level) {
    const lvl = Math.max(0, Math.min(LEVELS - 1, Math.floor(Number(level) || 0)));
    const h = loadHigh();
    const deaths = (h.sectorDeaths && typeof h.sectorDeaths === 'object' && Number(h.sectorDeaths[lvl])) || 0;
    const cleared = !!(h.clearedLevels && typeof h.clearedLevels === 'object' && h.clearedLevels[lvl]);

    currentAdaptation = {
        deaths: deaths,
        extraMedPod: deaths >= 2,
        monsterCountReduction: deaths >= 3 ? 1 : 0,
        monsterSpeedMult: deaths >= 4 ? 0.92 : 1.0,
        monsterHpMult: (!cleared ? 0.90 : 1.0)
    };
    return currentAdaptation;
}

function updateEmergencyArtifactMagnet() {
    if (!artifacts || !artifacts.length || !player) return;
    const collectedRatio = coinsCollected / artifacts.length;
    const hpRatio = player.maxHp > 0 ? (player.hp / player.maxHp) : 1;
    if (collectedRatio < 0.70 || hpRatio >= 0.25) return;

    artifactMagnetTimer++;
    if (artifactMagnetTimer < 180) return; // ~3 detik sekali pada 60 FPS
    artifactMagnetTimer = 0;

    const px = Math.floor(player.x / CELL);
    const py = Math.floor(player.y / CELL);

    artifacts.forEach(a => {
        if (a.collected) return;
        const ax = Math.floor(a.x / CELL);
        const ay = Math.floor(a.y / CELL);
        if (typeof bfsPath !== 'function') return;
        const path = bfsPath(ax, ay, px, py);
        if (path && path.length > 2) {
            // Bergeser 1-2 sel mendekati posisi player sepanjang koridor
            const steps = Math.min(2, path.length - 2);
            const targetIdx = path[steps - 1];
            const nextGx = targetIdx % mazeW;
            const nextGy = (targetIdx / mazeW) | 0;
            if (maze && maze[nextGy] && maze[nextGy][nextGx] === 0) {
                a.gx = nextGx;
                a.gy = nextGy;
                a.x = nextGx * CELL + CELL / 2;
                a.y = nextGy * CELL + CELL / 2;
                if (typeof addParticle === 'function') {
                    addParticle(a.x, a.y, (a.type && a.type.color) || '#00f0ff', 6, 2, 20);
                }
            }
        }
    });
}

function formatTime(sec) {
    const s0 = Number(sec);
    if (!Number.isFinite(s0) || s0 < 0) return '-';
    const m = Math.floor(s0 / 60), s = Math.floor(s0 % 60);
    return m + ':' + String(s).padStart(2, '0');
}
// Peringkat kemenangan berdasar waktu total 15 level (S ≤ 15 mnt).
function winGrade(sec) {
    const t = Number(sec);
    if (!Number.isFinite(t) || t < 0) return 'C';
    if (t <= 900) return 'S';
    if (t <= 1400) return 'A';
    if (t <= 2200) return 'B';
    return 'C';
}

const MONSTER_TYPES = [
    { name: 'Slime', color: '#2ecc71', speed: 0.8, hp: 30, atk: 8, size: 12, exp: 10 },
    { name: 'Bat', color: '#9b59b6', speed: 1.5, hp: 20, atk: 12, size: 10, exp: 15 },
    { name: 'Crawl', color: '#a82c2c', speed: 1.45, hp: 45, atk: 16, size: 13, exp: 22 },
    { name: 'Ghost', color: '#3498db', speed: 1.2, hp: 40, atk: 18, size: 13, exp: 25 },
    { name: 'Harvester', color: '#7a1515', speed: 0, hp: 120, atk: 65, size: 20, exp: 50 },
    { name: 'Dark Knight', color: '#2c3e50', speed: 0.9, hp: 100, atk: 28, size: 15, exp: 40 },
    { name: 'Dragon', color: '#e67e22', speed: 1.4, hp: 80, atk: 35, size: 18, exp: 50 },
    { name: 'Lich', color: '#8e44ad', speed: 1.3, hp: 60, atk: 40, size: 14, exp: 45 },
    { name: 'Beholder', color: '#1abc9c', speed: 1.0, hp: 120, atk: 30, size: 20, exp: 60 },
    { name: 'Mimic', color: '#8b2500', speed: 1.35, hp: 90, atk: 35, size: 17, exp: 55 },
    { name: 'Final Boss', color: '#f1c40f', speed: 1.6, hp: 200, atk: 45, size: 22, exp: 100 },
    { name: 'The Monolith', color: '#c91c1c', speed: 0, hp: 600, atk: 60, size: 135, exp: 500 }
];

const ARTIFACT_TYPES = [
    { name: 'Coin Emas', nameEn: 'Gold Coin', color: '#f1c40f', shape: 'circle' },
    { name: 'Permata Biru', nameEn: 'Blue Gem', color: '#3498db', shape: 'diamond' },
    { name: 'Rubi Merah', nameEn: 'Red Ruby', color: '#e74c3c', shape: 'diamond' },
    { name: 'Kristal Hijau', nameEn: 'Green Crystal', color: '#2ecc71', shape: 'square' },
    { name: 'Amethyst Ungu', nameEn: 'Purple Amethyst', color: '#9b59b6', shape: 'square' },
    { name: 'Artefak Kuno', nameEn: 'Ancient Artifact', color: '#e67e22', shape: 'star' },
    { name: 'Cincin Sakti', nameEn: 'Magic Ring', color: '#ecf0f1', shape: 'ring' }
];

function findFarSpot(minDist, taken) {
    let cx = 1, cy = 1;
    let attempts = 0;
    const isTaken = (x, y) => taken && taken.has(x + ',' + y);
    do {
        cx = Math.floor(Math.random() * (mazeW - 2)) + 1;
        cy = Math.floor(Math.random() * (mazeH - 2)) + 1;
        attempts++;
    } while (attempts < 500 && (!maze[cy] || maze[cy][cx] !== 0 || isTaken(cx, cy) || Math.sqrt((cx - 1.5) ** 2 + (cy - 1.5) ** 2) < minDist));
    if (!maze[cy] || maze[cy][cx] !== 0 || isTaken(cx, cy)) {
        // Fallback: cari sel terbuka pertama yang belum dipakai.
        let found = false;
        for (let y = mazeH - 2; y >= 1 && !found; y--) {
            for (let x = mazeW - 2; x >= 1 && !found; x--) {
                if (maze[y] && maze[y][x] === 0 && !isTaken(x, y)) { cx = x; cy = y; found = true; }
            }
        }
        if (!found) { cy = mazeH - 2; cx = mazeW - 2; }
    }
    if (taken) taken.add(cx + ',' + cy);
    return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, gx: cx, gy: cy };
}

// Jaminan anti-buntu: sambungkan setiap sel terbuka yang terisolasi
// (pulau extraPaths/rooms/sudut genap) ke area spawn via koridor-L.
// Tanpa ini exit/artefak bisa spawn di pulau tak terjangkau -> softlock.
function ensureConnectivity() {
    const open = (x, y) => x >= 1 && y >= 1 && x < mazeW - 1 && y < mazeH - 1 && maze[y][x] !== 1;
    const linked = (x, y) => open(x, y) && reached[y][x];
    const reached = [];
    for (let y = 0; y < mazeH; y++) { reached[y] = []; for (let x = 0; x < mazeW; x++) reached[y][x] = false; }
    const qx = [1], qy = [1];
    reached[1][1] = true;
    while (qx.length) {
        const x = qx.pop(), y = qy.pop();
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let i = 0; i < nb.length; i++) {
            const nx = x + nb[i][0], ny = y + nb[i][1];
            if (!open(nx, ny) || reached[ny][nx]) continue;
            reached[ny][nx] = true;
            qx.push(nx); qy.push(ny);
        }
    }
    for (let y = 1; y < mazeH - 1; y++) {
        for (let x = 1; x < mazeW - 1; x++) {
            if (maze[y][x] === 1 || reached[y][x]) continue;
            let cx = x;
            while (cx > 1 && !linked(cx - 1, y)) {
                if (maze[y][cx] === 1) maze[y][cx] = 0;
                reached[y][cx] = true;
                cx--;
            }
            if (maze[y][cx] === 1) maze[y][cx] = 0;
            reached[y][cx] = true;
            let cy = y;
            while (cy > 1 && !linked(cx, cy - 1)) {
                if (maze[cy][cx] === 1) maze[cy][cx] = 0;
                reached[cy][cx] = true;
                cy--;
            }
            if (maze[cy][cx] === 1) maze[cy][cx] = 0;
            reached[cy][cx] = true;
        }
    }
}

function generateMaze(level) {
    if (level === LEVELS - 1) {
        // --- SEKTOR 15: THE MONOLITH SANCTUM (RUANGAN LINGKARAN RAKSASA) ---
        // Tidak di maze biasa: Koridor masuk selatan menuju arena lingkaran masif
        const mW = 38;
        const mH = 40;
        mazeW = mW;
        mazeH = mH;
        const grid = [];
        for (let y = 0; y < mH; y++) {
            grid[y] = [];
            for (let x = 0; x < mW; x++) {
                grid[y][x] = 1;
            }
        }

        const cx = Math.floor(mW / 2); // 19
        const cy = 17;                 // Titik pusat lingkaran arena
        const arenaR = 14.5;           // Radius lingkaran raksasa (diameter 29 tiles!)

        // 1. Ukir ruangan lingkaran raksasa di bagian atas/tengah
        for (let y = 1; y < mH - 1; y++) {
            for (let x = 1; x < mW - 1; x++) {
                const d = Math.hypot(x - cx, y - cy);
                if (d < arenaR) {
                    grid[y][x] = 0; // Area lantai arena terbuka
                }
            }
        }

        // 2. Pilar bio-containment di sekeliling lingkaran untuk perlindungan taktis (cover)
        const pillarAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
        const pDist = 10.5;
        pillarAngles.forEach(ang => {
            const px = Math.round(cx + Math.cos(ang) * pDist);
            const py = Math.round(cy + Math.sin(ang) * pDist);
            for (let dy = -1; dy <= 0; dy++) {
                for (let dx = -1; dx <= 0; dx++) {
                    if (grid[py + dy] && grid[py + dy][px + dx] !== undefined) {
                        grid[py + dy][px + dx] = 1; // Pilar pelindung
                    }
                }
            }
        });

        // 3. Entrance Corridor di bagian selatan menuju ke ruangan lingkaran
        const corridorStart = Math.floor(cy + arenaR) - 1;
        for (let y = corridorStart; y <= mH - 2; y++) {
            for (let x = cx - 1; x <= cx + 1; x++) {
                grid[y][x] = 0;
            }
        }

        // Airlock Chamber awal tempat spawn pemain di dasar koridor
        for (let x = cx - 2; x <= cx + 2; x++) {
            grid[mH - 3][x] = 0;
            grid[mH - 2][x] = 0;
        }

        maze = grid;
        return;
    }

    const baseW = Math.min(46, 18 + level * 2);
    const baseH = Math.min(34, 14 + Math.floor(level * 1.5));
    mazeW = baseW;
    mazeH = baseH;

    const grid = [];
    for (let y = 0; y < mazeH; y++) {
        grid[y] = [];
        for (let x = 0; x < mazeW; x++) {
            grid[y][x] = 1;
        }
    }

    function carve(x, y) {
        grid[y][x] = 0;
        const dirs = [[0,-2],[0,2],[-2,0],[2,0]];
        shuffle(dirs);
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx > 0 && nx < mazeW - 1 && ny > 0 && ny < mazeH - 1 && grid[ny][nx] === 1) {
                grid[y + dy/2][x + dx/2] = 0;
                carve(nx, ny);
            }
        }
    }

    carve(1, 1);

    const extraPaths = 5 + level * 3;
    for (let i = 0; i < extraPaths; i++) {
        const x = Math.floor(Math.random() * (mazeW - 2)) + 1;
        const y = Math.floor(Math.random() * (mazeH - 2)) + 1;
        if (grid[y][x] === 1) {
            grid[y][x] = 0;
        }
    }

    const rooms = 3 + Math.floor(level / 2);
    for (let r = 0; r < rooms; r++) {
        const rw = 2 + Math.floor(Math.random() * 3);
        const rh = 2 + Math.floor(Math.random() * 3);
        const rx = Math.floor(Math.random() * (mazeW - rw - 2)) + 1;
        const ry = Math.floor(Math.random() * (mazeH - rh - 2)) + 1;
        for (let y = ry; y < ry + rh; y++) {
            for (let x = rx; x < rx + rw; x++) {
                if (y > 0 && y < mazeH - 1 && x > 0 && x < mazeW - 1) {
                    grid[y][x] = 0;
                }
            }
        }
    }

    // Special Procedural Room Templates (Treasure Vault, Atrium Arena, Panic Section)
    if (level >= 2) {
        // Treasure Vault: Ruang 4x4 dengan sekeliling jebakan duri
        const vx = Math.floor(Math.random() * (mazeW - 6)) + 1;
        const vy = Math.floor(Math.random() * (mazeH - 6)) + 1;
        for (let y = vy; y < vy + 4; y++) {
            for (let x = vx; x < vx + 4; x++) {
                if (y > 0 && y < mazeH - 1 && x > 0 && x < mazeW - 1) {
                    grid[y][x] = 0;
                    if ((x === vx || x === vx + 3 || y === vy || y === vy + 3) && Math.random() < 0.35) {
                        grid[y][x] = 2;
                    }
                }
            }
        }
    }
    if (level >= 3) {
        // Open Atrium Arena: Ruang tembak terbuka 5x5 dengan pilar bio-containment di tengah
        const ax = Math.floor(Math.random() * (mazeW - 7)) + 1;
        const ay = Math.floor(Math.random() * (mazeH - 7)) + 1;
        for (let y = ay; y < ay + 5; y++) {
            for (let x = ax; x < ax + 5; x++) {
                if (y > 0 && y < mazeH - 1 && x > 0 && x < mazeW - 1) {
                    grid[y][x] = 0;
                }
            }
        }
        if (ay + 2 < mazeH - 1 && ax + 2 < mazeW - 1) {
            grid[ay + 2][ax + 2] = 1; // Pilar pelindung tembakan
        }
    }

    for (let y = 1; y < mazeH - 1; y++) {
        for (let x = 1; x < mazeW - 1; x++) {
            if (grid[y][x] === 0 && Math.random() < 0.03 + level * 0.005) {
                grid[y][x] = 2;
            }
        }
    }

    grid[1][1] = 0;
    grid[mazeH - 2][mazeW - 2] = 0;

    // Adaptive Trap Placement: Trap tidak boleh spawn dalam radius 3 sel dari posisi spawn player di awal level
    const pSpawnX = (level === LEVELS - 1) ? Math.floor(mazeW / 2) : 1;
    const pSpawnY = (level === LEVELS - 1) ? 17 : 1;
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
            const nx = pSpawnX + dx, ny = pSpawnY + dy;
            if (nx >= 0 && nx < mazeW && ny >= 0 && ny < mazeH) {
                if (Math.hypot(dx, dy) <= 3.2 && grid[ny][nx] === 2) {
                    grid[ny][nx] = 0;
                }
            }
        }
    }

    maze = grid;
    ensureConnectivity();
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function hasOpenNeighbor(row, col) {
    return (maze[row - 1] && maze[row - 1][col] === 0) ||
           (maze[row + 1] && maze[row + 1][col] === 0) ||
           maze[row][col - 1] === 0 ||
           maze[row][col + 1] === 0;
}

function spawnMonsters(level) {
    monsters = [];
    const diffSpeedMult = getDiffSpeedMult();
    const diffStatMult = getDiffStatMult();

    if (level === LEVELS - 1) {
        // --- LEVEL 15: THE MONOLITH (COELUM CARNIS) ---
        const cx = Math.floor(mazeW / 2);
        const cy = 17;
        const mono = MONSTER_TYPES.find(t => t.name === 'The Monolith') || {
            name: 'The Monolith', color: '#c91c1c', speed: 0, hp: 600, atk: 60, size: 135, exp: 500
        };

        monsters.push({
            name: 'The Monolith',
            color: '#c91c1c',
            x: cx * CELL + CELL / 2,
            y: cy * CELL + CELL / 2,
            rootX: cx * CELL + CELL / 2,
            rootY: cy * CELL + CELL / 2,
            vx: 0,
            vy: 0,
            hp: Math.round(mono.hp * 4.5 * diffStatMult * currentAdaptation.monsterHpMult),
            maxHp: Math.round(mono.hp * 4.5 * diffStatMult * currentAdaptation.monsterHpMult),
            atk: Math.round(mono.atk * diffStatMult),
            speed: 0,
            size: mono.size,
            exp: mono.exp,
            isBoss: true,
            isMonolith: true,
            ai: 'boss_stationary',
            state: 'chase',
            angle: Math.PI / 2,
            wanderTimer: 9999,
            stuckTimer: 0,
            blocked: false,
            rx: 0, ry: 0, turnDir: 1, netT2: 0,
            lastWatchX: cx * CELL, lastWatchY: cy * CELL,
            lastSeen: null, lastSeenTimer: 0,
            path: null, pathIdx: 0, pathCooldown: 0,
            stall: 0, lastWayD: 99999, checkTimer: 30,
            lastPosX: 0, lastPosY: 0, wanderTarget: null,
            pauseTimer: 0, lastPx: -1, lastPy: -1,
            attackCooldown: 0, stunTimer: 0, hitFlash: 0,
            level: level, ranged: true,
            slamTimer: 180, sporeTimer: 120, tendrilTimer: 90,
            weakPointTimer: 0, phase3Pulse: 0
        });

        // 3 Crawlers pengawal di perimeter lingkaran
        for (let i = 0; i < 3; i++) {
            const ang = (i / 3) * Math.PI * 2 + Math.PI / 6;
            const rx = Math.round(cx + Math.cos(ang) * 11);
            const ry = Math.round(cy + Math.sin(ang) * 11);
            monsters.push({
                name: 'Crawl',
                color: '#a82c2c',
                x: rx * CELL + CELL / 2,
                y: ry * CELL + CELL / 2,
                vx: 0, vy: 0,
                hp: Math.round(55 * diffStatMult * currentAdaptation.monsterHpMult),
                maxHp: Math.round(55 * diffStatMult * currentAdaptation.monsterHpMult),
                atk: Math.round(18 * diffStatMult),
                speed: 1.4 * diffSpeedMult * currentAdaptation.monsterSpeedMult,
                size: 13, exp: 22,
                ai: 'chase', state: 'wander',
                angle: Math.random() * Math.PI * 2,
                wanderTimer: 40, stuckTimer: 0, blocked: false,
                rx: 0, ry: 0, turnDir: 1, netT2: 0,
                lastWatchX: rx * CELL, lastWatchY: ry * CELL,
                lastSeen: null, lastSeenTimer: 0,
                path: null, pathIdx: 0, pathCooldown: 30,
                stall: 0, lastWayD: 99999, checkTimer: 30,
                lastPosX: 0, lastPosY: 0, wanderTarget: null,
                pauseTimer: 0, lastPx: -1, lastPy: -1,
                attackCooldown: 0, stunTimer: 0, hitFlash: 0,
                level: level, ranged: false
            });
        }
        return;
    }

    const count = Math.max(1, Math.min(28, 5 + level * 2) - currentAdaptation.monsterCountReduction);
    const isLight = level % 2 === 1;

    for (let i = 0; i < count; i++) {
        let mx, my;
        let attempts = 0;
        do {
            mx = Math.floor(Math.random() * (mazeW - 2)) + 1;
            my = Math.floor(Math.random() * (mazeH - 2)) + 1;
            attempts++;
        } while ((maze[my][mx] !== 0 || (mx < 4 && my < 4) || !hasOpenNeighbor(my, mx)) && attempts < 200);

        if (attempts >= 200) continue;

        // Pilih tipe monster secara kontekstual sesuai sektor fasilitas
        const maxTypeIdx = MONSTER_TYPES.length - 2; // Kecuali The Monolith yang khusus level 15
        let type;
        if (level === 5 && (i < 3 || Math.random() < 0.5)) {
            // Sektor 06: Blok Isolasi Mimic (Bangsal Topeng Porselen)
            type = MONSTER_TYPES.find(t => t.name === 'Mimic') || MONSTER_TYPES[0];
        } else if (level === 4 && (i < 3 || Math.random() < 0.45)) {
            // Sektor 05: Kubah Inkubasi Harvester (Hutan Batang Harvester)
            type = MONSTER_TYPES.find(t => t.name === 'Harvester') || MONSTER_TYPES[0];
        } else if (level === 2 && (i < 3 || Math.random() < 0.45)) {
            // Sektor 03: Sarang Spesimen Crawl
            type = MONSTER_TYPES.find(t => t.name === 'Crawl') || MONSTER_TYPES[0];
        } else {
            const typeIdx = Math.min(Math.floor(level * 0.8 + Math.random() * 2), maxTypeIdx);
            type = MONSTER_TYPES[typeIdx];
            // Di level 6 ke atas, Mimic juga berkeliaran sebagai predator berbahaya
            if (level >= 6 && Math.random() < 0.22) {
                type = MONSTER_TYPES.find(t => t.name === 'Mimic') || type;
            }
        }
        // Kurva sigmoid: lambat di awal, percepatan di mid-game, stabil di late-game
        // LV1≈1.04x → LV5≈1.66x → LV8≈2.67x → LV12≈3.35x → LV14≈3.48x
        const diffMult = 1 + 2.5 * (1 / (1 + Math.exp(-0.45 * (level - 7))));

        let speed = type.speed * (0.9 + level * 0.05) * diffSpeedMult * currentAdaptation.monsterSpeedMult;
        let hp = type.hp * diffMult * diffStatMult * currentAdaptation.monsterHpMult;
        let atk = type.atk * diffMult * diffStatMult;

        if (isLight) {
            hp *= 1.3;
            atk *= 1.3;
            speed *= 1.1;
        } else {
            hp *= 0.85;
            atk *= 0.85;
            speed *= 0.95;
        }

        if (level > 5) {
            hp *= 1.2;
            atk *= 1.2;
        }

        const isHarv = type.name === 'Harvester';
        const hFilaments = [];
        if (isHarv) {
            speed = 0;
            const hDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            hDirs.forEach(([dx, dy]) => {
                let curX = mx, curY = my;
                const pts = [{ x: mx * CELL + CELL / 2, y: my * CELL + CELL / 2 }];
                for (let step = 1; step <= 4; step++) {
                    const nx = curX + dx, ny = curY + dy;
                    if (nx > 0 && nx < mazeW - 1 && ny > 0 && ny < mazeH - 1 && maze[ny][nx] === 0) {
                        curX = nx;
                        curY = ny;
                        const organicJitterX = (dy !== 0) ? (Math.random() - 0.5) * 8 : 0;
                        const organicJitterY = (dx !== 0) ? (Math.random() - 0.5) * 8 : 0;
                        pts.push({
                            x: curX * CELL + CELL / 2 + organicJitterX,
                            y: curY * CELL + CELL / 2 + organicJitterY
                        });
                    } else {
                        break;
                    }
                }
                if (pts.length > 1) {
                    hFilaments.push(pts);
                }
            });
        }

        monsters.push({
            x: mx * CELL + CELL / 2,
            y: my * CELL + CELL / 2,
            rootX: isHarv ? (mx * CELL + CELL / 2) : undefined,
            rootY: isHarv ? (my * CELL + CELL / 2) : undefined,
            isHarvester: isHarv,
            filaments: isHarv ? hFilaments : undefined,
            filamentTrapCooldown: 0,
            vx: 0,
            vy: 0,
            hp: hp,
            maxHp: hp,
            atk: isHarv ? 65 : atk,
            speed: isHarv ? 0 : speed,
            size: isHarv ? 22 : Math.min(type.size + level, 18),
            color: type.color,
            name: type.name,
            exp: type.exp,
            ai: Math.random() < 0.3 + level * 0.05 ? 'chase' : 'patrol',
            state: 'wander',
            angle: Math.random() * Math.PI * 2,
            wanderTimer: 50 + Math.random() * 100,
            stuckTimer: 0,
            blocked: false,
            rx: 0,
            ry: 0,
            turnDir: Math.random() < 0.5 ? 1 : -1,
            netT2: 0,
            lastWatchX: 0,
            lastWatchY: 0,
            lastSeen: null,
            lastSeenTimer: 0,
            path: null,
            pathIdx: 0,
            pathCooldown: 30,
            stall: 0,
            lastWayD: 99999,
            checkTimer: 30,
            lastPosX: 0,
            lastPosY: 0,
            wanderTarget: null,
            pauseTimer: 0,
            lastPx: -1,
            lastPy: -1,
            attackCooldown: 0,
            stunTimer: 0,
            hitFlash: 0,
            burnTimer: 0,
            freezeTimer: 0,
            poisonTimer: 0,
            diveTimer: 0,
            disguised: type.name === 'Mimic' && Math.random() < 0.45,
            riposteTimer: 0,
            shieldDeflectCount: 0,
            isPhasing: 0,
            phaseCooldown: 0,
            retreatTimer: 0,
            dragonBreathTimer: 100 + Math.floor(Math.random() * 80),
            lichSummonTimer: 160 + Math.floor(Math.random() * 120),
            beholderCharge: 0,
            beholderCooldown: 140 + Math.floor(Math.random() * 90),
            weakPointTimer: 0,
            level: level,
            ranged: level > 4 && Math.random() < 0.2 + level * 0.03
        });
    }

    if (level === 9 && !monsters.some(m => m.name === 'Mother Harvester')) {
        // Sektor 10 APEX BOSS: MOTHER HARVESTER (Congregentur Carnis)
        // Ditempatkan di spot terbuka yang jauh dari titik start pemain
        const bossSpot = findFarSpot(10);
        const bmx = Math.floor(bossSpot.x / CELL);
        const bmy = Math.floor(bossSpot.y / CELL);

        // Super-jaringan filamen akar menjalar 4 arah hingga 11 langkah koridor dengan cabang-cabang lateral
        const motherFilaments = [];
        const cardDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        cardDirs.forEach(([dx, dy]) => {
            let cx = bmx, cy = bmy;
            const mainPts = [{ x: bmx * CELL + CELL / 2, y: bmy * CELL + CELL / 2 }];
            for (let step = 1; step <= 11; step++) {
                const nx = cx + dx, ny = cy + dy;
                if (nx > 0 && nx < mazeW - 1 && ny > 0 && ny < mazeH - 1 && maze[ny][nx] === 0) {
                    cx = nx;
                    cy = ny;
                    const jx = (dy !== 0) ? (Math.random() - 0.5) * 8 : 0;
                    const jy = (dx !== 0) ? (Math.random() - 0.5) * 8 : 0;
                    const curPt = { x: cx * CELL + CELL / 2 + jx, y: cy * CELL + CELL / 2 + jy };
                    mainPts.push(curPt);

                    // Cabang lateral ke lorong samping di tiap persimpangan
                    if (step % 3 === 0) {
                        const sideDirs = (dx !== 0) ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
                        sideDirs.forEach(([sx, sy]) => {
                            let scx = cx, scy = cy;
                            const sidePts = [{ x: curPt.x, y: curPt.y }];
                            for (let sStep = 1; sStep <= 4; sStep++) {
                                const snx = scx + sx, sny = scy + sy;
                                if (snx > 0 && snx < mazeW - 1 && sny > 0 && sny < mazeH - 1 && maze[sny][snx] === 0) {
                                    scx = snx;
                                    scy = sny;
                                    sidePts.push({ x: scx * CELL + CELL / 2, y: scy * CELL + CELL / 2 });
                                } else break;
                            }
                            if (sidePts.length > 1) motherFilaments.push(sidePts);
                        });
                    }
                } else break;
            }
            if (mainPts.length > 1) motherFilaments.push(mainPts);
        });

        monsters.push({
            name: 'Mother Harvester',
            color: '#6e0a0a',
            x: bmx * CELL + CELL / 2,
            y: bmy * CELL + CELL / 2,
            rootX: bmx * CELL + CELL / 2,
            rootY: bmy * CELL + CELL / 2,
            isMotherHarvester: true,
            isHarvester: true,
            filaments: motherFilaments,
            filamentTrapCooldown: 0,
            vx: 0,
            vy: 0,
            hp: Math.round(520 * diffStatMult * currentAdaptation.monsterHpMult),
            maxHp: Math.round(520 * diffStatMult * currentAdaptation.monsterHpMult),
            atk: 75 * diffStatMult,
            speed: 0,
            size: 46,
            isBoss: true,
            exp: 350,
            ai: 'boss_stationary',
            state: 'chase',
            angle: 0,
            wanderTimer: 9999,
            stuckTimer: 0,
            blocked: false,
            rx: 0, ry: 0, turnDir: 1, netT2: 0,
            lastWatchX: bmx * CELL, lastWatchY: bmy * CELL,
            lastSeen: null, lastSeenTimer: 0,
            path: null, pathIdx: 0, pathCooldown: 0,
            stall: 0, lastWayD: 99999, checkTimer: 30,
            lastPosX: 0, lastPosY: 0, wanderTarget: null,
            pauseTimer: 0, lastPx: -1, lastPy: -1,
            attackCooldown: 0, stunTimer: 0, hitFlash: 0,
            level: level, ranged: false,
            sporeSpawnTimer: 240,
            toxicGasTimer: 0
        });
    }
}

function initLevel(level) {
    level = Math.max(0, Math.min(LEVELS - 1, Math.floor(Number(level) || 0)));
    currentLevel = level;
    applyAdaptation(level);
    artifactMagnetTimer = 0;
    generateMaze(level);
    spawnMonsters(level);
    lockMsgCooldown = 0;

    const taken = new Set(['1,1']); // sel start + semua spot unik
    traps = [];
    artifacts = [];
    coinsCollected = 0;

    if (level === LEVELS - 1) {
        // --- LEVEL 15: CIRCULAR ARENA SETUP ---
        const cx = Math.floor(mazeW / 2);
        const cy = 17;
        // 3 Altar Relik Artefak di lantai terbuka luas (Barat, Timur, Utara) bebas dari pilar pelindung
        const relicSpots = [
            { rx: cx - 9, ry: cy },     // Altar Barat (Lantai terbuka)
            { rx: cx + 9, ry: cy },     // Altar Timur (Lantai terbuka)
            { rx: cx,     ry: cy - 9 }  // Altar Utara (Lantai terbuka)
        ];
        for (let i = 0; i < 3; i++) {
            const rx = relicSpots[i].rx;
            const ry = relicSpots[i].ry;
            artifacts.push({
                x: rx * CELL + CELL / 2,
                y: ry * CELL + CELL / 2,
                gx: rx,
                gy: ry,
                collected: false,
                type: ARTIFACT_TYPES[i % ARTIFACT_TYPES.length],
                bobPhase: i * 2
            });
        }
        exitPos = { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, gx: cx, gy: cy };
    } else {
        if (level > 0) {
            const trapCount = 3 + level * 2;
            const pSpawnX = 1, pSpawnY = 1;
            for(let i=0; i<trapCount; i++) {
                let spot = findFarSpot(4, taken);
                let tAttempts = 0;
                while (Math.hypot(spot.gx - pSpawnX, spot.gy - pSpawnY) < 3.2 && tAttempts < 50) {
                    spot = findFarSpot(4, taken);
                    tAttempts++;
                }
                traps.push({
                    x: spot.x, y: spot.y, gx: spot.gx, gy: spot.gy,
                    type: 'spikes',
                    state: 'hidden',
                    timer: 60 + Math.random() * 120,
                    cool: 0
                });
            }
        }

        const artifactCount = 3 + level;
        const usedTypes = shuffle([...ARTIFACT_TYPES]);
        for (let i = 0; i < artifactCount; i++) {
            const type = usedTypes[i % usedTypes.length];
            const spot = findFarSpot(5 + level, taken);
            artifacts.push({
                x: spot.x,
                y: spot.y,
                gx: spot.gx,
                gy: spot.gy,
                collected: false,
                type: type,
                bobPhase: Math.random() * Math.PI * 2
            });
        }

        wreckedRobot = null;
        exitPos = findFarSpot(Math.min(8 + level, mazeW * 0.5), taken);
        if (level === 9 && exitPos) {
            // Sektor 10: Rongsokan robot BMPT di samping gerbang keluar
            let rx = exitPos.gx + 1, ry = exitPos.gy;
            if (maze[ry] && maze[ry][rx] === 0) {
                // open spot to the right
            } else if (maze[ry] && maze[ry][exitPos.gx - 1] === 0) {
                rx = exitPos.gx - 1;
            } else if (maze[exitPos.gy + 1] && maze[exitPos.gy + 1][exitPos.gx] === 0) {
                rx = exitPos.gx; ry = exitPos.gy + 1;
            } else if (maze[exitPos.gy - 1] && maze[exitPos.gy - 1][exitPos.gx] === 0) {
                rx = exitPos.gx; ry = exitPos.gy - 1;
            } else {
                rx = exitPos.gx; ry = exitPos.gy;
            }
            wreckedRobot = {
                gx: rx,
                gy: ry,
                x: rx * CELL + CELL / 2,
                y: ry * CELL + CELL / 2,
                inspected: false
            };
        }
    }

    // Spawn Classified Lore Data Discs & Volatile Biohazard Barrels
    dataDiscs = [];
    barrels = [];
    if (typeof LORE_DATA_LOGS !== 'undefined') {
        const logEntry = LORE_DATA_LOGS.find(l => l.level === level);
        if (logEntry) {
            const spot = findFarSpot(5, taken);
            dataDiscs.push({
                x: spot.x, y: spot.y, gx: spot.gx, gy: spot.gy,
                log: logEntry, collected: false, bobPhase: 0
            });
        }
    }
    if (level > 0 && level < LEVELS - 1) {
        const barrelCount = 2 + (level % 3);
        for (let i = 0; i < barrelCount; i++) {
            const spot = findFarSpot(4, taken);
            barrels.push({
                x: spot.x, y: spot.y, gx: spot.gx, gy: spot.gy,
                hp: 1, exploded: false
            });
        }
    }

    // Spawn Nanite Medical Chambers in Key Sectors (Sector 4, 8, 12)
    medPods = [];
    if (level === 3 || level === 7 || level === 11) {
        const spot = findFarSpot(6, taken);
        medPods.push({
            x: spot.x, y: spot.y, gx: spot.gx, gy: spot.gy,
            used: false, pulse: 0
        });
    }

    // Adaptive Pity: 2+ kematian di sektor yang sama memunculkan 1 MedPod tambahan tersembunyi dekat spawn
    if (currentAdaptation && currentAdaptation.extraMedPod) {
        let extraSpot = null;
        const pX = (level === LEVELS - 1) ? Math.floor(mazeW / 2) : 1;
        const pY = (level === LEVELS - 1) ? 17 : 1;
        for (let r = 3; r <= 8 && !extraSpot; r++) {
            for (let dy = -r; dy <= r && !extraSpot; dy++) {
                for (let dx = -r; dx <= r && !extraSpot; dx++) {
                    const nx = pX + dx, ny = pY + dy;
                    const d = Math.hypot(dx, dy);
                    if (d >= 2.5 && d <= r + 0.5 && ny > 0 && ny < mazeH - 1 && nx > 0 && nx < mazeW - 1) {
                        if (maze[ny] && maze[ny][nx] === 0 && !taken.has(nx + ',' + ny)) {
                            extraSpot = { x: nx * CELL + CELL / 2, y: ny * CELL + CELL / 2, gx: nx, gy: ny };
                            taken.add(nx + ',' + ny);
                        }
                    }
                }
            }
        }
        if (extraSpot) {
            medPods.push({
                x: extraSpot.x, y: extraSpot.y, gx: extraSpot.gx, gy: extraSpot.gy,
                used: false, pulse: 0
            });
        }
    }

    const savedRun = (!player && level > 0) ? loadHigh() : null;
    const preservedWeapons = (player && Array.isArray(player.weapons) && level > 0)
        ? [...player.weapons]
        : (savedRun && Array.isArray(savedRun.savedWeapons) && savedRun.savedWeapons.length ? [...savedRun.savedWeapons] : ['knife']);
    const preservedCurWeapon = (player && player.currentWeapon && preservedWeapons.includes(player.currentWeapon))
        ? player.currentWeapon
        : (savedRun && savedRun.savedCurrentWeapon && preservedWeapons.includes(savedRun.savedCurrentWeapon) ? savedRun.savedCurrentWeapon : 'knife');
    const preservedExp = (player && level > 0) ? (player.exp || 0) : (savedRun ? (savedRun.savedExp || 0) : 0);
    const preservedPLevel = (player && level > 0) ? (player.plevel || 1) : (savedRun ? (savedRun.savedPLevel || 1) : 1);
    const preservedPerks = (player && Array.isArray(player.perks) && level > 0)
        ? [...player.perks]
        : (savedRun && Array.isArray(savedRun.savedPerks) ? [...savedRun.savedPerks] : []);

    const perkNano = preservedPerks.filter(p => p === 'nano_plating').length;
    const perkAdren = preservedPerks.filter(p => p === 'adrenaline').length;
    const perkPlasma = preservedPerks.filter(p => p === 'plasma').length;
    const perkCryo = preservedPerks.filter(p => p === 'cryo_vent').length;
    const perkVamp = preservedPerks.filter(p => p === 'vampiric').length;
    const perkRico = preservedPerks.filter(p => p === 'ricochet').length;
    const perkEmp = preservedPerks.filter(p => p === 'kinetic_emp').length;
    const perkTherm = preservedPerks.filter(p => p === 'thermal_trail').length;

    let baseMaxHp = 100 + level * 10 + (perkNano * 50);
    let baseAtk = 20 + level * 3;
    if (perkPlasma > 0) {
        baseAtk = Math.round(baseAtk * Math.pow(1.3, perkPlasma));
    }
    let baseSpeed = 3.5 + (perkAdren * 0.55);
    let baseDashSpeed = 8 + (perkAdren * 1.5);

    const startX = (level === LEVELS - 1) ? (Math.floor(mazeW / 2) + 0.5) * CELL : 1.5 * CELL;
    const startY = (level === LEVELS - 1) ? (mazeH - 2.5) * CELL : 1.5 * CELL;

    player = {
        x: startX,
        y: startY,
        size: 10,
        hp: baseMaxHp,
        maxHp: baseMaxHp,
        atk: baseAtk,
        exp: preservedExp,
        plevel: preservedPLevel,
        speed: baseSpeed,
        dashSpeed: baseDashSpeed,
        dashing: false,
        dashTimer: 0,
        invincible: 0,
        attackAnim: 0,
        facing: 0,
        level: level,
        weapons: preservedWeapons,
        currentWeapon: preservedCurWeapon,
        perks: preservedPerks,
        perkNano: perkNano,
        perkAdrenaline: perkAdren,
        perkPlasma: perkPlasma,
        perkCryo: perkCryo,
        perkVampire: perkVamp,
        perkRicochet: perkRico,
        perkEmp: perkEmp,
        perkThermal: perkTherm,
        shieldTimer: 0,
        minigunHeat: 0,
        minigunOverheat: 0,
        weaponCooldowns: {},
        afterimages: []
    };

    // Save run progress & equipment state
    if (!menuDemo) {
        try {
            const high = loadHigh();
            high.lastLevel = level;
            high.savedWeapons = [...player.weapons];
            high.savedCurrentWeapon = player.currentWeapon;
            high.savedPerks = [...player.perks];
            high.savedExp = player.exp;
            high.savedPLevel = player.plevel;
            saveHigh(high);
            checkContinueBtn();
        } catch(e){}
    }

    particles = [];
    thermalTrails = [];
    projectiles = [];
    shockwaves = [];
    gasClouds = [];
    brassCasings = [];
    fogOfWar = [];
    visitedTiles = [];
    exploredCells.fill(0);
    for (let y = 0; y < mazeH; y++) {
        fogOfWar[y] = [];
        visitedTiles[y] = [];
        for (let x = 0; x < mazeW; x++) {
            fogOfWar[y][x] = false;
            visitedTiles[y][x] = false;
        }
    }

    dashCooldown = 0;
    attackCooldown = 0;
    levelStartTime = Date.now();
    levelTransition = false;

    initSpores();
    updateUI();

    const announce = document.getElementById('levelAnnounce');
    if (!menuDemo) {
        const isLight = level % 2 === 1;
        const msgList = [
            lang === 'en' ? 'SEC-01: BIOLOGICAL CONTAMINATION' : 'SEKTOR 01: KONTAMINASI BIOLOGIS AWAL',
            lang === 'en' ? 'SEC-02: AIRBORNE CARNIS SPORES' : 'SEKTOR 02: SPORA CARNIS DI UDARA',
            lang === 'en' ? 'SEC-03: SPECIMEN CRAWLER NEST' : 'SEKTOR 03: SARANG SPESIMEN CRAWL',
            lang === 'en' ? 'SEC-04: TISSUE CULTURE CHAMBER' : 'SEKTOR 04: RUANG KULTUR JARINGAN',
            lang === 'en' ? 'SEC-05: HARVESTER INCUBATION VAULT' : 'SEKTOR 05: KUBAH INKUBASI HARVESTER',
            lang === 'en' ? 'SEC-06: MIMIC ISOLATION BLOCK' : 'SEKTOR 06: BLOK ISOLASI MIMIC',
            lang === 'en' ? 'SEC-07: VASCULAR SEPARATION SECTOR' : 'SEKTOR 07: SEKTOR VASKULAR TERPISAH',
            lang === 'en' ? 'SEC-08: ELDRITCH BIOMASS WELL' : 'SEKTOR 08: SUMUR BIOMASSA ELDRITCH',
            lang === 'en' ? 'SEC-09: BEHOLDER MONITORING TOWER' : 'SEKTOR 09: MENARA PANTAUAN BEHOLDER',
            lang === 'en' ? 'SEC-10: APEX PREDATOR BREACH' : 'SEKTOR 10: JEBOLNYA APEX PREDATOR',
            lang === 'en' ? 'SEC-11: SUB-TERRA EMBRYO VAULT' : 'SEKTOR 11: KUBAH EMBRIO BAWAH TANAH',
            lang === 'en' ? 'SEC-12: DEEP BIOMASS MARROW' : 'SEKTOR 12: SUMSUM BIOMASSA PURBA',
            lang === 'en' ? 'SEC-13: SUBTERRANEAN RESONANCE' : 'SEKTOR 13: GEMA RESONANSI CARNIS',
            lang === 'en' ? 'SEC-14: THE SACRIFICIAL THRESHOLD' : 'SEKTOR 14: AMBANG BATAS PENGORBANAN',
            lang === 'en' ? 'SEC-15: THE MONOLITH // COELUM CARNIS' : 'SEKTOR 15: THE MONOLITH // COELUM CARNIS'
        ];
        const zoneNames = lang === 'en'
            ? ['Subterranean Nursery', 'Spore Extraction Lab', 'Crawler Trench', 'Bone Graft Chamber', 'Harvester Stalk Forest', 'Porcelain Ward', 'The Living Corridors', 'Organ Well Abyss', 'Watcher Sanctorum', 'Apex Containment Core', 'Tissue Receptacle Labs', 'Black Marrow Trench', 'Vocal Organ Chamber', 'Monolith Antechamber', 'Sanctum of the Titan']
            : ['Semaian Bawah Tanah', 'Lab Ekstraksi Spora', 'Parit Crawl', 'Kamar Tandur Tulang', 'Hutan Batang Harvester', 'Bangsal Topeng Porselen', 'Koridor Daging Hidup', 'Jurang Sumur Organ', 'Sanctorum Pengawas', 'Inti Karantina Apex', 'Lab Reseptakel Jaringan', 'Parit Sumsum Hitam', 'Kamar Organ Suara', 'Antekamar Monolith', 'Sanctum Sang Kolosal'];
        if (level === LEVELS - 1) {
            // Bunyikan sirene EAS analog horror & raungan kolosal The Monolith
            sEASAlarm();
            setTimeout(() => sMonolithRoar(), 1400);

            announce.innerHTML = `
                <div class="eas-broadcast">
                    <div class="eas-header">⚠️ ${lang === 'en' ? 'GLOBAL EMERGENCY // EAS LEVEL-5 BROADCAST' : 'DARURAT GLOBAL // SIARAN PERINGATAN EAS LEVEL-5'} ⚠️</div>
                    <div class="eas-title">${lang === 'en' ? 'CONVERGENCE DETECTED: 7 MONOLITHS MIGRATING' : 'KONVERGENSI TERDETEKSI: 7 MONOLITH BERGERAK'}</div>
                    <div class="eas-sub">${lang === 'en' ? 'PREVENT THE MERGED &bull; TERMINATE SECTOR 15 MONOLITH' : 'CEGAH PENYATUAN THE MERGED &bull; ELIMINASI MONOLITH SEKTOR 15'}</div>
                </div>
            `;
            announce.style.fontSize = '';
            announce.style.opacity = 1;
            const bEl = document.getElementById('uiBadge');
            if (bEl) bEl.textContent = 'GLOBAL-ALERT // SEC-15';
            setTimeout(() => { announce.style.opacity = 0; }, 4800);
        } else {
            const msg = msgList[level] || ('Level ' + (level + 1));
            const zone = zoneNames[level] || '';
            announce.innerHTML = msg + (zone ? '<span class="zone-name">— ' + zone + ' —</span>' : '');
            announce.style.color = isLight ? '#ff8a3d' : '#ff3636';
            announce.style.fontSize = level === 9 ? '26px' : '22px';
            announce.style.opacity = 1;
            const bEl = document.getElementById('uiBadge');
            if (bEl) bEl.textContent = 'CARNIS-SEC // LV' + (level + 1);
            setTimeout(() => { announce.style.opacity = 0; announce.style.fontSize = ''; }, 3200);
        }

        // Trigger Tactical Comms Transmission if available
        if (typeof SECTOR_TRANSMISSIONS !== 'undefined' && SECTOR_TRANSMISSIONS[level]) {
            setTimeout(() => triggerComms(SECTOR_TRANSMISSIONS[level]), 1200);
        }

        // Live Field Tutorial initialization
        if (level === 0 && !menuDemo) {
            initTutorial();
        } else {
            hideTutorial();
        }
    }
}

// ---- Decal System (Organic Blood & Flesh Decals, Max 60, zero GC stutter) ----
const MAX_DECALS = 60;
let decals = [];
function addDecal(x, y, color, size, type) {
    if (decals.length >= MAX_DECALS) decals.shift();
    decals.push({
        x: Math.round(x),
        y: Math.round(y),
        color: color || '#6b0000',
        size: size || (Math.random() * 4 + 3),
        type: type || 'splat',
        angle: Math.random() * Math.PI * 2,
        alpha: 0.7 + Math.random() * 0.25,
        level: currentLevel
    });
}

function drawDecals() {
    if (!decals.length) return;
    for (let i = 0; i < decals.length; i++) {
        const d = decals[i];
        if (d.level !== currentLevel) continue;
        const sx = d.x - cameraX + W / 2;
        const sy = d.y - cameraY + H / 2;
        if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(d.angle);
        ctx.fillStyle = d.color;
        ctx.globalAlpha = d.alpha;

        if (d.type === 'flesh') {
            ctx.beginPath();
            ctx.ellipse(0, 0, d.size * 1.3, d.size * 0.7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#220000';
            ctx.fillRect(-1.5, -1, 3, 2);
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, d.size, 0, Math.PI * 2);
            ctx.fill();
            for (let j = 0; j < 3; j++) {
                const da = (j / 3) * Math.PI * 2 + 0.3;
                const dist = d.size * (1.2 + j * 0.35);
                ctx.fillRect(Math.cos(da) * dist, Math.sin(da) * dist, 1.6, 1.6);
            }
        }
        ctx.restore();
    }
}

let spores = [];
function initSpores() {
    spores = [];
    const count = 40;
    for (let i = 0; i < count; i++) {
        spores.push({
            x: Math.random() * (mazeW * CELL || 1000),
            y: Math.random() * (mazeH * CELL || 1000),
            vx: (Math.random() - 0.5) * 0.3,
            vy: -Math.random() * 0.4 - 0.1,
            size: Math.random() * 2 + 0.8,
            alpha: Math.random() * 0.5 + 0.2,
            phase: Math.random() * Math.PI * 2
        });
    }
}

function updateSpores() {
    if (!spores) return;
    const t = Date.now() / 1000;
    spores.forEach(sp => {
        sp.x += sp.vx + Math.sin(t * 2 + sp.phase) * 0.2;
        sp.y += sp.vy;
        sp.phase += 0.02;
        if (sp.y < 0) { sp.y = mazeH * CELL; sp.x = Math.random() * mazeW * CELL; }
        if (sp.x < 0) sp.x = mazeW * CELL;
        if (sp.x > mazeW * CELL) sp.x = 0;
    });
}

function drawSpores() {
    if (!spores || !player) return;
    const t = Date.now() / 1000;
    spores.forEach(sp => {
        const sx = sp.x - cameraX + W / 2;
        const sy = sp.y - cameraY + H / 2;
        if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) return;
        const pdist = Math.hypot(sp.x - player.x, sp.y - player.y);
        if (pdist > 8 * CELL) return;
        const flicker = 0.6 + Math.sin(t * 4 + sp.phase) * 0.4;
        ctx.fillStyle = `rgba(220, 50, 40, ${sp.alpha * flicker * 0.75})`;
        ctx.beginPath();
        ctx.arc(sx, sy, sp.size, 0, Math.PI * 2);
        ctx.fill();
    });
}

let playerBpm = 72;
let ekgPhase = 0;
function drawEKG() {
    const ekgEl = document.getElementById('ekgCanvas');
    if (!ekgEl) return;
    const ectx = ekgEl.getContext('2d');
    if (!ectx) return;

    const w = ekgEl.width, h = ekgEl.height;
    ectx.fillStyle = 'rgba(5, 2, 4, 0.35)';
    ectx.fillRect(0, 0, w, h);

    const speed = (playerBpm || 72) / 60 * 2.2;
    ekgPhase = (ekgPhase + speed) % w;

    const isPanic = playerBpm >= 120;
    ectx.strokeStyle = isPanic ? '#ff3b3b' : '#2ecc71';
    ectx.lineWidth = 1.4;
    ectx.shadowColor = isPanic ? '#ff0000' : '#2ecc71';
    ectx.shadowBlur = 4;

    ectx.beginPath();
    const midY = h / 2;
    for (let x = 0; x < w; x++) {
        const p = (x - ekgPhase + w * 2) % 38;
        let y = midY;
        if (p >= 8 && p < 11) y -= 1.8;
        else if (p >= 12 && p < 14) y += 2.8;
        else if (p >= 14 && p < 17) y -= 6.0;
        else if (p >= 17 && p < 19) y += 3.5;
        else if (p >= 23 && p < 27) y -= 2.0;

        if (x === 0) ectx.moveTo(x, y);
        else ectx.lineTo(x, y);
    }
    ectx.stroke();
    ectx.shadowBlur = 0;
}

function updateUI() {
    setHudText(hudEl('levelText'), currentLevel + 1);
    setHudText(hudEl('modeText'), currentLevel % 2 === 1 ? tt('mode_light') : tt('mode_dark'));
    const diffKey = settings.difficulty || 'normal';
    const diffLabel = diffKey === 'easy' ? tt('diff_easy') : (diffKey === 'hard' ? tt('diff_hard') : tt('diff_normal'));
    setHudText(hudEl('diffText'), diffLabel.toUpperCase());
    setHudText(hudEl('hpText'), Math.max(0, Math.ceil(player.hp)));

    const hpPct = Math.max(0, player.hp / player.maxHp);
    const hpBar = hudEl('hpBar');
    if (hpBar) {
        hpBar.style.width = (hpPct * 100) + '%';
        // Warna HP bar dinamis: hijau > 60%, kuning 30-60%, merah + kedip < 30%.
        // Hanya diperbarui saat tingkat berubah agar tidak memicu style recalc tiap frame.
        const hpTier = hpPct > 0.6 ? 'ok' : (hpPct > 0.3 ? 'warn' : 'crit');
        if (hpBar.dataset.hpTier !== hpTier) {
            hpBar.dataset.hpTier = hpTier;
            if (hpTier === 'ok') {
                hpBar.style.setProperty('--hp-color', 'linear-gradient(90deg, #2ecc71, #27ae60)');
                hpBar.classList.remove('hp-critical');
            } else if (hpTier === 'warn') {
                hpBar.style.setProperty('--hp-color', 'linear-gradient(90deg, #f39c12, #e67e22)');
                hpBar.classList.remove('hp-critical');
            } else {
                hpBar.style.setProperty('--hp-color', 'linear-gradient(90deg, #e74c3c, #c0392b)');
                hpBar.classList.add('hp-critical');
            }
        }
    }

    // Kalkulasi Biometrik BPM dinamis
    const hpLoss = Math.max(0, 1 - hpPct);
    const danger = (typeof closestMonsterDist !== 'undefined') ? Math.max(0, 1 - (closestMonsterDist / (6 * CELL))) : 0;
    const targetBpm = Math.round(72 + hpLoss * 48 + danger * 54 + (player.dashing ? 20 : 0));
    playerBpm += (targetBpm - playerBpm) * 0.12;
    const bpmDisplay = Math.round(playerBpm);
    const bpmEl = hudEl('bpmText');
    if (bpmEl) {
        setHudText(bpmEl, bpmDisplay + ' BPM');
        bpmEl.classList.toggle('bpm-panic', bpmDisplay >= 120);
    }

    setHudText(hudEl('atkText'), Math.ceil(player.atk) + ' (Lv' + (player.plevel || 1) + ')');
    // Hitung monster hidup dengan loop; filter() akan mengalokasi array baru tiap frame.
    let aliveMonsters = 0;
    for (let i = 0; i < monsters.length; i++) if (monsters[i].hp > 0) aliveMonsters++;
    setHudText(hudEl('monsterCount'), aliveMonsters);
    const unlocked = artifacts.length > 0 && coinsCollected >= artifacts.length;
    setHudText(hudEl('artifactText'), `${coinsCollected} / ${artifacts.length}`);
    setHudText(hudEl('exitText'), unlocked ? tt('exit_open') : tt('exit_locked'));
    setHudText(hudEl('timeText'), Math.floor((Date.now() - levelStartTime) / 1000));
    renderWeaponHUD();
    try { vita2UpdateTracker(unlocked); } catch (e) {}
}

function renderWeaponHUD() {
    const slotsEl = hudEl('weaponSlots');
    const nameEl = hudEl('weaponNameDisplay');
    const gaugeBar = hudEl('weaponGaugeBar');
    const touchTag = hudEl('touchWeaponTag');
    const hintEl = hudEl('weaponHotkeyHint');
    if (!slotsEl || !player || !player.weapons) return;

    setHudText(hintEl, tt('weapon_switch_hint'));

    const curW = player.currentWeapon || 'knife';
    const curConf = WEAPONS[curW] || WEAPONS.knife;

    setHudText(nameEl, tt(curConf.nameKey).toUpperCase());
    setHudText(touchTag, lang === 'en' ? curConf.shortTagEn : curConf.shortTag);

    if (gaugeBar) {
        if (curW === 'minigun') {
            const heatPct = Math.min(100, Math.max(0, player.minigunHeat || 0));
            gaugeBar.style.width = heatPct + '%';
            if (player.minigunOverheat > 0) {
                gaugeBar.classList.add('overheat');
            } else {
                gaugeBar.classList.remove('overheat');
                gaugeBar.style.backgroundColor = heatPct > 70 ? '#f39c12' : '#00f0ff';
            }
        } else if (curW === 'shield') {
            const shieldPct = Math.min(100, Math.max(0, ((player.shieldTimer || 0) / 150) * 100));
            gaugeBar.style.width = shieldPct + '%';
            gaugeBar.classList.remove('overheat');
            gaugeBar.style.backgroundColor = '#00f0ff';
        } else {
            const cd = (player.weaponCooldowns && player.weaponCooldowns[curW]) || 0;
            const cdPct = curConf.cooldown ? Math.min(100, (cd / curConf.cooldown) * 100) : 0;
            gaugeBar.style.width = (100 - cdPct) + '%';
            gaugeBar.classList.remove('overheat');
            gaugeBar.style.backgroundColor = cd > 0 ? '#f39c12' : '#2ecc71';
        }
    }

    const wepList = player.weapons;
    const listKey = wepList.join(',');
    if (slotsEl.dataset.cachedList !== listKey) {
        slotsEl.dataset.cachedList = listKey;
        slotsEl.innerHTML = '';
        wepList.forEach((wKey, idx) => {
            const w = WEAPONS[wKey] || WEAPONS.knife;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'weapon-slot-btn' + (wKey === curW ? ' active' : '');
            btn.id = 'slotWep_' + wKey;
            btn.title = tt(w.nameKey) + ` [${idx + 1}]`;
            btn.onclick = (e) => { e.stopPropagation(); switchWeapon(wKey); };
            btn.innerHTML = `
                <span class="slot-key">${idx + 1}</span>
                <div class="slot-icon">${w.icon}</div>
                <div class="slot-cooldown-overlay" id="slotCd_${wKey}"></div>
            `;
            slotsEl.appendChild(btn);
        });
    } else {
        wepList.forEach(wKey => {
            const btn = hudEl('slotWep_' + wKey);
            if (btn) {
                if (wKey === curW) btn.classList.add('active');
                else btn.classList.remove('active');
            }
            const cdEl = hudEl('slotCd_' + wKey);
            if (cdEl && player.weaponCooldowns) {
                const w = WEAPONS[wKey] || WEAPONS.knife;
                const cd = player.weaponCooldowns[wKey] || 0;
                const pct = w.cooldown ? Math.min(100, Math.ceil((cd / w.cooldown) * 100)) : 0;
                const heightStr = pct + '%';
                if (cdEl.style.height !== heightStr) cdEl.style.height = heightStr;
            }
        });
    }
}

function isWall(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    const mx = Math.floor(x / CELL);
    const my = Math.floor(y / CELL);
    if (mx < 0 || mx >= mazeW || my < 0 || my >= mazeH) return true;
    if (!maze || !maze[my]) return true;
    return maze[my][mx] === 1;
}

function moveEntity(e, dx, dy) {
    if (e.isPhasing && e.isPhasing > 0) {
        e.x += dx;
        e.y += dy;
        return true;
    }
    const isMonster = !!e.name && e !== player;
    // Radius tabrakan: gunakan radius terukur agar monster tidak tersangkut di ubin lorong 32px
    const r = isMonster ? Math.min(9.5, (e.size || 16) * 0.5) : Math.min(10, (e.size || 14) * 0.7);

    const nx = e.x + dx;
    const ny = e.y + dy;

    // 1. Coba gerak langsung diagonal
    if (!isWall(nx - r, ny - r) && !isWall(nx + r, ny - r) &&
        !isWall(nx - r, ny + r) && !isWall(nx + r, ny + r)) {
        e.x = nx;
        e.y = ny;
        return true;
    }

    // 2. Coba gerak horizontal dengan bantuan auto-centering vertikal di lorong
    if (!isWall(nx - r, e.y - r) && !isWall(nx + r, e.y - r) &&
        !isWall(nx - r, e.y + r) && !isWall(nx + r, e.y + r)) {
        e.x = nx;
        if (isMonster) {
            const cy = Math.floor(e.y / CELL) * CELL + CELL / 2;
            if (Math.abs(e.y - cy) > 1) e.y += Math.sign(cy - e.y) * 0.75;
        }
        return true;
    }

    // 3. Coba gerak vertikal dengan bantuan auto-centering horizontal di lorong
    if (!isWall(e.x - r, ny - r) && !isWall(e.x + r, ny - r) &&
        !isWall(e.x - r, ny + r) && !isWall(e.x + r, ny + r)) {
        e.y = ny;
        if (isMonster) {
            const cx = Math.floor(e.x / CELL) * CELL + CELL / 2;
            if (Math.abs(e.x - cx) > 1) e.x += Math.sign(cx - e.x) * 0.75;
        }
        return true;
    }

    return false;
}

function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const PARTICLE_BUDGETS = { smooth: 500, retro: 350, chunky: 180 };
function getMaxParticles() {
    const q = (settings && settings.quality) || 'retro';
    let base = PARTICLE_BUDGETS[q] || 350;
    if (typeof perfFps !== 'undefined') {
        if (perfFps < 30) {
            base = Math.floor(base * 0.4);
        } else if (perfFps < 45) {
            base = Math.floor(base * 0.65);
        }
    }
    return Math.max(60, base);
}

function pushParticle(pObj) {
    if (!particles) particles = [];
    const maxP = getMaxParticles();
    if (particles.length < maxP) {
        particles.push(pObj);
    } else {
        const idx = Math.floor(Math.random() * particles.length);
        particles[idx] = pObj;
    }
}

function addParticle(x, y, color, count, speed, life) {
    const fpsScale = (typeof perfFps !== 'undefined' && perfFps < 35) ? 0.5 : ((typeof perfFps !== 'undefined' && perfFps < 48) ? 0.75 : 1.0);
    const qualScale = (settings && settings.quality === 'chunky') ? 0.6 : 1.0;
    const finalCount = Math.max(1, Math.round(count * fpsScale * qualScale));
    const toAdd = Math.min(finalCount, 32);
    for (let i = 0; i < toAdd; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = Math.random() * speed;
        pushParticle({
            x, y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            life: life || 30,
            maxLife: life || 30,
            color: color,
            size: 2 + Math.random() * 4
        });
    }
}

function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

function addShockwave(x, y, maxRadius, color, maxLife) {
    if (shockwaves.length > 16) shockwaves.shift();
    shockwaves.push({
        x, y,
        radius: 4,
        maxRadius: maxRadius || 75,
        color: color || '#00f0ff',
        life: maxLife || 22,
        maxLife: maxLife || 22
    });
}

function updateShockwaves() {
    let writeIdx = 0;
    for (let i = 0; i < shockwaves.length; i++) {
        const s = shockwaves[i];
        s.life--;
        const progress = 1 - (s.life / s.maxLife);
        s.radius = 4 + (s.maxRadius - 4) * Math.sin(progress * Math.PI * 0.5);
        if (s.life > 0) {
            shockwaves[writeIdx++] = s;
        }
    }
    shockwaves.length = writeIdx;
}

function drawShockwaves() {
    shockwaves.forEach(s => {
        const sx = s.x - cameraX + W / 2;
        const sy = s.y - cameraY + H / 2;
        const alpha = (s.life / s.maxLife) * 0.75;
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, s.radius, 0, Math.PI * 2);
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = Math.max(1, 4 * (s.life / s.maxLife));
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.restore();
    });
}

function addGasCloud(x, y, radius, duration, tickDmg) {
    if (gasClouds.length > 8) gasClouds.shift();
    gasClouds.push({
        x, y,
        radius: radius || 65,
        life: duration || 210,
        maxLife: duration || 210,
        tickDmg: tickDmg || 3,
        rot: Math.random() * Math.PI * 2
    });
}

function updateGasClouds() {
    gasClouds = gasClouds.filter(g => {
        g.life--;
        g.rot += 0.015;
        if (g.life % 25 === 0 && monsters) {
            monsters.forEach(m => {
                if (m && m.hp > 0 && dist(g, m) < g.radius + m.size) {
                    attackMonster(m, g.tickDmg);
                    m.stunTimer = Math.max(m.stunTimer || 0, 15);
                    addParticle(m.x, m.y, '#2ed573', 2, 2, 10);
                }
            });
        }
        if (g.life % 6 === 0) {
            const r = Math.random() * g.radius * 0.8;
            const a = Math.random() * Math.PI * 2;
            addParticle(g.x + Math.cos(a) * r, g.y + Math.sin(a) * r, '#2ed573', 1, 0.8, 18);
        }
        return g.life > 0;
    });
}

function drawGasClouds() {
    gasClouds.forEach(g => {
        const sx = g.x - cameraX + W / 2;
        const sy = g.y - cameraY + H / 2;
        const alpha = Math.min(0.5, (g.life / g.maxLife) * 0.5);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(g.rot);
        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, g.radius);
        grad.addColorStop(0, `rgba(46, 213, 115, ${alpha * 1.4})`);
        grad.addColorStop(0.6, `rgba(32, 140, 75, ${alpha * 0.8})`);
        grad.addColorStop(1, 'rgba(10, 50, 25, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, g.radius, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 0; i < 5; i++) {
            const pa = (Math.PI * 2 / 5) * i + g.rot;
            const pr = g.radius * 0.55;
            const px = Math.cos(pa) * pr;
            const py = Math.sin(pa) * pr;
            ctx.beginPath();
            ctx.arc(px, py, g.radius * 0.42, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(87, 101, 116, ${alpha * 0.45})`;
            ctx.fill();
        }
        ctx.restore();
    });
}

// ============================================================================
// UNIQUE PROCEDURAL DEATH ANIMATIONS (10 MONSTER TYPES, ZERO EXTERNAL ASSETS)
// ============================================================================
function spawnDeathEffect(m, x, y) {
    if (!m) return;
    const name = m.name || '';
    const isMajor = m.isBoss || name === 'The Monolith' || name === 'Mother Harvester' || name === 'Final Boss';

    if (name === 'Slime') {
        // 1. Slime: 8-12 liquid splashes dispersing in 4 cardinal/diagonal directions + 2-sec puddle
        for (let i = 0; i < 10; i++) {
            const dir = (Math.floor(i / 2.5) * (Math.PI / 2)) + (Math.random() - 0.5) * 0.45;
            const spd = 2.5 + Math.random() * 3.5;
            pushParticle({
                x, y,
                vx: Math.cos(dir) * spd,
                vy: Math.sin(dir) * spd,
                drag: 0.92,
                life: 30, maxLife: 30,
                color: '#10b981', size: 3 + Math.random() * 3,
                deathType: 'slime_splash'
            });
        }
        // Puddle remaining on floor for 2 seconds (120 frames)
        pushParticle({
            x, y, vx: 0, vy: 0, drag: 1.0,
            life: 120, maxLife: 120,
            deathTimer: 120,
            color: '#059669', size: m.size || 14,
            deathType: 'slime_puddle', rot: Math.random() * Math.PI
        });
    } else if (name === 'Bat') {
        // 2. Bat: Spins rapidly 3x, then shatters into grey ash
        pushParticle({
            x, y, vx: (Math.random() - 0.5) * 1.5, vy: -1.0, drag: 0.94,
            life: 55, maxLife: 55, deathTimer: 55,
            color: '#64748b', size: m.size || 12,
            rot: 0, rotSpd: 0.38,
            deathType: 'bat_spin_ash'
        });
    } else if (name === 'Crawl') {
        // 3. Crawl: Arthropod legs move convulsively, then fold/curl inward
        pushParticle({
            x, y, vx: 0, vy: 0, drag: 1.0,
            life: 60, maxLife: 60, deathTimer: 60,
            color: '#a82c2c', size: m.size || 13,
            rot: m.angle || 0,
            deathType: 'crawl_curl'
        });
    } else if (name === 'Ghost') {
        // 4. Ghost: Dissolve ripple ring expanding outwards
        pushParticle({
            x, y, vx: 0, vy: 0, drag: 1.0,
            life: 45, maxLife: 45, deathTimer: 45,
            color: '#06b6d4', size: m.size || 12,
            deathType: 'ghost_dissolve_ring'
        });
    } else if (name === 'Harvester' || m.isMotherHarvester || name === 'Mother Harvester') {
        // 5. Harvester: 6 radial blood tendrils extending outwards
        for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * Math.PI * 2;
            pushParticle({
                x, y, vx: 0, vy: 0, drag: 1.0,
                life: 50, maxLife: 50, deathTimer: 50,
                color: '#991b1b', size: 38 + Math.random() * 12,
                ang: ang,
                deathType: 'harvester_tendril'
            });
        }
    } else if (name === 'Dark Knight') {
        // 6. Dark Knight: Armor cracks and shatters like crystal shards
        for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const spd = 3.2 + Math.random() * 3.0;
            pushParticle({
                x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, drag: 0.94,
                life: 40, maxLife: 40, deathTimer: 40,
                color: '#fde047', size: 4 + Math.random() * 4,
                rot: Math.random() * Math.PI * 2, rotSpd: (Math.random() - 0.5) * 0.4,
                deathType: 'knight_shatter'
            });
        }
    } else if (name === 'Dragon') {
        // 7. Dragon: 4-directional fiery breath burst, body collapses
        for (let i = 0; i < 4; i++) {
            const ang = (i * Math.PI / 2);
            pushParticle({
                x, y, vx: 0, vy: 0, drag: 1.0,
                life: 35, maxLife: 35, deathTimer: 35,
                color: '#f97316', size: 32,
                ang: ang,
                deathType: 'dragon_ember'
            });
        }
    } else if (name === 'Lich') {
        // 8. Lich: Floating skull wisp ascends, bursts into arcane runes
        for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * Math.PI * 2;
            pushParticle({
                x, y, vx: Math.cos(ang) * 1.8, vy: -1.6 + Math.sin(ang) * 0.8, drag: 0.96,
                life: 48, maxLife: 48, deathTimer: 48,
                color: '#c084fc', size: 7,
                rot: Math.random() * Math.PI, rotSpd: 0.15,
                deathType: 'lich_rune'
            });
        }
    } else if (name === 'Beholder') {
        // 9. Beholder: Ocular collapse with radial optical flares
        pushParticle({
            x, y, vx: 0, vy: 0, drag: 1.0,
            life: 42, maxLife: 42, deathTimer: 42,
            color: '#7c3aed', size: m.size || 16,
            deathType: 'beholder_ocular'
        });
    } else if (name === 'The Monolith' || isMajor) {
        // 10. The Monolith: 3-stage cataclysmic core detonation
        pushParticle({
            x, y, vx: 0, vy: 0, drag: 1.0,
            life: 80, maxLife: 80, deathTimer: 80,
            color: '#ff0033', size: m.size || 40,
            deathType: 'monolith_cataclysm'
        });
    }
}

function drawCustomDeathParticle(p, sx, sy) {
    switch (p.deathType) {
        case 'slime_puddle': {
            ctx.save();
            ctx.fillStyle = p.color || '#059669';
            const rx = p.size * 1.6;
            const ry = p.size * 0.7;
            ctx.beginPath();
            ctx.ellipse(sx, sy, rx, ry, p.rot || 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#6ee7b7';
            ctx.beginPath();
            ctx.arc(sx - rx * 0.25, sy - ry * 0.2, Math.max(1, p.size * 0.22), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            break;
        }
        case 'slime_splash': {
            ctx.fillStyle = p.color || '#10b981';
            ctx.beginPath();
            ctx.arc(sx, sy, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case 'bat_spin_ash': {
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(p.rot || 0);
            if (p.life > p.maxLife * 0.45) {
                ctx.fillStyle = '#312e81';
                ctx.beginPath();
                ctx.ellipse(0, 0, p.size, p.size * 0.35, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#4338ca';
                ctx.beginPath();
                ctx.moveTo(0, 0); ctx.lineTo(-p.size * 1.4, -p.size * 0.7); ctx.lineTo(-p.size * 0.5, 0);
                ctx.moveTo(0, 0); ctx.lineTo(p.size * 1.4, -p.size * 0.7); ctx.lineTo(p.size * 0.5, 0);
                ctx.fill();
            } else {
                ctx.fillStyle = '#64748b';
                ctx.fillRect(-p.size * 0.4, -p.size * 0.4, p.size * 0.8, p.size * 0.8);
            }
            ctx.restore();
            break;
        }
        case 'crawl_curl': {
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(p.rot || 0);
            const curl = 1 - (p.life / p.maxLife);
            ctx.fillStyle = '#7f1d1d';
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 0.85, p.size * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#b91c1c';
            ctx.lineWidth = 1.4;
            for (const s of [-1, 1]) {
                for (let leg = -1; leg <= 1; leg++) {
                    ctx.beginPath();
                    const lx = leg * p.size * 0.4;
                    ctx.moveTo(lx, 0);
                    const kneeX = lx + s * (p.size * 0.75 * (1 - curl * 0.65));
                    const kneeY = leg * 2 - curl * p.size * 0.7;
                    const footX = lx + s * (p.size * 0.35 * (1 - curl));
                    const footY = kneeY + p.size * 0.35;
                    ctx.lineTo(kneeX, kneeY);
                    ctx.lineTo(footX, footY);
                    ctx.stroke();
                }
            }
            ctx.restore();
            break;
        }
        case 'ghost_dissolve_ring': {
            ctx.save();
            const prog = 1 - (p.life / p.maxLife);
            const r = p.size + prog * 44;
            ctx.strokeStyle = p.color || '#06b6d4';
            ctx.lineWidth = Math.max(1, 3.2 * (1 - prog));
            ctx.shadowColor = p.color || '#06b6d4';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            break;
        }
        case 'harvester_tendril': {
            ctx.save();
            ctx.strokeStyle = p.color || '#991b1b';
            ctx.lineWidth = Math.max(1, 3.2 * (p.life / p.maxLife));
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            const len = p.size * (1 - (p.life / p.maxLife) * 0.2);
            const sway = Math.sin((p.life || 0) * 0.25 + p.ang) * 10;
            const midX = sx + Math.cos(p.ang) * len * 0.5 + Math.sin(p.ang) * sway;
            const midY = sy + Math.sin(p.ang) * len * 0.5 - Math.cos(p.ang) * sway;
            const endX = sx + Math.cos(p.ang) * len;
            const endY = sy + Math.sin(p.ang) * len;
            ctx.bezierCurveTo(midX, midY, midX, midY, endX, endY);
            ctx.stroke();
            ctx.restore();
            break;
        }
        case 'knight_shatter': {
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(p.rot || 0);
            ctx.fillStyle = (p.life % 4 < 2) ? '#ffffff' : (p.color || '#fde047');
            ctx.beginPath();
            ctx.moveTo(-p.size, -p.size * 0.5);
            ctx.lineTo(p.size, -p.size * 0.8);
            ctx.lineTo(p.size * 0.6, p.size);
            ctx.lineTo(-p.size * 0.8, p.size * 0.5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            break;
        }
        case 'dragon_ember': {
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(p.ang || 0);
            const fProg = 1 - (p.life / p.maxLife);
            const flen = p.size * (0.8 + fProg * 1.2);
            ctx.fillStyle = fProg < 0.4 ? '#fef08a' : (fProg < 0.7 ? '#f97316' : '#dc2626');
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(flen, -flen * 0.35);
            ctx.bezierCurveTo(flen * 1.2, 0, flen * 1.2, 0, flen, flen * 0.35);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            break;
        }
        case 'lich_rune': {
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(p.rot || 0);
            ctx.strokeStyle = p.color || '#c084fc';
            ctx.shadowColor = '#c084fc';
            ctx.shadowBlur = 8;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(0, -p.size);
            ctx.lineTo(p.size * 0.7, 0);
            ctx.lineTo(0, p.size);
            ctx.lineTo(-p.size * 0.7, 0);
            ctx.closePath();
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, p.size * 0.35, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            break;
        }
        case 'beholder_ocular': {
            ctx.save();
            ctx.translate(sx, sy);
            const eyeProg = 1 - (p.life / p.maxLife);
            const eyeR = eyeProg < 0.45 ? p.size * (1 + eyeProg * 1.5) : p.size * (1.68 - (eyeProg - 0.45) * 3.0);
            if (eyeR > 0) {
                ctx.fillStyle = '#f8fafc';
                ctx.beginPath(); ctx.arc(0, 0, eyeR, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#7c3aed';
                ctx.beginPath(); ctx.arc(0, 0, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#c084fc';
                ctx.lineWidth = 1.2;
                for (let i = 0; i < 8; i++) {
                    const rayAng = (i / 8) * Math.PI * 2;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(Math.cos(rayAng) * eyeR * 1.6, Math.sin(rayAng) * eyeR * 1.6);
                    ctx.stroke();
                }
            }
            ctx.restore();
            break;
        }
        case 'monolith_cataclysm': {
            ctx.save();
            const mProg = 1 - (p.life / p.maxLife);
            if (mProg < 0.35) {
                ctx.fillStyle = '#b91c1c';
                ctx.beginPath();
                ctx.arc(sx, sy, p.size * (1 - mProg), 0, Math.PI * 2);
                ctx.fill();
            } else if (mProg < 0.70) {
                ctx.strokeStyle = '#e2e8f0';
                ctx.lineWidth = 2.5;
                for (let i = 0; i < 6; i++) {
                    const ang = (i / 6) * Math.PI * 2;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(sx + Math.cos(ang) * (p.size * 1.3), sy + Math.sin(ang) * (p.size * 1.3));
                    ctx.stroke();
                }
            } else {
                const shockR = (mProg - 0.70) * 220;
                ctx.strokeStyle = '#ff0033';
                ctx.lineWidth = 3.5;
                ctx.shadowColor = '#ff0033';
                ctx.shadowBlur = 15;
                ctx.beginPath();
                ctx.arc(sx, sy, shockR, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
            break;
        }
    }
}

function addBrassCasing(x, y, angle) {
    if (brassCasings.length > 35) brassCasings.shift();
    const ejectAngle = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.45;
    const spd = 2.5 + Math.random() * 2.5;
    brassCasings.push({
        x, y,
        vx: Math.cos(ejectAngle) * spd,
        vy: Math.sin(ejectAngle) * spd,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.5,
        life: 50 + Math.floor(Math.random() * 25),
        maxLife: 75
    });
}

function updateBrassCasings() {
    let writeIdx = 0;
    for (let i = 0; i < brassCasings.length; i++) {
        const b = brassCasings[i];
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= 0.88;
        b.vy *= 0.88;
        b.rot += b.vRot;
        b.vRot *= 0.92;
        b.life--;
        if (b.life > 0) {
            brassCasings[writeIdx++] = b;
        }
    }
    brassCasings.length = writeIdx;
}

function drawBrassCasings() {
    brassCasings.forEach(b => {
        const sx = b.x - cameraX + W / 2;
        const sy = b.y - cameraY + H / 2;
        const alpha = Math.min(1, b.life / 20);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(b.rot);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#eccc68';
        ctx.fillRect(-2.5, -1, 5, 2);
        ctx.fillStyle = '#d4a32e';
        ctx.fillRect(-2.5, -1, 1.2, 2);
        ctx.restore();
    });
}

function handlePlayerDeath(cause) {
    trackDeathForAdaptation(currentLevel);
    gameState = 'dead';
    stopAmbientDrone();
    sDie();
    sStaticBurst();
    showCursor();
    hideHUD();

    // Pastikan cutscene prolog atau dialog lain tidak menghalangi deathScreen
    const pro = document.getElementById('prologueScreen');
    if (pro) {
        pro.classList.remove('active', 'fade-out');
        pro.style.display = 'none';
    }

    const ds = document.getElementById('deathScreen');
    if (ds) {
        ds.style.display = 'flex';
        ds.scrollTop = 0;
        ds.classList.remove('cinematic-open');
        void ds.offsetWidth;
        ds.classList.add('cinematic-open');
    }
    const dLevel = document.getElementById('deathLevel');
    if (dLevel) dLevel.textContent = currentLevel + 1;
    const dKills = document.getElementById('deathKills');
    if (dKills) dKills.textContent = totalKills;
    const sessionTime = totalTime + Math.floor((Date.now() - levelStartTime) / 1000);
    const dtEl = document.getElementById('deathTime');
    if (dtEl) dtEl.textContent = formatTime(sessionTime);
    const stampEl = document.getElementById('deathStamp');
    const prof = (typeof getProfile === 'function') ? getProfile() : null;
    if (stampEl) {
        if (prof && prof.isLoggedIn && prof.name) {
            stampEl.textContent = 'SUBJEK: ' + prof.name.toUpperCase();
        } else {
            stampEl.textContent = tt('death_stamp');
        }
    }
    const dcEl = document.getElementById('deathCause');
    if (dcEl) {
        const isEn = lang === 'en';
        const causeNames = {
            'Crawl': isEn ? 'Biomass Engulfment (Crawl)' : 'Ditelan Massa Daging (Crawl)',
            'Harvester': isEn ? 'Tendril Impalement (Harvester)' : 'Tertusuk Tentakel (Harvester)',
            'Mimic': isEn ? 'Lethal Decapitation (Mimic)' : 'Terkoyak Rahang (Mimic)',
            'Final Boss': isEn ? 'Apex Entity Assimilation' : 'Asimilasi Apex Predator',
            'The Monolith': isEn ? 'Colossal Carnis Absorption (The Monolith)' : 'Asimilasi Raksasa (The Monolith)',
            'Trap': isEn ? 'Floor Spike Impalement' : 'Tertusuk Jebakan Duri',
            'Projectile': isEn ? 'Acid Spore Burst' : 'Semburan Asam Spora'
        };
        const fullCauseText = causeNames[cause] || (isEn ? `Consumed by ${cause}` : `Dimangsa oleh ${cause}`);
        dcEl.textContent = '';
        let cIdx = 0;
        const cTimer = setInterval(() => {
            if (cIdx < fullCauseText.length) {
                dcEl.textContent += fullCauseText[cIdx++];
            } else {
                clearInterval(cTimer);
            }
        }, 18);
    }
    if (typeof submitScoreToSupabase === 'function' && typeof isSupabaseConfigured === 'function' && isSupabaseConfigured()) {
        const p = (typeof getProfile === 'function') ? getProfile() : null;
        submitScoreToSupabase({
            username: (p && p.name) ? p.name : 'Operatif Gugur',
            role: (p && p.role) ? p.role : 'Operatif Lapangan',
            avatar: (p && p.avatar) ? p.avatar : '',
            presetEmoji: (p && p.presetEmoji) ? p.presetEmoji : 'biohazard',
            bestTime: sessionTime,
            totalKills: totalKills,
            highestLevel: currentLevel + 1,
            grade: (currentLevel >= 8) ? 'B' : ((currentLevel >= 4) ? 'C' : 'D')
        }).catch(() => {});
    }
}

function attackPlayer(monster) {
    if (typeof godmode !== 'undefined' && godmode) return;
    if (player.invincible > 0) return;

    let dmg = monster.atk;
    if (currentLevel % 2 === 0) dmg *= 0.9;
    if (player && player.perkNano) {
        dmg *= Math.max(0.5, 1 - player.perkNano * 0.25);
    }

    player.hp -= dmg;
    player.invincible = 30;
    addShake(8);
    hurtFlash = 8;
    sHurt();
    triggerHaptic('hit');
    addParticle(player.x, player.y, '#e74c3c', 10, 4, 20);

    if (monster.name === 'Mimic') {
        playGutturalGrowl({ f0: 58, f1: 28, dur: 0.35, growlRate: 26, formant1: 340, formant2: 680, vol: 0.85, rasp: true }, monster);
        sFleshHit();
    }

    if (player.hp <= 0) {
        handlePlayerDeath(monster.name);
    }

    updateUI();
}

function getMonsterFlashColor(m) {
    if (!m) return '#ffffff';
    if (m.name === 'Slime') return '#86efac';
    if (m.name === 'Bat') return '#a5b4fc';
    if (m.name === 'Crawl') return '#fca5a5';
    if (m.name === 'Ghost') return '#67e8f9';
    if (m.name === 'Harvester' || m.isMotherHarvester) return '#f87171';
    if (m.name === 'Dark Knight') return '#fde047';
    if (m.name === 'Dragon' || m.name === 'Lich' || m.name === 'Beholder') return '#e879f9';
    if (m.name === 'The Monolith' || m.isBoss) return (m.hitFlash % 2 === 0 ? '#ffffff' : '#ff0033');
    return '#ffffff';
}

function attackMonster(m, customDmg) {
    let dmg = (typeof customDmg === 'number') ? customDmg : (player.atk * (0.8 + Math.random() * 0.4));

    // Mimic Disguise Break on Hit
    if (m.name === 'Mimic' && m.disguised) {
        m.disguised = false;
        m.mimicState = 'lunge';
        m.lungeTimer = 100;
        sFleshHit();
        addShake(10);
    }

    // Weak Point Exposure on The Monolith
    if (m.name === 'The Monolith' && m.weakPointTimer > 0) {
        dmg = Math.round(dmg * 2.5);
        addParticle(m.x, m.y - m.size * 0.8, '#ffd700', 16, 5, 25);
        floatingTexts.push({
            x: m.x,
            y: m.y - m.size * 1.2,
            text: tt('weak_point_hit'),
            color: '#ffd700',
            life: 55,
            maxLife: 55
        });
    }

    // Dark Knight Frontal Shield Block & Riposte Pattern
    if (m.name === 'Dark Knight' && !m.stunTimer && m.hitFlash <= 0) {
        const toPlayer = Math.atan2(player.y - m.y, player.x - m.x);
        let angleDiff = Math.abs((m.angle || 0) - toPlayer);
        while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - Math.PI * 2);
        if (angleDiff < Math.PI * 0.42) {
            dmg = Math.max(1, Math.round(dmg * 0.25));
            sShieldDeflect();
            addParticle(m.x, m.y, '#f1c40f', 8, 3, 14);
            m.shieldDeflectCount = (m.shieldDeflectCount || 0) + 1;
            if (m.shieldDeflectCount >= 2) {
                m.shieldDeflectCount = 0;
                m.riposteTimer = 25;
                floatingTexts.push({
                    x: m.x,
                    y: m.y - m.size - 10,
                    text: tt('dark_knight_riposte'),
                    color: '#ef4444',
                    life: 45,
                    maxLife: 45
                });
            } else {
                floatingTexts.push({
                    x: m.x,
                    y: m.y - m.size - 10,
                    text: lang === 'en' ? 'SHIELD BLOCKED!' : 'TERTAHAN PERISAI!',
                    color: '#f1c40f',
                    life: 35,
                    maxLife: 35
                });
            }
        }
    }

    // Apply Status Effects from Perks & Weapons
    if (player) {
        if (player.perkCryo) {
            m.freezeTimer = Math.max(m.freezeTimer || 0, 90);
        }
        if (player.perkPlasma) {
            m.burnTimer = Math.max(m.burnTimer || 0, 80);
        }
        if (player.perkEmp && Math.random() < 0.25) {
            m.stunTimer = Math.max(m.stunTimer || 0, 45);
            addParticle(m.x, m.y, '#00f0ff', 12, 3, 20);
            floatingTexts.push({
                x: m.x,
                y: m.y - m.size - 12,
                text: lang === 'en' ? 'STUNNED!' : 'LUMPUH!',
                color: '#00f0ff',
                life: 30,
                maxLife: 30
            });
        }
    }

    m.hp -= dmg;
    m.hitFlash = 10;
    m.stunTimer = Math.max(m.stunTimer || 0, 8);
    addShake(4);

    // Floating combat damage numbers with crit distinction
    const isCrit = (typeof customDmg === 'number' && customDmg > player.atk * 1.35);
    if (isCrit) {
        sCritHit(m);
    }
    floatingTexts.push({
        x: m.x + (Math.random() - 0.5) * 14,
        y: m.y - m.size - 6,
        text: (isCrit ? 'CRIT ' : '') + '-' + Math.round(dmg),
        color: isCrit ? '#ffd700' : '#ff4d4d',
        life: isCrit ? 48 : 34,
        maxLife: isCrit ? 48 : 34
    });

    // Efek daging basah / organ khas Vita Carnis
    const flashCol = getMonsterFlashColor(m);
    if (['Crawl', 'Harvester', 'Mimic', 'Final Boss', 'The Monolith', 'Slime'].includes(m.name)) {
        sFleshHit();
        addDecal(m.x + (Math.random() - 0.5) * 8, m.y + (Math.random() - 0.5) * 8, '#520000', Math.random() * 4 + 3, 'flesh');
    } else {
        sHit();
        addDecal(m.x, m.y, '#3b0000', Math.random() * 3 + 2, 'splat');
    }
    addParticle(m.x, m.y, flashCol, 8, 5, 15);

    if (m.hp <= 0) {
        totalKills++;
        registerComboKill();

        if (m.isBoss || m.isMonolith || m.name === 'The Monolith' || m.name === 'Mother Harvester') {
            const bh = document.getElementById('bossHud');
            if (bh) bh.style.display = 'none';
        }

        // === CINEMATIC DEATH SEQUENCE ===
        spawnDeathEffect(m, m.x, m.y);
        const isElite = m.size >= 15 || m.name === 'Dark Knight' || m.name === 'Dragon' || m.name === 'Lich' || m.name === 'Beholder';
        const isMajor = m.isBoss || m.name === 'The Monolith' || m.name === 'Mother Harvester' || m.name === 'Final Boss';

        // Hit-stop proporsional: semakin berbahaya, semakin dramatik
        if (!REDUCE_MOTION) hitStop = Math.max(hitStop, isMajor ? 6 : (isElite ? 4 : 3));
        triggerHaptic('kill');

        // 1) Dissolve burst — partikel warna monster menyebar keluar
        const dissolveCount = isMajor ? 45 : (isElite ? 25 : 15);
        addParticle(m.x, m.y, m.color, dissolveCount, isMajor ? 8 : 6, isMajor ? 50 : 40);
        // Partikel putih 'jiwa' keluar dari tubuh
        addParticle(m.x, m.y, '#ffffff', Math.floor(dissolveCount * 0.4), 4, 30);

        // 2) Gore decals
        addDecal(m.x, m.y, '#6b0000', isMajor ? 12 : 8, 'flesh');
        addDecal(m.x + (Math.random() - 0.5) * 8, m.y + (Math.random() - 0.5) * 8, '#400000', 5, 'splat');

        // 3) Shockwave ring untuk elite/boss kills
        if (isElite || isMajor) {
            addShockwave(m.x, m.y, isMajor ? 120 : 65, m.color, isMajor ? 28 : 18);
            addShake(isMajor ? 14 : 7);
            // Screen flash: singkat sekali untuk sinematik
            hurtFlash = Math.max(hurtFlash, isMajor ? 8 : 4);
        } else {
            addShake(4);
        }

        // 4) EXP orb visual — partikel kuning 'terbang' ke arah player
        const orbCount = Math.min(8, Math.max(3, Math.floor(m.exp / 15)));
        for (let i = 0; i < orbCount; i++) {
            const orbAngle = (Math.PI * 2 * i) / orbCount;
            const orbDist = 12 + Math.random() * 20;
            pushParticle({
                x: m.x + Math.cos(orbAngle) * orbDist,
                y: m.y + Math.sin(orbAngle) * orbDist,
                vx: (player.x - m.x) * 0.015 + Math.cos(orbAngle) * 2,
                vy: (player.y - m.y) * 0.015 + Math.sin(orbAngle) * 2,
                life: 35 + Math.floor(Math.random() * 15),
                maxLife: 50,
                color: '#ffd700',
                size: 3 + Math.random() * 2
            });
        }

        // 5) HP regen saat membunuh (life steal) + Perk Vampiric
        let healAmount = 6;
        if (player && player.perkVampire) {
            healAmount = 14 + (comboCount > 1 ? 8 : 0);
            floatingTexts.push({
                x: player.x,
                y: player.y - 24,
                text: '+' + healAmount + ' HP [VAMPIRIC]',
                color: '#2ecc71',
                life: 50,
                maxLife: 50
            });
        }
        player.hp = Math.min(player.maxHp, player.hp + healAmount);

        // 6) Adrenaline Surge Pity Mechanic: clutch survival boost if critical HP (< 25%)
        if (player && player.hp > 0 && player.hp < player.maxHp * 0.25) {
            const pityBoost = Math.round(player.maxHp * 0.08);
            player.hp = Math.min(player.maxHp, player.hp + pityBoost);
            addParticle(player.x, player.y, '#2ecc71', 12, 3, 22);
            floatingTexts.push({
                x: player.x,
                y: player.y - 38,
                text: lang === 'en' ? '+ADRENALINE SURGE!' : '+LONJAKAN ADRENALIN!',
                color: '#2ecc71',
                life: 45,
                maxLife: 45
            });
        }

        gainExp(m.exp);

        // === THE MONOLITH SPECIAL DEATH ===
        if (m.name === 'The Monolith') {
            addShake(28);
            if (!REDUCE_MOTION) hitStop = Math.max(hitStop, 6);
            sExplosion(true);
            for (let i = 0; i < 60; i++) {
                addParticle(m.x + (Math.random() - 0.5) * 90, m.y + (Math.random() - 0.5) * 90, '#b01e23', 8, 7, 50);
                addParticle(m.x + (Math.random() - 0.5) * 70, m.y + (Math.random() - 0.5) * 70, '#ffffff', 4, 5, 40);
            }
            for (let i = 0; i < 15; i++) {
                addDecal(m.x + (Math.random() - 0.5) * 120, m.y + (Math.random() - 0.5) * 120, '#4a0000', 14, 'flesh');
            }
            if (artifacts) artifacts.forEach(a => a.collected = true);
            coinsCollected = artifacts ? artifacts.length : 1;
            floatingTexts.push({
                x: m.x, y: m.y - 40,
                text: lang === 'en' ? '[ THE MONOLITH DEFEATED // EVACUATION OPEN ]' : '[ THE MONOLITH TUMBANG // EVAKUASI TERBUKA ]',
                color: '#f1c40f', life: 160, maxLife: 160
            });
            sWin();
        }
    }

    updateUI();
}

function triggerExplosion(x, y, radius, damage, isBazooka) {
    sExplosion(isBazooka);
    addShake(isBazooka ? 13 : 7);
    const pColor = isBazooka ? '#ff4500' : '#ffa500';
    addParticle(x, y, pColor, isBazooka ? 30 : 18, isBazooka ? 6 : 4, isBazooka ? 28 : 20);
    addParticle(x, y, '#ff0000', isBazooka ? 18 : 10, isBazooka ? 5 : 3, 24);
    addParticle(x, y, '#ffeaa7', 12, 3, 16);
    addDecal(x, y, '#2c0000', isBazooka ? 10 : 6, 'splat');
    addShockwave(x, y, isBazooka ? 110 : (radius + 15), isBazooka ? '#ff4757' : '#f39c12', isBazooka ? 25 : 18);

    // Bazooka: lontarkan 3 pecahan sub-munisi kluster yang meledak beruntun
    if (isBazooka) {
        for (let i = 0; i < 3; i++) {
            const clAngle = (Math.PI * 2 / 3) * i + (Math.random() - 0.5) * 0.5;
            const spd = 3.4 + Math.random() * 2.2;
            projectiles.push({
                x, y,
                dx: Math.cos(clAngle) * spd,
                dy: Math.sin(clAngle) * spd,
                life: 14 + Math.floor(Math.random() * 8),
                isPlayer: true,
                kind: 'cluster_bomb',
                dmg: damage * 0.35,
                radius: 46,
                hitRadius: 8
            });
        }
    }

    if (monsters) {
        monsters.forEach(m => {
            if (m.hp > 0) {
                const d = dist({ x, y }, m);
                if (d < radius + m.size) {
                    const falloff = Math.max(0.3, 1 - (d / (radius + m.size)) * 0.5);
                    const finalDmg = damage * falloff;
                    m.hp -= finalDmg;
                    m.hitFlash = 12;
                    m.stunTimer = isBazooka ? 22 : 14;
                    const angle = Math.atan2(m.y - y, m.x - x);
                    const push = (isBazooka ? 24 : 14) * falloff;
                    moveEntity(m, Math.cos(angle) * push, Math.sin(angle) * push);

                    if (m.hp <= 0) {
                        totalKills++;
                        // Dissolve burst + white soul particles
                        addParticle(m.x, m.y, m.color, 20, 6, 40);
                        addParticle(m.x, m.y, '#ffffff', 8, 4, 28);
                        addDecal(m.x, m.y, '#6b0000', 8, 'flesh');
                        // EXP orbs
                        const eCount = Math.min(5, Math.max(2, Math.floor(m.exp / 20)));
                        for (let ei = 0; ei < eCount; ei++) {
                            const ea = (Math.PI * 2 * ei) / eCount;
                            pushParticle({
                                x: m.x + Math.cos(ea) * 10,
                                y: m.y + Math.sin(ea) * 10,
                                vx: (player.x - m.x) * 0.012 + Math.cos(ea) * 1.5,
                                vy: (player.y - m.y) * 0.012 + Math.sin(ea) * 1.5,
                                life: 35, maxLife: 45,
                                color: '#ffd700', size: 3
                            });
                        }
                        gainExp(m.exp);
                    }
                }
            }
        });
    }
    updateUI();
}

function expNeed(lv) { return 40 + (Math.max(1, Math.floor(lv) || 1) - 1) * 30; }

function gainExp(n) {
    if (!player || gameState !== 'playing') return;
    player.exp = (Math.floor(Number(player.exp)) || 0) + Math.max(0, Math.floor(Number(n)) || 0);
    player.plevel = Math.max(1, Math.floor(Number(player.plevel)) || 1);
    let need = expNeed(player.plevel);
    let guard = 10;
    while (player.exp >= need && guard-- > 0) {
        player.exp -= need;
        player.plevel++;
        // Progressive scaling: level-up di late-game memberikan stat lebih besar
        const hpGain = 10 + Math.floor(currentLevel * 1.5);
        const atkGain = 3 + Math.floor(currentLevel * 0.5);
        player.maxHp += hpGain;
        player.hp = Math.min(player.maxHp, player.hp + Math.floor(hpGain * 1.5));
        player.atk += atkGain;
        sArtifact();
        addParticle(player.x, player.y, '#f1c40f', 20, 5, 35);
        floatingTexts.push({
            x: player.x, y: player.y - 30,
            text: tt('level_up').replace('{h}', hpGain).replace('{a}', atkGain),
            color: '#f1c40f', life: 90, maxLife: 90
        });
        need = expNeed(player.plevel);
    }
    updateUI();
}

function nextLevel() {
    totalTime += Math.floor((Date.now() - levelStartTime) / 1000);

    // Tandai sektor berhasil diselesaikan dan reset penghitung kematian sektor ini
    const high = loadHigh();
    if (!high.clearedLevels || typeof high.clearedLevels !== 'object') high.clearedLevels = {};
    high.clearedLevels[currentLevel] = true;
    if (high.sectorDeaths && typeof high.sectorDeaths === 'object') {
        high.sectorDeaths[currentLevel] = 0;
    }
    saveHigh(high);

    if (currentLevel >= LEVELS - 1) {
        gameState = 'won';
        showCursor();
        hideHUD();
        stopProceduralOST();

        const triggerFinalWin = () => {
            sWin();
            const high = loadHigh();
            const prevBest = Number(high.bestTime);
            const prevKills = Math.floor(Number(high.bestKills)) || 0;
            let isNewBest = false;
            if (!Number.isFinite(prevBest) || totalTime < prevBest || (totalTime === prevBest && totalKills > prevKills)) {
                high.bestTime = totalTime;
                high.bestKills = totalKills;
                saveHigh(high);
                isNewBest = true;
            }
            const ws = document.getElementById('winScreen');
            if (ws) {
                ws.style.display = 'flex';
                ws.classList.remove('cinematic-open');
                void ws.offsetWidth;
                ws.classList.add('cinematic-open');
            }
            // Celebratory Fireworks & Confetti Burst
            for (let i = 0; i < 80; i++) {
                const colors = ['#2ecc71', '#00f0ff', '#ffd700', '#ff4757', '#a855f7'];
                addParticle(
                    cameraX + (Math.random() - 0.5) * (W * 0.8),
                    cameraY + (Math.random() - 0.5) * (H * 0.8),
                    colors[i % colors.length],
                    1,
                    3 + Math.random() * 5,
                    70 + Math.random() * 40
                );
            }
            document.getElementById('winKills').textContent = totalKills;
            document.getElementById('winTime').textContent = formatTime(totalTime);
            const grade = winGrade(totalTime);
            const gradeEl = document.getElementById('winGrade');
            gradeEl.textContent = grade;
            gradeEl.className = 'grade-' + grade;
            document.getElementById('newBestBadge').style.display = isNewBest ? 'block' : 'none';
            document.getElementById('winBest').textContent =
                loadHigh().bestTime != null ? formatTime(loadHigh().bestTime) : '-';
            if (typeof submitScoreToSupabase === 'function' && typeof isSupabaseConfigured === 'function' && isSupabaseConfigured()) {
                const p = (typeof getProfile === 'function') ? getProfile() : null;
                submitScoreToSupabase({
                    username: (p && p.name) ? p.name : 'Operatif Penakluk',
                    role: (p && p.role) ? p.role : 'Operatif Lapangan',
                    avatar: (p && p.avatar) ? p.avatar : '',
                    presetEmoji: (p && p.presetEmoji) ? p.presetEmoji : 'biohazard',
                    bestTime: totalTime,
                    totalKills: totalKills,
                    highestLevel: 15,
                    grade: grade
                }).catch(() => {});
            }
        };

        if (typeof playEpilogueCutscene === 'function') {
            playEpilogueCutscene(triggerFinalWin);
        } else {
            triggerFinalWin();
        }
        return;
    }

    levelTransition = true;

    // Transisi setiap 2 level (LV 2->3: idx 1, LV 4->5: idx 3, LV 6->7: idx 5, LV 8->9: idx 7, LV 10->11: idx 9, LV 12->13: idx 11, LV 14->15: idx 13)
    const isArsenalMilestone = (currentLevel === 1 || currentLevel === 3 || currentLevel === 5 || currentLevel === 7 || currentLevel === 9 || currentLevel === 11 || currentLevel === 13);

    if (isArsenalMilestone) {
        setTimeout(() => {
            openWeaponSelectModal(currentLevel + 1);
        }, 1000);
        return;
    }

    setTimeout(() => {
        levelTransition = false;
        initLevel(currentLevel + 1);
    }, 1500);
}

let pendingNextLevel = null;
function openWeaponSelectModal(nextLv) {
    pendingNextLevel = nextLv;
    const modal = document.getElementById('weaponSelectScreen');
    const grid = document.getElementById('weaponCardsContainer');
    if (!modal || !grid) {
        initLevel(nextLv);
        return;
    }

    const unowned = Object.keys(WEAPONS).filter(k => k !== 'knife' && (!player.weapons || !player.weapons.includes(k)));
    const choices = [];

    // Prioritaskan senjata yang belum dimiliki (maksimal 3 kartu senjata)
    unowned.slice(0, 3).forEach(key => {
        choices.push({ type: 'weapon', key: key, item: WEAPONS[key] });
    });

    // Isi slot sisa (hingga minimal 3 pilihan, atau 4 augmentasi penuh bila semua senjata sudah dimiliki)
    const perkKeys = shuffle(Object.keys(TACTICAL_PERKS));
    perkKeys.forEach(pKey => {
        if (choices.length < 4 && !choices.some(c => c.key === pKey)) {
            choices.push({ type: 'perk', key: pKey, item: TACTICAL_PERKS[pKey] });
        }
    });

    if (!choices.length) {
        initLevel(nextLv);
        return;
    }

    grid.innerHTML = '';
    choices.forEach(ch => {
        const item = ch.item;
        const card = document.createElement('div');
        card.className = 'weapon-card' + (ch.type === 'perk' ? ' perk-card' : '');
        const wName = tt(item.nameKey);
        const wRole = tt(item.roleKey);
        const wDesc = tt(item.descKey);
        const specs = lang === 'en' ? item.specsEn : item.specs;
        const btnText = ch.type === 'perk' ? tt('armory_choose_perk') : tt('armory_choose');

        card.innerHTML = `
            <span class="weapon-card-tag">${item.code}</span>
            <div class="weapon-card-icon-box">${item.icon}</div>
            <h3>${wName}</h3>
            <div class="weapon-card-role">${wRole}</div>
            <p class="weapon-card-desc">${wDesc}</p>
            <div class="weapon-specs-box">
                <div class="spec-item"><span class="spec-label">${tt('spec_dmg')}:</span><span class="spec-val pro">${specs.dmg}</span></div>
                <div class="spec-item"><span class="spec-label">${tt('spec_rate')}:</span><span class="spec-val">${specs.rate}</span></div>
                <div class="spec-item"><span class="spec-label">${tt('spec_range')}:</span><span class="spec-val">${specs.range}</span></div>
                <div class="spec-item"><span class="spec-label">${tt('spec_special')}:</span><span class="spec-val con">${specs.special}</span></div>
            </div>
            <button class="btn-choose-weapon" type="button" onclick="selectWeaponUpgrade('${ch.key}', '${ch.type}')">
                ${btnText}
            </button>
        `;
        grid.appendChild(card);
    });

    document.getElementById('armoryEyebrow').textContent = tt('armory_eyebrow');
    document.getElementById('armoryTitle').textContent = tt('armory_title');
    document.getElementById('armorySubtitle').textContent = tt('armory_sub');

    modal.style.display = 'flex';
    modal.classList.add('open');
    showCursor();
}

function selectWeaponUpgrade(key, itemType) {
    const modal = document.getElementById('weaponSelectScreen');
    if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
    }

    if (!player.weapons) player.weapons = ['knife'];
    if (!player.perks) player.perks = [];

    const isPerk = itemType === 'perk' || Boolean(TACTICAL_PERKS[key]);

    if (isPerk) {
        player.perks.push(key);
        if (key === 'nano_plating') {
            player.perkNano = (player.perkNano || 0) + 1;
            player.maxHp += 50;
            player.hp = player.maxHp;
        } else if (key === 'adrenaline') {
            player.perkAdrenaline = (player.perkAdrenaline || 0) + 1;
            player.speed += 0.55;
            player.dashSpeed += 1.5;
        } else if (key === 'plasma') {
            player.perkPlasma = (player.perkPlasma || 0) + 1;
            player.atk = Math.round(player.atk * 1.3);
        } else if (key === 'cryo_vent') {
            player.perkCryo = (player.perkCryo || 0) + 1;
        } else if (key === 'vampiric') {
            player.perkVampire = (player.perkVampire || 0) + 1;
        } else if (key === 'ricochet') {
            player.perkRicochet = (player.perkRicochet || 0) + 1;
        } else if (key === 'kinetic_emp') {
            player.perkEmp = (player.perkEmp || 0) + 1;
        } else if (key === 'thermal_trail') {
            player.perkThermal = (player.perkThermal || 0) + 1;
        }
        sWeaponUnlock();

        const pName = tt(TACTICAL_PERKS[key]?.nameKey || key);
        floatingTexts.push({
            x: player.x,
            y: player.y - 30,
            text: tt('perk_claim').replace('{p}', pName),
            color: '#ffd700',
            life: 140,
            maxLife: 140
        });
    } else {
        if (!player.weapons.includes(key)) {
            player.weapons.push(key);
        }
        player.currentWeapon = key;
        sWeaponUnlock();

        const wName = tt(WEAPONS[key]?.nameKey || key);
        floatingTexts.push({
            x: player.x,
            y: player.y - 30,
            text: tt('armory_claim').replace('{w}', wName),
            color: '#00f0ff',
            life: 120,
            maxLife: 120
        });
    }

    updateUI();

    const next = pendingNextLevel != null ? pendingNextLevel : (currentLevel + 1);
    pendingNextLevel = null;
    setTimeout(() => {
        levelTransition = false;
        hideCursor();
        initLevel(next);
    }, 400);
}

function switchWeapon(keyOrIdx) {
    if (!player || !player.weapons || !player.weapons.length) return;
    let target = null;
    if (typeof keyOrIdx === 'number') {
        const idx = keyOrIdx % player.weapons.length;
        target = player.weapons[idx >= 0 ? idx : player.weapons.length + idx];
    } else if (typeof keyOrIdx === 'string') {
        if (player.weapons.includes(keyOrIdx)) target = keyOrIdx;
    }
    if (target && target !== player.currentWeapon) {
        player.currentWeapon = target;
        sWeaponSwitch();
        updateUI();
    }
}

function cycleWeapon(reverse = false) {
    if (!player || !player.weapons || player.weapons.length <= 1) return;
    const curIdx = player.weapons.indexOf(player.currentWeapon);
    const nextIdx = (curIdx + (reverse ? -1 : 1) + player.weapons.length) % player.weapons.length;
    switchWeapon(nextIdx);
}

function playerAttack(fromTouch) {
    if (!player || gameState !== 'playing') return;
    const curW = player.currentWeapon || 'knife';
    const wConf = WEAPONS[curW] || WEAPONS.knife;

    if (!player.weaponCooldowns) player.weaponCooldowns = {};
    if (player.weaponCooldowns[curW] > 0) return;

    if (curW === 'minigun' && player.minigunOverheat > 0) {
        sLocked();
        floatingTexts.push({
            x: player.x, y: player.y - 20,
            text: tt('weapon_overheated'),
            color: '#ff4757', life: 40, maxLife: 40
        });
        return;
    }

    const cdFactor = (player && player.perkCryo) ? 0.65 : 1.0;
    const finalCd = Math.max(3, Math.round(wConf.cooldown * cdFactor));
    player.weaponCooldowns[curW] = finalCd;
    player.attackAnim = Math.min(15, finalCd);

    if (tutorialActive && tutorialStep === 2) {
        advanceTutorialStep(2);
    }

    const allowAutoAim = (settings && settings.autoAim !== false) && (fromTouch || !mouseActive || (settings && settings.deviceMode === 'mobile'));
    if (allowAutoAim) {
        let best = null, bd = 9 * CELL;
        if (monsters) {
            for (let i = 0; i < monsters.length; i++) {
                const m = monsters[i];
                if (!m || m.hp <= 0) continue;
                const d = Math.hypot(m.x - player.x, m.y - player.y);
                if (d < bd) { bd = d; best = m; }
            }
        }
        if (best) {
            player.facing = Math.atan2(best.y - player.y, best.x - player.x);
        } else if (mouseActive) {
            const zoom = getGameZoom();
            const wx = cameraX + (mouseX - W / 2) / zoom;
            const wy = cameraY + (mouseY - H / 2) / zoom;
            player.facing = Math.atan2(wy - player.y, wx - player.x);
        }
    } else {
        const zoom = getGameZoom();
        const wx = cameraX + (mouseX - W / 2) / zoom;
        const wy = cameraY + (mouseY - H / 2) / zoom;
        player.facing = Math.atan2(wy - player.y, wx - player.x);
    }

    if (curW === 'knife') {
        const range = 44;
        const ax = player.x + Math.cos(player.facing) * range * 0.7;
        const ay = player.y + Math.sin(player.facing) * range * 0.7;
        let didBackstab = false;
        monsters.forEach(m => {
            if (m.hp > 0 && dist({ x: ax, y: ay }, m) < range) {
                const angleDiff = Math.abs(normAngle(m.angle - player.facing));
                const isBackstab = angleDiff < 1.1;
                if (isBackstab) {
                    didBackstab = true;
                    const bsDmg = player.atk * 2.2 * (0.95 + Math.random() * 0.25);
                    attackMonster(m, bsDmg);
                    addShake(7);
                    addShockwave(m.x, m.y, 45, '#ffd700', 14);
                    addParticle(m.x, m.y, '#ffd700', 12, 4, 18);
                    addParticle(m.x, m.y, '#ff0055', 10, 3.5, 16);
                    floatingTexts.push({
                        x: m.x, y: m.y - 18,
                        text: tt('skill_backstab'),
                        color: '#ffeaa7', life: 48, maxLife: 48
                    });
                } else {
                    attackMonster(m, player.atk * (0.9 + Math.random() * 0.3));
                }
            }
        });

        // Hit volatile barrels with knife
        if (typeof barrels !== 'undefined' && barrels.length) {
            barrels.forEach(b => {
                if (!b.exploded && dist({ x: ax, y: ay }, b) < range) {
                    detonateBarrel(b);
                }
            });
        }

        if (didBackstab) {
            sBackstab();
        } else {
            sKnifeSlash();
            addParticle(ax, ay, '#f1c40f', 6, 3, 10);
        }
    } else if (curW === 'rifle') {
        sRifle();
        addShake(2.5);
        if (!REDUCE_MOTION) {
            cameraX -= Math.cos(player.facing) * 2.5;
            cameraY -= Math.sin(player.facing) * 2.5;
        }
        const speed = 15;
        const vx = Math.cos(player.facing) * speed;
        const vy = Math.sin(player.facing) * speed;
        projectiles.push({
            x: player.x + Math.cos(player.facing) * 16,
            y: player.y + Math.sin(player.facing) * 16,
            dx: vx,
            dy: vy,
            life: 45,
            isPlayer: true,
            kind: 'rifle',
            color: '#00f0ff',
            dmg: player.atk * 1.4,
            hitRadius: 7,
            pierce: 2,
            hitMonsters: []
        });
        addParticle(player.x + Math.cos(player.facing) * 18, player.y + Math.sin(player.facing) * 18, '#00f0ff', 5, 3, 8);
    } else if (curW === 'grenade') {
        sGrenadeToss();
        const speed = 7.8;
        const vx = Math.cos(player.facing) * speed;
        const vy = Math.sin(player.facing) * speed;
        projectiles.push({
            x: player.x + Math.cos(player.facing) * 14,
            y: player.y + Math.sin(player.facing) * 14,
            dx: vx,
            dy: vy,
            life: 65,
            bounces: 3,
            isPlayer: true,
            kind: 'grenade',
            dmg: player.atk * 1.75,
            radius: 70,
            hitRadius: 10
        });
    } else if (curW === 'bazooka') {
        sBazookaLaunch();
        addShake(5);
        if (!REDUCE_MOTION) {
            cameraX -= Math.cos(player.facing) * 5.5;
            cameraY -= Math.sin(player.facing) * 5.5;
        }
        const speed = 8.5;
        const vx = Math.cos(player.facing) * speed;
        const vy = Math.sin(player.facing) * speed;
        projectiles.push({
            x: player.x + Math.cos(player.facing) * 20,
            y: player.y + Math.sin(player.facing) * 20,
            dx: vx,
            dy: vy,
            life: 70,
            isPlayer: true,
            kind: 'bazooka',
            dmg: player.atk * 2.6,
            radius: 95,
            hitRadius: 12
        });
        addParticle(player.x - Math.cos(player.facing) * 10, player.y - Math.sin(player.facing) * 10, '#e67e22', 8, 3, 14);
    } else if (curW === 'shield') {
        if (player.shieldTimer > 0) {
            // Kinetic Pulse Discharge Skill
            sShieldDischarge();
            addShake(8);
            addShockwave(player.x, player.y, 85, '#00f0ff', 22);
            addParticle(player.x, player.y, '#00f0ff', 22, 5, 25);
            addParticle(player.x, player.y, '#ffffff', 14, 4, 18);
            projectiles = projectiles.filter(p => {
                if (!p.isPlayer && dist(p, player) < 90) {
                    addParticle(p.x, p.y, '#00f0ff', 6, 3, 12);
                    return false;
                }
                return true;
            });
            if (monsters) {
                monsters.forEach(m => {
                    if (m.hp > 0 && dist(player, m) < 85) {
                        attackMonster(m, player.atk * 0.95);
                        m.stunTimer = Math.max(m.stunTimer || 0, 35);
                        const pushAng = Math.atan2(m.y - player.y, m.x - player.x);
                        moveEntity(m, Math.cos(pushAng) * 35, Math.sin(pushAng) * 35);
                    }
                });
            }
            player.shieldTimer = 0;
            floatingTexts.push({
                x: player.x, y: player.y - 25,
                text: tt('skill_pulse'),
                color: '#00f0ff', life: 55, maxLife: 55
            });
        } else {
            sShieldOn();
            player.shieldTimer = 150;
            addParticle(player.x, player.y, '#00f0ff', 16, 4, 25);
            floatingTexts.push({
                x: player.x, y: player.y - 25,
                text: 'SHIELD ACTIVE!',
                color: '#00f0ff', life: 60, maxLife: 60
            });
        }
    } else if (curW === 'minigun') {
        sMinigun();
        addShake(1);
        if (!REDUCE_MOTION) {
            cameraX -= Math.cos(player.facing) * 0.8;
            cameraY -= Math.sin(player.facing) * 0.8;
        }
        const heatInc = (player && player.perkCryo) ? 2.5 : 5;
        player.minigunHeat = (player.minigunHeat || 0) + heatInc;
        if (player.minigunHeat >= 100) {
            player.minigunOverheat = 75;
            sLocked();
            addParticle(player.x, player.y, '#ff4757', 14, 3, 20);
        }
        const spread = (Math.random() - 0.5) * 0.18;
        const aimAngle = player.facing + spread;
        const speed = 15;
        projectiles.push({
            x: player.x + Math.cos(player.facing) * 18,
            y: player.y + Math.sin(player.facing) * 18,
            dx: Math.cos(aimAngle) * speed,
            dy: Math.sin(aimAngle) * speed,
            life: 38,
            isPlayer: true,
            kind: 'minigun',
            dmg: player.atk * 0.45,
            hitRadius: 5
        });
        addParticle(player.x + Math.cos(aimAngle) * 18, player.y + Math.sin(aimAngle) * 18, '#ffeaa7', 3, 2, 6);
        addBrassCasing(player.x, player.y, player.facing);
    }
}

function updatePlayer() {
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy = -1;
    if (keys['s'] || keys['arrowdown']) dy = 1;
    if (keys['a'] || keys['arrowleft']) dx = -1;
    if (keys['d'] || keys['arrowright']) dx = 1;
    if (touchMove.active && (touchMove.dx !== 0 || touchMove.dy !== 0)) {
        dx += touchMove.dx;
        dy += touchMove.dy;
    }

    // Analog stick: pertahankan magnitudo 0..1 agar setengah-tilt = jalan pelan.
    let analogMag = 1;
    if (touchMove.active && (touchMove.dx !== 0 || touchMove.dy !== 0)) {
        analogMag = Math.min(1, Math.hypot(touchMove.dx, touchMove.dy));
    }

    if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        dx /= len;
        dy /= len;
        player.facing = Math.atan2(dy, dx);
    }

    let speed = player.speed * (0.35 + 0.65 * analogMag);
    if (player.shieldTimer > 0) speed *= 0.85; // 15% slow saat perisai aktif
    if (player.currentWeapon === 'minigun' && player.attackAnim > 0) speed *= 0.75; // 25% slow saat menembakkan minigun

    // Player Status Effects Processing
    if (player.freezeTimer > 0) {
        player.freezeTimer--;
        speed *= 0.65;
        if (Math.random() < 0.2) addParticle(player.x + (Math.random() - 0.5) * 10, player.y + (Math.random() - 0.5) * 10, '#38bdf8', 1, 1, 8);
    }
    if (player.poisonTimer > 0) {
        player.poisonTimer--;
        if (player.poisonTimer % 50 === 0 && player.hp > 1) {
            player.hp -= 1;
            addParticle(player.x, player.y, '#10b981', 3, 1.5, 12);
            floatingTexts.push({ x: player.x, y: player.y - 18, text: '-1 🧪', color: '#10b981', life: 25, maxLife: 25 });
            updateUI();
        }
    }
    if (player.burnTimer > 0) {
        player.burnTimer--;
        if (player.burnTimer % 40 === 0 && player.hp > 1) {
            player.hp -= 1;
            addParticle(player.x, player.y, '#f97316', 3, 2, 12);
            floatingTexts.push({ x: player.x, y: player.y - 18, text: '-1 🔥', color: '#f97316', life: 25, maxLife: 25 });
            updateUI();
        }
    }

    if (player.dashing && player.dashTimer > 0) {
        speed = player.dashSpeed;
        player.dashTimer--;
        if (player.invincible < 2) player.invincible = 2;
        if (player.dashTimer % 2 === 0) {
            addParticle(player.x, player.y, '#8fa8ff', 2, 2, 14);
            if (!player.afterimages) player.afterimages = [];
            player.afterimages.push({
                x: player.x,
                y: player.y,
                facing: player.facing,
                life: 8,
                maxLife: 8
            });
        }

        // Perk Thermal Trail: Drop scorching fire patches along dash trajectory
        if (player && player.perkThermal) {
            thermalTrails.push({
                x: player.x,
                y: player.y,
                life: 120,
                maxLife: 120,
                dmg: player.atk * 0.35
            });
        }
    } else {
        player.dashing = false;
    }

    // Decay dash afterimages smoothly
    if (player.afterimages && player.afterimages.length) {
        for (let i = player.afterimages.length - 1; i >= 0; i--) {
            player.afterimages[i].life--;
            if (player.afterimages[i].life <= 0) {
                player.afterimages.splice(i, 1);
            }
        }
    }

    moveEntity(player, dx * speed, dy * speed);

    if (dx !== 0 || dy !== 0) {
        playerFootstepDist += speed;
        if (playerFootstepDist > 30) {
            playerFootstepDist = 0;
            sFootstep();
            addParticle(player.x, player.y + 4, '#555566', 1, 0.5, 10);
        }
        if (tutorialActive && tutorialStep === 0) {
            tutorialMoveDist += speed;
            const sub = document.getElementById('tutSub');
            if (sub) sub.textContent = `${lang === 'id' ? 'Kalibrasi roda & track' : 'Calibrating tracks'}: ${Math.min(50, Math.floor(tutorialMoveDist))}/50px`;
            const status = document.getElementById('tutStatus');
            if (status) status.textContent = `${Math.min(50, Math.floor(tutorialMoveDist))}/50px`;
            if (tutorialMoveDist >= 50) {
                advanceTutorialStep(0);
            }
        }
    }

    if (mouseActive) {
        const zoom = getGameZoom();
        const wx = cameraX + (mouseX - W / 2) / zoom;
        const wy = cameraY + (mouseY - H / 2) / zoom;
        player.facing = Math.atan2(wy - player.y, wx - player.x);
    }

    // Auto-fire minigun saat space atau klik mouse ditahan terus
    if ((keys[' '] || isMouseDown) && player.currentWeapon === 'minigun') {
        playerAttack();
    }

    if (player.invincible > 0) player.invincible--;
    if (player.attackAnim > 0) player.attackAnim--;
    if (dashCooldown > 0) dashCooldown--;
    if (attackCooldown > 0) attackCooldown--;
    if (screenShake > 0) screenShake--;

    // Update weapon cooldowns
    if (player.weaponCooldowns) {
        for (const k in player.weaponCooldowns) {
            if (player.weaponCooldowns[k] > 0) player.weaponCooldowns[k]--;
        }
    }

    // Update Shield Timer & efek perlindungan
    if (player.shieldTimer > 0) {
        player.shieldTimer--;
        if (player.invincible < 2) player.invincible = 2;
        if (player.shieldTimer % 4 === 0) addParticle(player.x, player.y, '#00f0ff', 1, 1, 10);
    }

    // Update Minigun Cooling, Overheat & Thermal Steam Purge
    if (player.minigunOverheat > 0) {
        player.minigunOverheat--;
        if (player.minigunOverheat % 6 === 0) {
            addParticle(player.x, player.y, '#ff4757', 2, 1.5, 12);
        }
    } else if (player.minigunHeat > 0) {
        if (player.attackAnim === 0) {
            if (player.minigunHeat >= 70 && !player.isPurging) {
                player.isPurging = true;
                sSteamVent();
                floatingTexts.push({
                    x: player.x, y: player.y - 24,
                    text: tt('skill_purge'),
                    color: '#ecf0f1', life: 42, maxLife: 42
                });
                const fx = player.x + Math.cos(player.facing) * 20;
                const fy = player.y + Math.sin(player.facing) * 20;
                for (let i = 0; i < 14; i++) {
                    const sa = player.facing + (Math.random() - 0.5) * 0.7;
                    const sd = 2.0 + Math.random() * 3.5;
                    pushParticle({
                        x: fx, y: fy,
                        vx: Math.cos(sa) * sd,
                        vy: Math.sin(sa) * sd,
                        life: 20 + Math.random() * 10,
                        maxLife: 30,
                        color: '#f1f2f6',
                        size: 3 + Math.random() * 4
                    });
                }
                if (monsters) {
                    monsters.forEach(m => {
                        if (m.hp > 0 && dist({ x: fx, y: fy }, m) < 56) {
                            attackMonster(m, player.atk * 0.35);
                            m.stunTimer = Math.max(m.stunTimer || 0, 12);
                        }
                    });
                }
            }
            player.minigunHeat = Math.max(0, player.minigunHeat - (player.isPurging ? 2.2 : 0.8));
            if (player.minigunHeat <= 15) player.isPurging = false;
        }
    }

    const pmx = Math.floor(player.x / CELL);
    const pmy = Math.floor(player.y / CELL);
    if (visitedTiles[pmy] && visitedTiles[pmy][pmx] !== undefined) {
        visitedTiles[pmy][pmx] = true;
    }
    const pIdx = pmy * mazeW + pmx;
    if (pIdx >= 0 && pIdx < MAX_MINIMAP_TILES) {
        exploredCells[pIdx] = 1;
    }
    const viewDist = (currentLevel === LEVELS - 1) ? 24 : (currentLevel % 2 === 0 ? 5 : 8);
    for (let y = Math.max(0, pmy - viewDist); y < Math.min(mazeH, pmy + viewDist + 1); y++) {
        for (let x = Math.max(0, pmx - viewDist); x < Math.min(mazeW, pmx + viewDist + 1); x++) {
            if (Math.abs(x - pmx) + Math.abs(y - pmy) <= viewDist) {
                fogOfWar[y][x] = true;
            }
        }
    }

    artifacts.forEach(a => {
        if (!a.collected && dist(a, player) < 26) {
            a.collected = true;
            coinsCollected++;
            sArtifact();
            const aColor = (a.type && a.type.color) ? a.type.color : '#3498db';
            addParticle(a.x, a.y, aColor, 18, 5, 35);
            player.hp = Math.min(player.maxHp, player.hp + 8);
            floatingTexts.push({
                x: a.x, y: a.y - 20,
                text: `+${aTypeName(a.type || { name: 'Artefak', nameEn: 'Artifact' })}!`,
                color: aColor,
                life: 60,
                maxLife: 60
            });
            if (tutorialActive && tutorialStep === 3) {
                advanceTutorialStep(3);
            }
            updateUI();
        }
    });

    // Emergency Artifact Magnet: Saat artefak > 70% terkumpul & HP < 25%, sisa artefak bergeser mendekat ke player
    updateEmergencyArtifactMagnet();

    // Check Classified Lore Data Disc Pickup (Sektor 2+)
    if (typeof dataDiscs !== 'undefined' && dataDiscs.length) {
        dataDiscs.forEach(d => {
            if (!d.collected && dist(d, player) < 22) {
                d.collected = true;
                addParticle(d.x, d.y, '#00e5ff', 24, 6, 35);
                floatingTexts.push({
                    x: d.x, y: d.y - 20,
                    text: (typeof lang !== 'undefined' && lang === 'id') ? '+DATA LOG TERDEKODIFIKASI!' : '+DATA LOG DECRYPTED!',
                    color: '#00e5ff',
                    life: 80,
                    maxLife: 80
                });
                openLoreModal(d.log);
            }
        });
    }

    // Check Wrecked BMPT Prototype Robot Inspection (Sector 10)
    if (wreckedRobot && currentLevel === 9 && !wreckedRobot.inspected && dist(player, wreckedRobot) < 28) {
        wreckedRobot.inspected = true;
        openRobotMemoryModal();
    }

    // Check Nanite Medical Chamber Interaction
    if (typeof medPods !== 'undefined' && medPods.length) {
        medPods.forEach(pod => {
            if (!pod.used && dist(player, pod) < 22) {
                pod.used = true;
                player.hp = Math.min(player.maxHp, player.hp + 60);
                sMedPod();
                addShockwave(pod.x, pod.y, 65, '#2ecc71', 22);
                for (let i = 0; i < 22; i++) {
                    addParticle(pod.x, pod.y, '#2ecc71', 2, 3, 25);
                }
                floatingTexts.push({
                    x: pod.x,
                    y: pod.y - 25,
                    text: tt('medpod_heal'),
                    color: '#2ecc71',
                    life: 100,
                    maxLife: 100
                });
                updateUI();
            }
        });
    }

    // Diegetic Low Health Screen Border Vascular Warning & Heartbeat Audio
    if (document.body) {
        const isLowHp = player.hp < player.maxHp * 0.3;
        document.body.classList.toggle('low-health-warning', isLowHp);
        if (isLowHp && player.hp > 0 && gameState === 'playing') {
            const now = Date.now();
            if (now - lastHeartbeatTime > 820) {
                lastHeartbeatTime = now;
                sHeartbeat();
            }
        }
    }

    if (exitPos && !levelTransition && dist(player, exitPos) < 26) {
        if (coinsCollected >= artifacts.length) {
            sExitOpen();
            nextLevel();
        } else if (lockMsgCooldown <= 0) {
            const need = artifacts.length - coinsCollected;
            sLocked();
            if (!menuDemo) {
                floatingTexts.push({
                    x: player.x, y: player.y - 25,
                    text: tt('msg_exit_locked').replace('{n}', need),
                    color: '#e74c3c',
                    life: 90,
                    maxLife: 90
                });
            }
            lockMsgCooldown = 80;
        }
    }

    if (lockMsgCooldown > 0) lockMsgCooldown--;
}

function hasLineOfSight(m, target) {
    const dx = target.x - m.x, dy = target.y - m.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(d / (CELL / 3)));
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (isWall(m.x + dx * t, m.y + dy * t)) return false;
    }
    return true;
}

function turnToward(current, target) {
    let diff = target - current;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return current + diff * 0.18;
}

function turnTowardFast(current, target) {
    let diff = target - current;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return current + diff * 0.35;
}

function monsterMove(m, spd) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(spd) || spd <= 0) return false;
    const ox = m.x, oy = m.y;
    moveEntity(m, Math.cos(m.angle) * spd, Math.sin(m.angle) * spd);
    if (Math.hypot(m.x - ox, m.y - oy) > 0.4) {
        m.stuckTimer = 0;
        m.blocked = false;
        return true;
    }

    m.stuckTimer = (m.stuckTimer || 0) + 1;
    m.blocked = true;
    if (!m.turnDir) m.turnDir = Math.random() < 0.5 ? 1 : -1;

    // Corner slide assist: uji 3 sudut adaptif untuk menghemat siklus CPU
    for (let side = 0; side < 2; side++) {
        const dir = side === 0 ? m.turnDir : -m.turnDir;
        for (let step = 1; step <= 3; step++) {
            const a = m.angle + dir * (Math.PI / 8) * step;
            const bx = m.x, by = m.y;
            moveEntity(m, Math.cos(a) * spd, Math.sin(a) * spd);
            if (Math.hypot(m.x - bx, m.y - by) > 0.1) {
                m.angle = a;
                return true;
            }
            m.x = bx;
            m.y = by;
        }
    }

    return false;
}

function separationForces() {
    const len = monsters.length;
    for (let i = 0; i < len; i++) {
        const m = monsters[i];
        if (m.hp > 0) {
            m.rx = 0;
            m.ry = 0;
        }
    }
    for (let i = 0; i < len; i++) {
        const a = monsters[i];
        if (a.hp <= 0 || a.name === 'The Monolith' || a.isHarvester || a.name === 'Harvester' || a.name === 'Mother Harvester') continue;
        const aSize = a.size || 14;
        for (let j = i + 1; j < len; j++) {
            const b = monsters[j];
            if (b.hp <= 0 || b.name === 'The Monolith' || b.isHarvester || b.name === 'Harvester' || b.name === 'Mother Harvester') continue;
            const bSize = b.size || 14;
            const minDist = aSize + bSize + 4;
            const dx = b.x - a.x;
            const dy = b.y - a.y;

            // Eliminasi 90% kalkulasi akar kuadrat via uji batas cepat
            if (Math.abs(dx) >= minDist || Math.abs(dy) >= minDist) continue;

            const d2 = dx * dx + dy * dy;
            if (d2 >= minDist * minDist) continue;

            const d = Math.sqrt(d2);
            let nx, ny, p;
            if (d < 0.5) {
                // Posisi bertumpuk: dorong ke arah berlawanan secara deterministik
                const ang = ((i * 3 + j * 7) % 12) * (Math.PI / 6);
                nx = Math.cos(ang);
                ny = Math.sin(ang);
                p = 1.8;
            } else {
                nx = dx / d;
                ny = dy / d;
                // Repulsi murni selalu positif (mencegah osilasi tarik-menarik gravitasi)
                p = Math.min(2.4, (minDist - d) * 0.12);
            }

            a.rx -= nx * p;
            a.ry -= ny * p;
            b.rx += nx * p;
            b.ry += ny * p;
        }
    }
}

function applySeparation(m) {
    if (m.rx || m.ry) {
        const rx = Math.max(-2.5, Math.min(2.5, m.rx));
        const ry = Math.max(-2.5, Math.min(2.5, m.ry));
        moveEntity(m, rx, ry);
    }
}

let bfsPrev = null, bfsQueue = null, bfsBufSize = 0;
function ensureBfsBuffers(size) {
    if (!bfsPrev || bfsBufSize < size) {
        bfsBufSize = Math.max(size, 4096);
        bfsPrev = new Int16Array(bfsBufSize);
        bfsQueue = new Int32Array(bfsBufSize);
    }
}

const BFS_DIRS = [0, -1, 1, 0, 0, 1, -1, 0];

function bfsPath(sx, sy, tx, ty) {
    const w = mazeW, h = mazeH;
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    if (!Number.isFinite(w) || !Number.isFinite(h) || !maze || !maze.length) return [];
    if (sx < 1 || sy < 1 || tx < 1 || ty < 1 || sx >= w - 1 || sy >= h - 1 || tx >= w - 1 || ty >= h - 1) return [];
    if (!maze[sy] || !maze[ty] || maze[sy][sx] === 1 || maze[ty][tx] === 1) return [];
    if (sx === tx && sy === ty) return [];
    const total = w * h;
    ensureBfsBuffers(total);
    bfsPrev.fill(-2, 0, total);
    let qi = 0, qn = 0;
    const startIdx = sy * w + sx;
    bfsQueue[qn++] = startIdx;
    bfsPrev[startIdx] = -1;
    let found = false;
    while (qi < qn) {
        const idx = bfsQueue[qi++];
        const cx = idx % w, cy = (idx / w) | 0;
        if (cx === tx && cy === ty) { found = true; break; }
        for (let d = 0; d < 8; d += 2) {
            const nx = cx + BFS_DIRS[d], ny = cy + BFS_DIRS[d + 1];
            if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
            if (maze[ny][nx] === 1) continue;
            const ni = ny * w + nx;
            if (bfsPrev[ni] !== -2) continue;
            bfsPrev[ni] = idx;
            bfsQueue[qn++] = ni;
        }
    }
    if (!found && bfsPrev[ty * w + tx] === -2) return [];
    const path = [];
    let cur = ty * w + tx;
    let guard = total + 5;
    while (bfsPrev[cur] !== -1 && guard-- > 0) {
        path.push(cur);
        cur = bfsPrev[cur];
        if (cur < 0 || cur >= total) return [];
    }
    if (guard <= 0) return [];
    path.reverse();
    return path;
}

function findReachableCell(m) {
    const mx = Math.floor(m.x / CELL), my = Math.floor(m.y / CELL);
    if (maze && maze[my] && maze[my][mx] === 0) return { cx: mx, cy: my };

    // Pencarian ubin terbuka terdekat secara radial cepat tanpa memanggil BFS berulang
    if (maze) {
        for (let rad = 1; rad < 12; rad++) {
            for (let dy = -rad; dy <= rad; dy++) {
                for (let dx = -rad; dx <= rad; dx++) {
                    if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
                    const ty = my + dy, tx = mx + dx;
                    if (tx >= 1 && ty >= 1 && tx < mazeW - 1 && ty < mazeH - 1) {
                        if (maze[ty] && maze[ty][tx] === 0) {
                            return { cx: tx, cy: ty };
                        }
                    }
                }
            }
        }
    }
    return { cx: Math.max(1, Math.min(mazeW - 2, mx)), cy: Math.max(1, Math.min(mazeH - 2, my)) };
}

function pickWanderTarget(m) {
    const mx = Math.max(1, Math.min(mazeW - 2, Math.floor(m.x / CELL)));
    const my = Math.max(1, Math.min(mazeH - 2, Math.floor(m.y / CELL)));
    const minMan = Math.max(6, Math.floor(mazeW * 0.35));
    let best = null, bestMan = -1;

    for (let tries = 0; tries < 40; tries++) {
        const tx = 1 + Math.floor(Math.random() * (mazeW - 2));
        const ty = 1 + Math.floor(Math.random() * (mazeH - 2));
        if (!maze || !maze[ty] || maze[ty][tx] !== 0) continue;
        const man = Math.abs(tx - mx) + Math.abs(ty - my);
        if (man >= minMan) {
            m.wanderTarget = { cx: tx, cy: ty };
            m.pauseTimer = 10 + Math.floor(Math.random() * 20);
            m.path = null;
            m.pathIdx = 0;
            m.pathCooldown = 0;
            m.stall = 0;
            m.lastWayD = 99999;
            return;
        }
        if (man > bestMan) { bestMan = man; best = { cx: tx, cy: ty }; }
    }

    if (best && maze && maze[best.cy] && maze[best.cy][best.cx] === 0) {
        m.wanderTarget = best;
    } else {
        m.wanderTarget = findReachableCell(m);
    }
    m.pauseTimer = 15;
    m.path = null;
    m.pathIdx = 0;
    m.pathCooldown = 0;
    m.stall = 0;
    m.lastWayD = 99999;
}

function followPath(m, speed) {
    if (!m.path || m.pathIdx >= m.path.length) return false;
    const cellIdx = m.path[m.pathIdx];
    const tx = (cellIdx % mazeW) * CELL + CELL / 2;
    const ty = ((cellIdx / mazeW) | 0) * CELL + CELL / 2;
    const d = dist(m, { x: tx, y: ty });
    if (d < 15) {
        m.pathIdx++;
        m.stall = 0;
        m.lastWayD = 99999;
        return true;
    }
    if (d >= m.lastWayD - 0.1) {
        m.stall++;
    } else {
        m.stall = 0;
    }
    m.lastWayD = d;
    if (m.stall > 16) {
        // Terhambat di waypoint: hapus path agar BFS segera merute ulang dari ubin saat ini
        m.path = null;
        m.pathIdx = 0;
        m.pathCooldown = 0;
        m.stall = 0;
        m.lastWayD = 99999;
        return false;
    }
    const ang = Math.atan2(ty - m.y, tx - m.x);
    m.angle = turnTowardFast(m.angle, ang);
    monsterMove(m, speed);
    return true;
}

function updateMonsters() {
    separationForces();

    // Update Boss HUD Status
    const activeBoss = monsters.find(m => m.hp > 0 && (m.isBoss || m.isMonolith || m.name === 'The Monolith' || m.name === 'Mother Harvester'));
    const bossHud = hudEl('bossHud');
    if (bossHud) {
        if (activeBoss && gameState === 'playing' && !menuDemo) {
            if (bossHud.style.display !== 'block') bossHud.style.display = 'block';
            const fill = hudEl('bossBarFill');
            if (fill) {
                const widthStr = Math.max(0, Math.min(100, (activeBoss.hp / activeBoss.maxHp) * 100)) + '%';
                if (fill.style.width !== widthStr) fill.style.width = widthStr;
            }
            const nameEl = hudEl('bossHudName');
            setHudText(nameEl, activeBoss.name.toUpperCase());
            const phaseEl = hudEl('bossHudPhase');
            if (phaseEl) {
                const pct = activeBoss.hp / activeBoss.maxHp;
                setHudText(phaseEl, pct > 0.66 ? tt('boss_monolith_phase1') : (pct > 0.33 ? tt('boss_monolith_phase2') : tt('boss_monolith_phase3')));
            }
        } else if (bossHud.style.display !== 'none') {
            bossHud.style.display = 'none';
        }
    }

    monsters.forEach(m => {
        if (m.hp <= 0) return;
        if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) {
            const safe = findReachableCell(m);
            m.x = safe.cx * CELL + CELL / 2;
            m.y = safe.cy * CELL + CELL / 2;
            m.vx = 0;
            m.vy = 0;
        }
        if (m.blink === undefined) {
            m.blink = 30 + Math.floor(Math.random() * 60);
            m.growlT = 180 + Math.floor(Math.random() * 240);
        }
        if (m.blink > 0) m.blink--;
        else m.blink = 60 + Math.floor(Math.random() * 180);
        if (m.growlT > 0) m.growlT--;

        // Status Effects Processing (Burn DoT, Poison DoT, Freeze Slow, Stun)
        if (m.burnTimer > 0) {
            m.burnTimer--;
            if (m.burnTimer % 20 === 0) {
                const bDmg = 4 + (player && player.perkPlasma ? 3 : 0);
                m.hp -= bDmg;
                m.hitFlash = 6;
                addParticle(m.x + (Math.random() - 0.5) * 10, m.y + (Math.random() - 0.5) * 10, '#f97316', 2, 2, 12);
                floatingTexts.push({
                    x: m.x + (Math.random() - 0.5) * 10,
                    y: m.y - m.size - 6,
                    text: '-' + bDmg + ' 🔥',
                    color: '#f97316',
                    life: 25,
                    maxLife: 25
                });
                if (m.hp <= 0) {
                    m.hp = 0;
                    attackMonster(m, 1);
                    return;
                }
            }
        }

        if (m.poisonTimer > 0) {
            m.poisonTimer--;
            if (m.poisonTimer % 25 === 0) {
                const pDmg = 3;
                m.hp -= pDmg;
                m.hitFlash = 5;
                addParticle(m.x + (Math.random() - 0.5) * 8, m.y + (Math.random() - 0.5) * 8, '#10b981', 2, 1.5, 10);
                floatingTexts.push({
                    x: m.x + (Math.random() - 0.5) * 8,
                    y: m.y - m.size - 6,
                    text: '-' + pDmg + ' 🧪',
                    color: '#10b981',
                    life: 25,
                    maxLife: 25
                });
                if (m.hp <= 0) {
                    m.hp = 0;
                    attackMonster(m, 1);
                    return;
                }
            }
        }

        let isFrozen = false;
        if (m.freezeTimer > 0) {
            m.freezeTimer--;
            isFrozen = true;
            if (Math.random() < 0.2) {
                addParticle(m.x + (Math.random() - 0.5) * 10, m.y + (Math.random() - 0.5) * 10, '#38bdf8', 1, 1, 8);
            }
        }

        if (m.stunTimer > 0) {
            m.stunTimer--;
            if (Math.random() < 0.2) {
                addParticle(m.x + (Math.random() - 0.5) * 8, m.y + (Math.random() - 0.5) * 8, '#00f0ff', 1, 1, 6);
            }
            return;
        }
        if (m.name === 'The Monolith' || m.isHarvester || m.name === 'Harvester' || m.name === 'Mother Harvester') {
            m.stunTimer = 0;
            m.rx = 0;
            m.ry = 0;
            m.vx = 0;
            m.vy = 0;
            if (m.rootX !== undefined && m.rootY !== undefined) {
                m.x = m.rootX;
                m.y = m.rootY;
            }
        }
        if (m.name === 'Harvester' || m.isMotherHarvester || m.name === 'Mother Harvester') {
            m.speed = 0;
            m.vx = 0;
            m.vy = 0;
            if (m.filamentTrapCooldown > 0) m.filamentTrapCooldown--;

            const pdist = dist(m, player);
            let steppedOnTrap = false;

            if (pdist < m.size + 14) {
                steppedOnTrap = true;
            } else if (m.filaments && m.filaments.length && m.filamentTrapCooldown <= 0) {
                for (let f = 0; f < m.filaments.length; f++) {
                    const pts = m.filaments[f];
                    for (let p = 0; p < pts.length - 1; p++) {
                        const dSeg = distToSegment(player.x, player.y, pts[p].x, pts[p].y, pts[p + 1].x, pts[p + 1].y);
                        if (dSeg < 14) {
                            steppedOnTrap = true;
                            break;
                        }
                    }
                    if (steppedOnTrap) break;
                }
            }

            if (steppedOnTrap && !player.dashing && player.invincible <= 0 && m.filamentTrapCooldown <= 0) {
                m.filamentTrapCooldown = 85;
                m.hitFlash = 15;
                sFleshHit();
                sHurt();
                addShake(20);
                addShockwave(player.x, player.y, 50, '#ff0033', 22);
                for (let k = 0; k < 22; k++) {
                    addParticle(player.x, player.y, '#9e0d0d', 12, 4, 25);
                    addParticle(player.x, player.y, '#ffffff', 4, 3, 15);
                }

                // Sesuai aturan kanon Vita Carnis:
                // Jika terjerat filamen Harvester, persentase sisa kehidupan hanya 20% (atau tewas jika sudah <= 20%)!
                const targetHp = Math.round(player.maxHp * 0.20);
                if (player.hp > targetHp) {
                    player.hp = targetHp;
                } else {
                    player.hp = 0;
                }

                if (player.hp <= 0) {
                    handlePlayerDeath(m.name);
                } else {
                    player.invincible = 50;
                    floatingTexts.push({
                        x: player.x,
                        y: player.y - 30,
                        text: lang === 'en' ? '⚠️ HARVESTER FILAMENT TRAP: 20% HP REMAINING! ⚠️' : '⚠️ JEBAKAN FILAMEN HARVESTER: SISA NYAWA 20%! ⚠️',
                        color: '#ff2222',
                        life: 110,
                        maxLife: 110
                    });
                }
                updateUI();
            }

            // === MEKANIK KHUSUS APEX BOSS: MOTHER HARVESTER (SEKTOR 10) ===
            if (m.isMotherHarvester) {
                // 1. Letupan Spora Larva Crawl Berkala (Maksimum 3 Crawl aktif di map)
                if (m.sporeSpawnTimer > 0) m.sporeSpawnTimer--;
                if (m.sporeSpawnTimer <= 0 && pdist < 18 * CELL) {
                    const activeCrawls = monsters.filter(o => o.name === 'Crawl' && o.hp > 0).length;
                    if (activeCrawls < 3) {
                        m.sporeSpawnTimer = 300; // 5-6 detik sekali
                        m.hitFlash = 14;
                        addShockwave(m.x, m.y, 65, '#b81212', 26);
                        for (let k = 0; k < 20; k++) {
                            addParticle(m.x, m.y - 25, '#850a0a', 10, 3, 20);
                        }
                        // Spawn 1 spesimen Crawl keluar dari pori puncak kubah
                        const sAng = Math.random() * Math.PI * 2;
                        const sDist = m.size + 20;
                        const crawlX = m.x + Math.cos(sAng) * sDist;
                        const crawlY = m.y + Math.sin(sAng) * sDist;
                        monsters.push({
                            name: 'Crawl',
                            color: '#a82c2c',
                            x: crawlX,
                            y: crawlY,
                            vx: 0, vy: 0,
                            hp: 42 * diffStatMult,
                            maxHp: 42 * diffStatMult,
                            atk: 15 * diffStatMult,
                            speed: 1.4 * diffSpeedMult,
                            size: 13,
                            exp: 20,
                            ai: 'chase',
                            state: 'chase',
                            angle: sAng,
                            wanderTimer: 9999,
                            stuckTimer: 0, blocked: false,
                            rx: 0, ry: 0, turnDir: 1, netT2: 0,
                            lastWatchX: crawlX, lastWatchY: crawlY,
                            lastSeen: { x: player.x, y: player.y }, lastSeenTimer: 200,
                            path: null, pathIdx: 0, pathCooldown: 0,
                            stall: 0, lastWayD: 99999, checkTimer: 20,
                            lastPosX: 0, lastPosY: 0, wanderTarget: null,
                            pauseTimer: 0, lastPx: -1, lastPy: -1,
                            attackCooldown: 0, stunTimer: 0, hitFlash: 0,
                            level: m.level, ranged: false
                        });
                        floatingTexts.push({
                            x: m.x,
                            y: m.y - m.size - 20,
                            text: lang === 'en' ? '💥 CRAWL SPORE BURST!' : '💥 SEMBURAN SPORA CRAWL!',
                            color: '#ff4444',
                            life: 75,
                            maxLife: 75
                        });
                    }
                }

                // 2. Semburan Gas Neurotoksin saat Pemain Mendekat (< 115px)
                if (pdist < 120) {
                    if (Math.random() < 0.35) {
                        addParticle(
                            m.x + (Math.random() - 0.5) * 80,
                            m.y + (Math.random() - 0.5) * 80,
                            '#850a0a',
                            12, 1.5, 30
                        );
                    }
                    if (pdist < m.size + 24 && !player.dashing && player.invincible <= 0) {
                        player.hp = Math.max(0, player.hp - 8);
                        player.invincible = 35;
                        sHurt();
                        addShake(8);
                        floatingTexts.push({
                            x: player.x,
                            y: player.y - 20,
                            text: '-8 [TOXIC GAS]',
                            color: '#ff6b6b',
                            life: 45,
                            maxLife: 45
                        });
                        if (player.hp <= 0) handlePlayerDeath('Mother Harvester');
                        updateUI();
                    }
                }
            }

            return; // Harvester diam berakar: Jangan jalankan pathfinding atau gerak!
        }
        if (m.stunTimer > 0) {
            m.stunTimer--;
            if (m.attackCooldown > 0) m.attackCooldown--;
            m.x += Math.cos(m.angle + Math.PI) * 0.35;
            m.y += Math.sin(m.angle + Math.PI) * 0.35;
            m.hitFlash = Math.max(m.hitFlash, 4);
            return;
        }
        if (m.netT2 === undefined) m.netT2 = 0;
        m.netT2++;
        if (m.netT2 >= 300 && m.name !== 'The Monolith') {
            m.netT2 = 0;
            const moved5 = Math.hypot(m.x - m.lastWatchX, m.y - m.lastWatchY);
            m.lastWatchX = m.x;
            m.lastWatchY = m.y;
            if (moved5 < 3) {
                const t = findReachableCell(m);
                m.x = t.cx * CELL + CELL / 2;
                m.y = t.cy * CELL + CELL / 2;
                m.path = null;
                m.wanderTarget = null;
                m.pathIdx = 0;
                m.pathCooldown = 0;
                m.stall = 0;
                m.lastWayD = 99999;
                m.stuckTimer = 0;
                m.blocked = false;
            }
        }
        if (m.hitFlash > 0) m.hitFlash--;
        if (m.attackCooldown > 0) m.attackCooldown--;
        if (m.pathCooldown > 0) m.pathCooldown--;

        const pdist = dist(m, player);
        let detection = currentLevel % 2 === 0 ? 150 : 200;
        detection *= getDiffDetectMult();
        if (m.ai === 'chase') detection *= 1.25;
        const sight = pdist < detection && hasLineOfSight(m, player);
        let chaseSpeed = Math.max(m.speed * (0.8 + currentLevel * 0.04), 1.5);
        if (isFrozen) chaseSpeed *= 0.5;

        // Custom Behavior Pattern: Bat Dive-Bomb
        if (m.name === 'Bat' && pdist < 180 && pdist > 45) {
            if (m.diveTimer === undefined) m.diveTimer = 0;
            if (m.diveTimer > 0) {
                m.diveTimer--;
                chaseSpeed *= 2.0;
            } else if (Math.random() < 0.025 && hasLineOfSight(m, player)) {
                m.diveTimer = 35;
                addParticle(m.x, m.y, '#4338ca', 6, 2, 15);
            }
        }

        // Custom Behavior Pattern: Slime Swarm Flanking
        if (m.name === 'Slime' && pdist < 140 && pdist > 35) {
            const toP = Math.atan2(player.y - m.y, player.x - m.x);
            const flankDir = ((m.x + m.y) % 2 === 0) ? 1 : -1;
            const flankAng = toP + (Math.PI / 2.8) * flankDir;
            m.vx += Math.cos(flankAng) * 0.45;
            m.vy += Math.sin(flankAng) * 0.45;
        }

        // Custom Behavior Pattern: Crawl Ambush & Retreat
        if (m.name === 'Crawl' && m.retreatTimer > 0) {
            m.retreatTimer--;
            const awayAng = Math.atan2(m.y - player.y, m.x - player.x);
            m.angle = turnToward(m.angle, awayAng);
            monsterMove(m, chaseSpeed * 1.5);
            return;
        }

        // Custom Behavior Pattern: Ghost Wall Phasing
        if (m.name === 'Ghost') {
            if (m.phaseCooldown > 0) m.phaseCooldown--;
            if (m.isPhasing > 0) {
                m.isPhasing--;
                if (Math.random() < 0.25) {
                    addParticle(m.x + (Math.random() - 0.5) * 12, m.y + (Math.random() - 0.5) * 12, '#06b6d4', 2, 1, 10);
                }
            } else if (pdist > 50 && pdist < 260 && !hasLineOfSight(m, player) && m.phaseCooldown <= 0) {
                m.isPhasing = 110;
                m.phaseCooldown = 320;
            }
        }

        // Custom Behavior Pattern: Dark Knight Riposte Counter-Charge
        if (m.name === 'Dark Knight' && m.riposteTimer > 0) {
            m.riposteTimer--;
            const toP = Math.atan2(player.y - m.y, player.x - m.x);
            m.angle = toP;
            monsterMove(m, chaseSpeed * 2.8);
            addParticle(m.x, m.y, '#ef4444', 2, 1, 8);
            if (pdist < m.size + 18 && m.attackCooldown <= 0) {
                attackPlayer(m);
                m.attackCooldown = 50;
                m.riposteTimer = 0;
            }
            return;
        }

        // Custom Behavior Pattern: Dragon Strafe-Fire Cone
        if (m.name === 'Dragon') {
            if (m.dragonBreathTimer > 0) m.dragonBreathTimer--;
            if (m.dragonBreathTimer <= 0 && pdist < 230 && pdist > 50 && hasLineOfSight(m, player)) {
                m.dragonBreathTimer = 190;
                const baseAng = Math.atan2(player.y - m.y, player.x - m.x);
                for (let a = -1; a <= 1; a++) {
                    const fAng = baseAng + a * 0.26;
                    projectiles.push({
                        x: m.x, y: m.y,
                        dx: Math.cos(fAng) * 4.2,
                        dy: Math.sin(fAng) * 4.2,
                        dmg: Math.round(m.atk * 0.45),
                        life: 55,
                        color: '#f97316',
                        isFire: true
                    });
                }
                sHit();
                addParticle(m.x, m.y, '#f97316', 12, 3, 20);
                floatingTexts.push({
                    x: m.x, y: m.y - m.size - 10,
                    text: tt('dragon_firestorm'),
                    color: '#f97316', life: 40, maxLife: 40
                });
            }
        }

        // Custom Behavior Pattern: Lich Minion Wave
        if (m.name === 'Lich') {
            if (m.lichSummonTimer > 0) m.lichSummonTimer--;
            if (m.lichSummonTimer <= 0 && pdist < 260 && monsters.filter(o => o.hp > 0).length < 24) {
                m.lichSummonTimer = 280;
                for (let s = 0; s < 2; s++) {
                    const sAng = Math.random() * Math.PI * 2;
                    const sx = m.x + Math.cos(sAng) * 32;
                    const sy = m.y + Math.sin(sAng) * 32;
                    monsters.push({
                        name: 'Ghost',
                        color: '#3498db',
                        x: sx, y: sy,
                        vx: 0, vy: 0,
                        hp: 18 * diffStatMult, maxHp: 18 * diffStatMult,
                        atk: 10 * diffStatMult, speed: 1.3 * diffSpeedMult,
                        size: 11, exp: 8,
                        ai: 'chase', state: 'chase',
                        angle: sAng, wanderTimer: 9999, stuckTimer: 0, blocked: false,
                        rx: 0, ry: 0, turnDir: 1, netT2: 0,
                        lastWatchX: sx, lastWatchY: sy,
                        lastSeen: { x: player.x, y: player.y }, lastSeenTimer: 180,
                        path: null, pathIdx: 0, pathCooldown: 0,
                        stall: 0, lastWayD: 99999, checkTimer: 20,
                        lastPosX: 0, lastPosY: 0, wanderTarget: null,
                        pauseTimer: 0, lastPx: -1, lastPy: -1,
                        attackCooldown: 0, stunTimer: 0, hitFlash: 0,
                        burnTimer: 0, freezeTimer: 0, poisonTimer: 0, diveTimer: 0,
                        isPhasing: 0, phaseCooldown: 120,
                        level: m.level, ranged: false
                    });
                }
                addShockwave(m.x, m.y, 45, '#8e44ad', 18);
                floatingTexts.push({
                    x: m.x, y: m.y - m.size - 10,
                    text: tt('lich_summon'),
                    color: '#c084fc', life: 45, maxLife: 45
                });
            }
        }

        // Custom Behavior Pattern: Beholder Rotating Eye Beam Sweep
        if (m.name === 'Beholder') {
            if (m.beholderCooldown > 0) m.beholderCooldown--;
            if (m.beholderCooldown <= 0 && pdist < 240 && hasLineOfSight(m, player)) {
                m.beholderCooldown = 220;
                m.beholderCharge = 35;
            }
            if (m.beholderCharge > 0) {
                m.beholderCharge--;
                addParticle(m.x + (Math.random() - 0.5) * 16, m.y + (Math.random() - 0.5) * 16, '#1abc9c', 2, 1, 8);
                if (m.beholderCharge === 0) {
                    for (let b = 0; b < 6; b++) {
                        const bAng = (b / 6) * Math.PI * 2 + (m.angle || 0);
                        projectiles.push({
                            x: m.x, y: m.y,
                            dx: Math.cos(bAng) * 4.5,
                            dy: Math.sin(bAng) * 4.5,
                            dmg: Math.round(m.atk * 0.45),
                            life: 65,
                            color: '#1abc9c'
                        });
                    }
                    addShockwave(m.x, m.y, 50, '#1abc9c', 20);
                    floatingTexts.push({
                        x: m.x, y: m.y - m.size - 10,
                        text: tt('beholder_sweep'),
                        color: '#2dd4bf', life: 40, maxLife: 40
                    });
                }
            }
        }

        // Suara monster berkala: hanya saat bermain aktif, dan dengan interval 4-9 detik (tidak bising)
        const soundDist = (currentLevel % 2 === 0 ? 8 : 12) * CELL;
        if (gameState === 'playing' && !menuDemo && m.name !== 'Mimic') {
            if (m.growlT <= 0 && m.stunTimer <= 0 && pdist < soundDist) {
                monsterSound(m);
                m.growlT = 240 + Math.floor(Math.random() * 300);
            }
        }

        // === SMART HORROR STALKER AI: MIMIC ===
        if (m.name === 'Mimic') {
            if (m.disguised) {
                if (pdist < 52) {
                    m.disguised = false;
                    m.mimicState = 'lunge';
                    m.lungeTimer = 110;
                    sFleshHit();
                    addShake(14);
                    addShockwave(m.x, m.y, 45, '#ff2222', 16);
                    attackPlayer(m);
                    floatingTexts.push({
                        x: m.x, y: m.y - m.size - 16,
                        text: tt('mimic_ambush'),
                        color: '#ef4444', life: 60, maxLife: 60
                    });
                }
                return;
            }
            m.growlT = 999999; // Mimic kanon adalah silent ambush stalker, tidak meraung acak

            // Cek apakah pemain menatap Mimic dalam sorotan cahaya senter
            const toMimicAng = Math.atan2(m.y - player.y, m.x - player.x);
            let faceDiff = Math.abs(toMimicAng - player.facing);
            while (faceDiff > Math.PI) faceDiff -= Math.PI * 2;
            faceDiff = Math.abs(faceDiff);

            const inLightCone = faceDiff < 0.68; // Dalam kerucut sorotan senter (~39 derajat)
            const inSightDist = pdist < 9.0 * CELL;
            const hasLos = hasLineOfSight(player, m);
            const playerStaring = inLightCone && inSightDist && hasLos;

            if (m.mimicState === undefined) m.mimicState = 'stalk';
            if (m.lungeTimer === undefined) m.lungeTimer = 0;

            if (playerStaring && pdist > 3.2 * CELL) {
                // FASE 1: MEMBEKU / KAMUFLASE PATUNG (Don't Look Away / Weeping Angel)
                // Ketika dipandang langsung dalam cahaya senter dari jarak aman,
                // Mimic membeku tak bergerak seperti manekin manusia tanpa ekspresi!
                m.mimicState = 'freeze';
                m.mimicFrozen = true;
                chaseSpeed = 0;
                m.lungeTimer = 0;
            } else {
                m.mimicFrozen = false;
                // FASE 2: AMBUSH BURST LUNGE!
                // Terpicu jika pemain memalingkan pandangan atau jarak terlalu dekat (< 3.2 CELL)
                if (pdist < 3.2 * CELL || (m.mimicState === 'freeze' && !playerStaring)) {
                    if (m.mimicState !== 'lunge') {
                        m.mimicState = 'lunge';
                        m.lungeTimer = 110; // 1.8 detik sprint kilat
                        // Suara auman parau sergap mengerikan di posisi Mimic (BUKAN suara tikus)
                        playGutturalGrowl({ f0: 68, f1: 34, dur: 0.45, growlRate: 26, formant1: 320, formant2: 650, vol: 0.85, rasp: true }, m);
                    }
                }

                if (m.lungeTimer > 0) {
                    m.lungeTimer--;
                    chaseSpeed = Math.max(m.speed * 2.25, 3.4); // Kecepatan terkam melonjak 2.25x!
                    m.mimicState = 'lunge';
                } else {
                    m.mimicState = 'stalk';
                    chaseSpeed = Math.max(m.speed * 0.9, 1.35); // Stalking senyap
                }
            }
        }

        if (sight) {
            m.state = 'chase';
            m.lastSeen = { x: player.x, y: player.y };
            m.lastSeenTimer = 180;
            m.wanderTarget = null;

            if (m.name === 'The Monolith') {
                m.vx = 0;
                m.vy = 0;
                if (m.rootX !== undefined && m.rootY !== undefined) {
                    m.x = m.rootX;
                    m.y = m.rootY;
                }
                const targetAng = Math.atan2(player.y - m.y, player.x - m.x);
                m.angle = turnToward(m.angle, targetAng, 0.035);

                if (m.slamTimer === undefined) m.slamTimer = 180;
                if (m.sporeTimer === undefined) m.sporeTimer = 120;
                if (m.tendrilTimer === undefined) m.tendrilTimer = 90;

                const isPhase2 = m.hp < m.maxHp * 0.5;
                if (isPhase2 && !m.phase2Roared) {
                    m.phase2Roared = true;
                    sMonolithRoar();
                    addShake(22);
                    floatingTexts.push({
                        x: m.x, y: m.y - m.size - 35,
                        text: lang === 'en' ? '⚠️ PSYCHIC RESONANCE: MONOLITH ENRAGED ⚠️' : '⚠️ RESONANSI PSIKIK: MONOLITH MENGAMUK ⚠️',
                        color: '#ff1111', life: 100, maxLife: 100
                    });
                }
                const rateMul = isPhase2 ? 0.65 : 1.0;

                // 1. Heavy Ground Quake / Shockwave Slam + Weak Point Exposure
                if (m.weakPointTimer > 0) m.weakPointTimer--;
                m.slamTimer--;
                if (m.slamTimer <= 0) {
                    m.slamTimer = Math.round(180 * rateMul);
                    addShake(18);
                    sMonolithSlam();
                    addShockwave(m.x, m.y, 220, '#ff2222', 38);
                    addParticle(m.x, m.y, '#8b0000', 36, 6, 40);
                    m.weakPointTimer = 110; // Inti kosmik terbuka selama ~1.8 detik!
                    floatingTexts.push({
                        x: m.x, y: m.y - m.size - 25,
                        text: '! SEISMIC SLAM !',
                        color: '#ff3333', life: 55, maxLife: 55
                    });
                    floatingTexts.push({
                        x: m.x, y: m.y - m.size * 1.5,
                        text: tt('monolith_weak_exposed'),
                        color: '#ffd700', life: 80, maxLife: 80
                    });
                    if (pdist < 185 && !player.dashing && player.invincible <= 0) {
                        attackPlayer(m);
                    }
                }

                // Phase 3: Cosmic Reality Meltdown Super Salvo
                const isPhase3 = m.hp <= m.maxHp * 0.33;
                if (isPhase3) {
                    if (m.phase3Pulse === undefined) m.phase3Pulse = 0;
                    m.phase3Pulse++;
                    if (m.phase3Pulse % 45 === 0) {
                        const pAng = (m.phase3Pulse / 45) * 0.8;
                        for (let i = 0; i < 4; i++) {
                            const ang = pAng + (i * Math.PI / 2);
                            projectiles.push({
                                x: m.x, y: m.y - m.size * 0.5,
                                dx: Math.cos(ang) * 4.0,
                                dy: Math.sin(ang) * 4.0,
                                dmg: Math.round(m.atk * 0.35),
                                life: 80,
                                color: '#e11d48'
                            });
                        }
                    }
                }

                // 2. Multidirectional Carnis Spore Salvo
                m.sporeTimer--;
                if (m.sporeTimer <= 0) {
                    m.sporeTimer = Math.round(130 * rateMul);
                    const count = isPhase2 ? 14 : 10;
                    for (let i = 0; i < count; i++) {
                        const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
                        projectiles.push({
                            x: m.x, y: m.y - m.size * 0.35,
                            dx: Math.cos(ang) * 3.6,
                            dy: Math.sin(ang) * 3.6,
                            dmg: Math.round(m.atk * 0.45),
                            life: 90,
                            color: '#ff2222'
                        });
                    }
                    sHit();
                    addParticle(m.x, m.y - m.size * 0.35, '#ff2222', 18, 4, 25);
                }

                // 3. Writhing Tendril Lash Whip
                m.tendrilTimer--;
                if (m.tendrilTimer <= 0 && pdist < 320) {
                    m.tendrilTimer = Math.round(85 * rateMul);
                    const ang = Math.atan2(player.y - m.y, player.x - m.x);
                    projectiles.push({
                        x: m.x, y: m.y,
                        dx: Math.cos(ang) * 5.5,
                        dy: Math.sin(ang) * 5.5,
                        dmg: Math.round(m.atk * 0.7),
                        life: 60,
                        color: '#c0292b'
                    });
                }

                // Melee contact with titan body
                if (pdist < m.size + 20 && m.attackCooldown <= 0) {
                    attackPlayer(m);
                    m.attackCooldown = 40;
                }

                return; // Stationary Boss: Jangan jalankan pathfinding, gerak, atau separasi!
            } else if (m.ranged && pdist > 50 && pdist < 150 && m.attackCooldown <= 0) {
                projectiles.push({
                    x: m.x, y: m.y,
                    dx: (player.x - m.x) / pdist * 4,
                    dy: (player.y - m.y) / pdist * 4,
                    dmg: m.atk * 0.7,
                    life: 60,
                    color: m.color
                });
                m.attackCooldown = 60;
            } else if (pdist < (m.size ? m.size + 10 : 26) && m.attackCooldown <= 0) {
                attackPlayer(m);
                if (m.name === 'Crawl') {
                    m.retreatTimer = 45;
                    player.poisonTimer = Math.max(player.poisonTimer || 0, 75);
                }
                m.attackCooldown = 45;
            }

            // Jika Mimic membeku: tatap pemain secara langsung, jangan gerak dan jangan didorong dinding
            if (m.mimicFrozen) {
                m.angle = Math.atan2(player.y - m.y, player.x - m.x);
                return;
            }

            const pc = Math.floor(player.x / CELL), pr = Math.floor(player.y / CELL);
            if (!m.path || m.pathCooldown <= 0 || pc !== m.lastPx || pr !== m.lastPy) {
                const mc = Math.floor(m.x / CELL);
                const mr = Math.floor(m.y / CELL);
                m.path = bfsPath(mc, mr, pc, pr);
                m.pathIdx = 0;
                m.pathCooldown = 20;
                m.stall = 0;
                m.lastWayD = 99999;
                m.lastPx = pc;
                m.lastPy = pr;
            }
            if (!followPath(m, chaseSpeed)) {
                if (hasLineOfSight(m, player)) {
                    const ang = Math.atan2(player.y - m.y, player.x - m.x);
                    m.angle = turnToward(m.angle, ang);
                    monsterMove(m, chaseSpeed);
                } else {
                    m.path = null;
                    m.pathCooldown = 0;
                }
            }
            applySeparation(m);
        } else if (m.state === 'chase' || m.state === 'search') {
            if (m.lastSeen && m.lastSeenTimer > 0) {
                m.state = 'search';
                m.lastSeenTimer--;
                const gx = Math.floor(m.lastSeen.x / CELL);
                const gy = Math.floor(m.lastSeen.y / CELL);
                if (!m.path || m.pathCooldown <= 0) {
                    const mc = Math.floor(m.x / CELL);
                    const mr = Math.floor(m.y / CELL);
                    m.path = bfsPath(mc, mr, gx, gy);
                    m.pathIdx = 0;
                    m.pathCooldown = 30;
                    m.stall = 0;
                    m.lastWayD = 99999;
                }
                if (!followPath(m, Math.max(chaseSpeed * 0.95, 1.4))) {
                    m.lastSeen = null;
                    m.state = 'wander';
                    m.wanderTimer = 0;
                }
                applySeparation(m);
            } else {
                m.lastSeen = null;
                m.state = 'wander';
                m.wanderTimer = 0;
            }
        } else {
            if (!m.wanderTarget) {
                pickWanderTarget(m);
            }
            if (m.pauseTimer > 0) {
                m.pauseTimer--;
            } else {
                const gx = m.wanderTarget.cx, gy = m.wanderTarget.cy;
                const mc = Math.floor(m.x / CELL), mr = Math.floor(m.y / CELL);
                if (mc === gx && mr === gy) {
                    pickWanderTarget(m);
                } else {
                    if (!m.path || m.pathCooldown <= 0) {
                        m.path = bfsPath(mc, mr, gx, gy);
                        m.pathIdx = 0;
                        m.pathCooldown = 40;
                        m.stall = 0;
                        m.lastWayD = 99999;
                    }
                    if (!followPath(m, Math.max(chaseSpeed * 0.85, 1.2))) {
                        pickWanderTarget(m);
                    }
                }
                applySeparation(m);
            }
        }

        m.checkTimer--;
        if (m.checkTimer <= 0) {
            m.checkTimer = 28;
            const movedCheck = Math.hypot(m.x - m.lastPosX, m.y - m.lastPosY);
            // Deteksi monster tersangkut saat mengejar maupun berkelana
            if (movedCheck < 6 && !m.mimicFrozen && m.name !== 'The Monolith') {
                m.path = null;
                m.pathCooldown = 0;
                m.stall = 0;
                m.wanderTarget = null;
                // Selaraskan posisi ke poros ubin lorong terbuka terdekat agar tidak terjepit sudut
                const mc = Math.floor(m.x / CELL), mr = Math.floor(m.y / CELL);
                if (maze[mr] && maze[mr][mc] === 0) {
                    m.x = mc * CELL + CELL / 2;
                    m.y = mr * CELL + CELL / 2;
                }
                if (m.state === 'wander') pickWanderTarget(m);
            }
            m.lastPosX = m.x;
            m.lastPosY = m.y;
        }
    });

    if (monsters && monsters.some(m => m.hp <= 0)) {
        monsters = monsters.filter(m => m.hp > 0);
    }
}

function trapDamage() {
    return Math.round((10 + currentLevel * 2) * getDiffStatMult());
}

function updateTraps() {
    traps.forEach(tr => {
        if (tr.state === 'hidden') {
            if (tr.timer > 0 && --tr.timer <= 0) tr.state = 'armed';
            return;
        }
        if (tr.state === 'triggered' || tr.state === 'cooldown') {
            if (--tr.cool <= 0) {
                if (tr.state === 'triggered') { tr.state = 'cooldown'; tr.cool = 110; }
                else tr.state = 'armed';
            }
            return;
        }
        if (tr.state !== 'armed') return;
        if (typeof godmode !== 'undefined' && godmode) return;
        if (player.invincible > 0) return;
        if (Math.hypot(player.x - tr.x, player.y - tr.y) >= 24) return;
        let dmg = trapDamage();
        if (player && player.perkNano) {
            dmg *= Math.max(0.5, 1 - player.perkNano * 0.25);
        }
        player.hp -= dmg;
        player.invincible = 30;
        screenShake = 8;
        hurtFlash = 8;
        sHit();
        triggerHaptic('hit');
        addParticle(tr.x, tr.y, '#c0392b', 14, 5, 25);
        floatingTexts.push({
            x: player.x, y: player.y - 25,
            text: tt('trap_hit').replace('{n}', Math.round(dmg)),
            color: '#e74c3c', life: 80, maxLife: 80
        });
        tr.state = 'triggered';
        tr.cool = 35;
        if (player.hp <= 0) {
            handlePlayerDeath('Trap');
        }
        updateUI();
    });
}

function updateProjectiles() {
    projectiles = projectiles.filter(p => {
        p.x += p.dx;
        p.y += p.dy;
        p.life--;

        // Check projectile impact on volatile biohazard barrels
        if (typeof barrels !== 'undefined' && barrels.length) {
            for (let bi = 0; bi < barrels.length; bi++) {
                const b = barrels[bi];
                if (!b.exploded && dist(p, b) < 18) {
                    detonateBarrel(b);
                    return false;
                }
            }
        }

        if (p.isPlayer) {
            if (p.kind === 'grenade') {
                p.dx *= 0.96;
                p.dy *= 0.96;
                if (isWall(p.x, p.y)) {
                    if (isWall(p.x - p.dx, p.y)) {
                        p.dy = -p.dy * 0.7;
                    } else {
                        p.dx = -p.dx * 0.7;
                    }
                    p.bounces = (p.bounces || 3) - 1;
                    addParticle(p.x, p.y, '#f39c12', 3, 2, 8);
                    if (p.bounces <= 0) {
                        triggerExplosion(p.x, p.y, p.radius || 70, p.dmg, false);
                        sEMPBlast();
                        addGasCloud(p.x, p.y, 65, 210, (typeof player !== 'undefined' && player ? player.atk : 20) * 0.18);
                        return false;
                    }
                }
                if (p.life <= 0) {
                    triggerExplosion(p.x, p.y, p.radius || 70, p.dmg, false);
                    sEMPBlast();
                    addGasCloud(p.x, p.y, 65, 210, (typeof player !== 'undefined' && player ? player.atk : 20) * 0.18);
                    return false;
                }
                if (monsters) {
                    for (let i = 0; i < monsters.length; i++) {
                        const m = monsters[i];
                        if (m.hp > 0 && dist(p, m) < m.size + 8) {
                            triggerExplosion(p.x, p.y, p.radius || 70, p.dmg, false);
                            sEMPBlast();
                            addGasCloud(p.x, p.y, 65, 210, (typeof player !== 'undefined' && player ? player.atk : 20) * 0.18);
                            return false;
                        }
                    }
                }
                return p.life > 0;
            }

            if (p.kind === 'cluster_bomb') {
                p.dx *= 0.94;
                p.dy *= 0.94;
                if (p.life % 2 === 0) {
                    addParticle(p.x, p.y, '#ff4757', 1, 1, 8);
                }
                if (isWall(p.x, p.y) || p.life <= 0) {
                    triggerExplosion(p.x, p.y, p.radius || 46, p.dmg, false);
                    sClusterPop();
                    return false;
                }
                if (monsters) {
                    for (let i = 0; i < monsters.length; i++) {
                        const m = monsters[i];
                        if (m.hp > 0 && dist(p, m) < m.size + 8) {
                            triggerExplosion(p.x, p.y, p.radius || 46, p.dmg, false);
                            sClusterPop();
                            return false;
                        }
                    }
                }
                return p.life > 0;
            }

            if (p.kind === 'bazooka') {
                if (p.life % 2 === 0) {
                    addParticle(p.x - p.dx * 0.4, p.y - p.dy * 0.4, '#888', 1, 1, 14);
                }
                if (isWall(p.x, p.y)) {
                    triggerExplosion(p.x, p.y, p.radius || 95, p.dmg, true);
                    return false;
                }
                if (monsters) {
                    for (let i = 0; i < monsters.length; i++) {
                        const m = monsters[i];
                        if (m.hp > 0 && dist(p, m) < m.size + 10) {
                            triggerExplosion(p.x, p.y, p.radius || 95, p.dmg, true);
                            return false;
                        }
                    }
                }
                if (p.life <= 0) {
                    triggerExplosion(p.x, p.y, p.radius || 95, p.dmg, true);
                    return false;
                }
                return p.life > 0;
            }

            // Rifle: Railgun Line Piercing (menembus 2 target)
            if (p.kind === 'rifle') {
                if (isWall(p.x, p.y)) {
                    if (player && player.perkRicochet && (p.bouncesLeft == null || p.bouncesLeft > 0)) {
                        p.bouncesLeft = (p.bouncesLeft != null ? p.bouncesLeft : player.perkRicochet * 2) - 1;
                        if (isWall(p.x - p.dx, p.y)) p.dy = -p.dy;
                        else p.dx = -p.dx;
                        sRicochet();
                        addParticle(p.x, p.y, '#00e5ff', 6, 3, 10);
                        return p.life > 0;
                    }
                    addParticle(p.x, p.y, '#00f0ff', 6, 3, 10);
                    return false;
                }
                if (monsters) {
                    p.hitMonsters = p.hitMonsters || [];
                    for (let i = 0; i < monsters.length; i++) {
                        const m = monsters[i];
                        if (m.hp > 0 && !p.hitMonsters.includes(m) && dist(p, m) < m.size + (p.hitRadius || 7)) {
                            p.hitMonsters.push(m);
                            p.pierce = (p.pierce != null ? p.pierce : 2) - 1;
                            attackMonster(m, p.dmg);
                            sPiercingRifle();
                            addShake(2);
                            addParticle(p.x, p.y, '#00f0ff', 8, 4, 14);
                            addParticle(p.x, p.y, '#ffffff', 5, 3, 10);
                            p.dmg *= 0.82;
                            if (p.pierce <= 0) return false;
                        }
                    }
                }
                return p.life > 0;
            }

            // Minigun
            if (isWall(p.x, p.y)) {
                if (player && player.perkRicochet && (p.bouncesLeft == null || p.bouncesLeft > 0)) {
                    p.bouncesLeft = (p.bouncesLeft != null ? p.bouncesLeft : player.perkRicochet) - 1;
                    if (isWall(p.x - p.dx, p.y)) p.dy = -p.dy;
                    else p.dx = -p.dx;
                    sRicochet();
                    addParticle(p.x, p.y, '#ffeaa7', 4, 2, 8);
                    return p.life > 0;
                }
                addParticle(p.x, p.y, p.color || '#ffeaa7', 4, 3, 8);
                return false;
            }
            if (monsters) {
                for (let i = 0; i < monsters.length; i++) {
                    const m = monsters[i];
                    if (m.hp > 0 && dist(p, m) < m.size + (p.hitRadius || 6)) {
                        attackMonster(m, p.dmg);
                        addParticle(p.x, p.y, p.color || '#fff', 5, 3, 10);
                        return false;
                    }
                }
            }
            return p.life > 0;
        }

        // Monster projectile logic
        if (isWall(p.x, p.y)) {
            addParticle(p.x, p.y, p.color, 5, 3, 10);
            return false;
        }

        // Check if player's kinetic shield absorbs the monster bullet
        if (player.shieldTimer > 0 && dist(p, player) < player.size + 24) {
            addParticle(p.x, p.y, '#00f0ff', 7, 3, 16);
            sShieldDeflect();
            return false;
        }

        if (dist(p, player) < player.size + 5) {
            if (typeof godmode !== 'undefined' && godmode) return false;
            if (player.invincible <= 0) {
                let pDmg = p.dmg;
                if (player && player.perkNano) {
                    pDmg *= Math.max(0.5, 1 - player.perkNano * 0.25);
                }
                player.hp -= pDmg;
                player.invincible = 20;
                sHurt();
                addParticle(player.x, player.y, '#e74c3c', 8, 3, 15);
                if (player.hp <= 0) {
                    handlePlayerDeath('Projectile');
                }
                updateUI();
            }
            return false;
        }

        return p.life > 0;
    });
}

function updateThermalTrails() {
    if (!thermalTrails.length) return;
    thermalTrails = thermalTrails.filter(t => {
        t.life--;
        if (t.life % 6 === 0) {
            addParticle(t.x + (Math.random() - 0.5) * 10, t.y + (Math.random() - 0.5) * 10, '#ff5722', 1, 1.2, 12);
        }
        if (monsters) {
            for (let i = 0; i < monsters.length; i++) {
                const m = monsters[i];
                if (m.hp > 0 && dist(m, t) < 18) {
                    m.hitFlash = 6;
                    m.hp -= t.dmg * 0.15;
                    if (m.hp <= 0) attackMonster(m, 1);
                }
            }
        }
        return t.life > 0;
    });
}

function updateParticles() {
    const maxP = getMaxParticles();
    let writeIdx = 0;
    const isLagging = typeof perfFps !== 'undefined' && perfFps < 42;
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= (p.drag !== undefined ? p.drag : 0.95);
        p.vy *= (p.drag !== undefined ? p.drag : 0.95);
        if (p.rot !== undefined && p.rotSpd !== undefined) p.rot += p.rotSpd;
        p.life--;
        if (p.deathTimer !== undefined) p.deathTimer--;
        // If system is dropping frames or active count is above budget, decay particles faster
        if (isLagging && (particles.length > maxP || (i % 2 === 0))) {
            p.life--;
        }
        if (p.life > 0 && writeIdx < maxP) {
            particles[writeIdx++] = p;
        }
    }
    particles.length = writeIdx;
}

function drawMaze() {
    const isLight = currentLevel % 2 === 1;
    const zoom = getGameZoom();
    const halfW = (W / 2) / zoom;
    const halfH = (H / 2) / zoom;

    const startX = Math.max(0, Math.floor((cameraX - halfW) / CELL) - 2);
    const startY = Math.max(0, Math.floor((cameraY - halfH) / CELL) - 2);
    const endX = Math.min(mazeW, Math.ceil((cameraX + halfW) / CELL) + 2);
    const endY = Math.min(mazeH, Math.ceil((cameraY + halfH) / CELL) + 2);

    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            if (!fogOfWar[y] || !fogOfWar[y][x]) continue;

            const sx = x * CELL - cameraX + W / 2;
            const sy = y * CELL - cameraY + H / 2;

            const pdist = Math.sqrt((x - player.x / CELL) ** 2 + (y - player.y / CELL) ** 2);
            let brightness = Math.max(0.2, 1 - pdist * 0.08);

            if (isLight) {
                brightness = Math.max(0.3, brightness * 1.3);
            }

            if (maze[y][x] === 1) {
                let wallColor;
if (isLight) {
                    const g = Math.floor(38 + brightness * 34);
                    wallColor = `rgb(${g + 8}, ${g}, ${g - 4})`;
                } else {
                    const g = Math.floor(30 + brightness * 50);
                    wallColor = `rgb(${g - 5}, ${g}, ${g + 15})`;
                }
                ctx.fillStyle = wallColor;
                ctx.fillRect(sx, sy, CELL, CELL);

                ctx.fillStyle = isLight ? `rgba(0,0,0,${0.2 * brightness})` : `rgba(0,0,20,${0.3 * brightness})`;
                ctx.fillRect(sx + 2, sy + 2, CELL - 2, CELL - 2);

                if (isLight) {
                    ctx.fillStyle = `rgba(255,140,120,${0.1 * brightness})`;
                    ctx.fillRect(sx, sy, CELL, 2);
                    ctx.fillRect(sx, sy, 2, CELL);
                }
            } else if (maze[y][x] === 0) {
                let floorColor;
if (isLight) {
                    const g = Math.floor(78 + brightness * 42);
                    floorColor = `rgb(${g + 12}, ${g}, ${g - 8})`;
                } else {
                    const g = Math.floor(20 + brightness * 30);
                    floorColor = `rgb(${g}, ${g}, ${g + 10})`;
                }
                ctx.fillStyle = floorColor;
                ctx.fillRect(sx, sy, CELL, CELL);

                if ((x + y) % 3 === 0) {
                    ctx.fillStyle = isLight ? `rgba(40,0,0,0.08)` : `rgba(35,0,25,0.12)`;
                    ctx.fillRect(sx + 8, sy + 8, 4, 4);
                }
            } else if (maze[y][x] === 2) {
                let floorColor;
if (isLight) {
                    floorColor = `rgba(150, 88, 70, ${brightness})`;
                } else {
                    floorColor = `rgba(42, 14, 42, ${brightness})`;
                }
                ctx.fillStyle = floorColor;
                ctx.fillRect(sx, sy, CELL, CELL);

                ctx.fillStyle = isLight ? `rgba(255,120,60,${0.3 * brightness})` : `rgba(255,60,60,${0.25 * brightness})`;
                ctx.beginPath();
                ctx.arc(sx + CELL/2, sy + CELL/2, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawPlayer() {
    if (!player) return;
    const sx = player.x - cameraX + W / 2;
    const sy = player.y - cameraY + H / 2;

    // Phase Dash After-Images (Holographic Cyan Ghosting Trail)
    if (player.afterimages && player.afterimages.length) {
        player.afterimages.forEach(ai => {
            const asx = ai.x - cameraX + W / 2;
            const asy = ai.y - cameraY + H / 2;
            ctx.save();
            ctx.translate(asx, asy);
            ctx.rotate(ai.facing || player.facing);
            ctx.globalAlpha = (ai.life / ai.maxLife) * 0.38;
            ctx.fillStyle = '#00f0ff';
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 10;
            // Ghostly BMPT tankette silhouette
            ctx.fillRect(-14, -11, 28, 22);
            ctx.restore();
        });
    }

    if (player.invincible > 0 && Math.floor(player.invincible / 3) % 2 === 0) return;

    ctx.save();
    ctx.translate(sx, sy);

    // Diegetic Holographic Dash Cooldown Ring under BMPT Chassis
    const dashMax = 45;
    const dashRatio = dashCooldown > 0 ? (dashCooldown / dashMax) : 0;
    ctx.beginPath();
    ctx.arc(0, 0, player.size + 6, -Math.PI / 2, -Math.PI / 2 + (1 - dashRatio) * Math.PI * 2);
    ctx.strokeStyle = dashCooldown <= 0 ? 'rgba(0, 240, 255, 0.75)' : 'rgba(255, 71, 87, 0.45)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const isMoving = (typeof keys !== 'undefined' && (keys['w'] || keys['s'] || keys['a'] || keys['d'] || keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'])) || (typeof touchMove !== 'undefined' && touchMove.active) || player.dashing;
    const isLowHp = player.hp < (player.maxHp * 0.3);
    const flashFlicker = (isLowHp && Math.random() < 0.22) ? (0.25 + Math.random() * 0.5) : 1.0;

    // ============================================================
    // 1. DUAL TACTICAL HEADLIGHTS (Lampu Sorot Senter Volumetrik)
    // ============================================================
    const flashLen = currentLevel % 2 === 1 ? 135 : 180;
    const flashSpread = 0.42;

    for (const side of [-1, 1]) {
        ctx.save();
        ctx.rotate(player.facing);
        const lgtY = side * 8.5; // Left & Right headlight emitters on front fenders
        const lgtX = 13;
        const fg = ctx.createRadialGradient(lgtX, lgtY, 4, lgtX + flashLen * 0.7, lgtY, flashLen);
        fg.addColorStop(0, `rgba(255, 245, 205, ${0.55 * flashFlicker})`);
        fg.addColorStop(0.35, `rgba(255, 215, 140, ${0.25 * flashFlicker})`);
        fg.addColorStop(0.75, `rgba(255, 180, 80, ${0.08 * flashFlicker})`);
        fg.addColorStop(1, 'rgba(255, 150, 50, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(lgtX, lgtY);
        ctx.arc(lgtX, lgtY, flashLen, -flashSpread * 0.8, flashSpread * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // ============================================================
    // 2. BMPT TANKETTE CHASSIS (ROBOT TRACK & WHEEL SYSTEM)
    // ============================================================
    // Rotate entire robot body to player facing direction
    ctx.save();
    ctx.rotate(player.facing);

    // Track ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(-16, -13, 32, 26, 4);
    ctx.fill();

    // 2A. DUAL CATERPILLAR TRACKS & ROAD WHEELS (Track Kiri & Kanan)
    const trackWidth = 5.5;
    const trackLength = 29;
    const trackYOffset = 8.5;
    const scrollOffset = (playerFootstepDist * 0.85) % 6;

    for (const side of [-1, 1]) {
        const ty = side * trackYOffset;
        const topY = ty - trackWidth / 2;

        // Track Rubber/Steel Outer Belt
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.roundRect(-trackLength / 2, topY, trackLength, trackWidth, 3);
        ctx.fill();
        ctx.strokeStyle = player.dashing ? '#00f0ff' : '#334155';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Animated Tread Cleats (Gigi Roda Track yang Berputar Saat Jalan)
        ctx.strokeStyle = player.dashing ? '#38bdf8' : '#64748b';
        ctx.lineWidth = 1.2;
        const numCleats = 5;
        for (let c = 0; c < numCleats; c++) {
            const cleatX = -trackLength / 2 + 3 + ((c * 5.5 + scrollOffset) % (trackLength - 6));
            ctx.beginPath();
            ctx.moveTo(cleatX, topY);
            ctx.lineTo(cleatX, topY + trackWidth);
            ctx.stroke();
        }

        // Road Wheels (4 Roda Suspensi di dalam Track)
        for (let w = -1; w <= 2; w++) {
            const wx = -10 + (w + 1) * 6.5;
            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            ctx.arc(wx, ty, 2.2, 0, Math.PI * 2);
            ctx.fill();
            // Wheel neon hub center
            ctx.fillStyle = player.dashing ? '#00f0ff' : '#475569';
            ctx.beginPath();
            ctx.arc(wx, ty, 1.0, 0, Math.PI * 2);
            ctx.fill();
        }

        // Front Idler & Rear Sprocket Wheel Guards
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(trackLength / 2 - 2, topY, 2.5, trackWidth);
        ctx.fillRect(-trackLength / 2, topY, 2.5, trackWidth);
    }

    // 2B. SLOPED ARMORED HULL / MAIN CHASSIS (Bodi Baja BMPT Robot)
    const hullColor = player.dashing ? '#0f172a' : (isLowHp ? '#2a1215' : '#1e293b');
    const plateColor = player.dashing ? '#1e293b' : (isLowHp ? '#3b1c20' : '#334155');
    const armorAccent = player.dashing ? '#00f0ff' : (isLowHp ? '#ef4444' : '#38bdf8');

    // Lower Hull Bed
    ctx.fillStyle = hullColor;
    ctx.beginPath();
    ctx.roundRect(-12, -7.5, 24, 15, 2.5);
    ctx.fill();
    ctx.strokeStyle = armorAccent;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Front Glacis Sloped Armor Plate (Zirah Miring Depan Anti-Balistik)
    ctx.fillStyle = plateColor;
    ctx.beginPath();
    ctx.moveTo(3, -7);
    ctx.lineTo(13, -4.5);
    ctx.lineTo(13, 4.5);
    ctx.lineTo(3, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = armorAccent;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Tactical Hazard Stencils / Chevron on Glacis
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(8, -2.5);
    ctx.lineTo(11, 0);
    ctx.lineTo(8, 2.5);
    ctx.stroke();

    // Rear Engine Deck & Radiator Louvers
    ctx.fillStyle = '#090d16';
    ctx.fillRect(-11, -5.5, 5, 11);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 0.8;
    for (let r = -4; r <= 4; r += 2) {
        ctx.beginPath();
        ctx.moveTo(-11, r);
        ctx.lineTo(-7, r);
        ctx.stroke();
    }

    // Dual Rear Exhaust Nozzles & Thrust Flame
    for (const s of [-1, 1]) {
        const exY = s * 4.5;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-14, exY - 1.5, 2.5, 3);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-14, exY - 1.5, 2.5, 3);

        if (isMoving) {
            const flameLen = player.dashing ? (9 + Math.random() * 8) : (3 + Math.random() * 4);
            ctx.save();
            ctx.fillStyle = player.dashing ? 'rgba(0, 240, 255, 0.95)' : 'rgba(249, 115, 22, 0.85)';
            ctx.shadowColor = player.dashing ? '#00f0ff' : '#f97316';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(-14, exY - 1.2);
            ctx.lineTo(-14 - flameLen, exY);
            ctx.lineTo(-14, exY + 1.2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }

    // Headlight Lens Housing on Fenders (Lampu Fisik LED di Depan)
    for (const side of [-1, 1]) {
        const fy = side * 8.5;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(11, fy - 2, 2.5, 4);
        ctx.fillStyle = flashFlicker > 0.5 ? '#fffbeb' : '#64748b';
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 6;
        ctx.fillRect(12.5, fy - 1.5, 1.5, 3);
        ctx.shadowBlur = 0;
    }

    // Tactical Comms Antenna with Blinking LED Beacon on Rear Left
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, -6);
    ctx.lineTo(-12, -8.5);
    ctx.stroke();
    const beaconBlink = Math.sin(Date.now() / 200) > 0;
    ctx.fillStyle = beaconBlink ? '#22c55e' : '#14532d';
    ctx.beginPath();
    ctx.arc(-12, -8.5, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // ============================================================
    // 3. TOP TURRET & CYCLOPS OPTICAL SENSOR (Mata / Sensor Pintar)
    // ============================================================
    // Rotating Turret Ring
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, 7.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = armorAccent;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Cyclops Optical Targeting Sensor ("Mata Robot")
    const eyePulse = 0.5 + Math.sin(Date.now() / 150) * 0.5;
    ctx.fillStyle = isLowHp ? '#ef4444' : '#00f0ff';
    ctx.shadowColor = isLowHp ? '#ef4444' : '#00f0ff';
    ctx.shadowBlur = 8 + eyePulse * 4;
    ctx.beginPath();
    ctx.arc(3.2, 0, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Optical Lens Pupil
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(4.0, 0, 1.0, 0, Math.PI * 2);
    ctx.fill();

    // ============================================================
    // 4. TOP-MOUNTED DEPLOYABLE WEAPON PLATFORM (Senjata Muncul di Atas)
    // ============================================================
    const curW = player.currentWeapon || 'knife';
    const recoil = (player.attackAnim > 0) ? Math.min(4, player.attackAnim * 0.4) : 0;

    if (curW === 'knife') {
        // [MELEE] Hydraulic Deployable Arm with Thermal Rotary Saw
        ctx.fillStyle = '#475569';
        ctx.fillRect(-2, -1.8, 8 - recoil, 3.6); // Arm actuator
        // Rotary saw head
        const sawRot = Date.now() * 0.02;
        ctx.save();
        ctx.translate(9 - recoil, 0);
        ctx.rotate(sawRot);
        ctx.fillStyle = '#cbd5e1';
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const sa = (i / 6) * Math.PI * 2;
            const sx = Math.cos(sa) * 6;
            const sy = Math.sin(sa) * 6;
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
    } else if (curW === 'rifle') {
        // [RIFLE] Dual High-Velocity Autocannon Barrels (Twin Barrels)
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-3, -4.5, 6, 9); // Armored Mantlet
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(3 - recoil, -3.2, 14, 2.2); // Barrel 1
        ctx.fillRect(3 - recoil, 1.0, 14, 2.2);  // Barrel 2
        // Glowing cyan rail conduits
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(6 - recoil, -2.7, 9, 1.2);
        ctx.fillRect(6 - recoil, 1.5, 9, 1.2);
        // Muzzle brakes
        ctx.fillStyle = '#475569';
        ctx.fillRect(16 - recoil, -3.8, 2.5, 3.4);
        ctx.fillRect(16 - recoil, 0.4, 2.5, 3.4);
    } else if (curW === 'minigun') {
        // [MINIGUN] 6-Barrel Vulcan Rotary Gatling Turret
        const heatProg = Math.min(1, (player.minigunHeat || 0) / 100);
        const spinSpeed = (player.attackAnim > 0 || isMouseDown || keys[' ']) ? Date.now() * 0.04 : 0;
        const barrelColor = heatProg > 0.65 ? '#ef4444' : (heatProg > 0.35 ? '#f97316' : '#334155');

        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-2, -5, 7, 10); // Heavy rotor base
        // Ammo feed belt
        ctx.fillStyle = '#eab308';
        ctx.fillRect(-5, -6.5, 4, 3);

        // Rotating 6-barrel bundle
        ctx.fillStyle = barrelColor;
        ctx.fillRect(5 - recoil, -3.5, 13, 7);
        ctx.fillStyle = heatProg > 0.4 ? '#facc15' : '#0f172a';
        ctx.fillRect(17 - recoil, -4, 2.5, 8); // Muzzle clamp

        if (heatProg > 0.25) {
            ctx.save();
            ctx.shadowColor = '#ef4444';
            ctx.shadowBlur = Math.round(14 * heatProg);
            ctx.strokeStyle = `rgba(239, 68, 68, ${heatProg * 0.9})`;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(5 - recoil, -3.5, 13, 7);
            ctx.restore();
        }
    } else if (curW === 'bazooka') {
        // [BAZOOKA] Quad-Tube Rocket Pod Box on Turret Roof
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0 - recoil, -6, 13, 12);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.strokeRect(0 - recoil, -6, 13, 12);
        // 4 Open Tube Apertures
        ctx.fillStyle = '#090d16';
        for (const rx of [-3, 3]) {
            for (const ry of [-3, 3]) {
                ctx.beginPath();
                ctx.arc(13 - recoil, ry, 1.8, 0, Math.PI * 2);
                ctx.fill();
                // Red warhead tips inside
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(12.5 - recoil, ry, 0.9, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#090d16';
            }
        }
    } else if (curW === 'grenade') {
        // [GRENADE] Angled Bio-EMP Mortar Drum
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0 - recoil, -4, 9, 8);
        ctx.fillStyle = '#059669';
        ctx.fillRect(8 - recoil, -3, 6, 6);
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(14 - recoil, 0, 3, 0, Math.PI * 2);
        ctx.fill();
    } else if (curW === 'shield') {
        // [SHIELD] Folded Kinetic Emitter Dish
        ctx.fillStyle = '#00f0ff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(4, 0, 5, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    ctx.restore(); // Restore facing rotation

    // ============================================================
    // 5. KINETIC SHIELD DOME OVERLAY (If Shield Active)
    // ============================================================
    if (player.shieldTimer > 0) {
        const sProg = Math.min(1, player.shieldTimer / 150);
        const sRad = player.size + 18 + Math.sin(Date.now() * 0.01) * 2;
        ctx.save();
        ctx.strokeStyle = `rgba(0, 240, 255, ${0.4 + 0.5 * sProg})`;
        ctx.lineWidth = 2.4;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(0, 0, sRad, 0, Math.PI * 2);
        ctx.stroke();

        const sRot = Date.now() * 0.003;
        for (let i = 0; i < 6; i++) {
            const a = sRot + (i * Math.PI * 2 / 6);
            ctx.fillStyle = `rgba(0, 240, 255, ${0.18 * sProg})`;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * sRad, Math.sin(a) * sRad, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // ============================================================
    // 6. FIRING MUZZLE FLASHES & WEAPON IMPACT ANIMATION
    // ============================================================
    if (player.attackAnim > 0) {
        const prog = player.attackAnim / 15;
        if (curW === 'knife') {
            // High-frequency circular saw slash arc
            ctx.strokeStyle = `rgba(249, 115, 22, ${prog})`;
            ctx.lineWidth = 4.5;
            const range = 48 * prog;
            ctx.beginPath();
            ctx.arc(0, 0, range, player.facing - 0.9, player.facing + 0.9);
            ctx.stroke();
            ctx.strokeStyle = `rgba(255, 255, 255, ${prog})`;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.arc(0, 0, range * 0.85, player.facing - 0.75, player.facing + 0.75);
            ctx.stroke();
        } else if (curW === 'rifle' || curW === 'minigun') {
            // Muzzle flash at barrel tip
            const mx = Math.cos(player.facing) * (player.size + 16);
            const my = Math.sin(player.facing) * (player.size + 16);
            ctx.fillStyle = '#fef08a';
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(mx, my, 5 * prog + 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        } else if (curW === 'bazooka') {
            // Heavy Rocket Ignition Backblast
            const bx = -Math.cos(player.facing) * (player.size + 10);
            const by = -Math.sin(player.facing) * (player.size + 10);
            ctx.fillStyle = `rgba(249, 115, 22, ${prog * 0.8})`;
            ctx.beginPath();
            ctx.arc(bx, by, 9 * prog, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.restore();
}

// Pixel-art monster 1:1 dengan teaser homepage (maps & palet FOES di home.js).
// Kalau home.js tak termuat, kembali false agar aman.
function drawPixelFoe(key, px, t, ph, blink, flash) {
    if (typeof FOES === 'undefined' || !FOES[key]) return false;
    const foe = FOES[key];
    const frame = foe.frames[Math.floor(t * 2.2 + ph) % foe.frames.length];
    const rows = frame.length, cols = frame[0].length;
    const w = cols * px, h = rows * px;
    const ox = -w / 2, oy = -h / 2;
    const skip = blink ? (key === 'eye' ? 'P' : 'E') : null;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(ox + px, h / 2 - 1, w - px * 2, 2);
    for (let y = 0; y < rows; y++) {
        const row = frame[y];
        for (let x = 0; x < row.length; x++) {
            const ch = row[x];
            if (ch === '.' || ch === skip) continue;
            ctx.fillStyle = flash ? '#fff' : foe.pal[ch];
            ctx.fillRect(ox + x * px, oy + y * px, px, px);
        }
    }
    return true;
}

function drawMonsters() {
    const t = Date.now() / 1000;

    // === AKAR FILAMEN PANJANG HARVESTER & MOTHER HARVESTER MENYAMAR DI LANTAI LORONG ===
    monsters.forEach(m => {
        if (m.hp <= 0 || (!m.isHarvester && !m.isMotherHarvester && m.name !== 'Harvester' && m.name !== 'Mother Harvester') || !m.filaments || !m.filaments.length) return;
        ctx.save();
        const isMother = !!m.isMotherHarvester || m.name === 'Mother Harvester';
        m.filaments.forEach((pts, fIdx) => {
            if (pts.length < 2) return;
            ctx.beginPath();
            const startX = pts[0].x - cameraX + W / 2;
            const startY = pts[0].y - cameraY + H / 2;
            ctx.moveTo(startX, startY);
            for (let i = 1; i < pts.length; i++) {
                const px = pts[i].x - cameraX + W / 2;
                const py = pts[i].y - cameraY + H / 2;
                const sway = Math.sin(t * (isMother ? 2.6 : 2.2) + i * 0.75 + fIdx) * (isMother ? 1.6 : 1.2);
                ctx.lineTo(px + sway, py + sway);
            }
            // Garis filamen menyamar di permukaan lantai batu
            ctx.strokeStyle = m.hitFlash > 0 ? '#ffffff' : (isMother ? 'rgba(185, 20, 20, 0.78)' : 'rgba(155, 30, 30, 0.65)');
            ctx.lineWidth = isMother ? 3.2 : 2.2;
            ctx.stroke();

            // Jalur urat neurotoksin halus di dalam filamen
            ctx.strokeStyle = isMother ? 'rgba(255, 70, 70, 0.65)' : 'rgba(235, 65, 65, 0.45)';
            ctx.lineWidth = isMother ? 1.4 : 0.9;
            ctx.stroke();

            // Titik nodul sensoris pemicu jebakan di setiap simpul
            for (let i = 1; i < pts.length; i++) {
                const px = pts[i].x - cameraX + W / 2;
                const py = pts[i].y - cameraY + H / 2;
                ctx.fillStyle = isMother ? 'rgba(255, 40, 40, 0.95)' : 'rgba(255, 50, 50, 0.85)';
                ctx.beginPath();
                ctx.arc(px, py, isMother ? 2.8 : 2.0, 0, Math.PI * 2);
                ctx.fill();
            }
        });
        ctx.restore();
    });

    monsters.forEach(m => {
        if (m.hp <= 0) return;

        const sx = m.x - cameraX + W / 2;
        const sy = m.y - cameraY + H / 2;

        const margin = m.isBoss ? 500 : 80;
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) return;

        const pdist = Math.sqrt((m.x - player.x) ** 2 + (m.y - player.y) ** 2);
        const viewDist = (currentLevel === LEVELS - 1) ? 28 : (currentLevel % 2 === 0 ? 8 : 12);
        if (!m.isBoss && pdist > viewDist * CELL) return;

        const ph = m.x + m.y + m.name.length;
        const bob = Math.sin(t * 3 + ph) * 1.7;
        const blink = m.blink !== undefined && m.blink > 0 && m.blink < 7;
        const flashColor = getMonsterFlashColor(m);
        const bodyColor = m.hitFlash > 0 ? flashColor : m.color;
        const R = m.size;

        // Combat Attack Danger Telegraphing (Ground Indicators)
        if (m.isMonolith && m.slamTimer < 45) {
            ctx.save();
            const prog = 1 - (m.slamTimer / 45);
            ctx.strokeStyle = `rgba(255, 30, 60, ${0.4 + prog * 0.5})`;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.arc(sx, sy, 185 * prog, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        } else if (m.ranged && pdist < 180 && m.attackCooldown < 20) {
            ctx.save();
            const prog = 1 - (m.attackCooldown / 20);
            ctx.strokeStyle = `rgba(255, 50, 50, ${0.3 + prog * 0.4})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(player.x - cameraX + W / 2, player.y - cameraY + H / 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(sx, sy + bob);

        switch (m.name) {
            case 'Slime': {
                // Procedural Organic Acidic Amoeba
                const isFlash = m.hitFlash > 0;
                const wobble = Math.sin(t * 6 + ph) * 0.12;
                const coreR = R * (0.95 + wobble);

                // 1. Acid Puddle shadow on floor
                ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
                ctx.beginPath();
                ctx.ellipse(0, R * 0.45, R * 1.25, R * 0.45, 0, 0, Math.PI * 2);
                ctx.fill();

                // 2. Multi-point organic membrane
                ctx.save();
                ctx.shadowColor = isFlash ? '#fff' : '#10b981';
                ctx.shadowBlur = isFlash ? 15 : 8;
                ctx.fillStyle = isFlash ? '#ffffff' : 'rgba(16, 185, 129, 0.82)';
                ctx.beginPath();
                const points = 12;
                for (let i = 0; i < points; i++) {
                    const ang = (i / points) * Math.PI * 2;
                    const rDist = coreR + Math.sin(t * 8 + i * 1.5 + ph) * (R * 0.16);
                    const px = Math.cos(ang) * rDist;
                    const py = Math.sin(ang) * rDist;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                // 3. Inner Cellular Nucleus (Glowing Green/Yellow Core)
                if (!isFlash) {
                    ctx.fillStyle = '#34d399';
                    ctx.beginPath();
                    ctx.arc(Math.sin(t * 3 + ph) * 2, -1 + Math.cos(t * 3.5 + ph) * 2, R * 0.45, 0, Math.PI * 2);
                    ctx.fill();

                    // Acidic internal rising bubbles
                    ctx.fillStyle = '#a7f3d0';
                    for (let b = 0; b < 3; b++) {
                        const bAng = (t * 2 + b * 2.1 + ph);
                        const bx = Math.sin(bAng) * (R * 0.4);
                        const by = Math.cos(bAng * 1.3) * (R * 0.35);
                        ctx.beginPath();
                        ctx.arc(bx, by, 1.6, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Caustic specular highlight on dome
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
                    ctx.beginPath();
                    ctx.ellipse(-R * 0.3, -R * 0.35, R * 0.32, R * 0.16, -Math.PI / 4, 0, Math.PI * 2);
                    ctx.fill();
                }

                // 4. Tracking crimson micro-eyes inside gel
                const toP = Math.atan2(player.y - m.y, player.x - m.x);
                const eyeOffX = Math.cos(toP) * 1.5;
                const eyeOffY = Math.sin(toP) * 1.5;
                ctx.fillStyle = isFlash ? '#000' : '#ef4444';
                for (const side of [-1, 1]) {
                    ctx.beginPath();
                    ctx.arc(side * (R * 0.35) + eyeOffX, -R * 0.1 + eyeOffY, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                break;
            }
            case 'Bat': {
                // Procedural Chitinous Blood-Stalker Bat
                const isFlash = m.hitFlash > 0;
                const flapSpeed = 16;
                const wingFlap = Math.sin(t * flapSpeed + ph);
                const wingSpan = R * (1.6 + wingFlap * 0.35);
                const wingDrop = wingFlap * (R * 0.55);

                // 1. Soft aerial shadow
                ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                ctx.beginPath();
                ctx.ellipse(0, R * 1.2, R * 0.8, R * 0.25, 0, 0, Math.PI * 2);
                ctx.fill();

                // 2. Articulated Wings with Leathery Arc Membranes
                for (const side of [-1, 1]) {
                    ctx.fillStyle = isFlash ? '#ffffff' : (side === -1 ? '#1e1b4b' : '#312e81');
                    ctx.strokeStyle = isFlash ? '#ffffff' : '#4338ca';
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    const elbowX = side * (R * 0.85);
                    const elbowY = -R * 0.6 + wingDrop * 0.4;
                    const tipX = side * wingSpan;
                    const tipY = -R * 0.2 + wingDrop;
                    ctx.lineTo(elbowX, elbowY);
                    ctx.lineTo(tipX, tipY);
                    ctx.quadraticCurveTo(side * (wingSpan * 0.65), R * 0.4 + wingDrop * 0.5, side * (wingSpan * 0.4), R * 0.15);
                    ctx.quadraticCurveTo(side * (wingSpan * 0.2), R * 0.5, 0, R * 0.3);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();

                    // Wing bone struts
                    ctx.beginPath();
                    ctx.moveTo(elbowX, elbowY);
                    ctx.lineTo(side * (wingSpan * 0.65), R * 0.4 + wingDrop * 0.5);
                    ctx.stroke();
                }

                // 3. Central Fur Body & Ear Tufts
                ctx.fillStyle = isFlash ? '#ffffff' : '#1e1b4b';
                ctx.beginPath();
                ctx.ellipse(0, 0, R * 0.42, R * 0.62, 0, 0, Math.PI * 2);
                ctx.fill();

                // Pointy bat ears
                for (const side of [-1, 1]) {
                    ctx.beginPath();
                    ctx.moveTo(side * (R * 0.15), -R * 0.5);
                    ctx.lineTo(side * (R * 0.38), -R * 1.15);
                    ctx.lineTo(side * (R * 0.42), -R * 0.35);
                    ctx.closePath();
                    ctx.fill();
                    ctx.strokeStyle = '#6366f1';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }

                // 4. Piercing Ruby Tracking Eyes
                const toP = Math.atan2(player.y - m.y, player.x - m.x);
                const eyeX = Math.cos(toP) * 1.2;
                const eyeY = Math.sin(toP) * 1.2;
                ctx.fillStyle = isFlash ? '#000000' : '#ef4444';
                ctx.shadowColor = '#ef4444';
                ctx.shadowBlur = 6;
                ctx.beginPath();
                ctx.arc(-R * 0.18 + eyeX, -R * 0.15 + eyeY, 1.8, 0, Math.PI * 2);
                ctx.arc(R * 0.18 + eyeX, -R * 0.15 + eyeY, 1.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;

                // Sharp fangs
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(-2, R * 0.2); ctx.lineTo(-1, R * 0.4); ctx.lineTo(0, R * 0.2);
                ctx.moveTo(0, R * 0.2); ctx.lineTo(1, R * 0.4); ctx.lineTo(2, R * 0.2);
                ctx.fill();
                break;
            }
            case 'Crawl': {
                // Vita Carnis Creeping Flesh Mass
                const wriggle = Math.sin(t * 10 + ph) * 0.15;
                ctx.fillStyle = bodyColor;
                ctx.beginPath();
                ctx.ellipse(0, R * 0.2, R * (1.1 + wriggle), R * 0.6, 0, 0, Math.PI * 2);
                ctx.fill();

                // Creeping leg tendrils
                ctx.strokeStyle = '#4a0808';
                ctx.lineWidth = 2;
                for (let leg = -3; leg <= 3; leg++) {
                    if (leg === 0) continue;
                    const legPhase = t * 12 + leg * 1.2 + ph;
                    const lx = (leg / 3) * R * 0.8;
                    const ly = R * 0.4 + Math.sin(legPhase) * 3;
                    ctx.beginPath();
                    ctx.moveTo(lx, R * 0.2);
                    ctx.lineTo(lx + (leg > 0 ? 5 : -5), ly + 4);
                    ctx.stroke();
                }

                // Eye-tracking glowing crimson pupils
                const toPlayer = Math.atan2(player.y - m.y, player.x - m.x);
                const ex = Math.cos(toPlayer) * 0.9;
                const ey = Math.sin(toPlayer) * 0.9;
                ctx.fillStyle = '#ff2222';
                for (let eye = -2; eye <= 2; eye += 2) {
                    ctx.beginPath();
                    ctx.arc(eye * 3 + ex, -1 + ey, 1.8, 0, Math.PI * 2);
                    ctx.fill();
                }
                break;
            }
            case 'Ghost': {
                // Procedural Misty Spectral Apparition
                const isFlash = m.hitFlash > 0;
                const pulse = Math.sin(t * 3 + ph) * 0.08;
                ctx.save();
                ctx.globalAlpha = (m.isPhasing > 0 ? 0.35 : 0.72) + Math.sin(t * 4 + ph) * 0.12;

                // 1. Spectral cyan/violet shadow glow
                ctx.shadowColor = isFlash ? '#fff' : '#06b6d4';
                ctx.shadowBlur = 14;

                // 2. Trailing Ectoplasm Wisps Body
                ctx.fillStyle = isFlash ? '#ffffff' : 'rgba(147, 197, 253, 0.85)';
                ctx.beginPath();
                ctx.arc(0, -R * 0.2, R * (0.85 + pulse), Math.PI, 0);
                // Undulating flowing tail
                const tailY = R * 1.05;
                ctx.lineTo(R * 0.85, tailY);
                for (let i = 5; i >= -5; i--) {
                    const tx = (i / 5) * (R * 0.85);
                    const sway = Math.sin(t * 7 + i * 0.85 + ph) * (R * 0.25);
                    ctx.lineTo(tx, tailY + sway + (i % 2 === 0 ? 4 : -2));
                }
                ctx.closePath();
                ctx.fill();
                ctx.shadowBlur = 0;

                // 3. Inner misty core
                ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
                ctx.beginPath();
                ctx.arc(0, -R * 0.2, R * 0.5, 0, Math.PI * 2);
                ctx.fill();

                // 4. Hollow Void Eyes with Floating Ectoplasmic Pupils
                ctx.fillStyle = '#0f172a';
                ctx.beginPath();
                ctx.ellipse(-R * 0.32, -R * 0.25, 2.5, 4, 0, 0, Math.PI * 2);
                ctx.ellipse(R * 0.32, -R * 0.25, 2.5, 4, 0, 0, Math.PI * 2);
                ctx.fill();

                if (!blink) {
                    const toP = Math.atan2(player.y - m.y, player.x - m.x);
                    ctx.fillStyle = '#22d3ee';
                    ctx.shadowColor = '#00f0ff';
                    ctx.shadowBlur = 8;
                    ctx.beginPath();
                    ctx.arc(-R * 0.32 + Math.cos(toP) * 1.2, -R * 0.25 + Math.sin(toP) * 1.2, 1.4, 0, Math.PI * 2);
                    ctx.arc(R * 0.32 + Math.cos(toP) * 1.2, -R * 0.25 + Math.sin(toP) * 1.2, 1.4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
                ctx.restore();
                break;
            }
            case 'Harvester': {
                // === VITA CARNIS - HARVESTER (CONGREGENTUR CARNIS) ===
                // Kubah daging nodular menyerupai buah raspberry merah dengan tentakel sensoris lateral berduri dan akar serabut di tanah
                const pulse = 1 + Math.sin(t * 2.5 + ph) * 0.04;
                const isFlash = m.hitFlash > 0;

                // 1. Akar Serabut Bawah Menembus Tanah (Fibrous Subterranean Roots)
                ctx.strokeStyle = isFlash ? '#ffffff' : '#3b0606';
                ctx.lineWidth = 2.0;
                for (let rIdx = -3; rIdx <= 3; rIdx++) {
                    const rx = rIdx * (R * 0.22);
                    ctx.beginPath();
                    ctx.moveTo(rx * 0.7, R * 0.35);
                    ctx.quadraticCurveTo(rx * 1.1, R * 0.7, rx * 1.4, R * 1.15);
                    ctx.stroke();
                }

                // 2. Tentakel Sensoris Lateral Melengkung Berduri (Lateral Curved Thorny Tendrils)
                // Berada di sisi kiri dan kanan pangkal kubah seperti pada diagram spesimen
                const tentacleAngles = [-1, 1];
                tentacleAngles.forEach(side => {
                    const tPhase = t * 2.2 + side * 1.5 + ph;
                    const sway = Math.sin(tPhase) * 2.5;
                    const baseX = side * (R * 0.55);
                    const baseY = R * 0.25;
                    const midX = side * (R * 1.35) + sway;
                    const midY = R * 0.35;
                    const tipX = side * (R * 1.65) + sway * 1.2;
                    const tipY = R * 0.05;

                    ctx.strokeStyle = isFlash ? '#ffffff' : '#5c0b0b';
                    ctx.lineWidth = 3.2;
                    ctx.beginPath();
                    ctx.moveTo(baseX, baseY);
                    ctx.quadraticCurveTo(midX, midY, tipX, tipY);
                    ctx.stroke();

                    // Duri-duri sensoris di sepanjang tentakel samping
                    ctx.fillStyle = isFlash ? '#ffffff' : '#8a1616';
                    for (let th = 1; th <= 4; th++) {
                        const prog = th / 5;
                        const tx = baseX + (midX - baseX) * prog;
                        const ty = baseY + (midY - baseY) * prog;
                        ctx.beginPath();
                        ctx.arc(tx, ty - 2.5, 1.8, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });

                // 3. Pangkal Dudukan Kubah (Base Mound)
                ctx.fillStyle = isFlash ? '#ffffff' : '#4d0909';
                ctx.beginPath();
                ctx.ellipse(0, R * 0.3, R * 0.85 * pulse, R * 0.3, 0, 0, Math.PI * 2);
                ctx.fill();

                // 4. Kubah Daging Globular Mirip Buah Raspberry (Raspberry Flesh Lobes / Nodules)
                // Kumpulan nodul daging bulat bertekstur yang membentuk siluet khas Harvester
                const lobes = [
                    // Lapisan Bawah (Paling Lebar)
                    { x: -R * 0.62, y: R * 0.05, r: R * 0.34 },
                    { x: -R * 0.24, y: R * 0.12, r: R * 0.38 },
                    { x:  R * 0.24, y: R * 0.12, r: R * 0.38 },
                    { x:  R * 0.62, y: R * 0.05, r: R * 0.34 },

                    // Lapisan Menengah
                    { x: -R * 0.50, y: -R * 0.28, r: R * 0.35 },
                    { x: -R * 0.16, y: -R * 0.22, r: R * 0.38 },
                    { x:  R * 0.16, y: -R * 0.22, r: R * 0.38 },
                    { x:  R * 0.50, y: -R * 0.28, r: R * 0.35 },

                    // Lapisan Atas
                    { x: -R * 0.32, y: -R * 0.60, r: R * 0.34 },
                    { x:  0,        y: -R * 0.56, r: R * 0.36 },
                    { x:  R * 0.32, y: -R * 0.60, r: R * 0.34 },

                    // Kubah Puncak
                    { x: 0,         y: -R * 0.88, r: R * 0.30 }
                ];

                // Gambar bayangan / alur sambungan antar nodul
                ctx.fillStyle = isFlash ? '#ffffff' : '#330505';
                ctx.beginPath();
                ctx.ellipse(0, -R * 0.35, R * 0.85 * pulse, R * 0.85 * pulse, 0, 0, Math.PI * 2);
                ctx.fill();

                // Gambar masing-masing nodul berdaging dengan gradasi cembung
                lobes.forEach((lb, idx) => {
                    const lX = lb.x * pulse;
                    const lY = lb.y * pulse;
                    const lR = lb.r * pulse;

                    // Lingkar dasar nodul daging
                    ctx.fillStyle = isFlash ? '#ffffff' : ((idx % 2 === 0) ? '#781010' : '#8a1616');
                    ctx.beginPath();
                    ctx.arc(lX, lY, lR, 0, Math.PI * 2);
                    ctx.fill();

                    // Cembungan highlight kemerahan di atas nodul
                    if (!isFlash) {
                        ctx.fillStyle = '#b32424';
                        ctx.beginPath();
                        ctx.arc(lX - lR * 0.2, lY - lR * 0.25, lR * 0.55, 0, Math.PI * 2);
                        ctx.fill();

                        // Sorot cahaya halus di puncak nodul
                        ctx.fillStyle = 'rgba(255, 180, 180, 0.35)';
                        ctx.beginPath();
                        ctx.arc(lX - lR * 0.25, lY - lR * 0.3, lR * 0.25, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Pori sensoris kecil di beberapa nodul
                    if (idx === 11 || idx === 1 || idx === 2) {
                        ctx.fillStyle = '#220000';
                        ctx.beginPath();
                        ctx.arc(lX, lY, 1.8, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });

                break;
            }
            case 'Mother Harvester': {
                // === VITA CARNIS - MOTHER HARVESTER (APEX CONGREGENTUR CARNIS) ===
                // Kubah daging kolosal berkarpet biomassa lantai dengan nodul ganda, urat darah menyala, dan dua pasang tentakel berduri
                const pulse = 1 + Math.sin(t * 2.8 + ph) * 0.05;
                const isFlash = m.hitFlash > 0;

                // 1. Karpet Daging Berlendir di Lantai (Sprawling Bio-Creep Ground Carpet)
                ctx.fillStyle = isFlash ? '#ffffff' : 'rgba(70, 8, 8, 0.72)';
                ctx.beginPath();
                ctx.ellipse(0, R * 0.42, R * 1.55 * pulse, R * 0.72 * pulse, 0, 0, Math.PI * 2);
                ctx.fill();

                // Urat darah bercabang di karpet lantai
                ctx.strokeStyle = isFlash ? '#ffffff' : '#ab1515';
                ctx.lineWidth = 2.2;
                for (let v = 0; v < 6; v++) {
                    const va = (v / 6) * Math.PI * 2 + t * 0.2;
                    const vDist = R * 1.35;
                    ctx.beginPath();
                    ctx.moveTo(0, R * 0.35);
                    ctx.quadraticCurveTo(
                        Math.cos(va + 0.4) * (vDist * 0.5),
                        R * 0.4 + Math.sin(va + 0.4) * (vDist * 0.3),
                        Math.cos(va) * vDist,
                        R * 0.4 + Math.sin(va) * (vDist * 0.45)
                    );
                    ctx.stroke();
                }

                // 2. Akar Serabut Subterranean Tebal (9 Akar Penopang)
                ctx.strokeStyle = isFlash ? '#ffffff' : '#330404';
                ctx.lineWidth = 3.0;
                for (let rIdx = -4; rIdx <= 4; rIdx++) {
                    const rx = rIdx * (R * 0.2);
                    ctx.beginPath();
                    ctx.moveTo(rx * 0.6, R * 0.3);
                    ctx.quadraticCurveTo(rx * 1.15, R * 0.75, rx * 1.5, R * 1.25);
                    ctx.stroke();
                }

                // 3. Dua Pasang Tentakel Sensoris Melengkung Berduri Ganda (Bawah & Atas)
                [-1, 1].forEach(side => {
                    // Pasang 1: Tentakel Bawah Melengkung Panjang
                    const tPhase1 = t * 2.4 + side * 1.2 + ph;
                    const sway1 = Math.sin(tPhase1) * 3.5;
                    const bX1 = side * (R * 0.6);
                    const bY1 = R * 0.25;
                    const mX1 = side * (R * 1.45) + sway1;
                    const mY1 = R * 0.38;
                    const tX1 = side * (R * 1.85) + sway1 * 1.2;
                    const tY1 = R * 0.08;

                    ctx.strokeStyle = isFlash ? '#ffffff' : '#4d0808';
                    ctx.lineWidth = 4.0;
                    ctx.beginPath();
                    ctx.moveTo(bX1, bY1);
                    ctx.quadraticCurveTo(mX1, mY1, tX1, tY1);
                    ctx.stroke();

                    // Duri-duri tajam tentakel bawah
                    ctx.fillStyle = isFlash ? '#ffffff' : '#941414';
                    for (let th = 1; th <= 5; th++) {
                        const prog = th / 6;
                        const tx = bX1 + (mX1 - bX1) * prog;
                        const ty = bY1 + (mY1 - bY1) * prog;
                        ctx.beginPath();
                        ctx.arc(tx, ty - 3, 2.2, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Pasang 2: Tentakel Atas Melengkung Mencakar
                    const tPhase2 = t * 2.8 - side * 1.5 + ph;
                    const sway2 = Math.cos(tPhase2) * 3.0;
                    const bX2 = side * (R * 0.45);
                    const bY2 = -R * 0.15;
                    const mX2 = side * (R * 1.3) + sway2;
                    const mY2 = -R * 0.32;
                    const tX2 = side * (R * 1.6) + sway2 * 1.3;
                    const tY2 = -R * 0.55;

                    ctx.strokeStyle = isFlash ? '#ffffff' : '#5c0b0b';
                    ctx.lineWidth = 3.2;
                    ctx.beginPath();
                    ctx.moveTo(bX2, bY2);
                    ctx.quadraticCurveTo(mX2, mY2, tX2, tY2);
                    ctx.stroke();

                    // Duri tentakel atas
                    ctx.fillStyle = isFlash ? '#ffffff' : '#b81a1a';
                    for (let th = 1; th <= 4; th++) {
                        const prog = th / 5;
                        const tx = bX2 + (mX2 - bX2) * prog;
                        const ty = bY2 + (mY2 - bY2) * prog;
                        ctx.beginPath();
                        ctx.arc(tx, ty - 2.5, 2.0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });

                // 4. Dudukan Pangkal Kubah Masif
                ctx.fillStyle = isFlash ? '#ffffff' : '#450606';
                ctx.beginPath();
                ctx.ellipse(0, R * 0.32, R * 0.95 * pulse, R * 0.32, 0, 0, Math.PI * 2);
                ctx.fill();

                // 5. Kubah Daging Globular Raspberry Kolosal (Tersusun dari belasan nodul)
                const motherLobes = [
                    // Lapisan 1: Dasar Terbawah (5 Nodul Masif)
                    { x: -R * 0.72, y: R * 0.08,  r: R * 0.36 },
                    { x: -R * 0.36, y: R * 0.16,  r: R * 0.40 },
                    { x:  0,        y: R * 0.18,  r: R * 0.42 },
                    { x:  R * 0.36, y: R * 0.16,  r: R * 0.40 },
                    { x:  R * 0.72, y: R * 0.08,  r: R * 0.36 },

                    // Lapisan 2: Tengah Bawah (4 Nodul)
                    { x: -R * 0.55, y: -R * 0.25, r: R * 0.37 },
                    { x: -R * 0.18, y: -R * 0.20, r: R * 0.40 },
                    { x:  R * 0.18, y: -R * 0.20, r: R * 0.40 },
                    { x:  R * 0.55, y: -R * 0.25, r: R * 0.37 },

                    // Lapisan 3: Tengah Atas (4 Nodul)
                    { x: -R * 0.40, y: -R * 0.55, r: R * 0.35 },
                    { x: -R * 0.14, y: -R * 0.52, r: R * 0.38 },
                    { x:  R * 0.14, y: -R * 0.52, r: R * 0.38 },
                    { x:  R * 0.40, y: -R * 0.55, r: R * 0.35 },

                    // Lapisan 4: Mahkota Puncak (3 Nodul + Corong Spora)
                    { x: -R * 0.22, y: -R * 0.82, r: R * 0.32 },
                    { x:  R * 0.22, y: -R * 0.82, r: R * 0.32 },
                    { x:  0,        y: -R * 0.96, r: R * 0.35 }
                ];

                // Bayangan dasar kubah
                ctx.fillStyle = isFlash ? '#ffffff' : '#260303';
                ctx.beginPath();
                ctx.ellipse(0, -R * 0.35, R * 0.95 * pulse, R * 0.95 * pulse, 0, 0, Math.PI * 2);
                ctx.fill();

                // Gambar masing-masing nodul daging berdaging tebal
                motherLobes.forEach((lb, idx) => {
                    const lX = lb.x * pulse;
                    const lY = lb.y * pulse;
                    const lR = lb.r * pulse;

                    ctx.fillStyle = isFlash ? '#ffffff' : ((idx % 2 === 0) ? '#690a0a' : '#7d0f0f');
                    ctx.beginPath();
                    ctx.arc(lX, lY, lR, 0, Math.PI * 2);
                    ctx.fill();

                    if (!isFlash) {
                        // Highlight cembungan daging basah
                        ctx.fillStyle = '#a61717';
                        ctx.beginPath();
                        ctx.arc(lX - lR * 0.22, lY - lR * 0.26, lR * 0.55, 0, Math.PI * 2);
                        ctx.fill();

                        // Sorot kilau licin
                        ctx.fillStyle = 'rgba(255, 190, 190, 0.38)';
                        ctx.beginPath();
                        ctx.arc(lX - lR * 0.26, lY - lR * 0.32, lR * 0.24, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });

                // Corong Lubang Spora Induk di Puncak
                const ventY = -R * 1.05 * pulse;
                ctx.fillStyle = '#140000';
                ctx.beginPath();
                ctx.ellipse(0, ventY, R * 0.22 * pulse, R * 0.12 * pulse, 0, 0, Math.PI * 2);
                ctx.fill();

                // Lingkar bibir pori spora merah berdenyut
                ctx.strokeStyle = '#ff3333';
                ctx.lineWidth = 1.6;
                ctx.stroke();

                break;
            }
            case 'Dark Knight': {
                // Procedural Heavy Dreadnought Knight
                const isFlash = m.hitFlash > 0;
                const shieldAngle = Math.sin(t * 3 + ph) * 0.1;

                // 1. Heavy Plate Torso & Crest
                ctx.fillStyle = isFlash ? '#ffffff' : '#0f172a';
                ctx.beginPath();
                ctx.arc(0, 0, R * 0.85, 0, Math.PI * 2);
                ctx.fill();

                // Armored Pauldrons
                for (const side of [-1, 1]) {
                    ctx.fillStyle = isFlash ? '#ffffff' : '#1e293b';
                    ctx.strokeStyle = isFlash ? '#fff' : '#64748b';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(side * (R * 0.75), -R * 0.2, R * 0.38, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }

                // Great Helm with T-Shaped Visor
                ctx.fillStyle = isFlash ? '#ffffff' : '#334155';
                ctx.beginPath();
                ctx.ellipse(0, -R * 0.3, R * 0.46, R * 0.42, 0, 0, Math.PI * 2);
                ctx.fill();

                // Crimson Visor Slit
                const toP = Math.atan2(player.y - m.y, player.x - m.x);
                const eyeX = Math.cos(toP) * 1.2;
                ctx.fillStyle = '#ef4444';
                ctx.shadowColor = '#ef4444';
                ctx.shadowBlur = 8;
                ctx.fillRect(-R * 0.3 + eyeX, -R * 0.35, R * 0.6, 2.2);
                ctx.shadowBlur = 0;

                // 2. Tower Shield (Front Left)
                ctx.save();
                ctx.translate(-R * 0.65, R * 0.1);
                ctx.rotate(shieldAngle);
                ctx.fillStyle = isFlash ? '#ffffff' : '#1e293b';
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(-4, -R * 0.7);
                ctx.lineTo(8, -R * 0.7);
                ctx.lineTo(6, R * 0.7);
                ctx.lineTo(-2, R * 0.85);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();

                // 3. Obsidian Blade (Right Hand)
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                ctx.moveTo(R * 0.55, R * 0.2);
                ctx.lineTo(R * 1.35, -R * 0.7);
                ctx.stroke();
                break;
            }
            case 'Dragon': {
                // Procedural Obsidian-Scale Fire Drake
                const isFlash = m.hitFlash > 0;
                const flap = Math.sin(t * 11 + ph);
                const spread = R * 1.5 + flap * 6;

                // 1. Bat-Drake Wings with Obsidian Bone Struts & Scallop Membranes
                for (const s of [-1, 1]) {
                    ctx.fillStyle = isFlash ? '#ffffff' : (s === -1 ? '#7f1d1d' : '#991b1b');
                    ctx.strokeStyle = isFlash ? '#ffffff' : '#b91c1c';
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    const elbowX = s * spread * 0.75;
                    const elbowY = -spread * 0.65;
                    const tipX = s * spread;
                    const tipY = -spread * 0.35 + flap * 4;
                    ctx.lineTo(elbowX, elbowY);
                    ctx.lineTo(tipX, tipY);
                    ctx.quadraticCurveTo(s * spread * 0.65, spread * 0.2, s * spread * 0.35, spread * 0.1);
                    ctx.quadraticCurveTo(s * spread * 0.15, spread * 0.35, 0, R * 0.3);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();

                    // Wing Ribs
                    ctx.beginPath();
                    ctx.moveTo(elbowX, elbowY);
                    ctx.lineTo(s * spread * 0.65, spread * 0.2);
                    ctx.stroke();
                }

                // 2. Obsidian Armored Torso with Magma Fissures
                ctx.fillStyle = isFlash ? '#ffffff' : '#1c1917';
                ctx.beginPath();
                ctx.ellipse(0, 0, R * 0.75, R * 0.9, 0, 0, Math.PI * 2);
                ctx.fill();

                // Magma cracks on body
                ctx.strokeStyle = '#f97316';
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(-R * 0.35, -R * 0.3);
                ctx.lineTo(0, 0);
                ctx.lineTo(R * 0.35, -R * 0.3);
                ctx.stroke();

                // 3. Horned Dragon Skull Facing Forward
                const headLen = R * 1.4;
                ctx.fillStyle = isFlash ? '#ffffff' : '#292524';
                ctx.beginPath();
                ctx.moveTo(R * 0.3, -R * 0.4);
                ctx.lineTo(headLen, -R * 0.1);
                ctx.lineTo(R * 0.3, R * 0.4);
                ctx.closePath();
                ctx.fill();

                // Swept-back Horns
                for (const side of [-1, 1]) {
                    ctx.strokeStyle = '#44403c';
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.moveTo(R * 0.2, side * (R * 0.3));
                    ctx.quadraticCurveTo(-R * 0.2, side * (R * 0.6), -R * 0.6, side * (R * 0.8));
                    ctx.stroke();
                }

                // 4. Molten Furnace Throat & Glowing Slit Eyes
                ctx.fillStyle = '#ffedd5';
                const eyeGlow = 6 + Math.sin(t * 8 + ph) * 4;
                ctx.shadowColor = '#f97316';
                ctx.shadowBlur = eyeGlow;
                ctx.beginPath();
                ctx.arc(R * 0.55, -R * 0.2, 2.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;

                // Burning Ember in Maw
                const emberPulse = 2 + Math.sin(t * 8 + ph) * 1.2;
                ctx.fillStyle = '#ea580c';
                ctx.shadowColor = '#ea580c';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(headLen * 0.9, -R * 0.05, emberPulse, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
                break;
            }
            case 'Lich': {
                ctx.fillStyle = bodyColor;
                ctx.beginPath();
                ctx.moveTo(-R, -R * 0.5);
                ctx.lineTo(R, -R * 0.5);
                ctx.lineTo(R, R * 0.9);
                ctx.lineTo(-R, R * 0.9);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#6c3483';
                ctx.beginPath();
                ctx.moveTo(-R * 0.9, -R * 0.5);
                ctx.lineTo(R * 0.9, -R * 0.5);
                ctx.lineTo(0, -R * 1.3);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#7dffb0';
                if (blink) {
                    ctx.fillRect(-5, -4, 3.5, 1.5);
                    ctx.fillRect(1.5, -4, 3.5, 1.5);
                } else {
                    const gl = 6 + Math.sin(t * 7 + ph) * 3;
                    ctx.shadowColor = '#7dffb0';
                    ctx.shadowBlur = gl;
                    ctx.beginPath(); ctx.arc(-3, -4, 2, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(3, -4, 2, 0, Math.PI * 2); ctx.fill();
                    ctx.shadowBlur = 0;
                }
                ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(R * 0.8, R * 0.5);
                ctx.lineTo(R * 0.8, -R * 0.7);
                ctx.stroke();
                ctx.fillStyle = '#7dffb0';
                const orbY = -R * 0.9 + Math.sin(t * 3 + ph) * 2;
                ctx.shadowColor = '#7dffb0';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(R * 0.8, orbY, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
                break;
            }
            case 'Beholder': {
                // Procedural Eldritch Cosmic Beholder with 6 Writhing Eyestalks
                const isFlash = m.hitFlash > 0;
                const orbR = R * 0.85;

                // 1. Cosmic Void Aura
                ctx.save();
                ctx.shadowColor = isFlash ? '#fff' : '#a855f7';
                ctx.shadowBlur = 18;

                // 2. 6 Independent Writhing Eyestalks (protruding in dynamic arcs)
                for (let s = 0; s < 6; s++) {
                    const stalkAngle = -Math.PI * 0.8 + (s / 5) * (Math.PI * 1.6);
                    const stalkPhase = t * 4 + s * 1.2 + ph;
                    const sway = Math.sin(stalkPhase) * 6;
                    const rootX = Math.cos(stalkAngle) * (orbR * 0.8);
                    const rootY = Math.sin(stalkAngle) * (orbR * 0.8);
                    const tipX = Math.cos(stalkAngle) * (orbR * 1.65) + sway;
                    const tipY = Math.sin(stalkAngle) * (orbR * 1.65) - 4;

                    ctx.strokeStyle = isFlash ? '#ffffff' : '#581c87';
                    ctx.lineWidth = 2.4;
                    ctx.beginPath();
                    ctx.moveTo(rootX, rootY);
                    ctx.quadraticCurveTo((rootX + tipX) / 2 + sway * 1.5, (rootY + tipY) / 2, tipX, tipY);
                    ctx.stroke();

                    // Stalk Mini-Eye
                    ctx.fillStyle = isFlash ? '#ffffff' : '#f8fafc';
                    ctx.beginPath();
                    ctx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
                    ctx.fill();

                    // Mini-Pupil gazing toward player
                    const toPlayer = Math.atan2(player.y - (m.y + tipY), player.x - (m.x + tipX));
                    ctx.fillStyle = '#dc2626';
                    ctx.beginPath();
                    ctx.arc(tipX + Math.cos(toPlayer) * 1.2, tipY + Math.sin(toPlayer) * 1.2, 1.4, 0, Math.PI * 2);
                    ctx.fill();
                }

                // 3. Central Chitinous Flesh Sphere
                ctx.fillStyle = isFlash ? '#ffffff' : '#3b0764';
                ctx.beginPath();
                ctx.arc(0, 0, orbR, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;

                // 4. Branching Scleral Crimson Veins
                ctx.strokeStyle = '#7f1d1d';
                ctx.lineWidth = 1;
                for (let v = 0; v < 4; v++) {
                    const va = (v / 4) * Math.PI * 2 + 0.3;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(va) * (orbR * 0.4), Math.sin(va) * (orbR * 0.4));
                    ctx.lineTo(Math.cos(va) * (orbR * 0.82), Math.sin(va) * (orbR * 0.82));
                    ctx.stroke();
                }

                // 5. Grand Central Cosmic Eye
                ctx.fillStyle = isFlash ? '#fff' : '#f8fafc';
                ctx.beginPath();
                ctx.ellipse(0, 0, orbR * 0.58, orbR * 0.44, 0, 0, Math.PI * 2);
                ctx.fill();

                // Iris (Hypnotic violet/crimson)
                const toPlayer = Math.atan2(player.y - m.y, player.x - m.x);
                const irisDist = orbR * 0.16;
                const irisX = Math.cos(toPlayer) * irisDist;
                const irisY = Math.sin(toPlayer) * irisDist;
                ctx.fillStyle = '#9333ea';
                ctx.beginPath();
                ctx.arc(irisX, irisY, orbR * 0.30, 0, Math.PI * 2);
                ctx.fill();

                // Slit Eldritch Pupil
                ctx.fillStyle = '#0f172a';
                ctx.beginPath();
                ctx.ellipse(irisX, irisY, orbR * 0.10, orbR * 0.24, toPlayer, 0, Math.PI * 2);
                ctx.fill();

                // Glint
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(irisX - 2, irisY - 3, 1.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                break;
            }
            case 'Mimic': {
                // === VITA CARNIS - MIMIC (GAUNT BIPEDAL AMBUSH PREDATOR) ===
                // Emaciated humanoid stalker with cracked porcelain faux human face that splits into needle-tooth maw
                const isFrozen = !!m.mimicFrozen;
                const isLunge = m.mimicState === 'lunge';
                const animT = isFrozen ? 0 : t;
                const pulse = 1 + Math.sin(animT * 5 + ph) * 0.06;
                const hunchedY = isFrozen ? 0 : Math.sin(animT * 4 + ph) * 1.8;

                // 1. Kaki Humanoid Kurus Bungkuk (Emaciated Stalking Legs)
                ctx.strokeStyle = m.hitFlash > 0 ? '#ffffff' : '#4a3f38';
                ctx.lineWidth = 2.8;
                for (const side of [-1, 1]) {
                    const hipX = side * R * 0.22;
                    const kneeX = side * R * 0.42 + (isFrozen ? 0 : Math.sin(animT * 3.5 + side) * 3);
                    const footX = side * R * 0.3;
                    ctx.beginPath();
                    ctx.moveTo(hipX, R * 0.2 + hunchedY);
                    ctx.lineTo(kneeX, R * 0.65);
                    ctx.lineTo(footX, R * 1.05);
                    ctx.stroke();
                }

                // 2. Batang Tubuh Humanoid Bungkuk Kerempeng (Gaunt Hunched Torso)
                ctx.fillStyle = m.hitFlash > 0 ? '#ffffff' : (isLunge ? '#521414' : '#695a50');
                ctx.beginPath();
                ctx.moveTo(-R * 0.32, R * 0.2 + hunchedY);
                // Pinggang kerempeng
                ctx.quadraticCurveTo(-R * 0.18, -R * 0.1 + hunchedY, -R * 0.35, -R * 0.45 + hunchedY);
                // Bahu membungkuk
                ctx.lineTo(R * 0.35, -R * 0.45 + hunchedY);
                ctx.quadraticCurveTo(R * 0.18, -R * 0.1 + hunchedY, R * 0.32, R * 0.2 + hunchedY);
                ctx.closePath();
                ctx.fill();

                // Tulang Belakang & Ruas Vertebra Menonjol di Punggung
                ctx.strokeStyle = '#c4b5a5';
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                ctx.moveTo(0, -R * 0.45 + hunchedY);
                ctx.lineTo(0, R * 0.2 + hunchedY);
                ctx.stroke();

                // 3. Lengan Panjang Menjuntai Melewati Lutut dengan Cakar Tajam (Elongated Claws)
                ctx.strokeStyle = m.hitFlash > 0 ? '#ffffff' : '#574a42';
                ctx.lineWidth = 2.4;
                for (const side of [-1, 1]) {
                    const shoulderX = side * R * 0.36;
                    const elbowX = side * R * 0.55 + (isFrozen ? 0 : Math.sin(animT * 4 + side) * 4);
                    const handX = side * R * 0.48 + (isFrozen ? 0 : Math.sin(animT * 3 + side) * 5);
                    const handY = (isLunge ? R * 0.65 : R * 0.85) + hunchedY;
                    ctx.beginPath();
                    ctx.moveTo(shoulderX, -R * 0.35 + hunchedY);
                    ctx.quadraticCurveTo(elbowX, R * 0.25, handX, handY);
                    ctx.stroke();

                    // Cakar jemari predator tajam memanjang
                    ctx.strokeStyle = isLunge ? '#e74c3c' : '#d4c5a0';
                    ctx.lineWidth = 1.4;
                    for (let finger = -1; finger <= 1; finger++) {
                        ctx.beginPath();
                        ctx.moveTo(handX, handY);
                        ctx.lineTo(handX + side * 4 + finger * 2, handY + 6);
                        ctx.stroke();
                    }
                }

                // 4. Kepala dengan Topeng Wajah Manusia Palsu Pucat (Porcelain Faux Human Face)
                const headY = -R * 0.72 + hunchedY;
                const headW = R * 0.42;
                const headH = R * 0.52;

                ctx.fillStyle = m.hitFlash > 0 ? '#ffffff' : '#e3dad1';
                ctx.beginPath();
                ctx.ellipse(0, headY, headW, headH, 0, 0, Math.PI * 2);
                ctx.fill();

                // Garis retakan halus pada topeng wajah
                ctx.strokeStyle = '#3a302a';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(-R * 0.08, headY - headH * 0.6);
                ctx.lineTo(-R * 0.04, headY - headH * 0.1);
                ctx.lineTo(-R * 0.15, headY + headH * 0.3);
                ctx.stroke();

                // Rongga Mata Cekung Hitam dengan Pupil Merah Jarum
                ctx.fillStyle = '#0f0505';
                const eyeOffX = headW * 0.42;
                const eyeY = headY - headH * 0.12;
                ctx.beginPath();
                ctx.ellipse(-eyeOffX, eyeY, 3.2, 4.2, 0, 0, Math.PI * 2);
                ctx.ellipse(eyeOffX, eyeY, 3.2, 4.2, 0, 0, Math.PI * 2);
                ctx.fill();

                if (!blink || isFrozen || isLunge) {
                    ctx.fillStyle = isLunge ? '#ff0000' : '#d63031';
                    if (isLunge) {
                        ctx.shadowBlur = 10;
                        ctx.shadowColor = '#ff0000';
                    }
                    ctx.beginPath();
                    ctx.arc(-eyeOffX, eyeY, isLunge ? 1.8 : 1.3, 0, Math.PI * 2);
                    ctx.arc(eyeOffX, eyeY, isLunge ? 1.8 : 1.3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }

                // 5. Rahang Predator:
                // Jika MEMBEKU (freeze): Mulut tertutup rapat dengan garis celah tipis (topeng manekin tanpa ekspresi)
                // Jika MENYERANG (lunge/chase): Rahang bawah membelah ternganga lebar berisi gigi jarum tajam
                if (isFrozen) {
                    ctx.strokeStyle = '#3d3028';
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(-headW * 0.42, headY + headH * 0.42);
                    ctx.lineTo(headW * 0.42, headY + headH * 0.42);
                    ctx.stroke();
                } else {
                    const jawOpen = isLunge ? (R * 0.44) : R * (0.24 + Math.sin(animT * 6 + ph) * 0.08);
                    ctx.fillStyle = '#1c0303';
                    ctx.beginPath();
                    ctx.ellipse(0, headY + headH * 0.45, headW * 0.75, jawOpen, 0, 0, Math.PI * 2);
                    ctx.fill();

                    // Barisan gigi-gigi jarum predator rapat (Needle Teeth)
                    ctx.fillStyle = '#f0ebd8';
                    const teethCount = isLunge ? 11 : 9;
                    for (let ti = 0; ti < teethCount; ti++) {
                        const ta = (ti / (teethCount - 1)) * Math.PI;
                        const tx = Math.cos(ta) * headW * 0.65;
                        const ty = headY + headH * 0.45;
                        // Gigi atas
                        ctx.beginPath();
                        ctx.moveTo(tx - 0.9, ty - jawOpen * 0.6);
                        ctx.lineTo(tx, ty - jawOpen * 0.1);
                        ctx.lineTo(tx + 0.9, ty - jawOpen * 0.6);
                        ctx.closePath();
                        ctx.fill();
                        // Gigi bawah
                        ctx.beginPath();
                        ctx.moveTo(tx - 0.9, ty + jawOpen * 0.6);
                        ctx.lineTo(tx, ty + jawOpen * 0.1);
                        ctx.lineTo(tx + 0.9, ty + jawOpen * 0.6);
                        ctx.closePath();
                        ctx.fill();
                    }
                }
                break;
            }
            case 'Final Boss': {
                // === VITA CARNIS APEX HARVESTER (LEGENDARY HORROR BOSS) ===
                const pulse = 1 + Math.sin(t * 3.5 + ph) * 0.15;
                const throb = 24 + Math.sin(t * 5 + ph) * 10;

                // Dark crimson & Eldritch aura blur
                ctx.shadowColor = m.hitFlash > 0 ? '#ffffff' : '#8b0000';
                ctx.shadowBlur = throb;

                // Writhing Elder Flesh Core (16-point dynamic blob polygon)
                ctx.fillStyle = m.hitFlash > 0 ? '#ffffff' : '#3d0404';
                ctx.beginPath();
                for (let i = 0; i < 16; i++) {
                    const a = (i / 16) * Math.PI * 2;
                    const wobble = R * (pulse + Math.sin(t * 6 + a * 4 + ph) * 0.18);
                    const px = Math.cos(a) * wobble;
                    const py = Math.sin(a) * wobble;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                ctx.shadowBlur = 0;

                // Pulsating vein networks
                ctx.strokeStyle = '#8b0000';
                ctx.lineWidth = 2;
                for (let v = 0; v < 7; v++) {
                    const va = (v / 7) * Math.PI * 2 + t * 0.4;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    const vLen = R * (0.8 + Math.sin(t * 4 + v) * 0.2);
                    ctx.quadraticCurveTo(
                        Math.cos(va + 0.6) * vLen * 0.5,
                        Math.sin(va + 0.6) * vLen * 0.5,
                        Math.cos(va) * vLen,
                        Math.sin(va) * vLen
                    );
                    ctx.stroke();
                }

                // Titan Bone Ribcage Armor (Outer encircling bones)
                ctx.strokeStyle = '#d4c5a0';
                ctx.lineWidth = 2.5;
                for (let r = 0; r < 6; r++) {
                    const ry = -R * 0.6 + r * (R * 0.24);
                    const ribW = R * (0.85 - r * 0.08) * (1 + Math.sin(t * 2 + r) * 0.06);
                    ctx.beginPath();
                    ctx.moveTo(-ribW, ry);
                    ctx.quadraticCurveTo(0, ry - 5, ribW, ry);
                    ctx.stroke();
                }

                // 6 Writhing Bio-Tendril Arms with sharp claws
                ctx.strokeStyle = '#6b0909';
                ctx.lineWidth = 3.5;
                for (let arm = 0; arm < 6; arm++) {
                    const armA = (arm / 6) * Math.PI * 2 + Math.sin(t * 2 + arm + ph) * 0.25;
                    const armLen = R * 1.7 + Math.sin(t * 4.5 + arm) * 6;
                    const ax = Math.cos(armA) * armLen;
                    const ay = Math.sin(armA) * armLen;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(armA) * R * 0.4, Math.sin(armA) * R * 0.4);
                    ctx.quadraticCurveTo(
                        Math.cos(armA + 0.4) * armLen * 0.6,
                        Math.sin(armA + 0.4) * armLen * 0.6,
                        ax, ay
                    );
                    ctx.stroke();

                    // Bone claws on tendril tips
                    ctx.fillStyle = '#e8dcc8';
                    ctx.beginPath();
                    ctx.arc(ax, ay, 3, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Cracked Porcelain Mask on Core Head
                ctx.fillStyle = '#e8dcc8';
                ctx.beginPath();
                ctx.ellipse(0, -R * 0.2, R * 0.4, R * 0.5, 0, 0, Math.PI * 2);
                ctx.fill();

                // Mask cracks
                ctx.strokeStyle = '#222';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, -R * 0.65);
                ctx.lineTo(-R * 0.1, -R * 0.3);
                ctx.lineTo(R * 0.12, -R * 0.05);
                ctx.stroke();

                // 6 Crimson Multi-Eyes (cluster)
                const eyePositions = [
                    { x: -R * 0.18, y: -R * 0.35, size: 3.5 },
                    { x: R * 0.18, y: -R * 0.35, size: 3.5 },
                    { x: 0, y: -R * 0.45, size: 4 },
                    { x: -R * 0.28, y: -R * 0.18, size: 2.5 },
                    { x: R * 0.28, y: -R * 0.18, size: 2.5 },
                    { x: 0, y: -R * 0.22, size: 3 }
                ];
                eyePositions.forEach((eyePos, idx) => {
                    ctx.fillStyle = '#110000';
                    ctx.beginPath();
                    ctx.arc(eyePos.x, eyePos.y, eyePos.size, 0, Math.PI * 2);
                    ctx.fill();
                    if (!blink) {
                        const eyeGlow = 5 + Math.sin(t * 8 + idx + ph) * 3;
                        ctx.shadowColor = '#ff0000';
                        ctx.shadowBlur = eyeGlow;
                        ctx.fillStyle = '#ff2200';
                        ctx.beginPath();
                        ctx.arc(eyePos.x, eyePos.y, eyePos.size * 0.65, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.shadowBlur = 0;
                        ctx.fillStyle = '#ffffaa';
                        ctx.fillRect(eyePos.x - 0.7, eyePos.y - 0.7, 1.4, 1.4);
                    }
                });

                // Void Mouth with Needle Teeth
                ctx.fillStyle = '#150000';
                ctx.beginPath();
                const jawOpen = R * (0.28 + Math.sin(t * 3.5 + ph) * 0.08);
                ctx.ellipse(0, R * 0.1, R * 0.35, jawOpen, 0, 0, Math.PI * 2);
                ctx.fill();

                // Needle teeth top & bottom
                ctx.fillStyle = '#e8dcc8';
                for (let ti = 0; ti < 8; ti++) {
                    const ta = (ti / 7) * Math.PI;
                    const tx = Math.cos(ta) * R * 0.3;
                    const ty = R * 0.1 - Math.sin(ta) * jawOpen * 0.4;
                    ctx.beginPath();
                    ctx.moveTo(tx - 1.2, ty);
                    ctx.lineTo(tx, ty + 5);
                    ctx.lineTo(tx + 1.2, ty);
                    ctx.closePath();
                    ctx.fill();
                }

                // Dripping Spore Blood particles
                ctx.fillStyle = '#8b0000';
                for (let d = 0; d < 4; d++) {
                    const dx = -R * 0.4 + d * R * 0.28;
                    const dripY = R * 0.3 + ((t * 35 + d * 30 + ph) % 25);
                    const dripAlpha = 1 - (dripY - R * 0.3) / 25;
                    if (dripAlpha > 0) {
                        ctx.globalAlpha = dripAlpha * 0.8;
                        ctx.beginPath();
                        ctx.ellipse(dx, dripY, 1.5, 2.8, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                ctx.globalAlpha = 1;
                break;
            }
            case 'The Monolith': {
                // === VITA CARNIS - THE MONOLITH (COELUM CARNIS) ===
                // Colossal Eldritch Flesh Titan: Full Crimson Red, Long Pillar Legs, Tall Slender Body, Donut Loop Head
                const pulse = 1 + Math.sin(t * 2.5 + ph) * 0.08;
                const breathe = Math.sin(t * 1.8 + ph) * 0.05;

                // 1. AURA & SHADOW LANTAI DARAH RAKSASA (Colossal Crimson Ground Fog)
                ctx.save();
                ctx.shadowColor = '#ff1111';
                ctx.shadowBlur = 45 + Math.sin(t * 4 + ph) * 20;
                ctx.fillStyle = 'rgba(80, 0, 0, 0.55)';
                ctx.beginPath();
                ctx.ellipse(0, R * 1.35, R * 1.45, R * 0.45, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                // 2. DUA KAKI TIANG SANGAT PANJANG (Long Pillar Stilt Flesh Legs - ~65% Height)
                // Memanjang dari panggul (y = -R * 0.1) turun ke lantai (y = +R * 1.35)
                for (const side of [-1, 1]) {
                    const legHipX = side * R * 0.28;
                    const legFootX = side * R * 0.52;
                    const legW = R * 0.22;

                    // Akar jangkar tendon di lantai
                    ctx.fillStyle = m.hitFlash > 0 ? '#ffffff' : '#9e0d0d';
                    ctx.beginPath();
                    ctx.moveTo(legFootX - legW * 0.8, R * 1.35);
                    ctx.quadraticCurveTo(legFootX, R * 1.45, legFootX + side * legW * 1.2, R * 1.48);
                    ctx.lineTo(legFootX + legW * 0.8, R * 1.35);
                    ctx.closePath();
                    ctx.fill();

                    // Tiang kaki silindris berotot merah pekat
                    ctx.fillStyle = m.hitFlash > 0 ? '#ffffff' : (side === -1 ? '#b81212' : '#c91616');
                    ctx.beginPath();
                    ctx.moveTo(legHipX - legW * 0.5, -R * 0.1);
                    ctx.lineTo(legFootX - legW * 0.6, R * 1.35);
                    ctx.lineTo(legFootX + legW * 0.6, R * 1.35);
                    ctx.lineTo(legHipX + legW * 0.5, -R * 0.1);
                    ctx.closePath();
                    ctx.fill();

                    // Serat otot & urat vena merah menyala (Vivid Arterial Veins)
                    ctx.strokeStyle = '#ff3838';
                    ctx.lineWidth = 2.5;
                    for (let f = 0; f < 4; f++) {
                        const fx0 = legHipX - legW * 0.35 + f * (legW * 0.22);
                        const fx1 = legFootX - legW * 0.4 + f * (legW * 0.26);
                        ctx.beginPath();
                        ctx.moveTo(fx0, -R * 0.05);
                        ctx.quadraticCurveTo(
                            (fx0 + fx1) / 2 + side * Math.sin(t * 3 + f) * 5,
                            R * 0.65,
                            fx1,
                            R * 1.32
                        );
                        ctx.stroke();
                    }

                    // Sorotan cahaya merah terang pada tepi kaki
                    ctx.strokeStyle = '#ff6b6b';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(legHipX - side * legW * 0.45, -R * 0.08);
                    ctx.lineTo(legFootX - side * legW * 0.52, R * 1.33);
                    ctx.stroke();
                }

                // 3. BADAN TINGGI AGAK KURUS (Tall Slender Flesh Trunk)
                // Membujur dari y = -R * 0.1 naik menjulang ke y = -R * 1.25
                ctx.save();
                ctx.shadowColor = '#c91616';
                ctx.shadowBlur = 25;
                ctx.fillStyle = m.hitFlash > 0 ? '#ffffff' : '#a81010';
                ctx.beginPath();
                // Pinggul
                ctx.moveTo(-R * 0.32 * pulse, -R * 0.1);
                // Pinggang ramping
                ctx.quadraticCurveTo(-R * 0.18, -R * 0.55, -R * 0.22, -R * 0.95);
                // Bahu melebar sedikit di bawah leher
                ctx.quadraticCurveTo(-R * 0.28, -R * 1.15, -R * 0.16, -R * 1.25);
                ctx.lineTo(R * 0.16, -R * 1.25);
                ctx.quadraticCurveTo(R * 0.28, -R * 1.15, R * 0.22, -R * 0.95);
                ctx.quadraticCurveTo(R * 0.18, -R * 0.55, R * 0.32 * pulse, -R * 0.1);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                // Kolom pembuluh darah tengah & rusuk kartilago merah cerah
                ctx.strokeStyle = '#ff2b2b';
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.moveTo(0, -R * 0.08);
                ctx.lineTo(0, -R * 1.22);
                ctx.stroke();

                // Lempengan rusuk kartilago berirama nafas
                ctx.strokeStyle = '#ff4d4d';
                ctx.lineWidth = 2.4;
                for (let r = 0; r < 7; r++) {
                    const ry = -R * 1.12 + r * (R * 0.15);
                    const rw = (R * 0.22 - Math.abs(r - 3) * (R * 0.025)) * (1 + breathe);
                    ctx.beginPath();
                    ctx.moveTo(-rw, ry);
                    ctx.quadraticCurveTo(0, ry - 7, rw, ry);
                    ctx.stroke();
                }

                // 4. KEPALA DONAT MELINGKAR BERLUBANG DI TENGAH (The Donut / Torus Halo Head)
                // Terletak di puncak leher pada y = -R * 1.62
                const headY = -R * 1.62;
                const headOuterR = R * 0.54;
                const headInnerR = R * 0.28;

                // Leher penghubung dari badan ke cincin donat
                ctx.fillStyle = m.hitFlash > 0 ? '#ffffff' : '#ba1414';
                ctx.beginPath();
                ctx.moveTo(-R * 0.16, -R * 1.25);
                ctx.lineTo(-R * 0.24, headY + headOuterR * 0.7);
                ctx.lineTo(R * 0.24, headY + headOuterR * 0.7);
                ctx.lineTo(R * 0.16, -R * 1.25);
                ctx.closePath();
                ctx.fill();

                // Daging Cincin Donat Merah Menyala (Full Red Torus Ring of Flesh)
                ctx.save();
                ctx.shadowColor = '#ff2222';
                ctx.shadowBlur = 30 + Math.sin(t * 5 + ph) * 15;
                ctx.fillStyle = m.hitFlash > 0 ? '#ffffff' : '#d61a1a';
                ctx.beginPath();
                ctx.arc(0, headY, headOuterR, 0, Math.PI * 2, false);
                ctx.arc(0, headY, headInnerR, 0, Math.PI * 2, true);
                ctx.fill('evenodd');

                // Tekstur cincin donat: alur daging melingkar
                ctx.strokeStyle = '#ff4d4d';
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.arc(0, headY, (headOuterR + headInnerR) / 2, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();

                // Lubang tengah donat: Lubang Hampa Gravitasi & Cahaya Merah Menembus
                const vortexPulse = 0.5 + Math.sin(t * 7 + ph) * 0.5;
                ctx.fillStyle = 'rgba(255, 30, 30, ' + (0.35 + vortexPulse * 0.35) + ')';
                ctx.beginPath();
                ctx.arc(0, headY, headInnerR * 0.9, 0, Math.PI * 2);
                ctx.fill();

                // Titik Singularitas Merah Putih di Pusat Cincin
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(0, headY, 4 + vortexPulse * 3, 0, Math.PI * 2);
                ctx.fill();

                // Exposed Weak Point Core Reticle
                if (m.weakPointTimer > 0) {
                    ctx.save();
                    ctx.shadowColor = '#ffd700';
                    ctx.shadowBlur = 25 + Math.sin(t * 12) * 10;
                    ctx.strokeStyle = '#ffd700';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(0, headY, headInnerR * 1.3, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.fillStyle = '#fffbeb';
                    ctx.beginPath();
                    ctx.arc(0, headY, 8 + Math.sin(t * 10) * 3, 0, Math.PI * 2);
                    ctx.fill();
                    for (let p = 0; p < 4; p++) {
                        const pAng = t * 2 + (p * Math.PI / 2);
                        ctx.beginPath();
                        ctx.moveTo(Math.cos(pAng) * (headInnerR * 1.4), headY + Math.sin(pAng) * (headInnerR * 1.4));
                        ctx.lineTo(Math.cos(pAng) * (headInnerR * 1.8), headY + Math.sin(pAng) * (headInnerR * 1.8));
                        ctx.stroke();
                    }
                    ctx.restore();
                }

                // Phase 1: Orbiting Shield Runestones
                const isPhase1 = m.hp > m.maxHp * 0.66;
                const isPhase2 = m.hp <= m.maxHp * 0.66 && m.hp > m.maxHp * 0.33;
                const isPhase3 = m.hp <= m.maxHp * 0.33;

                if (isPhase1) {
                    ctx.save();
                    for (let r = 0; r < 4; r++) {
                        const rAng = t * 1.5 + (r * Math.PI / 2);
                        const rox = Math.cos(rAng) * (R * 0.95);
                        const roy = Math.sin(rAng) * (R * 0.45) - R * 0.5;
                        ctx.fillStyle = '#1e293b';
                        ctx.shadowColor = '#00f0ff';
                        ctx.shadowBlur = 10;
                        ctx.fillRect(rox - 6, roy - 12, 12, 24);
                        ctx.strokeStyle = '#00f0ff';
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(rox - 6, roy - 12, 12, 24);
                    }
                    ctx.restore();
                }

                // Phase 2 & 3: Sweeping Cosmic Eye Void Laser Beam
                if (!isPhase1) {
                    ctx.save();
                    const beamAngle = t * (isPhase3 ? 2.8 : 1.8);
                    const beamLen = 320;
                    ctx.strokeStyle = isPhase3 ? 'rgba(255, 30, 30, 0.75)' : 'rgba(168, 85, 247, 0.65)';
                    ctx.lineWidth = isPhase3 ? 4.5 : 3.0;
                    ctx.shadowColor = isPhase3 ? '#ff0033' : '#a855f7';
                    ctx.shadowBlur = 16;
                    ctx.beginPath();
                    ctx.moveTo(0, headY);
                    ctx.lineTo(Math.cos(beamAngle) * beamLen, headY + Math.sin(beamAngle) * beamLen);
                    ctx.stroke();
                    ctx.restore();
                }

                // 5. BANYAK UNTAIAN TENTAKEL MENJUNTAI MERAH (Cascading Filament Tendrils)
                ctx.strokeStyle = m.hitFlash > 0 ? '#ffffff' : '#e62020';
                const tendrilCount = 16;
                for (let i = 0; i < tendrilCount; i++) {
                    const side = (i % 2 === 0) ? -1 : 1;
                    const order = Math.floor(i / 2);
                    const rootX = side * (R * 0.18 + order * (R * 0.05));
                    const rootY = -R * 1.1 + order * (R * 0.08);
                    const tPhase = t * 3.2 + i * 0.65 + ph;
                    const sway1 = Math.sin(tPhase) * (12 + order * 3);
                    const sway2 = Math.cos(tPhase * 1.1) * (16 + order * 4);
                    const tipX = rootX + side * (18 + order * 6) + sway1;
                    const tipY = R * (1.1 + order * 0.06) + sway2 * 0.25;

                    ctx.lineWidth = 2.5 - order * 0.15;
                    ctx.beginPath();
                    ctx.moveTo(rootX, rootY);
                    ctx.bezierCurveTo(
                        rootX + side * 20, rootY + R * 0.6,
                        tipX - side * 12, tipY - R * 0.3,
                        tipX, tipY
                    );
                    ctx.stroke();

                    // Tetesan spora merah di ujung tentakel
                    ctx.fillStyle = '#ff3333';
                    ctx.beginPath();
                    ctx.arc(tipX, tipY, 2.2, 0, Math.PI * 2);
                    ctx.fill();
                }

                ctx.globalAlpha = 1;
                break;
            }
            default: {
                ctx.fillStyle = bodyColor;
                ctx.beginPath();
                ctx.arc(0, 0, R, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (m.name === 'The Monolith') {
            const headTopY = -m.size * (1.62 + 0.54);
            ctx.fillStyle = '#ff3333';
            ctx.font = 'bold 13px monospace';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 15;
            ctx.fillText('[ THE MONOLITH // COELUM CARNIS ]', 0, headTopY - 26);
            ctx.shadowBlur = 0;

            // Massive Colossal Boss HP Bar di atas kepala donat
            const barW = 240, barH = 12;
            const barY = headTopY - 18;
            ctx.fillStyle = 'rgba(15, 0, 0, 0.9)';
            ctx.fillRect(-barW / 2, barY, barW, barH);
            ctx.strokeStyle = '#ff2222';
            ctx.lineWidth = 2;
            ctx.strokeRect(-barW / 2, barY, barW, barH);
            const pct = Math.max(0, m.hp / m.maxHp);
            const grad = ctx.createLinearGradient(-barW / 2, 0, barW / 2, 0);
            grad.addColorStop(0, '#800505');
            grad.addColorStop(0.5, '#d61818');
            grad.addColorStop(1, '#ff3b3b');
            ctx.fillStyle = grad;
            ctx.fillRect(-barW / 2 + 1, barY + 1, (barW - 2) * pct, barH - 2);

            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`${Math.ceil(pct * 100)}% // APEX CARNIS TITAN`, 0, barY + 9.5);
        } else if (m.isMotherHarvester || m.name === 'Mother Harvester') {
            const headTopY = -m.size * 1.15;
            ctx.fillStyle = '#ff3333';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 10;
            ctx.fillText(lang === 'en' ? '[ MOTHER HARVESTER // APEX CARNIS ]' : '[ INDUK HARVESTER // APEX CARNIS ]', 0, headTopY - 22);
            ctx.shadowBlur = 0;

            // Bar HP Kolosal Mother Harvester
            const barW = 190, barH = 10;
            const barY = headTopY - 14;
            ctx.fillStyle = 'rgba(20, 0, 0, 0.9)';
            ctx.fillRect(-barW / 2, barY, barW, barH);
            ctx.strokeStyle = '#ff2222';
            ctx.lineWidth = 1.8;
            ctx.strokeRect(-barW / 2, barY, barW, barH);
            const pct = Math.max(0, m.hp / m.maxHp);
            const grad = ctx.createLinearGradient(-barW / 2, 0, barW / 2, 0);
            grad.addColorStop(0, '#780808');
            grad.addColorStop(0.5, '#c71c1c');
            grad.addColorStop(1, '#ff3b3b');
            ctx.fillStyle = grad;
            ctx.fillRect(-barW / 2 + 1, barY + 1, (barW - 2) * pct, barH - 2);

            ctx.font = 'bold 9px monospace';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`${Math.ceil(pct * 100)}% // CONGREGENTUR CARNIS`, 0, barY + 8);
        } else if (m.name === 'Final Boss') {
            ctx.fillStyle = '#ff3b3b';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 8;
            ctx.fillText('[ APEX PREDATOR ]', 0, -m.size - 12);
            ctx.shadowBlur = 0;

            // Big Boss HP bar
            ctx.fillStyle = '#111';
            ctx.fillRect(-m.size * 1.4, -m.size - 8, m.size * 2.8, 6);
            ctx.fillStyle = '#e74c3c';
            ctx.fillRect(-m.size * 1.4, -m.size - 8, m.size * 2.8 * (m.hp / m.maxHp), 6);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1;
            ctx.strokeRect(-m.size * 1.4, -m.size - 8, m.size * 2.8, 6);
        } else {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 8px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`Lv${m.level + 1}`, 0, -m.size - 8);

            if (m.hp < m.maxHp) {
                ctx.fillStyle = '#333';
                ctx.fillRect(-m.size, -m.size - 14, m.size * 2, 4);
                ctx.fillStyle = '#e74c3c';
                ctx.fillRect(-m.size, -m.size - 14, m.size * 2 * (m.hp / m.maxHp), 4);
            }
        }

        ctx.restore();
    });
}

function drawProjectiles() {
    projectiles.forEach(p => {
        const sx = p.x - cameraX + W / 2;
        const sy = p.y - cameraY + H / 2;

        if (p.isPlayer) {
            ctx.save();
            ctx.translate(sx, sy);
            if (p.kind === 'rifle') {
                const angle = Math.atan2(p.dy, p.dx);
                ctx.rotate(angle);
                ctx.fillStyle = '#00f0ff';
                ctx.shadowColor = '#00d2d3';
                ctx.shadowBlur = 12;
                ctx.fillRect(-14, -2.2, 28, 4.4);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(-8, -1.1, 18, 2.2);
                ctx.beginPath();
                ctx.arc(14, 0, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            } else if (p.kind === 'cluster_bomb') {
                const angle = Math.atan2(p.dy, p.dx);
                ctx.rotate(angle);
                ctx.fillStyle = '#ff4757';
                ctx.shadowColor = '#ff6b81';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffa502';
                ctx.beginPath();
                ctx.arc(1.5, 0, 2.2, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.kind === 'grenade') {
                p.rot = (p.rot || 0) + 0.15;
                ctx.rotate(p.rot);
                ctx.fillStyle = '#2d572c';
                ctx.beginPath();
                ctx.rect(-6, -4, 12, 8);
                ctx.fill();
                ctx.strokeStyle = '#f39c12';
                ctx.lineWidth = 1.2;
                ctx.strokeRect(-4, -4, 8, 8);
                const blink = Math.floor(p.life / 5) % 2 === 0;
                ctx.fillStyle = blink ? '#ff0000' : '#440000';
                ctx.shadowColor = blink ? '#ff0000' : 'transparent';
                ctx.shadowBlur = blink ? 6 : 0;
                ctx.beginPath();
                ctx.arc(6, 0, 2.2, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.kind === 'bazooka') {
                const angle = Math.atan2(p.dy, p.dx);
                ctx.rotate(angle);
                ctx.fillStyle = '#4b6584';
                ctx.fillRect(-10, -3.5, 20, 7);
                ctx.fillStyle = '#eb3b5a';
                ctx.beginPath();
                ctx.moveTo(10, -3.5);
                ctx.lineTo(16, 0);
                ctx.lineTo(10, 3.5);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#2c3e50';
                ctx.fillRect(-10, -6, 3, 12);
                ctx.fillStyle = '#f39c12';
                ctx.shadowColor = '#ff3838';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(-11, 0, 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.kind === 'minigun') {
                const angle = Math.atan2(p.dy, p.dx);
                ctx.rotate(angle);
                ctx.fillStyle = '#ffeaa7';
                ctx.shadowColor = '#fdcb6e';
                ctx.shadowBlur = 6;
                ctx.fillRect(-5, -1.2, 10, 2.4);
                ctx.fillStyle = '#fff';
                ctx.fillRect(-2, -0.6, 5, 1.2);
            }
            ctx.restore();
        } else {
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(sx, sy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    });
}

function drawParticles() {
    const margin = 40;
    const isChunkyOrLowFps = (settings && settings.quality === 'chunky') || (typeof perfFps !== 'undefined' && perfFps < 45);
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const sx = p.x - cameraX + W / 2;
        const sy = p.y - cameraY + H / 2;
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) {
            culledCount++;
            continue;
        }
        renderedCount++;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));

        if (p.deathType) {
            drawCustomDeathParticle(p, sx, sy);
        } else {
            ctx.fillStyle = p.color;
            const sz = p.size * (p.life / p.maxLife);
            if (isChunkyOrLowFps) {
                // High-performance square pixel rendering: 3-5x faster than arc() on mobile GPUs
                const halfSz = sz * 0.8;
                ctx.fillRect(sx - halfSz, sy - halfSz, sz * 1.6, sz * 1.6);
            } else {
                ctx.beginPath();
                ctx.arc(sx, sy, sz, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    ctx.globalAlpha = 1;
}

function drawArtifacts() {
    const time = Date.now() / 1000;
    artifacts.forEach(a => {
        if (a.collected) return;

        const sx = a.x - cameraX + W / 2;
        const sy = a.y - cameraY + H / 2 + Math.sin(time * 2 + a.bobPhase) * 4;

        if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;
        if (!fogOfWar[a.gy] || !fogOfWar[a.gy][a.gx]) return;

        ctx.save();
        ctx.translate(sx, sy);

        const pulse = 1 + Math.sin(time * 3 + a.bobPhase) * 0.15;
        ctx.shadowColor = a.type.color;
        ctx.shadowBlur = 18;
        ctx.fillStyle = a.type.color;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(0, 0, 16 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.rotate(Math.sin(time * 1.5 + a.bobPhase) * 0.3);
        if (a.type.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, 8 * pulse, 0, Math.PI * 2);
            ctx.fillStyle = a.type.color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fill();
        } else if (a.type.shape === 'diamond') {
            ctx.beginPath();
            ctx.moveTo(0, -10 * pulse);
            ctx.lineTo(8 * pulse, 0);
            ctx.lineTo(0, 10 * pulse);
            ctx.lineTo(-8 * pulse, 0);
            ctx.closePath();
            ctx.fillStyle = a.type.color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else if (a.type.shape === 'square') {
            ctx.fillStyle = a.type.color;
            ctx.fillRect(-8 * pulse, -8 * pulse, 16 * pulse, 16 * pulse);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(-8 * pulse, -8 * pulse, 16 * pulse, 16 * pulse);
        } else if (a.type.shape === 'star') {
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const rad = i % 2 === 0 ? 10 * pulse : 5 * pulse;
                const ang = -Math.PI / 2 + i * Math.PI / 5;
                ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
            }
            ctx.closePath();
            ctx.fillStyle = a.type.color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else if (a.type.shape === 'ring') {
            ctx.beginPath();
            ctx.arc(0, 0, 8 * pulse, 0, Math.PI * 2);
            ctx.fillStyle = a.type.color;
            ctx.fill();
            ctx.fillStyle = '#222';
            ctx.beginPath();
            ctx.arc(0, 0, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
        }

        ctx.rotate(-Math.sin(time * 1.5 + a.bobPhase) * 0.3);
        ctx.restore();

        ctx.fillStyle = a.type.color;
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(aTypeName(a.type), sx, sy + 26);
    });

    // Draw Classified Lore Data Discs
    if (typeof dataDiscs !== 'undefined' && dataDiscs.length) {
        dataDiscs.forEach(d => {
            if (d.collected) return;
            const sx = d.x - cameraX + W / 2;
            const sy = d.y - cameraY + H / 2 + Math.sin(time * 3 + (d.gx + d.gy)) * 3.5;
            if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;
            if (!fogOfWar[d.gy] || !fogOfWar[d.gy][d.gx]) return;

            ctx.save();
            ctx.translate(sx, sy);
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 16;

            // Holographic data disk field
            ctx.fillStyle = 'rgba(0, 240, 255, 0.22)';
            ctx.beginPath();
            ctx.arc(0, 0, 14, 0, Math.PI * 2);
            ctx.fill();

            // Rotating cyan microchip runes
            ctx.rotate(time * 2.2);
            ctx.strokeStyle = '#00f0ff';
            ctx.lineWidth = 1.8;
            ctx.strokeRect(-7, -7, 14, 14);

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            ctx.fillStyle = '#00f0ff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('DATA LOG', sx, sy + 22);
        });
    }

    // Draw Volatile Biohazard Barrels
    if (typeof barrels !== 'undefined' && barrels.length) {
        barrels.forEach(b => {
            if (b.exploded) return;
            const sx = b.x - cameraX + W / 2;
            const sy = b.y - cameraY + H / 2;
            if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;
            if (!fogOfWar[b.gy] || !fogOfWar[b.gy][b.gx]) return;

            ctx.save();
            ctx.translate(sx, sy);

            // Shaded steel canister body
            const bgGrad = ctx.createLinearGradient(-10, 0, 10, 0);
            bgGrad.addColorStop(0, '#7f1d1d');
            bgGrad.addColorStop(0.4, '#dc2626');
            bgGrad.addColorStop(1, '#500724');
            ctx.fillStyle = bgGrad;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(-10, -13, 20, 26, 3);
            else ctx.rect(-10, -13, 20, 26);
            ctx.fill();
            ctx.strokeStyle = '#1a050b';
            ctx.lineWidth = 1.4;
            ctx.stroke();

            // Yellow/black warning hazard stripes
            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(-10, -3, 20, 6);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(-6, -3); ctx.lineTo(-2, 3);
            ctx.moveTo(0, -3); ctx.lineTo(4, 3);
            ctx.moveTo(6, -3); ctx.lineTo(10, 3);
            ctx.stroke();

            // Luminous biohazard indicator
            ctx.fillStyle = '#fef08a';
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(0, -7, 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.restore();
        });
    }
}


function drawWreckedRobot() {
    if (!wreckedRobot || currentLevel !== 9) return;
    const sx = wreckedRobot.x - cameraX + W / 2;
    const sy = wreckedRobot.y - cameraY + H / 2;

    if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) return;
    if (!fogOfWar[wreckedRobot.gy] || !fogOfWar[wreckedRobot.gy][wreckedRobot.gx]) return;

    const t = Date.now() / 1000;

    ctx.save();
    ctx.translate(sx, sy);

    // ============================================================
    // 1. GROUND SCORCH & HEAVY HYDRAULIC OIL SLICK
    // ============================================================
    ctx.fillStyle = 'rgba(10, 6, 8, 0.82)';
    ctx.beginPath();
    ctx.ellipse(0, 3, 24, 16, 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Iridescent chemical oil rainbow sheen spots
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.beginPath();
    ctx.ellipse(5, 7, 10, 5, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(236, 72, 153, 0.12)';
    ctx.beginPath();
    ctx.ellipse(-6, 6, 8, 4, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Slumped Russian BMPT Terminator chassis angle
    ctx.rotate(0.48);

    // ============================================================
    // 2. RUSSIAN BMPT CATERPILLAR TRACKS & ROAD WHEELS (DAMAGED)
    // ============================================================
    const trackWidth = 5.5;
    const trackLength = 29;
    const trackYOffset = 8.5;

    // 2A. LEFT TRACK (Still mounted on road wheels, scarred & soot-covered)
    const leftTopY = -trackYOffset - trackWidth / 2;
    ctx.fillStyle = '#0b0f19';
    ctx.beginPath();
    ctx.roundRect(-trackLength / 2, leftTopY, trackLength, trackWidth, 3);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Static worn tread cleats
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.1;
    for (let c = 0; c < 5; c++) {
        const cleatX = -trackLength / 2 + 4 + c * 5.2;
        ctx.beginPath();
        ctx.moveTo(cleatX, leftTopY);
        ctx.lineTo(cleatX, leftTopY + trackWidth);
        ctx.stroke();
    }

    // Road wheels on left track
    for (let w = -1; w <= 2; w++) {
        const wx = -10 + (w + 1) * 6.5;
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(wx, -trackYOffset, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.arc(wx, -trackYOffset, 1.0, 0, Math.PI * 2);
        ctx.fill();
    }

    // 2B. RIGHT TRACK (SEVERED & DERAILED - Blown open across floor)
    const rightTy = trackYOffset;
    // Exposed & distorted road wheels
    for (let w = -1; w <= 2; w++) {
        const wx = -10 + (w + 1) * 6.5;
        ctx.fillStyle = (w === 1) ? '#0f172a' : '#1e293b'; // One wheel cracked/charred
        ctx.beginPath();
        ctx.arc(wx + (w === 1 ? 1 : 0), rightTy + (w === 0 ? 1 : 0), 2.2, 0, Math.PI * 2);
        ctx.fill();
    }

    // Broken track ribbon peeling backwards into wreckage
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(8, rightTy);
    ctx.lineTo(-4, rightTy + 2);
    ctx.lineTo(-14, rightTy + 6);
    ctx.lineTo(-22, rightTy + 10);
    ctx.stroke();
    // Broken track links & metallic highlights
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Loose sheared track link pins
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-18, rightTy + 8, 3, 2);
    ctx.fillRect(-23, rightTy + 11, 2, 2.5);

    // ============================================================
    // 3. SLOPED ARMORED HULL / MAIN CHASSIS (CHARRED BMPT)
    // ============================================================
    // Lower Hull Bed (Charred steel)
    ctx.fillStyle = '#131924';
    ctx.beginPath();
    ctx.roundRect(-12, -7.5, 24, 15, 2.5);
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Front Glacis Sloped Armor Plate (BMPT Anti-Ballistic Wedge)
    ctx.fillStyle = '#1e2738';
    ctx.beginPath();
    ctx.moveTo(3, -7);
    ctx.lineTo(13, -4.5);
    ctx.lineTo(13, 4.5);
    ctx.lineTo(3, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Scratched tactical hazard chevron on glacis
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(8, -2.5);
    ctx.lineTo(11, 0);
    ctx.lineTo(9.5, 1.2); // broken/interrupted stroke
    ctx.stroke();

    // Deep plasma / shell impact crater on armor
    ctx.fillStyle = '#05070a';
    ctx.beginPath();
    ctx.arc(6, -2, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Rear Engine Deck & Radiator Louvers (Crumpled)
    ctx.fillStyle = '#080c14';
    ctx.fillRect(-11, -5.5, 5, 11);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.8;
    for (let r = -4; r <= 4; r += 2) {
        ctx.beginPath();
        ctx.moveTo(-11, r);
        ctx.lineTo(-7, r + ((r === 0) ? 1.5 : 0)); // distorted slit
        ctx.stroke();
    }

    // Rear exhaust nozzles (One crushed, one soot-blackened)
    ctx.fillStyle = '#090d16';
    ctx.fillRect(-14, -6, 2.5, 2.2);
    ctx.fillRect(-14, 3.5, 2.0, 1.8);

    // Snapped comms antenna (bent backwards with exposed copper strands)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, -6);
    ctx.lineTo(-14, -8.5);
    ctx.lineTo(-17, -7);
    ctx.stroke();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-17, -7);
    ctx.lineTo(-19, -6.5);
    ctx.stroke();

    // ============================================================
    // 4. BMPT DUAL 30MM 2A42 AUTOCANNON WEAPON MOUNT (TWIN BARRELS)
    // ============================================================
    // Armored Mantlet (Tilted weapon cradle)
    ctx.fillStyle = '#182030';
    ctx.fillRect(-2, -4.5, 6, 9);
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 1;
    ctx.strokeRect(-2, -4.5, 6, 9);

    // Barrel 1 (Upper 30mm Autocannon - Intact but drooping slightly)
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(4, -3.2, 13, 2.0);
    // Upper muzzle brake
    ctx.fillStyle = '#334155';
    ctx.fillRect(16, -3.7, 2.4, 3.0);

    // Barrel 2 (Lower 30mm Autocannon - Blown open / ruptured barrel)
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(4, 1.0, 7, 2.2);
    // Jagged burst barrel petals
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.moveTo(11, 0.8);
    ctx.lineTo(13.5, 0.2);
    ctx.lineTo(12, 2.2);
    ctx.lineTo(13.8, 3.4);
    ctx.lineTo(10.5, 3.2);
    ctx.closePath();
    ctx.fill();

    // ============================================================
    // 5. TOP TURRET & DYING CYCLOPS OPTICAL SENSOR
    // ============================================================
    // Tilted Turret Ring
    ctx.save();
    ctx.rotate(0.18);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, 7.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Severed colored wire bundle spilling out of turret ring
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(4, 3);
    ctx.lineTo(8, 6.5);
    ctx.lineTo(11, 9);
    ctx.stroke();
    ctx.strokeStyle = '#0284c7';
    ctx.beginPath();
    ctx.moveTo(2, -3);
    ctx.lineTo(6, -6);
    ctx.stroke();

    // Dying cracked optical sensor (Cyclops "Mata Robot" - Faint Crimson Flicker)
    const dyingFlicker = (Math.sin(t * 3.5) > 0.1) ? (0.25 + Math.random() * 0.45) : 0.08;
    ctx.fillStyle = 'rgba(239, 68, 68, ' + dyingFlicker + ')';
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 9 * dyingFlicker;
    ctx.beginPath();
    ctx.arc(3.2, 0, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Diagonal fracture crack across cyclops lens
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(2.2, -1.5);
    ctx.lineTo(4.2, 1.5);
    ctx.stroke();

    ctx.restore();
    ctx.restore();

    // Random electrical spark emission from exposed circuits
    if (Math.random() < 0.06 && typeof addParticle === 'function') {
        addParticle(wreckedRobot.x + (Math.random() - 0.5) * 18, wreckedRobot.y + (Math.random() - 0.5) * 18, '#00e5ff', 3, 2, 10);
    }

    // Floating interaction prompt when player is nearby
    if (player && dist(player, wreckedRobot) < 55) {
        ctx.save();
        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 8;
        const bob = Math.sin(t * 4) * 2;
        const promptText = (typeof lang !== 'undefined' && lang === 'en')
            ? '[ E / TAP : INSPECT WRECKAGE ]'
            : '[ E / TAP : PERIKSA RONGSOKAN ]';
        ctx.fillText(promptText, sx, sy - 26 + bob);
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

function openRobotMemoryModal() {
    const modal = document.getElementById('robotMemoryModal');
    if (!modal) return;
    try {
        if (typeof sOccultTone === 'function') sOccultTone(60, 45, 1.8, 0.4, 'sine');
    } catch (_) {}
    modal.style.display = 'flex';
    if (typeof hideHUD === 'function') hideHUD();
    if (typeof showCursor === 'function') showCursor();
    if (gameState === 'playing') gameState = 'paused';
}

function closeRobotMemoryModal() {
    const modal = document.getElementById('robotMemoryModal');
    if (modal) modal.style.display = 'none';
    if (typeof showHUD === 'function') showHUD();
    if (typeof hideCursor === 'function') hideCursor();
    if (wreckedRobot) wreckedRobot.inspected = true;
    if (gameState === 'paused') gameState = 'playing';
}
window.openRobotMemoryModal = openRobotMemoryModal;
window.closeRobotMemoryModal = closeRobotMemoryModal;

function drawExit() {
    if (!exitPos) return;
    const sx = exitPos.x - cameraX + W / 2;
    const sy = exitPos.y - cameraY + H / 2;

    if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) return;
    if (!fogOfWar[exitPos.gy] || !fogOfWar[exitPos.gx]) return;

    const unlocked = coinsCollected >= artifacts.length;
    const time = Date.now() / 1000;
    const pulse = 1 + Math.sin(time * 3) * 0.1;

    ctx.save();
    ctx.translate(sx, sy);

    const portalColor = unlocked ? '#2ecc71' : '#7f8c8d';

    ctx.globalAlpha = 0.2 + Math.sin(time * 2) * 0.1;
    ctx.fillStyle = portalColor;
    ctx.shadowColor = portalColor;
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(0, 0, 30 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = unlocked ? '#27ae60' : '#95a5a6';
    ctx.beginPath();
    ctx.arc(0, 0, 18 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = unlocked ? '#a8f5c3' : '#bdc3c7';
    ctx.beginPath();
    ctx.arc(0, 0, 10 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (unlocked) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#2ecc71';
        ctx.shadowBlur = 12;
        ctx.fillText(tt('arrow_exit'), 0, -38);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.moveTo(-10, -5);
        ctx.lineTo(2, -5);
        ctx.lineTo(2, -10);
        ctx.lineTo(12, 0);
        ctx.lineTo(2, 10);
        ctx.lineTo(2, 5);
        ctx.lineTo(-10, 5);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tt('exit_locked_label'), 0, -42);

        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.font = 'bold 12px Arial';
        ctx.fillText(tt('need_more_artifacts').replace('{n}', artifacts.length - coinsCollected), 0, 42);
    }

    ctx.restore();
}

function drawTraps() {
    const time = Date.now() / 1000;
    traps.forEach(tr => {
        if (!fogOfWar[tr.gy] || !fogOfWar[tr.gy][tr.gx]) return;
        const sx = tr.x - cameraX + W / 2;
        const sy = tr.y - cameraY + H / 2;
        if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;
        ctx.save();
        ctx.translate(sx, sy);
        if (tr.state === 'hidden') {
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(-8, -2, 16, 4);
            ctx.fillRect(-2, -8, 4, 16);
        } else {
            const hot = tr.state === 'triggered';
            ctx.fillStyle = hot ? '#ff3b3b' : '#7f8c8d';
            if (hot) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 12; }
            const h = hot ? 10 : 7 + Math.sin(time * 3) * 1;
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath();
                ctx.moveTo(i * 8 - 4, 6);
                ctx.lineTo(i * 8, -h);
                ctx.lineTo(i * 8 + 4, 6);
                ctx.closePath();
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            if (hot) {
                ctx.fillStyle = 'rgba(180,0,0,0.5)';
                ctx.beginPath();
                ctx.arc(0, 0, 14, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    });
}

function drawMedPods() {
    if (!medPods || !medPods.length) return;
    const time = Date.now() / 1000;
    medPods.forEach(pod => {
        if (!fogOfWar[pod.gy] || !fogOfWar[pod.gy][pod.gx]) return;
        const sx = pod.x - cameraX + W / 2;
        const sy = pod.y - cameraY + H / 2;
        if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;

        ctx.save();
        ctx.translate(sx, sy);

        // Hex Base Frame
        ctx.fillStyle = '#1c222b';
        ctx.strokeStyle = pod.used ? 'rgba(100, 110, 120, 0.4)' : '#2ecc71';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const ang = (Math.PI / 3) * i;
            const px = Math.cos(ang) * 14;
            const py = Math.sin(ang) * 14;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Nanite Glass Chamber
        if (!pod.used) {
            const pulse = 0.5 + 0.3 * Math.sin(time * 3);
            ctx.fillStyle = `rgba(46, 204, 113, ${pulse})`;
            ctx.shadowColor = '#2ecc71';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Medical Cross
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-2, -6, 4, 12);
            ctx.fillRect(-6, -2, 12, 4);
        } else {
            ctx.fillStyle = 'rgba(70, 80, 90, 0.4)';
            ctx.beginPath();
            ctx.arc(0, 0, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#555';
            ctx.fillRect(-1.5, -4, 3, 8);
            ctx.fillRect(-4, -1.5, 8, 3);
        }

        ctx.restore();
    });
}

function drawThermalTrails() {
    if (!thermalTrails || !thermalTrails.length) return;
    thermalTrails.forEach(t => {
        const sx = t.x - cameraX + W / 2;
        const sy = t.y - cameraY + H / 2;
        if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) return;
        const alpha = Math.min(1, t.life / (t.maxLife * 0.4));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(255, 87, 34, 0.45)';
        ctx.shadowColor = '#ff5722';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(sx, sy, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 193, 7, 0.6)';
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

function drawMotionTracker() {
    if (!player || gameState !== 'playing' || !monsters || !monsters.length) return;
    let closestDist = Infinity;
    let closestAng = 0;
    for (let i = 0; i < monsters.length; i++) {
        const m = monsters[i];
        if (m.hp > 0) {
            const d = dist(m, player);
            if (d < 220 && d < closestDist) {
                closestDist = d;
                closestAng = Math.atan2(m.y - player.y, m.x - player.x);
            }
        }
    }
    if (closestDist >= 220) return;

    const sx = player.x - cameraX + W / 2;
    const sy = player.y - cameraY + H / 2;
    const intensity = Math.max(0.2, 1 - closestDist / 220);
    const isCritical = closestDist < 100;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.strokeStyle = isCritical ? `rgba(255, 59, 59, ${intensity * 0.85})` : `rgba(0, 229, 255, ${intensity * 0.7})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, 25, closestAng - 0.35, closestAng + 0.35);
    ctx.stroke();

    // Sensor Pip Dot
    const pipX = Math.cos(closestAng) * 25;
    const pipY = Math.sin(closestAng) * 25;
    ctx.fillStyle = isCritical ? '#ff3b3b' : '#00e5ff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = isCritical ? 8 : 4;
    ctx.beginPath();
    ctx.arc(pipX, pipY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawFloatingTexts() {
    const margin = 45;
    for (let i = 0; i < floatingTexts.length; i++) {
        const t = floatingTexts[i];
        const sx = t.x - cameraX + W / 2;
        const sy = t.y - cameraY + H / 2;
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) {
            culledCount++;
            continue;
        }
        renderedCount++;
        ctx.globalAlpha = Math.min(1, t.life / (t.maxLife / 2));
        ctx.font = t.isCrit ? "bold 13px 'Cascadia Code', monospace" : "bold 11px 'Cascadia Code', monospace";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#050309';
        ctx.lineWidth = 3;
        ctx.strokeText(t.text, sx, sy);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, sx, sy);
        ctx.globalAlpha = 1;
    }
}

function drawDirectionArrow() {
    let target = null;
    if (coinsCollected < artifacts.length) {
        let bestDist = Infinity;
        artifacts.forEach(a => {
            if (!a.collected && dist(a, player) < bestDist) {
                bestDist = dist(a, player);
                target = a;
            }
        });
    } else if (exitPos) {
        target = exitPos;
    }
    if (!target) return;

    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const angle = Math.atan2(dy, dx);

    const margin = 60;
    const ex = player.x - cameraX + W / 2;
    const ey = player.y - cameraY + H / 2;

    let sx = ex + Math.cos(angle) * 120;
    let sy = ey + Math.sin(angle) * 120;

    sx = Math.max(margin, Math.min(W - margin, sx));
    sy = Math.max(margin, Math.min(H - margin, sy));

    const pulse = 1 + Math.sin(Date.now() / 200) * 0.15;
    const size = 14 * pulse;
    const color = coinsCollected < artifacts.length ? '#f1c40f' : '#2ecc71';

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.8, size * 0.6);
    ctx.lineTo(0, size * 0.3);
    ctx.lineTo(-size * 0.8, size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(coinsCollected < artifacts.length ? tt('arrow_artifact') : tt('arrow_exit'), 0, size + 8);
    ctx.restore();
}

function drawDarkModeOverlay() {
    if (currentLevel % 2 !== 0) return;

    const brightRatio = Math.max(0.3, Math.min(1.8, Number(settings.brightness) / 100));
    const smod = getSektorMod(currentLevel);
    const baseTorchR = (currentLevel === LEVELS - 1) ? 460 : 250;
    const torchR = baseTorchR * brightRatio * smod.torchMult;
    const gradient = ctx.createRadialGradient(W/2, H/2, 50 * brightRatio, W/2, H/2, torchR);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.7, `rgba(10,0,6,${Math.max(0.1, 0.55 * brightnessMul())})`);
    gradient.addColorStop(1, `rgba(16,0,8,${Math.max(0.2, 0.9 * brightnessMul())})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(-W * 2, -H * 2, W * 5, H * 5);

    monsters.forEach(m => {
        if (m.hp <= 0) return;
        const sx = m.x - cameraX + W / 2;
        const sy = m.y - cameraY + H / 2;

        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        const holeR = m.isBoss ? 220 : 40;
        const mg = ctx.createRadialGradient(sx, sy, 0, sx, sy, holeR);
        mg.addColorStop(0, 'rgba(0,0,0,0.5)');
        mg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(sx, sy, holeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

// === SEKTOR FOG TINT OVERLAY ===
// Menambahkan warna lingkungan unik di setiap zona (spora hijau, eldritch ungu, darah merah, dll)
function drawSektorFogTint() {
    const smod = getSektorMod(currentLevel);
    if (!smod.fogTint) return;
    ctx.save();
    ctx.fillStyle = smod.fogTint;
    ctx.fillRect(0, 0, W, H);
    // Pulse bernapas halus untuk sektor horror (9+)
    if (smod.heartbeat) {
        const pulse = Math.sin(Date.now() / 800) * 0.03 + 0.02;
        ctx.fillStyle = `rgba(120,0,0,${pulse})`;
        ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
}

// Edge Chevron Directional Indicator for Off-screen / Distant Objectives
function drawMinimapEdgeChevron(targetGX, targetGY, color, isPulse, scale, ox, oy) {
    const playerMx = ox + (player.x / CELL) * scale;
    const playerMy = oy + (player.y / CELL) * scale;
    const targetMx = ox + targetGX * scale;
    const targetMy = oy + targetGY * scale;

    const dx = targetMx - playerMx;
    const dy = targetMy - playerMy;
    const distPx = Math.hypot(dx, dy);
    if (distPx < 30) return; // Dekat dengan player, tidak butuh chevron ping tepi

    const angle = Math.atan2(dy, dx);
    const edgeMargin = 8;
    const minX = ox + edgeMargin;
    const maxX = ox + mazeW * scale - edgeMargin;
    const minY = oy + edgeMargin;
    const maxY = oy + mazeH * scale - edgeMargin;

    let edgeX = playerMx + Math.cos(angle) * distPx;
    let edgeY = playerMy + Math.sin(angle) * distPx;

    edgeX = Math.max(minX, Math.min(maxX, edgeX));
    edgeY = Math.max(minY, Math.min(maxY, edgeY));

    minimapCtx.save();
    minimapCtx.translate(edgeX, edgeY);
    minimapCtx.rotate(angle);

    const alpha = isPulse ? (0.65 + Math.sin(Date.now() / 150) * 0.35) : 0.9;
    minimapCtx.fillStyle = color;
    minimapCtx.globalAlpha = alpha;
    minimapCtx.beginPath();
    minimapCtx.moveTo(5, 0);
    minimapCtx.lineTo(-6, -4);
    minimapCtx.lineTo(-3, 0);
    minimapCtx.lineTo(-6, 4);
    minimapCtx.closePath();
    minimapCtx.fill();
    minimapCtx.restore();
}

function drawMinimap() {
    if (settings && settings.showMinimap === false) return;
    minimapCtx.clearRect(0, 0, 180, 180);

    const scale = Math.min(170 / mazeW, 170 / mazeH);
    const ox = (180 - mazeW * scale) / 2;
    const oy = (180 - mazeH * scale) / 2;

    minimapCtx.fillStyle = 'rgba(0,0,0,0.7)';
    minimapCtx.fillRect(0, 0, 180, 180);

    // 1. Breadcrumb Trail via exploredCells Int8Array (Pre-allocated, Zero-GC)
    for (let y = 0; y < mazeH; y++) {
        for (let x = 0; x < mazeW; x++) {
            if (!fogOfWar[y] || !fogOfWar[y][x]) continue;

            const cIdx = y * mazeW + x;
            const isExplored = (cIdx < MAX_MINIMAP_TILES && exploredCells[cIdx] === 1) || (visitedTiles[y] && visitedTiles[y][x]);

            if (maze[y][x] === 1) {
                minimapCtx.fillStyle = currentLevel % 2 === 1 ? '#3a2a26' : '#1e1512';
            } else {
                if (isExplored) {
                    minimapCtx.fillStyle = currentLevel % 2 === 1 ? '#7a5a4e' : '#4d3931';
                } else {
                    minimapCtx.fillStyle = currentLevel % 2 === 1 ? '#3d2f2b' : '#221915';
                }
            }
            minimapCtx.fillRect(ox + x * scale, oy + y * scale, scale, scale);

            // Simpul jejak berpendar lembut di koridor yang sudah dilalui
            if (maze[y][x] === 0 && isExplored && scale >= 2.5) {
                minimapCtx.fillStyle = currentLevel % 2 === 1 ? 'rgba(255, 175, 130, 0.45)' : 'rgba(0, 240, 255, 0.35)';
                minimapCtx.fillRect(ox + x * scale + scale * 0.35, oy + y * scale + scale * 0.35, scale * 0.3, scale * 0.3);
            }
        }
    }

    // 4. Zona Bahaya: Highlight Jebakan (Traps)
    if (typeof traps !== 'undefined' && traps.length) {
        traps.forEach(tr => {
            if (fogOfWar[tr.gy] && fogOfWar[tr.gy][tr.gx]) {
                minimapCtx.fillStyle = '#f59e0b';
                minimapCtx.fillRect(ox + tr.gx * scale, oy + tr.gy * scale, scale, scale);
                minimapCtx.fillStyle = '#b45309';
                minimapCtx.fillRect(ox + tr.gx * scale + scale * 0.3, oy + tr.gy * scale + scale * 0.3, scale * 0.4, scale * 0.4);
            }
        });
    }

    // 3. Monster Blip Radar: Merah Berkedip
    const monsterBlink = Math.sin(Date.now() / 140) > -0.2;
    monsters.forEach(m => {
        if (m.hp <= 0) return;
        const mx = Math.floor(m.x / CELL);
        const my = Math.floor(m.y / CELL);
        if (fogOfWar[my] && fogOfWar[my][mx]) {
            minimapCtx.fillStyle = monsterBlink ? '#ef4444' : (m.color || '#dc2626');
            minimapCtx.fillRect(ox + mx * scale - 1, oy + my * scale - 1, 3.5, 3.5);
        }
    });

    // Operatif Player Indicator
    minimapCtx.fillStyle = '#ff8a3d';
    const px = Math.floor(player.x / CELL);
    const py = Math.floor(player.y / CELL);
    minimapCtx.fillRect(ox + px * scale - 1, oy + py * scale - 1, 4, 4);

    // Artefak & Tracking Terdekat
    let nearestUncollected = null;
    let nearestDist = 999999;
    artifacts.forEach(a => {
        if (!a.collected) {
            const d = Math.hypot(a.gx - px, a.gy - py);
            if (d < nearestDist) { nearestDist = d; nearestUncollected = a; }
            if (fogOfWar[a.gy] && fogOfWar[a.gy][a.gx]) {
                minimapCtx.fillStyle = a.type.color;
                minimapCtx.fillRect(ox + a.gx * scale - 1, oy + a.gy * scale - 1, 3, 3);
            }
        }
    });

    // Pintu Keluar
    const exitOpen = coinsCollected >= artifacts.length;
    if (exitPos && fogOfWar[exitPos.gy] && fogOfWar[exitPos.gx]) {
        minimapCtx.fillStyle = exitOpen ? '#2ecc71' : '#7f8c8d';
        minimapCtx.fillRect(ox + exitPos.gx * scale - 2, oy + exitPos.gy * scale - 2, 5, 5);
    }

    // 2. Indikator Arah Ping (Edge Chevrons)
    if (exitOpen && exitPos) {
        drawMinimapEdgeChevron(exitPos.gx, exitPos.gy, '#2ecc71', true, scale, ox, oy);
    } else if (nearestUncollected) {
        drawMinimapEdgeChevron(nearestUncollected.gx, nearestUncollected.gy, '#f1c40f', false, scale, ox, oy);
    }

    // Data Discs, Barrels, Med-Pods
    if (typeof dataDiscs !== 'undefined' && dataDiscs.length) {
        dataDiscs.forEach(d => {
            if (!d.collected && fogOfWar[d.gy] && fogOfWar[d.gy][d.gx]) {
                minimapCtx.fillStyle = '#00f0ff';
                minimapCtx.fillRect(ox + d.gx * scale - 1, oy + d.gy * scale - 1, 3, 3);
            }
        });
    }
    if (typeof barrels !== 'undefined' && barrels.length) {
        barrels.forEach(b => {
            if (!b.exploded && fogOfWar[b.gy] && fogOfWar[b.gy][b.gx]) {
                minimapCtx.fillStyle = '#ef4444';
                minimapCtx.fillRect(ox + b.gx * scale - 1, oy + b.gy * scale - 1, 2, 2);
            }
        });
    }
    if (typeof medPods !== 'undefined' && medPods.length) {
        medPods.forEach(pod => {
            if (!pod.used && fogOfWar[pod.gy] && fogOfWar[pod.gy][pod.gx]) {
                minimapCtx.fillStyle = '#2ecc71';
                minimapCtx.fillRect(ox + pod.gx * scale - 1, oy + pod.gy * scale - 1, 3, 3);
            }
        });
    }

    // Animated Diegetic Radar Beam Sweep
    const radarTime = Date.now() / 1200;
    const rAngle = (radarTime * Math.PI) % (Math.PI * 2);
    const rpx = ox + (player.x / CELL) * scale;
    const rpy = oy + (player.y / CELL) * scale;
    minimapCtx.save();

    const sweepGradient = minimapCtx.createRadialGradient(rpx, rpy, 2, rpx, rpy, 65);
    sweepGradient.addColorStop(0, 'rgba(0, 240, 255, 0.28)');
    sweepGradient.addColorStop(1, 'rgba(0, 240, 255, 0)');
    minimapCtx.fillStyle = sweepGradient;
    minimapCtx.beginPath();
    minimapCtx.moveTo(rpx, rpy);
    minimapCtx.arc(rpx, rpy, 65, rAngle - 0.45, rAngle);
    minimapCtx.closePath();
    minimapCtx.fill();

    minimapCtx.strokeStyle = 'rgba(0, 240, 255, 0.85)';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.beginPath();
    minimapCtx.moveTo(rpx, rpy);
    minimapCtx.lineTo(rpx + Math.cos(rAngle) * 65, rpy + Math.sin(rAngle) * 65);
    minimapCtx.stroke();

    // 5. Minimap Pulse Saat Danger (HP < 30%)
    const isDangerHp = player.hp < player.maxHp * 0.30;
    if (isDangerHp) {
        const dPulse = 0.5 + Math.sin(Date.now() / 140) * 0.5;
        minimapCtx.strokeStyle = `rgba(239, 68, 68, ${0.5 + dPulse * 0.5})`;
        minimapCtx.lineWidth = 2.4;
        minimapCtx.shadowColor = '#ef4444';
        minimapCtx.shadowBlur = 8;
        minimapCtx.strokeRect(ox - 1, oy - 1, mazeW * scale + 2, mazeH * scale + 2);
    } else {
        const borderPulse = 0.5 + Math.sin(Date.now() / 400) * 0.5;
        minimapCtx.strokeStyle = `rgba(0, 240, 255, ${0.4 + borderPulse * 0.4})`;
        minimapCtx.lineWidth = 1.6;
        minimapCtx.strokeRect(ox - 1, oy - 1, mazeW * scale + 2, mazeH * scale + 2);
    }
    minimapCtx.restore();
}

function drawLightModeEffects() {
    if (currentLevel % 2 !== 1) return;

    const time = Date.now() / 1000;
    ctx.fillStyle = `rgba(255, 70, 30, ${0.03 + Math.sin(time * 2) * 0.012})`;
    ctx.fillRect(0, 0, W, H);
}

function renderGame() {
    let shakeX = 0, shakeY = 0;
    if (screenShake > 0) {
        shakeX = (Math.random() - 0.5) * screenShake * 2;
        shakeY = (Math.random() - 0.5) * screenShake * 2;
    }

    // Alih ke buffer pixel: seluruh pass dunia di bawah digambar kecil.
    // Crosshair & minimap digambar belakangan di canvas utama (tetap tajam).
    const keepW = W, keepH = H;
    W = PW; H = PH; ctx = pctx;
    ctx.save();

    // Zoom out kamera saat level 15 (The Monolith) agar arena terasa megah & raksasa
    const zoom = getGameZoom();
    if (zoom !== 1.0) {
        ctx.translate(W / 2, H / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-W / 2, -H / 2);
    }

    ctx.fillStyle = currentLevel % 2 === 1 ? '#160709' : '#050309';
    ctx.fillRect(-W * 2, -H * 2, W * 5, H * 5);

    drawMaze();
    drawDecals();
    drawThermalTrails();
    drawGasClouds();
    drawBrassCasings();
    drawProjectiles();
    drawMonsters();
    drawShockwaves();
    drawArtifacts();
    drawMedPods();
    drawExit();
    drawWreckedRobot();
    drawTraps();
    drawPlayer();
    drawMotionTracker();
    drawParticles();
    drawSpores();
    drawFloatingTexts();
    drawDarkModeOverlay();
    drawLightModeEffects();
    drawDirectionArrow();

    ctx.restore();

    // Kembali ke canvas utama + upscale tanpa smoothing = chunky pixel art.
    // Screen shake diterapkan di sini agar gerakannya tetap smooth.
    ctx = mainCtx; W = keepW; H = keepH;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(pix, shakeX, shakeY, W, H);

    // VHS Horror Chromatic Glitch bila monster Vita Carnis mendekati pemain
    if (typeof closestMonsterDist !== 'undefined' && closestMonsterDist < 4.5 * CELL && Math.random() < 0.4) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18;
        const glitchOffset = (Math.random() - 0.5) * 8;
        ctx.drawImage(pix, shakeX + glitchOffset, shakeY, W, H);
        ctx.restore();
    }

    if (hurtFlash > 0) {
        const hg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
        hg.addColorStop(0, 'rgba(0,0,0,0)');
        hg.addColorStop(1, `rgba(140, 8, 8, ${0.5 * (hurtFlash / 8)})`);
        ctx.fillStyle = hg;
        ctx.fillRect(0, 0, W, H);
    }

    if (player && player.poisonTimer > 0) {
        const pg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
        pg.addColorStop(0, 'rgba(0,0,0,0)');
        pg.addColorStop(1, 'rgba(16, 185, 129, 0.28)');
        ctx.fillStyle = pg;
        ctx.fillRect(0, 0, W, H);
    }
    if (player && player.burnTimer > 0) {
        const bg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
        bg.addColorStop(0, 'rgba(0,0,0,0)');
        bg.addColorStop(1, 'rgba(249, 115, 22, 0.28)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
    }
    if (player && player.freezeTimer > 0) {
        const fg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
        fg.addColorStop(0, 'rgba(0,0,0,0)');
        fg.addColorStop(1, 'rgba(56, 189, 248, 0.25)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, W, H);
    }

    drawEKG();
}

function demoUpdate() {
    let target = null, bd = Infinity;
    artifacts.forEach(a => {
        if (!a.collected && dist(a, player) < bd) {
            bd = dist(a, player);
            target = a;
        }
    });
    if (!target && exitPos) target = exitPos;

    if (target) {
        const ang = Math.atan2(target.y - player.y, target.x - player.x);
        moveEntity(player, Math.cos(ang) * player.speed, Math.sin(ang) * player.speed);
        player.facing = ang;
        playerFootstepDist = (playerFootstepDist || 0) + player.speed;
        if (playerFootstepDist > 30) {
            playerFootstepDist = 0;
            sFootstep();
        }
    }

    let best = null, range = 44;
    monsters.forEach(m => {
        if (m.hp > 0 && dist(m, player) < range) {
            range = dist(m, player);
            best = m;
        }
    });
    if (best) {
        playerAttack();
    }

    artifacts.forEach(a => {
        if (!a.collected && dist(a, player) < 22) {
            a.collected = true;
            coinsCollected++;
            addParticle(a.x, a.y, a.type.color, 18, 5, 35);
            player.hp = Math.min(player.maxHp, player.hp + 8);
        }
    });

    if (exitPos && dist(player, exitPos) < 26 && coinsCollected >= artifacts.length) {
        initLevel(0);
        return;
    }

    player.hp = player.maxHp;
    player.invincible = 60;
    if (attackCooldown > 0) attackCooldown--;

    const pmx = Math.floor(player.x / CELL);
    const pmy = Math.floor(player.y / CELL);
    const viewDist = 6;
    for (let y = Math.max(0, pmy - viewDist); y < Math.min(mazeH, pmy + viewDist + 1); y++) {
        for (let x = Math.max(0, pmx - viewDist); x < Math.min(mazeW, pmx + viewDist + 1); x++) {
            if (Math.abs(x - pmx) + Math.abs(y - pmy) <= viewDist) {
                fogOfWar[y][x] = true;
            }
        }
    }

    updateMonsters();
    updateProjectiles();
    updateThermalTrails();
    updateShockwaves();
    updateGasClouds();
    updateBrassCasings();
    updateTraps();
    updateParticles();
    floatingTexts = floatingTexts.filter(t => t.life-- > 0);

screenShake = Math.max(0, screenShake - 1);
    hurtFlash = Math.max(0, hurtFlash - 1);
}

let closestMonsterDist = 999999;
function updateMonsterProximityAndHeartbeat() {
    closestMonsterDist = 999999;
    if (!monsters || !player || menuDemo) return;
    monsters.forEach(m => {
        if (m.hp > 0) {
            const d = Math.hypot(m.x - player.x, m.y - player.y);
            if (d < closestMonsterDist) closestMonsterDist = d;
        }
    });

    // Geiger radiation & bio-anomaly clicks
    if (closestMonsterDist < 5.5 * CELL && Math.random() < (1 - closestMonsterDist / (5.5 * CELL)) * 0.42) {
        sGeigerClick();
    }

    const now = Date.now();
    const interval = closestMonsterDist < 2.8 * CELL ? 400 : (closestMonsterDist < 5.5 * CELL ? 780 : 0);
    if (interval > 0 && now - lastHeartbeatTime > interval) {
        lastHeartbeatTime = now;
        const intensity = Math.max(0, 1 - (closestMonsterDist / (5.5 * CELL)));
        playOrganicHeartbeat(intensity);
        if (closestMonsterDist < 3.2 * CELL) {
            addShake(Math.round((1 - closestMonsterDist / (3.2 * CELL)) * 3));
        }
    }
}

// ---- Loop game dengan "error boundary" ----
// Tanpa penjaga ini, satu exception di jalur update/render membuat baris
// requestAnimationFrame(gameLoop) di akhir tidak pernah tercapai → layar membeku
// permanen (persis gejala "crash" yang dilaporkan pemain). Wrapper memastikan
// frame berikutnya SELALU dijadwalkan, sekaligus mencatat error aslinya ke konsol
// agar akar masalah bisa dilacak dengan cepat.
let _loopErrCount = 0;
let _loopErrLastMsg = '';
function reportLoopError(err) {
    _loopErrCount++;
    const msg = (err && err.message) ? err.message : String(err);
    // Cegah banjir konsol bila error yang sama berulang tiap frame.
    if (msg !== _loopErrLastMsg || _loopErrCount % 120 === 1) {
        console.error('[VITA] Error di frame game — loop tetap berjalan (kemunculan #' + _loopErrCount + '):', err);
    }
    _loopErrLastMsg = msg;
}

function gameLoop() {
    try {
        gameLoopFrame();
    } catch (err) {
        reportLoopError(err);
    }
    requestAnimationFrame(gameLoop);
}

function gameLoopFrame() {
    const gv = hudEl('gameView');
    if (document.hidden || (gv && gv.style.display === 'none')) {
        return;
    }
    if (gameState === 'playing') {
        if (hitStop > 0) {
            // Hit-stop: dunia beku sesaat, tapi tetap render + goyangan meluruh.
            hitStop--;
            if (screenShake > 0) screenShake--;
            renderGame();
            drawCrosshair();
            drawMinimap();
            updateUI();
            return;
        }
        playAmbientDrone();
        startProceduralOST();
        updatePlayer();
        updateMonsters();
        updateProjectiles();
        updateThermalTrails();
        updateShockwaves();
        updateGasClouds();
        updateBrassCasings();
        updateTraps();
        updateParticles();
        updateSpores();
        updateMonsterProximityAndHeartbeat();

        // Adrenaline combo timer decay
        if (comboTimer > 0) {
            comboTimer--;
            if (comboTimer === 0) {
                comboCount = 0;
                hideComboBanner();
            }
        }

        let ftWrite = 0;
        for (let i = 0; i < floatingTexts.length; i++) {
            const t = floatingTexts[i];
            t.life--;
            t.y -= 0.5;
            if (t.life > 0 && ftWrite < 40) {
                floatingTexts[ftWrite++] = t;
            }
        }
        floatingTexts.length = ftWrite;

        // Kamera adaptif dengan Dynamic Look-Ahead menuju arah bidikan crosshair
        let targetCamX = player.x;
        let targetCamY = player.y;
        if (mouseActive && !menuDemo) {
            const aimDist = 65;
            targetCamX += Math.cos(player.facing) * aimDist;
            targetCamY += Math.sin(player.facing) * aimDist;
        }
        const camDist = Math.hypot(targetCamX - cameraX, targetCamY - cameraY);
        const camLerp = camDist > 200 ? 0.15 : 0.08;
        cameraX += (targetCamX - cameraX) * camLerp;
        cameraY += (targetCamY - cameraY) * camLerp;

        const loopNow = performance.now();
        perfFrameTime = loopNow - perfLastTime;
        perfLastTime = loopNow;
        perfFrameCount++;
        if (perfFrameCount % 15 === 0) {
            perfFps = Math.min(60, 1000 / Math.max(1, perfFrameTime));
            if (settings && settings.showFps) {
                const fpsEl = hudEl('fpsCounter');
                if (fpsEl) {
                    if (fpsEl.style.display !== 'block') fpsEl.style.display = 'block';
                    setHudText(fpsEl, 'FPS: ' + Math.round(perfFps));
                }
            }
        }
        culledCount = 0;
        renderedCount = 0;

        renderGame();
        drawCrosshair();
        drawMinimap();
        if (debugOverlayOpen) drawDebugDiagnostics();
        updateUI();
        if (mouseTime > 0) { mouseTime--; if (mouseTime <= 0) mouseActive = false; }
    } else if (gameState === 'menu' && player) {
        demoUpdate();
        cameraX += (player.x - cameraX) * 0.1;
        cameraY += (player.y - cameraY) * 0.1;
        renderGame();
    }
    // 'paused' → frame terakhir dibekukan, overlay JEDA tampil di atasnya.
}

document.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;

    if (e.key === 'F3' || e.code === 'F3') {
        e.preventDefault();
        toggleDebugOverlay();
        return;
    }

    // Toggle Admin Arsenal Console via Tilde (~) / Backquote or F2
    if (e.key === '`' || e.key === '~' || e.code === 'Backquote' || e.key === 'F2' || e.code === 'F2') {
        e.preventDefault();
        if (isAdmin) {
            const aM = document.getElementById('adminArsenalModal');
            if (aM && (aM.style.display === 'flex' || aM.classList.contains('open'))) {
                closeAdminArsenalModal();
            } else {
                openAdminArsenalModal();
            }
        } else {
            openAdminLogin();
        }
        return;
    }

    // Dismiss admin arsenal modal
    const adminM = document.getElementById('adminArsenalModal');
    const isAdminMOpen = adminM && (adminM.classList.contains('open') || adminM.style.display === 'flex');
    if (isAdminMOpen && (e.key === 'Escape' || e.key === 'Esc')) {
        e.preventDefault();
        closeAdminArsenalModal();
        return;
    }

    // Dismiss lore or codex modal with Escape, Space, or Enter
    const robotM = document.getElementById('robotMemoryModal');
    const isRobotMOpen = robotM && robotM.style.display === 'flex';
    if (isRobotMOpen && (e.key === 'Escape' || e.key === 'Esc' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        closeRobotMemoryModal();
        return;
    }

    const loreM = document.getElementById('loreModal');
    const isLoreOpen = loreM && (loreM.classList.contains('open') || loreM.style.display === 'flex');
    const codexM = document.getElementById('codexModal');
    const isCodexOpen = codexM && (codexM.classList.contains('open') || codexM.style.display === 'flex');

    if (isLoreOpen && (e.key === 'Escape' || e.key === 'Esc' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        closeLoreModal();
        return;
    }
    if (isCodexOpen && (e.key === 'Escape' || e.key === 'Esc' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        closeCodexModal();
        return;
    }

    if (e.key === 'Escape' || e.key === 'Esc') {
        if (tutorialActive) {
            skipTutorial();
            return;
        }
        if (gameState === 'playing') togglePause(true);
        else if (gameState === 'paused') togglePause(false);
        return;
    }

    // Ganti senjata dengan tombol angka 1-5, Q (sebelumnya), E (berikutnya)
    if (gameState === 'playing') {
        if (['1', '2', '3', '4', '5'].includes(e.key)) {
            const slotIdx = parseInt(e.key, 10) - 1;
            switchWeapon(slotIdx);
        } else if (e.key === 'q' || e.key === 'Q') {
            cycleWeapon(true);
        } else if (e.key === 'e' || e.key === 'E') {
            if (wreckedRobot && currentLevel === 9 && player && dist(player, wreckedRobot) < 55) {
                openRobotMemoryModal();
                return;
            }
            cycleWeapon(false);
        }
    }

    if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (gameState === 'playing') playerAttack();
    }

    if (e.key === 'Shift') {
        e.preventDefault();
        doDash();
    }

    if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
        if (gameState === 'playing' || gameState === 'paused') toggleMute();
    }
});

document.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
});

window.addEventListener('wheel', e => {
    if (gameState === 'playing') {
        cycleWeapon(e.deltaY > 0);
    }
}, { passive: true });

document.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    mouseActive = true;
    mouseTime = 60;
});

isMouseDown = false;
document.addEventListener('mousedown', e => {
    if (e.target && e.target.closest && (e.target.closest('#touchUI') || e.target.closest('#weaponBar') || e.target.closest('#weaponSelectScreen'))) return;
    isMouseDown = true;
    if (gameState === 'playing') playerAttack();
});

document.addEventListener('mouseup', () => {
    isMouseDown = false;
});

// ---- Dash bersama (keyboard SHIFT & tombol sentuh) ----
function doDash() {
    if (gameState !== 'playing' || dashCooldown > 0 || !player) return;
    player.dashing = true;
    player.dashTimer = 8;
    const baseDashCd = (player && player.perkAdrenaline) ? 24 : 45;
    dashCooldown = baseDashCd;
    sDash();
    triggerHaptic('dash');
    addParticle(player.x, player.y, '#3498db', 8, 4, 15);
    if (tutorialActive && tutorialStep === 1) {
        advanceTutorialStep(1);
    }

    // Perk Kinetic EMP: Radial Stun Shockwave on Dash
    if (player && player.perkEmp) {
        addShockwave(player.x, player.y, 75, '#00e5ff', 18);
        sEMPBlast();
        if (monsters) {
            monsters.forEach(m => {
                if (m.hp > 0 && dist(m, player) < 85) {
                    m.stunTimer = Math.max(m.stunTimer || 0, 75);
                    m.hitFlash = 12;
                    attackMonster(m, player.atk * 0.4);
                    addParticle(m.x, m.y, '#00e5ff', 6, 3, 15);
                }
            });
        }
    }
}

// ---- Checkpoint adil: ulangi level saat ini, skor & waktu run dipertahankan ----
function retryLevel() {
    const ds = document.getElementById('deathScreen');
    if (ds) ds.style.display = 'none';
    const ps = document.getElementById('pauseScreen');
    if (ps) ps.classList.remove('open');
    const pro = document.getElementById('prologueScreen');
    if (pro) {
        pro.classList.remove('active', 'fade-out');
        pro.style.display = 'none';
    }
    gameState = 'playing';
    menuDemo = false;
    isMouseDown = false;
    keys = {};
    if (typeof touchMove !== 'undefined') {
        touchMove.active = false;
        touchMove.dx = 0;
        touchMove.dy = 0;
    }
    hitStop = 0;
    screenShake = 0;
    hurtFlash = 0;
    levelTransition = false;
    showHUD();
    hideCursor();
    initLevel(currentLevel);
}

// ---- Bisukan / nyalakan suara cepat (tombol M) ----
let prevVolume = 70;
function toggleMute() {
    ensureAudio();
    const cur = Math.round(Number(settings.volume));
    if (cur > 0) {
        prevVolume = cur;
        setMasterVolume(0);
        announceAdmin(tt('muted_on'));
    } else {
        setMasterVolume(prevVolume > 0 ? prevVolume : 70);
        announceAdmin(tt('muted_off'));
    }
    const gv = document.getElementById('gVolume');
    if (gv) gv.value = settings.volume;
}

// ---- Jeda otomatis saat tab disembunyikan / fokus hilang ----
document.addEventListener('visibilitychange', () => {
    if (document.hidden && gameState === 'playing') togglePause(true);
});
window.addEventListener('blur', () => {
    if (gameState === 'playing') togglePause(true);
});

// ---- Kontrol sentuh (mobile/tablet): joystick + tombol kustom ----
const TOUCH_LAYOUT_KEY = 'vita_touch_layout';
let isEditingTouchLayout = false;
let touchLayoutBackup = null;

function getStoredTouchLayout() {
    try {
        const raw = localStorage.getItem(TOUCH_LAYOUT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}

function applyTouchStyle() {
    const ui = document.getElementById('touchUI');
    if (!ui) return;
    const scale = (settings.touchScale || 100) / 100;
    const opacity = (settings.touchOpacity || 85) / 100;
    ui.style.setProperty('--touch-scale', scale);
    ui.style.setProperty('--touch-opacity', opacity);
}

function getTouchElementsMap() {
    return {
        stick: document.getElementById('stickZone'),
        atk: document.getElementById('btnTouchAtk'),
        dash: document.getElementById('btnTouchDash'),
        weapon: document.getElementById('btnTouchWeapon'),
        pause: document.getElementById('btnTouchPause')
    };
}

function applyTouchLayout() {
    applyTouchStyle();
    const layout = getStoredTouchLayout();
    const map = getTouchElementsMap();

    if (!layout) {
        for (const k in map) {
            const el = map[k];
            if (el) {
                el.style.left = '';
                el.style.top = '';
                el.style.right = '';
                el.style.bottom = '';
                el.style.position = '';
            }
        }
        return;
    }

    const sw = window.innerWidth;
    const sh = window.innerHeight;

    for (const k in map) {
        const el = map[k];
        const pos = layout[k];
        if (el && pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            const w = el.offsetWidth || 64;
            const h = el.offsetHeight || 64;
            let left = (pos.x * sw) / 100;
            let top = (pos.y * sh) / 100;
            left = Math.max(8, Math.min(sw - w - 8, left));
            top = Math.max(8, Math.min(sh - h - 8, top));
            el.style.position = 'fixed';
            el.style.left = left + 'px';
            el.style.top = top + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        }
    }
}

function attachDraggableControl(el) {
    if (!el) return;
    let dragPointerId = null;
    let startX = 0, startY = 0;
    let origLeft = 0, origTop = 0;

    el.addEventListener('pointerdown', e => {
        if (!isEditingTouchLayout) return;
        e.preventDefault();
        e.stopPropagation();
        dragPointerId = e.pointerId;
        const rect = el.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        origLeft = rect.left;
        origTop = rect.top;
        el.classList.add('is-dragging');
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });

    el.addEventListener('pointermove', e => {
        if (!isEditingTouchLayout || dragPointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const sw = window.innerWidth;
        const sh = window.innerHeight;
        const w = el.offsetWidth || 64;
        const h = el.offsetHeight || 64;
        let newLeft = Math.max(8, Math.min(sw - w - 8, origLeft + dx));
        let newTop = Math.max(8, Math.min(sh - h - 8, origTop + dy));
        el.style.position = 'fixed';
        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    });

    const endDrag = e => {
        if (!isEditingTouchLayout || dragPointerId !== e.pointerId) return;
        dragPointerId = null;
        el.classList.remove('is-dragging');
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    };

    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
}

function openTouchLayoutEditor() {
    if (gameState === 'playing') togglePause(true);
    const inGameModal = document.getElementById('inGameSettingsModal');
    if (inGameModal) inGameModal.style.display = 'none';
    const hModal = document.getElementById('settingsModal');
    if (hModal) hModal.classList.remove('open');

    isEditingTouchLayout = true;
    document.body.classList.add('editing-touch-layout');
    document.body.classList.add('touch-on');

    const overlay = document.getElementById('touchLayoutEditor');
    if (overlay) overlay.style.display = 'block';

    touchLayoutBackup = getStoredTouchLayout();

    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const map = getTouchElementsMap();
    for (const k in map) {
        const el = map[k];
        if (el && (!el.style.left || !el.style.top)) {
            const rect = el.getBoundingClientRect();
            el.style.position = 'fixed';
            el.style.left = Math.max(8, Math.min(sw - el.offsetWidth - 8, rect.left)) + 'px';
            el.style.top = Math.max(8, Math.min(sh - el.offsetHeight - 8, rect.top)) + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        }
    }

    const sRange = document.getElementById('editorScaleRange');
    const sVal = document.getElementById('editorScaleVal');
    if (sRange) {
        sRange.value = settings.touchScale || 100;
        if (sVal) sVal.textContent = sRange.value + '%';
    }
    const oRange = document.getElementById('editorOpacityRange');
    const oVal = document.getElementById('editorOpacityVal');
    if (oRange) {
        oRange.value = settings.touchOpacity || 85;
        if (oVal) oVal.textContent = oRange.value + '%';
    }

    sCinematicUI('open');
}

function saveTouchLayout() {
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const map = getTouchElementsMap();
    const layout = {};

    for (const k in map) {
        const el = map[k];
        if (el) {
            const rect = el.getBoundingClientRect();
            layout[k] = {
                x: (rect.left / sw) * 100,
                y: (rect.top / sh) * 100
            };
        }
    }

    try {
        localStorage.setItem(TOUCH_LAYOUT_KEY, JSON.stringify(layout));
    } catch (_) {}

    persistSettings();

    isEditingTouchLayout = false;
    document.body.classList.remove('editing-touch-layout');
    const overlay = document.getElementById('touchLayoutEditor');
    if (overlay) overlay.style.display = 'none';

    announceAdmin(tt('layout_saved_toast'));
    sCinematicUI('save');
    applyTouchLayout();
}

function resetTouchLayout(fromEditor = false) {
    try {
        localStorage.removeItem(TOUCH_LAYOUT_KEY);
    } catch (_) {}

    settings.touchScale = 100;
    settings.touchOpacity = 85;
    persistSettings();

    applyTouchLayout();

    if (fromEditor) {
        const sRange = document.getElementById('editorScaleRange');
        const sVal = document.getElementById('editorScaleVal');
        if (sRange) { sRange.value = 100; if (sVal) sVal.textContent = '100%'; }
        const oRange = document.getElementById('editorOpacityRange');
        const oVal = document.getElementById('editorOpacityVal');
        if (oRange) { oRange.value = 85; if (oVal) oVal.textContent = '85%'; }
    }

    announceAdmin(tt('layout_reset_toast'));
    sCinematicUI('click');
}

function cancelTouchLayoutEditor() {
    try {
        if (touchLayoutBackup) {
            localStorage.setItem(TOUCH_LAYOUT_KEY, JSON.stringify(touchLayoutBackup));
        } else {
            localStorage.removeItem(TOUCH_LAYOUT_KEY);
        }
    } catch (_) {}

    applyTouchLayout();

    isEditingTouchLayout = false;
    document.body.classList.remove('editing-touch-layout');
    const overlay = document.getElementById('touchLayoutEditor');
    if (overlay) overlay.style.display = 'none';

    sCinematicUI('close');
}

function onEditorScaleInput(val) {
    settings.touchScale = Math.max(70, Math.min(140, Math.round(Number(val))));
    const sVal = document.getElementById('editorScaleVal');
    if (sVal) sVal.textContent = settings.touchScale + '%';
    applyTouchStyle();
    persistSettings();
}

function onEditorOpacityInput(val) {
    settings.touchOpacity = Math.max(30, Math.min(100, Math.round(Number(val))));
    const oVal = document.getElementById('editorOpacityVal');
    if (oVal) oVal.textContent = settings.touchOpacity + '%';
    applyTouchStyle();
    persistSettings();
}

window.addEventListener('resize', applyTouchLayout);

const touchStick = { ox: 0, oy: 0 };
function setupTouchControls() {
    const ui = document.getElementById('touchUI');
    if (!ui) return;
    const zone = document.getElementById('stickZone');
    const base = document.getElementById('stickBase');
    const knob = document.getElementById('stickKnob');
    const btnAtk = document.getElementById('btnTouchAtk');
    const btnDash = document.getElementById('btnTouchDash');
    const btnWeapon = document.getElementById('btnTouchWeapon');
    const btnPause = document.getElementById('btnTouchPause');
    ui.addEventListener('contextmenu', e => e.preventDefault());
    const R = 48;
    const setKnob = (px, py) => { if (knob) knob.style.transform = 'translate(' + px + 'px,' + py + 'px)'; };
    const resetStick = () => {
        touchMove.active = false;
        touchMove.id = -1;
        touchMove.dx = 0;
        touchMove.dy = 0;
        setKnob(0, 0);
        if (base) { base.style.left = ''; base.style.top = ''; }
    };
    if (zone) {
        zone.addEventListener('pointerdown', e => {
            if (isEditingTouchLayout) return;
            e.preventDefault();
            document.body.classList.add('touch-on');
            touchMove.active = true;
            touchMove.id = e.pointerId;
            touchStick.ox = e.clientX;
            touchStick.oy = e.clientY;
            if (base) {
                const zr = zone.getBoundingClientRect();
                base.style.left = (e.clientX - zr.left) + 'px';
                base.style.top = (e.clientY - zr.top) + 'px';
            }
            setKnob(0, 0);
            try { zone.setPointerCapture(e.pointerId); } catch (err) {}
        });
        zone.addEventListener('pointermove', e => {
            if (isEditingTouchLayout) return;
            if (!touchMove.active || e.pointerId !== touchMove.id) return;
            e.preventDefault();
            let px = e.clientX - touchStick.ox;
            let py = e.clientY - touchStick.oy;
            const len = Math.hypot(px, py);
            if (len > R) { px = px / len * R; py = py / len * R; }
            setKnob(px, py);
            if (Math.hypot(px, py) / R > 0.15) {
                touchMove.dx = px / R;
                touchMove.dy = py / R;
            } else {
                touchMove.dx = 0;
                touchMove.dy = 0;
            }
        });
        const endStick = e => {
            if (isEditingTouchLayout) return;
            if (!e || e.pointerId === touchMove.id || touchMove.id === -1) {
                resetStick();
            }
        };
        zone.addEventListener('pointerup', endStick);
        zone.addEventListener('pointercancel', endStick);
        zone.addEventListener('lostpointercapture', resetStick);
        window.addEventListener('pointerup', endStick);
        window.addEventListener('pointercancel', endStick);
    }
    if (btnAtk) btnAtk.addEventListener('pointerdown', e => {
        if (isEditingTouchLayout) return;
        e.preventDefault();
        e.stopPropagation();
        document.body.classList.add('touch-on');
        if (gameState === 'playing') playerAttack(true);
    });
    if (btnDash) btnDash.addEventListener('pointerdown', e => {
        if (isEditingTouchLayout) return;
        e.preventDefault();
        e.stopPropagation();
        document.body.classList.add('touch-on');
        doDash();
    });
    if (btnPause) btnPause.addEventListener('pointerdown', e => {
        if (isEditingTouchLayout) return;
        e.preventDefault();
        e.stopPropagation();
        if (gameState === 'playing') togglePause(true);
        else if (gameState === 'paused') togglePause(false);
    });

    // Pasang listener drag untuk setiap kontrol sentuh
    attachDraggableControl(zone);
    attachDraggableControl(btnAtk);
    attachDraggableControl(btnDash);
    attachDraggableControl(btnWeapon);
    attachDraggableControl(btnPause);

    applyTouchLayout();

    window.addEventListener('touchstart', function onFirstTouch() {
        if (settings.deviceMode !== 'pc') {
            document.body.classList.add('touch-on');
        }
        window.removeEventListener('touchstart', onFirstTouch);
    }, { passive: true });
}

function drawCrosshair() {
    if (gameState !== 'playing') return;
    const now = Date.now();
    const recoil = attackCooldown > 0 ? 5 : 0;
    const pulse = 1 + Math.sin(now / 150) * 0.08;
    const curW = (player && player.currentWeapon) ? player.currentWeapon : 'knife';

    let cx = mouseX;
    let cy = mouseY;
    if ((!mouseActive || (mouseX === 0 && mouseY === 0)) && player) {
        cx = W / 2 + Math.cos(player.facing) * 65;
        cy = H / 2 + Math.sin(player.facing) * 65;
    }

    // Target lock detection: check if cursor is pointing near an active monster
    let targetLocked = false;
    if (monsters && monsters.length) {
        const worldMx = cx - W / 2 + cameraX;
        const worldMy = cy - H / 2 + cameraY;
        for (let i = 0; i < monsters.length; i++) {
            const m = monsters[i];
            if (m.hp > 0 && Math.hypot(m.x - worldMx, m.y - worldMy) < (m.size + 18)) {
                targetLocked = true;
                break;
            }
        }
    }

    ctx.save();
    ctx.translate(cx, cy);

    const reticleColor = targetLocked ? '#ef4444' : '#00f0ff';
    const innerColor = targetLocked ? '#ff0000' : '#f1c40f';

    // 1. Minigun Heat Gauge / Reload Cooldown Ring
    if (player && curW === 'minigun') {
        const heat = Math.min(1, (player.minigunHeat || 0) / 100);
        ctx.strokeStyle = heat > 0.75 ? '#ef4444' : (heat > 0.4 ? '#f59e0b' : '#38bdf8');
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 18 + recoil, -Math.PI / 2, -Math.PI / 2 + heat * Math.PI * 2);
        ctx.stroke();
    } else if (attackCooldown > 0) {
        // Weapon Attack Recovery Arc
        const cdRatio = Math.min(1, attackCooldown / 15);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, 16 + recoil, -Math.PI / 2, -Math.PI / 2 + (1 - cdRatio) * Math.PI * 2);
        ctx.stroke();
    }

    // 2. Main Reticle Ring
    ctx.strokeStyle = reticleColor;
    ctx.shadowColor = reticleColor;
    ctx.shadowBlur = targetLocked ? 8 : 4;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, (11 + recoil) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 3. Dynamic Pips with Recoil Spread
    const innerPip = 7 + recoil;
    const outerPip = 16 + recoil;
    ctx.strokeStyle = reticleColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-outerPip, 0); ctx.lineTo(-innerPip, 0);
    ctx.moveTo(innerPip, 0); ctx.lineTo(outerPip, 0);
    ctx.moveTo(0, -outerPip); ctx.lineTo(0, -innerPip);
    ctx.moveTo(0, innerPip); ctx.lineTo(0, outerPip);
    ctx.stroke();

    // 4. Center Laser Sight Dot
    ctx.fillStyle = innerColor;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 5. Active Weapon Code Tag
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = reticleColor;
    ctx.textAlign = 'center';
    ctx.fillText(curW.toUpperCase(), 0, outerPip + 11);

    ctx.restore();
}

function showCursor() {
    document.body.classList.remove('hidemouse');
}

function hideCursor() {
    document.body.classList.add('hidemouse');
}

function showHUD() {
    document.body.classList.remove('hud-hidden');
    const tr = document.getElementById('objectiveTracker');
    if (tr) tr.style.display = 'flex';
}

function hideHUD() {
    document.body.classList.add('hud-hidden');
    const tr = document.getElementById('objectiveTracker');
    if (tr) tr.style.display = 'none';
    const tt2 = document.getElementById('tutorialToast');
    if (tt2) tt2.classList.remove('show');
}

function toggleHomePanel(id) {
    const panel = document.getElementById(id);
    if (!panel) return;
    const isOpen = panel.style.display === 'block';
    ['homeSettings', 'homeControls', 'adminLogin', 'adminPanel'].forEach(pid => {
        const el = document.getElementById(pid);
        if (el) el.style.display = 'none';
    });
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        // Pastikan panel yang dibuka terlihat (ikut ke-scroll bila menu panjang).
        requestAnimationFrame(() => {
            try { panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
        });
    }
}

// ---- ADMIN / TEST MODE (gerbang tes sisi-klien saja, bukan batas keamanan) ----
const ADMIN_CODE = '123';
let isAdmin = false;
let godmode = false;

function openAdminLogin() {
    if (isAdmin) {
        renderAdminLevels();
        toggleHomePanel('adminPanel');
        return;
    }
    const err = document.getElementById('adminLoginErr');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    const inp = document.getElementById('adminCode');
    if (inp) { inp.value = ''; setTimeout(() => { try { inp.focus(); } catch (e) {} }, 50); }
    toggleHomePanel('adminLogin');
}

function submitAdminLogin() {
    const inp = document.getElementById('adminCode');
    const err = document.getElementById('adminLoginErr');
    const val = inp ? String(inp.value || '').trim() : '';
    if (val === ADMIN_CODE) {
        isAdmin = true;
        if (err) { err.style.display = 'none'; err.textContent = ''; }
        if (inp) inp.value = '';
        renderAdminLevels();
        toggleHomePanel('adminPanel');
        applyLang();
        announceAdmin(tt('admin_welcome'));
    } else {
        if (err) { err.textContent = tt('admin_wrong'); err.style.display = 'block'; }
        sLocked();
        if (inp) { try { inp.focus(); inp.select(); } catch (e) {} }
    }
}

function adminLogout() {
    isAdmin = false;
    godmode = false;
    applyLang();
    toggleHomePanel('adminLogin');
}

function renderAdminLevels() {
    const wrap = document.getElementById('adminLevels');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (let i = 0; i < LEVELS; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        const isBoss = (i === LEVELS - 1);
        b.textContent = isBoss ? ('CH 15 (APEX)') : ('CH ' + (i + 1));
        b.title = isBoss ? tt('admin_boss') : tt('admin_chapter_fmt', { n: i + 1 });
        b.addEventListener('click', () => adminJump(i));
        wrap.appendChild(b);
    }
}

function adminStartAt(level) {
    level = Math.max(0, Math.min(LEVELS - 1, Math.floor(Number(level) || 0)));
    ensureAudio();
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('deathScreen').style.display = 'none';
    document.getElementById('winScreen').style.display = 'none';
    const ps = document.getElementById('pauseScreen');
    if (ps) ps.classList.remove('open');
    gameState = 'playing';
    menuDemo = false;
    totalKills = 0;
    totalTime = 0;
    showHUD();
    hideCursor();
    initLevel(level);
    announceAdmin(tt('admin_jump_msg') + (level + 1));
}

function adminJump(level) {
    if (!isAdmin) { openAdminLogin(); return; }
    adminStartAt(level);
}

function adminTestBoss() {
    if (!isAdmin) { openAdminLogin(); return; }
    adminStartAt(LEVELS - 1);
}

function adminUnlockExit() {
    if (!isAdmin) { openAdminLogin(); return; }
    if (!artifacts || !artifacts.length) return;
    artifacts.forEach(a => { a.collected = true; });
    coinsCollected = artifacts.length;
    sArtifact();
    updateUI();
}

function adminToggleGod() {
    if (!isAdmin) { openAdminLogin(); return; }
    godmode = !godmode;
    if (player) {
        if (godmode) { player.hp = player.maxHp; player.invincible = 999999; }
        else { player.invincible = 0; }
    }
    const b = document.getElementById('adminGodBtn');
    if (b) b.textContent = godmode ? tt('admin_god_on') : tt('admin_god_off');
}

function adminKillAll() {
    if (!isAdmin) { openAdminLogin(); return; }
    if (!monsters || !monsters.length) return;
    monsters.forEach(m => {
        if (m.hp > 0) {
            m.hp = 0;
            totalKills++;
            registerComboKill();
            addParticle(m.x, m.y, m.color, 20, 6, 35);
            gainExp(m.exp || 20);
        }
    });
    sArtifact();
    updateUI();
}

function adminEquipWeapon(key) {
    if (!isAdmin) { openAdminLogin(); return; }
    if (!WEAPONS[key]) return;
    if (!player || gameState !== 'playing') {
        adminStartAt(0);
    }
    if (!player) return;
    if (!player.weapons) player.weapons = ['knife'];
    if (!player.weapons.includes(key)) player.weapons.push(key);
    player.currentWeapon = key;
    if (!player.weaponCooldowns) player.weaponCooldowns = {};
    player.weaponCooldowns[key] = 0;
    if (key === 'minigun') player.minigunOverheat = 0;
    sWeaponUnlock();
    addParticle(player.x, player.y, '#00f0ff', 24, 6, 25);
    const wName = tt(WEAPONS[key].nameKey);
    floatingTexts.push({
        x: player.x,
        y: player.y - 30,
        text: tt('admin_weapon_equipped').replace('{w}', wName),
        color: '#00f0ff',
        life: 120,
        maxLife: 120
    });
    announceAdmin(tt('admin_weapon_equipped').replace('{w}', wName));
    updateUI();
    updateAdminModalUI();
}

function adminAddPerk(key) {
    if (!isAdmin) { openAdminLogin(); return; }
    if (!TACTICAL_PERKS[key]) return;
    if (!player || gameState !== 'playing') {
        adminStartAt(0);
    }
    if (!player) return;
    if (!player.perks) player.perks = [];
    player.perks.push(key);
    if (key === 'nano_plating') {
        player.perkNano = (player.perkNano || 0) + 1;
        player.maxHp += 50;
        player.hp = player.maxHp;
    } else if (key === 'adrenaline') {
        player.perkAdrenaline = (player.perkAdrenaline || 0) + 1;
        player.speed += 0.55;
        player.dashSpeed += 1.5;
    } else if (key === 'plasma') {
        player.perkPlasma = (player.perkPlasma || 0) + 1;
        player.atk = Math.round(player.atk * 1.3);
    } else if (key === 'cryo_vent') {
        player.perkCryo = (player.perkCryo || 0) + 1;
    } else if (key === 'vampiric') {
        player.perkVampire = (player.perkVampire || 0) + 1;
    } else if (key === 'ricochet') {
        player.perkRicochet = (player.perkRicochet || 0) + 1;
    } else if (key === 'kinetic_emp') {
        player.perkEmp = (player.perkEmp || 0) + 1;
    } else if (key === 'thermal_trail') {
        player.perkThermal = (player.perkThermal || 0) + 1;
    }
    sWeaponUnlock();
    addParticle(player.x, player.y, '#ffd700', 24, 6, 25);
    const pName = tt(TACTICAL_PERKS[key].nameKey);
    floatingTexts.push({
        x: player.x,
        y: player.y - 30,
        text: tt('admin_perk_added').replace('{p}', pName),
        color: '#ffd700',
        life: 120,
        maxLife: 120
    });
    announceAdmin(tt('admin_perk_added').replace('{p}', pName));
    updateUI();
    updateAdminModalUI();
}

function adminUnlockAllPerks() {
    if (!isAdmin) { openAdminLogin(); return; }
    if (!player || gameState !== 'playing') {
        adminStartAt(0);
    }
    if (!player) return;
    Object.keys(TACTICAL_PERKS).forEach(key => {
        adminAddPerk(key);
    });
    announceAdmin(tt('admin_all_perks_msg'));
}

function openAdminArsenalModal() {
    isAdmin = true;
    const modal = document.getElementById('adminArsenalModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('open');
    showCursor();
    updateAdminModalUI();
    renderAdminModalLevels();
}

function closeAdminArsenalModal() {
    const modal = document.getElementById('adminArsenalModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('open');
    if (gameState === 'playing') hideCursor();
}

function renderAdminModalLevels() {
    const wrap = document.getElementById('adminModalLevels');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (let i = 0; i < LEVELS; i++) {
        const b = document.createElement('button');
        b.className = 'btn-micro';
        b.type = 'button';
        const isBoss = (i === LEVELS - 1);
        b.textContent = isBoss ? 'CH 15 (BOSS)' : ('CH ' + (i + 1));
        b.title = isBoss ? tt('admin_boss') : tt('admin_chapter_fmt', { n: i + 1 });
        b.style.fontSize = '11px';
        b.style.padding = '5px 2px';
        if (i === currentLevel) {
            b.style.borderColor = '#00f0ff';
            b.style.color = '#00f0ff';
            b.style.fontWeight = 'bold';
        }
        b.addEventListener('click', () => {
            closeAdminArsenalModal();
            adminJump(i);
        });
        wrap.appendChild(b);
    }
}

function openPauseSettings() {
    const modal = document.getElementById('inGameSettingsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('open');
    showCursor();

    const vol = document.getElementById('pauseVolume');
    const volVal = document.getElementById('pauseVolumeVal');
    if (vol) {
        vol.value = Math.max(0, Math.min(100, Math.round(Number(settings.volume) || 70)));
        if (volVal) volVal.textContent = vol.value + '%';
        vol.oninput = (e) => {
            if (volVal) volVal.textContent = e.target.value + '%';
            setMasterVolume(e.target.value, true);
        };
    }

    const br = document.getElementById('pauseBrightness');
    const brVal = document.getElementById('pauseBrightnessVal');
    if (br) {
        br.value = Math.max(30, Math.min(180, Math.round(Number(settings.brightness) || 100)));
        if (brVal) brVal.textContent = br.value + '%';
        br.oninput = (e) => {
            if (brVal) brVal.textContent = e.target.value + '%';
            applyBrightness(e.target.value);
        };
    }

    const langSelect = document.getElementById('pauseLanguage');
    if (langSelect) {
        langSelect.value = lang;
        langSelect.onchange = (e) => {
            setLang(e.target.value);
        };
    }

    const diffSelect = document.getElementById('pauseDifficulty');
    if (diffSelect) {
        diffSelect.value = VITA_DIFFS.includes(settings.difficulty) ? settings.difficulty : 'normal';
        diffSelect.onchange = (e) => {
            settings.difficulty = VITA_DIFFS.includes(e.target.value) ? e.target.value : 'normal';
            persistSettings();
            if (typeof updateUI === 'function' && typeof player !== 'undefined' && player) updateUI();
        };
    }

    const qualSelect = document.getElementById('pauseQuality');
    if (qualSelect) {
        qualSelect.value = VITA_QUALS.includes(settings.quality) ? settings.quality : 'retro';
        qualSelect.onchange = (e) => {
            settings.quality = VITA_QUALS.includes(e.target.value) ? e.target.value : 'retro';
            persistSettings();
            applyPixelScale();
        };
    }
}

function closePauseSettings() {
    const modal = document.getElementById('inGameSettingsModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('open');
    if (gameState === 'playing') hideCursor();
}

function updateAdminModalUI() {
    const godBtn = document.getElementById('adminModalGodBtn');
    if (godBtn) godBtn.textContent = godmode ? tt('admin_god_on') : tt('admin_god_off');
}

function announceAdmin(msg) {
    try {
        const a = document.getElementById('levelAnnounce');
        if (!a) return;
        a.textContent = msg;
        a.style.color = '#f1c40f';
        a.style.fontSize = '28px';
        a.style.opacity = 1;
        setTimeout(() => { a.style.opacity = 0; a.style.fontSize = ''; }, 2200);
    } catch (e) {}
}

function checkContinueBtn() {
    try {
        const high = loadHigh();
        const last = Math.floor(Number(high.lastLevel));
        const btn = document.getElementById('btnContinue');
        if (!btn) return;
        if (Number.isFinite(last) && last > 0 && last < LEVELS) {
            btn.style.display = '';
            const label = (lang === 'en' ? 'CONTINUE (LV ' : 'LANJUTKAN (LV ') + (last + 1) + ')';
            const span = btn.querySelector('span');
            if (span) { span.textContent = label; }
            else { btn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24"><polygon points="5 3 13 12 5 21 5 3"/><polygon points="11 3 19 12 11 21 11 3"/></svg><span>' + label + '</span>'; }
        } else {
            btn.style.display = 'none';
        }
    } catch (e) { /* abaikan */ }
}

function continueGame(bypassDeviceCheck = false) {
    if (!bypassDeviceCheck && settings && settings.deviceMode === 'ask') {
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (window.innerWidth <= 820);
        settings.deviceMode = hasTouch ? 'mobile' : 'pc';
        if (typeof persistSettings === 'function') persistSettings();
    }
    if (settings && settings.deviceMode === 'mobile') {
        document.body.classList.add('touch-on');
        if (typeof applyTouchLayout === 'function') applyTouchLayout();
    } else if (settings && settings.deviceMode === 'pc') {
        document.body.classList.remove('touch-on');
    }
    ensureAudio();
    let last = 0;
    try { last = Math.floor(Number(loadHigh().lastLevel)) || 0; } catch (e) {}
    last = Math.max(0, Math.min(LEVELS - 1, last));
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('deathScreen').style.display = 'none';
    document.getElementById('winScreen').style.display = 'none';
    gameState = 'playing';
    menuDemo = false;
    totalKills = 0;
    totalTime = 0;
    showHUD();
    hideCursor();
    initLevel(last);
}

// ---- Prologue Cutscene System ----
let prologuePlayed = false; // Hanya putar sekali per sesi
let prologueActive = false;
let prologueTimers = [];

// Narrative data loaded from js/prologue.js (edit your story there!)

function prologueStaticFlash() {
    const el = document.getElementById('prologueStatic');
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth; // force reflow
    el.classList.add('flash');
}

function prologueTypeBlip() {
    // Tik lembut telemetri analog optik (hangat, berbobot, tanpa nada tinggi menusuk)
    try {
        const ac = ensureAudio();
        const now = ac.currentTime;
        const master = Number(settings.volume);
        if (master <= 0) return;

        const osc = ac.createOscillator();
        const g = ac.createGain();
        const f = ac.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320 + Math.random() * 80, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.028);

        f.type = 'lowpass';
        f.frequency.setValueAtTime(1400, now);

        g.gain.setValueAtTime(0.24, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

        osc.connect(f);
        f.connect(g);
        g.connect(masterGain || ac.destination);

        osc.start(now);
        osc.stop(now + 0.03);
    } catch(e) {}
}

function playPrologueCutscene(onComplete) {
    prologueActive = true;
    prologuePlayed = true;
    const lang = settings.lang || 'en';
    const L = T[lang] || T.en;

    const screen = document.getElementById('prologueScreen');
    const content = document.getElementById('prologueContent');
    const skipBtn = document.getElementById('prologueSkipBtn');
    const continueEl = document.getElementById('prologueContinue');
    const continueText = document.getElementById('prologueContinueText');

    // Set localized labels
    skipBtn.textContent = L.prologue_skip || 'SKIP ▸▸';
    continueText.textContent = L.prologue_continue || 'PRESS ANY KEY TO CONTINUE';

    // Build narrative HTML
    let html = '';
    // Header
    html += '<div class="prologue-header" id="prologueHeader">';
    html += '<span class="prologue-classify">' + (L.prologue_classify || 'TOP SECRET') + '</span>';
    html += '<span class="prologue-date">' + (L.prologue_date || 'INCIDENT LOG') + '</span>';
    html += '</div>';
    // Glitch title
    const titleText = L.prologue_title || 'FORGOTTEN SECTOR';
    html += '<div class="prologue-glitch" id="prologueGlitch" data-text="' + titleText + '">' + titleText + '</div>';
    // Script lines
    PROLOGUE_SCRIPT.forEach((line, i) => {
        const text = lang === 'id' ? line.text_id : line.text_en;
        if (line.type === 'divider') {
            html += '<div class="prologue-divider" data-idx="' + i + '">' + text + '</div>';
        } else if (line.type === 'narrator') {
            html += '<div class="prologue-line narrator" data-idx="' + i + '">' + text + '</div>';
        } else if (line.type === 'speaker') {
            html += '<div class="prologue-line speaker" data-idx="' + i + '">';
            html += '<span class="speaker-tag">' + line.speaker + '</span>';
            html += '<span class="dialogue">' + text + '</span>';
            html += '</div>';
        }
    });

    content.innerHTML = html;
    screen.classList.add('active');
    continueEl.classList.remove('visible');

    // Collect all revealable elements
    const header = document.getElementById('prologueHeader');
    const glitch = document.getElementById('prologueGlitch');
    const lines = content.querySelectorAll('.prologue-line, .prologue-divider');
    const allReveal = [header, glitch, ...lines];
    let revealIdx = 0;
    let sequenceComplete = false;

    // Clear any old timers
    prologueTimers.forEach(t => clearTimeout(t));
    prologueTimers = [];

    function revealNext() {
        if (!prologueActive) return;
        if (revealIdx >= allReveal.length) {
            sequenceComplete = true;
            continueEl.classList.add('visible');
            // Ominous cinematic brass horn / sub-resonance (Braaam horor kosmik)
            try {
                playOccultTone(55, 48, 2.4, 0.65, 'sawtooth');
                playOccultTone(82.5, 74, 2.4, 0.5, 'triangle');
                playNoiseBurst(1.8, 550, 45, 3.2, 0.4, 'lowpass');
            } catch(e) {}
            return;
        }
        const el = allReveal[revealIdx];
        if (el) {
            el.classList.add('visible');
            prologueTypeBlip();
            // Static flash & visceral sub-hit on speaker lines
            if (el.classList.contains('speaker')) {
                prologueStaticFlash();
                playOccultTone(68, 30, 0.38, 0.28, 'sine');
            }
            // Auto-scroll so newest line is visible
            try {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (e) {}
        }
        revealIdx++;
        // Timing: header/glitch reveal faster, dialogue slower
        const delay = (revealIdx <= 2) ? 1200 : (el && el.classList.contains('prologue-divider')) ? 800 : 2200;
        prologueTimers.push(setTimeout(revealNext, delay));
    }

    // Start reveal sequence after a brief darkness
    prologueTimers.push(setTimeout(() => {
        // Subterranean cinematic sub-drone atmosferik
        try {
            playOccultTone(45, 38, 3.5, 0.45, 'sine');
            playOccultTone(67.5, 60, 3.2, 0.35, 'triangle');
            playNoiseBurst(2.5, 380, 40, 3.0, 0.25, 'lowpass');
        } catch(e) {}
        revealNext();
    }, 1200));

    // Interactive advance: tap/click/key reveals next line or exits if complete
    function advanceDialogue() {
        if (!prologueActive) return;
        if (sequenceComplete) {
            endPrologue();
            return;
        }
        // Advance to next line immediately if user interacts during sequence
        prologueTimers.forEach(t => clearTimeout(t));
        prologueTimers = [];
        revealNext();
    }

    // Cleanup function
    function endPrologue() {
        if (!prologueActive) return;
        prologueActive = false;
        document.removeEventListener('keydown', onInput);
        document.removeEventListener('click', onClickContinue);
        prologueTimers.forEach(t => clearTimeout(t));
        prologueTimers = [];
        // Fade out
        screen.classList.add('fade-out');
        try { sExitOpen(); } catch(e) {}
        setTimeout(() => {
            screen.classList.remove('active', 'fade-out');
            content.innerHTML = '';
            if (typeof onComplete === 'function') onComplete();
        }, 1100);
    }

    // Skip button
    skipBtn.onclick = function(e) {
        if (e) e.stopPropagation();
        endPrologue();
    };

    // Keyboard & click interactions
    function onInput(e) {
        if (!prologueActive) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            endPrologue();
            return;
        }
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            advanceDialogue();
        }
    }
    function onClickContinue(e) {
        if (!prologueActive) return;
        // Don't trigger on skip button click
        if (e.target === skipBtn || skipBtn.contains(e.target)) return;
        advanceDialogue();
    }
    document.addEventListener('keydown', onInput);
    document.addEventListener('click', onClickContinue);
}

function startGame(bypassDeviceCheck = false) {
    if (!bypassDeviceCheck && settings && settings.deviceMode === 'ask') {
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (window.innerWidth <= 820);
        settings.deviceMode = hasTouch ? 'mobile' : 'pc';
        if (typeof persistSettings === 'function') persistSettings();
    }
    if (settings && settings.deviceMode === 'mobile') {
        document.body.classList.add('touch-on');
        if (typeof applyTouchLayout === 'function') applyTouchLayout();
    } else if (settings && settings.deviceMode === 'pc') {
        document.body.classList.remove('touch-on');
    }
    ensureAudio();
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('deathScreen').style.display = 'none';
    document.getElementById('winScreen').style.display = 'none';

    try {
        const high = loadHigh();
        delete high.savedWeapons;
        delete high.savedCurrentWeapon;
        delete high.savedPerks;
        delete high.savedExp;
        delete high.savedPLevel;
        saveHigh(high);
    } catch(e){}
    player = null;

    // Play prologue cutscene before first level (only once per session)
    if (!prologuePlayed) {
        gameState = 'cutscene';
        menuDemo = false;
        totalKills = 0;
        totalTime = 0;
        playPrologueCutscene(function() {
            // After prologue ends, start gameplay
            gameState = 'playing';
            showHUD();
            hideCursor();
            initLevel(0);
        });
    } else {
        gameState = 'playing';
        menuDemo = false;
        totalKills = 0;
        totalTime = 0;
        showHUD();
        hideCursor();
        initLevel(0);
    }
}

function restartGame() {
    const ds = document.getElementById('deathScreen');
    if (ds) ds.style.display = 'none';
    const ws = document.getElementById('winScreen');
    if (ws) ws.style.display = 'none';
    const ps = document.getElementById('pauseScreen');
    if (ps) ps.classList.remove('open');
    const pro = document.getElementById('prologueScreen');
    if (pro) {
        pro.classList.remove('active', 'fade-out');
        pro.style.display = 'none';
    }
    gameState = 'playing';
    menuDemo = false;
    totalKills = 0;
    totalTime = 0;
    isMouseDown = false;
    keys = {};
    if (typeof touchMove !== 'undefined') {
        touchMove.active = false;
        touchMove.dx = 0;
        touchMove.dy = 0;
    }
    hitStop = 0;
    screenShake = 0;
    hurtFlash = 0;
    levelTransition = false;
    showHUD();
    hideCursor();
    initLevel(0);
}

function togglePause(on) {
    const overlay = document.getElementById('pauseScreen');
    if (on) {
        gameState = 'paused';
        stopAmbientDrone();
        const secVal = document.getElementById('pauseSectorVal');
        if (secVal) secVal.textContent = (currentLevel + 1) + ' / ' + LEVELS;
        const timeVal = document.getElementById('pauseTimeVal');
        const sessionTime = totalTime + Math.floor((Date.now() - levelStartTime) / 1000);
        if (timeVal) timeVal.textContent = formatTime(sessionTime);
        const killsVal = document.getElementById('pauseKillsVal');
        if (killsVal) killsVal.textContent = totalKills;
        const loadVal = document.getElementById('pauseLoadoutVal');
        if (loadVal && player) loadVal.textContent = (player.currentWeapon || 'knife').toUpperCase();
        overlay.classList.add('open');
        showCursor();
    } else {
        gameState = 'playing';
        overlay.classList.remove('open');
        hideCursor();
    }
}

function restartFromPause() {
    document.getElementById('pauseScreen').classList.remove('open');
    restartGame();
}

function backToMenu() {
    gameState = 'menu';
    menuDemo = true;
    stopAmbientDrone();
    stopProceduralOST();
    document.getElementById('pauseScreen').classList.remove('open');
    hideHUD();
    showCursor();
    document.getElementById('startScreen').style.display = 'flex';
    initLevel(0);
    const gv = document.getElementById('gameView');
    const hv = document.getElementById('homeView');
    if (gv) gv.style.display = 'none';
    if (hv) hv.style.display = '';
    document.body.classList.remove('game-on');
}

const adminCodeInput = document.getElementById('adminCode');
if (adminCodeInput) {
    adminCodeInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitAdminLogin(); }
    });
}

document.getElementById('gVolume').addEventListener('input', e => setMasterVolume(e.target.value, true));
document.getElementById('gVolume').value = Math.max(0, Math.min(100, Math.round(Number(settings.volume) || 70)));
document.getElementById('gBrightness').addEventListener('input', e => applyBrightness(e.target.value));
document.getElementById('gBrightness').value = Math.max(30, Math.min(180, Math.round(Number(settings.brightness) || 100)));

const langSel = document.getElementById('gLanguage');
if (langSel) {
    langSel.value = lang;
    langSel.addEventListener('change', e => setLang(e.target.value));
}

const diffSel = document.getElementById('gDifficulty');
if (diffSel) {
    diffSel.value = VITA_DIFFS.includes(settings.difficulty) ? settings.difficulty : 'normal';
    diffSel.addEventListener('change', e => {
        settings.difficulty = VITA_DIFFS.includes(e.target.value) ? e.target.value : 'normal';
        persistSettings();
        if (typeof updateUI === 'function' && typeof player !== 'undefined' && player) updateUI();
    });
}

const qualSelInit = document.getElementById('gQuality');
if (qualSelInit) {
    qualSelInit.value = VITA_QUALS.includes(settings.quality) ? settings.quality : 'retro';
    qualSelInit.addEventListener('change', e => {
        settings.quality = VITA_QUALS.includes(e.target.value) ? e.target.value : 'retro';
        persistSettings();
        applyPixelScale();
    });
}

function openPauseSettings() {
    const m = document.getElementById('inGameSettingsModal');
    if (!m) return;
    syncPauseSettingsInputs();
    m.style.display = 'flex';
    sCinematicUI('open');
}

function closePauseSettings() {
    const m = document.getElementById('inGameSettingsModal');
    if (m) m.style.display = 'none';
    sCinematicUI('close');
}

function syncPauseSettingsInputs() {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const setChecked = (id, bool) => { const el = document.getElementById(id); if (el) el.checked = !!bool; };

    setVal('pauseVolume', settings.volume);
    setText('pauseVolumeVal', settings.volume + '%');

    setVal('pauseSfx', settings.sfxVolume);
    setText('pauseSfxVal', settings.sfxVolume + '%');

    setVal('pauseBgm', settings.bgmVolume);
    setText('pauseBgmVal', settings.bgmVolume + '%');

    setChecked('pauseMuted', settings.muted);
    setVal('pauseDeviceMode', settings.deviceMode || 'ask');
    setChecked('pauseAutoAim', settings.autoAim !== false);
    setChecked('pauseHaptic', settings.haptic !== false);

    setVal('pauseTouchScale', settings.touchScale || 100);
    setText('pauseTouchScaleVal', (settings.touchScale || 100) + '%');

    setVal('pauseTouchOpacity', settings.touchOpacity || 85);
    setText('pauseTouchOpacityVal', (settings.touchOpacity || 85) + '%');

    setVal('pauseBrightness', settings.brightness || 100);
    setText('pauseBrightnessVal', (settings.brightness || 100) + '%');

    setVal('pauseQuality', settings.quality || 'retro');
    setChecked('pauseScreenShake', settings.screenShake !== false);
    setChecked('pauseMinimap', settings.showMinimap !== false);
    setChecked('pauseShowFps', !!settings.showFps);

    setVal('pauseLanguage', settings.lang || 'id');
    setVal('pauseDifficulty', settings.difficulty || 'normal');
}

function setupPauseSettingsListeners() {
    const onInput = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('input', fn); };
    const onChange = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('change', fn); };

    onInput('pauseVolume', e => {
        setMasterVolume(e.target.value, true);
        const valEl = document.getElementById('pauseVolumeVal');
        if (valEl) valEl.textContent = e.target.value + '%';
        const gV = document.getElementById('gVolume');
        if (gV) gV.value = e.target.value;
    });

    onInput('pauseSfx', e => {
        const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value))));
        settings.sfxVolume = v;
        const valEl = document.getElementById('pauseSfxVal');
        if (valEl) valEl.textContent = v + '%';
        persistSettings();
        blip(720, 360, 0.08, 'sine', 0.4);
    });

    onInput('pauseBgm', e => {
        const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value))));
        settings.bgmVolume = v;
        const valEl = document.getElementById('pauseBgmVal');
        if (valEl) valEl.textContent = v + '%';
        persistSettings();
        if (ambientGain && audioCtx) ambientGain.gain.setValueAtTime(0.04 * getBgmGain(), audioCtx.currentTime);
    });

    onChange('pauseMuted', e => {
        settings.muted = e.target.checked;
        persistSettings();
        setMasterVolume(settings.volume, false);
    });

    onChange('pauseDeviceMode', e => {
        const mode = e.target.value;
        settings.deviceMode = mode;
        persistSettings();
        if (mode === 'mobile') {
            document.body.classList.add('touch-on');
            applyTouchLayout();
        } else if (mode === 'pc') {
            document.body.classList.remove('touch-on');
        }
        if (typeof updateStartScreenDevicePill === 'function') updateStartScreenDevicePill(mode, settings.lang);
    });

    onChange('pauseAutoAim', e => {
        settings.autoAim = e.target.checked;
        persistSettings();
    });

    onChange('pauseHaptic', e => {
        settings.haptic = e.target.checked;
        persistSettings();
        if (e.target.checked) triggerHaptic('dash');
    });

    onInput('pauseTouchScale', e => {
        settings.touchScale = Math.max(70, Math.min(140, Math.round(Number(e.target.value))));
        const valEl = document.getElementById('pauseTouchScaleVal');
        if (valEl) valEl.textContent = settings.touchScale + '%';
        applyTouchStyle();
        persistSettings();
    });

    onInput('pauseTouchOpacity', e => {
        settings.touchOpacity = Math.max(30, Math.min(100, Math.round(Number(e.target.value))));
        const valEl = document.getElementById('pauseTouchOpacityVal');
        if (valEl) valEl.textContent = settings.touchOpacity + '%';
        applyTouchStyle();
        persistSettings();
    });

    onInput('pauseBrightness', e => {
        applyBrightness(e.target.value);
        const valEl = document.getElementById('pauseBrightnessVal');
        if (valEl) valEl.textContent = e.target.value + '%';
        const gB = document.getElementById('gBrightness');
        if (gB) gB.value = e.target.value;
    });

    onChange('pauseQuality', e => {
        settings.quality = VITA_QUALS.includes(e.target.value) ? e.target.value : 'retro';
        persistSettings();
        applyPixelScale();
        const gQ = document.getElementById('gQuality');
        if (gQ) gQ.value = settings.quality;
    });

    onChange('pauseScreenShake', e => {
        settings.screenShake = e.target.checked;
        persistSettings();
    });

    onChange('pauseMinimap', e => {
        settings.showMinimap = e.target.checked;
        persistSettings();
        const mm = document.getElementById('minimap');
        if (mm) mm.style.display = settings.showMinimap ? '' : 'none';
    });

    onChange('pauseShowFps', e => {
        settings.showFps = e.target.checked;
        persistSettings();
        const fpsEl = document.getElementById('fpsCounter');
        if (fpsEl) fpsEl.style.display = settings.showFps ? 'block' : 'none';
    });

    onChange('pauseLanguage', e => {
        setLang(e.target.value);
        const gL = document.getElementById('gLanguage');
        if (gL) gL.value = e.target.value;
    });

    onChange('pauseDifficulty', e => {
        settings.difficulty = VITA_DIFFS.includes(e.target.value) ? e.target.value : 'normal';
        persistSettings();
        const gD = document.getElementById('gDifficulty');
        if (gD) gD.value = settings.difficulty;
        if (typeof updateUI === 'function' && typeof player !== 'undefined' && player) updateUI();
    });
}
setupPauseSettingsListeners();

function syncSettingsFromStorage() {
    try {
        const raw = JSON.parse(localStorage.getItem(VITA_SAVE_KEY) || '{}');
        settings = sanitizeSettings(raw);
    } catch (e) {
        settings = sanitizeSettings({});
    }
    lang = (settings.lang === 'en') ? 'en' : 'id';
    applyLang();

    setMasterVolume(settings.volume, false);
    applyBrightness(settings.brightness);

    const gLang = document.getElementById('gLanguage');
    if (gLang) gLang.value = settings.lang;
    const gDiff = document.getElementById('gDifficulty');
    if (gDiff) gDiff.value = settings.difficulty;
    const gQual = document.getElementById('gQuality');
    if (gQual) gQual.value = settings.quality;
    const hQual = document.getElementById('homeQuality');
    if (hQual) hQual.value = settings.quality;
    applyPixelScale();

    const hLang = document.getElementById('homeLanguage');
    if (hLang) hLang.value = settings.lang;
    const hDiff = document.getElementById('homeDifficulty');
    if (hDiff) hDiff.value = settings.difficulty;

    // Sinkronkan mini-map & FPS
    const mm = document.getElementById('minimap');
    if (mm) mm.style.display = (settings.showMinimap !== false) ? '' : 'none';
    const fpsEl = document.getElementById('fpsCounter');
    if (fpsEl) fpsEl.style.display = (settings.showFps) ? 'block' : 'none';

    // Sinkronkan mode perangkat (PC vs Mobile)
    if (settings.deviceMode === 'mobile') {
        document.body.classList.add('touch-on');
    } else if (settings.deviceMode === 'pc') {
        document.body.classList.remove('touch-on');
    }

    applyTouchLayout();
    applyTouchStyle();
    syncPauseSettingsInputs();
    if (typeof updateStartScreenDevicePill === 'function') updateStartScreenDevicePill(settings.deviceMode, settings.lang);

    checkContinueBtn();
    if (typeof player !== 'undefined' && player) updateUI();
}

// Easter Egg: Triple click startEyebrow to reveal admin button
let ebClicks = 0;
let ebTimer = null;
const ebEl = document.getElementById('startEyebrow');
if (ebEl) {
    ebEl.style.cursor = 'pointer';
    ebEl.addEventListener('click', () => {
        ebClicks++;
        clearTimeout(ebTimer);
        ebTimer = setTimeout(() => { ebClicks = 0; }, 1200);
        if (ebClicks >= 3) {
            ebClicks = 0;
            if (typeof openAdminLogin === 'function') openAdminLogin();
            sCinematicUI('save');
        }
    });
}

function setupDeathScreenControls() {
    const btnRetryLvl = document.getElementById('btnRetryLevel');
    if (btnRetryLvl) {
        btnRetryLvl.onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            retryLevel();
        };
    }
    const btnRetry = document.getElementById('btnRetry');
    if (btnRetry) {
        btnRetry.onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            restartGame();
        };
    }
}
window.retryLevel = retryLevel;
window.restartGame = restartGame;

setupTouchControls();
setupDeathScreenControls();
syncSettingsFromStorage();
// Sinkron dua arah: bila panel Hub (home.js) mengubah volume/bahasa/difficulty
// di tab yang sama, game ikut sinkron tanpa reload (audio + UI tetap konsisten).
window.addEventListener('storage', (e) => {
    if (e && e.key === VITA_SAVE_KEY) syncSettingsFromStorage();
});
if (typeof applyProfileUI === 'function') applyProfileUI();
// Diagnostik global: catat error tak tertangkap (termasuk dari event handler &
// promise) dengan penanda [VITA] agar akar masalah mudah dilacak saat dilaporkan.
// Murni logging — tidak mengubah alur permainan.
window.addEventListener('error', (e) => {
    console.error('[VITA] Error tak tertangkap:', (e && (e.error || e.message)) || e);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('[VITA] Promise ditolak tanpa penanganan:', e && e.reason);
});
initLevel(0);
gameLoop();

// ============================================================
// VITA v2.0 INDUSTRIAL MODULE (procedural-only, shared-buffer safe)
// Objective tracker + tutorial FTUE + damage vignette + boss intro.
// Semua fungsi ber-prefix vita2* agar tidak tabrakan scope global.
// ============================================================
let vita2ToastTimer = null;
let vita2TutStage = 0;
let vita2LastDmgAt = 0;

function vita2UpdateTracker(unlocked) {
    const el = hudEl('objectiveTracker');
    const tx = hudEl('objectiveTrackerText');
    if (!el || !tx || typeof artifacts === 'undefined') return;
    if (gameState !== 'playing') {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
    }
    if (el.style.display !== 'flex') el.style.display = 'flex';
    if (unlocked) {
        setHudText(tx, tt('obj_exit'));
        el.classList.add('tracker-ready');
    } else {
        const total = artifacts.length || 0;
        const got = (typeof coinsCollected !== 'undefined') ? coinsCollected : 0;
        setHudText(tx, tt('obj_collect') + ' ' + got + '/' + total);
        el.classList.remove('tracker-ready');
    }
}

function vita2Toast(msg, ms) {
    const el = document.getElementById('tutorialToast');
    if (!el || !msg) return;
    el.textContent = msg;
    el.classList.add('show');
    if (vita2ToastTimer) clearTimeout(vita2ToastTimer);
    vita2ToastTimer = setTimeout(() => { el.classList.remove('show'); }, ms || 4200);
}

function vita2DamageVignette() {
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (now - vita2LastDmgAt < 180) return;
    vita2LastDmgAt = now;
    const el = document.getElementById('damageVignette');
    if (!el || REDUCE_MOTION) return;
    el.classList.add('on');
    setTimeout(() => { el.classList.remove('on'); }, 140);
}

function vita2MaybeTutorial() {
    if (gameState !== 'playing' || currentLevel !== 0) return;
    if (vita2TutStage === 0) {
        vita2TutStage = 1;
        vita2Toast(tt('tut_move'), 5000);
        setTimeout(() => {
            if (gameState === 'playing' && currentLevel === 0) vita2Toast(tt('tut_attack'), 5000);
        }, 6000);
    }
}

// Hook damage vignette ke hurtFlash tanpa ubah logic inti.
setInterval(() => {
    try {
        if (typeof hurtFlash !== 'undefined' && hurtFlash > 0) vita2DamageVignette();
        vita2MaybeTutorial();
        // Tutorial exit: saat semua artefak terkumpul pertama kali di level 1.
        if (gameState === 'playing' && currentLevel === 0 && typeof artifacts !== 'undefined' &&
            artifacts.length > 0 && coinsCollected >= artifacts.length && vita2TutStage === 1) {
            vita2TutStage = 2;
            vita2Toast(tt('tut_exit'), 6000);
            try { blip(520, 1040, 0.35, 'sine', 0.5); } catch (e) {}
        }
    } catch (e) {}
}, 500);


// ---- FRAME BUDGET MONITOR & DIAGNOSTICS OVERLAY ----
function drawDebugDiagnostics() {
    ctx.save();
    const boxW = 290;
    const boxH = 150;
    const boxX = 14;
    const boxY = H - boxH - 24;

    ctx.fillStyle = 'rgba(6, 10, 18, 0.94)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = '#00f0ff';
    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.textAlign = 'left';
    ctx.fillText('VITA ENGINE DIAGNOSTICS [F3]', boxX + 10, boxY + 20);

    ctx.fillStyle = perfFps >= 55 ? '#22c55e' : (perfFps >= 30 ? '#eab308' : '#ef4444');
    ctx.fillText(`FPS: ${perfFps.toFixed(1)} (${perfFrameTime.toFixed(1)}ms frame budget)`, boxX + 10, boxY + 42);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = "10px 'Courier New', monospace";
    ctx.fillText(`VIEWPORT: ${renderedCount} Rendered | ${culledCount} Culled`, boxX + 10, boxY + 64);
    ctx.fillText(`ENTITIES: M:${monsters ? monsters.length : 0} | P:${particles ? particles.length : 0} | Proj:${projectiles ? projectiles.length : 0}`, boxX + 10, boxY + 85);
    ctx.fillText(`POOLS: In-Place Compaction Active (Zero-GC)`, boxX + 10, boxY + 106);

    const aState = audioCtx ? audioCtx.state : 'off';
    ctx.fillText(`AUDIO: ${aState.toUpperCase()} | 3D Spatial Panner Active`, boxX + 10, boxY + 127);

    ctx.restore();
}
