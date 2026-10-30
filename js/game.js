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
// 'hd' (PIXEL = 1) menggambar pada resolusi perangkat (DPR) agar tajam,
// sementara skala dunia dinormalisasi supaya luas pandang tidak berubah.
const PIXEL_SCALES = { hd: 1, smooth: 2, retro: 3, chunky: 4 }; // 1 = HD tajam, 2 = halus, 3 = chunky retro, 4 = ekstra kasar
let PIXEL = 1;
// Backing store mengikuti DPR (dibatasi 2 agar hemat memori/GPU di HP DPR 3+).
let RENDER_DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
function readRenderDpr() {
    // Memberikan resolusi kristal HD di seluruh layar smartphone & desktop (DPR hingga 2.0x native)
    const dpr = window.devicePixelRatio || 1;
    return Math.max(1, Math.min(2.0, dpr));
}
// Hanya mode HD yang memakai resolusi perangkat penuh; mode pixel tetap ringan.
function getPixelDpr() {
    return PIXEL === 1 ? RENDER_DPR : 1;
}
function applyPixelScale() {
    const q = (settings && PIXEL_SCALES[settings.quality]) ? settings.quality : 'hd';
    PIXEL = PIXEL_SCALES[q];
    sizePixelBuffer();
}
const pix = document.createElement('canvas');
const pctx = pix.getContext('2d');
let PW = 0, PH = 0;
function sizePixelBuffer() {
    const pd = getPixelDpr();
    PW = Math.max(1, Math.ceil(W * pd / PIXEL));
    PH = Math.max(1, Math.ceil(H * pd / PIXEL));
    if (pix.width !== PW) pix.width = PW;
    if (pix.height !== PH) pix.height = PH;
    pctx.imageSmoothingEnabled = (PIXEL === 1);
}
// W/H selalu dalam CSS px. Backing canvas = CSS x DPR, lalu transform DPR
// dipasang sekali agar semua gambar tetap memakai koordinat CSS.
function applyCanvasSize() {
    const cssW = Math.max(1, Math.round(window.innerWidth));
    const cssH = Math.max(1, Math.round(window.innerHeight));
    RENDER_DPR = readRenderDpr();
    W = cssW;
    H = cssH;
    const bw = Math.max(1, Math.round(cssW * RENDER_DPR));
    const bh = Math.max(1, Math.round(cssH * RENDER_DPR));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    // Setiap perubahan canvas.width/height mereset seluruh state konteks.
    mainCtx.setTransform(RENDER_DPR, 0, 0, RENDER_DPR, 0, 0);
    mainCtx.imageSmoothingEnabled = false;
    sizePixelBuffer();
}
let _resizeTimer = 0;
function resize(force) {
    if (force) {
        clearTimeout(_resizeTimer);
        applyCanvasSize();
        watchRenderDpr();
        return;
    }
    // Debounce singkat: resize address-bar mobile tidak memicu alokasi beruntun.
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () {
        applyCanvasSize();
        watchRenderDpr();
    }, 120);
}
let _dprMedia = null;
function onRenderDprChange() {
    resize(true);
}
function watchRenderDpr() {
    if (!window.matchMedia) return;
    if (_dprMedia && _dprMedia.removeEventListener) {
        _dprMedia.removeEventListener('change', onRenderDprChange);
    }
    _dprMedia = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    if (_dprMedia.addEventListener) _dprMedia.addEventListener('change', onRenderDprChange);
}
resize(true);
window.addEventListener('resize', function () { resize(false); });
window.addEventListener('orientationchange', function () {
    setTimeout(function () { resize(true); }, 260);
});

const CELL = 32;
const LEVELS = 15;

let gameState = 'menu';
let currentLevel = 0;
let maze = [];
let mazeW, mazeH;
let player, monsters, particles, projectiles;
// ---- Fase 1 co-op: abstraksi pemain multi (players[] & host index 0) ----
let players = [];
let localPlayerIndex = 0;
const MAX_PLAYERS = 4;
const PLAYER_COLORS = [
    { name: 'cyan', hex: '#00f0ff', glow: 'rgba(0, 240, 255, 0.4)' },
    { name: 'amber', hex: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)' },
    { name: 'emerald', hex: '#10b981', glow: 'rgba(16, 185, 129, 0.4)' },
    { name: 'rose', hex: '#f43f5e', glow: 'rgba(244, 63, 94, 0.4)' }
];

// Co-op session state lives up here on purpose: buildLevelWorld() runs during
// the initial menu-demo initLevel(0) call at the bottom of this file, which is
// evaluated BEFORE the co-op lobby section. Declaring these further down made
// that first call throw a temporal-dead-zone ReferenceError.
let coopRoomId = null;
let isCoopHost = false;
let coopWs = null;
let coopPeers = [];
let netSnapshotInterval = 50; // ms (20Hz)
let netLastSnapshotTime = 0;

// Admin & dev flags (declared at top to prevent TDZ ReferenceError)
let isAdmin = false;
let godmode = false;

// Endless survival mode state (declared up here to avoid TDZ ReferenceError during early init/updateUI)
let isEndlessMode = false;
let endlessWave = 1;
let endlessKills = 0;
let endlessWaveCleared = false;
let endlessWaveClearTimer = 0;

function getLocalPlayer() {
    return (players && players[localPlayerIndex]) ? players[localPlayerIndex] : player;
}

function setLocalPlayerIndex(idx) {
    localPlayerIndex = Math.max(0, Math.min(MAX_PLAYERS - 1, idx | 0));
    if (players && players[localPlayerIndex]) {
        player = players[localPlayerIndex];
    }
}

function getPlayerByPeer(peerIndex) {
    return (players && players[peerIndex]) ? players[peerIndex] : null;
}

function spawnCoopPeerEntity(peerIndex, callsign, spawnX, spawnY) {
    const pIdx = Math.max(0, Math.min(MAX_PLAYERS - 1, peerIndex | 0));
    const col = PLAYER_COLORS[pIdx] || PLAYER_COLORS[0];
    return {
        id: 'p' + pIdx,
        peerIndex: pIdx,
        callsign: callsign || ('P' + (pIdx + 1)),
        x: (typeof spawnX === 'number') ? spawnX : (CELL * 1.5),
        y: (typeof spawnY === 'number') ? spawnY : (CELL * 1.5),
        hp: 100,
        maxHp: 100,
        size: 13,
        speed: 2.4,
        dashSpeed: 6.5,
        facing: 0,
        dashing: false,
        dashTimer: 0,
        dashCooldown: 0,
        downed: false,
        reviveProgress: 0,
        weapons: ['knife', 'rifle'],
        currentWeapon: 'knife',
        perks: [],
        exp: 0,
        pLevel: 1,
        invincible: 0,
        attackAnim: 0,
        color: col.hex,
        glowColor: col.glow,
        afterimages: []
    };
}
let keys = {};
let totalKills = 0;
let totalTime = 0;
let levelStartTime = 0;
let cameraX = 0, cameraY = 0;
// ---- Zoom tampilan (aksesibilitas + kenyamanan HP) ----
// Nilai hanya mengubah luas pandang, bukan ketajaman: quality mengatur resolusi,
// viewZoom mengatur seberapa jauh kamera melihat dunia.
const VITA_ZOOM_KEY = 'vita_zoom';
const ZOOM_MIN = 0.65;
const ZOOM_MAX = 1.65;
const ZOOM_STEP = 0.1;
let viewZoom = 1;
try {
    const _savedZoom = parseFloat(localStorage.getItem(VITA_ZOOM_KEY));
    if (isFinite(_savedZoom) && _savedZoom > 0) {
        viewZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, _savedZoom));
    }
} catch (e) { /* localStorage bisa diblokir (mode privat) */ }
function getGameZoom() {
    const levelFactor = (currentLevel === LEVELS - 1) ? 0.60 : 1.0;
    return ((3 * getPixelDpr()) / PIXEL) * levelFactor * viewZoom;
}
// Satuan dunia per 1 CSS px di layar. Dipakai untuk menerjemahkan posisi
// mouse/touch (CSS px) menjadi koordinat dunia saat membidik.
function getWorldPerCss() {
    return getPixelDpr() / (PIXEL * getGameZoom());
}
function applyViewZoom(next, persist) {
    const z = Number(next);
    if (!isFinite(z)) return;
    viewZoom = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 100) / 100;
    const lbl = document.getElementById('zoomLevelText');
    if (lbl) lbl.textContent = viewZoom.toFixed(2) + 'x';
    const hud = document.getElementById('zoomHud');
    if (hud) {
        const inBtn = document.getElementById('btnZoomIn');
        const outBtn = document.getElementById('btnZoomOut');
        if (inBtn) inBtn.disabled = viewZoom >= ZOOM_MAX - 0.001;
        if (outBtn) outBtn.disabled = viewZoom <= ZOOM_MIN + 0.001;
    }
    if (persist) {
        try { localStorage.setItem(VITA_ZOOM_KEY, String(viewZoom)); } catch (e) {}
    }
}
function adjustViewZoom(delta) {
    applyViewZoom(viewZoom + delta, true);
}
function resetViewZoom() {
    applyViewZoom(1, true);
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
let level15Corpse = null;
let terminalPuzzleActive = false;
let terminalOpenTime = 0;
let terminalCurrentNode = null;
let terminalTimeRemaining = 14.0;
const TERMINAL_MAX_TIME = 25.0;
let terminalPuzzleData = null;
let terminalSlowMoTick = 0;
let terminalInputSeq = [];
let terminalSwitches = [0, 0, 0, 0];
let terminalGlitchCovered = false;
let terminalGlitchTimeout = null;
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
const VITA_QUALS = ['hd', 'smooth', 'retro', 'chunky'];
const QUAL_I18N_KEY = { hd: 'quality_hd', smooth: 'quality_smooth', retro: 'quality_retro', chunky: 'quality_chunky' };
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
    const quality = (s.quality && VITA_QUALS.includes(s.quality)) ? s.quality : 'hd';

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
        ui_monster: 'Monster:', ui_artifact: 'Generator:', ui_exit: 'Exit:', ui_time: 'Waktu:',
        mode_light: 'TERANG', mode_dark: 'GELAP',
        exit_open: 'TERBUKA', exit_locked: 'TERKUNCI',
        ctrl_bar: 'WASD / Panah / Joystick: Gerak | SPACE / KLIK: Serang | SHIFT: Dash | ESC: Jeda | M: Bisukan',
        pause_title: 'JEDA OPERASI', resume: 'LANJUT', restart: 'ULANGI DARI AWAL', main_menu: 'MENU UTAMA', btn_back_to_home: 'KEMBALI KE HUB',
        start_subtitle: 'Sektor Terlupakan — 15 Sektor Roguelite', play_now: 'MAIN SEKARANG',
        settings: 'PENGATURAN', how_to_play: 'CARA MAIN',
        volume: 'Volume', brightness: 'Kecerahan', language: 'Bahasa', close: 'Tutup',
        diff_label: 'Kesulitan', diff_easy: 'Mudah', diff_normal: 'Normal', diff_hard: 'Sulit',
        quality: 'Kualitas', quality_hd: 'HD Tajam', quality_smooth: 'Halus', quality_retro: 'Retro', quality_chunky: 'Kasar',
        zoom_label: 'Perbesaran', zoom_in: 'Perbesar', zoom_out: 'Perkecil', zoom_reset: 'Reset perbesaran',
        ctrl1: 'WASD / Panah: bergerak', ctrl2: 'SPACE / Klik: menyerang', ctrl3: 'SHIFT: dash kebal — tembus jebakan & serangan',
        ctrl4: 'Reaktivasi semua Generator Sektor lalu menuju portal ekstraksi.',
        death_title: '[ SUBJEK TERMINASI — GUGUR ]', death_level_lbl: 'Sektor tercapai:', death_kills_lbl: 'Anomali dinetralisir:',
        retry: 'DARI AWAL', retry_level: 'ULANGI LEVEL INI',
        muted_on: 'Suara mati (tekan M untuk nyalakan)', muted_off: 'Suara nyala',
        win_title: '[ SEKTOR BERSIH — FASILITAS AMAN ]', win_sub: 'Semua 15 sektor & The Monolith telah ditaklukkan!',
        win_kills_lbl: 'Total anomali dinetralisir:', win_time_lbl: 'Waktu total:',
        win_best_lbl: 'Rekor terbaik:', play_again: 'MAIN LAGI',
        win_grade_lbl: 'Peringkat:', new_best: '[ REKOR BARU TERTINGGI ]',
        announce_light: 'PROTOKOL: TERANG', announce_dark: 'PROTOKOL: GELAP',
        exit_locked_label: 'AIRLOCK TERKUNCI', need_more_artifacts: 'Butuh {n} generator lagi',
        msg_exit_locked: 'Pintu keluar terkunci! Nyalakan {n} generator daya lagi!',
        arrow_artifact: 'GENERATOR', arrow_exit: 'EXIT',
        instructions_title: 'PROTOKOL OPERASI: REAKTIVASI GENERATOR',
        instructions_close: 'MENGERTI & KEMBALI',
        term_puzzle_title: 'KONSOL REAKTIVASI GENERATOR',
        term_timer_label: 'WAKTU TERSISA:',
        term_predator_warn: '⚠️ PERINGATAN: PREDATOR MENDEKAT!',
        term_abort_btn: 'BATALKAN (ESC)',
        term_submit_btn: 'SAMBUNGKAN DAYA GENERATOR',
        term_success_msg: 'GENERATOR AKTIF — DAYA PULIH!',
        term_all_nodes_msg: 'SEMUA GENERATOR AKTIF — PINTU KELUAR TERBUKA!',
        term_fail_msg: 'KORSLETING LISTRIK! PREDATOR TERPANCING!',
        node_prompt_interact: 'AKTIFKAN GENERATOR',
        trap_hit: 'Jebakan Duri! -{n} HP', level_up: 'NAIK TINGKAT! HP+{h} ATK+{a}',
        death_time_lbl: 'Waktu bermain:', ui_bpm: 'BIOMETRIK:', death_cause_lbl: 'Penyebab Kematian:',
        death_stamp: 'SUBJEK: DIMANGSA', win_stamp: 'SEKTOR DIBERSIHKAN',
        admin_btn: 'ADMIN & PILIH SEKTOR', admin_login_title: 'LOGIN ADMIN',
        admin_login_desc: 'Masukkan kode konsol fasilitas untuk membuka akses admin.',
        admin_code_lbl: 'Kode', admin_enter: 'MASUK', admin_cancel: 'Batal',
        admin_wrong: 'Kode salah! Akses ditolak.',
        admin_panel_title: 'PANEL ADMIN — FASILITAS',
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
        admin_banner_title: 'OTORISASI ADMIN PENUH — ARSENAL & SKILL MAKSIMAL',
        admin_banner_sub: 'Semua 15 Sektor Fasilitas terbuka & 6 senjata aktif. Pilih sektor untuk langsung meluncur:',
        admin_select_sector: 'PILIH SEKTOR OPERASI (1 - 15)',
        admin_advanced_tools: 'OPSI TAMBAHAN — UJI SENJATA & SKILL SATUAN',
        admin_full_loadout_msg: '⚡ ARSENAL & SKILL MAKSIMAL DIAKTIFKAN!',
        admin_btn_short: 'ADMIN & CHEAT ENGINE [~]',
        admin_all_god_btn: '🌟 GODMODE + SEMUA SENJATA + SEMUA SKILL (MAX LOADOUT)',
        admin_give_weapons_btn: '⚔️ DAPAT SEMUA SENJATA',
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
        settings_sec_version: 'VERSI & PEMBARUAN (UPDATE)',
        settings_cur_ver_lbl: 'VERSI APLIKASI SAAT INI',
        settings_check_update_btn: '↻ CEK PEMBARUAN',
        settings_reset_default: 'KEMBALIKAN PENGATURAN KE BAWAAN',
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
        armory_eyebrow: 'ARSENAL OPERATIF — PROTOKOL PENAHANAN ANOMALI',
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
        prologue_classify: 'RAHASIA TERTINGGI — HANYA UNTUK PERSONEL BERWENANG',
        prologue_date: 'LOG INSIDEN — HARI KE-0 — FASILITAS VITA',
        prologue_title: 'SEKTOR TERLUPAKAN',
        // Combat Adrenaline & Anomaly Lore
        combo_double: 'ELIMINASI GANDA',
        combo_triple: 'ELIMINASI TIGA',
        combo_carnage: 'BANTAIAN — CARNAGE',
        combo_godlike: 'TAK TERBENDUNG — OVERKILL',
        lore_disc_found: 'DATA DISC DITEMUKAN',
        barrel_detonated: 'BIOHAZARD MELEDAK',
        boss_monolith_phase1: 'FASE I — INTI RUNIK',
        boss_monolith_phase2: 'FASE II — MATA KOSMIK',
        boss_monolith_phase3: 'FASE III — AMUKAN NOVA',
        obj_collect: 'REAKTIVASI GENERATOR', obj_exit: 'PINTU KELUAR TERBUKA — MENUJU AIRLOCK',
        tut_move: 'WASD / Joystick: bergerak — dekati & nyalakan Generator merah',
        tut_attack: 'SPACE / Klik: serang ke arah kursor. SHIFT: dash kebal!',
        tut_exit: 'Semua Generator aktif! Cari portal EKSTRAKSI hijau sekarang!',
        holo_move: 'WASD / Joystick untuk bergerak',
        holo_attack: 'Klik Kiri / Tombol Arah untuk menembak',
        holo_artifact: 'Dekati Generator merah untuk memecahkan puzzle terminal daya',
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
        beholder_sweep: 'SOROTAN SINAR OCULARIS!',
        tut_step1_badge: 'PROTOKOL 01 — NAVIGASI & GERAK',
        tut_step1_msg: 'Gunakan WASD / Tombol Arah / Joystick Sentuh untuk menjelajahi labirin',
        tut_step1_sub: 'Kalibrasi aktuator gerak: ',
        tut_step1_done: 'SISTEM NAVIGASI AKTIF',
        tut_step2_badge: 'PROTOKOL 02 — PHASE DASH',
        tut_step2_msg: 'Tekan SHIFT / Tombol DASH untuk melesat kebal menembus rintangan & bahaya',
        tut_step2_sub: 'Uji sistem pendorong dash...',
        tut_step2_done: 'PHASE DASH TERUJI',
        tut_step3_badge: 'PROTOKOL 03 — SENJATA & GANTI MODUL',
        tut_step3_msg: 'Tekan Serang untuk menyerang. Tekan ikon senjata / Q / 1-2 untuk berganti Bilah & Senapan',
        tut_step3_sub: 'Bilah Pedang (dekat) & Senapan Kinetik (jauh) siap digunakan...',
        tut_step3_done: 'ARSENAL TEMPUR SIAP',
        tut_step4_badge: 'PROTOKOL 04 — GENERATOR DAYA & EVAKUASI',
        tut_step4_msg: 'Nyalakan semua Generator Daya di radar, lalu segera lari ke portal Airlock Keluar!',
        tut_step4_sub: 'Perhatian: Mengaktifkan generator akan memicu alarm dan memancing monster mengejar!',
        tut_step4_done: 'MISI SEKTOR DIMULAI',
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
        robot_continue: 'LANJUTKAN MISI ▸',
        final_corpse_prompt: '[E / SENTUH] BACA SURAT AMPLOP TERAKHIR',
        final_letter_badge: 'DOKUMEN WASIAT TERAKHIR — RES-01',
        final_letter_title: 'SURAT TERAKHIR DR. RUDRA',
        final_letter_sub: 'Ditemukan di samping jasad Dr. Rudra di koridor evakuasi Sektor 15',
        final_letter_close: 'SIMPAN WASIAT & MENUJU PORTAL EVAKUASI ▸',
        final_letter_toast: '[ WASIAT DR. RUDRA DITEMUKAN — SEKTOR 15 TERLENGKAPI ]',
        coop_lobby_btn: 'OPERASI CO-OP (4 PEMAIN)',
        menu_tutorial: 'TUTORIAL & PROLOG (HOW TO PLAY)',
        coop_modal_title: 'TERMINAL MULTIPLAYER CO-OP',
        coop_tab_host: 'BUAT KAMAR (HOST)',
        coop_tab_join: 'GABUNG KAMAR',
        coop_room_code_label: 'KODE KAMAR TAKTIS',
        coop_copy_code_btn: 'SALIN KODE',
        coop_code_copied: 'KODE DISALIN KE PAPAN KLIP!',
        coop_enter_code_label: 'MASUKKAN KODE KAMAR (4 DIGIT)',
        coop_code_placeholder: 'KODE (cth: 7X49)',
        coop_connect_btn: 'HUBUNGKAN KE REGU ▸',
        coop_launch_btn: 'LUNCURKAN OPERASI TIM ▸',
        coop_waiting_client: 'MENUNGGU KEPUTUSAN HOST...',
        coop_relay_status: 'STATUS JARINGAN RELAY:',
        coop_status_offline: 'LOKAL / DISCONNECTED',
        coop_status_connected: 'TERHUBUNG KE RELAY',
        coop_status_error: 'GAGAL TERHUBUNG KE RELAY',
        coop_waiting_agent: 'MENUNGGU OPERATIF...',
        coop_net_host: 'HOST',
        coop_peer_disconnected: 'OPERATIF TERPUTUS',
        coop_operative_downed: 'OPERATIF JATUH! (BUTUH BANTUAN)',
        coop_operative_revived: 'OPERATIF DIBANGKITKAN!',
        coop_reviving: 'MEMBANGKITKAN...',
        coop_err_invalid_code: 'KODE KAMAR TIDAK VALID (MIN. 3 KARAKTER).',
        coop_err_room_full: 'KAMAR PENUH (MAKS 4 OPERATIF).',
        coop_err_server_full: 'RELAY PENUH. COBA LAGI NANTI.',
        coop_err_generic: 'KONEKSI RELAY GAGAL. PASTIKAN SERVER RELAY AKTIF (npm run relay).',
        coop_relay_url_label: 'ALAMAT RELAY (WEBSOCKET)',
        coop_relay_apply_btn: 'TERAPKAN',
        coop_relay_hint: 'Alamat relay publik (protokol ws atau wss) agar bisa bermain lintas jaringan. Kosongkan untuk lokal.',
        coop_badge_local: 'RELAY: LOKAL',
        coop_badge_online: 'RELAY: ONLINE',
        coop_connected: 'RELAY: TERHUBUNG',
        coop_disconnected: 'RELAY: TERPUTUS',
        coop_invite_label: 'TAUTAN UNDANGAN',
        coop_copy_invite_btn: 'SALIN TAUTAN',
        coop_invite_copied: 'TAUTAN DISALIN!',
        coop_invite_hint: 'Kirim tautan ini ke rekan; kode kamar & relay terisi otomatis.',
        coop_invite_prefilled: 'KODE UNDANGAN TERISI OTOMATIS. TEKAN HUBUNGKAN.',
        orient_title: 'PUTAR KE MODE LANDSCAPE',
        orient_desc: 'Miringkan ponsel ke posisi horizontal (landscape) agar tombol joystick & serang leluasa serta pandangan labirin maksimal.',
        orient_btn_fullscreen: 'KUNCI LAYAR PENUH (AUTO)',
        orient_btn_dismiss: 'TETAP MAIN TEGAK (ABAIKAN)',
        plat_selector_title: 'PILIH PLATFORM OPERASI VITA',
        plat_selector_sub: 'Pilih metode bermain yang Anda inginkan: Browser Web, Klien PC Windows, atau APK Android.',
        plat_web_badge: 'ONLINE BROWSER — RESMI',
        plat_web_title: 'MAIN DI WEB (BROWSER)',
        plat_web_desc: 'Bermain langsung tanpa instalasi di browser modern. Mendukung Co-op 4 Pemain & Cloud Save.',
        plat_web_btn: 'MAINKAN DI WEB (TAB BARU) ▸',
        plat_pc_badge: 'WINDOWS 10/11 — STANDALONE',
        plat_pc_title: 'EDISI PC (WINDOWS)',
        plat_pc_desc: 'Aplikasi mandiri offline ultra-ringan tanpa tab browser. Kontrol presisi keyboard & mouse.',
        plat_pc_btn: 'PILIH / UNDUH PC ▸',
        plat_android_badge: 'NATIVE APK — SENTUH HP',
        plat_android_title: 'EDISI ANDROID (APK)',
        plat_android_desc: 'File installer APK smartphone. Tampilan layar penuh & kontrol sentuh horizontal yang nyaman.',
        plat_android_btn: 'PILIH / UNDUH ANDROID ▸',
        hero_enter_btn: 'MASUK KE LABIRIN',
        hero_dossier_btn: 'Berkas Operatif',
        hero_settings_btn: 'Pengaturan Fasilitas',
        hero_lb_btn: 'Papan Peringkat Global',
        hero_manual_btn: 'Buku Panduan & Info',
        plat_switch_btn: '⇋ PILIH PLATFORM LAIN (UNDUH PC / APK)',
        pc_modal_title: 'UNDUH & JALANKAN VITA DI PC WINDOWS',
        pc_modal_desc: 'Pilih metode instalasi PC. Versi standalone berjalan offline di jendela aplikasi tersendiri tanpa gangguan tab browser.',
        pc_dl_zip_rec_btn: 'UNDUH PAKET PORTABLE (.ZIP 2.1 MB - AMAN & MUDAH)',
        pc_dl_exe_btn: 'UNDUH APLIKASI PC (.EXE STANDALONE 5.1 MB)',
        pc_dl_msi_btn: 'UNDUH INSTALLER PC (.MSI 2.6 MB)',
        pc_dl_bat_btn: 'UNDUH LAUNCHER PC (MAIN_VITA.bat)',
        pc_dl_zip_btn: 'UNDUH KODE SUMBER LENGKAP (ZIP)',
        pc_step_1: '1. Unduh berkas VITA (.zip atau .exe) langsung dari tombol di atas.',
        pc_step_2: '2. Buka berkas unduhan di komputer Windows Anda (ekstrak jika .zip).',
        pc_step_3: '3. Klik vita.exe untuk langsung bermain di jendela native PC!',
        pc_smartscreen_title: 'JIKA DITOLAK ATAU MUNCUL PERINGATAN WINDOWS:',
        pc_smartscreen_tip1: '• Di Browser (Edge/Chrome): Klik titik tiga (...) lalu pilih "Simpan" / "Tetap simpan" (Keep anyway).',
        pc_smartscreen_tip2: '• Di Layar Biru Windows: Klik "Info selengkapnya" (More info) lalu klik tombol "Tetap jalankan" (Run anyway).',
        pc_smartscreen_tip3: '• Rekomendasi: Gunakan file ZIP Portable di atas, ekstrak, lalu buka vita.exe. 100% aman dan open-source!',
        apk_modal_title: 'UNDUH & PASANG VITA DI ANDROID (APK)',
        apk_modal_desc: 'Unduh file APK resmi VITA untuk ponsel Android atau pasang langsung sebagai Progressive Web App (PWA).',
        apk_dl_btn: 'UNDUH LANGSUNG APK ANDROID (4.1 MB)',
        apk_pwa_btn: 'PASANG APLIKASI WEB DI HP (PWA)',
        apk_notice_manual: 'PENTING: File APK TIDAK otomatis muncul di layar utama HP setelah diunduh! Anda harus membuka berkas unduhan lalu menginstalnya.',
        apk_step_1: '1. Buka bar notifikasi ponsel, ATAU buka Pengelola File (File Manager) > folder Download.',
        apk_step_2: '2. Ketuk file vita.apk yang baru diunduh, lalu pilih "Pasang / Install" (izinkan instalasi sumber tak dikenal bila diminta).',
        apk_step_3: '3. Selesai! Ikon aplikasi VITA kini muncul di layar utama dan siap dimainkan offline.',
        apk_pwa_tip: '💡 Tips Alternatif: Ingin instan tanpa file APK? Ketuk tombol "PASANG APLIKASI WEB DI HP (PWA)" di atas untuk memasang langsung via browser!',
        restart_confirm: 'Progres Anda saat ini sedang berjalan. Yakin ingin mengulang dari Sektor 1? (Progres checkpoint akan direset).',
        bestiary_btn: 'ARSIP ANOMALI (BESTIARY)',
        bestiary_title: 'ARSIP ANOMALI & PREDATOR FASILITAS',
        bestiary_sub: 'Klasifikasi biologi, taktik bertahan, dan telemetri eliminasi spesimen',
        bestiary_threat_lbl: 'TINGKAT ANCAMAN:',
        bestiary_weakness_lbl: 'KELEMAHAN TAKTIS:',
        bestiary_bio_lbl: 'CATATAN BIOLOGI:',
        bestiary_kills_lbl: 'DIELIMINASI:',
        bestiary_deaths_lbl: 'KORBAN OPERATIF:',
        bestiary_specimen_count: '12 ANOMALI TERDETEKSI',
        workbench_btn: 'BENGKEL SENJATA (MODIFIKASI)',
        workbench_title: 'TERMINAL MODIFIKASI ARSENAL',
        workbench_sub: 'Tingkatkan persenjataan taktis ke Tier II dengan kemampuan khusus',
        workbench_tier1: 'TIER I (STANDAR)',
        workbench_tier2: 'TIER II (OVERCLOCKED)',
        workbench_upgrade_btn: 'PASANG MODIFIKASI TIER II',
        workbench_upgraded_tag: 'MODIFIKASI TERPASANG ✓',
        mode_campaign_btn: 'KAMPANYE — 15 SEKTOR',
        mode_endless_btn: 'ARENA SURVIVAL — HORDE',
        mode_active_campaign: 'MODE: KAMPANYE (SEKTOR 1-15)',
        mode_active_endless: 'MODE: ARENA SURVIVAL (HORDE DEFENSE)',
        endless_wave_banner: 'GELOMBANG {w} DIMULAI!',
        endless_wave_clear: 'GELOMBANG {w} DIBERSIHKAN!',
        endless_badge_wave: 'SURVIVAL — GELOMBANG {w}',
        endless_objective: 'BERTAHAN!',
        endless_evac_success: 'EVAKUASI TAKTIS BERHASIL! GELOMBANG {w} TERCATAT (+BONUS NANIT)',
        endless_evac_locked: 'HABISI SEMUA ANOMALI DI GELOMBANG INI UNTUK MEMBUKA AIRLOCK EVAKUASI!',
        endless_evac_open: 'PORTAL EVAKUASI AKTIF — MENUJU AIRLOCK',
        coop_waiting_squad: 'MENUNGGU OPERATIF LAIN: {c}/{t} DI AIRLOCK!',
        coop_squad_at_exit: 'AIRLOCK EVAKUASI: {c}/{t} OPERATIF KUMPUL',
        loading_boot_title: 'MEMULAI PROTOKOL SISTEM VITA',
        loading_hub_to_game: 'MEMULAI SISTEM OPERATIF VITA',
        loading_game_to_hub: 'MENUTUP SESI TAKTIS — KEMBALI KE HUB',
        loading_sector_title: 'DEKONTAMINASI AIRLOCK — MENUJU SEKTOR {s}',
        loading_step_1: 'MEMERIKSA INTEGRITAS ARSIP SEKTOR...',
        loading_step_2: 'MENGALIBRASI AKTUATOR PROTOTIPE...',
        loading_step_3: 'MEMBANGUN TOPOLOGI LABIRIN & ANOMALI...',
        loading_step_4: 'SINKRONISASI PROTOKOL TAKTIS BERHASIL ✓',
        loading_step_hub_1: 'MENGHUBUNGKAN KONSOL ARSIP...',
        loading_step_hub_2: 'MENYIAPKAN PROTOKOL LABIRIN...',
        loading_step_hub_3: 'SINKRONISASI BIOMETRIK OPERATIF...',
        loading_step_hub_4: 'AKSES SEKTOR DIBERIKAN ✓',
        loading_tip_1: 'Phase Dash (SHIFT / Tombol Dash) memberikan kekebalan mutlak dari duri dan serangan anomali.',
        loading_tip_2: 'Ganti senjata sesuai tipe musuh: Pisau untuk jarak dekat, Senapan untuk jarak jauh, Minigun untuk kawanan musuh.',
        loading_tip_3: 'Reaktivasi semua generator di lorong untuk membuka pintu airlock menuju sektor berikutnya.',
        loading_tip_4: 'Pada Operasi Co-op, seluruh rekan tim yang hidup harus berkumpul di airlock agar pintu sektor terbuka.',
        loading_tip_5: 'Waspadai Anomali Mimic: perhatikan getaran atau denyut kecil sebelum mengambil piringan data.',
        loading_tip_6: 'Harvester menyamarkan filamen merah di lantai batu; jangan melintasinya sembarangan.',
        loading_tip_7: 'Tingkatkan Pohon Talenta di Hub untuk mendapatkan zirah, regenerasi, dan daya tembak permanen.',
        loading_tip_8: 'Injak MedPod di lorong untuk memulihkan zirah bionikmu saat kondisi genting.',
        gen_restored: '+GENERATOR PULIH! (+12 HP)',
        gen_all_online: '★ SEMUA GENERATOR AKTIF — PINTU TERBUKA ★',
        endless_respite_lbl: 'JEDA PASOKAN: {s}s',
        endless_highest_wave_lbl: 'Rekor Gelombang Tertinggi:',
        endless_survival_time_lbl: 'Waktu Bertahan Terbaik:',
        pause_bestiary_btn: 'ARSIP ANOMALI (BESTIARY)',
        pause_workbench_btn: 'BENGKEL SENJATA',
        pause_exit_btn: 'KELUAR KE MENU UTAMA (EXIT)',
        talent_btn: 'POHON TALENTA',
        talent_title: 'POHON TALENTA & PROTOKOL JEJAK',
        talent_sub: 'Sistem peningkatan saraf & modul bionik permanen — Persisten antar-misi',
        talent_nanites_lbl: 'INTI NANIT:',
        talent_branch_combat: 'JALUR TEMPUR',
        talent_branch_defense: 'JALUR KETAHANAN',
        talent_branch_tactical: 'JALUR TAKTIS',
        talent_branch_core: 'INTI OPERATIF PUSAT',
        talent_cur_effect: 'EFEK SAAT INI:',
        talent_next_effect: 'EFEK TINGKAT BERIKUTNYA:',
        talent_rank_lbl: 'Tingkat:',
        talent_cost_lbl: 'Biaya:',
        talent_upgrade_btn: 'TINGKATKAN PROTOKOL',
        talent_maxed_lbl: 'TINGKAT MAKSIMAL',
        talent_locked_lbl: 'TERKUNCI',
        talent_req_lbl: 'Prasyarat:',
        talent_reset_btn: 'RESET PROTOKOL (PENGEMBALIAN 100%)',
        talent_reset_confirm: 'Apakah Anda yakin ingin me-reset semua talenta? Seluruh Inti Nanit akan dikembalikan 100%.',
        pause_talent_btn: 'POHON TALENTA',
        talent_core_name: 'Inti Tautan Saraf Operatif',
        talent_core_desc: 'Pusat integrasi prostetik bionik & pengontrol telemetri nanit.',
        talent_atk_name: 'Penajaman Nanit',
        talent_atk_desc: 'Meningkatkan Serangan Dasar sebesar +10% per tingkat.',
        talent_crit_name: 'Lonjakan Kritis',
        talent_crit_desc: 'Meningkatkan Peluang Kritis +10% dan Kerusakan Kritis +30% per tingkat.',
        talent_plasma_name: 'Busur Plasma Sabit (Talenta Utama)',
        talent_plasma_desc: 'Tebasan ke-3 melepaskan proyektil sabit energi plasma yang menembus musuh.',
        talent_hp_name: 'Karapas Baja Bionik',
        talent_hp_desc: 'Meningkatkan HP Maksimal sebesar +30 / +65 / +100 secara permanen.',
        talent_regen_name: 'Nano-Perbaikan Seluler',
        talent_regen_desc: 'Saat HP di bawah 40%, meregenerasi 1 / 2 / 3 HP setiap 2.5 detik.',
        talent_aegis_name: 'Perisai Aegis Kinetik (Talenta Utama)',
        talent_aegis_desc: 'Mendapatkan perisai energi yang meniadakan 1 serangan monster sepenuhnya (isi ulang tiap 25 detik).',
        talent_speed_name: 'Piston Kaki Overclock',
        talent_speed_desc: 'Meningkatkan kecepatan gerak & dash sebesar +8% per tingkat.',
        talent_flux_name: 'Kapasitor Fotonik',
        talent_flux_desc: 'Radius senter +20% dan jeda cooldown Dash berkurang -15% per tingkat.',
        talent_phantom_name: 'Bayangan Listrik Phantom (Talenta Utama)',
        talent_phantom_desc: 'Melakukan Dash meninggalkan medan kejut listrik statis yang melumpuhkan monster.',
        auth_modal_title: 'TERMINAL OPERATIF • AUTENTIKASI',
        auth_active_account_lbl: 'AKUN SEDANG AKTIF:',
        auth_verified_badge: 'TERVERIFIKASI',
        auth_logout_btn: '🚪 KELUAR DARI AKUN (LOG OUT)',
        auth_switch_account_btn: 'Ganti Akun / Masuk dengan Akun Lain ▸',
        auth_tab_login: 'MASUK (LOG IN)',
        auth_tab_register: 'DAFTAR AKUN BARU (NEW ACCOUNT)',
        auth_login_desc: 'Masuk dengan akun terdaftar. Nama dan sandi tersimpan otomatis di perangkat ini serta disinkronkan langsung ke cloud Supabase.',
        auth_callsign_lbl: 'Operative Callsign / Handle:',
        auth_passcode_lbl: 'Security Passcode (PIN/Sandi):',
        auth_remember_me: 'Simpan Nama & Sandi di perangkat ini (Auto-Remember)',
        auth_login_submit_btn: 'MASUK KE AKUN (LOG IN) ▸',
        auth_login_sync_note: '⚡ Otomatis sinkronisasi level, senjata, foto profil & rekor dengan Supabase',
        auth_register_desc: 'Daftarkan akun operatif baru. Identitas dan seluruh pencapaian roguelite Anda akan langsung diamankan di database Supabase.',
        auth_reg_callsign_lbl: 'Operative Callsign (3-24 karakter):',
        auth_reg_passcode_lbl: 'Security Passcode (min. 4 karakter):',
        auth_reg_role_lbl: 'Divisi Fasilitas:',
        auth_reg_remember: 'Simpan sandi & nama akun baru di perangkat ini',
        auth_register_submit_btn: 'BUAT AKUN BARU (REGISTER) ▸',
        auth_register_sync_note: '⚡ Akun baru langsung terdaftar dan diamankan di Supabase Cloud',
        auth_ph_callsign: 'Masukkan Callsign operatif',
        auth_ph_passcode: 'Masukkan sandi akun Anda',
        auth_ph_reg_callsign: 'Contoh: OPERATIVE-77',
        auth_ph_reg_passcode: 'Buat sandi aman akun baru',
        profile_modal_title: 'DOSSIER PROFIL OPERATIF',
        profile_status_guest: 'STATUS: TAMU • LOKAL',
        profile_clearance_lvl1: 'IZIN AKSES: LEVEL-1',
        profile_upload_avatar: 'Unggah Foto (Avatar)',
        profile_insignia_title: 'Atau Pilih Lambang Divisi:',
        profile_callsign_lbl: 'Callsign Operatif:',
        profile_autosaved_tag: '● Tersimpan Otomatis ✓',
        profile_passcode_lbl: 'Security Passcode (PIN/Sandi):',
        profile_role_lbl: 'Divisi Fasilitas / Peran:',
        profile_save_btn: 'Simpan Profil',
        profile_sync_cloud_btn: 'Sinkronisasi Cloud',
        profile_switch_acc_btn: 'Ganti Akun / Masuk',
        profile_record_lbl: 'Rekor:',
        profile_kills_lbl: 'Musuh:',
        profile_db_lbl: 'DB:',
        profile_db_status_local: 'Lokal Terenkripsi',
        profile_ph_username: 'Contoh: AGENT-CARNIS-01',
        profile_ph_passcode: 'Masukkan sandi akun Anda',
        leaderboard_modal_title: 'PAPAN PERINGKAT OPERATIF GLOBAL • JARINGAN FASILITAS',
        leaderboard_refresh_btn: '↻ Muat Ulang',
        leaderboard_th_rank: 'PERINGKAT',
        leaderboard_th_op: 'OPERATIF',
        leaderboard_th_div: 'DIVISI',
        leaderboard_th_sector: 'SEKTOR',
        leaderboard_th_time: 'WAKTU',
        leaderboard_th_kills: 'MUSUH',
        leaderboard_th_grade: 'NILAI',
        leaderboard_fetching: 'Mengambil data telemetri fasilitas...',
        database_modal_title: 'UPLINK JARINGAN FASILITAS',
        database_hint: 'Hubungkan terminal ini ke jaringan fasilitas untuk menyinkronkan papan peringkat global dan dossier operatif di seluruh sektor.',
        database_url_lbl: 'URL Uplink Fasilitas:',
        database_key_lbl: 'Kunci Akses Uplink:',
        database_ph_url: 'https://uplink-fasilitas-anda.local',
        database_ph_key: 'Tempel kunci akses — hanya tersimpan di terminal ini',
        database_connect_btn: 'Sambungkan Uplink',
        database_disconnect_btn: 'Putus Uplink',
        pause_stat_sector: 'SEKTOR',
        pause_stat_time: 'WAKTU',
        pause_stat_kills: 'MUSUH',
        pause_stat_weapon: 'SENJATA',
        pause_codex_btn: 'ARSIP RAHASIA',
        pause_settings_btn: 'PENGATURAN FASILITAS',
        pc_guide_title: 'PANDUAN MENJALANKAN DI PC:',
        apk_guide_title: 'PANDUAN INSTALASI DI ANDROID:',
        talent_nanites_unit: 'Nanit'
    },
    en: {
        ui_level: 'Level:', ui_mode: 'Mode:', ui_diff: 'Difficulty:', ui_hp: 'HP:', ui_atk: 'Attack:',
        ui_monster: 'Monster:', ui_artifact: 'Generators:', ui_exit: 'Exit:', ui_time: 'Time:',
        mode_light: 'LIGHT', mode_dark: 'DARK',
        exit_open: 'OPEN', exit_locked: 'LOCKED',
        ctrl_bar: 'WASD / Arrows / Joystick: Move | SPACE / CLICK: Attack | SHIFT: Dash | ESC: Pause | M: Mute',
        pause_title: 'OPERATION PAUSED', resume: 'RESUME', restart: 'RESTART LEVEL', main_menu: 'MAIN MENU', btn_back_to_home: 'BACK TO HUB',
        start_subtitle: 'Forgotten Sector — 15 Roguelite Sectors', play_now: 'PLAY NOW',
        settings: 'SETTINGS', how_to_play: 'HOW TO PLAY',
        volume: 'Volume', brightness: 'Brightness', language: 'Language', close: 'Close',
        diff_label: 'Difficulty', diff_easy: 'Easy', diff_normal: 'Normal', diff_hard: 'Hard',
        quality: 'Quality', quality_hd: 'HD Sharp', quality_smooth: 'Smooth', quality_retro: 'Retro', quality_chunky: 'Chunky',
        zoom_label: 'Zoom', zoom_in: 'Zoom in', zoom_out: 'Zoom out', zoom_reset: 'Reset zoom',
        ctrl1: 'WASD / Arrows: move', ctrl2: 'SPACE / Click: attack', ctrl3: 'SHIFT: phase dash — invincible, pass traps & hits',
        ctrl4: 'Reactivate all Sector Generators, then reach the extraction portal.',
        death_title: '[ SUBJECT TERMINATED — DEAD ]', death_level_lbl: 'Sector reached:', death_kills_lbl: 'Monsters neutralized:',
        retry: 'FROM START', retry_level: 'RETRY LEVEL',
        muted_on: 'Muted (press M to unmute)', muted_off: 'Sound on',
        win_title: '[ SECTOR PURGED — FACILITY SECURE ]', win_sub: 'All 15 sectors conquered & The Monolith neutralized!',
        win_kills_lbl: 'Total monsters neutralized:', win_time_lbl: 'Total time:',
        win_best_lbl: 'Best record:', play_again: 'PLAY AGAIN',
        win_grade_lbl: 'Rank:', new_best: '[ NEW BEST RECORD ]',
        announce_light: 'PROTOCOL: LIGHT', announce_dark: 'PROTOCOL: DARK',
        exit_locked_label: 'EXIT LOCKED', need_more_artifacts: 'Need {n} more generators',
        msg_exit_locked: 'Airlock locked! Power on {n} more generators!',
        arrow_artifact: 'GENERATOR', arrow_exit: 'EXIT',
        instructions_title: 'OPERATIONAL PROTOCOL: GENERATOR RESTORATION',
        instructions_close: 'ACKNOWLEDGED & RETURN',
        term_puzzle_title: 'SECTOR GENERATOR CONSOLE',
        term_timer_label: 'TIME REMAINING:',
        term_predator_warn: '⚠️ WARNING: PREDATOR APPROACHING!',
        term_abort_btn: 'ABORT (ESC)',
        term_submit_btn: 'CONNECT GENERATOR POWER',
        term_success_msg: 'GENERATOR ONLINE — POWER RESTORED!',
        term_all_nodes_msg: 'ALL GENERATORS ONLINE — EXTRACTION UNLOCKED!',
        term_fail_msg: 'SHORT CIRCUIT! PREDATORS ALERTED!',
        node_prompt_interact: 'ACTIVATE GENERATOR',
        trap_hit: 'Spike Trap! -{n} HP', level_up: 'LEVEL UP! HP+{h} ATK+{a}',
        death_time_lbl: 'Play time:', ui_bpm: 'BIOMETRIC:', death_cause_lbl: 'Cause of Death:',
        death_stamp: 'SUBJECT: TERMINATED', win_stamp: 'SECTOR PURGED',
        admin_btn: 'ADMIN & CHAPTER SELECT', admin_login_title: 'ADMIN LOGIN',
        admin_login_desc: 'Enter the facility console code to unlock admin access.',
        admin_code_lbl: 'Code', admin_enter: 'ENTER', admin_cancel: 'Cancel',
        admin_wrong: 'Wrong code! Access denied.',
        admin_panel_title: 'ADMIN PANEL — FACILITY',
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
        admin_banner_title: 'FULL ADMIN AUTHORIZATION — ALL WEAPONS & MAX SKILLS',
        admin_banner_sub: 'All 15 Facility Sectors unlocked & 6 weapons active. Select a sector to deploy immediately:',
        admin_select_sector: 'SELECT OPERATION SECTOR (1 - 15)',
        admin_advanced_tools: 'ADVANCED OPTIONS — TEST INDIVIDUAL WEAPONS & SKILLS',
        admin_full_loadout_msg: '⚡ FULL ARSENAL & MAX SKILLS ENGAGED!',
        admin_btn_short: 'ADMIN & CHEAT ENGINE [~]',
        admin_all_god_btn: '🌟 GODMODE + ALL WEAPONS + ALL SKILLS (MAX LOADOUT)',
        admin_give_weapons_btn: '⚔️ UNLOCK ALL WEAPONS',
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
        settings_sec_version: 'VERSION & UPDATES',
        settings_cur_ver_lbl: 'CURRENT APP VERSION',
        settings_check_update_btn: '↻ CHECK FOR UPDATES',
        settings_reset_default: 'RESTORE DEFAULT SETTINGS',
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
        armory_eyebrow: 'OPERATIVE ARSENAL — ANOMALY CONTAINMENT PROTOCOL',
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
        prologue_classify: 'TOP SECRET — AUTHORIZED PERSONNEL ONLY',
        prologue_date: 'INCIDENT LOG — DAY ZERO — VITA FACILITY',
        prologue_title: 'FORGOTTEN SECTOR',
        // Combat Adrenaline & Anomaly Lore
        combo_double: 'DOUBLE KILL',
        combo_triple: 'TRIPLE KILL',
        combo_carnage: 'CARNAGE',
        combo_godlike: 'UNSTOPPABLE — OVERKILL',
        lore_disc_found: 'DATA DISC RECOVERED',
        barrel_detonated: 'BIOHAZARD DETONATION',
        boss_monolith_phase1: 'PHASE I — RUNIC CORE',
        boss_monolith_phase2: 'PHASE II — COSMIC EYE',
        boss_monolith_phase3: 'PHASE III — BERSERK NOVA',
        obj_collect: 'REACTIVATE GENERATORS', obj_exit: 'EXIT UNLOCKED — GO TO AIRLOCK',
        tut_move: 'WASD / Joystick: move — approach & activate red Generators',
        tut_attack: 'SPACE / Click: attack toward cursor. SHIFT: invincible dash!',
        tut_exit: 'All Generators online! Find the green EXTRACTION portal now!',
        holo_move: 'WASD / Joystick to move',
        holo_attack: 'Left Click / Direction Button to shoot',
        holo_artifact: 'Approach red Generators to restore facility power grid',
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
        beholder_sweep: 'OCULARIS EYE BEAM SWEEP!',
        tut_step1_badge: 'PROTOCOL 01 — NAVIGATION & MOVEMENT',
        tut_step1_msg: 'Use WASD / Arrow Keys / Touch Joystick to navigate the labyrinth',
        tut_step1_sub: 'Calibrating movement actuators: ',
        tut_step1_done: 'NAVIGATION ACTUATORS ONLINE',
        tut_step2_badge: 'PROTOCOL 02 — PHASE DASH',
        tut_step2_msg: 'Press SHIFT / DASH Button to surge forward invincibly through danger',
        tut_step2_sub: 'Testing phase dash thrusters...',
        tut_step2_done: 'PHASE DASH VERIFIED',
        tut_step3_badge: 'PROTOCOL 03 — COMBAT & WEAPON CYCLING',
        tut_step3_msg: 'Press Attack to strike. Tap weapon icon / Q / 1-2 to switch between Blade and Rifle',
        tut_step3_sub: 'Tactical Blade (melee) & Kinetic Rifle (ranged) armed...',
        tut_step3_done: 'COMBAT ARSENAL READY',
        tut_step4_badge: 'PROTOCOL 04 — POWER GENERATORS & EVACUATION',
        tut_step4_msg: 'Reactivate all Power Generators in the sector to open the exit airlock',
        tut_step4_sub: 'Warning: Activating the generator will sound the alarm and summon chaser monsters!',
        tut_step4_done: 'SECTOR DIRECTIVE ACTIVE',
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
        robot_continue: 'CONTINUE MISSION ▸',
        final_corpse_prompt: '[E / TAP] READ FINAL ENVELOPE LETTER',
        final_letter_badge: 'FINAL TESTAMENT MEMORANDUM — RES-01',
        final_letter_title: 'DR. RUDRA\'S FINAL LETTER',
        final_letter_sub: 'Recovered beside the fallen Dr. Rudra at Sector 15 extraction',
        final_letter_close: 'PRESERVE TESTAMENT & ENTER EXTRACTION ▸',
        final_letter_toast: '[ DR. RUDRA\'S TESTAMENT FOUND — SECTOR 15 LOG COMPLETED ]',
        coop_lobby_btn: 'CO-OP ONLINE (4 PLAYERS)',
        menu_tutorial: 'TUTORIAL & PROLOGUE (HOW TO PLAY)',
        coop_modal_title: 'CO-OP MULTIPLAYER TERMINAL',
        coop_tab_host: 'CREATE ROOM (HOST)',
        coop_tab_join: 'JOIN ROOM',
        coop_room_code_label: 'TACTICAL ROOM CODE',
        coop_copy_code_btn: 'COPY CODE',
        coop_code_copied: 'CODE COPIED TO CLIPBOARD!',
        coop_enter_code_label: 'ENTER ROOM CODE (4 DIGITS)',
        coop_code_placeholder: 'CODE (e.g.: 7X49)',
        coop_connect_btn: 'CONNECT TO SQUAD ▸',
        coop_launch_btn: 'LAUNCH SQUAD OPERATION ▸',
        coop_waiting_client: 'WAITING FOR HOST TO LAUNCH...',
        coop_relay_status: 'RELAY NETWORK STATUS:',
        coop_status_offline: 'LOCAL / DISCONNECTED',
        coop_status_connected: 'CONNECTED TO RELAY',
        coop_status_error: 'FAILED TO CONNECT TO RELAY',
        coop_waiting_agent: 'WAITING FOR OPERATIVE...',
        coop_net_host: 'HOST',
        coop_peer_disconnected: 'OPERATIVE DISCONNECTED',
        coop_operative_downed: 'OPERATIVE DOWNED! (NEED REVIVE)',
        coop_operative_revived: 'OPERATIVE REVIVED!',
        coop_reviving: 'REVIVING...',
        coop_err_invalid_code: 'INVALID ROOM CODE (MIN. 3 CHARS).',
        coop_err_room_full: 'ROOM FULL (MAX 4 OPERATIVES).',
        coop_err_server_full: 'RELAY FULL. TRY AGAIN LATER.',
        coop_err_generic: 'RELAY CONNECTION FAILED. MAKE SURE THE RELAY IS RUNNING (npm run relay).',
        coop_relay_url_label: 'RELAY ADDRESS (WEBSOCKET)',
        coop_relay_apply_btn: 'APPLY',
        coop_relay_hint: 'Public relay address (ws or wss protocol) to play across networks. Leave empty for local.',
        coop_badge_local: 'RELAY: LOCAL',
        coop_badge_online: 'RELAY: ONLINE',
        coop_connected: 'RELAY: CONNECTED',
        coop_disconnected: 'RELAY: DISCONNECTED',
        coop_invite_label: 'INVITE LINK',
        coop_copy_invite_btn: 'COPY LINK',
        coop_invite_copied: 'LINK COPIED!',
        coop_invite_hint: 'Send this link to your squad; room code & relay auto-fill.',
        coop_invite_prefilled: 'INVITE CODE PREFILLED. PRESS CONNECT.',
        orient_title: 'ROTATE TO LANDSCAPE',
        orient_desc: 'Tilt your device horizontally (landscape) for spacious dual-thumb controls and maximum sector visibility.',
        orient_btn_fullscreen: 'FULLSCREEN LANDSCAPE (AUTO)',
        orient_btn_dismiss: 'CONTINUE PORTRAIT (DISMISS)',
        plat_selector_title: 'SELECT VITA OPERATIONAL PLATFORM',
        plat_selector_sub: 'Choose your preferred deployment: Instant Web Browser, Windows PC Client, or Android APK.',
        plat_web_badge: 'ONLINE BROWSER — OFFICIAL',
        plat_web_title: 'WEB BROWSER EDITION',
        plat_web_desc: 'Play instantly in your browser with zero installation. Supports 4-Player Co-op & Cloud Sync.',
        plat_web_btn: 'PLAY IN WEB (NEW TAB) ▸',
        plat_pc_badge: 'WINDOWS 10/11 — STANDALONE',
        plat_pc_title: 'PC EDITION (WINDOWS)',
        plat_pc_desc: 'Ultra-lightweight offline standalone window without browser tabs. Precision keyboard & mouse.',
        plat_pc_btn: 'SELECT / DOWNLOAD PC ▸',
        plat_android_badge: 'NATIVE APK — TOUCH MOBILE',
        plat_android_title: 'ANDROID EDITION (APK)',
        plat_android_desc: 'Smartphone installer APK package. Clean fullscreen interface & responsive horizontal touch controls.',
        plat_android_btn: 'SELECT / DOWNLOAD ANDROID ▸',
        hero_enter_btn: 'ENTER THE LABYRINTH',
        hero_dossier_btn: 'Operative Dossier',
        hero_settings_btn: 'Facility Settings',
        hero_lb_btn: 'Global Leaderboard',
        hero_manual_btn: 'Field Manual & Info',
        plat_switch_btn: '⇋ SELECT OTHER PLATFORM (DOWNLOAD PC / APK)',
        pc_modal_title: 'DOWNLOAD & RUN VITA ON WINDOWS PC',
        pc_modal_desc: 'Select your preferred PC installation. Standalone edition runs offline in a dedicated window without browser interference.',
        pc_dl_zip_rec_btn: 'DOWNLOAD PORTABLE PACKAGE (.ZIP 2.1 MB - EASY & SAFE)',
        pc_dl_exe_btn: 'DOWNLOAD PC STANDALONE (.EXE 5.1 MB)',
        pc_dl_msi_btn: 'DOWNLOAD PC INSTALLER (.MSI 2.6 MB)',
        pc_dl_bat_btn: 'DOWNLOAD PC LAUNCHER (MAIN_VITA.bat)',
        pc_dl_zip_btn: 'DOWNLOAD FULL SOURCE ARCHIVE (ZIP)',
        pc_step_1: '1. Download VITA package (.zip or .exe) directly using buttons above.',
        pc_step_2: '2. Open downloaded package on your Windows PC (extract if using .zip).',
        pc_step_3: '3. Click vita.exe to enjoy VITA immediately in native PC window!',
        pc_smartscreen_title: 'IF BLOCKED OR FLAGGED BY WINDOWS SMARTSCREEN:',
        pc_smartscreen_tip1: '• In Browser (Edge/Chrome): Click the three dots (...) and select "Keep anyway".',
        pc_smartscreen_tip2: '• In Windows SmartScreen Blue Screen: Click "More info", then click "Run anyway".',
        pc_smartscreen_tip3: '• Recommended: Use the Portable ZIP package above, extract it, and run vita.exe. 100% safe & open-source!',
        apk_modal_title: 'DOWNLOAD & INSTALL VITA ON ANDROID (APK)',
        apk_modal_desc: 'Download the official VITA Android APK package or install directly as a Progressive Web App (PWA).',
        apk_dl_btn: 'DIRECT DOWNLOAD ANDROID APK (4.1 MB)',
        apk_pwa_btn: 'INSTALL WEB APP ON MOBILE (PWA)',
        apk_notice_manual: 'IMPORTANT: Downloaded APK files DO NOT automatically install to your phone screen! You must open the downloaded file and install it.',
        apk_step_1: '1. Pull down your phone notification tray, OR open File Manager > Download folder.',
        apk_step_2: '2. Tap the downloaded vita.apk file, then select "Install" (allow unknown sources if prompted).',
        apk_step_3: '3. Complete! The VITA app icon will appear on your phone home screen ready for offline play.',
        apk_pwa_tip: '💡 Instant Alternative: Want zero APK downloads? Tap "INSTALL WEB APP ON MOBILE (PWA)" above to add VITA directly from your browser!',
        restart_confirm: 'You have active sector progress. Are you sure you want to restart from Sector 1? (Checkpoint progress will be reset).',
        bestiary_btn: 'ANOMALY ARCHIVE (BESTIARY)',
        bestiary_title: 'FACILITY ANOMALY & PREDATOR ARCHIVES',
        bestiary_sub: 'Biological classification, survival tactics, and specimen elimination telemetry',
        bestiary_threat_lbl: 'THREAT LEVEL:',
        bestiary_weakness_lbl: 'TACTICAL WEAKNESS:',
        bestiary_bio_lbl: 'BIOLOGICAL NOTES:',
        bestiary_kills_lbl: 'PURGED:',
        bestiary_deaths_lbl: 'OPERATIVE CASUALTIES:',
        bestiary_specimen_count: '12 ANOMALIES DETECTED',
        workbench_btn: 'WEAPON WORKBENCH (MODS)',
        workbench_title: 'ARSENAL MODIFICATION TERMINAL',
        workbench_sub: 'Upgrade tactical weaponry to Tier II with specialized abilities',
        workbench_tier1: 'TIER I (STANDARD)',
        workbench_tier2: 'TIER II (OVERCLOCKED)',
        workbench_upgrade_btn: 'INSTALL TIER II MODIFICATION',
        workbench_upgraded_tag: 'MODIFICATION INSTALLED ✓',
        mode_campaign_btn: 'CAMPAIGN — 15 SECTORS',
        mode_endless_btn: 'SURVIVAL ARENA — HORDE',
        mode_active_campaign: 'MODE: CAMPAIGN (SECTORS 1-15)',
        mode_active_endless: 'MODE: SURVIVAL ARENA (HORDE DEFENSE)',
        endless_wave_banner: 'WAVE {w} INCOMING!',
        endless_wave_clear: 'WAVE {w} PURGED!',
        endless_badge_wave: 'SURVIVAL — WAVE {w}',
        endless_objective: 'SURVIVE!',
        endless_evac_success: 'TACTICAL EVACUATION SUCCESSFUL! WAVE {w} RECORDED (+BONUS NANITES)',
        endless_evac_locked: 'PURGE ALL ANOMALIES IN THIS WAVE TO UNLOCK EVACUATION AIRLOCK!',
        endless_evac_open: 'EVACUATION AIRLOCK OPEN — PROCEED TO EXTRACTION',
        coop_waiting_squad: 'WAITING FOR SQUAD: {c}/{t} AT AIRLOCK!',
        coop_squad_at_exit: 'EXTRACTION AIRLOCK: {c}/{t} OPERATIVES ASSEMBLED',
        loading_boot_title: 'INITIALIZING VITA SYSTEM PROTOCOL',
        loading_hub_to_game: 'INITIALIZING VITA OPERATIVE SYSTEM',
        loading_game_to_hub: 'CLOSING TACTICAL SESSION — RETURNING TO HUB',
        loading_sector_title: 'AIRLOCK DECONTAMINATION — PROCEEDING TO SECTOR {s}',
        loading_step_1: 'CHECKING SECTOR ARCHIVE INTEGRITY...',
        loading_step_2: 'CALIBRATING PROTOTYPE ACTUATORS...',
        loading_step_3: 'CONSTRUCTING LABYRINTH TOPOLOGY & ANOMALIES...',
        loading_step_4: 'TACTICAL PROTOCOL SYNCHRONIZATION COMPLETE ✓',
        loading_step_hub_1: 'CONNECTING ARCHIVE CONSOLE...',
        loading_step_hub_2: 'PREPARING LABYRINTH PROTOCOL...',
        loading_step_hub_3: 'SYNCHRONIZING OPERATIVE BIOMETRICS...',
        loading_step_hub_4: 'SECTOR ACCESS GRANTED ✓',
        loading_tip_1: 'Phase Dash (SHIFT / Dash Button) provides absolute invulnerability through spikes and hostile attacks.',
        loading_tip_2: 'Switch armaments dynamically: Blade for close quarters, Rifle for distance, Minigun for hordes.',
        loading_tip_3: 'Reactivate all sector generators in the corridors to unlock the extraction airlock doors.',
        loading_tip_4: 'In Co-op Operations, all surviving squad members must assemble at the airlock to proceed.',
        loading_tip_5: 'Beware of Mimic Anomalies: look for subtle breathing or twitching before picking up data discs.',
        loading_tip_6: 'The Harvester disguises crimson filaments along stone floors; avoid stepping on active rootlines.',
        loading_tip_7: 'Upgrade your permanent Talent Tree in the Hub to unlock defensive shields and nanite firepower.',
        loading_tip_8: 'Step onto Medical Pods in corridors to instantly restore vital bionic chassis armor.',
        gen_restored: '+GENERATOR RESTORED! (+12 HP)',
        gen_all_online: '★ ALL GENERATORS ONLINE — EXIT OPEN ★',
        endless_respite_lbl: 'SUPPLY RESPITE: {s}s',
        endless_highest_wave_lbl: 'Highest Wave Record:',
        endless_survival_time_lbl: 'Best Survival Time:',
        pause_bestiary_btn: 'ANOMALY ARCHIVE (BESTIARY)',
        pause_workbench_btn: 'WEAPON WORKBENCH',
        pause_exit_btn: 'EXIT TO MAIN MENU',
        talent_btn: 'TALENT TREE',
        talent_title: 'OPERATIVE TALENT TREE & TRACES',
        talent_sub: 'Permanent neural upgrades & bionic modules — Persistent across runs',
        talent_nanites_lbl: 'NANITE CORES:',
        talent_branch_combat: 'COMBAT BRANCH',
        talent_branch_defense: 'DEFENSE BRANCH',
        talent_branch_tactical: 'TACTICAL BRANCH',
        talent_branch_core: 'CENTRAL OPERATIVE CORE',
        talent_cur_effect: 'CURRENT EFFECT:',
        talent_next_effect: 'NEXT RANK EFFECT:',
        talent_rank_lbl: 'Rank:',
        talent_cost_lbl: 'Cost:',
        talent_upgrade_btn: 'UPGRADE PROTOCOL',
        talent_maxed_lbl: 'MAX RANK REACHED',
        talent_locked_lbl: 'LOCKED',
        talent_req_lbl: 'Prerequisite:',
        talent_reset_btn: 'RESET PROTOCOL (100% REFUND)',
        talent_reset_confirm: 'Are you sure you want to reset all talents? 100% of invested Nanite Cores will be refunded.',
        pause_talent_btn: 'TALENT TREE',
        talent_core_name: 'Operative Neural Link Core',
        talent_core_desc: 'Central integration hub for bionic prosthetics & nanite telemetry control.',
        talent_atk_name: 'Nanite Edge',
        talent_atk_desc: 'Increases Base Attack by +10% per rank.',
        talent_crit_name: 'Critical Surge',
        talent_crit_desc: 'Increases Critical Hit Chance by +10% and Critical Damage by +30% per rank.',
        talent_plasma_name: 'Plasma Arc Wave (Major Talent)',
        talent_plasma_desc: 'Every 3rd attack unleashes a penetrating plasma energy wave slicing through foes.',
        talent_hp_name: 'Bionic Carapace',
        talent_hp_desc: 'Permanently increases Maximum HP by +30 / +65 / +100.',
        talent_regen_name: 'Cellular Nano-Repair',
        talent_regen_desc: 'When HP falls below 40%, passively regenerates 1 / 2 / 3 HP every 2.5 seconds.',
        talent_aegis_name: 'Kinetic Aegis Barrier (Major Talent)',
        talent_aegis_desc: 'Grants an energy barrier that completely nullifies 1 monster strike (recharges every 25s).',
        talent_speed_name: 'Overclocked Servos',
        talent_speed_desc: 'Increases movement speed & dash speed by +8% per rank.',
        talent_flux_name: 'Photonic Capacitor',
        talent_flux_desc: 'Expands torch radius by +20% and reduces Dash cooldown by -15% per rank.',
        talent_phantom_name: 'Phantom Phase Shock (Major Talent)',
        talent_phantom_desc: 'Dashing leaves behind a static electric field that slows and zaps nearby monsters.',
        auth_modal_title: 'OPERATIVE TERMINAL • AUTHENTICATION',
        auth_active_account_lbl: 'ACTIVE OPERATIVE SESSION:',
        auth_verified_badge: 'VERIFIED',
        auth_logout_btn: '🚪 LOG OUT OF SESSION',
        auth_switch_account_btn: 'Switch Account / Log In with Different ID ▸',
        auth_tab_login: 'LOG IN',
        auth_tab_register: 'REGISTER NEW ACCOUNT',
        auth_login_desc: 'Log in with a registered operative handle. Credentials auto-save on this terminal and synchronize with Supabase cloud.',
        auth_callsign_lbl: 'Operative Callsign / Handle:',
        auth_passcode_lbl: 'Security Passcode (PIN/Password):',
        auth_remember_me: 'Remember credentials on this terminal (Auto-Save)',
        auth_login_submit_btn: 'ACCESS OPERATIVE TERMINAL (LOG IN) ▸',
        auth_login_sync_note: '⚡ Automatic synchronization of sector depth, loadout, avatar & high scores',
        auth_register_desc: 'Register a new operative handle. Your profile dossier and roguelite achievements will be stored securely in the facility database.',
        auth_reg_callsign_lbl: 'Operative Callsign (3-24 characters):',
        auth_reg_passcode_lbl: 'Security Passcode (min. 4 characters):',
        auth_reg_role_lbl: 'Facility Division / Role:',
        auth_reg_remember: 'Remember new operative profile on this terminal',
        auth_register_submit_btn: 'REGISTER OPERATIVE PROFILE ▸',
        auth_register_sync_note: '⚡ New operative immediately indexed and synchronized with Supabase Cloud',
        auth_ph_callsign: 'Enter operative callsign',
        auth_ph_passcode: 'Enter account passcode',
        auth_ph_reg_callsign: 'e.g. OPERATIVE-77',
        auth_ph_reg_passcode: 'Create secure new passcode',
        profile_modal_title: 'OPERATIVE PROFILE DOSSIER',
        profile_status_guest: 'STATUS: GUEST • LOCAL',
        profile_clearance_lvl1: 'CLEARANCE: LEVEL-1',
        profile_upload_avatar: 'Upload Photo (Avatar)',
        profile_insignia_title: 'Or Select Division Insignia:',
        profile_callsign_lbl: 'Operative Callsign:',
        profile_autosaved_tag: '● Auto-Saved ✓',
        profile_passcode_lbl: 'Security Passcode (PIN/Password):',
        profile_role_lbl: 'Facility Division / Role:',
        profile_save_btn: 'Save Profile',
        profile_sync_cloud_btn: 'Sync Cloud Data',
        profile_switch_acc_btn: 'Switch Account / Login',
        profile_record_lbl: 'Record:',
        profile_kills_lbl: 'Kills:',
        profile_db_lbl: 'DB:',
        profile_db_status_local: 'Local Encrypted',
        profile_ph_username: 'e.g. AGENT-CARNIS-01',
        profile_ph_passcode: 'Enter your account passcode',
        leaderboard_modal_title: 'GLOBAL OPERATIVE LEADERBOARD • FACILITY NETWORK',
        leaderboard_refresh_btn: '↻ Refresh',
        leaderboard_th_rank: 'RANK',
        leaderboard_th_op: 'OPERATIVE',
        leaderboard_th_div: 'DIVISION',
        leaderboard_th_sector: 'SECTOR',
        leaderboard_th_time: 'TIME',
        leaderboard_th_kills: 'KILLS',
        leaderboard_th_grade: 'GRADE',
        leaderboard_fetching: 'Fetching facility telemetry data...',
        database_modal_title: 'FACILITY NETWORK UPLINK',
        database_hint: 'Link this terminal to the facility network to synchronize global leaderboards and operative dossiers across all sectors.',
        database_url_lbl: 'Facility Uplink URL:',
        database_key_lbl: 'Uplink Access Key:',
        database_ph_url: 'https://your-facility-uplink.local',
        database_ph_key: 'Paste access key — stored only in this terminal',
        database_connect_btn: 'Establish Uplink',
        database_disconnect_btn: 'Cut Uplink',
        pause_stat_sector: 'SECTOR',
        pause_stat_time: 'TIME',
        pause_stat_kills: 'KILLS',
        pause_stat_weapon: 'WEAPON',
        pause_codex_btn: 'CLASSIFIED ARCHIVES',
        pause_settings_btn: 'FACILITY SETTINGS',
        pc_guide_title: 'PC EXECUTION GUIDE:',
        apk_guide_title: 'ANDROID INSTALLATION GUIDE:',
        talent_nanites_unit: 'Nanites'
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
        cooldown: 14,
        type: 'melee',
        shortTag: 'PISAU',
        shortTagEn: 'KNIFE',
        specs: { dmg: 'Cepat & Tajam (1.25x)', rate: 'Sangat Cepat (4.2/s)', range: 'Dekat (46px)', special: 'Critical Backstab 2.5x' },
        specsEn: { dmg: 'Sharp (1.25x)', rate: 'Very Fast (4.2/s)', range: 'Close (46px)', special: 'Critical Backstab 2.5x' }
    },
    rifle: {
        id: 'rifle',
        code: '[TAC-02]',
        icon: '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm2 4h12v2H6zm-3 4h18v2H3zm5 4h8v2H8z"/></svg>',
        nameKey: 'weapon_rifle',
        roleKey: 'weapon_rifle_role',
        descKey: 'weapon_rifle_desc',
        cooldown: 16,
        type: 'ranged',
        shortTag: 'RIFLE',
        shortTagEn: 'RIFLE',
        specs: { dmg: 'Tinggi (1.6x)', rate: 'Responsif (3.7/s)', range: 'Jauh (580px)', special: 'Tembus 2 Musuh (Railgun)' },
        specsEn: { dmg: 'High (1.6x)', rate: 'Responsive (3.7/s)', range: 'Long (580px)', special: '2-Target Piercing (Railgun)' }
    },
    grenade: {
        id: 'grenade',
        code: '[EXP-03]',
        icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="7"/><path d="M12 7V3m-2 0h4m-5 4h6"/></svg>',
        nameKey: 'weapon_grenade',
        roleKey: 'weapon_grenade_role',
        descKey: 'weapon_grenade_desc',
        cooldown: 48,
        type: 'throwable',
        shortTag: 'GREN',
        shortTagEn: 'GREN',
        specs: { dmg: 'Area Besar (2.2x)', rate: 'Mantap (1.2/s)', range: 'Menengah Pantul', special: 'EMP Shockwave + Gas Spora' },
        specsEn: { dmg: 'AoE Blast (2.2x)', rate: 'Solid (1.2/s)', range: 'Mid (Bounce)', special: 'EMP Wave + Toxic Gas Cloud' }
    },
    bazooka: {
        id: 'bazooka',
        code: '[HVY-04]',
        icon: '<svg viewBox="0 0 24 24"><path d="M2 10h14l4-3v10l-4-3H2v-4zm18-1l2 3-2 3V9z"/></svg>',
        nameKey: 'weapon_bazooka',
        roleKey: 'weapon_bazooka_role',
        descKey: 'weapon_bazooka_desc',
        cooldown: 70,
        type: 'heavy',
        shortTag: 'BAZK',
        shortTagEn: 'BAZK',
        specs: { dmg: 'Masif (3.0x)', rate: 'Sedang (0.9/s)', range: 'Jarak Jauh', special: 'Ledakan Kluster 3 Arah' },
        specsEn: { dmg: 'Massive (3.0x)', rate: 'Medium (0.9/s)', range: 'Long Range', special: '3-Way Cluster Detonation' }
    },
    shield: {
        id: 'shield',
        code: '[DEF-05]',
        icon: '<svg viewBox="0 0 24 24"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z"/></svg>',
        nameKey: 'weapon_shield',
        roleKey: 'weapon_shield_role',
        descKey: 'weapon_shield_desc',
        cooldown: 100,
        type: 'defense',
        shortTag: 'SHLD',
        shortTagEn: 'SHLD',
        specs: { dmg: 'Pulse Stun (1.2x)', rate: 'Durasi 3.0s', range: 'Aura Tubuh (42px)', special: 'Kinetic Pulse Discharge' },
        specsEn: { dmg: 'Pulse Stun (1.2x)', rate: '3.0s Duration', range: 'Body Aura (42px)', special: 'Kinetic Pulse Discharge' }
    },
    minigun: {
        id: 'minigun',
        code: '[ROT-06]',
        icon: '<svg viewBox="0 0 24 24"><path d="M3 13h4v4H3zm6-3h4v10H9zm6-5h4v18h-4zm5 3h1v12h-1z"/></svg>',
        nameKey: 'weapon_minigun',
        roleKey: 'weapon_minigun_role',
        descKey: 'weapon_minigun_desc',
        cooldown: 5,
        type: 'rapid',
        shortTag: 'MINI',
        shortTagEn: 'MINI',
        specs: { dmg: 'DPS Cepat (0.55x)', rate: 'Ekstrem (12/s)', range: 'Jarak Jauh', special: 'Laras Membara & Steam Vent' },
        specsEn: { dmg: 'Fast DPS (0.55x)', rate: 'Extreme (12/s)', range: 'Long Range', special: 'Glowing Barrel & Steam Vent' }
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
function updateInstructionsModalLang(activeLang) {
    const isEn = (activeLang === 'en');
    const sHead = document.getElementById('instScenarioHead');
    const sBody = document.getElementById('instScenarioBody');
    const c1Title = document.getElementById('instCard1Title');
    const c1Desc = document.getElementById('instCard1Desc');
    const c2Title = document.getElementById('instCard2Title');
    const c2Desc = document.getElementById('instCard2Desc');
    const c3Title = document.getElementById('instCard3Title');
    const c3Desc = document.getElementById('instCard3Desc');
    const c4Title = document.getElementById('instCard4Title');
    const c4Desc = document.getElementById('instCard4Desc');
    const mTitleText = document.getElementById('modalTitleText');

    if (mTitleText) {
        mTitleText.textContent = isEn ? 'OPERATIONAL PROTOCOL: SECTOR REACTIVATION' : 'PROTOKOL OPERASI: REAKTIVASI SEKTOR';
    }
    if (sHead) {
        sHead.textContent = isEn ? 'VITA FACILITY SCENARIO:' : 'SKENARIO FASILITAS VITA:';
    }
    if (sBody) {
        sBody.innerHTML = isEn
            ? 'All sector power has failed due to biological anomaly breaches. The Operative\'s mission is to reactivate all corrupted <span style="color:#ff3366;font-weight:bold;">Power Nodes</span> to disengage the <span style="color:#2ecc71;font-weight:bold;">Extraction</span> gate lock.'
            : 'Seluruh daya sektor telah padam akibat serangan anomali biologis. Misi Operatif adalah mereaktivasi seluruh <span style="color:#ff3366;font-weight:bold;">Power Node</span> yang korup untuk membuka kuncian gerbang <span style="color:#2ecc71;font-weight:bold;">Ekstraksi</span>.';
    }
    if (c1Title) {
        c1Title.textContent = isEn ? '1. MANEUVER & LOCOMOTION' : '1. MANUVER & GERAKAN';
    }
    if (c1Desc) {
        c1Desc.innerHTML = isEn
            ? '<strong>PC / Keyboard:</strong> [W][A][S][D] / Arrow Keys to move. Press [SHIFT] for Phase Dash (temporary invulnerability through traps).<br><strong>Mobile Touchscreen:</strong> Move the Virtual Joystick on the bottom-left. Tap [DASH] on the bottom-right.'
            : '<strong>PC / Keyboard:</strong> [W][A][S][D] / Tombol Panah untuk bergerak. Tekan [SHIFT] untuk Phase Dash (kebal sesaat menembus jebakan).<br><strong>Layar Sentuh HP:</strong> Gerakkan Analog Joystick di kiri bawah layar. Sentuh tombol [DASH] di kanan bawah.';
    }
    if (c2Title) {
        c2Title.textContent = isEn ? '2. REACTIVATING SECTOR NODES (TERMINAL PUZZLES)' : '2. REAKTIVASI SECTOR NODE (TERMINAL PUZZLE)';
    }
    if (c2Desc) {
        c2Desc.innerHTML = isEn
            ? 'Approach a <strong>Red Power Node</strong> (Corrupted/Offline). Touch or press <strong>[E]</strong> to access the terminal. Solve 1 of 4 system logic puzzles (Voltage Sequence, Facility Archive, Memory Calibration, or Circuit Switches) within 14 seconds to restore power to the grid (turns Glowing Green/Cyan).'
            : 'Dekati <strong>Node Daya Merah</strong> (Corrupted/Offline). Sentuh atau tekan <strong>[E]</strong> untuk membuka terminal. Pecahkan 1 dari 4 teka-teki logika sistem (Deret Tegangan Listrik, Arsip Fasilitas, Kalibrasi Memori, atau Saklar Sirkuit) dalam batas waktu 14 detik untuk memulihkan daya ke grid (berubah jadi Hijau/Cyan Menyala).';
    }
    if (c3Title) {
        c3Title.textContent = isEn ? '3. SLOW-MOTION & PREDATOR WARNING' : '3. SLOW-MOTION & PERINGATAN PREDATOR';
    }
    if (c3Desc) {
        c3Desc.innerHTML = isEn
            ? 'While the terminal is open, simulation runs in slow-motion, but nearby anomalies <strong>still slowly approach</strong>! Watch the alert: <em>WARNING: PREDATOR APPROACHING</em>. Solve the puzzle quickly before taking damage!'
            : 'Saat terminal terbuka, simulasi game melambat (slow-motion), namun monster anomali di sekitar <strong>tetap perlahan mendekat</strong>! Perhatikan peringatan <em>WARNING: PREDATOR APPROACHING</em>. Selesaikan teka-teki secepat mungkin sebelum diserang!';
    }
    if (c4Title) {
        c4Title.textContent = isEn ? '4. SHORT CIRCUIT vs SECTOR EXTRACTION' : '4. KORSLETING vs EKSTRAKSI SEKTOR';
    }
    if (c4Desc) {
        c4Desc.innerHTML = isEn
            ? '<strong>Wrong Answer / Timeout:</strong> Triggers an electrical short circuit and a sonic alarm that lures nearby predators.<br><strong>Correct Answer:</strong> Power restored. Once all Nodes in the sector are Online, the <strong>Green Extraction</strong> gate unlocks for evacuation to the next sector!'
            : '<strong>Jawaban Salah / Waktu Habis:</strong> Terjadi korsleting listrik, memicu alarm sonik yang memanggil predator terdekat.<br><strong>Jawaban Benar:</strong> Daya pulih. Setelah seluruh Node di sektor itu Online, pintu <strong>Ekstraksi Hijau</strong> akan terbuka untuk evakuasi ke sektor berikutnya!';
    }
}
window.updateInstructionsModalLang = updateInstructionsModalLang;

function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
        const v = tt(el.getAttribute('data-i18n'));
        if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
        const v = tt(el.getAttribute('data-i18n-placeholder'));
        if (v) el.placeholder = v;
    });
    updateInstructionsModalLang(lang);
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
    const pResumeSpan = document.querySelector('#pauseResume span') || document.getElementById('pauseResume');
    if (pResumeSpan) pResumeSpan.textContent = tt('resume');
    const pRestartSpan = document.querySelector('#pauseRestart span') || document.getElementById('pauseRestart');
    if (pRestartSpan) pRestartSpan.textContent = tt('restart');
    const pMenuSpan = document.querySelector('#pauseMenu span') || document.getElementById('pauseMenu');
    if (pMenuSpan) pMenuSpan.textContent = tt('pause_exit_btn');
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
    ['gDifficulty', 'homeDifficulty', 'pauseDifficulty'].forEach(function (diffId) {
        const diffSel = document.getElementById(diffId);
        if (diffSel && diffSel.options && diffSel.options.length >= 3) {
            diffSel.options[0].text = tt('diff_easy');
            diffSel.options[1].text = tt('diff_normal');
            diffSel.options[2].text = tt('diff_hard');
        }
    });
    const sQual = document.getElementById('sQuality');
    if (sQual) sQual.textContent = tt('quality');
    const qualSel = document.getElementById('gQuality');
    if (qualSel && qualSel.options) {
        for (let i = 0; i < qualSel.options.length; i++) {
            const opt = qualSel.options[i];
            const qKey = QUAL_I18N_KEY[opt.value];
            if (qKey) opt.text = tt(qKey);
        }
    }
    // Sinkronkan label kualitas di Hub & menu jeda (keduanya punya daftar sama).
    ['homeQuality', 'pauseQuality'].forEach(function (selId) {
        const sel = document.getElementById(selId);
        if (!sel || !sel.options) return;
        for (let i = 0; i < sel.options.length; i++) {
            const opt = sel.options[i];
            const qKey = QUAL_I18N_KEY[opt.value];
            if (qKey) opt.text = tt(qKey);
        }
    });
    // Tombol zoom memakai aria-label/title (bukan data-i18n), jadi diset eksplisit.
    const zoomHudEl = document.getElementById('zoomHud');
    if (zoomHudEl) zoomHudEl.setAttribute('aria-label', tt('zoom_label'));
    [['btnZoomIn', 'zoom_in'], ['btnZoomOut', 'zoom_out'], ['btnZoomReset', 'zoom_reset']].forEach(function (pair) {
        const btn = document.getElementById(pair[0]);
        if (!btn) return;
        btn.setAttribute('aria-label', tt(pair[1]));
        btn.title = tt(pair[1]);
    });
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
    const aBT = document.getElementById('adminBannerTitle');
    if (aBT) aBT.textContent = tt('admin_banner_title');
    const aBS = document.getElementById('adminBannerSub');
    if (aBS) aBS.textContent = tt('admin_banner_sub');
    const aSS = document.getElementById('adminSelectSectorLbl');
    if (aSS) aSS.textContent = tt('admin_select_sector');
    const aAT = document.getElementById('adminAdvancedToolsSummary');
    if (aAT) aAT.textContent = tt('admin_advanced_tools');
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
    if (typeof applyProfileUI === 'function') applyProfileUI();
    if (typeof updateUI === 'function' && typeof player !== 'undefined' && player) updateUI();
    if (typeof checkContinueBtn === 'function') {
        try { checkContinueBtn(); } catch(_) {}
    }
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
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
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
        if (audioCtx && masterGain) {
            const finalVol = (settings && settings.muted) ? 0 : (settings.volume / 100);
            masterGain.gain.setValueAtTime(finalVol, audioCtx.currentTime);
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

    // Terapkan kecerahan real-time ke CSS token, Hub, dan Start Screen
    try {
        document.documentElement.style.setProperty('--app-brightness', factor);
    } catch (_) {}
    const homeView = document.getElementById('homeView');
    if (homeView) {
        homeView.style.setProperty('--hub-bright', factor);
        homeView.style.filter = `brightness(${factor})`;
    }
    const startScreen = document.getElementById('startScreen');
    if (startScreen) {
        startScreen.style.filter = `brightness(${factor})`;
    }
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
        if (master <= 0 || (settings && settings.muted)) return;
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
        if (master <= 0 || (settings && settings.muted)) return;
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
        if (master <= 0 || (settings && settings.muted)) return;
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

// 
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
        if (sub) sub.textContent = `${lang === 'id' ? 'Kalibrasi aktuator gerak' : 'Calibrating movement actuators'}: ${Math.min(50, Math.floor(tutorialMoveDist))}/50px`;
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
        if (sub) sub.textContent = (lang === 'id' ? `Generator aktif tersisa: ${rem}` : `Remaining Generators: ${rem}`);
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
        <div class="codex-stamp">TOP SECRET — CLASSIFIED</div>
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

    let html = `<div class="prologue-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid rgba(255,215,0,0.25);padding-bottom:8px">` +
        `<span class="prologue-classify" style="color:#f59e0b;font-weight:bold;letter-spacing:2px;font-size:11px">${isId ? 'MISI SELESAI — FASILITAS AMAN' : 'MISSION COMPLETE — FACILITY SECURE'}</span>` +
        `<span class="prologue-date" style="color:#94a3b8;font-size:11px;letter-spacing:1px">${isId ? 'EPILOG NARATIF KANONIKAL' : 'CANONICAL EPILOGUE DOSSIER'}</span>` +
        `</div>`;
    html += `<div class="epilogue-title" style="color:#ef4444;font-size:15px;font-weight:bold;letter-spacing:2px;margin-bottom:18px;text-shadow:0 0 10px rgba(239,68,68,0.35);line-height:1.5">${intro}</div>`;

    lines.forEach((l) => {
        let cls = 'epilogue-line';
        if (l.includes('SURAT WASIAT') || l.includes('TESTAMENT')) {
            cls += ' letter';
        } else if (l.includes('ALTERISHA')) {
            cls += ' comms';
        }
        html += `<div class="${cls}">${l}</div>`;
    });

    content.innerHTML = html;
    if (btn) {
        btn.style.opacity = '1';
        btn.style.display = 'inline-flex';
        btn.textContent = isId ? 'DEBRIEFING DOSSIER ▸▸' : 'DEBRIEFING DOSSIER ▸▸';
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
        if (master <= 0 || (settings && settings.muted)) return;

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
        if (master <= 0 || (settings && settings.muted)) return;

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
        if (master <= 0 || (settings && settings.muted)) return;
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
        if (master <= 0 || (settings && settings.muted)) return;
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
        if (master <= 0 || (settings && settings.muted)) return;
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

// Aktivasi Generator Sektor: Arpeggio akord mayor futuristik + resonance surge
function sGeneratorOnline() {
    try {
        // Volume master sudah diterapkan oleh playOccultTone/playNoiseBurst (settings.volume + masterGain)
        if (Number(settings.volume) <= 0) return;
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, i) => {
            setTimeout(() => {
                try {
                    playOccultTone(freq, freq * 1.01, 0.32, 0.45, 'sine');
                } catch (_) {}
            }, i * 65);
        });
        playOccultTone(110, 220, 0.55, 0.4, 'triangle');
        playNoiseBurst(0.22, 1200, 380, 2.8, 0.22, 'bandpass');
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
        if (master <= 0 || (settings && settings.muted)) return;
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

// Shotgun: ledakan noise lebar + punch sub-bass (dipakai tembakan peer co-op)
function sShotgun() {
    playNoiseBurst(0.22, 3200, 140, 1.8, 0.75, 'lowpass');
    playOccultTone(120, 38, 0.18, 0.7, 'sawtooth');
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
        if (master <= 0 || (settings && settings.muted)) return;

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
        if (master <= 0 || (settings && settings.muted)) return;

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
        if (master <= 0 || (settings && settings.muted)) return;
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
        if (master <= 0 || (settings && settings.muted)) return;
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
        if (master <= 0 || (settings && settings.muted)) return;
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
        const eb = Math.floor(Number(h.endlessBestWave));
        if (Number.isFinite(eb) && eb >= 0) out.endlessBestWave = eb;
        const ll = Math.floor(Number(h.lastLevel));
        if (Number.isFinite(ll) && ll >= 0 && ll < LEVELS) out.lastLevel = ll;
        if (Array.isArray(h.savedWeapons)) out.savedWeapons = h.savedWeapons.filter(w => typeof w === 'string');
        if (typeof h.savedCurrentWeapon === 'string') out.savedCurrentWeapon = h.savedCurrentWeapon;
        if (Array.isArray(h.savedPerks)) out.savedPerks = h.savedPerks.filter(p => typeof p === 'string');
        if (Number.isFinite(Number(h.savedExp))) out.savedExp = Number(h.savedExp);
        if (Number.isFinite(Number(h.savedPLevel))) out.savedPLevel = Number(h.savedPLevel);
        if (Number.isFinite(Number(h.savedKills))) out.savedKills = Number(h.savedKills);
        if (Number.isFinite(Number(h.savedTime))) out.savedTime = Number(h.savedTime);
        if (h.sectorDeaths && typeof h.sectorDeaths === 'object') out.sectorDeaths = h.sectorDeaths;
        if (h.clearedLevels && typeof h.clearedLevels === 'object') out.clearedLevels = h.clearedLevels;
        return out;
    } catch (e) { return {}; }
}
function saveHigh(h) {
    try {
        if (!h || typeof h !== 'object') return;
        localStorage.setItem(VITA_HIGH_KEY, JSON.stringify(h));
        // Auto-sync ke Supabase Cloud setiap kali progres/rekor disimpan
        if (typeof syncProfileToSupabase === 'function' && typeof getProfile === 'function') {
            const curProf = getProfile();
            if (curProf && curProf.isLoggedIn && curProf.provider !== 'guest') {
                syncProfileToSupabase(curProf).catch(() => {});
            }
        }
    } catch (e) {}
}

// 
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
    { name: 'Generator Reaktor Alfa', nameEn: 'Alpha Reactor Generator', color: '#ff2244', shape: 'node_alpha' },
    { name: 'Generator Inti Beta', nameEn: 'Beta Core Generator', color: '#ff3366', shape: 'node_beta' },
    { name: 'Generator Turbin Gamma', nameEn: 'Gamma Turbine Generator', color: '#ff4444', shape: 'node_gamma' },
    { name: 'Sub-Generator Delta', nameEn: 'Delta Sub-Generator', color: '#ff5522', shape: 'node_delta' },
    { name: 'Generator Fusi Epsilon', nameEn: 'Epsilon Fusion Generator', color: '#ff1155', shape: 'node_epsilon' },
    { name: 'Generator Daya Utama', nameEn: 'Main Power Generator', color: '#ff0033', shape: 'node_zeta' },
    { name: 'Generator Relay Sektor', nameEn: 'Sector Relay Generator', color: '#ff2a2a', shape: 'node_eta' }
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

    const count = (level === 0) ? 2 : Math.max(1, Math.min(28, 5 + level * 2) - currentAdaptation.monsterCountReduction);
    const isLight = level % 2 === 1;

    for (let i = 0; i < count; i++) {
        let mx, my;
        let attempts = 0;
        const minDist = (level === 0) ? 7 : 4;
        do {
            mx = Math.floor(Math.random() * (mazeW - 2)) + 1;
            my = Math.floor(Math.random() * (mazeH - 2)) + 1;
            attempts++;
        } while ((maze[my][mx] !== 0 || (mx < minDist && my < minDist) || !hasOpenNeighbor(my, mx)) && attempts < 200);

        if (attempts >= 200) continue;

        // Pilih tipe monster secara kontekstual sesuai sektor fasilitas
        const maxTypeIdx = MONSTER_TYPES.length - 2; // Kecuali The Monolith yang khusus level 15
        let type;
        if (level === 0) {
            type = MONSTER_TYPES[0]; // Amoeboid Slime (lemah & aman untuk latihan dasar pemain)
        } else if (level === 5 && (i < 3 || Math.random() < 0.5)) {
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
        // Kurva peningkatan tantangan yang seimbang dan proporsional dengan damage player
        // LV1 ≈ 1.0x → LV5 ≈ 1.35x → LV8 ≈ 1.70x → LV12 ≈ 2.05x → LV15 ≈ 2.30x
        const diffMult = 1.0 + 1.3 * (1 / (1 + Math.exp(-0.35 * (level - 7))));

        let speed = type.speed * (0.95 + level * 0.03) * diffSpeedMult * currentAdaptation.monsterSpeedMult;
        let hp = type.hp * diffMult * diffStatMult * currentAdaptation.monsterHpMult;
        let atk = type.atk * (1.0 + level * 0.06) * diffStatMult;

        if (isLight) {
            hp *= 1.2;
            atk *= 1.2;
            speed *= 1.08;
        } else {
            hp *= 0.88;
            atk *= 0.88;
            speed *= 0.96;
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

// Fase 1 (fondasi co-op online) — konstruksi dunia deterministik.
// Saat sesi punya seed (multiplayer), seluruh rantai pembangunan level
// (applyAdaptation → generateMaze → spawnMonsters → penempatan jebakan/artefak)
// berjalan di atas PRNG ber-seed, sehingga setiap peer menurunkan labirin,
// daftar monster, dan loot yang identik dari pasangan (netSessionSeed, level).
// Single-player tidak berubah: netSessionSeed tetap null → Math.random() polos.

let netSessionSeed = null;

// FNV-1a 32-bit: teks seed → uint32 (stabil lintas platform & peer).
function hashSeedToUint32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// PRNG mulberry32: cepat, tanpa dependensi, dan deterministik lintas mesin.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Seed per-sektor: campuran seed sesi + nomor level (agar tiap level berbeda).
function getLevelSeed(level) {
    if (netSessionSeed == null && coopRoomId) {
        netSessionSeed = hashSeedToUint32(coopRoomId.toUpperCase().trim());
    }
    if (netSessionSeed == null) return null;
    return (netSessionSeed ^ hashSeedToUint32('vita:level:' + level)) >>> 0;
}

// Dukungan `?seed=KODE` untuk uji determinisme (2 tab dengan seed sama → dunia sama).
function readSeedFromUrl() {
    try {
        const raw = new URLSearchParams(window.location.search).get('seed');
        if (!raw) return null;
        const trimmed = String(raw).trim().slice(0, 32);
        return trimmed ? hashSeedToUint32(trimmed) : null;
    } catch (e) {
        return null;
    }
}

netSessionSeed = readSeedFromUrl();

// Pembungkus publik: memasang PRNG ber-seed HANYA selama konstruksi dunia
// berlangsung, lalu mengembalikan Math.random asli agar partikel/audio/combat
// milik tiap klien tetap non-deterministik (perilaku single-player tak berubah).
function initLevel(level) {
    const clamped = Math.max(0, Math.min(LEVELS - 1, Math.floor(Number(level) || 0)));
    const seed = getLevelSeed(clamped);
    if (seed == null) {
        buildLevelWorld(level);
        return;
    }
    const originalRandom = Math.random;
    Math.random = mulberry32(seed);
    try {
        buildLevelWorld(level);
    } finally {
        Math.random = originalRandom;
    }
}

function buildLevelWorld(level) {
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
    level15Corpse = null;
    terminalPuzzleActive = false;
    terminalCurrentNode = null;
    if (terminalGlitchTimeout) { clearTimeout(terminalGlitchTimeout); terminalGlitchTimeout = null; }
    const termM = document.getElementById('terminalPuzzleModal');
    if (termM) termM.style.display = 'none';

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
        level15Corpse = {
            x: exitPos.x - 38,
            y: exitPos.y + 6,
            envelopeX: exitPos.x - 20,
            envelopeY: exitPos.y + 14,
            gx: Math.floor((exitPos.x - 38) / CELL),
            gy: Math.floor((exitPos.y + 6) / CELL),
            inspected: false
        };
        for (let i = 0; i < 6; i++) {
            addDecal(level15Corpse.x + (Math.random() - 0.5) * 22, level15Corpse.y + (Math.random() - 0.5) * 18, '#3d0408', 8, 'splat');
        }
    } else {
        if (level > 1) {
            const trapCount = Math.max(1, Math.min(5, Math.floor(level * 0.5)));
            const pSpawnX = 1, pSpawnY = 1;
            for(let i=0; i<trapCount; i++) {
                let spot = findFarSpot(6, taken);
                let tAttempts = 0;
                while (Math.hypot(spot.gx - pSpawnX, spot.gy - pSpawnY) < 6.5 && tAttempts < 50) {
                    spot = findFarSpot(6, taken);
                    tAttempts++;
                }
                traps.push({
                    x: spot.x, y: spot.y, gx: spot.gx, gy: spot.gy,
                    type: 'spikes',
                    state: 'hidden',
                    timer: 90 + Math.random() * 150,
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
        : (savedRun && Array.isArray(savedRun.savedWeapons) && savedRun.savedWeapons.length ? [...savedRun.savedWeapons] : ['knife', 'rifle']);
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
    let baseAtk = 32 + level * 6;
    if (perkPlasma > 0) {
        baseAtk = Math.round(baseAtk * Math.pow(1.3, perkPlasma));
    }
    let baseSpeed = 3.5 + (perkAdren * 0.55);
    let baseDashSpeed = 8 + (perkAdren * 1.5);

    // Integrasi Talenta Operatif (HSR / Genshin Style Traces)
    const tData = (typeof getTalentTreeData === 'function') ? getTalentTreeData() : null;
    if (tData && tData.ranks) {
        if (tData.ranks.hp_boost > 0) {
            baseMaxHp += [0, 30, 65, 100][tData.ranks.hp_boost] || 0;
        }
        if (tData.ranks.atk_boost > 0) {
            baseAtk = Math.round(baseAtk * (1 + tData.ranks.atk_boost * 0.10));
        }
        if (tData.ranks.speed_boost > 0) {
            baseSpeed *= (1 + tData.ranks.speed_boost * 0.08);
            baseDashSpeed *= (1 + tData.ranks.speed_boost * 0.08);
        }
    }

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
        talentCritBonus: (tData && tData.ranks && tData.ranks.crit_surge) ? (tData.ranks.crit_surge * 0.10) : 0,
        talentCritDmg: (tData && tData.ranks && tData.ranks.crit_surge) ? (1.5 + tData.ranks.crit_surge * 0.30) : 1.5,
        talentRegen: (tData && tData.ranks && tData.ranks.nano_repair) ? tData.ranks.nano_repair : 0,
        talentRegenTimer: 0,
        talentAegis: (tData && tData.ranks && tData.ranks.aegis_shield) ? 1 : 0,
        aegisShield: (tData && tData.ranks && tData.ranks.aegis_shield) ? 1 : 0,
        aegisCooldown: 0,
        talentFlux: (tData && tData.ranks && tData.ranks.flux_capacitor) ? tData.ranks.flux_capacitor : 0,
        talentPhantom: (tData && tData.ranks && tData.ranks.phantom_dash) ? 1 : 0,
        talentPlasma: (tData && tData.ranks && tData.ranks.plasma_arc) ? 1 : 0,
        plasmaArcHits: 0,
        afterimages: [],
        id: 'p0',
        peerIndex: 0,
        callsign: (typeof profileCallsign !== 'undefined' && profileCallsign) ? profileCallsign : 'PROTOTYPE-19'
    };
    // Co-op: pemain tamu mempertahankan indeks yang diberikan relay (1..3) agar input
    // dan avatar-nya dianggap benar oleh host; slot lain diisi bertahap dari snapshot
    // host (array sparse — players[0] boleh kosong di sisi tamu).
    const coopLocalIdx = (coopRoomId && !isCoopHost && localPlayerIndex > 0) ? localPlayerIndex : 0;
    player.id = 'p' + coopLocalIdx;
    player.peerIndex = coopLocalIdx;
    players = [];
    players[coopLocalIdx] = player;
    localPlayerIndex = coopLocalIdx;
    cameraX = player.x;
    cameraY = player.y;

    // Co-op Host: Inisialisasi entitas operatif untuk rekan tim yang sudah terhubung di lobi
    if (isCoopHost && coopPeers && coopPeers.length > 1) {
        for (let pi = 1; pi < coopPeers.length; pi++) {
            const peer = coopPeers[pi];
            if (peer && typeof peer.idx === 'number') {
                const px = player.x + peer.idx * 28;
                const py = player.y;
                players[peer.idx] = spawnCoopPeerEntity(peer.idx, peer.callsign, px, py);
            }
        }
    }

    if (isAdmin && typeof grantAdminFullArsenal === 'function') {
        grantAdminFullArsenal(player);
    }

    // Save run progress & equipment state
    if (!menuDemo && !isEndlessMode) {
        try {
            const high = loadHigh();
            high.lastLevel = level;
            high.savedWeapons = [...player.weapons];
            high.savedCurrentWeapon = player.currentWeapon;
            high.savedPerks = [...player.perks];
            high.savedExp = player.exp;
            high.savedPLevel = player.plevel;
            high.savedKills = totalKills;
            high.savedTime = totalTime;
            saveHigh(high);
            checkContinueBtn();
            if (typeof syncProfileToSupabase === 'function' && typeof getProfile === 'function') {
                const curProf = getProfile();
                if (curProf && curProf.isLoggedIn && curProf.provider !== 'guest') {
                    syncProfileToSupabase(curProf).catch(() => {});
                }
            }
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
    if (!menuDemo) {
        gameState = 'playing';
    }

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
            lang === 'en' ? 'SEC-09: OCULARIS MONITORING TOWER' : 'SEKTOR 09: MENARA PANTAUAN OCULARIS',
            lang === 'en' ? 'SEC-10: APEX PREDATOR BREACH' : 'SEKTOR 10: JEBOLNYA APEX PREDATOR',
            lang === 'en' ? 'SEC-11: SUB-TERRA EMBRYO VAULT' : 'SEKTOR 11: KUBAH EMBRIO BAWAH TANAH',
            lang === 'en' ? 'SEC-12: DEEP BIOMASS MARROW' : 'SEKTOR 12: SUMSUM BIOMASSA PURBA',
            lang === 'en' ? 'SEC-13: SUBTERRANEAN RESONANCE' : 'SEKTOR 13: GEMA RESONANSI CARNIS',
            lang === 'en' ? 'SEC-14: THE SACRIFICIAL THRESHOLD' : 'SEKTOR 14: AMBANG BATAS PENGORBANAN',
            lang === 'en' ? 'SEC-15: THE MONOLITH — COELUM CARNIS' : 'SEKTOR 15: THE MONOLITH — COELUM CARNIS'
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
                    <div class="eas-header">⚠️ ${lang === 'en' ? 'GLOBAL EMERGENCY — EAS LEVEL-5 BROADCAST' : 'DARURAT GLOBAL — SIARAN PERINGATAN EAS LEVEL-5'} ⚠️</div>
                    <div class="eas-title">${lang === 'en' ? 'CONVERGENCE DETECTED: 7 MONOLITHS MIGRATING' : 'KONVERGENSI TERDETEKSI: 7 MONOLITH BERGERAK'}</div>
                    <div class="eas-sub">${lang === 'en' ? 'PREVENT THE MERGED &bull; TERMINATE SECTOR 15 MONOLITH' : 'CEGAH PENYATUAN THE MERGED &bull; ELIMINASI MONOLITH SEKTOR 15'}</div>
                </div>
            `;
            announce.style.fontSize = '';
            announce.style.opacity = 1;
            const bEl = document.getElementById('uiBadge');
            if (bEl) bEl.textContent = 'GLOBAL-ALERT — SEC-15';
            setTimeout(() => { announce.style.opacity = 0; }, 4800);
        } else {
            const msg = msgList[level] || ('Level ' + (level + 1));
            const zone = zoneNames[level] || '';
            announce.innerHTML = msg + (zone ? '<span class="zone-name">— ' + zone + ' —</span>' : '');
            announce.style.color = isLight ? '#ff8a3d' : '#ff3636';
            const isSmall = window.innerWidth <= 768;
            announce.style.fontSize = isSmall ? '13px' : (level === 9 ? '24px' : '20px');
            announce.style.opacity = 1;
            const bEl = document.getElementById('uiBadge');
            if (bEl) bEl.textContent = 'CARNIS-SEC — LV' + (level + 1);
            setTimeout(() => { announce.style.opacity = 0; announce.style.fontSize = ''; }, 3200);
        }

        // Trigger Tactical Comms Transmission if available (Hanya untuk Sektor awal 1-9; Sektor 10-15 telah memiliki narasi sinematik Interlude agar tidak muncul script dobel)
        if (level < 9 && typeof SECTOR_TRANSMISSIONS !== 'undefined' && SECTOR_TRANSMISSIONS[level]) {
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
    const ekgEl = hudEl('ekgCanvas');
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

function getCoopExitSquadStatus() {
    if (!exitPos || !players || players.length <= 1) {
        return { allReady: true, count: 1, total: 1 };
    }
    let activeTotal = 0;
    let inExitCount = 0;
    const exitRadius = 52;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p) continue;
        if (p.hp > 0 && !p.downed) {
            activeTotal++;
            if (dist(p, exitPos) <= exitRadius) {
                inExitCount++;
            }
        }
    }
    if (activeTotal === 0) return { allReady: true, count: 0, total: 0 };
    return {
        allReady: inExitCount >= activeTotal,
        count: inExitCount,
        total: activeTotal
    };
}

let activeLoadingInterval = null;
function triggerFacilityLoading(options, onComplete) {
    const screen = document.getElementById('facilityLoadingScreen');
    if (!screen) {
        if (options && typeof options.onPrepare === 'function') {
            try { options.onPrepare(); } catch (_) {}
        }
        if (typeof onComplete === 'function') onComplete();
        return;
    }
    if (activeLoadingInterval) {
        clearInterval(activeLoadingInterval);
        activeLoadingInterval = null;
    }
    const headerEl = document.getElementById('loadingHeaderTag');
    const statusEl = document.getElementById('loadingStatusText');
    const barEl = document.getElementById('loadingProgressBar');
    const stepEl = document.getElementById('loadingStepNum');
    const pctEl = document.getElementById('loadingPercent');
    const tipMsgEl = document.getElementById('loadingTipMsg');

    const opts = (typeof options === 'object' && options) ? options : {};
    const title = opts.title || tt('loading_boot_title');
    // Durasi ideal terkalibrasi: ~1250ms (tidak terlalu cepat, tidak lama, semua sistem mantap siap)
    const duration = opts.duration || 1250;
    const steps = opts.steps || [
        tt('loading_step_1'),
        tt('loading_step_2'),
        tt('loading_step_3'),
        tt('loading_step_4')
    ];
    const isInstant = opts.instant !== false;

    if (headerEl) headerEl.textContent = title;
    if (barEl) barEl.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';
    if (stepEl) stepEl.textContent = 'MODUL 01 / 0' + steps.length;
    if (statusEl) statusEl.textContent = steps[0];
    if (tipMsgEl) {
        const tipIdx = Math.floor(Math.random() * 8) + 1;
        tipMsgEl.textContent = tt('loading_tip_' + tipIdx);
    }

    screen.style.display = 'flex';
    if (isInstant) {
        screen.classList.add('curtain-instant');
    }
    screen.classList.add('active');
    void screen.offsetWidth;

    // SEGERA jalankan onPrepare saat tirai sudah menutup rapat agar semua sistem siap
    if (typeof opts.onPrepare === 'function') {
        try {
            opts.onPrepare();
        } catch (err) {
            console.error('Error during loading onPrepare:', err);
        }
    }

    // Pastikan frame pertama game ter-render di bawah tirai loading
    if (typeof gameState !== 'undefined' && gameState === 'playing' && typeof renderFrame === 'function') {
        try { renderFrame(); } catch (_) {}
    }

    const startTime = performance.now();
    activeLoadingInterval = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / duration);
        const pct = Math.floor(progress * 100);
        if (barEl) barEl.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        const stepIdx = Math.min(steps.length - 1, Math.floor(progress * steps.length));
        if (stepEl) stepEl.textContent = 'MODUL 0' + (stepIdx + 1) + ' / 0' + steps.length;
        if (statusEl) statusEl.textContent = steps[stepIdx];

        if (progress >= 1) {
            clearInterval(activeLoadingInterval);
            activeLoadingInterval = null;

            if (barEl) barEl.style.width = '100%';
            if (pctEl) pctEl.textContent = '100%';
            if (stepEl) stepEl.textContent = 'MODUL 0' + steps.length + ' / 0' + steps.length;
            if (statusEl) statusEl.textContent = steps[steps.length - 1];

            // Render ulang 1 frame lagi untuk memastikan sinkronisasi kanvas & HUD sempurna
            if (typeof gameState !== 'undefined' && gameState === 'playing' && typeof renderFrame === 'function') {
                try { renderFrame(); } catch (_) {}
            }

            // Jeda sejenak (150ms) pada 100% agar status modul terverifikasi mata
            setTimeout(() => {
                screen.classList.remove('curtain-instant');
                void screen.offsetWidth;
                screen.classList.remove('active');
                setTimeout(() => {
                    screen.style.display = 'none';
                    if (typeof onComplete === 'function') onComplete();
                }, 340);
            }, 150);
        }
    }, 28);
}
window.triggerFacilityLoading = triggerFacilityLoading;
window.getCoopExitSquadStatus = getCoopExitSquadStatus;

function updateUI() {
    if (isEndlessMode) {
        setHudText(hudEl('lblLevel'), lang === 'en' ? 'Wave:' : 'Gelombang:');
        setHudText(hudEl('levelText'), endlessWave || 1);
        setHudText(hudEl('levelMaxText'), ' (∞)');
        setHudText(hudEl('modeText'), 'HORDE');
    } else {
        setHudText(hudEl('lblLevel'), lang === 'en' ? 'Level:' : 'Level:');
        setHudText(hudEl('levelText'), currentLevel + 1);
        setHudText(hudEl('levelMaxText'), ' / ' + LEVELS);
        setHudText(hudEl('modeText'), currentLevel % 2 === 1 ? tt('mode_light') : tt('mode_dark'));
    }
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
    let unlocked = false;
    if (isEndlessMode) {
        setHudText(hudEl('artifactText'), '—');
        setHudText(hudEl('exitText'), endlessWaveCleared ? tt('endless_evac_open') : tt('endless_objective'));
    } else {
        unlocked = artifacts.length > 0 && coinsCollected >= artifacts.length;
        setHudText(hudEl('artifactText'), `${coinsCollected} / ${artifacts.length}`);
        let exitStatus = unlocked ? tt('exit_open') : tt('exit_locked');
        if (unlocked && coopRoomId && players && players.length > 1) {
            const sq = getCoopExitSquadStatus();
            if (!sq.allReady) {
                exitStatus = tt('coop_squad_at_exit').replace('{c}', sq.count).replace('{t}', sq.total);
            }
        }
        setHudText(hudEl('exitText'), exitStatus);
    }
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
    if (!e || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    // Cegah tembus dinding labirin akibat teleport/delta spike ekstrem
    const distDelta = Math.hypot(dx, dy);
    if (distDelta > 32) {
        const factor = 32 / distDelta;
        dx *= factor;
        dy *= factor;
    }
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
    const q = (settings && settings.quality) || 'hd';
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

// 
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
    const dLevelLbl = document.getElementById('deathLevelLbl');
    if (dLevel) {
        if (isEndlessMode) {
            if (dLevelLbl) dLevelLbl.textContent = lang === 'en' ? 'Wave reached:' : 'Gelombang tercapai:';
            dLevel.textContent = (lang === 'en' ? 'Wave ' : 'Gelombang ') + endlessWave + ' (∞)';
        } else {
            if (dLevelLbl) dLevelLbl.textContent = lang === 'en' ? 'Sector reached:' : 'Sektor tercapai:';
            dLevel.textContent = (currentLevel + 1) + ' / ' + LEVELS;
        }
    }
    if (isEndlessMode) {
        const high = loadHigh();
        const prevWave = Math.floor(Number(high.endlessBestWave || 0));
        if (endlessWave > prevWave) {
            high.endlessBestWave = endlessWave;
            saveHigh(high);
        }
    }
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

    // Talenta Aegis Kinetic Barrier: Menyerap 1 serangan penuh
    if (player && player.aegisShield > 0) {
        player.aegisShield = 0;
        player.aegisCooldown = 1500; // 25s pada 60fps
        player.invincible = 35;
        addShake(6);
        addShockwave(player.x, player.y, 45, '#00f0ff', 18);
        addParticle(player.x, player.y, '#00f0ff', 16, 5, 24);
        sHit();
        floatingTexts.push({
            x: player.x,
            y: player.y - 20,
            text: (lang === 'en' ? 'AEGIS SHIELD ABSORBED!' : 'PERISAI AEGIS MENAHAN!'),
            color: '#00f0ff',
            life: 45,
            maxLife: 45
        });
        return;
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
    if (player && player.talentCritBonus > 0 && Math.random() < player.talentCritBonus) {
        dmg *= (player.talentCritDmg || 1.8);
        customDmg = dmg;
    }
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

        // 4b) Nanite Shards Drop (HSR / Genshin Style Traces currency)
        let naniteDrop = 2;
        if (m.name === 'The Monolith' || m.isBoss) naniteDrop = 60;
        else if (m.size >= 15 || m.name === 'Dark Knight' || m.name === 'Dragon' || m.name === 'Lich' || m.name === 'Beholder') naniteDrop = 12;
        else if (m.name === 'Mimic' || m.name === 'Crawl' || m.name === 'Harvester') naniteDrop = 5;
        if (typeof addNaniteShards === 'function') addNaniteShards(naniteDrop, m.x, m.y);

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
                text: lang === 'en' ? '[ THE MONOLITH DEFEATED — EVACUATION OPEN ]' : '[ THE MONOLITH TUMBANG — EVAKUASI TERBUKA ]',
                color: '#f1c40f', life: 160, maxLife: 160
            });
            sWin();

            // Menempatkan mayat peneliti (Dr. Rudra) dan kertas amplop di samping portal exit
            if (exitPos) {
                level15Corpse = {
                    x: exitPos.x - 38,
                    y: exitPos.y + 6,
                    envelopeX: exitPos.x - 20,
                    envelopeY: exitPos.y + 14,
                    gx: Math.floor((exitPos.x - 38) / CELL),
                    gy: Math.floor((exitPos.y + 6) / CELL),
                    inspected: false
                };
                for (let i = 0; i < 6; i++) {
                    addDecal(level15Corpse.x + (Math.random() - 0.5) * 22, level15Corpse.y + (Math.random() - 0.5) * 18, '#3d0408', 8, 'splat');
                }
            }
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
    if (levelTransition) return;
    levelTransition = true;
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

        if (typeof playNarrativeInterlude === 'function' && typeof NARRATIVE_INTERLUDES !== 'undefined' && NARRATIVE_INTERLUDES[14]) {
            playNarrativeInterlude(14, triggerFinalWin);
        } else if (typeof playEpilogueCutscene === 'function') {
            playEpilogueCutscene(triggerFinalWin);
        } else {
            triggerFinalWin();
        }
        return;
    }

    gameState = 'cutscene';
    levelTransition = true;

    // Cek apakah ada narasi interlude khusus setelah level ini (misal Sektor 11: currentLevel === 9, Sektor 12: currentLevel === 10, dst)
    if (typeof playNarrativeInterlude === 'function' && typeof NARRATIVE_INTERLUDES !== 'undefined' && NARRATIVE_INTERLUDES[currentLevel]) {
        setTimeout(() => {
            playNarrativeInterlude(currentLevel, () => {
                const isMilestone = currentLevel < LEVELS - 1;
                if (isMilestone) {
                    openWeaponSelectModal(currentLevel + 1);
                } else {
                    triggerFacilityLoading({
                        title: tt('loading_sector_title').replace('{s}', currentLevel + 2),
                        duration: 1250,
                        instant: true,
                        onPrepare: () => {
                            levelTransition = false;
                            gameState = 'playing';
                            initLevel(currentLevel + 1);
                        }
                    });
                }
            });
        }, 500);
        return;
    }

    // Hadiah Kartu Upgrade/Augmentasi setelah setiap sektor berhasil diselesaikan
    const isArsenalMilestone = currentLevel < LEVELS - 1;

    if (isArsenalMilestone) {
        setTimeout(() => {
            openWeaponSelectModal(currentLevel + 1);
        }, 1000);
        return;
    }

    setTimeout(() => {
        triggerFacilityLoading({
            title: tt('loading_sector_title').replace('{s}', currentLevel + 2),
            duration: 1250,
            instant: true,
            onPrepare: () => {
                levelTransition = false;
                gameState = 'playing';
                initLevel(currentLevel + 1);
            }
        });
    }, 1000);
}

let pendingNextLevel = null;
function openWeaponSelectModal(nextLv) {
    pendingNextLevel = nextLv;
    const modal = document.getElementById('weaponSelectScreen');
    const grid = document.getElementById('weaponCardsContainer');
    if (!modal || !grid) {
        levelTransition = false;
        gameState = 'playing';
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
        levelTransition = false;
        gameState = 'playing';
        initLevel(nextLv);
        return;
    }

    grid.innerHTML = '';
    choices.forEach(ch => {
        const item = ch.item;
        const card = document.createElement('div');
        card.className = 'weapon-card' + (ch.type === 'perk' ? ' perk-card' : '');
        card.style.cursor = 'pointer';
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', tt(item.nameKey));
        card.onclick = () => selectWeaponUpgrade(ch.key, ch.type);
        card.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectWeaponUpgrade(ch.key, ch.type);
            }
        };
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
            <button class="btn-choose-weapon" type="button" onclick="event.stopPropagation(); selectWeaponUpgrade('${ch.key}', '${ch.type}')">
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
    triggerFacilityLoading({
        title: tt('loading_sector_title').replace('{s}', next + 1),
        duration: 1250,
        instant: true,
        onPrepare: () => {
            levelTransition = false;
            gameState = 'playing';
            hideCursor();
            initLevel(next);
        }
    });
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
        if (tutorialActive && tutorialStep === 2) {
            advanceTutorialStep(2);
        }
        updateUI();
    }
}

function cycleWeapon(reverse = false) {
    if (typeof isEditingTouchLayout !== 'undefined' && isEditingTouchLayout) return;
    if (!player || !player.weapons || player.weapons.length <= 1) return;
    const curIdx = player.weapons.indexOf(player.currentWeapon);
    const nextIdx = (curIdx + (reverse ? -1 : 1) + player.weapons.length) % player.weapons.length;
    switchWeapon(nextIdx);
}

let isTouchAtkPressed = false;
function playerAttack(fromTouch) {
    if (fromTouch || document.body.classList.contains('touch-on')) {
        // Smart Mobile Auto-Aim: target closest active anomaly within sight radius
        let closestFoe = null;
        let closestDistSq = 360 * 360; // ~12 cells radius
        for (let i = 0; i < monsters.length; i++) {
            const m = monsters[i];
            if (!m || m.dead) continue;
            const ddx = m.x - player.x;
            const ddy = m.y - player.y;
            const dsq = ddx * ddx + ddy * ddy;
            if (dsq < closestDistSq) {
                closestDistSq = dsq;
                closestFoe = m;
            }
        }
        if (closestFoe) {
            player.aimAngle = Math.atan2(closestFoe.y - player.y, closestFoe.x - player.x);
            player.facingAngle = player.aimAngle;
        } else if (Math.abs(touchMove.dx) > 0.1 || Math.abs(touchMove.dy) > 0.1) {
            player.aimAngle = Math.atan2(touchMove.dy, touchMove.dx);
            player.facingAngle = player.aimAngle;
        }
    }
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
            const wpc = getWorldPerCss();
            const wx = cameraX + (mouseX - W / 2) * wpc;
            const wy = cameraY + (mouseY - H / 2) * wpc;
            player.facing = Math.atan2(wy - player.y, wx - player.x);
        }
    } else {
        const wpc = getWorldPerCss();
        const wx = cameraX + (mouseX - W / 2) * wpc;
        const wy = cameraY + (mouseY - H / 2) * wpc;
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

    // Major Talent: Plasma Arc Wave (Setiap 3 serangan melepaskan gelombang busur sabit plasma)
    if (player && player.talentPlasma > 0) {
        player.plasmaArcHits = (player.plasmaArcHits || 0) + 1;
        if (player.plasmaArcHits >= 3) {
            player.plasmaArcHits = 0;
            const arcSpeed = 12;
            projectiles.push({
                x: player.x + Math.cos(player.facing) * 16,
                y: player.y + Math.sin(player.facing) * 16,
                dx: Math.cos(player.facing) * arcSpeed,
                dy: Math.sin(player.facing) * arcSpeed,
                life: 36,
                isPlayer: true,
                kind: 'plasma_arc',
                color: '#c084fc',
                dmg: player.atk * 1.5,
                hitRadius: 18,
                pierce: 6,
                hitMonsters: []
            });
            sEMPBlast();
            addParticle(player.x, player.y, '#c084fc', 8, 3, 14);
            floatingTexts.push({
                x: player.x, y: player.y - 20,
                text: 'PLASMA ARC!',
                color: '#c084fc', life: 35, maxLife: 35
            });
        }
    }
}

function updatePlayer() {
    // Talenta Nano-Repair: Regenerasi perlahan saat HP kritis
    if (player.talentRegen > 0 && player.hp > 0 && player.hp < player.maxHp * 0.40) {
        player.talentRegenTimer = (player.talentRegenTimer || 0) + 1;
        if (player.talentRegenTimer >= 150) { // 2.5s
            player.talentRegenTimer = 0;
            player.hp = Math.min(player.maxHp, player.hp + player.talentRegen);
            addParticle(player.x, player.y, '#2ecc71', 4, 1.5, 12);
            updateUI();
        }
    }
    // Talenta Aegis Kinetic Barrier: Pengisian ulang perisai
    if (player.talentAegis && player.aegisShield === 0) {
        if (player.aegisCooldown > 0) {
            player.aegisCooldown--;
            if (player.aegisCooldown <= 0) {
                player.aegisShield = 1;
                addParticle(player.x, player.y, '#00f0ff', 14, 3, 20);
                floatingTexts.push({
                    x: player.x,
                    y: player.y - 24,
                    text: (lang === 'en' ? 'AEGIS BARRIER ONLINE!' : 'PERISAI AEGIS AKTIF!'),
                    color: '#00f0ff',
                    life: 40,
                    maxLife: 40
                });
            }
        }
    }

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

    // Absolute Godmode Protection
    if (typeof godmode !== 'undefined' && godmode) {
        player.hp = Math.max(player.maxHp, 999);
        player.maxHp = Math.max(player.maxHp, 999);
        player.invincible = 0;
        player.freezeTimer = 0;
        player.poisonTimer = 0;
        player.burnTimer = 0;
    }

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
            if (player.afterimages.length > 10) player.afterimages.shift();
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
            if (thermalTrails.length > 25) thermalTrails.shift();
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
            if (sub) sub.textContent = `${lang === 'id' ? 'Kalibrasi aktuator gerak' : 'Calibrating movement actuators'}: ${Math.min(50, Math.floor(tutorialMoveDist))}/50px`;
            const status = document.getElementById('tutStatus');
            if (status) status.textContent = `${Math.min(50, Math.floor(tutorialMoveDist))}/50px`;
            if (tutorialMoveDist >= 50) {
                advanceTutorialStep(0);
            }
        }
    }

    if (document.body.classList.contains('touch-on')) {
        if (touchMove && touchMove.active && (touchMove.dx !== 0 || touchMove.dy !== 0)) {
            player.facing = Math.atan2(touchMove.dy, touchMove.dx);
        }
    } else if (mouseActive) {
        const wpc = getWorldPerCss();
        const wx = cameraX + (mouseX - W / 2) * wpc;
        const wy = cameraY + (mouseY - H / 2) * wpc;
        player.facing = Math.atan2(wy - player.y, wx - player.x);
    }

    // Auto-fire minigun saat space atau klik mouse ditahan terus
    if ((keys[' '] || isMouseDown) && player.currentWeapon === 'minigun') {
        playerAttack();
    }
    // Serangan berulang pada layar sentuh saat tombol serang ditahan
    if (isTouchAtkPressed && gameState === 'playing') {
        playerAttack(true);
    }

    if (player.invincible > 0) player.invincible--;
    if (player.attackAnim > 0) player.attackAnim--;
    if (dashCooldown > 0) dashCooldown--;
    if (attackCooldown > 0) attackCooldown--;
    if (screenShake > 0) screenShake--;
    if (hurtFlash > 0) hurtFlash--;

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

    let artifactUiDirty = false;
    for (let ai = 0; ai < artifacts.length; ai++) {
        const a = artifacts[ai];
        if (a.collected) continue;

        let collector = null;
        if (players && players.length > 0) {
            for (let pi = 0; pi < players.length; pi++) {
                const p = players[pi];
                if (!p || p.hp <= 0 || p.downed) continue;
                if (dist(a, p) < 38) {
                    collector = p;
                    break;
                }
            }
        } else if (player && dist(a, player) < 38) {
            collector = player;
        }

        if (collector) {
            a.collected = true;
            coinsCollected++;
            sGeneratorOnline();
            addParticle(a.x, a.y, '#00f0ff', 24, 6, 45);
            addParticle(a.x, a.y, '#2ecc71', 18, 5, 35);
            addShockwave(a.x, a.y, 50, '#00f0ff', 20);
            addShockwave(a.x, a.y, 85, '#2ecc71', 30);
            collector.hp = Math.min(collector.maxHp, collector.hp + 12);
            floatingTexts.push({
                x: a.x,
                y: a.y - 20,
                text: tt('gen_restored'),
                color: '#00f0ff',
                life: 85,
                maxLife: 85
            });
            if (tutorialActive && tutorialStep === 3) {
                advanceTutorialStep(3);
            }
            if (artifacts && artifacts.length > 0 && coinsCollected >= artifacts.length) {
                sWin();
                addShockwave(collector.x, collector.y, 140, '#2ecc71', 35);
                floatingTexts.push({
                    x: collector.x,
                    y: collector.y - 45,
                    text: tt('gen_all_online'),
                    color: '#2ecc71',
                    life: 140,
                    maxLife: 140
                });
                if (currentLevel === 0 && !menuDemo) {
                    spawnTutorialEvacuationAmbush();
                }
            }
            artifactUiDirty = true;
        }
    }
    if (artifactUiDirty) {
        updateUI();
    }

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
    if (wreckedRobot && currentLevel === 9 && !wreckedRobot.inspected && dist(player, wreckedRobot) < 45) {
        wreckedRobot.inspected = true;
        openRobotMemoryModal();
    }

    // Sector 15 Fallen Researcher Envelope: Pajangan Dokumen di Samping Exit Portal
    // (Pemain dapat berinteraksi secara sukarela dengan tombol E / sentuh; seluruh cerita lengkap berjalan di cutscene epilog setelah menyentuh exit)
    if (level15Corpse && currentLevel === LEVELS - 1 && !level15Corpse.inspected && player) {
        const d = dist(player, { x: level15Corpse.envelopeX, y: level15Corpse.envelopeY });
        if (d < 38) {
            level15Corpse.inspected = true;
            openFinalLetterModal();
        }
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

    if (exitPos && !levelTransition && gameState === 'playing' && dist(player, exitPos) < 36) {
        if (isEndlessMode) {
            // Mode Endless Survival: Portal exit berfungsi sebagai Evakuasi Taktis!
            let aliveMonsters = 0;
            if (monsters && monsters.length) {
                for (let mi = 0; mi < monsters.length; mi++) {
                    if (monsters[mi] && monsters[mi].hp > 0) aliveMonsters++;
                }
            }
            if (aliveMonsters === 0 || endlessWaveCleared) {
                levelTransition = true;
                evacuateEndlessSurvival();
            } else if (lockMsgCooldown <= 0) {
                sLocked();
                if (!menuDemo) {
                    floatingTexts.push({
                        x: player.x, y: player.y - 25,
                        text: tt('endless_evac_locked'),
                        color: '#ff9f43',
                        life: 90,
                        maxLife: 90
                    });
                }
                lockMsgCooldown = 80;
            }
        } else if (coinsCollected >= artifacts.length) {
            const isCoopSession = Boolean(coopRoomId && players && players.length > 1);
            if (isCoopSession) {
                const squad = getCoopExitSquadStatus();
                if (squad.allReady) {
                    sExitOpen();
                    nextLevel();
                } else if (lockMsgCooldown <= 0) {
                    sLocked();
                    if (!menuDemo) {
                        floatingTexts.push({
                            x: exitPos.x,
                            y: exitPos.y - 25,
                            text: tt('coop_waiting_squad').replace('{c}', squad.count).replace('{t}', squad.total),
                            color: '#00f0ff',
                            life: 75,
                            maxLife: 75
                        });
                    }
                    lockMsgCooldown = 60;
                }
            } else {
                sExitOpen();
                nextLevel();
            }
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

function updateMonstersGuestCoop() {
    if (!monsters || !monsters.length) return;

    // Update Boss HUD Status jika ada boss aktif
    const activeBoss = monsters.find(m => m.hp > 0 && (m.isBoss || m.isMonolith || m.name === 'The Monolith' || m.name === 'Mother Harvester'));
    const bossHud = hudEl('bossHud');
    if (bossHud) {
        if (activeBoss && gameState === 'playing' && !menuDemo) {
            if (bossHud.style.display !== 'block') bossHud.style.display = 'block';
            const maxHpSafe = Math.max(1, Number(activeBoss.maxHp) || 1);
            const pct = Math.max(0, Math.min(1, (Number(activeBoss.hp) || 0) / maxHpSafe));
            const fill = hudEl('bossBarFill');
            if (fill) {
                const widthStr = Math.round(pct * 100) + '%';
                if (fill.style.width !== widthStr) fill.style.width = widthStr;
            }
            const nameEl = hudEl('bossHudName');
            setHudText(nameEl, activeBoss.name.toUpperCase());
            const phaseEl = hudEl('bossHudPhase');
            if (phaseEl) {
                setHudText(phaseEl, pct > 0.66 ? tt('boss_monolith_phase1') : (pct > 0.33 ? tt('boss_monolith_phase2') : tt('boss_monolith_phase3')));
            }
        } else if (bossHud.style.display !== 'none') {
            bossHud.style.display = 'none';
        }
    }

    // Perhalus pergerakan monster mengikuti posisi otoritatif dari Host (interpolasi mulus 60fps)
    for (let i = 0; i < monsters.length; i++) {
        const m = monsters[i];
        if (!m || m.hp <= 0) continue;

        if (typeof m.targetX === 'number' && typeof m.targetY === 'number') {
            const d = Math.hypot(m.targetX - m.x, m.targetY - m.y);
            if (d > 48) {
                m.x = m.targetX;
                m.y = m.targetY;
            } else if (d > 0.5) {
                m.x += (m.targetX - m.x) * 0.35;
                m.y += (m.targetY - m.y) * 0.35;
            }
        }

        // Efek kosmetik & animasi visual monster
        if (m.hitFlash > 0) m.hitFlash--;
        if (m.blink > 0) m.blink--;
        else m.blink = 60 + Math.floor(Math.random() * 180);
    }
}

function updateMonsters() {
    if (typeof coopRoomId !== 'undefined' && coopRoomId && !isCoopHost) {
        // Mode Guest Co-op: Host memegang kontrol otoritatif monster secara penuh.
        // Klien cukup menginterpolasikan posisi ke target snapshot dan memperbarui visual kosmetik,
        // tanpa beban kalkulasi BFS pathfinding dan separation forces O(N^2).
        updateMonstersGuestCoop();
        return;
    }

    separationForces();

    // Update Boss HUD Status
    const activeBoss = monsters.find(m => m.hp > 0 && (m.isBoss || m.isMonolith || m.name === 'The Monolith' || m.name === 'Mother Harvester'));
    const bossHud = hudEl('bossHud');
    if (bossHud) {
        if (activeBoss && gameState === 'playing' && !menuDemo) {
            if (bossHud.style.display !== 'block') bossHud.style.display = 'block';
            const maxHpSafe = Math.max(1, Number(activeBoss.maxHp) || 1);
            const pct = Math.max(0, Math.min(1, (Number(activeBoss.hp) || 0) / maxHpSafe));
            const fill = hudEl('bossBarFill');
            if (fill) {
                const widthStr = Math.round(pct * 100) + '%';
                if (fill.style.width !== widthStr) fill.style.width = widthStr;
            }
            const nameEl = hudEl('bossHudName');
            setHudText(nameEl, activeBoss.name.toUpperCase());
            const phaseEl = hudEl('bossHudPhase');
            if (phaseEl) {
                setHudText(phaseEl, pct > 0.66 ? tt('boss_monolith_phase1') : (pct > 0.33 ? tt('boss_monolith_phase2') : tt('boss_monolith_phase3')));
            }
        } else if (bossHud.style.display !== 'none') {
            bossHud.style.display = 'none';
        }
    }

    const diffStatMult = typeof getDiffStatMult === 'function' ? getDiffStatMult() : 1.0;
    const diffSpeedMult = typeof getDiffSpeedMult === 'function' ? getDiffSpeedMult() : 1.0;

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

            const targetP = (players && players.length > 1) ? getClosestActivePlayer(m) : player;
            const pdist = dist(m, targetP);
            let steppedOnTrap = false;

            if (pdist < m.size + 14) {
                steppedOnTrap = true;
            } else if (m.filaments && m.filaments.length && m.filamentTrapCooldown <= 0) {
                for (let f = 0; f < m.filaments.length; f++) {
                    const pts = m.filaments[f];
                    for (let p = 0; p < pts.length - 1; p++) {
                        const dSeg = distToSegment(targetP.x, targetP.y, pts[p].x, pts[p].y, pts[p + 1].x, pts[p + 1].y);
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
                    let activeCrawls = 0;
                    for (let ki = 0; ki < monsters.length; ki++) {
                        if (monsters[ki] && monsters[ki].name === 'Crawl' && monsters[ki].hp > 0) activeCrawls++;
                    }
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

        const targetP = (players && players.length > 1) ? getClosestActivePlayer(m) : player;
        const pdist = dist(m, targetP);
        let detection = currentLevel % 2 === 0 ? 150 : 200;
        detection *= getDiffDetectMult();
        if (m.ai === 'chase') detection *= 1.25;
        const sight = pdist < detection && hasLineOfSight(m, targetP);
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
            let aliveMonstersCount = 0;
            for (let ki = 0; ki < monsters.length; ki++) {
                if (monsters[ki] && monsters[ki].hp > 0) aliveMonstersCount++;
            }
            if (m.lichSummonTimer <= 0 && pdist < 260 && aliveMonstersCount < 24) {
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
    return Math.round((6 + currentLevel * 0.8) * getDiffStatMult());
}

function updateTraps() {
    traps.forEach(tr => {
        if (tr.state === 'hidden') {
            if (tr.timer > 0 && --tr.timer <= 0) tr.state = 'armed';
            return;
        }
        if (tr.state === 'triggered' || tr.state === 'cooldown') {
            if (--tr.cool <= 0) {
                if (tr.state === 'triggered') { tr.state = 'cooldown'; tr.cool = 130; }
                else tr.state = 'armed';
            }
            return;
        }
        if (tr.state !== 'armed') return;
        if (typeof godmode !== 'undefined' && godmode) return;
        if (player.invincible > 0) return;
        if (Math.hypot(player.x - tr.x, player.y - tr.y) >= 22) return;
        let dmg = trapDamage();
        if (player && player.perkNano) {
            dmg *= Math.max(0.5, 1 - player.perkNano * 0.25);
        }
        player.hp -= dmg;
        player.invincible = 45;
        screenShake = 6;
        hurtFlash = 6;
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

            // Major Talent: Plasma Arc Wave (Menembus monster dalam jalurnya)
            if (p.kind === 'plasma_arc') {
                if (monsters) {
                    p.hitMonsters = p.hitMonsters || [];
                    for (let i = 0; i < monsters.length; i++) {
                        const m = monsters[i];
                        if (m && m.hp > 0 && !p.hitMonsters.includes(m)) {
                            if (dist(p, m) < p.hitRadius + m.size) {
                                p.hitMonsters.push(m);
                                attackMonster(m, p.dmg);
                                addParticle(m.x, m.y, '#c084fc', 8, 3, 14);
                                if (p.hitMonsters.length >= (p.pierce || 6)) return false;
                            }
                        }
                    }
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
                const hasFrontFace = (y + 1 < mazeH && maze[y + 1] && maze[y + 1][x] !== 1);
                let wallColor;
                if (isLight) {
                    const g = Math.floor(38 + brightness * 34);
                    wallColor = `rgb(${g + 8}, ${g}, ${g - 4})`;
                } else {
                    const g = Math.floor(30 + brightness * 50);
                    wallColor = `rgb(${g - 5}, ${g}, ${g + 15})`;
                }
                ctx.fillStyle = wallColor;

                if (hasFrontFace) {
                    // Pseudo 2.5D: Wall roof surface (top portion)
                    ctx.fillRect(sx, sy, CELL, CELL - 7);

                    // Roof top highlight bevel
                    ctx.fillStyle = isLight ? `rgba(255,200,180,${0.22 * brightness})` : `rgba(100,200,255,${0.25 * brightness})`;
                    ctx.fillRect(sx, sy, CELL, 2);

                    // Inner roof inset border
                    ctx.fillStyle = isLight ? `rgba(0,0,0,${0.18 * brightness})` : `rgba(0,0,20,${0.25 * brightness})`;
                    ctx.fillRect(sx + 2, sy + 2, CELL - 4, CELL - 11);

                    // Wall front-face shadow bevel (seam between roof and front face)
                    ctx.fillStyle = isLight ? 'rgba(25, 18, 12, 0.45)' : 'rgba(8, 14, 28, 0.65)';
                    ctx.fillRect(sx, sy + CELL - 8, CELL, 1);

                    // Pseudo 2.5D: Wall vertical front face (facing downward toward corridor)
                    ctx.fillStyle = isLight ? 'rgba(18, 12, 8, 0.88)' : 'rgba(10, 14, 22, 0.94)';
                    ctx.fillRect(sx, sy + CELL - 7, CELL, 7);

                    // Front face subtle vertical reinforcing seams
                    ctx.fillStyle = isLight ? 'rgba(255, 140, 80, 0.08)' : 'rgba(0, 240, 255, 0.06)';
                    ctx.fillRect(sx + 6, sy + CELL - 7, 1, 7);
                    ctx.fillRect(sx + CELL - 7, sy + CELL - 7, 1, 7);
                } else {
                    // Full solid wall tile (enclosed by other walls)
                    ctx.fillRect(sx, sy, CELL, CELL);
                    ctx.fillStyle = isLight ? `rgba(0,0,0,${0.2 * brightness})` : `rgba(0,0,20,${0.3 * brightness})`;
                    ctx.fillRect(sx + 2, sy + 2, CELL - 2, CELL - 2);

                    if (isLight) {
                        ctx.fillStyle = `rgba(255,140,120,${0.1 * brightness})`;
                        ctx.fillRect(sx, sy, CELL, 2);
                        ctx.fillRect(sx, sy, 2, CELL);
                    }
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

                // Industrial panel seam lines (subtle tile borders)
                ctx.fillStyle = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.22)';
                ctx.fillRect(sx + CELL - 1, sy, 1, CELL);
                ctx.fillRect(sx, sy + CELL - 1, CELL, 1);

                // Pseudo 2.5D: Drop shadow cast by wall directly above onto corridor floor
                if (y > 0 && maze[y - 1] && maze[y - 1][x] === 1) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
                    ctx.fillRect(sx, sy, CELL, 5);
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
                    ctx.fillRect(sx, sy + 5, CELL, 3);
                }

                // Deterministic industrial floor grating / rivet accents (zero GC allocation)
                const tileSeed = (x * 7 + y * 13);
                if (tileSeed % 11 === 0) {
                    // Metal ventilation grating
                    ctx.fillStyle = isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(0, 0, 0, 0.36)';
                    ctx.fillRect(sx + 6, sy + 9, CELL - 12, 2);
                    ctx.fillRect(sx + 6, sy + 15, CELL - 12, 2);
                    ctx.fillRect(sx + 6, sy + 21, CELL - 12, 2);
                } else if ((x * 11 + y * 5) % 13 === 0) {
                    // Corner steel rivets
                    ctx.fillStyle = isLight ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.09)';
                    ctx.fillRect(sx + 4, sy + 4, 2, 2);
                    ctx.fillRect(sx + CELL - 6, sy + 4, 2, 2);
                    ctx.fillRect(sx + 4, sy + CELL - 6, 2, 2);
                    ctx.fillRect(sx + CELL - 6, sy + CELL - 6, 2, 2);
                } else if ((x + y) % 3 === 0) {
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

                // Pseudo 2.5D drop shadow if wall above
                if (y > 0 && maze[y - 1] && maze[y - 1][x] === 1) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
                    ctx.fillRect(sx, sy, CELL, 5);
                }

                ctx.fillStyle = isLight ? `rgba(255,120,60,${0.3 * brightness})` : `rgba(255,60,60,${0.25 * brightness})`;
                ctx.beginPath();
                ctx.arc(sx + CELL/2, sy + CELL/2, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawPlayer(targetPlayer) {
    const p = targetPlayer || getLocalPlayer();
    if (!p) return;
    const isLocal = (p === getLocalPlayer());
    const sx = p.x - cameraX + W / 2;
    const sy = p.y - cameraY + H / 2;

    // Phase Dash After-Images (Holographic Cyan Ghosting Trail)
    if (p.afterimages && p.afterimages.length) {
        p.afterimages.forEach(ai => {
            const asx = ai.x - cameraX + W / 2;
            const asy = ai.y - cameraY + H / 2;
            ctx.save();
            ctx.translate(asx, asy);
            ctx.rotate(ai.facing || p.facing);
            ctx.globalAlpha = (ai.life / ai.maxLife) * 0.38;
            ctx.fillStyle = '#00f0ff';
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 10;
            // Ghostly BMPT tankette silhouette
            ctx.fillRect(-14, -11, 28, 22);
            ctx.restore();
        });
    }

    // Hanya flicker saat terkena damage biasa (post-hit invincibility: 1-60 frame).
    // Jangan pernah menyembunyikan pemain saat godmode, menuDemo, dash, shield, atau nilai invincibility tinggi.
    const isHurtFlicker = !menuDemo && !godmode && !p.dashing && (!p.shieldTimer || p.shieldTimer <= 0) && (p.invincible > 0 && p.invincible <= 60);
    if (isHurtFlicker && Math.floor(p.invincible / 3) % 2 === 0) return;

    ctx.save();
    ctx.translate(sx, sy);

    // Divine Golden Aegis Aura for Godmode
    if (godmode) {
        ctx.save();
        const gPulse = 0.6 + 0.4 * Math.sin(Date.now() / 140);
        ctx.strokeStyle = `rgba(255, 215, 0, ${0.45 * gPulse})`;
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 14 * gPulse;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, (p.size || 10) + 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Diegetic Holographic Dash Cooldown Ring under BMPT Chassis
    const dashMax = 45;
    const dashRatio = dashCooldown > 0 ? (dashCooldown / dashMax) : 0;
    ctx.beginPath();
    ctx.arc(0, 0, p.size + 6, -Math.PI / 2, -Math.PI / 2 + (1 - dashRatio) * Math.PI * 2);
    ctx.strokeStyle = dashCooldown <= 0 ? 'rgba(0, 240, 255, 0.75)' : 'rgba(255, 71, 87, 0.45)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const isMoving = (typeof keys !== 'undefined' && (keys['w'] || keys['s'] || keys['a'] || keys['d'] || keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'])) || (typeof touchMove !== 'undefined' && touchMove.active) || p.dashing;
    const isLowHp = p.hp < (p.maxHp * 0.3);
    const microJitter = 1.0 + Math.sin(Date.now() * 0.007) * 0.025;
    const flashFlicker = ((isLowHp && Math.random() < 0.22) ? (0.25 + Math.random() * 0.5) : 1.0) * microJitter;

    
    // 1. DUAL TACTICAL HEADLIGHTS (Lampu Sorot Senter Volumetrik & Lens Flare)
    
    const flashLen = currentLevel % 2 === 1 ? 140 : 185;
    const flashSpread = 0.43;

    for (const side of [-1, 1]) {
        ctx.save();
        ctx.rotate(p.facing);
        const lgtY = side * 8.5; // Left & Right headlight emitters on front fenders
        const lgtX = 13;
        const fg = ctx.createRadialGradient(lgtX, lgtY, 4, lgtX + flashLen * 0.7, lgtY, flashLen);
        fg.addColorStop(0, `rgba(255, 245, 210, ${0.58 * flashFlicker})`);
        fg.addColorStop(0.35, `rgba(255, 215, 140, ${0.28 * flashFlicker})`);
        fg.addColorStop(0.75, `rgba(255, 180, 80, ${0.09 * flashFlicker})`);
        fg.addColorStop(1, 'rgba(255, 150, 50, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(lgtX, lgtY);
        ctx.arc(lgtX, lgtY, flashLen, -flashSpread * 0.8, flashSpread * 0.8);
        ctx.closePath();
        ctx.fill();

        // Emitter lens glow flare
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const flareG = ctx.createRadialGradient(lgtX, lgtY, 0, lgtX, lgtY, 8);
        flareG.addColorStop(0, `rgba(255, 255, 230, ${0.85 * flashFlicker})`);
        flareG.addColorStop(0.5, `rgba(255, 200, 100, ${0.35 * flashFlicker})`);
        flareG.addColorStop(1, 'rgba(255, 150, 50, 0)');
        ctx.fillStyle = flareG;
        ctx.beginPath();
        ctx.arc(lgtX, lgtY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.restore();
    }

    
    // 2. BMPT TANKETTE CHASSIS (ROBOT TRACK & WHEEL SYSTEM)
    
    // Rotate entire robot body to player facing direction
    ctx.save();
    ctx.rotate(p.facing);

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
        ctx.strokeStyle = p.dashing ? '#00f0ff' : '#334155';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Animated Tread Cleats (Gigi Roda Track yang Berputar Saat Jalan)
        ctx.strokeStyle = p.dashing ? '#38bdf8' : '#64748b';
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
            ctx.fillStyle = p.dashing ? '#00f0ff' : '#475569';
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
    const hullColor = p.dashing ? '#0f172a' : (isLowHp ? '#2a1215' : '#1e293b');
    const plateColor = p.dashing ? '#1e293b' : (isLowHp ? '#3b1c20' : '#334155');
    const armorAccent = p.dashing ? '#00f0ff' : (isLowHp ? '#ef4444' : '#38bdf8');

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
            const flameLen = p.dashing ? (9 + Math.random() * 8) : (3 + Math.random() * 4);
            ctx.save();
            ctx.fillStyle = p.dashing ? 'rgba(0, 240, 255, 0.95)' : 'rgba(249, 115, 22, 0.85)';
            ctx.shadowColor = p.dashing ? '#00f0ff' : '#f97316';
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

    
    // 3. TOP TURRET & CYCLOPS OPTICAL SENSOR (Mata / Sensor Pintar)
    
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

    
    // 4. TOP-MOUNTED DEPLOYABLE WEAPON PLATFORM (Senjata Muncul di Atas)
    
    const curW = p.currentWeapon || 'knife';
    const recoil = (p.attackAnim > 0) ? Math.min(4, p.attackAnim * 0.4) : 0;

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
        const heatProg = Math.min(1, (p.minigunHeat || 0) / 100);
        const spinSpeed = (p.attackAnim > 0 || isMouseDown || keys[' ']) ? Date.now() * 0.04 : 0;
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

    
    // 5. KINETIC SHIELD DOME OVERLAY (If Shield Active)
    
    if (p.shieldTimer > 0) {
        const sProg = Math.min(1, p.shieldTimer / 150);
        const sRad = p.size + 18 + Math.sin(Date.now() * 0.01) * 2;
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

    
    // 6. FIRING MUZZLE FLASHES & WEAPON IMPACT ANIMATION
    
    if (p.attackAnim > 0) {
        const prog = p.attackAnim / 15;
        if (curW === 'knife') {
            // High-frequency circular saw slash arc
            ctx.strokeStyle = `rgba(249, 115, 22, ${prog})`;
            ctx.lineWidth = 4.5;
            const range = 48 * prog;
            ctx.beginPath();
            ctx.arc(0, 0, range, p.facing - 0.9, p.facing + 0.9);
            ctx.stroke();
            ctx.strokeStyle = `rgba(255, 255, 255, ${prog})`;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.arc(0, 0, range * 0.85, p.facing - 0.75, p.facing + 0.75);
            ctx.stroke();
        } else if (curW === 'rifle' || curW === 'minigun') {
            // Muzzle flash at barrel tip
            const mx = Math.cos(p.facing) * (p.size + 16);
            const my = Math.sin(p.facing) * (p.size + 16);
            ctx.fillStyle = '#fef08a';
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(mx, my, 5 * prog + 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        } else if (curW === 'bazooka') {
            // Heavy Rocket Ignition Backblast
            const bx = -Math.cos(p.facing) * (p.size + 10);
            const by = -Math.sin(p.facing) * (p.size + 10);
            ctx.fillStyle = `rgba(249, 115, 22, ${prog * 0.8})`;
            ctx.beginPath();
            ctx.arc(bx, by, 9 * prog, 0, Math.PI * 2);
            ctx.fill();
        }
    }

        ctx.restore();

    // Diegetic Teammate Callsign Tag & Operative Dot (Co-op Peers)
    if (!isLocal) {
        ctx.save();
        const pCol = (PLAYER_COLORS[(p.peerIndex || 0) % 4] || PLAYER_COLORS[1]).hex;
        ctx.fillStyle = pCol;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = pCol;
        ctx.shadowBlur = 6;
        const tagText = p.callsign || ('P' + ((p.peerIndex || 0) + 1));
        ctx.fillText(tagText, sx, sy - p.size - 14);
        ctx.restore();
    }

    // Co-op Downed Aura & Revive Progress Indicator
    if (p.downed) {
        ctx.save();
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 150);
        ctx.strokeStyle = 'rgba(225, 29, 72, ' + (0.4 + 0.6 * pulse) + ')';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#e11d48';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(sx, sy, (p.size || 10) + 12 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#f43f5e';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(tt('coop_operative_downed'), sx, sy - (p.size || 10) - 22);

        if (p.reviveProgress > 0) {
            const revPct = Math.min(1, p.reviveProgress / 180);
            const barW = 36;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
            ctx.fillRect(sx - barW / 2, sy + (p.size || 10) + 8, barW, 5);
            ctx.fillStyle = '#00f0ff';
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 8;
            ctx.fillRect(sx - barW / 2, sy + (p.size || 10) + 8, barW * revPct, 5);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 0.8;
            ctx.strokeRect(sx - barW / 2, sy + (p.size || 10) + 8, barW, 5);
        }
        ctx.restore();
    }
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

        if (!m.name) m.name = (m.type && m.type.name) || 'Slime';
        if (!m.color) m.color = (m.type && m.type.color) || '#2ecc71';
        if (!m.size) m.size = (m.type && m.type.size) || 12;
        const ph = m.x + m.y + (m.name ? m.name.length : 5);
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
        if (m.hitFlash > 0) {
            // Visceral combat impact: procedural organic squash & stretch
            ctx.scale(1.12, 0.88);
        }

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
            ctx.fillText('[ THE MONOLITH — COELUM CARNIS ]', 0, headTopY - 26);
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
            ctx.fillText(`${Math.ceil(pct * 100)}% — APEX CARNIS TITAN`, 0, barY + 9.5);
        } else if (m.isMotherHarvester || m.name === 'Mother Harvester') {
            const headTopY = -m.size * 1.15;
            ctx.fillStyle = '#ff3333';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 10;
            ctx.fillText(lang === 'en' ? '[ MOTHER HARVESTER — APEX CARNIS ]' : '[ INDUK HARVESTER — APEX CARNIS ]', 0, headTopY - 22);
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
            ctx.fillText(`${Math.ceil(pct * 100)}% — CONGREGENTUR CARNIS`, 0, barY + 8);
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
            if (p.kind === 'plasma_arc') {
                ctx.globalCompositeOperation = 'lighter';
                const angle = Math.atan2(p.dy, p.dx);
                ctx.rotate(angle);
                ctx.strokeStyle = '#c084fc';
                ctx.shadowColor = '#a855f7';
                ctx.shadowBlur = 16;
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.arc(-6, 0, 16, -Math.PI / 3, Math.PI / 3);
                ctx.stroke();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(-6, 0, 15, -Math.PI / 4, Math.PI / 4);
                ctx.stroke();
            } else if (p.kind === 'rifle') {
                ctx.globalCompositeOperation = 'lighter';
                const angle = Math.atan2(p.dy, p.dx);
                ctx.rotate(angle);
                ctx.fillStyle = '#00f0ff';
                ctx.shadowColor = '#00d2d3';
                ctx.shadowBlur = 14;
                ctx.fillRect(-14, -2.2, 28, 4.4);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(-8, -1.1, 18, 2.2);
                ctx.beginPath();
                ctx.arc(14, 0, 2.8, 0, Math.PI * 2);
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
                ctx.globalCompositeOperation = 'lighter';
                const angle = Math.atan2(p.dy, p.dx);
                ctx.rotate(angle);
                ctx.fillStyle = '#ffeaa7';
                ctx.shadowColor = '#fdcb6e';
                ctx.shadowBlur = 8;
                ctx.fillRect(-5, -1.2, 10, 2.4);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(-2, -0.6, 5, 1.2);
            }
            ctx.restore();
        } else {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
            ctx.fill();
            // Intense energy core
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(sx, sy, 2.0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
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
        const sx = a.x - cameraX + W / 2;
        const sy = a.y - cameraY + H / 2 + Math.sin(time * 2 + (a.bobPhase || 0)) * 3;

        if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) return;
        if (!fogOfWar[a.gy] || !fogOfWar[a.gy][a.gx]) return;

        ctx.save();
        ctx.translate(sx, sy);

        if (!a.collected) {
            
            // 1. OFFLINE / CORRUPTED NODE (Pulsing Red)
            
            const pulse = 1 + Math.sin(time * 5 + (a.bobPhase || 0)) * 0.22;
            const glowAlpha = 0.35 + Math.sin(time * 6 + (a.bobPhase || 0)) * 0.2;

            // Warning aura
            ctx.shadowColor = '#ff0033';
            ctx.shadowBlur = 18 * pulse;
            ctx.fillStyle = '#ff0033';
            ctx.globalAlpha = glowAlpha;
            ctx.beginPath();
            ctx.arc(0, 0, 18 * pulse, 0, Math.PI * 2);
            ctx.fill();

            // Geometric housing (Rotated square bracket)
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = '#ff3366';
            ctx.lineWidth = 1.8;
            ctx.save();
            ctx.rotate(time * 1.5 + (a.bobPhase || 0));
            ctx.strokeRect(-10 * pulse, -10 * pulse, 20 * pulse, 20 * pulse);
            ctx.restore();

            // Inner corrupted power core
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#c91c1c';
            ctx.beginPath();
            ctx.arc(0, 0, 7 * pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Blinking red warning indicator dot
            ctx.fillStyle = Math.sin(time * 8) > 0 ? '#ff0033' : '#660011';
            ctx.beginPath();
            ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.restore();

            // Status Text above/below Node
            ctx.save();
            ctx.fillStyle = '#ff4466';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(aTypeName(a.type), sx, sy - 22);

            // Proximity interaction hint if player is near
            if (player && dist(player, a) < 48) {
                const hintPulse = 0.8 + Math.sin(time * 8) * 0.2;
                ctx.globalAlpha = hintPulse;
                ctx.fillStyle = '#00f0ff';
                ctx.font = 'bold 9.5px Arial';
                ctx.fillText(tt('node_prompt_interact'), sx, sy + 22);
            }
            ctx.restore();
        } else {
            
            // 2. ONLINE / RESTORED NODE (Glowing Cyan / Green)
            
            const pulse = 1 + Math.sin(time * 2.5 + (a.bobPhase || 0)) * 0.1;

            // Restored energy aura
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 20 * pulse;
            ctx.fillStyle = '#00f0ff';
            ctx.globalAlpha = 0.25;
            ctx.beginPath();
            ctx.arc(0, 0, 16 * pulse, 0, Math.PI * 2);
            ctx.fill();

            // Steady octagonal power housing
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#2ecc71';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 9 * pulse, 0, Math.PI * 2);
            ctx.stroke();

            // Glowing cyan core
            ctx.fillStyle = '#00f0ff';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.restore();

            // Online label
            ctx.save();
            ctx.fillStyle = '#2ecc71';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('ONLINE [SEC-OK]', sx, sy + 20);
            ctx.restore();
        }
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

    
    // 1. GROUND SCORCH & HEAVY HYDRAULIC OIL SLICK
    
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

    
    // 2. RUSSIAN BMPT CATERPILLAR TRACKS & ROAD WHEELS (DAMAGED)
    
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

    
    // 3. SLOPED ARMORED HULL / MAIN CHASSIS (CHARRED BMPT)
    
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

    
    // 4. BMPT DUAL 30MM 2A42 AUTOCANNON WEAPON MOUNT (TWIN BARRELS)
    
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

    
    // 5. TOP TURRET & DYING CYCLOPS OPTICAL SENSOR
    
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
    const spkEl = document.getElementById('robotMemorySpeaker');
    const txtEl = document.getElementById('robotMemoryText');
    const curLang = (typeof settings !== 'undefined' && settings && settings.lang) ? settings.lang : 'id';
    if (spkEl) spkEl.textContent = '***';
    if (txtEl) {
        txtEl.textContent = curLang === 'en'
            ? '"thats...... bot..... the bot-7 . That was one of our failures while attacking this sector......"'
            : '"itu...... bot..... BOT-7. Itu salah satu kegagalan kami saat menyerang sektor ini......"';
    }
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

// 
function drawLevel15Corpse() {
    if (!level15Corpse || currentLevel !== LEVELS - 1) return;
    const sx = level15Corpse.x - cameraX + W / 2;
    const sy = level15Corpse.y - cameraY + H / 2;

    if (sx < -90 || sx > W + 90 || sy < -90 || sy > H + 90) return;
    const inArena = (currentLevel === LEVELS - 1 && dist(player, level15Corpse) < 380);
    if (!inArena && (!fogOfWar[level15Corpse.gy] || !fogOfWar[level15Corpse.gy][level15Corpse.gx])) return;

    const t = Date.now() / 1000;

    ctx.save();
    ctx.translate(sx, sy);

    // 1. POOL OF COAGULATED BLOOD ON THE CONCRETE FLOOR
    ctx.fillStyle = 'rgba(38, 4, 8, 0.88)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 25, 13, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Inner dark crimson pool sheen
    ctx.fillStyle = 'rgba(88, 10, 18, 0.72)';
    ctx.beginPath();
    ctx.ellipse(-2, 3, 17, 8, -0.15, 0, Math.PI * 2);
    ctx.fill();

    // Blood splatters
    ctx.fillStyle = 'rgba(64, 6, 12, 0.75)';
    ctx.beginPath();
    ctx.arc(-20, 8, 2.2, 0, Math.PI * 2);
    ctx.arc(-14, -10, 1.8, 0, Math.PI * 2);
    ctx.arc(14, 11, 1.8, 0, Math.PI * 2);
    ctx.arc(20, 5, 2.0, 0, Math.PI * 2);
    ctx.fill();

    // 2. TACTICAL TROUSERS & BOOTS (SLUMPED POSE)
    ctx.save();
    ctx.rotate(-0.16);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-17, 2, 15, 5);
    ctx.fillRect(-19, 7, 17, 5);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-24, 2, 7, 5.5);
    ctx.fillRect(-26, 7, 7, 5.5);
    ctx.restore();

    // 3. SCIENTIST WHITE LAB COAT & TORSO
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.ellipse(-1, 0, 12, 8, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner dark shirt
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.ellipse(-1, 0, 6, 4, -0.15, 0, Math.PI * 2);
    ctx.fill();

    // Chest blood stain where fatal spore wound struck
    ctx.fillStyle = 'rgba(127, 29, 29, 0.85)';
    ctx.beginPath();
    ctx.ellipse(1, 2, 5.5, 3.8, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Left arm resting beside body
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.ellipse(-4, -6, 7.5, 3.2, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Right arm reaching forward towards the letter
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.ellipse(9, 4, 8.5, 3, 0.42, 0, Math.PI * 2);
    ctx.fill();
    // Hand
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(16, 8, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Cyan ID Card Badge on lab coat lapel ("RES-01")
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 4;
    ctx.fillRect(0, -4, 4, 2.5);
    ctx.shadowBlur = 0;

    // 4. SCIENTIST HEAD & HAIR
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(7, -5, 5.5, 0, Math.PI * 2);
    ctx.fill();
    // Dark hair resting peacefully
    ctx.fillStyle = '#451a03';
    ctx.beginPath();
    ctx.arc(6.5, -6, 5.8, Math.PI * 0.7, Math.PI * 1.9);
    ctx.fill();

    ctx.restore(); // Back to world space

    // 5. THE LETTER & FIELD RESEARCH DESK (MEJA ALAS DOKUMEN WASIAT)
    const envSx = level15Corpse.envelopeX - cameraX + W / 2;
    const envSy = level15Corpse.envelopeY - cameraY + H / 2;

    ctx.save();
    ctx.translate(envSx, envSy);

    // Pulsating golden beacon halo
    const glowPulse = 0.65 + Math.sin(t * 3.5) * 0.25;
    ctx.fillStyle = '#f59e0b';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 18 * glowPulse;
    ctx.globalAlpha = 0.4 * glowPulse;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;

    // Field Research Table / Desk Base (Meja Dokumen Taktis)
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-16, -11, 32, 22, 3);
    ctx.fill();
    ctx.stroke();

    // Metallic table corner rivets
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(-13, -8, 1.2, 0, Math.PI * 2);
    ctx.arc(13, -8, 1.2, 0, Math.PI * 2);
    ctx.arc(-13, 8, 1.2, 0, Math.PI * 2);
    ctx.arc(13, 8, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Underneath letter envelope (Angled slightly)
    ctx.save();
    ctx.rotate(-0.1);
    ctx.fillStyle = '#fde68a';
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-12, -7, 24, 15, 1.5);
    ctx.fill();
    ctx.stroke();

    // Envelope triangular flap
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-12, -7);
    ctx.lineTo(0, 1);
    ctx.lineTo(12, -7);
    ctx.stroke();
    ctx.restore();

    // Open folded Letter Sheet (Kertas Surat Wasiat) resting on top
    ctx.save();
    ctx.rotate(0.12);
    ctx.fillStyle = '#fffbeb';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-10, -8, 20, 16, 1.5);
    ctx.fill();
    ctx.stroke();

    // Ruled lines of handwritten ink on the letter
    ctx.strokeStyle = 'rgba(120, 53, 15, 0.65)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-7, -4);
    ctx.lineTo(7, -4);
    ctx.moveTo(-7, -1);
    ctx.lineTo(7, -1);
    ctx.moveTo(-7, 2);
    ctx.lineTo(4, 2);
    ctx.moveTo(-7, 5);
    ctx.lineTo(6, 5);
    ctx.stroke();

    // Crimson wax seal with golden ring in the center
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    ctx.restore(); // letter rotation
    ctx.restore(); // envelope translation

    // Tiny golden ember particles
    if (Math.random() < 0.1 && typeof addParticle === 'function') {
        addParticle(
            level15Corpse.envelopeX + (Math.random() - 0.5) * 8,
            level15Corpse.envelopeY + (Math.random() - 0.5) * 8,
            '#ffd700', 2, 1.2, 18
        );
    }

    // Surat wasiat & meja di lantai menjadi pajangan visual sakral (tanpa prompt pop-up mengganggu)
}

function openFinalLetterModal() {
    const modal = document.getElementById('finalLetterModal');
    if (!modal) return;
    try {
        if (typeof playOccultTone === 'function') playOccultTone(80, 50, 1.5, 0.35, 'triangle');
    } catch (_) {}
    const bodyEl = document.getElementById('finalLetterBodyText');
    const curLang = (typeof lang !== 'undefined' && lang === 'en') ? 'en' : 'id';
    if (bodyEl) {
        bodyEl.innerHTML = curLang === 'en'
            ? `<div class="letter-alterisha-intro" style="margin-bottom:14px;padding:10px 12px;background:rgba(0,240,255,0.06);border-left:3px solid #00f0ff;border-radius:4px;font-size:12px;line-height:1.5;color:#ccd6f6;">
    <div style="font-weight:bold;color:#00f0ff;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:7px;height:7px;background:#00f0ff;border-radius:50%;box-shadow:0 0 6px #00f0ff;"></span>
        ALTERISHA // COMMS CHANNEL:
    </div>
    <div style="font-style:italic;color:#e2e8f0;margin-bottom:6px;">"Wait... that... that's him... The person who vanished from us all this time..."</div>
    <div style="color:#94a3b8;font-size:11px;margin-bottom:6px;"><em>(Narrator: Dr. Rudra... the very person Alterisha and the entire organization had been searching for.)</em></div>
    <div style="font-style:italic;color:#e2e8f0;margin-bottom:4px;">"Him... why is he here?!"</div>
    <div style="font-style:italic;color:#38bdf8;">"Hold on, please... Prototype-19, scan and unseal that letter."</div>
</div>
<p class="letter-para">"Hello... Perhaps by the time you unseal and read this letter, I will already be gone from this world.</p>
<p class="letter-para">You might wonder, with sorrow in your heart, why I am here. It was all for us—for everyone. I slipped away into the shadows and ventured alone because I knew you would try to stop me from researching sectors that mankind could never reclaim. Armed with the equipment I forged, I breached and investigated every corridor until I stood before Monolith-07.</p>
<p class="letter-para">Yet, I planned from the start that this would be my final journey. Before I fell near the Monolith, I transmitted our final scientific findings anonymously to your terminals... along with this very last letter that you might eventually discover.</p>
<p class="letter-para">Of course... I deeply miss working side-by-side with all of you, and with my dearest, most precious partner, <strong>Alterisha</strong>... Please do not grieve for me. I will forever walk beside you in spirit—in your unyielding courage, and in your warm smiles.</p>
<p class="letter-para">FAREWELL... and to the words I never had the courage to speak until now...</p>
<p class="letter-para" style="font-size:14px;color:#fcd34d;font-style:italic;">Farewell... I love you, Dear Alterisha..."</p>
<p class="letter-para letter-sign" style="text-align:right;margin-top:16px;"><em>With eternal love,</em><br><strong style="font-size:15px;color:#f59e0b;">— Dr. Rudra</strong><br><span style="font-size:11px;color:#94a3b8;">Chief Pioneer of Sector Exploration</span></p>
<div class="letter-alterisha-outro" style="margin-top:16px;padding:10px 14px;background:rgba(255,59,59,0.08);border-left:3px solid #ff3b3b;border-radius:4px;font-size:12px;font-style:italic;color:#fca5a5;line-height:1.5;">
    <strong>ALTERISHA:</strong> "...You fool. Why did you have to carry this burden all alone... Rest now, Rudra. Your promise... will live on with us forever."
</div>`
            : `<div class="letter-alterisha-intro" style="margin-bottom:14px;padding:10px 12px;background:rgba(0,240,255,0.06);border-left:3px solid #00f0ff;border-radius:4px;font-size:12px;line-height:1.5;color:#ccd6f6;">
    <div style="font-weight:bold;color:#00f0ff;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:7px;height:7px;background:#00f0ff;border-radius:50%;box-shadow:0 0 6px #00f0ff;"></span>
        ALTERISHA // SALURAN TRANSMISI:
    </div>
    <div style="font-style:italic;color:#e2e8f0;margin-bottom:6px;">"Tunggu... itu... itu dia... orang yang telah menghilang dari kita selama ini..."</div>
    <div style="color:#94a3b8;font-size:11px;margin-bottom:6px;"><em>(Narator: Dr. Rudra... ialah sosok yang selama ini dicari oleh Alterisha dan seluruh organisasi.)</em></div>
    <div style="font-style:italic;color:#e2e8f0;margin-bottom:4px;">"Dia... kenapa ada di sini?!"</div>
    <div style="font-style:italic;color:#38bdf8;">"Bentar tolong... Prototype-19, scan dan buka surat itu."</div>
</div>
<p class="letter-para">"Hai... Mungkin saat kalian membuka dan membaca surat ini, aku telah tiada.</p>
<p class="letter-para">Kalian mungkin penasaran dan merasa sedih kenapa aku berada di sini. Tentu saja, semua ini demi kita semua. Aku menyelinap dan pergi sendiri karena aku tahu pasti aku akan dihalangi oleh kalian, untuk meneliti sektor terdalam yang belum pernah berhasil direbut kembali oleh manusia. Dengan peralatan yang kubuat sendiri, kutembus dan kuteliti seluruh isi sektor hingga mencapai Monolith-07.</p>
<p class="letter-para">Namun sejak awal, aku telah merencanakan bahwa ini akan menjadi perjalanan terakhirku. Sebelum aku gugur di dekat Monolith, aku telah mengirimkan seluruh data penelitian terakhir secara anonim kepada kalian... serta meninggalkan surat terakhir ini yang kuharap suatu hari akan kalian temukan.</p>
<p class="letter-para">Tentu saja... aku sangat rindu bekerja sama dengan kalian, serta partner yang teramat berharga bagiku, <strong>Alterisha</strong>... Janganlah kalian bersedih karenaku. Aku akan terus bersama kalian, di dalam kobaran semangat dan senyuman kalian.</p>
<p class="letter-para">SELAMAT TINGGAL... dan ada satu kata yang belum sempat terucap di hadapanmu...</p>
<p class="letter-para" style="font-size:14px;color:#fcd34d;font-style:italic;">Selamat tinggal... aku mencintaimu, Dear Alterisha..."</p>
<p class="letter-para letter-sign" style="text-align:right;margin-top:16px;"><em>Dengan segenap cinta dan baktiku,</em><br><strong style="font-size:15px;color:#f59e0b;">— Dr. Rudra</strong><br><span style="font-size:11px;color:#94a3b8;">Pelopor Eksplorasi Sektor Terlupakan</span></p>
<div class="letter-alterisha-outro" style="margin-top:16px;padding:10px 14px;background:rgba(255,59,59,0.08);border-left:3px solid #ff3b3b;border-radius:4px;font-size:12px;font-style:italic;color:#fca5a5;line-height:1.5;">
    <strong>ALTERISHA:</strong> "...Bodoh. Kenapa kau harus pergi sejauh ini sendirian... Selamat jalan, Rudra. Janjimu... akan kami jaga selamanya."
</div>`;
    }
    modal.style.display = 'flex';
    modal.classList.add('open');
    if (typeof hideHUD === 'function') hideHUD();
    if (typeof showCursor === 'function') showCursor();
    if (gameState === 'playing') gameState = 'paused';
}

function closeFinalLetterModal() {
    const modal = document.getElementById('finalLetterModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('open');
    }
    if (typeof showHUD === 'function') showHUD();
    if (typeof hideCursor === 'function') hideCursor();
    if (level15Corpse) level15Corpse.inspected = true;
    if (gameState === 'paused') gameState = 'playing';
}
window.openFinalLetterModal = openFinalLetterModal;
window.closeFinalLetterModal = closeFinalLetterModal;

// =============================================================================
// [LEGACY / CADANGAN] — Sub-sistem Teka-Teki Terminal OTN
// CATATAN ARSITEKTUR: Tidak dipanggil dalam simulasi gameplay aktif. Gameplay
// VITA v2.5.7+ murni menggunakan sistem Walk-Over Instant Generator Pickup
// (sGeneratorOnline) tanpa pembekuan gameplay/modal. Modul ini dipertahankan
// sebagai artefak DOM dan kompatibilitas suite pengujian TEST 30.
// =============================================================================
function sSystemRestored() {
    if (typeof audioCtx === 'undefined' || !audioCtx) return;
    const notes = [440, 554.37, 659.25, 880, 1108.73];
    notes.forEach((freq, i) => {
        setTimeout(() => {
            playOccultTone(freq, 0.18, 0.22, 0.08, 'sine');
        }, i * 65);
    });
}

function sShortCircuit() {
    if (typeof audioCtx === 'undefined' || !audioCtx) return;
    playNoiseBurst(0.35, 800, 3, 0.25, 0.05, 'bandpass');
    playOccultTone(140, 0.35, 0.3, 0.04, 'sawtooth');
    setTimeout(() => {
        playOccultTone(90, 0.4, 0.28, 0.03, 'sawtooth');
    }, 120);
}

function sTerminalTick(high) {
    if (typeof audioCtx === 'undefined' || !audioCtx) return;
    playOccultTone(high ? 920 : 640, 0.04, 0.08, 0.02, 'sine');
}

const TERMINAL_RIDDLES = [
    {
        titleId: 'PROTOKOL DEKODIFIKASI BIOLOGIS — SPESIMEN AMOEBOID',
        titleEn: 'BIOLOGICAL DECODING PROTOCOL — AMOEBOID SPECIMEN',
        loreId: 'CATATAN DR. SARA (LOG #03): "Spesimen Amoeboid membelah diri secara instan bila terkena benturan kinetik biasa. Satu-satunya metode melumpuhkan inti sitoplasmanya tanpa memicu replikasi adalah...?"',
        loreEn: 'DR. SARA’S LOG (#03): "Amoeboid specimens replicate instantly upon kinetic impact. The only protocol to neutralize their cytoplasmic core without triggering mitosis is...?"',
        choicesId: ['Suhu Ekstrem Termal (Thermal Venting)', 'Radiasi Medan Magnet', 'Frekuensi Gelombang Suara Ultrasonik'],
        choicesEn: ['Extreme Thermal Venting', 'Magnetic Field Radiation', 'Ultrasonic Acoustic Waves'],
        correct: 0
    },
    {
        titleId: 'LOG OTORISASI REAKTOR — SUB-GRID KELISTRIKAN',
        titleEn: 'REACTOR AUTHORIZATION LOG — ELECTRICAL SUB-GRID',
        loreId: 'LOG INSINYUR KELISTRIKAN: "Untuk membuka katup daya darurat Sektor, kalikan jumlah nomor tiga sektor awal bio-hazard (Sektor 1, 2, dan 3) dengan angka keamanan 7:"',
        loreEn: 'FACILITY ELECTRICAL LOG: "To override sector emergency valve, sum the first three bio-hazard sectors (Sectors 1, 2, and 3) then multiply by security key 7:"',
        choicesId: ['35', '42', '49'],
        choicesEn: ['35', '42', '49'],
        correct: 1
    },
    {
        titleId: 'DOKUMEN TAKTIK ANOMALI — ENTITAS VESPER',
        titleEn: 'ANOMALY TACTICAL ARCHIVE — VESPER ENTITY',
        loreId: 'LOG KEAMANAN SEKTOR: "Predator Vesper berburu dalam gelap menggunakan sensor sonar membran sayap. Kelemahan fatal anatominya saat bersiap menyergap adalah...?"',
        loreEn: 'SECURITY SECTOR ARCHIVE: "Vesper predators hunt in dark corridors using wing membrane sonar. Their fatal anatomical vulnerability during ambush posture is...?"',
        choicesId: ['Sensor sonar dibutakan oleh letupan Cahaya Nova', 'Armor sayap kebal terhadap peluru', 'Dapat menyerap gas beracun'],
        choicesEn: ['Sonar blinded by Nova Light Flares', 'Wing armor is immune to bullets', 'Can absorb poisonous gas'],
        correct: 0
    },
    {
        titleId: 'ARCHIVE ENTITAS APEX — THE MONOLITH',
        titleEn: 'APEX ENTITY ARCHIVE — THE MONOLITH',
        loreId: 'LOG PENELITIAN UTAMA: "The Monolith adalah entitas piramida parasit raksasa. Kapan perisai kristalnya terbuka dan rentan terhadap tembakan langsung operatif?"',
        loreEn: 'PRIMARY RESEARCH LOG: "The Monolith is a colossal parasitic organism. When is its crystalline shield exposed and vulnerable to direct operative strikes?"',
        choicesId: ['Saat melepaskan letupan Nova Spora', 'Saat melayang tenang di udara', 'Saat menyerap peluru kinetik'],
        choicesEn: ['When releasing Spore Nova bursts', 'While hovering in stillness', 'When absorbing kinetic shells'],
        correct: 0
    },
    {
        titleId: 'PROSEDUR AIRLOCK FASILITAS — EVAKUASI AKHIR',
        titleEn: 'FACILITY AIRLOCK PROCEDURE — FINAL EVACUATION',
        loreId: 'PANDUAN OPERASIONAL: "Protokol kuncian pintu Ekstraksi Sektor mensyaratkan status seluruh Node Daya berada pada kondisi...?"',
        loreEn: 'OPERATIONAL MANUAL: "The Sector Extraction airlock protocol strictly requires all Power Nodes to be in state...?"',
        choicesId: ['100% Seluruh Node Terkoneksi & Online', '50% Sebagian Node Cadangan', 'Mode Hibernasi Darurat'],
        choicesEn: ['100% All Nodes Connected & Online', '50% Partial Standby Nodes', 'Emergency Hibernate Mode'],
        correct: 0
    }
];

function generateTerminalPuzzle() {
    const types = ['A', 'B', 'C', 'D'];
    const type = types[Math.floor(Math.random() * types.length)];

    if (type === 'A') {
        const seqPool = [
            { seq: '3V — 6V — 12V — 24V — [ ? ]', ans: '48V', choices: ['36V', '48V', '96V'], correct: 1 },
            { seq: '4V — 8V — 16V — 32V — [ ? ]', ans: '64V', choices: ['48V', '64V', '128V'], correct: 1 },
            { seq: '5V — 8V — 13V — 21V — [ ? ]', ans: '34V', choices: ['29V', '34V', '42V'], correct: 1 },
            { seq: '7V — 14V — 21V — 28V — [ ? ]', ans: '35V', choices: ['35V', '42V', '49V'], correct: 0 },
            { seq: '12V — 19V — 26V — 33V — [ ? ]', ans: '40V', choices: ['39V', '40V', '47V'], correct: 1 },
            { seq: '2V — 6V — 18V — 54V — [ ? ]', ans: '162V', choices: ['108V', '162V', '144V'], correct: 1 },
            { seq: '10V — 14V — 12V — 16V — 14V — [ ? ]', ans: '18V', choices: ['16V', '18V', '20V'], correct: 1 }
        ];
        const p = seqPool[Math.floor(Math.random() * seqPool.length)];
        return {
            type: 'A',
            badge: lang === 'en' ? 'PROTOCOL A — VOLTAGE SEQUENCE ROUTING' : 'PROTOKOL A — PENYEIMBANG TEGANGAN REAKTOR',
            seqText: p.seq,
            choices: p.choices,
            correct: p.correct
        };
    } else if (type === 'B') {
        const r = TERMINAL_RIDDLES[Math.floor(Math.random() * TERMINAL_RIDDLES.length)];
        return {
            type: 'B',
            badge: lang === 'en' ? 'PROTOCOL B — CORRUPTED ARCHIVE LOG RIDDLE' : 'PROTOKOL B — TEKA-TEKI LOG ARSIP DARURAT',
            title: lang === 'en' ? r.titleEn : r.titleId,
            lore: lang === 'en' ? r.loreEn : r.loreId,
            choices: lang === 'en' ? r.choicesEn : r.choicesId,
            correct: r.correct
        };
    } else if (type === 'C') {
        const d1 = Math.floor(Math.random() * 9) + 1;
        const d2 = Math.floor(Math.random() * 10);
        const d3 = Math.floor(Math.random() * 10);
        const d4 = Math.floor(Math.random() * 9) + 1;
        return {
            type: 'C',
            badge: lang === 'en' ? 'PROTOCOL C — BIOSENSOR MEMORY CALIBRATION' : 'PROTOKOL C — KALIBRASI MEMORI BIOSENSOR',
            code: [d1, d2, d3, d4],
            glitchCovered: false
        };
    } else {
        const targets = [
            {
                pattern: [1, 0, 0, 1],
                promptId: 'Hubungkan polaritas Sub-Grid Alpha: Saklar 1 dan 4 harus AKTIF (1), Saklar 2 dan 3 NONAKTIF (0).',
                promptEn: 'Connect Sub-Grid Alpha polarity: Switches 1 and 4 must be ON (1), Switches 2 and 3 OFF (0).'
            },
            {
                pattern: [1, 0, 1, 0],
                promptId: 'Bypass polaritas Ganjil: Saklar 1 dan 3 harus AKTIF (1), Saklar 2 dan 4 NONAKTIF (0).',
                promptEn: 'Odd Polarity Bypass: Switches 1 and 3 must be ON (1), Switches 2 and 4 OFF (0).'
            },
            {
                pattern: [0, 1, 1, 0],
                promptId: 'Overdrive Inti Cadangan: Hanya Saklar 2 dan 3 yang AKTIF (1), sisanya NONAKTIF (0).',
                promptEn: 'Auxiliary Core Overdrive: Only Switches 2 and 3 must be ON (1), others OFF (0).'
            },
            {
                pattern: [1, 1, 0, 1],
                promptId: 'Sinkronisasi Tri-Fase: Saklar 1, 2, dan 4 harus AKTIF (1), Saklar 3 NONAKTIF (0).',
                promptEn: 'Tri-Phase Synchronization: Switches 1, 2, and 4 must be ON (1), Switch 3 OFF (0).'
            }
        ];
        const t = targets[Math.floor(Math.random() * targets.length)];
        return {
            type: 'D',
            badge: lang === 'en' ? 'PROTOCOL D — CIRCUIT SWITCH BYPASS OVERRIDE' : 'PROTOKOL D — SAKLAR BYPASS JARINGAN ARUS',
            prompt: lang === 'en' ? t.promptEn : t.promptId,
            pattern: t.pattern
        };
    }
}

function renderTerminalPuzzleUI() {
    const bodyEl = document.getElementById('terminalPuzzleBody');
    const badgeEl = document.getElementById('terminalProtocolBadge');
    const tipEl = document.getElementById('terminalTipText');
    if (!bodyEl || !terminalPuzzleData) return;

    if (badgeEl) badgeEl.textContent = terminalPuzzleData.badge;

    if (terminalPuzzleData.type === 'A') {
        if (tipEl) tipEl.textContent = lang === 'en' ? '[KEYS 1 - 3 / TOUCH] SELECT TERMINAL VOLTAGE' : '[TOMBOL 1 - 3 / SENTUH] PILIH TEGANGAN TERMINAL';
        bodyEl.innerHTML = `
            <div class="terminal-puzzle-desc">
                ${lang === 'en' ? 'Sequence destabilization detected in power routing bus! Select the correct voltage to balance converter:' : 'Ketidakseimbangan deret terdeteksi pada bus daya! Tentukan tegangan berikutnya untuk menyeimbangkan konverter:'}
            </div>
            <div class="terminal-voltage-display">
                <span class="voltage-meter-icon">⚡</span>
                <span class="voltage-sequence-text">${terminalPuzzleData.seqText}</span>
            </div>
            <div class="terminal-options-grid">
                ${terminalPuzzleData.choices.map((c, i) => `
                    <button class="btn secondary terminal-choice-btn" type="button" onclick="submitTerminalAnswer(${i})">
                        <span class="choice-num-tag">[${i + 1}]</span>
                        <span class="choice-val-text">${c}</span>
                    </button>
                `).join('')}
            </div>
        `;
    } else if (terminalPuzzleData.type === 'B') {
        if (tipEl) tipEl.textContent = lang === 'en' ? '[KEYS 1 - 3 / TOUCH] SELECT DECODED ANSWER' : '[TOMBOL 1 - 3 / SENTUH] PILIH JAWABAN ARSIP';
        bodyEl.innerHTML = `
            <div class="terminal-riddle-box">
                <div class="riddle-box-header">
                    <span class="riddle-tag">ARCHIVE CLASSIFIED</span>
                    <span class="riddle-title">${terminalPuzzleData.title}</span>
                </div>
                <div class="riddle-lore-text">${terminalPuzzleData.lore}</div>
            </div>
            <div class="terminal-options-grid vertical">
                ${terminalPuzzleData.choices.map((c, i) => `
                    <button class="btn secondary terminal-choice-btn" type="button" onclick="submitTerminalAnswer(${i})">
                        <span class="choice-num-tag">[${i + 1}]</span>
                        <span class="choice-val-text">${c}</span>
                    </button>
                `).join('')}
            </div>
        `;
    } else if (terminalPuzzleData.type === 'C') {
        if (tipEl) tipEl.textContent = lang === 'en' ? '[KEYPAD 0-9 / CLICK] INPUT 4-DIGIT CALIBRATION CODE' : '[KEYPAD 0-9 / SENTUH] MASUKKAN 4 DIGIT KODE KALIBRASI';
        const isCovered = terminalGlitchCovered;
        const entered = terminalInputSeq;
        bodyEl.innerHTML = `
            <div class="terminal-puzzle-desc">
                ${isCovered ? 
                    (lang === 'en' ? 'GLITCH INTERFERENCE! Enter the 4-digit code in order:' : 'GANGGUAN GLITCH AKTIF! Masukkan 4 digit kode sesuai urutan awal:') : 
                    (lang === 'en' ? 'MEMORIZE CALIBRATION CODE BEFORE INTERFERENCE (1.5s):' : 'HAFALKAN KODE KALIBRASI SEBELUM INTERFERENSI (1.5 detik):')
                }
            </div>
            <div class="terminal-memory-slots">
                ${[0, 1, 2, 3].map(idx => {
                    let val = '';
                    let activeCls = '';
                    if (!isCovered) {
                        val = terminalPuzzleData.code[idx];
                        activeCls = 'revealed';
                    } else {
                        if (idx < entered.length) {
                            val = entered[idx];
                            activeCls = 'filled';
                        } else {
                            val = '?';
                            activeCls = idx === entered.length ? 'current' : 'hidden';
                        }
                    }
                    return `<div class="memory-digit-box ${activeCls}">${val}</div>`;
                }).join('')}
            </div>
            <div class="terminal-keypad-grid">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'CLR', 0, 'DEL'].map(k => {
                    if (k === 'CLR') {
                        return `<button class="btn secondary keypad-btn action" type="button" onclick="terminalKeypadPress('CLR')">CLR</button>`;
                    } else if (k === 'DEL') {
                        return `<button class="btn secondary keypad-btn action" type="button" onclick="terminalKeypadPress('DEL')">⌫</button>`;
                    } else {
                        return `<button class="btn secondary keypad-btn" type="button" onclick="terminalKeypadPress(${k})">${k}</button>`;
                    }
                }).join('')}
            </div>
        `;
    } else if (terminalPuzzleData.type === 'D') {
        if (tipEl) tipEl.textContent = lang === 'en' ? '[CLICK SW 1-4] TOGGLE STATE, THEN CONNECT GRID' : '[SENTUH SAKLAR 1-4] TOGGLE STATUS, LALU SAMBUNGKAN ARUS';
        bodyEl.innerHTML = `
            <div class="terminal-puzzle-desc" style="color:#00f0ff;">
                ${terminalPuzzleData.prompt}
            </div>
            <div class="terminal-switches-grid">
                ${[0, 1, 2, 3].map(idx => {
                    const isOn = terminalSwitches[idx] === 1;
                    return `
                        <button class="terminal-switch-card ${isOn ? 'on' : 'off'}" type="button" onclick="toggleTerminalSwitch(${idx})">
                            <div class="switch-indicator-led"></div>
                            <div class="switch-title">SW-${idx + 1}</div>
                            <div class="switch-status-text">${isOn ? 'ON [ 1 ]' : 'OFF [ 0 ]'}</div>
                        </button>
                    `;
                }).join('')}
            </div>
            <div style="margin-top:14px;text-align:center;">
                <button class="btn terminal-submit-circuit-btn" type="button" onclick="submitTerminalSwitchCircuit()">
                    <span data-i18n="term_submit_btn">${tt('term_submit_btn')}</span> ▸
                </button>
            </div>
        `;
    }
}

function terminalKeypadPress(key) {
    if (!terminalPuzzleActive || !terminalPuzzleData || terminalPuzzleData.type !== 'C') return;
    if (Date.now() - terminalOpenTime < 200) return;
    sTerminalTick(true);
    if (key === 'CLR') {
        terminalInputSeq = [];
        renderTerminalPuzzleUI();
        return;
    }
    if (key === 'DEL') {
        if (terminalInputSeq.length > 0) {
            terminalInputSeq.pop();
            renderTerminalPuzzleUI();
        }
        return;
    }
    if (typeof key === 'number' && terminalInputSeq.length < 4) {
        terminalInputSeq.push(key);
        renderTerminalPuzzleUI();
        if (terminalInputSeq.length === 4) {
            const isCorrect = terminalInputSeq.every((v, i) => v === terminalPuzzleData.code[i]);
            if (isCorrect) {
                handleTerminalSuccess();
            } else {
                handleTerminalFailure('WRONG_CODE');
            }
        }
    }
}

function toggleTerminalSwitch(idx) {
    if (!terminalPuzzleActive || !terminalPuzzleData || terminalPuzzleData.type !== 'D') return;
    if (Date.now() - terminalOpenTime < 200) return;
    terminalSwitches[idx] = terminalSwitches[idx] === 1 ? 0 : 1;
    sTerminalTick(terminalSwitches[idx] === 1);
    renderTerminalPuzzleUI();
}

function submitTerminalSwitchCircuit() {
    if (!terminalPuzzleActive || !terminalPuzzleData || terminalPuzzleData.type !== 'D') return;
    if (Date.now() - terminalOpenTime < 250) return;
    const isCorrect = terminalSwitches.every((val, i) => val === terminalPuzzleData.pattern[i]);
    if (isCorrect) {
        handleTerminalSuccess();
    } else {
        handleTerminalFailure('WRONG_CIRCUIT');
    }
}

function submitTerminalAnswer(choiceIdx) {
    if (!terminalPuzzleActive || !terminalPuzzleData) return;
    if (Date.now() - terminalOpenTime < 250) return;
    if (terminalPuzzleData.type === 'A' || terminalPuzzleData.type === 'B') {
        if (choiceIdx === terminalPuzzleData.correct) {
            handleTerminalSuccess();
        } else {
            handleTerminalFailure('WRONG_ANSWER');
        }
    }
}

function openTerminalPuzzleModal(node) {
    const modal = document.getElementById('terminalPuzzleModal');
    if (!modal) return;
    if (terminalPuzzleActive && terminalCurrentNode === node) return;
    terminalCurrentNode = node;
    terminalPuzzleActive = true;
    terminalOpenTime = Date.now();
    terminalTimeRemaining = TERMINAL_MAX_TIME;
    terminalInputSeq = [];
    terminalSwitches = [0, 0, 0, 0];
    terminalGlitchCovered = false;
    terminalPuzzleData = generateTerminalPuzzle();

    // Hentikan gerakan player agar karakter tidak meluncur saat membuka terminal
    if (keys && typeof keys === 'object') {
        Object.keys(keys).forEach(k => { keys[k] = false; });
    }
    if (typeof touchMove !== 'undefined' && touchMove) {
        touchMove.active = false;
        touchMove.dx = 0;
        touchMove.dy = 0;
    }

    if (terminalPuzzleData && terminalPuzzleData.type === 'C') {
        if (terminalGlitchTimeout) clearTimeout(terminalGlitchTimeout);
        terminalGlitchTimeout = setTimeout(() => {
            if (terminalPuzzleActive && terminalPuzzleData && terminalPuzzleData.type === 'C') {
                terminalGlitchCovered = true;
                sTerminalTick(false);
                renderTerminalPuzzleUI();
            }
        }, 1500);
    }

    renderTerminalPuzzleUI();
    modal.classList.add('open');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    if (typeof showCursor === 'function') showCursor();
}

function closeTerminalPuzzleModal(isSuccess, isForced) {
    // Abaikan dismiss pembatalan dini (< 400ms) untuk mencegah auto-close dari tombol/sentuhan berjalan
    if (!isSuccess && !isForced && Date.now() - terminalOpenTime < 400) {
        return;
    }
    const modal = document.getElementById('terminalPuzzleModal');
    if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
        modal.style.opacity = '0';
    }
    terminalPuzzleActive = false;
    terminalGlitchCovered = false;
    terminalInputSeq = [];
    terminalSwitches = [0, 0, 0, 0];
    if (terminalCurrentNode) {
        terminalCurrentNode.cooldownUntil = Date.now() + (isSuccess ? 0 : 1200);
        terminalCurrentNode = null;
    }
    if (terminalGlitchTimeout) { clearTimeout(terminalGlitchTimeout); terminalGlitchTimeout = null; }
    if (keys && typeof keys === 'object') {
        Object.keys(keys).forEach(k => { keys[k] = false; });
    }
    if (typeof hideCursor === 'function' && gameState === 'playing') hideCursor();
}
window.openTerminalPuzzleModal = openTerminalPuzzleModal;
window.closeTerminalPuzzleModal = closeTerminalPuzzleModal;
window.submitTerminalAnswer = submitTerminalAnswer;
window.terminalKeypadPress = terminalKeypadPress;
window.toggleTerminalSwitch = toggleTerminalSwitch;
window.submitTerminalSwitchCircuit = submitTerminalSwitchCircuit;

function handleTerminalSuccess() {
    sSystemRestored();
    const node = terminalCurrentNode;
    if (node) {
        node.collected = true;
        node.active = true;
        node.puzzleSolved = true;
        coinsCollected++;
        addParticle(node.x, node.y, '#00f0ff', 32, 6, 45);
        addShockwave(node.x, node.y, 85, '#00f0ff', 24);
        player.hp = Math.min(player.maxHp, player.hp + 15);
        floatingTexts.push({
            x: node.x,
            y: node.y - 25,
            text: `+${tt('term_success_msg')}`,
            color: '#00f0ff',
            life: 90,
            maxLife: 90
        });

        if (tutorialActive && tutorialStep === 3) {
            advanceTutorialStep(3);
        }

        if (artifacts && artifacts.length > 0 && coinsCollected >= artifacts.length) {
            sWin();
            addShockwave(player.x, player.y, 140, '#2ecc71', 35);
            floatingTexts.push({
                x: player.x,
                y: player.y - 45,
                text: `★ ${tt('term_all_nodes_msg')} ★`,
                color: '#2ecc71',
                life: 140,
                maxLife: 140
            });
            if (currentLevel === 0 && !menuDemo) {
                spawnTutorialEvacuationAmbush();
            }
        }
    }
    updateUI();
    closeTerminalPuzzleModal(true);
}

function spawnTutorialEvacuationAmbush() {
    try {
        sEASAlarm();
        addShake(22);
        announceAdmin(lang === 'id' ? '⚠️ ALARM SEKTOR AKTIF! ANOMALI MENGEJAR — SEGERA EVAKUASI KE AIRLOCK!' : '⚠️ SECTOR ALARM TRIGGERED! ANOMALIES EN ROUTE — SPRINT TO AIRLOCK!');
        if (monsters && typeof maze !== 'undefined') {
            const t = (typeof MONSTER_TYPES !== 'undefined' && MONSTER_TYPES[0]) || { name: 'Slime', color: '#2ecc71', speed: 0.8, hp: 30, atk: 8, size: 12, exp: 10 };
            for (let i = 0; i < 3; i++) {
                const angle = (i * Math.PI * 2) / 3;
                let sx = player.x + Math.cos(angle) * (200 + i * 40);
                let sy = player.y + Math.sin(angle) * (200 + i * 40);
                const smx = Math.max(1, Math.min(mazeW - 2, Math.floor(sx / CELL)));
                const smy = Math.max(1, Math.min(mazeH - 2, Math.floor(sy / CELL)));
                if (maze[smy] && maze[smy][smx] === 0) {
                    monsters.push({
                        name: t.name,
                        color: t.color,
                        x: (smx + 0.5) * CELL,
                        y: (smy + 0.5) * CELL,
                        vx: 0,
                        vy: 0,
                        hp: 35,
                        maxHp: 35,
                        atk: t.atk || 8,
                        speed: 2.3,
                        size: t.size || 12,
                        exp: t.exp || 10,
                        facing: 0,
                        angle: Math.random() * Math.PI * 2,
                        ai: 'chase',
                        state: 'chase',
                        wanderTimer: 60,
                        stuckTimer: 0,
                        blocked: false,
                        rx: 0, ry: 0, turnDir: 1, netT2: 0,
                        lastWatchX: 0, lastWatchY: 0,
                        lastSeen: { x: player.x, y: player.y },
                        lastSeenTimer: 300,
                        path: null, pathIdx: 0, pathCooldown: 30,
                        stall: 0, lastWayD: 99999, checkTimer: 30,
                        lastPosX: 0, lastPosY: 0, wanderTarget: null,
                        pauseTimer: 0, lastPx: -1, lastPy: -1,
                        attackCooldown: 0,
                        stunTimer: 0,
                        hitFlash: 0,
                        level: 0,
                        ranged: false,
                        aggro: true
                    });
                    addParticle((smx + 0.5) * CELL, (smy + 0.5) * CELL, '#ff0055', 20, 5, 30);
                }
            }
        }
    } catch (_) {}
}

function handleTerminalFailure(reason) {
    if (!terminalPuzzleActive) return;
    if (Date.now() - terminalOpenTime < 350 && reason !== 'TIMEOUT') return;
    sShortCircuit();
    addShake(18);
    const node = terminalCurrentNode;
    if (node) {
        node.cooldownUntil = Date.now() + 1500;
        addParticle(node.x, node.y, '#ff0033', 25, 5, 30);
    }
    floatingTexts.push({
        x: player.x,
        y: player.y - 30,
        text: `⚠️ ${tt('term_fail_msg')}`,
        color: '#ff2244',
        life: 100,
        maxLife: 100
    });

    if (monsters && monsters.length && player) {
        monsters.forEach(m => {
            if (m.hp > 0 && dist(m, player) < 360) {
                m.lastSeen = { x: player.x, y: player.y };
                m.lastSeenTimer = 300;
                m.state = 'chase';
                m.hitFlash = 12;
            }
        });
    }

    closeTerminalPuzzleModal(false, true);
}

function updateTerminalTelemetry() {
    if (!terminalPuzzleActive) return;

    terminalTimeRemaining -= 1 / 60;
    const timerBar = hudEl('terminalTimerBar');
    const timerText = hudEl('terminalTimerText');

    if (timerBar) {
        const pct = Math.max(0, Math.min(100, (terminalTimeRemaining / TERMINAL_MAX_TIME) * 100));
        timerBar.style.width = pct.toFixed(1) + '%';
        if (pct < 30) {
            timerBar.style.background = '#ff0033';
            timerBar.style.boxShadow = '0 0 14px rgba(255, 0, 51, 0.8)';
        } else if (pct < 60) {
            timerBar.style.background = '#f59e0b';
            timerBar.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.7)';
        } else {
            timerBar.style.background = '#00f0ff';
            timerBar.style.boxShadow = '0 0 10px rgba(0, 240, 255, 0.7)';
        }
    }

    if (timerText) {
        setHudText(timerText, Math.max(0, terminalTimeRemaining).toFixed(1) + 's');
    }

    if (terminalTimeRemaining <= 0) {
        handleTerminalFailure('TIMEOUT');
        return;
    }

    let nearestDist = 99999;
    if (monsters && monsters.length && player) {
        for (let i = 0; i < monsters.length; i++) {
            const m = monsters[i];
            if (m.hp > 0) {
                const d = dist(m, player);
                if (d < nearestDist) nearestDist = d;
            }
        }
    }

    const warnEl = hudEl('terminalPredatorWarning');
    const warnTxt = hudEl('terminalPredatorText');
    if (warnEl && warnTxt) {
        if (nearestDist < 160) {
            warnEl.style.display = 'flex';
            const distM = Math.max(1, Math.round(nearestDist / 16));
            setHudText(warnTxt, `${tt('term_predator_warn')} [${distM}m]`);
        } else {
            warnEl.style.display = 'none';
        }
    }
}

function drawExit() {
    if (!exitPos) return;
    const sx = exitPos.x - cameraX + W / 2;
    const sy = exitPos.y - cameraY + H / 2;

    const unlocked = coinsCollected >= artifacts.length;
    // Jika belum dibuka dan belum terjelajah, baru lewati render
    if (!unlocked && (!fogOfWar[exitPos.gy] || !fogOfWar[exitPos.gx])) return;
    if (sx < -120 || sx > W + 120 || sy < -120 || sy > H + 120) return;

    const time = Date.now() / 1000;
    const pulse = 1 + Math.sin(time * 3.5) * 0.15;
    const portalColor = unlocked ? '#00ff88' : '#7f8c8d';

    ctx.save();
    ctx.translate(sx, sy);

    if (unlocked) {
        // Efek Suar Beacon Vertikal & Cincin Gelombang Menembus Labirin
        const waveRadius = ((time * 35) % 65);
        const waveAlpha = Math.max(0, 0.45 * (1 - waveRadius / 65));
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = waveAlpha;
        ctx.beginPath();
        ctx.arc(0, 0, waveRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Cahaya Pendar Luar Kuat (Beacon Glow)
        ctx.globalAlpha = 0.28 + Math.sin(time * 4) * 0.12;
        ctx.fillStyle = '#00ff88';
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur = 38;
        ctx.beginPath();
        ctx.arc(0, 0, 42 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Cincin Berputar (Rotating Portal Energy Ring)
        ctx.save();
        ctx.rotate(time * 1.8);
        ctx.strokeStyle = '#a8f5c3';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, 24 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Inti Portal Evakuasi
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#00e676';
        ctx.beginPath();
        ctx.arc(0, 0, 16 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 8 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label Teks Kontras Tinggi dengan Pill Background
        const labelText = tt('arrow_exit') || 'EVACUATION GATE';
        ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
        const tw = ctx.measureText(labelText).width;
        ctx.fillStyle = 'rgba(5, 12, 10, 0.85)';
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(-tw / 2 - 8, -48, tw + 16, 22, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#00ff88';
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur = 8;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, 0, -37);
        ctx.shadowBlur = 0;

        // Panah animasi ke bawah menunjuk tepat ke pusat portal
        const arrowBob = Math.sin(time * 6) * 3;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, -22 + arrowBob);
        ctx.lineTo(-6, -28 + arrowBob);
        ctx.lineTo(-2, -28 + arrowBob);
        ctx.lineTo(-2, -34 + arrowBob);
        ctx.lineTo(2, -34 + arrowBob);
        ctx.lineTo(2, -28 + arrowBob);
        ctx.lineTo(6, -28 + arrowBob);
        ctx.closePath();
        ctx.fill();
    } else {
        // Pintu Terkunci
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#7f8c8d';
        ctx.beginPath();
        ctx.arc(0, 0, 26 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#95a5a6';
        ctx.beginPath();
        ctx.arc(0, 0, 14 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#bdc3c7';
        ctx.beginPath();
        ctx.arc(0, 0, 6 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tt('exit_locked_label'), 0, -36);

        const rem = Math.max(0, artifacts.length - coinsCollected);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillText(tt('need_more_artifacts').replace('{n}', rem), 0, 36);
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
    const isExit = coinsCollected >= artifacts.length;
    if (!isExit) {
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
    const distanceMeters = Math.max(1, Math.round(Math.hypot(dx, dy) / 32));
    const angle = Math.atan2(dy, dx);

    const margin = 68;
    const ex = player.x - cameraX + W / 2;
    const ey = player.y - cameraY + H / 2;

    let sx = ex + Math.cos(angle) * (isExit ? 135 : 120);
    let sy = ey + Math.sin(angle) * (isExit ? 135 : 120);

    sx = Math.max(margin, Math.min(W - margin, sx));
    sy = Math.max(margin, Math.min(H - margin, sy));

    const pulse = 1 + Math.sin(Date.now() / (isExit ? 150 : 200)) * (isExit ? 0.22 : 0.16);
    const size = (isExit ? 18 : 15) * pulse;
    const color = isExit ? '#00ff88' : '#00f0ff';

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = isExit ? 20 : 14;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.85, size * 0.65);
    ctx.lineTo(0, size * 0.32);
    ctx.lineTo(-size * 0.85, size * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Label Teks & Jarak Meteran
    const label = (isExit ? (tt('arrow_exit') || 'EXIT') : tt('arrow_artifact')) + ' ' + distanceMeters + 'm';
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    const textW = ctx.measureText(label).width;

    ctx.fillStyle = 'rgba(5, 12, 10, 0.82)';
    ctx.beginPath();
    ctx.roundRect(-textW / 2 - 6, size + 4, textW + 12, 18, 5);
    ctx.fill();

    ctx.fillStyle = isExit ? '#ffffff' : '#fef08a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, size + 13);
    ctx.restore();
}

// HARI 2 — Onboarding halus Sektor 1.
// Papan lantai holografis di titik spawn: hanya untuk pemain baru (tutorial aktif),
// tiap baris memudar setelah aksinya dilakukan. Teks dibungkus & di-cache per bahasa
// agar jalur render tidak mengalokasi array setiap frame.
const holoPromptCache = { lang: '', rows: [], widths: [], measured: false };

function wrapHoloPrompt(text, maxChars) {
    const out = [];
    const words = String(text).split(' ');
    let line = '';
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (line && (line.length + 1 + word.length) > maxChars) {
            out.push(line);
            line = word;
        } else {
            line = line ? line + ' ' + word : word;
        }
    }
    if (line) out.push(line);
    return out;
}

function drawSpawnHoloPrompts() {
    if (currentLevel !== 0 || menuDemo || !tutorialActive || !settings) return;
    const p = getLocalPlayer();
    if (!p) return;

    const spawnX = 1.5 * CELL;
    const spawnY = 1.5 * CELL;
    const proximity = 1 - Math.min(1, Math.hypot(p.x - spawnX, p.y - spawnY) / (7 * CELL));
    if (proximity <= 0.01) return;

    // Baris per kelompok aksi: 0 gerak, 1 serang, 2 artefak.
    const groupAlpha = [
        tutorialStep <= 0 ? 1 : 0,
        tutorialStep <= 2 ? 0.85 : 0,
        coinsCollected === 0 ? 0.9 : 0
    ];
    if (groupAlpha[0] + groupAlpha[1] + groupAlpha[2] <= 0) return;

    if (holoPromptCache.lang !== lang) {
        holoPromptCache.lang = lang;
        holoPromptCache.rows = [];
        const groups = [tt('holo_move'), tt('holo_attack'), tt('holo_artifact')];
        for (let g = 0; g < groups.length; g++) {
            const wrapped = wrapHoloPrompt(groups[g], 26);
            for (let i = 0; i < wrapped.length; i++) {
                holoPromptCache.rows.push({ text: wrapped[i], group: g });
            }
        }
        holoPromptCache.widths = [];
        holoPromptCache.measured = false;
    }

    const sx = spawnX - cameraX + W / 2;
    const sy = spawnY - cameraY + H / 2;
    if (sx < -140 || sx > W + 140 || sy < -100 || sy > H + 100) return;

    ctx.save();
    ctx.font = "bold 7px 'Cascadia Code', monospace";
    if (!holoPromptCache.measured) {
        holoPromptCache.widths = holoPromptCache.rows.map(r => ctx.measureText(r.text).width);
        holoPromptCache.measured = true;
    }

    const rows = holoPromptCache.rows;
    const widths = holoPromptCache.widths;
    let panelW = 0;
    for (let i = 0; i < widths.length; i++) {
        if (widths[i] > panelW) panelW = widths[i];
    }
    panelW += 10;
    const panelH = rows.length * 8 + 8;
    const px = -panelW / 2;
    const py = 22;

    const t = Date.now() / 1000;
    const flicker = REDUCE_MOTION ? 1 : 0.86 + Math.sin(t * 7.3) * 0.08 + Math.sin(t * 19.1) * 0.04;
    const base = 0.4 * proximity * flicker;

    ctx.translate(sx, sy);
    ctx.globalAlpha = base * 0.5;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);

    // Bracket sudut + garis proyeksi dari titik spawn.
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - 4, py);
    ctx.moveTo(px, py + panelH);
    ctx.lineTo(px - 4, py + panelH);
    ctx.moveTo(px + panelW, py);
    ctx.lineTo(px + panelW + 4, py);
    ctx.moveTo(px + panelW, py + panelH);
    ctx.lineTo(px + panelW + 4, py + panelH);
    ctx.moveTo(0, py);
    ctx.lineTo(0, 10);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 5;
    for (let i = 0; i < rows.length; i++) {
        const a = groupAlpha[rows[i].group];
        if (a <= 0) continue;
        ctx.globalAlpha = base * a;
        ctx.fillStyle = rows[i].group === 2 ? '#f1c40f' : '#9ff9ff';
        ctx.fillText(rows[i].text, px + 5, py + 8 + i * 8);
    }
    ctx.restore();
}

// Pulsa kompas terarah di sekitar pemain saat seluruh artefak sektor sudah diambil (Sektor 1 s.d. 15).
// Melengkapi drawDirectionArrow() (panah tepi layar) dengan isyarat gelombang radar langsung dari tubuh pemain.
function drawExitCompassPulse() {
    if (menuDemo || !exitPos) return;
    if (!artifacts || !artifacts.length || coinsCollected < artifacts.length) return;
    const p = getLocalPlayer();
    if (!p || p.hp <= 0) return;

    const sx = p.x - cameraX + W / 2;
    const sy = p.y - cameraY + H / 2;
    const angle = Math.atan2(exitPos.y - p.y, exitPos.x - p.x);
    const t = Date.now() / 1000;
    const pulse = REDUCE_MOTION ? 0.5 : (Math.sin(t * 4.2) * 0.5 + 0.5);

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    ctx.strokeStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 10;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
        const r = 28 + i * 11 + pulse * 4;
        ctx.globalAlpha = (0.42 - i * 0.1) * (0.6 + pulse * 0.4);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(r - 6, -7);
        ctx.lineTo(r + 2, 0);
        ctx.lineTo(r - 6, 7);
        ctx.stroke();
    }
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
    if (!smod || !smod.fogTint) return;
    ctx.save();
    ctx.fillStyle = smod.fogTint;
    ctx.fillRect(-W * 2, -H * 2, W * 5, H * 5);
    // Pulse bernapas halus untuk sektor horror (9+)
    if (smod.heartbeat) {
        const pulse = Math.sin(Date.now() / 800) * 0.03 + 0.02;
        ctx.fillStyle = `rgba(120,0,0,${pulse})`;
        ctx.fillRect(-W * 2, -H * 2, W * 5, H * 5);
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

    // Pintu Keluar (Langsung terungkap dan berkedip neon di Minimap begitu semua artefak terkumpul)
    const exitOpen = coinsCollected >= artifacts.length;
    if (exitPos && (exitOpen || (fogOfWar[exitPos.gy] && fogOfWar[exitPos.gx]))) {
        if (exitOpen) {
            const blink = Math.sin(Date.now() / 150) > 0;
            minimapCtx.fillStyle = blink ? '#00ff88' : '#ffffff';
            const sz = blink ? 7 : 5;
            minimapCtx.fillRect(ox + exitPos.gx * scale - Math.floor(sz / 2), oy + exitPos.gy * scale - Math.floor(sz / 2), sz, sz);
        } else {
            minimapCtx.fillStyle = '#7f8c8d';
            minimapCtx.fillRect(ox + exitPos.gx * scale - 2, oy + exitPos.gy * scale - 2, 5, 5);
        }
    }

    // 2. Indikator Arah Ping di Tepi Minimap (Edge Chevrons)
    if (exitOpen && exitPos) {
        drawMinimapEdgeChevron(exitPos.gx, exitPos.gy, '#00ff88', true, scale, ox, oy);
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
    drawSpawnHoloPrompts();
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
    drawLevel15Corpse();
    drawTraps();
    if (players && players.length > 1) {
        for (let pi = 0; pi < players.length; pi++) {
            if (players[pi] && (players[pi].hp > 0 || players[pi].downed)) {
                drawPlayer(players[pi]);
            }
        }
    } else {
        drawPlayer();
    }
    drawMotionTracker();
    drawParticles();
    drawSpores();
    drawFloatingTexts();
    drawDarkModeOverlay();
    drawSektorFogTint();
    drawLightModeEffects();
    drawDirectionArrow();
    drawExitCompassPulse();

    ctx.restore();

    // Kembali ke canvas utama + upscale tanpa smoothing = chunky pixel art.
    // Screen shake diterapkan di sini agar gerakannya tetap smooth.
    ctx = mainCtx; W = keepW; H = keepH;
    // HD: buffer sudah seukuran device px, jadi blit 1:1 (smoothing aman).
    // Pixel: upscale nearest-neighbour agar tetap tajam & chunky.
    ctx.imageSmoothingEnabled = (PIXEL === 1);
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
    player.invincible = 0;
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
    updateDownedAndRevive();
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

// ---- Fase 1 co-op: pemisahan SIMULASI vs RENDER (fondasi host-authoritative) ----
// Untuk jaringan lanjutan, host harus bisa memajukan state dunia TANPA menyentuh
// canvas/DOM (lalu menyiarkan snapshot), sementara klien cukup menggambar hasilnya.
// Helper di bawah membuat pemisahan itu eksplisit:
//
//   stepSimulation()    → state otoritatif: posisi, HP, damage, timer gameplay.
//   stepLocalVisuals()  → efek kosmetik (partikel, spora, selongsong, teks) yang
//                         boleh berbeda antar pemain tanpa memengaruhi hasil game.
//   stepCamera()        → interpolasi kamera; murni pandangan tiap pemain.
//   updatePerfCounters()→ statistik FPS untuk overlay debug.
//   renderFrame()       → seluruh pass gambar + HUD; tidak mengubah state simulasi.
//
// Urutan pemanggilan di gameLoopFrame() sama dengan loop lama, jadi perilaku
// single-player tidak berubah. updateMonsterProximityAndHeartbeat() tetap dipanggil
// di jalur klien karena sifatnya feedback audio/getaran milik tiap pemain.

// ---- Fase 1 co-op: serialisasi & rekonsiliasi snapshot (fungsi murni) ----
let netSnapshotSeq = 0;

function serializeSnapshot() {
    netSnapshotSeq++;
    const snapPlayers = [];
    if (players && players.length) {
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            if (!p) continue;
            snapPlayers.push({
                idx: (typeof p.peerIndex === 'number') ? p.peerIndex : i,
                id: p.id || ('p' + i),
                callsign: p.callsign || ('P' + (i + 1)),
                x: Math.round(p.x * 10) / 10,
                y: Math.round(p.y * 10) / 10,
                hp: Math.max(0, Math.round(p.hp)),
                maxHp: Math.round(p.maxHp),
                facing: Math.round(p.facing * 100) / 100,
                dashing: !!p.dashing,
                downed: !!p.downed,
                reviveProgress: p.reviveProgress || 0,
                curW: p.currentWeapon || 'knife',
                size: p.size || 10
            });
        }
    }

    const snapMonsters = [];
    if (monsters && monsters.length) {
        for (let i = 0; i < monsters.length; i++) {
            const m = monsters[i];
            if (!m || m.hp <= 0) continue;
            snapMonsters.push({
                idx: i,
                x: Math.round(m.x * 10) / 10,
                y: Math.round(m.y * 10) / 10,
                hp: Math.round(m.hp),
                maxHp: Math.round(m.maxHp),
                state: m.state || 'chase',
                angle: Math.round((m.angle || 0) * 100) / 100
            });
        }
    }

    return {
        seq: netSnapshotSeq,
        level: currentLevel,
        coins: typeof coinsCollected !== 'undefined' ? coinsCollected : 0,
        players: snapPlayers,
        monsters: snapMonsters
    };
}

function applySnapshot(snap, isHost = false) {
    if (!snap || typeof snap !== 'object') return false;

    // Rekonsiliasi level / sektor aktif dari Host (agar labirin selalu sinkron)
    if (!isHost && typeof snap.level === 'number' && snap.level !== currentLevel && snap.level >= 0 && snap.level < LEVELS) {
        currentLevel = snap.level;
        if (typeof triggerFacilityLoading === 'function') {
            triggerFacilityLoading({
                title: tt('loading_sector_title').replace('{s}', snap.level + 1),
                duration: 950
            }, () => {
                initLevel(snap.level);
            });
        } else {
            initLevel(snap.level);
        }
    }

    // Rekonsiliasi koin / artefak
    if (!isHost && typeof snap.coins === 'number' && typeof coinsCollected !== 'undefined') {
        coinsCollected = snap.coins;
    }

    // Rekonsiliasi pemain dalam players[]
    if (Array.isArray(snap.players)) {
        for (let i = 0; i < snap.players.length; i++) {
            const sp = snap.players[i];
            const pIdx = sp.idx;
            if (isHost && pIdx === localPlayerIndex) continue; // Host tidak menimpa posisi lokal

            let targetP = players[pIdx];
            if (!targetP) {
                targetP = spawnCoopPeerEntity(pIdx, sp.callsign, sp.x, sp.y);
                targetP.id = sp.id || ('p' + pIdx);
                targetP.hp = sp.hp;
                targetP.maxHp = sp.maxHp;
                targetP.facing = sp.facing;
                targetP.dashing = sp.dashing;
                targetP.currentWeapon = sp.curW || 'knife';
                if (typeof sp.size === 'number') targetP.size = sp.size;
                players[pIdx] = targetP;
            } else if (pIdx === localPlayerIndex && !isHost) {
                // Client prediction reconciliation untuk pemain lokal non-host:
                // Hanya koreksi posisi bila deviasi > 28px untuk mencegah jitter
                const errDist = Math.hypot(sp.x - targetP.x, sp.y - targetP.y);
                if (errDist > 28) {
                    if (errDist > 80) {
                        targetP.x = sp.x;
                        targetP.y = sp.y;
                    } else {
                        targetP.x += (sp.x - targetP.x) * 0.25;
                        targetP.y += (sp.y - targetP.y) * 0.25;
                    }
                }
                targetP.hp = sp.hp;
                targetP.maxHp = sp.maxHp;
                targetP.downed = !!sp.downed;
                targetP.reviveProgress = sp.reviveProgress || 0;
            } else {
                // Remote peer di klien: interpolasi posisi secara halus
                targetP.targetX = sp.x;
                targetP.targetY = sp.y;
                if (typeof targetP.x !== 'number' || Math.hypot(sp.x - targetP.x, sp.y - targetP.y) > 32) {
                    targetP.x = sp.x;
                    targetP.y = sp.y;
                } else {
                    targetP.x += (sp.x - targetP.x) * 0.45;
                    targetP.y += (sp.y - targetP.y) * 0.45;
                }
                targetP.hp = sp.hp;
                targetP.maxHp = sp.maxHp;
                targetP.facing = sp.facing;
                targetP.dashing = sp.dashing;
                targetP.currentWeapon = sp.curW;
                targetP.callsign = sp.callsign;
                targetP.downed = !!sp.downed;
                targetP.reviveProgress = sp.reviveProgress || 0;
            }
        }
    }

    // Rekonsiliasi monster (klien menginterpolasi posisi dari host otoritatif)
    if (!isHost && Array.isArray(snap.monsters) && monsters) {
        for (let i = 0; i < snap.monsters.length; i++) {
            const sm = snap.monsters[i];
            const m = monsters[sm.idx];
            if (m) {
                m.targetX = sm.x;
                m.targetY = sm.y;
                if (typeof m.x !== 'number' || Math.hypot(sm.x - m.x, sm.y - m.y) > 32) {
                    m.x = sm.x;
                    m.y = sm.y;
                } else {
                    m.x += (sm.x - m.x) * 0.45;
                    m.y += (sm.y - m.y) * 0.45;
                }
                m.hp = sm.hp;
                m.maxHp = sm.maxHp;
                if (typeof sm.state !== 'undefined') m.state = sm.state;
                if (typeof sm.angle !== 'undefined') m.angle = sm.angle;
            }
        }
    }

    return true;
}

function stepSimulation() {
    // Inti state otoritatif — host menjalankan ini setiap tick.
    updatePlayer();
    if (isCoopHost && players && players.length > 1) {
        updateRemotePeers();
    } else if (!isCoopHost && coopWs && coopWs.readyState === WebSocket.OPEN) {
        sampleAndSendPeerInput();
    }
    updateMonsters();
    updateProjectiles();
    updateThermalTrails();
    updateShockwaves();
    updateGasClouds();
    updateTraps();

    if (typeof isEndlessMode !== 'undefined' && isEndlessMode) {
        checkEndlessWaveProgress();
    }

    // Peluruhan timer combo Adrenaline
    if (comboTimer > 0) {
        comboTimer--;
        if (comboTimer === 0) {
            comboCount = 0;
            hideComboBanner();
        }
    }
}

function stepLocalVisuals() {
    // Kosmetik murni: aman bila visualnya berbeda antar pemain.
    updateBrassCasings();
    updateParticles();
    updateSpores();

    // Teks damage melayang: umur + naik + batas 40 entri (tanpa alokasi array).
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
}

// Kamera adaptif dengan Dynamic Look-Ahead menuju arah bidikan crosshair.
function stepCamera() {
    const lp = getLocalPlayer();
    if (!lp) return;
    let targetCamX = lp.x;
    let targetCamY = lp.y;
    if (mouseActive && !menuDemo) {
        const aimDist = 65;
        targetCamX += Math.cos(player.facing) * aimDist;
        targetCamY += Math.sin(player.facing) * aimDist;
    }
    const camDist = Math.hypot(targetCamX - cameraX, targetCamY - cameraY);
    const camLerp = camDist > 200 ? 0.15 : 0.08;
    cameraX += (targetCamX - cameraX) * camLerp;
    cameraY += (targetCamY - cameraY) * camLerp;
}

// Statistik FPS untuk HUD/overlay debug (change-detected, tiap 15 frame).
function updatePerfCounters() {
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
}

// Sisi render murni: tidak mengubah state simulasi.
function renderFrame() {
    culledCount = 0;
    renderedCount = 0;
    renderGame();
    drawCrosshair();
    drawMinimap();
    if (debugOverlayOpen) drawDebugDiagnostics();
    updateUI();
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
            renderFrame();
            return;
        }
        playAmbientDrone();
        startProceduralOST();
        const termModalEl = document.getElementById('terminalPuzzleModal');
        if (terminalPuzzleActive && (!termModalEl || termModalEl.style.display === 'none')) {
            terminalPuzzleActive = false;
        }
        if (terminalPuzzleActive) {
            updateTerminalTelemetry();
        }

        try {
            stepSimulation();
        } catch (simErr) {
            console.warn('Simulation recoverable tick exception:', simErr);
        }
        try {
            stepLocalVisuals();
            updateMonsterProximityAndHeartbeat();
            stepCamera();
            updatePerfCounters();
            renderFrame();
        } catch (renderErr) {
            console.warn('Render recoverable frame exception:', renderErr);
        }
        if (mouseTime > 0) { mouseTime--; if (mouseTime <= 0) mouseActive = false; }

        // Co-op 20Hz Snapshot Broadcast (Host -> Peers)
        if (isCoopHost && coopWs && coopWs.readyState === WebSocket.OPEN && coopPeers.length > 1) {
            const loopNow = performance.now();
            if (loopNow - netLastSnapshotTime >= netSnapshotInterval) {
                netLastSnapshotTime = loopNow;
                sendCoopMessage('SNAPSHOT', { snap: serializeSnapshot(), t: Date.now() });
            }
        }
        updateNetPing();
        updateNetBadgeUI();
    } else if (gameState === 'menu' && player) {
        demoUpdate();
        cameraX += (player.x - cameraX) * 0.1;
        cameraY += (player.y - cameraY) * 0.1;
        renderGame();
    }
    // 'paused' → frame terakhir dibekukan, overlay JEDA tampil di atasnya.
}

document.addEventListener('keydown', e => {
    if (!e || typeof e.key !== 'string') return;
    keys[e.key.toLowerCase()] = true;

    if (e.key === 'F3' || e.code === 'F3') {
        e.preventDefault();
        toggleDebugOverlay();
        return;
    }

    // Toggle Admin Arsenal Console via Tilde (~) / Backquote or F2
    if (e.key === '`' || e.key === '~' || e.code === 'Backquote' || e.key === 'F2' || e.code === 'F2') {
        e.preventDefault();
        const aM = document.getElementById('adminArsenalModal');
        if (aM && (aM.style.display === 'flex' || aM.classList.contains('open'))) {
            closeAdminArsenalModal();
        } else {
            openAdminArsenalModal();
        }
        return;
    }

    // Dismiss or interact with Terminal Puzzle modal
    const termM = document.getElementById('terminalPuzzleModal');
    const isTermMOpen = termM && (termM.style.display === 'flex' || termM.classList.contains('open'));
    if (isTermMOpen) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (Date.now() - terminalOpenTime >= 400) {
                closeTerminalPuzzleModal(false);
            }
            return;
        }
        if (terminalPuzzleData && Date.now() - terminalOpenTime >= 200) {
            if (terminalPuzzleData.type === 'A' || terminalPuzzleData.type === 'B') {
                if (e.key === '1') { e.preventDefault(); submitTerminalAnswer(0); return; }
                if (e.key === '2') { e.preventDefault(); submitTerminalAnswer(1); return; }
                if (e.key === '3') { e.preventDefault(); submitTerminalAnswer(2); return; }
            } else if (terminalPuzzleData.type === 'C') {
                if (/^[0-9]$/.test(e.key)) {
                    e.preventDefault();
                    terminalKeypadPress(parseInt(e.key, 10));
                    return;
                }
                if (e.key === 'Backspace') {
                    e.preventDefault();
                    terminalKeypadPress('DEL');
                    return;
                }
            } else if (terminalPuzzleData.type === 'D') {
                if (e.key === '1') { e.preventDefault(); toggleTerminalSwitch(0); return; }
                if (e.key === '2') { e.preventDefault(); toggleTerminalSwitch(1); return; }
                if (e.key === '3') { e.preventDefault(); toggleTerminalSwitch(2); return; }
                if (e.key === '4') { e.preventDefault(); toggleTerminalSwitch(3); return; }
                if (e.key === 'Enter') { e.preventDefault(); submitTerminalSwitchCircuit(); return; }
            }
        }
        return;
    }

    // Dismiss admin arsenal modal
    const adminM = document.getElementById('adminArsenalModal');
    const isAdminMOpen = adminM && (adminM.classList.contains('open') || adminM.style.display === 'flex');
    if (isAdminMOpen && (e.key === 'Escape' || e.key === 'Esc')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeAdminArsenalModal();
        return;
    }

    // Dismiss lore or codex modal with Escape, Space, or Enter
    const robotM = document.getElementById('robotMemoryModal');
    const isRobotMOpen = robotM && robotM.style.display === 'flex';
    if (isRobotMOpen && (e.key === 'Escape' || e.key === 'Esc' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRobotMemoryModal();
        return;
    }

    const finalM = document.getElementById('finalLetterModal');
    const isFinalMOpen = finalM && (finalM.style.display === 'flex' || finalM.classList.contains('open'));
    if (isFinalMOpen && (e.key === 'Escape' || e.key === 'Esc' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeFinalLetterModal();
        return;
    }

    const loreM = document.getElementById('loreModal');
    const isLoreOpen = loreM && (loreM.classList.contains('open') || loreM.style.display === 'flex');
    const codexM = document.getElementById('codexModal');
    const isCodexOpen = codexM && (codexM.classList.contains('open') || codexM.style.display === 'flex');

    if (isLoreOpen && (e.key === 'Escape' || e.key === 'Esc' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeLoreModal();
        return;
    }
    if (isCodexOpen && (e.key === 'Escape' || e.key === 'Esc' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeCodexModal();
        return;
    }

    if (e.key === 'Escape' || e.key === 'Esc') {
        const bestiaryM = document.getElementById('bestiaryModal');
        if (bestiaryM && (bestiaryM.classList.contains('open') || bestiaryM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeBestiaryModal();
            return;
        }
        const workbenchM = document.getElementById('workbenchModal');
        if (workbenchM && (workbenchM.classList.contains('open') || workbenchM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeWorkbenchModal();
            return;
        }
        const talentM = document.getElementById('talentTreeModal');
        if (talentM && (talentM.classList.contains('open') || talentM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeTalentTreeModal();
            return;
        }
        const pauseSetM = document.getElementById('inGameSettingsModal');
        if (pauseSetM && (pauseSetM.classList.contains('open') || pauseSetM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closePauseSettings();
            return;
        }
        const setM = document.getElementById('settingsModal');
        if (setM && (setM.classList.contains('open') || setM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeSettingsModal();
            return;
        }
        const touchM = document.getElementById('touchLayoutEditor');
        if (touchM && (isEditingTouchLayout || touchM.style.display !== 'none')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            cancelTouchLayoutEditor();
            return;
        }
        const authM = document.getElementById('authModal');
        if (authM && (authM.classList.contains('open') || authM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeAuthModal();
            return;
        }
        const profM = document.getElementById('profileModal');
        if (profM && (profM.classList.contains('open') || profM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeProfileModal();
            return;
        }
        const leadM = document.getElementById('leaderboardModal');
        if (leadM && (leadM.classList.contains('open') || leadM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeLeaderboardModal();
            return;
        }
        const dbM = document.getElementById('databaseModal');
        if (dbM && (dbM.classList.contains('open') || dbM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeDatabaseModal();
            return;
        }
        const coopM = document.getElementById('coopLobbyModal');
        if (coopM && (coopM.classList.contains('open') || coopM.style.display === 'flex')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof closeCoopLobby === 'function') closeCoopLobby();
            else if (typeof closeCoopLobbyModal === 'function') closeCoopLobbyModal();
            return;
        }
        const anyOpenModal = document.querySelector('.modal-backdrop.open');
        if (anyOpenModal) {
            e.preventDefault();
            e.stopImmediatePropagation();
            anyOpenModal.classList.remove('open');
            anyOpenModal.style.display = 'none';
            return;
        }

        if (tutorialActive) {
            skipTutorial();
            return;
        }
        if (gameState === 'playing') togglePause(true);
        else if (gameState === 'paused') togglePause(false);
        return;
    }

    // Zoom tampilan: + / = perbesar, - perkecil, 0 reset. Diabaikan saat mengetik.
    const _tag = e.target && e.target.tagName;
    const _typing = _tag === 'INPUT' || _tag === 'TEXTAREA' || _tag === 'SELECT' || (e.target && e.target.isContentEditable);
    if (!_typing && (gameState === 'playing' || gameState === 'paused')) {
        if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal') {
            e.preventDefault();
            adjustViewZoom(ZOOM_STEP);
            return;
        }
        if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus') {
            e.preventDefault();
            adjustViewZoom(-ZOOM_STEP);
            return;
        }
        if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') {
            e.preventDefault();
            resetViewZoom();
            return;
        }
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
            if (level15Corpse && currentLevel === LEVELS - 1 && player && dist(player, { x: level15Corpse.envelopeX, y: level15Corpse.envelopeY }) < 55) {
                openFinalLetterModal();
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
    if (!e || typeof e.key !== 'string') return;
    keys[e.key.toLowerCase()] = false;
});

window.addEventListener('wheel', e => {
    if (gameState === 'playing') {
        cycleWeapon(e.deltaY > 0);
    }
}, { passive: true });

document.addEventListener('mousemove', e => {
    if (document.body.classList.contains('touch-on')) return; // ignore synthetic touch mousemove
    mouseX = e.clientX;
    mouseY = e.clientY;
    mouseActive = true;
    mouseTime = 60;
});

isMouseDown = false;
document.addEventListener('mousedown', e => {
    if (document.body.classList.contains('touch-on')) return; // ignore synthetic touch mousedown
    if (terminalPuzzleActive) return;
    if (e.target && e.target.closest && (
        e.target.closest('#touchUI') ||
        e.target.closest('#weaponBar') ||
        e.target.closest('#weaponSelectScreen') ||
        e.target.closest('#terminalPuzzleModal') ||
        e.target.closest('.terminal-puzzle-backdrop') ||
        e.target.closest('.modal-backdrop') ||
        e.target.closest('.robot-memory-backdrop')
    )) return;
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
    const fluxDiscount = (player && player.talentFlux) ? (player.talentFlux * 0.15) : 0;
    const baseDashCd = Math.round(((player && player.perkAdrenaline) ? 24 : 45) * (1 - fluxDiscount));
    dashCooldown = baseDashCd;
    sDash();
    triggerHaptic('dash');
    addParticle(player.x, player.y, '#3498db', 8, 4, 15);

    // Major Talent: Phantom Phase Shockwave
    if (player && player.talentPhantom) {
        addShockwave(player.x, player.y, 60, '#00e5ff', 18);
        if (monsters) {
            monsters.forEach(m => {
                if (m && m.hp > 0 && dist(m, player) < 70) {
                    m.stunTimer = Math.max(m.stunTimer || 0, 150);
                    attackMonster(m, player.atk * 0.5);
                    addParticle(m.x, m.y, '#00e5ff', 6, 2, 12);
                }
            });
        }
    }

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
    isTouchAtkPressed = false;
    if (typeof isEndlessMode !== 'undefined' && isEndlessMode) {
        startEndlessMode();
        return;
    }
    const doRetry = () => {
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
    };

    if (typeof triggerFacilityLoading === 'function') {
        triggerFacilityLoading({
            title: tt('loading_sector_title').replace('{s}', currentLevel + 1),
            duration: 1200,
            instant: true,
            onPrepare: doRetry
        });
    } else {
        doRetry();
    }
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
    if (document.hidden && gameState === 'playing') {
        togglePause(true);
        if (typeof player !== 'undefined' && player && currentLevel > 0 && !menuDemo && !isEndlessMode) {
            try {
                const high = loadHigh();
                high.lastLevel = currentLevel;
                high.savedWeapons = [...player.weapons];
                high.savedCurrentWeapon = player.currentWeapon;
                high.savedPerks = [...player.perks];
                high.savedExp = player.exp;
                high.savedPLevel = player.plevel;
                high.savedKills = totalKills;
                high.savedTime = totalTime;
                saveHigh(high);
                checkContinueBtn();
            } catch (_) {}
        }
    }
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

let touchEditorSource = 'none';
let wasGameViewHiddenForEditor = false;

function openTouchLayoutEditor() {
    if (gameState === 'playing') togglePause(true);
    const inGameModal = document.getElementById('inGameSettingsModal');
    const wasInGameSettings = inGameModal && (inGameModal.style.display === 'flex' || inGameModal.style.display === 'block');
    if (inGameModal) inGameModal.style.display = 'none';
    const hModal = document.getElementById('settingsModal');
    const wasFacilitySettings = hModal && hModal.classList.contains('open');
    if (hModal) hModal.classList.remove('open');
    const ps = document.getElementById('pauseScreen');
    const wasPause = ps && ps.classList.contains('open');
    if (ps) ps.classList.remove('open');
    const ss = document.getElementById('startScreen');
    const wasStart = ss && (ss.style.display === 'flex' || ss.style.display === 'block');

    touchEditorSource = wasInGameSettings ? 'inGameSettings' : (wasFacilitySettings ? 'facilitySettings' : (wasPause ? 'pause' : (wasStart ? 'startScreen' : 'none')));

    // Bila dibuka dari Hub, tampilkan container gameView agar touchUI muncul
    const gv = document.getElementById('gameView');
    wasGameViewHiddenForEditor = gv && (gv.style.display === 'none');
    if (wasGameViewHiddenForEditor && gv) {
        gv.style.display = 'block';
    }

    if (ss && wasStart) {
        ss.style.pointerEvents = 'none';
    }

    isEditingTouchLayout = true;
    document.body.classList.add('editing-touch-layout');
    document.body.classList.add('touch-on');

    const exitBtn = document.getElementById('btnTouchExit');
    if (exitBtn) {
        exitBtn.style.display = 'none';
        exitBtn.style.pointerEvents = 'none';
    }

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

    applyTouchStyle();
    setupTouchLayoutEditorListeners();
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
    if (settings && settings.deviceMode === 'pc') {
        document.body.classList.remove('touch-on');
    }
    const overlay = document.getElementById('touchLayoutEditor');
    if (overlay) overlay.style.display = 'none';

    if (wasGameViewHiddenForEditor) {
        const gv = document.getElementById('gameView');
        if (gv) gv.style.display = 'none';
        wasGameViewHiddenForEditor = false;
    }
    const ss = document.getElementById('startScreen');
    if (ss) ss.style.pointerEvents = 'auto';

    const exitBtn = document.getElementById('btnTouchExit');
    if (exitBtn) {
        exitBtn.style.display = '';
        exitBtn.style.pointerEvents = '';
    }

    announceAdmin(tt('layout_saved_toast'));
    sCinematicUI('save');
    applyTouchLayout();

    if (touchEditorSource === 'facilitySettings') {
        const hModal = document.getElementById('settingsModal');
        if (hModal) hModal.classList.add('open');
    } else if (touchEditorSource === 'inGameSettings') {
        const inGameModal = document.getElementById('inGameSettingsModal');
        if (inGameModal) inGameModal.style.display = 'flex';
    } else if (gameState === 'paused' || touchEditorSource === 'pause') {
        const ps = document.getElementById('pauseScreen');
        if (ps) ps.classList.add('open');
    }
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

        const sw = window.innerWidth;
        const sh = window.innerHeight;
        const map = getTouchElementsMap();
        for (const k in map) {
            const el = map[k];
            if (el) {
                const rect = el.getBoundingClientRect();
                el.style.position = 'fixed';
                el.style.left = Math.max(8, Math.min(sw - el.offsetWidth - 8, rect.left)) + 'px';
                el.style.top = Math.max(8, Math.min(sh - el.offsetHeight - 8, rect.top)) + 'px';
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
        }
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
    if (settings && settings.deviceMode === 'pc') {
        document.body.classList.remove('touch-on');
    }
    const overlay = document.getElementById('touchLayoutEditor');
    if (overlay) overlay.style.display = 'none';

    if (wasGameViewHiddenForEditor) {
        const gv = document.getElementById('gameView');
        if (gv) gv.style.display = 'none';
        wasGameViewHiddenForEditor = false;
    }
    const ss = document.getElementById('startScreen');
    if (ss) ss.style.pointerEvents = 'auto';

    const exitBtn = document.getElementById('btnTouchExit');
    if (exitBtn) {
        exitBtn.style.display = '';
        exitBtn.style.pointerEvents = '';
    }

    sCinematicUI('close');

    if (touchEditorSource === 'facilitySettings') {
        const hModal = document.getElementById('settingsModal');
        if (hModal) hModal.classList.add('open');
    } else if (touchEditorSource === 'inGameSettings') {
        const inGameModal = document.getElementById('inGameSettingsModal');
        if (inGameModal) inGameModal.style.display = 'flex';
    } else if (gameState === 'paused' || touchEditorSource === 'pause') {
        const ps = document.getElementById('pauseScreen');
        if (ps) ps.classList.add('open');
    }
}

function closeTouchLayoutEditor() {
    cancelTouchLayoutEditor();
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

let touchLayoutListenersBound = false;
function setupTouchLayoutEditorListeners() {
    if (touchLayoutListenersBound) return;
    touchLayoutListenersBound = true;

    const btnDef = document.getElementById('btnEditorDefault');
    if (btnDef) {
        btnDef.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            resetTouchLayout(true);
        });
        btnDef.addEventListener('pointerdown', e => e.stopPropagation());
    }
    const btnCancel = document.getElementById('btnEditorCancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            cancelTouchLayoutEditor();
        });
        btnCancel.addEventListener('pointerdown', e => e.stopPropagation());
    }
    const btnSave = document.getElementById('btnEditorSave');
    if (btnSave) {
        btnSave.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            saveTouchLayout();
        });
        btnSave.addEventListener('pointerdown', e => e.stopPropagation());
    }
    const scaleRange = document.getElementById('editorScaleRange');
    if (scaleRange) {
        scaleRange.addEventListener('input', e => {
            e.stopPropagation();
            onEditorScaleInput(e.target.value);
        });
        scaleRange.addEventListener('pointerdown', e => e.stopPropagation());
    }
    const opacityRange = document.getElementById('editorOpacityRange');
    if (opacityRange) {
        opacityRange.addEventListener('input', e => {
            e.stopPropagation();
            onEditorOpacityInput(e.target.value);
        });
        opacityRange.addEventListener('pointerdown', e => e.stopPropagation());
    }
    const topbar = document.querySelector('.layout-editor-topbar');
    if (topbar) {
        topbar.addEventListener('pointerdown', e => e.stopPropagation());
        topbar.addEventListener('mousedown', e => e.stopPropagation());
        topbar.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    }
}

window.addEventListener('resize', applyTouchLayout);

const touchStick = { ox: 0, oy: 0 };
function setupTouchControls() {
    setupTouchLayoutEditorListeners();
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
    if (btnAtk) {
        let atkPointerId = -1;
        const startAtk = e => {
            if (isEditingTouchLayout) return;
            e.preventDefault();
            e.stopPropagation();
            document.body.classList.add('touch-on');
            atkPointerId = (e && typeof e.pointerId !== 'undefined') ? e.pointerId : -1;
            isTouchAtkPressed = true;
            if (gameState === 'playing') playerAttack(true);
            try { btnAtk.setPointerCapture(e.pointerId); } catch (_) {}
        };
        const stopAtk = e => {
            if (!e || typeof e.pointerId === 'undefined' || e.pointerId === atkPointerId || atkPointerId === -1) {
                isTouchAtkPressed = false;
                atkPointerId = -1;
            }
        };
        btnAtk.addEventListener('pointerdown', startAtk);
        btnAtk.addEventListener('pointerup', stopAtk);
        btnAtk.addEventListener('pointercancel', stopAtk);
        btnAtk.addEventListener('lostpointercapture', () => {
            isTouchAtkPressed = false;
            atkPointerId = -1;
        });
        window.addEventListener('pointerup', stopAtk);
        window.addEventListener('pointercancel', stopAtk);
        window.addEventListener('blur', () => {
            isTouchAtkPressed = false;
            atkPointerId = -1;
        });
    }
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

// ---- Kontrol zoom tampilan: tombol HUD, pinch dua jari, keyboard ----
function setupZoomHud() {
    const inBtn = document.getElementById('btnZoomIn');
    const outBtn = document.getElementById('btnZoomOut');
    const resetBtn = document.getElementById('btnZoomReset');
    if (inBtn) {
        inBtn.addEventListener('click', function (e) {
            e.preventDefault();
            adjustViewZoom(ZOOM_STEP);
        });
    }
    if (outBtn) {
        outBtn.addEventListener('click', function (e) {
            e.preventDefault();
            adjustViewZoom(-ZOOM_STEP);
        });
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', function (e) {
            e.preventDefault();
            resetViewZoom();
        });
    }
    applyViewZoom(viewZoom, false);
}
const _zoomPointers = new Map();
let _pinchStartDist = 0;
let _pinchStartZoom = 1;
let _pinchActive = false;
function _zoomPointerDist() {
    let a = null, b = null;
    for (const p of _zoomPointers.values()) {
        if (!a) { a = p; } else { b = p; break; }
    }
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
}
function setupZoomGesture() {
    const el = document.getElementById('gameCanvas');
    if (!el) return;
    el.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'touch') return;
        if (gameState !== 'playing') return;
        _zoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (_zoomPointers.size === 2) {
            _pinchStartDist = _zoomPointerDist();
            _pinchStartZoom = viewZoom;
            _pinchActive = _pinchStartDist > 10;
        }
    }, { passive: true });
    el.addEventListener('pointermove', function (e) {
        const p = _zoomPointers.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (!_pinchActive || _zoomPointers.size < 2) return;
        const d = _zoomPointerDist();
        if (d < 10 || _pinchStartDist < 10) return;
        applyViewZoom(_pinchStartZoom * (d / _pinchStartDist), false);
    }, { passive: true });
    function endZoomPointer(e) {
        if (!_zoomPointers.has(e.pointerId)) return;
        _zoomPointers.delete(e.pointerId);
        if (_zoomPointers.size < 2) {
            if (_pinchActive) applyViewZoom(viewZoom, true);
            _pinchActive = false;
            _pinchStartDist = 0;
        }
    }
    el.addEventListener('pointerup', endZoomPointer, { passive: true });
    el.addEventListener('pointercancel', endZoomPointer, { passive: true });
}
setupZoomHud();
setupZoomGesture();

function drawCrosshair() {
    if (gameState !== 'playing' || document.body.classList.contains('touch-on')) return;
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
// isAdmin & godmode declared at top of file

const ADMIN_WEAPONS_FULL = ['knife', 'rifle', 'grenade', 'bazooka', 'shield', 'minigun'];
const ADMIN_PERKS_FULL = [
    'nano_plating', 'nano_plating',
    'adrenaline', 'adrenaline',
    'plasma', 'plasma',
    'cryo_vent',
    'vampiric',
    'ricochet',
    'kinetic_emp',
    'thermal_trail'
];

function grantAdminFullArsenal(target) {
    if (!target) return;
    target.weapons = [...ADMIN_WEAPONS_FULL];
    if (!target.currentWeapon || !ADMIN_WEAPONS_FULL.includes(target.currentWeapon) || target.currentWeapon === 'knife') {
        target.currentWeapon = 'rifle';
    }
    target.perks = [...ADMIN_PERKS_FULL];
    target.perkNano = 2;
    target.perkAdrenaline = 2;
    target.perkPlasma = 2;
    target.perkCryo = 1;
    target.perkVampire = 1;
    target.perkRicochet = 1;
    target.perkEmp = 1;
    target.perkThermal = 1;

    target.maxHp = Math.max(target.maxHp || 100, 300);
    target.hp = target.maxHp;
    target.atk = Math.max(target.atk || 20, 55);
    target.speed = Math.max(target.speed || 3.5, 4.8);
    target.dashSpeed = Math.max(target.dashSpeed || 8, 11);
    target.plevel = Math.max(target.plevel || 1, 15);
    target.shieldTimer = 0;
    target.minigunHeat = 0;
    target.minigunOverheat = 0;
    target.weaponCooldowns = {};
    ADMIN_WEAPONS_FULL.forEach(w => {
        target.weaponCooldowns[w] = 0;
    });
}

function openAdminLogin() {
    isAdmin = true;
    openAdminArsenalModal();
}

function submitAdminLogin() {
    isAdmin = true;
    try {
        const high = loadHigh();
        high.highestLevel = 15;
        high.lastLevel = 14;
        high.savedWeapons = [...ADMIN_WEAPONS_FULL];
        high.savedCurrentWeapon = 'rifle';
        high.savedPerks = [...ADMIN_PERKS_FULL];
        high.savedExp = 9999;
        high.savedPLevel = 15;
        saveHigh(high);
        checkContinueBtn();
    } catch (e) {}

    if (player) {
        grantAdminFullArsenal(player);
    }

    renderAdminLevels();
    applyLang();
    announceAdmin(tt('admin_welcome'));
    sWeaponUnlock();
    openAdminArsenalModal();
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
        const isApex = (i === LEVELS - 1);
        const isHarvester = (i === 9);
        if (isApex) {
            b.textContent = 'CH 15 (APEX)';
            b.className = 'admin-lvl-btn admin-lvl-apex';
            b.title = 'CH 15: The Monolith';
        } else if (isHarvester) {
            b.textContent = 'CH 10 (BOSS)';
            b.className = 'admin-lvl-btn admin-lvl-boss';
            b.title = 'CH 10: Mother Harvester';
        } else {
            b.textContent = 'CH ' + String(i + 1).padStart(2, '0');
            b.className = 'admin-lvl-btn';
            b.title = tt('admin_chapter_fmt', { n: i + 1 });
        }
        b.addEventListener('click', () => adminJump(i));
        wrap.appendChild(b);
    }
}

function adminStartAt(level) {
    isAdmin = true;
    isEndlessMode = false;
    level = Math.max(0, Math.min(LEVELS - 1, Math.floor(Number(level) || 0)));
    ensureAudio();
    closeAdminArsenalModal();
    const hv = document.getElementById('homeView');
    if (hv) hv.style.display = 'none';
    const gv = document.getElementById('gameView');
    if (gv) gv.style.display = '';
    document.body.classList.add('game-on');
    const ss = document.getElementById('startScreen');
    if (ss) ss.style.display = 'none';
    const ds = document.getElementById('deathScreen');
    if (ds) ds.style.display = 'none';
    const ws = document.getElementById('winScreen');
    if (ws) ws.style.display = 'none';
    const ps = document.getElementById('pauseScreen');
    if (ps) ps.classList.remove('open');
    gameState = 'playing';
    menuDemo = false;
    totalKills = 0;
    totalTime = 0;
    showHUD();
    hideCursor();
    initLevel(level);
    if (player) {
        grantAdminFullArsenal(player);
        if (godmode) {
            player.maxHp = Math.max(player.maxHp, 999);
            player.hp = player.maxHp;
            player.invincible = 0;
        }
    }
    sWeaponUnlock();
    announceAdmin(tt('admin_jump_msg') + (level + 1));
    updateUI();
}

function adminJump(level) {
    isAdmin = true;
    adminStartAt(level);
}

function adminTestBoss() {
    isAdmin = true;
    adminStartAt(LEVELS - 1);
}

function adminUnlockExit() {
    isAdmin = true;
    if (!artifacts || !artifacts.length) return;
    artifacts.forEach(a => { a.collected = true; });
    coinsCollected = artifacts.length;
    sArtifact();
    announceAdmin('AIRLOCK EXIT UNLOCKED');
    updateUI();
}

function adminToggleGod() {
    isAdmin = true;
    godmode = !godmode;
    if (player) {
        if (godmode) {
            player.maxHp = Math.max(player.maxHp, 999);
            player.hp = player.maxHp;
            player.invincible = 0;
        } else {
            player.invincible = 0;
        }
    }
    const b = document.getElementById('adminGodBtn');
    if (b) b.textContent = godmode ? tt('admin_god_on') : tt('admin_god_off');
    updateAdminModalUI();
    announceAdmin(godmode ? '🛡️ GODMODE ON (KEBAL)' : '🛡️ GODMODE OFF');
}

function adminKillAll() {
    isAdmin = true;
    if (!monsters || !monsters.length) return;
    monsters.forEach(m => {
        if (m.hp > 0) {
            m.hp = 0;
            totalKills++;
            registerComboKill();
            addParticle(m.x, m.y, m.color || '#ff0055', 20, 6, 35);
            gainExp(m.exp || 20);
        }
    });
    sArtifact();
    announceAdmin('💀 ALL MONSTERS PURGED');
    updateUI();
}

function adminHealFull() {
    isAdmin = true;
    if (!player) return;
    player.hp = player.maxHp;
    sMedPod();
    addParticle(player.x, player.y, '#2ecc71', 25, 5, 30);
    announceAdmin('HEALTH RESTORED 100%');
    updateUI();
}

function adminRevealMap() {
    isAdmin = true;
    if (!fogOfWar) return;
    for (let y = 0; y < mazeH; y++) {
        for (let x = 0; x < mazeW; x++) {
            fogOfWar[y][x] = true;
            if (visitedTiles && visitedTiles[y]) visitedTiles[y][x] = true;
        }
    }
    sCommsBeep();
    announceAdmin('FULL MAP REVEALED');
    updateUI();
}

function adminGiveAllWeapons() {
    isAdmin = true;
    if (player) {
        player.weapons = [...ADMIN_WEAPONS_FULL];
        if (!player.currentWeapon) player.currentWeapon = 'rifle';
        player.weaponCooldowns = {};
        ADMIN_WEAPONS_FULL.forEach(w => { player.weaponCooldowns[w] = 0; });
        player.minigunHeat = 0;
        player.minigunOverheat = 0;
        sWeaponUnlock();
        if (typeof floatingTexts !== 'undefined') {
            floatingTexts.push({
                x: player.x,
                y: player.y - 25,
                text: '⚔️ ALL WEAPONS UNLOCKED!',
                color: '#00f0ff',
                life: 90,
                maxLife: 90
            });
        }
        updateUI();
    }
    try {
        const high = loadHigh();
        high.savedWeapons = [...ADMIN_WEAPONS_FULL];
        saveHigh(high);
    } catch (_) {}
    announceAdmin('⚔️ SEMUA SENJATA DIAKTIFKAN');
}

function adminFullGodLoadout() {
    godmode = true;
    isAdmin = true;
    if (player) {
        grantAdminFullArsenal(player);
        player.maxHp = Math.max(player.maxHp, 999);
        player.hp = player.maxHp;
        player.invincible = 0;
        sWeaponUnlock();
        if (typeof floatingTexts !== 'undefined') {
            floatingTexts.push({
                x: player.x,
                y: player.y - 34,
                text: '⚡ GODMODE + FULL ARSENAL + MAX SKILLS!',
                color: '#ffd700',
                life: 140,
                maxLife: 140
            });
        }
    }
    try {
        const high = loadHigh();
        high.highestLevel = 15;
        high.savedWeapons = [...ADMIN_WEAPONS_FULL];
        high.savedCurrentWeapon = 'rifle';
        high.savedPerks = [...ADMIN_PERKS_FULL];
        high.savedExp = 9999;
        high.savedPLevel = 15;
        saveHigh(high);
    } catch (_) {}
    announceAdmin('⚡ GODMODE & MAX LOADOUT AKTIF!');
    updateAdminModalUI();
    updateUI();
}

function adminEquipWeapon(key) {
    isAdmin = true;
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
    isAdmin = true;
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
    isAdmin = true;
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
        b.style.padding = '6px 2px';
        b.style.cursor = 'pointer';
        if (i === currentLevel && gameState === 'playing') {
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

function updateAdminModalUI() {
    const godBtn = document.getElementById('adminModalGodBtn');
    if (godBtn) {
        godBtn.textContent = godmode ? '🛡️ KEBAL (GODMODE): ON' : '🛡️ KEBAL (GODMODE): OFF';
        godBtn.style.color = godmode ? '#ffd700' : '#e6edf3';
        godBtn.style.borderColor = godmode ? '#ffd700' : 'rgba(255,215,0,0.5)';
    }
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

// Banner pengumuman umum (Endless Survival dll). textContent → aman dari XSS.
function announceLevel(msg) {
    try {
        const a = document.getElementById('levelAnnounce');
        if (!a) return;
        a.textContent = String(msg == null ? '' : msg);
        a.style.color = '#00f0ff';
        a.style.opacity = 1;
        clearTimeout(announceLevel._t);
        announceLevel._t = setTimeout(() => { a.style.opacity = 0; }, 2400);
    } catch (e) {}
}

// Escape HTML untuk string tak terpercaya (callsign peer co-op) sebelum masuk innerHTML.
function sanitizeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Alias reward nanite (Endless Survival) → sistem Pohon Talenta.
function addNanites(amount) {
    addNaniteShards(amount, player ? player.x : undefined, player ? player.y : undefined);
}

// Pabrik monster tunggal untuk Endless Survival. Menghormati multiplier difficulty.
// Harvester (butuh filamen statis) & Monolith (boss arena khusus) dipetakan ke tipe mobile.
const ENDLESS_TYPE_MAP = {
    slime: 'Slime', bat: 'Bat', crawl: 'Crawl', ghost: 'Ghost', harvester: 'Dark Knight',
    darkKnight: 'Dark Knight', dragon: 'Dragon', lich: 'Lich', beholder: 'Beholder',
    mimic: 'Mimic', theMonolith: 'Final Boss'
};
function createMonster(typeKey, x, y) {
    const name = ENDLESS_TYPE_MAP[typeKey] || 'Slime';
    const type = MONSTER_TYPES.find(t => t.name === name) || MONSTER_TYPES[0];
    const sMult = getDiffStatMult();
    const vMult = getDiffSpeedMult();
    const hp = Math.round(type.hp * sMult);
    return {
        x: x, y: y, vx: 0, vy: 0,
        hp: hp, maxHp: hp,
        atk: Math.round(type.atk * sMult),
        speed: type.speed * vMult,
        size: Math.min(type.size, 22),
        color: type.color, name: type.name, exp: type.exp,
        isBoss: type.name === 'Final Boss',
        isHarvester: false, filamentTrapCooldown: 0,
        ai: 'chase', state: 'wander',
        angle: Math.random() * Math.PI * 2,
        wanderTimer: 40, stuckTimer: 0, blocked: false,
        rx: 0, ry: 0, turnDir: Math.random() < 0.5 ? 1 : -1, netT2: 0,
        lastWatchX: x, lastWatchY: y,
        lastSeen: null, lastSeenTimer: 0,
        path: null, pathIdx: 0, pathCooldown: 20,
        stall: 0, lastWayD: 99999, checkTimer: 30,
        lastPosX: 0, lastPosY: 0, wanderTarget: null,
        pauseTimer: 0, lastPx: -1, lastPy: -1,
        attackCooldown: 0, stunTimer: 0, hitFlash: 0,
        burnTimer: 0, freezeTimer: 0, poisonTimer: 0, diveTimer: 0,
        disguised: false, riposteTimer: 0,
        level: currentLevel, ranged: type.name === 'Lich' || type.name === 'Beholder'
    };
}

function checkContinueBtn() {
    try {
        if (typeof updateStartScreenDirectiveUI === 'function') {
            updateStartScreenDirectiveUI();
        }
        const high = loadHigh();
        const last = Math.floor(Number(high.lastLevel));
        const btnContinue = document.getElementById('btnContinue');
        const btnStart = document.getElementById('btnStart');
        const btnStartText = document.getElementById('btnStartText');
        if (!btnContinue) return;

        if (typeof activeGameDirective !== 'undefined' && activeGameDirective === 'endless') {
            btnContinue.style.display = 'none';
            btnContinue.className = 'btn secondary';
            if (btnStart) {
                btnStart.className = 'btn';
                if (btnStartText) {
                    btnStartText.textContent = (lang === 'en' ? 'ENTER SURVIVAL ARENA' : 'MASUK ARENA SURVIVAL');
                }
                const actions = btnStart.parentElement;
                if (actions && btnContinue && actions.firstElementChild !== btnStart) {
                    actions.insertBefore(btnStart, actions.firstElementChild);
                }
            }
            return;
        }

        if (Number.isFinite(last) && last > 0 && last < LEVELS) {
            btnContinue.style.display = '';
            btnContinue.className = 'btn btn-continue-primary';
            const label = (lang === 'en' ? 'CONTINUE MISSION (SECTOR ' : 'LANJUTKAN MISI (SEKTOR ') + (last + 1) + ')';
            const span = btnContinue.querySelector('span');
            if (span) { span.textContent = label; }
            else { btnContinue.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24"><polygon points="5 3 13 12 5 21 5 3"/><polygon points="11 3 19 12 11 21 11 3"/></svg><span>' + label + '</span>'; }

            const actions = btnContinue.parentElement;
            if (actions && btnStart && actions.firstElementChild !== btnContinue) {
                actions.insertBefore(btnContinue, btnStart);
            }
            if (btnStart) {
                btnStart.className = 'btn secondary';
                if (btnStartText) {
                    btnStartText.textContent = (lang === 'en' ? 'START OVER (SECTOR 1)' : 'MULAI DARI AWAL (SEKTOR 1)');
                }
            }
        } else {
            btnContinue.style.display = 'none';
            btnContinue.className = 'btn secondary';
            if (btnStart) {
                btnStart.className = 'btn';
                if (btnStartText) {
                    btnStartText.textContent = (lang === 'en' ? 'PLAY NOW' : 'MAIN SEKARANG');
                }
                const actions = btnStart.parentElement;
                if (actions && btnContinue && actions.firstElementChild !== btnStart) {
                    actions.insertBefore(btnStart, actions.firstElementChild);
                }
            }
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
    if (typeof checkDeviceOrientationPrompt === 'function') checkDeviceOrientationPrompt();
    const isDirectiveEndless = (typeof activeGameDirective !== 'undefined' && activeGameDirective === 'endless') ||
                               (typeof window !== 'undefined' && window.activeGameDirective === 'endless');
    if (isDirectiveEndless && typeof startEndlessMode === 'function') {
        startEndlessMode();
        return;
    }
    isEndlessMode = false;
    gameState = 'playing';
    menuDemo = false;
    const highState = loadHigh();
    totalKills = Number.isFinite(highState.savedKills) ? Number(highState.savedKills) : 0;
    totalTime = Number.isFinite(highState.savedTime) ? Number(highState.savedTime) : 0;
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
        if (master <= 0 || (settings && settings.muted)) return;

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
    screen.style.display = 'flex';
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
            screen.style.display = 'none';
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
    setTimeout(() => {
        if (prologueActive) {
            document.addEventListener('keydown', onInput);
            document.addEventListener('click', onClickContinue);
        }
    }, 120);
}

function startTutorialMode() {
    try {
        localStorage.removeItem('vita_tutorial_done');
    } catch (_) {}
    prologuePlayed = false;
    startGame(true);
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

    const isDirectiveEndless = (typeof activeGameDirective !== 'undefined' && activeGameDirective === 'endless') ||
                               (typeof window !== 'undefined' && window.activeGameDirective === 'endless');
    if (isDirectiveEndless && typeof startEndlessMode === 'function') {
        startEndlessMode();
        return;
    }

    isEndlessMode = false;

    if (!bypassDeviceCheck && typeof window !== 'undefined' && typeof window.confirm === 'function') {
        const savedLast = Math.floor(Number(loadHigh().lastLevel)) || 0;
        if (savedLast > 0 && !window.confirm(tt('restart_confirm'))) {
            return;
        }
    }
    ensureAudio();
    document.getElementById('deathScreen').style.display = 'none';
    document.getElementById('winScreen').style.display = 'none';
    if (typeof checkDeviceOrientationPrompt === 'function') checkDeviceOrientationPrompt();

    try {
        const high = loadHigh();
        delete high.savedWeapons;
        delete high.savedCurrentWeapon;
        delete high.savedPerks;
        delete high.savedExp;
        delete high.savedPLevel;
        delete high.lastLevel;
        delete high.savedKills;
        delete high.savedTime;
        saveHigh(high);
        checkContinueBtn();
    } catch(e){}
    player = null;

    // Play prologue cutscene before first level (only once per session, bypass if in co-op)
    const isCoopSession = Boolean(coopRoomId);
    if (!prologuePlayed && !isCoopSession) {
        document.getElementById('startScreen').style.display = 'none';
        gameState = 'cutscene';
        menuDemo = false;
        totalKills = 0;
        totalTime = 0;
        playPrologueCutscene(function() {
            // After prologue ends, start gameplay with instant curtain and background init
            triggerFacilityLoading({
                title: tt('loading_sector_title').replace('{s}', 1),
                duration: 1250,
                instant: true,
                onPrepare: () => {
                    gameState = 'playing';
                    showHUD();
                    hideCursor();
                    initLevel(0);
                }
            });
        });
    } else {
        triggerFacilityLoading({
            title: tt('loading_sector_title').replace('{s}', 1),
            duration: 1250,
            instant: true,
            onPrepare: () => {
                document.getElementById('startScreen').style.display = 'none';
                gameState = 'playing';
                menuDemo = false;
                totalKills = 0;
                totalTime = 0;
                showHUD();
                hideCursor();
                initLevel(0);
            }
        });
    }
}

function restartGame() {
    isTouchAtkPressed = false;
    if (typeof isEndlessMode !== 'undefined' && isEndlessMode) {
        startEndlessMode();
        return;
    }
    const doRestart = () => {
        isEndlessMode = false;
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
    };

    if (typeof triggerFacilityLoading === 'function') {
        triggerFacilityLoading({
            title: tt('loading_sector_title').replace('{s}', 1),
            duration: 1200,
            instant: true,
            onPrepare: doRestart
        });
    } else {
        doRestart();
    }
}

function togglePause(on) {
    if (on) isTouchAtkPressed = false;
    const overlay = document.getElementById('pauseScreen');
    if (on) {
        gameState = 'paused';
        stopAmbientDrone();
        const secVal = document.getElementById('pauseSectorVal');
        const secLbl = overlay ? overlay.querySelector('[data-i18n="pause_stat_sector"]') : null;
        if (isEndlessMode) {
            if (secLbl) secLbl.textContent = lang === 'en' ? 'WAVE' : 'GELOMBANG';
            if (secVal) secVal.textContent = endlessWave + ' (∞)';
        } else {
            if (secLbl) secLbl.textContent = lang === 'en' ? 'SECTOR' : 'SEKTOR';
            if (secVal) secVal.textContent = (currentLevel + 1) + ' / ' + LEVELS;
        }
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
    if (typeof isEditingTouchLayout !== 'undefined' && isEditingTouchLayout) return;
    const doReturnToHub = () => {
        isEndlessMode = false;
        if (typeof updateStartScreenDirectiveUI === 'function') updateStartScreenDirectiveUI();
        isTouchAtkPressed = false;
        gameState = 'menu';
        menuDemo = true;
        stopAmbientDrone();
        stopProceduralOST();
        const ps = document.getElementById('pauseScreen');
        if (ps) ps.classList.remove('open');
        const ds = document.getElementById('deathScreen');
        if (ds) ds.style.display = 'none';
        const ws = document.getElementById('winScreen');
        if (ws) ws.style.display = 'none';
        hideHUD();
        showCursor();
        const ss = document.getElementById('startScreen');
        if (ss) ss.style.display = 'flex';
        initLevel(0);
        const gv = document.getElementById('gameView');
        const hv = document.getElementById('homeView');
        if (gv) gv.style.display = 'none';
        if (hv) hv.style.display = '';
        document.body.classList.remove('game-on');
        if (typeof resize === 'function') resize();
    };

    if (typeof triggerFacilityLoading === 'function') {
        triggerFacilityLoading({
            title: tt('loading_game_to_hub'),
            duration: 1150,
            instant: true,
            onPrepare: doReturnToHub
        });
    } else {
        doReturnToHub();
    }
}

const adminCodeInput = document.getElementById('adminCode');
if (adminCodeInput) {
    adminCodeInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitAdminLogin(); }
    });
}

const gVol = document.getElementById('gVolume');
if (gVol) {
    gVol.addEventListener('input', e => setMasterVolume(e.target.value, true));
    gVol.value = Math.max(0, Math.min(100, Math.round(Number(settings.volume) || 70)));
}
const gBright = document.getElementById('gBrightness');
if (gBright) {
    gBright.addEventListener('input', e => applyBrightness(e.target.value));
    gBright.value = Math.max(30, Math.min(180, Math.round(Number(settings.brightness) || 100)));
}

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
    qualSelInit.value = VITA_QUALS.includes(settings.quality) ? settings.quality : 'hd';
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
    m.classList.add('open');
    m.style.display = 'flex';
    sCinematicUI('open');
}

function closePauseSettings() {
    const m = document.getElementById('inGameSettingsModal');
    if (m) { m.classList.remove('open'); m.style.display = 'none'; }
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

    setVal('pauseQuality', settings.quality || 'hd');
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

// VITA v2.0 INDUSTRIAL MODULE (procedural-only, shared-buffer safe)
// Objective tracker + tutorial FTUE + damage vignette + boss intro.
// Semua fungsi ber-prefix vita2* agar tidak tabrakan scope global.

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
    if (typeof isEndlessMode !== 'undefined' && isEndlessMode) {
        const w = (typeof endlessWave !== 'undefined') ? endlessWave : 1;
        setHudText(tx, tt('endless_objective') + ' — ' + tt('endless_badge_wave').replace('{w}', w));
        el.classList.remove('tracker-ready');
        return;
    }
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

// 
// coopWs & coopPeers declared at top of file
let coopRelayUrl = 'ws://localhost:8080';
// Tautan undangan (parameter ?coop=KODE & relay=ALAMAT) hanya boleh dipakai
// sekali per pemuatan halaman agar membuka lobi berulang tidak menggeser tab.
let coopInviteConsumed = false;

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function openCoopLobbyModal() {
    if (typeof ensureAudio === 'function') {
        try { ensureAudio(); } catch (_) {}
    }
    const m = document.getElementById('coopLobbyModal');
    if (!m) return;
    m.classList.add('open');
    m.style.display = 'flex';

    // Undangan (?coop=KODE & relay=ALAMAT) dikonsumsi sekali: relay dulu, lalu
    // pilih tab. Bila ada kode, langsung prefill form "Gabung".
    const invite = (typeof takeCoopInvite === 'function') ? takeCoopInvite() : { code: '', relay: '' };
    if (invite.relay) {
        persistCoopRelayUrl(invite.relay);
        coopRelayUrl = invite.relay;
    }
    syncCoopRelayInput();

    const joinInput = document.getElementById('coopJoinInput');
    const joinHint = document.getElementById('coopJoinHint');
    if (invite.code) {
        switchCoopTab('join');
        if (joinInput) {
            joinInput.value = invite.code;
            try { joinInput.focus(); } catch (_) {}
        }
        if (joinHint) joinHint.style.display = 'block';
    } else {
        switchCoopTab('host');
        if (!coopRoomId) {
            initHostLobbyRoom();
        }
    }
    updateCoopSlotsUI();
    refreshCoopInviteLink();
}

function closeCoopLobbyModal() {
    const m = document.getElementById('coopLobbyModal');
    if (m) {
        m.classList.remove('open');
        m.style.display = 'none';
    }
}

function switchCoopTab(tab) {
    const hostPanel = document.getElementById('coopHostPanel');
    const joinPanel = document.getElementById('coopJoinPanel');
    const tabHost = document.getElementById('coopTabHost');
    const tabJoin = document.getElementById('coopTabJoin');

    if (tab === 'host') {
        if (hostPanel) hostPanel.style.display = 'block';
        if (joinPanel) joinPanel.style.display = 'none';
        if (tabHost) tabHost.classList.add('active');
        if (tabJoin) tabJoin.classList.remove('active');
    } else {
        if (hostPanel) hostPanel.style.display = 'none';
        if (joinPanel) joinPanel.style.display = 'block';
        if (tabHost) tabHost.classList.remove('active');
        if (tabJoin) tabJoin.classList.add('active');
    }
}

function initHostLobbyRoom() {
    isCoopHost = true;
    coopRoomId = generateRoomCode();
    netSessionSeed = hashSeedToUint32(coopRoomId.toUpperCase().trim());
    localPlayerIndex = 0;
    const myCallsign = (typeof profileCallsign !== 'undefined' && profileCallsign) ? profileCallsign : 'PROTOTYPE-19';
    coopPeers = [
        { idx: 0, callsign: myCallsign, isHost: true }
    ];
    const codeEl = document.getElementById('coopRoomCodeDisplay');
    if (codeEl) codeEl.textContent = coopRoomId;
    refreshCoopInviteLink();
    connectCoopRelay();
}

function updateCoopSlotsUI() {
    const slotsEl = document.getElementById('coopPlayerSlots');
    if (!slotsEl) return;
    let html = '';
    for (let i = 0; i < MAX_PLAYERS; i++) {
        const peer = coopPeers.find(p => p.idx === i);
        const color = PLAYER_COLORS[i] || PLAYER_COLORS[0];
        if (peer) {
            html += '<div class="coop-slot-card" style="border-left-color:' + color.hex + ';">' +
                '<span class="coop-slot-num" style="color:' + color.hex + ';">[' + (i + 1) + ']</span>' +
                '<span class="coop-slot-name">' + sanitizeHtml(peer.callsign) + '</span>' +
                '<span class="coop-slot-badge" style="background:' + color.hex + ';color:#000;">' + (peer.isHost ? 'HOST' : 'READY') + '</span>' +
                '</div>';
        } else {
            html += '<div class="coop-slot-card" style="border-left-color:#334155;opacity:0.6;">' +
                '<span class="coop-slot-num" style="color:#64748b;">[' + (i + 1) + ']</span>' +
                '<span class="coop-slot-name" style="color:#64748b;">' + tt('coop_waiting_agent') + '</span>' +
                '<span class="coop-slot-badge" style="background:#1e293b;color:#64748b;">EMPTY</span>' +
                '</div>';
        }
    }
    slotsEl.innerHTML = html;
}

function copyCoopRoomCode() {
    if (!coopRoomId) return;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(coopRoomId);
        }
    } catch (_) {}
    const btn = document.getElementById('coopCopyCodeBtn');
    if (btn) {
        btn.textContent = tt('coop_code_copied');
        setTimeout(() => { if (btn) btn.textContent = tt('coop_copy_code_btn'); }, 2000);
    }
}

function submitJoinCoopRoom() {
    const input = document.getElementById('coopJoinInput');
    const errEl = document.getElementById('coopJoinError');
    if (!input) return;
    const code = input.value.trim().toUpperCase();
    if (code.length < 3) {
        if (errEl) { errEl.textContent = tt('coop_err_invalid_code'); errEl.style.display = 'block'; }
        return;
    }
    if (errEl) errEl.style.display = 'none';
    const joinHint = document.getElementById('coopJoinHint');
    if (joinHint) joinHint.style.display = 'none';

    coopRoomId = code;
    netSessionSeed = hashSeedToUint32(code.toUpperCase().trim());
    isCoopHost = false;
    // Indeks sementara; relay akan menetapkan indeks final lewat pesan WELCOME
    // (server-host otoritatif, mendukung hingga 4 pemain / indeks 0..3).
    localPlayerIndex = 1;
    const myCallsign = (typeof profileCallsign !== 'undefined' && profileCallsign) ? profileCallsign : 'AGENT-GUEST';
    coopPeers = [
        { idx: 0, callsign: 'HOST_OPERATIVE', isHost: true },
        { idx: 1, callsign: myCallsign, isHost: false }
    ];

    switchCoopTab('host');
    const codeEl = document.getElementById('coopRoomCodeDisplay');
    if (codeEl) codeEl.textContent = coopRoomId;
    const launchBtn = document.getElementById('coopLaunchBtn');
    if (launchBtn) {
        launchBtn.disabled = true;
        launchBtn.textContent = tt('coop_waiting_client');
    }
    updateCoopSlotsUI();
    refreshCoopInviteLink();
    connectCoopRelay();
}

// 
const COOP_DEFAULT_RELAY_URL = 'ws://localhost:8080';
const COOP_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zcmlic2lyZHBvdnVlZ2xpZ2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MzgxNjgsImV4cCI6MjEwNTAxNDE2OH0.zxjpGcBnphJG5bCkVH__Ez204obVowIQV4q6Cewl_O4';
const COOP_SUPABASE_REALTIME_URL = 'wss://msribsirdpovuegligcx.supabase.co/realtime/v1/websocket?apikey=' + COOP_SUPABASE_ANON_KEY + '&vsn=1.0.0';
let coopPhxHeartbeatTimer = null;
let coopPhxRef = 0;
const COOP_RELAY_URL_MAX = 256;
// Host: nama host / IPv4 / IPv6 dalam kurung siku. Port opsional 1..5 digit.
// Backtick ditulis sebagai \x60 agar aman bila blok ini dibaca tooling berbasis
// template string (lihat tests/test_web_security_qa.js TEST 25).
const COOP_RELAY_URL_RE = /^wss?:\/\/(?:\[[0-9a-f:]+\]|[a-z0-9.\-_]+)(?::\d{1,5})?(\/[^\s<>"'\x60]*)?$/i;
const COOP_RELAY_LOCAL_RE = /^wss?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(\/|$)/i;

// Baca override tersimpan. Literal kunci sengaja dipertahankan apa adanya
// (kontrak yang diverifikasi suite audit).
function getStoredCoopRelayUrl() {
    try {
        const saved = localStorage.getItem('vita_relay_url');
        return saved ? String(saved) : '';
    } catch (_) {
        return '';
    }
}

function persistCoopRelayUrl(raw) {
    try {
        if (raw) localStorage.setItem('vita_relay_url', raw);
        else localStorage.removeItem('vita_relay_url');
    } catch (_) {}
}

// Validasi + normalisasi alamat relay dari input user (input tak dipercaya).
// Mengembalikan '' bila tidak valid.
function normalizeCoopRelayUrl(raw) {
    if (typeof raw !== 'string') return '';
    let s = raw.trim();
    if (!s || s.length > COOP_RELAY_URL_MAX) return '';
    // Terima tempelan http(s):// (umum dari dashboard provider) → naikkan ke ws(s).
    if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice(8);
    else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice(7);
    if (!COOP_RELAY_URL_RE.test(s)) return '';
    return s;
}

function isLocalCoopRelayUrl(url) {
    return COOP_RELAY_LOCAL_RE.test(String(url || ''));
}

function isSupabaseCoopRelay(url) {
    return Boolean(url && String(url).indexOf('supabase.co/realtime') !== -1);
}

function getDefaultCoopRelayUrl() {
    try {
        if (typeof location !== 'undefined' && location.hostname) {
            const h = location.hostname;
            // Jika diakses dari internet hosting publik (bukan localhost / bukan LAN)
            if (location.protocol === 'https:' && h !== 'localhost' && h !== '127.0.0.1') {
                return COOP_SUPABASE_REALTIME_URL;
            }
            if (h && h !== 'localhost' && h !== '127.0.0.1' && h !== '::1') {
                const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
                return `${proto}//${h}:8080`;
            }
        }
    } catch (_) {}
    return COOP_DEFAULT_RELAY_URL;
}

function resolveCoopRelayUrl() {
    let url = coopRelayUrl;
    const saved = getStoredCoopRelayUrl();
    const isPublicWeb = (typeof location !== 'undefined' && location.protocol === 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1');

    if (saved && (!isPublicWeb || !isLocalCoopRelayUrl(saved))) {
        url = saved;
    } else if (!url || url === COOP_DEFAULT_RELAY_URL) {
        if (isPublicWeb) {
            return COOP_SUPABASE_REALTIME_URL;
        }
        url = getDefaultCoopRelayUrl();
    }
    // Cegah mixed-content: halaman https tidak boleh membuka ws:// (diblokir browser).
    try {
        if (typeof location !== 'undefined' && location.protocol === 'https:' && /^ws:\/\//i.test(url)) {
            url = 'wss://' + url.slice(5);
        }
    } catch (_) {}
    return url;
}

// Terapkan alamat relay dari input (tombol "Terapkan"/Enter): validasi,
// persist, perbarui badge + tautan undangan. Kosong = kembali ke default lokal.
function applyCoopRelayInput() {
    const input = document.getElementById('coopRelayInput');
    if (!input) return;
    const raw = String(input.value || '').trim();
    const normalized = raw ? normalizeCoopRelayUrl(raw) : '';
    if (raw && !normalized) {
        input.classList.add('coop-input-invalid');
        return;
    }
    input.classList.remove('coop-input-invalid');
    persistCoopRelayUrl(normalized);
    coopRelayUrl = normalized || COOP_DEFAULT_RELAY_URL;
    input.value = coopRelayUrl;
    updateCoopRelayBadge();
    refreshCoopInviteLink();
}

// Isi kolom input dari penyimpanan / default lalu sinkronkan badge.
function syncCoopRelayInput() {
    const input = document.getElementById('coopRelayInput');
    if (!input) return;
    input.value = resolveCoopRelayUrl();
    input.classList.remove('coop-input-invalid');
    updateCoopRelayBadge();
}

function updateCoopRelayBadge() {
    const badge = document.getElementById('coopRelayBadge');
    if (!badge) return;
    const key = isLocalCoopRelayUrl(resolveCoopRelayUrl()) ? 'coop_badge_local' : 'coop_badge_online';
    const label = tt(key);
    if (badge.textContent !== label) badge.textContent = label;
}

// Tautan undangan: origin+pathname + ?coop=KODE (+ &relay=... bila non-lokal).
// Kosong pada file:// (origin "null") karena tidak bisa dibagikan.
function buildCoopInviteLink() {
    if (!coopRoomId) return '';
    try {
        if (typeof location === 'undefined') return '';
        const origin = location.origin;
        if (!origin || origin === 'null') return '';
        const effective = resolveCoopRelayUrl();
        let link = origin + location.pathname + '?coop=' + encodeURIComponent(coopRoomId);
        if (effective && !isLocalCoopRelayUrl(effective)) {
            link += '&relay=' + encodeURIComponent(effective);
        }
        return link;
    } catch (_) {
        return '';
    }
}

function refreshCoopInviteLink() {
    const box = document.getElementById('coopInviteLink');
    if (box) box.value = buildCoopInviteLink();
}

function copyCoopInviteLink() {
    const link = buildCoopInviteLink();
    if (!link) return;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link);
    } catch (_) {}
    const btn = document.getElementById('coopCopyInviteBtn');
    // Tulis ke <span data-i18n> di dalam tombol agar label tetap bisa
    // diterjemahkan ulang oleh applyLang() (pola yang sama seperti tombol lain).
    const span = btn ? btn.querySelector('[data-i18n]') : null;
    if (span) {
        span.textContent = tt('coop_invite_copied');
        setTimeout(() => { if (span) span.textContent = tt('coop_copy_invite_btn'); }, 2000);
    }
}

// Baca parameter undangan dari query string (input tak dipercaya).
function parseCoopInvite(search) {
    const out = { code: '', relay: '' };
    try {
        const params = new URLSearchParams(search || '');
        const rawCode = String(params.get('coop') || '').trim().toUpperCase();
        if (/^[A-Z0-9]{3,8}$/.test(rawCode)) out.code = rawCode;
        const rawRelay = params.get('relay');
        if (rawRelay) out.relay = normalizeCoopRelayUrl(rawRelay);
    } catch (_) {}
    return out;
}

// Konsumsi undangan SEKALI saja per pemuatan halaman.
function takeCoopInvite() {
    if (coopInviteConsumed) return { code: '', relay: '' };
    coopInviteConsumed = true;
    try {
        return parseCoopInvite(window.location.search);
    } catch (_) {
        return { code: '', relay: '' };
    }
}

function connectCoopRelay() {
    try {
        const url = resolveCoopRelayUrl();
        const badge = document.getElementById('coopRelayBadge');

        // Buka WebSocket native
        if (typeof WebSocket !== 'undefined') {
            if (coopWs) {
                try { coopWs.close(); } catch (_) {}
            }
            if (coopPhxHeartbeatTimer) {
                clearInterval(coopPhxHeartbeatTimer);
                coopPhxHeartbeatTimer = null;
            }

            // Jalur 1: Supabase Cloud Realtime Relay (Web Hosting Publik Tanpa Server Pribadi)
            if (isSupabaseCoopRelay(url)) {
                coopWs = new WebSocket(url);
                const safeRoom = String(coopRoomId || '').toUpperCase().trim();
                const topic = `realtime:coop_${safeRoom}`;
                let guestJoinTimer = null;

                coopWs.onopen = () => {
                    coopPhxRef++;
                    const currentJoinRef = String(coopPhxRef);
                    coopWs.send(JSON.stringify({
                        topic: topic,
                        event: 'phx_join',
                        payload: { config: { broadcast: { self: false } } },
                        ref: currentJoinRef
                    }));

                    coopPhxHeartbeatTimer = setInterval(() => {
                        if (coopWs && coopWs.readyState === 1) {
                            coopWs.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' }));
                        }
                    }, 25000);
                };

                coopWs.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        // Saat channel phoenix berhasil di-join
                        if (data.event === 'phx_reply' && data.payload && data.payload.status === 'ok') {
                            if (badge) {
                                badge.textContent = 'RELAY: CLOUD (ONLINE)';
                                badge.classList.remove('unverified');
                                badge.classList.add('verified');
                            }
                            if (isCoopHost) {
                                localPlayerIndex = 0;
                            } else {
                                const sendGuestJoin = () => {
                                    if (!coopWs || coopWs.readyState !== 1) return;
                                    sendCoopMessage('JOIN', {
                                        roomId: coopRoomId,
                                        isHost: false,
                                        callsign: (typeof profileCallsign !== 'undefined' && profileCallsign) ? profileCallsign : 'AGENT-GUEST'
                                    });
                                };
                                sendGuestJoin();
                                if (guestJoinTimer) clearInterval(guestJoinTimer);
                                guestJoinTimer = setInterval(() => {
                                    if (!isCoopHost && coopPeers.length <= 1) {
                                        sendGuestJoin();
                                    } else {
                                        clearInterval(guestJoinTimer);
                                        guestJoinTimer = null;
                                    }
                                }, 1500);
                            }
                            return;
                        }

                        if (data.event === 'broadcast' && data.payload && data.payload.event === 'coop') {
                            const innerMsg = data.payload.msg;
                            if (!innerMsg || typeof innerMsg !== 'object') return;

                            // Otoritas Host pada Cloud Relay: sambut tamu yang bergabung
                            if (isCoopHost && innerMsg.type === 'JOIN') {
                                const guestCallsign = innerMsg.callsign || 'AGENT-GUEST';
                                let existing = coopPeers.find(p => p.callsign === guestCallsign);
                                let assignedIdx = existing ? existing.idx : coopPeers.length;
                                if (assignedIdx < MAX_PLAYERS) {
                                    if (!existing) {
                                        coopPeers.push({ idx: assignedIdx, callsign: guestCallsign, isHost: false });
                                    }
                                    updateCoopSlotsUI();
                                    sendCoopMessage('WELCOME', {
                                        peerIndex: assignedIdx,
                                        peers: coopPeers.map(p => ({ idx: p.idx, callsign: p.callsign, isHost: p.isHost }))
                                    });
                                    sendCoopMessage('PEER_JOIN', {
                                        peerIndex: assignedIdx,
                                        callsign: guestCallsign
                                    });
                                    if (gameState === 'playing' && !players[assignedIdx]) {
                                        const hostP = players[0] || player || { x: CELL * 1.5, y: CELL * 1.5 };
                                        players[assignedIdx] = spawnCoopPeerEntity(assignedIdx, guestCallsign, hostP.x + assignedIdx * 28, hostP.y);
                                    }
                                    const launchBtn = document.getElementById('coopLaunchBtn');
                                    if (launchBtn) {
                                        launchBtn.disabled = false;
                                        launchBtn.textContent = tt('coop_launch_btn');
                                    }
                                }
                                return;
                            }

                            // Tamu menerima WELCOME dari Host
                            if (!isCoopHost && innerMsg.type === 'WELCOME') {
                                if (guestJoinTimer) {
                                    clearInterval(guestJoinTimer);
                                    guestJoinTimer = null;
                                }
                                if (typeof innerMsg.peerIndex === 'number') {
                                    localPlayerIndex = innerMsg.peerIndex;
                                }
                                if (Array.isArray(innerMsg.peers)) {
                                    coopPeers = innerMsg.peers;
                                    updateCoopSlotsUI();
                                }
                                return;
                            }

                            handleCoopMessage(innerMsg);
                        }
                    } catch (_) {}
                };

                coopWs.onerror = () => {
                    if (badge) {
                        badge.textContent = 'RELAY: CLOUD (OFFLINE)';
                        badge.classList.remove('verified');
                        badge.classList.add('unverified');
                    }
                };

                coopWs.onclose = () => {
                    if (guestJoinTimer) {
                        clearInterval(guestJoinTimer);
                        guestJoinTimer = null;
                    }
                    if (coopPhxHeartbeatTimer) {
                        clearInterval(coopPhxHeartbeatTimer);
                        coopPhxHeartbeatTimer = null;
                    }
                    if (badge) {
                        badge.textContent = typeof tt === 'function' ? tt('coop_disconnected') : 'RELAY: DISCONNECTED';
                        badge.classList.remove('verified');
                        badge.classList.add('unverified');
                    }
                };
                return;
            }

            // Jalur 2: Relay WebSocket Lokal / Dedicated (tools/relay.mjs)
            coopWs = new WebSocket(url);
            coopWs.onopen = () => {
                if (badge) {
                    badge.textContent = typeof tt === 'function' ? tt('coop_connected') : 'RELAY: CONNECTED';
                    badge.classList.remove('unverified');
                    badge.classList.add('verified');
                }
                // Relay menetapkan peerIndex final lewat WELCOME (otoritatif).
                sendCoopMessage('JOIN', {
                    roomId: coopRoomId,
                    isHost: isCoopHost,
                    peerIndex: localPlayerIndex,
                    callsign: (typeof profileCallsign !== 'undefined' && profileCallsign) ? profileCallsign : 'AGENT-GUEST'
                });
            };
            coopWs.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleCoopMessage(msg);
                } catch (_) {}
            };
            coopWs.onerror = () => {
                if (badge) {
                    badge.textContent = typeof tt === 'function' ? tt('coop_status_error') : 'RELAY: LOCAL (OFFLINE)';
                    badge.classList.remove('verified');
                    badge.classList.add('unverified');
                }
                // Penyebab paling umum: server relay belum dijalankan.
                const errEl = document.getElementById('coopJoinError');
                if (errEl && !isCoopHost) {
                    errEl.textContent = tt('coop_err_generic');
                    errEl.style.display = 'block';
                }
            };
            coopWs.onclose = () => {
                if (badge) {
                    badge.textContent = typeof tt === 'function' ? tt('coop_disconnected') : 'RELAY: DISCONNECTED';
                    badge.classList.remove('verified');
                    badge.classList.add('unverified');
                }
            };
        }
    } catch (_) {}
}

function sendCoopMessage(type, payload) {
    if (!coopWs || coopWs.readyState !== WebSocket.OPEN) return;
    try {
        if (isSupabaseCoopRelay(coopWs.url || '')) {
            const topic = `realtime:coop_${coopRoomId}`;
            coopPhxRef++;
            coopWs.send(JSON.stringify({
                topic: topic,
                event: 'broadcast',
                payload: {
                    type: 'broadcast',
                    event: 'coop',
                    msg: { type, roomId: coopRoomId, ...payload }
                },
                ref: String(coopPhxRef)
            }));
        } else {
            coopWs.send(JSON.stringify({ type, roomId: coopRoomId, ...payload }));
        }
    } catch (_) {}
}

// ---- Fase 4 co-op: Multi-Target Monster AI, Revive Downed Operative, & Peer Combat ----
function getClosestActivePlayer(entity) {
    if (!players || !players.length) return player;
    let closest = null;
    let minDist = Infinity;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p || p.hp <= 0 || p.downed) continue;
        const d = dist(entity, p);
        if (d < minDist) {
            minDist = d;
            closest = p;
        }
    }
    return closest || players[0] || player;
}

function damagePlayerDowned(targetP, cause) {
    if (!targetP) return;
    targetP.hp = 0;
    if (coopRoomId && players && players.length > 1) {
        if (!targetP.downed) {
            targetP.downed = true;
            targetP.downTimer = 1800; // 30 detik pada 60fps
            targetP.reviveProgress = 0;
            sDie();
            addShockwave(targetP.x, targetP.y, 45, '#e11d48', 20);
            floatingTexts.push({
                x: targetP.x,
                y: targetP.y - 24,
                text: tt('coop_operative_downed'),
                color: '#e11d48',
                life: 90,
                maxLife: 90
            });
        }
        // Cek apakah seluruh skuad tumbang
        const hasAlive = players.some(p => p && p.hp > 0 && !p.downed);
        if (!hasAlive) {
            handlePlayerDeath(cause || 'Squad KIA');
        }
    } else {
        handlePlayerDeath(cause);
    }
}

function updateDownedAndRevive() {
    if (!coopRoomId || !players || players.length <= 1) return;
    for (let i = 0; i < players.length; i++) {
        const downedP = players[i];
        if (!downedP || !downedP.downed) continue;

        if (downedP.downTimer > 0) {
            downedP.downTimer--;
            if (downedP.downTimer % 30 === 0) {
                addParticle(downedP.x, downedP.y, '#e11d48', 2, 1.5, 12);
            }
        } else {
            downedP.dead = true;
        }

        let beingRevived = false;
        for (let j = 0; j < players.length; j++) {
            if (i === j) continue;
            const helper = players[j];
            if (helper && helper.hp > 0 && !helper.downed && dist(helper, downedP) < 42) {
                beingRevived = true;
                downedP.reviveProgress = (downedP.reviveProgress || 0) + 1;
                if (downedP.reviveProgress % 10 === 0) {
                    addParticle(downedP.x, downedP.y, '#00f0ff', 3, 2, 8);
                }
                if (downedP.reviveProgress >= 180) { // 3 detik interaksi
                    downedP.downed = false;
                    downedP.hp = Math.round((downedP.maxHp || 100) * 0.35);
                    downedP.invincible = 90;
                    downedP.reviveProgress = 0;
                    sEMPBlast();
                    addShockwave(downedP.x, downedP.y, 50, '#10b981', 18);
                    floatingTexts.push({
                        x: downedP.x,
                        y: downedP.y - 24,
                        text: tt('coop_operative_revived'),
                        color: '#10b981',
                        life: 80,
                        maxLife: 80
                    });
                }
                break;
            }
        }
        if (!beingRevived && downedP.reviveProgress > 0) {
            downedP.reviveProgress = Math.max(0, downedP.reviveProgress - 1);
        }
    }
}

function triggerRemotePeerAttack(p) {
    if (!p || p.hp <= 0 || p.downed || gameState !== 'playing') return;
    const curW = p.currentWeapon || 'knife';
    const wConf = WEAPONS[curW] || WEAPONS.knife;

    if (!p.weaponCooldowns) p.weaponCooldowns = {};
    if (p.weaponCooldowns[curW] > 0) return;

    p.weaponCooldowns[curW] = wConf.cooldown || 20;
    p.attackAnim = 12;

    if (curW === 'knife') {
        const range = 44;
        const ax = p.x + Math.cos(p.facing) * range * 0.7;
        const ay = p.y + Math.sin(p.facing) * range * 0.7;
        if (monsters) {
            monsters.forEach(m => {
                if (m.hp > 0 && dist({ x: ax, y: ay }, m) < range) {
                    const dmg = (p.atk || 25) * (0.85 + Math.random() * 0.3);
                    attackMonster(m, dmg);
                    addParticle(m.x, m.y, '#ffd700', 6, 3, 12);
                }
            });
        }
    } else if (curW === 'rifle') {
        const spd = 12;
        projectiles.push({
            x: p.x + Math.cos(p.facing) * 14,
            y: p.y + Math.sin(p.facing) * 14,
            dx: Math.cos(p.facing) * spd,
            dy: Math.sin(p.facing) * spd,
            life: 45,
            dmg: (p.atk || 25) * 1.5,
            isPlayer: true,
            ownerIndex: p.peerIndex,
            kind: 'rifle',
            color: '#00f0ff'
        });
        sPiercingRifle();
    } else if (curW === 'shotgun') {
        const spd = 9;
        for (let k = -2; k <= 2; k++) {
            const spread = p.facing + k * 0.12;
            projectiles.push({
                x: p.x + Math.cos(spread) * 12,
                y: p.y + Math.sin(spread) * 12,
                dx: Math.cos(spread) * spd,
                dy: Math.sin(spread) * spd,
                life: 25,
                dmg: (p.atk || 25) * 0.45,
                isPlayer: true,
                ownerIndex: p.peerIndex,
                kind: 'shotgun',
                color: '#f97316'
            });
        }
        sShotgun();
    } else if (curW === 'minigun') {
        const spd = 11;
        const spread = p.facing + (Math.random() - 0.5) * 0.15;
        projectiles.push({
            x: p.x + Math.cos(spread) * 14,
            y: p.y + Math.sin(spread) * 14,
            dx: Math.cos(spread) * spd,
            dy: Math.sin(spread) * spd,
            life: 35,
            dmg: (p.atk || 25) * 0.5,
            isPlayer: true,
            ownerIndex: p.peerIndex,
            kind: 'minigun',
            color: '#ffeaa7'
        });
        sMinigun();
    }
}

// ---- Fase 3 co-op: Sinkronisasi Input, Snapshot 20Hz, dan Client Prediction ----
// netSnapshotInterval & netLastSnapshotTime declared at top of file
let netPing = 0;
let netLastPingTime = 0;
let netPingInterval = 1500; // ms
let netInputSeq = 0;
let peerInputs = {}; // { [peerIndex]: { dx, dy, facing, dashing, firing, tick, time } }
let netLastSentInput = { dx: 0, dy: 0, facing: 0, dashing: false, firing: false, active: false, time: 0 };

function sampleAndSendPeerInput() {
    if (isCoopHost || !coopWs || coopWs.readyState !== WebSocket.OPEN) return;
    const lp = getLocalPlayer();
    if (!lp) return;

    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy = -1;
    if (keys['s'] || keys['arrowdown']) dy = 1;
    if (keys['a'] || keys['arrowleft']) dx = -1;
    if (keys['d'] || keys['arrowright']) dx = 1;
    if (touchMove.active && (touchMove.dx !== 0 || touchMove.dy !== 0)) {
        dx += touchMove.dx;
        dy += touchMove.dy;
    }
    if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
        lp.facing = Math.atan2(dy, dx);
    }
    if (mouseActive && !document.body.classList.contains('touch-on')) {
        const wpc = getWorldPerCss();
        const wx = cameraX + (mouseX - W / 2) * wpc;
        const wy = cameraY + (mouseY - H / 2) * wpc;
        lp.facing = Math.atan2(wy - lp.y, wx - lp.x);
    }

    const isDashing = !!(lp.dashing || keys['shift'] || (typeof isDashPressed !== 'undefined' && isDashPressed));
    const isFiring = !!(keys[' '] || isMouseDown || (typeof isFirePressed !== 'undefined' && isFirePressed));

    // CATATAN KRUSIAL MULTIPLAYER:
    // Client-side prediction fisik (moveEntity) sudah dijalankan satu kali secara otoritatif
    // oleh updatePlayer() di stepSimulation(). Dilarang memanggil moveEntity() lagi di sini
    // agar kecepatan tamu tidak berlipat ganda (200%) yang memicu desync rubberbanding.

    const curDx = Math.round(dx * 100) / 100;
    const curDy = Math.round(dy * 100) / 100;
    const curFacing = Math.round(lp.facing * 100) / 100;
    const now = performance.now();

    const inputChanged = (
        curDx !== netLastSentInput.dx ||
        curDy !== netLastSentInput.dy ||
        Math.abs(curFacing - netLastSentInput.facing) > 0.08 ||
        isDashing !== netLastSentInput.dashing ||
        isFiring !== netLastSentInput.firing
    );

    const isMovingOrActive = (curDx !== 0 || curDy !== 0 || isDashing || isFiring);
    const timeSinceLastSend = now - netLastSentInput.time;

    // Rate-limiting cerdas: kirim seketika saat ada perubahan arah/aksi,
    // batasi stream gerak aktif ke ~30Hz (33ms) agar tidak membanjiri relay/jaringan,
    // dan kirim 1 frame konfirmasi berhenti saat pemain kembali idle.
    if (inputChanged || (isMovingOrActive && timeSinceLastSend >= 33) || (!isMovingOrActive && netLastSentInput.active)) {
        netInputSeq++;
        sendCoopMessage('INPUT', {
            peerIndex: localPlayerIndex,
            seq: netInputSeq,
            dx: curDx,
            dy: curDy,
            facing: curFacing,
            dashing: isDashing,
            firing: isFiring
        });

        netLastSentInput.dx = curDx;
        netLastSentInput.dy = curDy;
        netLastSentInput.facing = curFacing;
        netLastSentInput.dashing = isDashing;
        netLastSentInput.firing = isFiring;
        netLastSentInput.active = isMovingOrActive;
        netLastSentInput.time = now;
    }
}

function updateRemotePeers() {
    if (!isCoopHost || !players) return;
    const now = performance.now();
    for (let i = 1; i < players.length; i++) {
        const p = players[i];
        if (!p) continue;
        const input = peerInputs[i];
        if (input) {
            // Jika input paket lebih tua dari 150ms tanpa pembaruan, netralkan agar tidak terus berjalan ke dinding
            if (typeof input.time === 'number' && (now - input.time > 150)) {
                input.dx = 0;
                input.dy = 0;
                input.firing = false;
                input.dashing = false;
            }

            let speed = p.speed || 2.4;
            if (input.dashing && (!p.dashCooldown || p.dashCooldown <= 0)) {
                p.dashing = true;
                p.dashTimer = 10;
                p.dashCooldown = 40;
            }
            if (p.dashing && p.dashTimer > 0) {
                speed = p.dashSpeed || 6.5;
                p.dashTimer--;
            } else {
                p.dashing = false;
            }
            if (p.dashCooldown > 0) p.dashCooldown--;
            if (input.dx !== 0 || input.dy !== 0) {
                moveEntity(p, input.dx * speed, input.dy * speed);
            }
            if (typeof input.facing === 'number') {
                p.facing = input.facing;
            }
            if (input.firing && !p.downed) {
                triggerRemotePeerAttack(p);
            }
            if (p.invincible > 0) p.invincible--;
            if (p.attackAnim > 0) p.attackAnim--;
        }
    }
}

function updateNetPing() {
    if (!coopWs || coopWs.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - netLastPingTime >= netPingInterval) {
        netLastPingTime = now;
        sendCoopMessage('PING', { t: Date.now(), from: localPlayerIndex });
    }
}

function updateNetBadgeUI() {
    const badge = hudEl('coopNetBadge');
    if (!badge) return;
    if (coopWs && coopRoomId && gameState === 'playing') {
        badge.style.display = 'block';
        if (isCoopHost) {
            const count = coopPeers ? coopPeers.length : 1;
            badge.textContent = 'HOST • ' + count + 'P';
            badge.style.color = '#00f0ff';
            badge.style.borderColor = 'rgba(0, 240, 255, 0.4)';
        } else {
            badge.textContent = 'NET: ' + netPing + 'ms';
            if (netPing < 80) {
                badge.style.color = '#10b981';
                badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            } else if (netPing < 160) {
                badge.style.color = '#f59e0b';
                badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
            } else {
                badge.style.color = '#ef4444';
                badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            }
        }
    } else {
        badge.style.display = 'none';
    }
}

function handleCoopMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'START_GAME') {
        if (msg.seed) netSessionSeed = msg.seed;
        else if (coopRoomId) netSessionSeed = hashSeedToUint32(coopRoomId.toUpperCase().trim());
        closeCoopLobbyModal();
        // proceedToWebGame(true) sudah menangani perpindahan view SEKALIGUS memanggil
        // startGame(true). Memanggil startGame() lagi akan memulai level dua kali
        // (dua kali initLevel → state bersama tertimpa).
        if (typeof proceedToWebGame === 'function') {
            proceedToWebGame(true);
        } else {
            startGame(true);
        }
    } else if (msg.type === 'SNAPSHOT' && !isCoopHost) {
        if (typeof applySnapshot === 'function') {
            applySnapshot(msg.snap || msg, false);
        }
    } else if (msg.type === 'INPUT' && isCoopHost) {
        if (typeof msg.peerIndex === 'number' && msg.peerIndex > 0) {
            peerInputs[msg.peerIndex] = {
                dx: msg.dx || 0,
                dy: msg.dy || 0,
                facing: msg.facing || 0,
                dashing: !!msg.dashing,
                firing: !!msg.firing,
                tick: msg.seq || msg.tick || 0,
                time: performance.now()
            };
            // Host seketika membuat entitas pemain tamu jika belum ada agar
            // dapat disimulasikan, dimasukkan ke snapshot, dan digambar di arena
            if (!players[msg.peerIndex]) {
                const hostP = players[0] || player || { x: CELL * 1.5, y: CELL * 1.5 };
                const peerInfo = coopPeers.find(p => p.idx === msg.peerIndex);
                const peerCallsign = (peerInfo && peerInfo.callsign) || ('P' + (msg.peerIndex + 1));
                players[msg.peerIndex] = spawnCoopPeerEntity(msg.peerIndex, peerCallsign, hostP.x + msg.peerIndex * 28, hostP.y);
            }
        }
    } else if (msg.type === 'PING') {
        sendCoopMessage('PONG', { t: msg.t, to: msg.from });
    } else if (msg.type === 'PONG') {
        if (typeof msg.t === 'number') {
            netPing = Math.max(1, Math.round(Date.now() - msg.t));
            updateNetBadgeUI();
        }
    } else if (msg.type === 'WELCOME') {
        // Relay otoritatif menetapkan indeks final (host = 0, tamu = 1..3) dan
        // mengirim daftar peer yang sudah ada. Ini menggantikan indeks sementara
        // yang dipatok klien sebelum handshake selesai.
        if (typeof msg.peerIndex === 'number' && msg.peerIndex >= 0) {
            localPlayerIndex = msg.peerIndex;
            isCoopHost = msg.peerIndex === 0 || !!msg.isHost;
        }
        if (Array.isArray(msg.peers)) {
            coopPeers = msg.peers
                .filter(p => p && typeof p.idx === 'number')
                .map(p => ({ idx: p.idx, callsign: p.callsign || ('P' + (p.idx + 1)), isHost: !!p.isHost }));
        }
        updateCoopSlotsUI();
    } else if (msg.type === 'PEER_JOIN') {
        if (!coopPeers.find(p => p.idx === msg.peerIndex)) {
            coopPeers.push({ idx: msg.peerIndex, callsign: msg.callsign || ('P' + (msg.peerIndex + 1)), isHost: false });
            updateCoopSlotsUI();
        }
        if (isCoopHost && gameState === 'playing' && !players[msg.peerIndex]) {
            const hostP = players[0] || player || { x: CELL * 1.5, y: CELL * 1.5 };
            players[msg.peerIndex] = spawnCoopPeerEntity(msg.peerIndex, msg.callsign, hostP.x + msg.peerIndex * 28, hostP.y);
        }
    } else if (msg.type === 'PEER_LEAVE') {
        if (typeof msg.peerIndex === 'number') {
            coopPeers = coopPeers.filter(p => p.idx !== msg.peerIndex);
            // Kosongkan slot pemain yang pergi; array tetap sparse agar indeks
            // peer lain tidak bergeser (semua konsumen punya guard !p).
            if (players && players[msg.peerIndex]) players[msg.peerIndex] = null;
            updateCoopSlotsUI();
        }
    } else if (msg.type === 'ERROR') {
        const errEl = document.getElementById('coopJoinError');
        if (errEl) {
            let key = 'coop_err_generic';
            if (msg.code === 'INVALID_ROOM' || msg.code === 'BAD_ROOM' || msg.code === 'BAD_REQUEST') key = 'coop_err_invalid_code';
            else if (msg.code === 'ROOM_FULL') key = 'coop_err_room_full';
            else if (msg.code === 'SERVER_FULL') key = 'coop_err_server_full';
            errEl.textContent = tt(key);
            errEl.style.display = 'block';
        }
        // Kembalikan ke panel gabung biar kode bisa diperbaiki lalu dicoba lagi.
        if (typeof switchCoopTab === 'function') switchCoopTab('join');
    }
}

function launchCoopMission() {
    if (!isCoopHost) return;
    // Broadcast START_GAME with session seed
    const sessionSeed = coopRoomId ? hashSeedToUint32(coopRoomId.toUpperCase().trim()) : Math.floor(Math.random() * 1000000);
    netSessionSeed = sessionSeed;
    sendCoopMessage('START_GAME', { seed: sessionSeed });
    closeCoopLobbyModal();
    // Satu jalur start saja: proceedToWebGame(true) memindahkan view dan
    // memanggil startGame(true) di dalamnya (hindari double initLevel).
    if (typeof proceedToWebGame === 'function') {
        proceedToWebGame(true);
    } else {
        startGame(true);
    }
}

// --- MOBILE ORIENTATION PROMPT (ROTATE TO LANDSCAPE FOR TOUCH CONTROLS) ---
let orientationPromptDismissed = false;

function isMobileOrTouchEnvironment() {
    const hasTouchClass = document.body && document.body.classList.contains('touch-on');
    const isTouchHardware = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const isMobileWidth = window.innerWidth <= 960 && window.innerHeight > window.innerWidth;
    return hasTouchClass || (isTouchHardware && isMobileWidth) || (typeof settings !== 'undefined' && settings && settings.deviceMode === 'mobile');
}

function checkDeviceOrientationPrompt(forceCheck = false) {
    const promptEl = document.getElementById('orientationPrompt');
    if (!promptEl) return;

    const isGameActive = document.body && document.body.classList.contains('game-on');
    const isPortrait = window.innerHeight > window.innerWidth;

    if (!isGameActive) {
        promptEl.style.display = 'none';
        return;
    }

    if (!isPortrait) {
        // Pemain sudah memutar HP ke landscape -> sembunyikan otomatis
        promptEl.style.display = 'none';
        return;
    }

    if (orientationPromptDismissed && !forceCheck) {
        return;
    }

    if (isMobileOrTouchEnvironment()) {
        promptEl.style.display = 'flex';
    } else {
        promptEl.style.display = 'none';
    }
}

function dismissOrientationPrompt() {
    orientationPromptDismissed = true;
    const promptEl = document.getElementById('orientationPrompt');
    if (promptEl) promptEl.style.display = 'none';
}

function lockLandscapeFullscreen() {
    const el = document.documentElement;
    const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;

    const tryLock = () => {
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
            screen.orientation.lock('landscape').catch(() => {});
        }
    };

    if (rfs) {
        try {
            const p = rfs.call(el);
            if (p && typeof p.then === 'function') {
                p.then(tryLock).catch(tryLock);
            } else {
                tryLock();
            }
        } catch (_) {
            tryLock();
        }
    } else {
        tryLock();
    }

    setTimeout(checkDeviceOrientationPrompt, 400);
}

// Pasang listener event rotasi / resize layar
window.addEventListener('resize', () => { checkDeviceOrientationPrompt(); });
window.addEventListener('orientationchange', () => { setTimeout(checkDeviceOrientationPrompt, 250); });
if (window.screen && window.screen.orientation && typeof window.screen.orientation.addEventListener === 'function') {
    window.screen.orientation.addEventListener('change', () => { setTimeout(checkDeviceOrientationPrompt, 250); });
}

window.checkDeviceOrientationPrompt = checkDeviceOrientationPrompt;
window.dismissOrientationPrompt = dismissOrientationPrompt;
window.lockLandscapeFullscreen = lockLandscapeFullscreen;

window.openCoopLobbyModal = openCoopLobbyModal;
window.closeCoopLobbyModal = closeCoopLobbyModal;
window.switchCoopTab = switchCoopTab;
window.copyCoopRoomCode = copyCoopRoomCode;
window.submitJoinCoopRoom = submitJoinCoopRoom;
window.launchCoopMission = launchCoopMission;

// 
const VITA_TALENTS_KEY = 'vita_talents';

const TALENT_NODES = [
    {
        id: 'core',
        branch: 'core',
        parent: null,
        x: 0.50, y: 0.54,
        maxRank: 1,
        nameKey: 'talent_core_name',
        descKey: 'talent_core_desc',
        cost: [0]
    },
    // Jalur Tempur (Combat / Offense - Kiri/Merah)
    {
        id: 'atk_boost',
        branch: 'combat',
        parent: 'core',
        x: 0.28, y: 0.44,
        maxRank: 3,
        nameKey: 'talent_atk_name',
        descKey: 'talent_atk_desc',
        cost: [25, 50, 100],
        descVals: ['+10% Serangan Dasar', '+20% Serangan Dasar', '+30% Serangan Dasar'],
        descValsId: ['+10% Serangan Dasar', '+20% Serangan Dasar', '+30% Serangan Dasar'],
        descValsEn: ['+10% Base Attack', '+20% Base Attack', '+30% Base Attack']
    },
    {
        id: 'crit_surge',
        branch: 'combat',
        parent: 'atk_boost',
        x: 0.16, y: 0.30,
        maxRank: 3,
        nameKey: 'talent_crit_name',
        descKey: 'talent_crit_desc',
        cost: [40, 80, 140],
        descVals: ['+10% Peluang Kritis & +30% Kerusakan Kritis', '+20% Peluang Kritis & +60% Kerusakan Kritis', '+30% Peluang Kritis & +90% Kerusakan Kritis'],
        descValsId: ['+10% Peluang Kritis & +30% Kerusakan Kritis', '+20% Peluang Kritis & +60% Kerusakan Kritis', '+30% Peluang Kritis & +90% Kerusakan Kritis'],
        descValsEn: ['+10% Crit Chance & +30% Crit DMG', '+20% Crit Chance & +60% Crit DMG', '+30% Crit Chance & +90% Crit DMG']
    },
    {
        id: 'plasma_arc',
        branch: 'combat',
        parent: 'crit_surge',
        x: 0.08, y: 0.15,
        maxRank: 1,
        isMajor: true,
        nameKey: 'talent_plasma_name',
        descKey: 'talent_plasma_desc',
        cost: [160],
        descVals: ['Busur Sabit Plasma setiap 3 tebasan'],
        descValsId: ['Busur Sabit Plasma setiap 3 tebasan'],
        descValsEn: ['Plasma Crescent Wave every 3 strikes']
    },
    // Jalur Ketahanan (Defense / Survival - Atas/Biru-Hijau)
    {
        id: 'hp_boost',
        branch: 'defense',
        parent: 'core',
        x: 0.50, y: 0.34,
        maxRank: 3,
        nameKey: 'talent_hp_name',
        descKey: 'talent_hp_desc',
        cost: [25, 50, 100],
        descVals: ['+30 HP Maksimal', '+65 HP Maksimal', '+100 HP Maksimal'],
        descValsId: ['+30 HP Maksimal', '+65 HP Maksimal', '+100 HP Maksimal'],
        descValsEn: ['+30 Max HP', '+65 Max HP', '+100 Max HP']
    },
    {
        id: 'nano_repair',
        branch: 'defense',
        parent: 'hp_boost',
        x: 0.50, y: 0.20,
        maxRank: 3,
        nameKey: 'talent_regen_name',
        descKey: 'talent_regen_desc',
        cost: [40, 80, 140],
        descVals: ['Regenerasi 1 HP / 2.5s saat HP < 40%', 'Regenerasi 2 HP / 2.5s saat HP < 40%', 'Regenerasi 3 HP / 2.5s saat HP < 40%'],
        descValsId: ['Regenerasi 1 HP / 2.5s saat HP < 40%', 'Regenerasi 2 HP / 2.5s saat HP < 40%', 'Regenerasi 3 HP / 2.5s saat HP < 40%'],
        descValsEn: ['Regen 1 HP / 2.5s when HP < 40%', 'Regen 2 HP / 2.5s when HP < 40%', 'Regen 3 HP / 2.5s when HP < 40%']
    },
    {
        id: 'aegis_shield',
        branch: 'defense',
        parent: 'nano_repair',
        x: 0.50, y: 0.07,
        maxRank: 1,
        isMajor: true,
        nameKey: 'talent_aegis_name',
        descKey: 'talent_aegis_desc',
        cost: [160],
        descVals: ['Perisai menyerap 1 serangan (jeda 25 detik)'],
        descValsId: ['Perisai menyerap 1 serangan (jeda 25 detik)'],
        descValsEn: ['Shield absorbs 1 incoming strike (25s cooldown)']
    },
    // Jalur Taktis (Tactical / Mobility - Kanan/Cyan-Gold)
    {
        id: 'speed_boost',
        branch: 'tactical',
        parent: 'core',
        x: 0.72, y: 0.44,
        maxRank: 3,
        nameKey: 'talent_speed_name',
        descKey: 'talent_speed_desc',
        cost: [25, 50, 100],
        descVals: ['+8% Kecepatan Gerak & Dash', '+16% Kecepatan Gerak & Dash', '+24% Kecepatan Gerak & Dash'],
        descValsId: ['+8% Kecepatan Gerak & Dash', '+16% Kecepatan Gerak & Dash', '+24% Kecepatan Gerak & Dash'],
        descValsEn: ['+8% Move & Dash Speed', '+16% Move & Dash Speed', '+24% Move & Dash Speed']
    },
    {
        id: 'flux_capacitor',
        branch: 'tactical',
        parent: 'speed_boost',
        x: 0.84, y: 0.30,
        maxRank: 3,
        nameKey: 'talent_flux_name',
        descKey: 'talent_flux_desc',
        cost: [40, 80, 140],
        descVals: ['+20% Jangkauan Senter, -15% Jeda Dash', '+40% Jangkauan Senter, -30% Jeda Dash', '+60% Jangkauan Senter, -45% Jeda Dash'],
        descValsId: ['+20% Jangkauan Senter, -15% Jeda Dash', '+40% Jangkauan Senter, -30% Jeda Dash', '+60% Jangkauan Senter, -45% Jeda Dash'],
        descValsEn: ['+20% Flashlight Range, -15% Dash Cooldown', '+40% Flashlight Range, -30% Dash Cooldown', '+60% Flashlight Range, -45% Dash Cooldown']
    },
    {
        id: 'phantom_dash',
        branch: 'tactical',
        parent: 'flux_capacitor',
        x: 0.92, y: 0.15,
        maxRank: 1,
        isMajor: true,
        nameKey: 'talent_phantom_name',
        descKey: 'talent_phantom_desc',
        cost: [160],
        descVals: ['Dash memicu medan kejut listrik statis'],
        descValsId: ['Dash memicu medan kejut listrik statis'],
        descValsEn: ['Dash leaves behind a static shock field']
    }
];

let selectedTalentNodeId = 'atk_boost';
let talentTreePulseTime = 0;
let talentTreeAnimReq = null;

function getTalentTreeData() {
    try {
        const raw = JSON.parse(localStorage.getItem(VITA_TALENTS_KEY) || '{}');
        const ranks = (raw && typeof raw.ranks === 'object' && raw.ranks !== null) ? raw.ranks : {};
        const safeRanks = { core: 1 };
        TALENT_NODES.forEach(n => {
            const r = Math.max(0, Math.min(n.maxRank, Number(ranks[n.id]) || 0));
            safeRanks[n.id] = (n.id === 'core') ? 1 : r;
        });
        const rawN = Number(raw.nanites);
        const nanites = Number.isFinite(rawN) ? Math.max(0, Math.floor(rawN)) : 50;
        return { nanites, ranks: safeRanks };
    } catch (_) {
        return {
            nanites: 50,
            ranks: { core: 1, atk_boost: 0, crit_surge: 0, plasma_arc: 0, hp_boost: 0, nano_repair: 0, aegis_shield: 0, speed_boost: 0, flux_capacitor: 0, phantom_dash: 0 }
        };
    }
}

function saveTalentTreeData(data) {
    try {
        localStorage.setItem(VITA_TALENTS_KEY, JSON.stringify(data));
    } catch (_) {}
}

function addNaniteShards(amount, x, y) {
    if (!amount || amount <= 0) return;
    const data = getTalentTreeData();
    data.nanites = (data.nanites || 0) + amount;
    saveTalentTreeData(data);
    if (typeof updateTalentUIHeader === 'function') updateTalentUIHeader();
    if (typeof x === 'number' && typeof y === 'number' && typeof floatingTexts !== 'undefined') {
        floatingTexts.push({
            x: x, y: y - 20,
            text: `+${amount} ${tt('talent_nanites_unit')}`,
            color: '#00f0ff',
            life: 45, maxLife: 45
        });
    }
}

function updateTalentUIHeader() {
    const el = document.getElementById('talentNaniteVal');
    if (el) {
        const d = getTalentTreeData();
        el.textContent = String(d.nanites);
    }
}

function isTalentNodeUnlocked(nodeId, ranks) {
    if (nodeId === 'core') return true;
    return (ranks[nodeId] || 0) > 0;
}

function isTalentNodeAvailable(node, ranks) {
    if (node.id === 'core') return true;
    if (!node.parent) return true;
    if (node.parent === 'core') return true;
    const parentNode = TALENT_NODES.find(n => n.id === node.parent);
    if (!parentNode) return true;
    return (ranks[parentNode.id] || 0) >= 1;
}

function selectTalentNode(nodeId) {
    const node = TALENT_NODES.find(n => n.id === nodeId);
    if (!node) return;
    selectedTalentNodeId = nodeId;
    updateTalentInspector();
    if (typeof homeBeep === 'function') homeBeep('click');
}

function updateTalentInspector() {
    const node = TALENT_NODES.find(n => n.id === selectedTalentNodeId) || TALENT_NODES[1];
    const data = getTalentTreeData();
    const curRank = data.ranks[node.id] || 0;
    const isAvail = isTalentNodeAvailable(node, data.ranks);
    const isMax = curRank >= node.maxRank;

    // Branch Badge
    const badgeEl = document.getElementById('talentNodeBranchBadge');
    if (badgeEl) {
        const branchKey = `talent_branch_${node.branch}`;
        badgeEl.textContent = tt(branchKey);
        if (node.branch === 'combat') {
            badgeEl.style.background = 'rgba(255, 59, 59, 0.2)';
            badgeEl.style.color = '#ff5555';
            badgeEl.style.borderColor = 'rgba(255, 59, 59, 0.5)';
        } else if (node.branch === 'defense') {
            badgeEl.style.background = 'rgba(46, 204, 113, 0.2)';
            badgeEl.style.color = '#2ecc71';
            badgeEl.style.borderColor = 'rgba(46, 204, 113, 0.5)';
        } else if (node.branch === 'tactical') {
            badgeEl.style.background = 'rgba(0, 229, 255, 0.2)';
            badgeEl.style.color = '#00e5ff';
            badgeEl.style.borderColor = 'rgba(0, 229, 255, 0.5)';
        } else {
            badgeEl.style.background = 'rgba(255, 215, 0, 0.2)';
            badgeEl.style.color = '#ffd700';
            badgeEl.style.borderColor = 'rgba(255, 215, 0, 0.5)';
        }
    }

    // Title & Rank
    const titleEl = document.getElementById('talentNodeTitle');
    if (titleEl) titleEl.textContent = tt(node.nameKey);

    const rankEl = document.getElementById('talentNodeRank');
    if (rankEl) {
        if (node.id === 'core') {
            rankEl.textContent = `${tt('talent_rank_lbl')} 1 / 1 (ONLINE)`;
        } else if (isMax) {
            rankEl.textContent = `${tt('talent_rank_lbl')} ${curRank}/${node.maxRank} [${tt('talent_maxed_lbl')}]`;
            rankEl.style.color = '#ffd700';
        } else if (!isAvail) {
            rankEl.textContent = `${tt('talent_rank_lbl')} ${curRank}/${node.maxRank} [${tt('talent_locked_lbl')}]`;
            rankEl.style.color = '#8892b0';
        } else {
            rankEl.textContent = `${tt('talent_rank_lbl')} ${curRank} / ${node.maxRank}`;
            rankEl.style.color = '#00f0ff';
        }
    }

    // Current Effect Desc
    const curDescEl = document.getElementById('talentNodeCurrentDesc');
    const curVals = (lang === 'en' ? node.descValsEn : node.descValsId) || node.descVals;
    if (curDescEl) {
        if (node.id === 'core') {
            curDescEl.textContent = tt(node.descKey);
        } else if (curRank === 0) {
            curDescEl.textContent = '-';
        } else if (curVals && curVals[curRank - 1]) {
            curDescEl.textContent = `${curVals[curRank - 1]} — ${tt(node.descKey)}`;
        } else {
            curDescEl.textContent = tt(node.descKey);
        }
    }

    // Next Effect Box
    const nextBox = document.getElementById('talentNodeNextBox');
    const nextDescEl = document.getElementById('talentNodeNextDesc');
    if (nextBox && nextDescEl) {
        if (isMax || node.id === 'core') {
            nextBox.style.display = 'none';
        } else {
            nextBox.style.display = 'block';
            const nextVal = (curVals && curVals[curRank]) ? curVals[curRank] : tt(node.descKey);
            nextDescEl.textContent = `${nextVal} — ${tt(node.descKey)}`;
        }
    }

    // Requirements Box
    const reqBox = document.getElementById('talentNodeReqBox');
    const reqText = document.getElementById('talentNodeReqText');
    if (reqBox && reqText) {
        if (!isAvail && node.parent && node.parent !== 'core') {
            reqBox.style.display = 'block';
            const pNode = TALENT_NODES.find(n => n.id === node.parent);
            reqText.textContent = `${tt(pNode?.nameKey || node.parent)} >= 1`;
        } else {
            reqBox.style.display = 'none';
        }
    }

    // Cost & Upgrade Button
    const costEl = document.getElementById('talentNodeCost');
    const btnUpgrade = document.getElementById('btnTalentUpgrade');
    const btnUpgradeText = document.getElementById('btnTalentUpgradeText');

    if (node.id === 'core' || isMax) {
        if (costEl) costEl.textContent = isMax ? tt('talent_maxed_lbl') : '-';
        if (btnUpgrade) {
            btnUpgrade.disabled = true;
            btnUpgrade.style.opacity = '0.5';
            btnUpgrade.style.cursor = 'not-allowed';
        }
        if (btnUpgradeText) btnUpgradeText.textContent = tt('talent_maxed_lbl');
    } else {
        const cost = node.cost[curRank] || node.cost[0] || 50;
        if (costEl) costEl.textContent = `${cost} ${tt('talent_nanites_unit')}`;
        const canAfford = data.nanites >= cost;
        const canUpgrade = isAvail && canAfford;

        if (btnUpgrade) {
            btnUpgrade.disabled = !canUpgrade;
            btnUpgrade.style.opacity = canUpgrade ? '1' : '0.5';
            btnUpgrade.style.cursor = canUpgrade ? 'pointer' : 'not-allowed';
        }
        if (btnUpgradeText) {
            if (!isAvail) btnUpgradeText.textContent = tt('talent_locked_lbl');
            else if (!canAfford) btnUpgradeText.textContent = `${tt('talent_upgrade_btn')} (${cost})`;
            else btnUpgradeText.textContent = tt('talent_upgrade_btn');
        }
    }
}

function upgradeSelectedTalent() {
    const node = TALENT_NODES.find(n => n.id === selectedTalentNodeId);
    if (!node || node.id === 'core') return;
    const data = getTalentTreeData();
    const curRank = data.ranks[node.id] || 0;
    if (curRank >= node.maxRank) return;
    if (!isTalentNodeAvailable(node, data.ranks)) return;

    const cost = node.cost[curRank] || node.cost[0] || 50;
    if (data.nanites < cost) {
        if (typeof sLocked === 'function') sLocked();
        return;
    }

    data.nanites -= cost;
    data.ranks[node.id] = curRank + 1;
    saveTalentTreeData(data);

    if (typeof sWin === 'function') sWin();
    else if (typeof homeBeep === 'function') homeBeep('open');

    updateTalentUIHeader();
    updateTalentInspector();

    // Spawn canvas ripple particles
    const cvs = document.getElementById('talentTreeCanvas');
    if (cvs) {
        const ctx = cvs.getContext('2d');
        if (ctx) {
            ctx.save();
            ctx.fillStyle = '#00f0ff';
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(node.x * cvs.width, node.y * cvs.height, 35, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }
}

function resetAllTalents() {
    if (!confirm(tt('talent_reset_confirm'))) return;
    const data = getTalentTreeData();
    let refund = 0;
    TALENT_NODES.forEach(n => {
        if (n.id === 'core') return;
        const r = data.ranks[n.id] || 0;
        for (let i = 0; i < r; i++) {
            refund += n.cost[i] || 0;
        }
        data.ranks[n.id] = 0;
    });
    data.nanites = (data.nanites || 0) + refund;
    saveTalentTreeData(data);

    if (typeof homeBeep === 'function') homeBeep('close');
    updateTalentUIHeader();
    updateTalentInspector();
}

function renderTalentTree() {
    const canvas = document.getElementById('talentTreeCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    talentTreePulseTime += 0.04;
    const pulse = 0.5 + 0.5 * Math.sin(talentTreePulseTime);

    const data = getTalentTreeData();
    const ranks = data.ranks;

    // 1) Background Sci-Fi Tech Grid & Concentric Rings
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 32;
    for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const coreX = w * 0.50, coreY = h * 0.54;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    [70, 140, 210, 280].forEach(r => {
        ctx.beginPath();
        ctx.arc(coreX, coreY, r, 0, Math.PI * 2);
        ctx.stroke();
    });
    ctx.restore();

    // 2) Conduits / Connecting Cables between nodes
    TALENT_NODES.forEach(n => {
        if (!n.parent) return;
        const pNode = TALENT_NODES.find(p => p.id === n.parent);
        if (!pNode) return;

        const x1 = pNode.x * w, y1 = pNode.y * h;
        const x2 = n.x * w, y2 = n.y * h;
        const isUnlocked = (ranks[n.id] || 0) > 0;
        const isAvail = isTalentNodeAvailable(n, ranks);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (isUnlocked) {
            ctx.strokeStyle = (n.branch === 'combat') ? '#ff4d4d' : ((n.branch === 'defense') ? '#2ecc71' : '#00e5ff');
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 8;
            ctx.lineWidth = 2.8;
        } else if (isAvail) {
            ctx.strokeStyle = `rgba(0, 229, 255, ${0.3 + 0.3 * pulse})`;
            ctx.lineWidth = 1.8;
            ctx.setLineDash([4, 4]);
        } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1.2;
        }
        ctx.stroke();
        ctx.restore();
    });

    // 3) Draw Nodes
    TALENT_NODES.forEach(n => {
        const nx = n.x * w, ny = n.y * h;
        const curRank = ranks[n.id] || 0;
        const isUnlocked = curRank > 0;
        const isAvail = isTalentNodeAvailable(n, ranks);
        const isSelected = n.id === selectedTalentNodeId;
        const radius = (n.id === 'core') ? 22 : (n.isMajor ? 18 : 14);

        ctx.save();
        ctx.translate(nx, ny);

        // Selection HUD Bracket
        if (isSelected) {
            ctx.strokeStyle = '#ffd700';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 12;
            ctx.lineWidth = 2;
            const bR = radius + 7 + 2 * pulse;
            ctx.beginPath();
            ctx.arc(0, 0, bR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Outer Node Circle
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);

        if (n.id === 'core') {
            ctx.fillStyle = '#0a192f';
            ctx.fill();
            ctx.strokeStyle = '#00f0ff';
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 14;
            ctx.lineWidth = 3;
            ctx.stroke();

            // Core Symbol
            ctx.fillStyle = '#00f0ff';
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0, Math.PI * 2);
            ctx.fill();
        } else {
            let nodeColor = (n.branch === 'combat') ? '#ff4d4d' : ((n.branch === 'defense') ? '#2ecc71' : '#00e5ff');
            if (isUnlocked) {
                ctx.fillStyle = '#0a101d';
                ctx.fill();
                ctx.strokeStyle = (curRank >= n.maxRank) ? '#ffd700' : nodeColor;
                ctx.shadowColor = ctx.strokeStyle;
                ctx.shadowBlur = 12;
                ctx.lineWidth = (curRank >= n.maxRank) ? 3 : 2.2;
                ctx.stroke();

                // Inner Dot / Diamond
                ctx.fillStyle = ctx.strokeStyle;
                ctx.beginPath();
                ctx.arc(0, 0, n.isMajor ? 6.5 : 4.5, 0, Math.PI * 2);
                ctx.fill();
            } else if (isAvail) {
                ctx.fillStyle = 'rgba(10, 16, 29, 0.8)';
                ctx.fill();
                ctx.strokeStyle = `rgba(0, 229, 255, ${0.4 + 0.5 * pulse})`;
                ctx.shadowColor = '#00e5ff';
                ctx.shadowBlur = 8 * pulse;
                ctx.lineWidth = 1.8;
                ctx.stroke();
            } else {
                ctx.fillStyle = 'rgba(8, 10, 16, 0.9)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Rank Badge under node
        if (n.id !== 'core') {
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (curRank >= n.maxRank) {
                ctx.fillStyle = '#ffd700';
                ctx.fillText('MAX', 0, radius + 11);
            } else if (curRank > 0) {
                ctx.fillStyle = '#00f0ff';
                ctx.fillText(`${curRank}/${n.maxRank}`, 0, radius + 11);
            } else if (isAvail) {
                ctx.fillStyle = '#a0e0ff';
                ctx.fillText(`${curRank}/${n.maxRank}`, 0, radius + 11);
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.fillText('🔒', 0, radius + 11);
            }
        }

        ctx.restore();
    });
}

function handleTalentCanvasClick(e) {
    const canvas = document.getElementById('talentTreeCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    for (let i = 0; i < TALENT_NODES.length; i++) {
        const n = TALENT_NODES[i];
        const nx = n.x * canvas.width;
        const ny = n.y * canvas.height;
        const hitR = (n.id === 'core' ? 25 : 20);
        if (Math.hypot(clickX - nx, clickY - ny) <= hitR) {
            selectTalentNode(n.id);
            break;
        }
    }
}

function openTalentTreeModal() {
    const modal = document.getElementById('talentTreeModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('open');
    updateTalentUIHeader();
    updateTalentInspector();

    const canvas = document.getElementById('talentTreeCanvas');
    if (canvas && !canvas._talentWired) {
        canvas._talentWired = true;
        canvas.addEventListener('click', handleTalentCanvasClick);
    }

    if (talentTreeAnimReq) cancelAnimationFrame(talentTreeAnimReq);
    function loop() {
        if (modal.classList.contains('open') && modal.style.display !== 'none') {
            renderTalentTree();
            talentTreeAnimReq = requestAnimationFrame(loop);
        }
    }
    talentTreeAnimReq = requestAnimationFrame(loop);
    if (typeof homeBeep === 'function') homeBeep('open');
}

function closeTalentTreeModal() {
    const modal = document.getElementById('talentTreeModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
    if (talentTreeAnimReq) cancelAnimationFrame(talentTreeAnimReq);
    if (typeof homeBeep === 'function') homeBeep('close');
}

function openTalentTreeFromGame() {
    openTalentTreeModal();
}

// 
let bestiarySelectedIdx = 0;
let bestiaryAnimReq = null;

const BESTIARY_SPECIMENS = [
    {
        name: 'Slime', threat: 'CLASS-I', code: 'SPECIMEN #01', killKey: 'Slime',
        weakness: 'Rentan terhadap tebasan pisau cepat & api spora.',
        weaknessEn: 'Vulnerable to rapid tactical blade slashes and spore fire.',
        bio: 'Amoeboid gelatin sel tunggal yang mencerna materi organik di lantai fasilitas.',
        bioEn: 'Single-celled amoeboid gelatin that digests organic matter across facility floors.'
    },
    {
        name: 'Bat', threat: 'CLASS-II', code: 'SPECIMEN #02', killKey: 'Bat',
        weakness: 'Sonar rapuh terhadap semburan shotgun & EMP.',
        weaknessEn: 'Fragile echolocation sonar disrupted by shotgun spreads and EMP pulses.',
        bio: 'Mamalia terbang yang bermutasi di terowongan gelap, bergerak cepat dan membidik mangsa dari atas.',
        bioEn: 'Winged mammal mutated within ventilation shafts, striking rapidly from above.'
    },
    {
        name: 'Crawl', threat: 'CLASS-II', code: 'SPECIMEN #03', killKey: 'Crawl',
        weakness: 'Jarak serang pendek; mudah diatasi dari jarak jauh.',
        weaknessEn: 'Short attack reach; easily eliminated at ranged distances.',
        bio: 'Spesimen berkaki banyak yang merayap di dinding dengan capit kitin tajam.',
        bioEn: 'Multi-legged specimen scuttling across corridor walls with razor-sharp chitin pincers.'
    },
    {
        name: 'Ghost', threat: 'CLASS-III', code: 'SPECIMEN #04', killKey: 'Ghost',
        weakness: 'Fokus energi cahaya senter memecah kamuflase fasanya.',
        weaknessEn: 'Focused flashlight beam disrupts its phase camouflage.',
        bio: 'Anomali semi-eter yang mampu menembus rintangan dan menyerap energi biologis manusia.',
        bioEn: 'Semi-ethereal anomaly capable of phasing through obstacles to drain operative biological energy.'
    },
    {
        name: 'Harvester', threat: 'CLASS-IV', code: 'SPECIMEN #05', killKey: 'Harvester',
        weakness: 'Titik saraf di pangkal sungut rentan ledakan granat.',
        weaknessEn: 'Neural ganglion at tentacle base vulnerable to explosive ordnance.',
        bio: 'Organisme pemanen biomassa berakar kuat yang menarik operatif ke dalam kantung pencernaannya.',
        bioEn: 'Deeply rooted biomass-harvesting organism dragging operatives into its digestive sack.'
    },
    {
        name: 'Dark Knight', threat: 'CLASS-IV', code: 'SPECIMEN #06', killKey: 'Dark Knight',
        weakness: 'Serangan penetrasi Railgun menembus armor zirah tebalnya.',
        weaknessEn: 'High-penetration Railgun rounds pierce its heavy reinforced carapace.',
        bio: 'Pelindung fasilitas yang terinfeksi dan termutasi menjadi automata pembunuh berperisai.',
        bioEn: 'Infected facility guardian automaton mutated into a heavily shielded killer.'
    },
    {
        name: 'Dragon', threat: 'CLASS-V', code: 'SPECIMEN #07', killKey: 'Dragon',
        weakness: 'Pendinginan Cryo melumpuhkan kelenjar pembakar di tenggorokannya.',
        weaknessEn: 'Cryo cooling ruptures the thermal combustion glands inside its gullet.',
        bio: 'Reptil karnivora bersayap yang menyemburkan plasma organik panas.',
        bioEn: 'Winged carnivorous bio-reptile expelling superheated organic plasma.'
    },
    {
        name: 'Lich', threat: 'CLASS-V', code: 'SPECIMEN #08', killKey: 'Lich',
        weakness: 'Hancurkan proyektil jiwanya sebelum mencapai sasaran.',
        weaknessEn: 'Intercept and destroy soul projectiles before impact.',
        bio: 'Anomali purba yang memancarkan aura nekrotik dan melepaskan proyektil pencari.',
        bioEn: 'Ancient anomaly radiating necrotic auras while launching homing occult soul orbs.'
    },
    {
        name: 'Beholder', threat: 'CLASS-V', code: 'SPECIMEN #09', killKey: 'Beholder',
        weakness: 'Kebutaan sesaat saat terkena kilatan granat EMP.',
        weaknessEn: 'Temporarily blinded by EMP concussion flares.',
        bio: 'Mata melayang raksasa yang memancarkan sinar desintegrasi jarak jauh.',
        bioEn: 'Gigantic floating ocular horror firing long-range molecular disintegration beams.'
    },
    {
        name: 'Mimic', threat: 'CLASS-VI', code: 'SPECIMEN #10', killKey: 'Mimic',
        weakness: 'Kelemahan terhadap serangan kejutan saat fase kamuflasenya terbuka.',
        weaknessEn: 'Vulnerable to sudden counter-attacks once camouflage opens.',
        bio: 'Predator metamorfis yang meniru peti pasokan fasilitas untuk menjebak penyelidik.',
        bioEn: 'Metamorphic ambush predator disguising itself as facility supply crates to ensnare scouts.'
    },
    {
        name: 'Final Boss', threat: 'APEX-VII', code: 'SPECIMEN #11', killKey: 'Final Boss',
        weakness: 'Dodge serangannya lalu serang inti saat fase jeda.',
        weaknessEn: 'Evade heavy swings and unleash focused firepower on core during recovery phase.',
        bio: 'Titan hibrida eksperimen bio-senjata prototipe puncak fasilitas.',
        bioEn: 'Apex prototype hybrid bio-weapon titan and culmination of facility genetic experiments.'
    },
    {
        name: 'The Monolith', threat: 'APEX PREDATOR', code: 'SPECIMEN #12', killKey: 'The Monolith',
        weakness: 'Konsentrasikan seluruh persenjataan berat pada cincin mahkota.',
        weaknessEn: 'Concentrate all heavy anti-matter armaments onto the pulsating crown ring.',
        bio: 'Entitas anomali kosmik primordial yang menjadi pusat kegelapan Sektor Terlupakan.',
        bioEn: 'Primordial cosmic anomaly entity anchoring the necrotic darkness of Forgotten Sector.'
    }
];

function selectBestiarySpecimen(idx) {
    bestiarySelectedIdx = Math.max(0, Math.min(BESTIARY_SPECIMENS.length - 1, idx));
    const s = BESTIARY_SPECIMENS[bestiarySelectedIdx];
    const isEn = (typeof lang !== 'undefined' ? lang : (typeof homeSettings !== 'undefined' ? homeSettings.lang : 'id')) === 'en';
    const nameEl = document.getElementById('bestiaryMonsterName');
    if (nameEl) nameEl.textContent = s.name;
    const codeEl = document.getElementById('bestiaryMonsterCode');
    if (codeEl) codeEl.textContent = s.code;
    const badgeEl = document.getElementById('bestiaryThreatBadge');
    if (badgeEl) badgeEl.textContent = s.threat;
    const weakEl = document.getElementById('bestiaryWeaknessText');
    if (weakEl) weakEl.textContent = (isEn && s.weaknessEn) ? s.weaknessEn : s.weakness;
    const bioEl = document.getElementById('bestiaryBioText');
    if (bioEl) bioEl.textContent = (isEn && s.bioEn) ? s.bioEn : s.bio;

    const killsEl = document.getElementById('bestiaryStatKills');
    if (killsEl) {
        const h = loadHigh();
        const kills = (h && h.bestiaryKills && h.bestiaryKills[s.name]) ? h.bestiaryKills[s.name] : (s.name === 'Slime' ? 12 : 3);
        killsEl.textContent = String(kills);
    }
    const deathsEl = document.getElementById('bestiaryStatDeaths');
    if (deathsEl) deathsEl.textContent = '1';

    // Highlight roster button
    const roster = document.getElementById('bestiaryRoster');
    if (roster) {
        const btns = roster.querySelectorAll('button');
        btns.forEach((b, i) => {
            if (i === bestiarySelectedIdx) {
                b.style.background = 'rgba(255, 59, 59, 0.25)';
                b.style.borderColor = '#ff3b3b';
                b.style.color = '#ffffff';
            } else {
                b.style.background = 'rgba(255, 255, 255, 0.03)';
                b.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                b.style.color = 'var(--text-dim, #a0a0b0)';
            }
        });
    }

    renderBestiaryPreviewCanvas(s.name);
}

function renderBestiaryPreviewCanvas(monsterName) {
    const cvs = document.getElementById('bestiaryPreviewCanvas');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const cx = cvs.width / 2, cy = cvs.height / 2;
    const m = MONSTER_TYPES.find(mt => mt.name === monsterName) || MONSTER_TYPES[0];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = m.color || '#ff3b3b';
    ctx.shadowColor = m.color || '#ff3b3b';
    ctx.shadowBlur = 12;

    const r = Math.min(38, m.size * 1.8);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.2, r * 0.2, 0, Math.PI * 2);
    ctx.arc(r * 0.35, -r * 0.2, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.2, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.35, -r * 0.2, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function renderBestiaryModal() {
    const roster = document.getElementById('bestiaryRoster');
    if (!roster) return;
    roster.innerHTML = '';
    BESTIARY_SPECIMENS.forEach((s, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'padding:8px 10px;text-align:left;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:all 0.15s ease;';
        btn.innerHTML = `<span style="font-weight:bold;font-size:12px;">${s.name}</span><span style="font-size:9px;font-family:monospace;color:#ff3b3b;">${s.threat}</span>`;
        btn.onclick = () => selectBestiarySpecimen(idx);
        roster.appendChild(btn);
    });
    selectBestiarySpecimen(0);
}

function openBestiaryModal() {
    const m = document.getElementById('bestiaryModal');
    if (!m) return;
    renderBestiaryModal();
    m.style.display = 'flex';
    m.classList.add('open');
    if (typeof homeBeep === 'function') homeBeep('open');
}

function closeBestiaryModal() {
    const m = document.getElementById('bestiaryModal');
    if (!m) return;
    m.classList.remove('open');
    m.style.display = 'none';
    if (typeof homeBeep === 'function') homeBeep('close');
}

function openBestiaryFromGame() {
    openBestiaryModal();
}

function upgradeWorkbenchWeapon(weaponId) {
    if (!player) return;
    if (!player.weapons) player.weapons = ['knife'];
    if (!player.weapons.includes(weaponId)) {
        player.weapons.push(weaponId);
    }
    player.currentWeapon = weaponId;
    sWeaponUnlock();
    const wName = tt(WEAPONS[weaponId]?.nameKey || weaponId);
    floatingTexts.push({
        x: player.x,
        y: player.y - 25,
        text: tt('armory_claim').replace('{w}', wName),
        color: '#00f0ff',
        life: 90,
        maxLife: 90
    });
    updateUI();
    renderWorkbenchModal();
}
window.upgradeWorkbenchWeapon = upgradeWorkbenchWeapon;

function renderWorkbenchModal() {
    const grid = document.getElementById('workbenchGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const isEn = (typeof lang !== 'undefined' ? lang : (typeof homeSettings !== 'undefined' ? homeSettings.lang : 'id')) === 'en';
    const keys = Object.keys(WEAPONS);
    keys.forEach(k => {
        const w = WEAPONS[k];
        const card = document.createElement('div');
        card.style.cssText = 'background:rgba(15,20,35,0.9);border:1px solid rgba(0,229,255,0.25);border-radius:8px;padding:12px;display:flex;flex-direction:column;justify-content:space-between;gap:8px;';
        card.innerHTML = `
            <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="font-size:10px;font-family:monospace;color:#00f0ff;">${w.code}</span>
                    <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(0,229,255,0.15);color:#00e5ff;">TIER II</span>
                </div>
                <h4 style="margin:0 0 6px 0;font-size:14px;color:#fff;">${tt(w.nameKey)}</h4>
                <div style="font-size:11px;color:var(--text-dim,#a0a0b0);margin-bottom:6px;">${tt(w.descKey)}</div>
                <div style="font-size:10px;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;border:1px solid rgba(255,255,255,0.06);color:#ffd700;">
                    <b>MOD:</b> ${(isEn ? w.specsEn?.special : w.specs?.special) || 'Overclocked Firepower'}
                </div>
            </div>
            <button class="btn" type="button" onclick="upgradeWorkbenchWeapon('${w.id}')" style="padding:6px 12px;font-size:11px;width:100%;background:rgba(0,229,255,0.15);border-color:#00e5ff;color:#00f0ff;">
                <span>${tt('workbench_upgrade_btn')}</span>
            </button>
        `;
        grid.appendChild(card);
    });
}

function openWorkbenchModal() {
    const m = document.getElementById('workbenchModal');
    if (!m) return;
    renderWorkbenchModal();
    m.style.display = 'flex';
    m.classList.add('open');
    if (typeof homeBeep === 'function') homeBeep('open');
}

function closeWorkbenchModal() {
    const m = document.getElementById('workbenchModal');
    if (!m) return;
    m.classList.remove('open');
    m.style.display = 'none';
    if (typeof homeBeep === 'function') homeBeep('close');
}

function openWorkbenchFromGame() {
    openWorkbenchModal();
}

window.openTalentTreeModal = openTalentTreeModal;
window.closeTalentTreeModal = closeTalentTreeModal;
window.openTalentTreeFromGame = openTalentTreeFromGame;
window.upgradeSelectedTalent = upgradeSelectedTalent;
window.resetAllTalents = resetAllTalents;
window.getTalentTreeData = getTalentTreeData;
window.saveTalentTreeData = saveTalentTreeData;
window.addNaniteShards = addNaniteShards;

window.openBestiaryModal = openBestiaryModal;
window.closeBestiaryModal = closeBestiaryModal;
window.openBestiaryFromGame = openBestiaryFromGame;

window.openWorkbenchModal = openWorkbenchModal;
window.closeWorkbenchModal = closeWorkbenchModal;
window.openWorkbenchFromGame = openWorkbenchFromGame;

// Mode Endless Survival

function startEndlessMode() {
    ensureAudio();
    const doStartEndless = () => {
        isEndlessMode = true;
        endlessWave = 1;
        endlessKills = 0;
        endlessWaveCleared = false;
        endlessWaveClearTimer = 0;
        
        // Sembunyikan semua overlay menu
        const ss = document.getElementById('startScreen'); if (ss) ss.style.display = 'none';
        const ds = document.getElementById('deathScreen'); if (ds) ds.style.display = 'none';
        const ws = document.getElementById('winScreen'); if (ws) ws.style.display = 'none';
        const ps = document.getElementById('pauseScreen'); if (ps) ps.classList.remove('open');
        const pro = document.getElementById('prologueScreen'); if (pro) pro.style.display = 'none';

        gameState = 'playing';
        menuDemo = false;
        totalKills = 0;
        totalTime = 0;
        showHUD();
        hideCursor();

        // Inisialisasi arena luas (menggunakan template labirin Sektor 8 ber-seed acak)
        currentLevel = 7;
        initLevel(7);
        artifacts = [];
        coinsCollected = 0;
        generators = [];
        traps = [];
        terminalPuzzleActive = false;
        terminalCurrentNode = null;
        level15Corpse = null;
        exitTile = null;

        // Kustomisasi objektif dan HUD arena survival
        setHudText(hudEl('lblLevel'), lang === 'en' ? 'Wave:' : 'Gelombang:');
        setHudText(hudEl('levelText'), '1');
        setHudText(hudEl('levelMaxText'), ' (∞)');
        setHudText(hudEl('modeText'), 'HORDE');
        const badge = hudEl('uiBadge') || document.getElementById('uiBadge');
        if (badge) setHudText(badge, (lang === 'en' ? 'SURVIVAL ARENA — WAVE 1' : 'ARENA SURVIVAL — GELOMBANG 1'));
        const exitText = hudEl('exitText') || document.getElementById('exitText');
        if (exitText) setHudText(exitText, tt('endless_objective'));
        const artText = hudEl('artifactText') || document.getElementById('artifactText');
        if (artText) setHudText(artText, '—');
        
        // Spawn gelombang monster pertama
        spawnEndlessWave(1);

        if (typeof announceLevel === 'function') {
            announceLevel(tt('endless_wave_banner').replace('{w}', '1'));
        }
    };

    if (typeof triggerFacilityLoading === 'function') {
        triggerFacilityLoading({
            title: 'PROTOKOL SURVIVAL TAK HINGGA — GELOMBANG 1',
            duration: 1250,
            instant: true,
            onPrepare: doStartEndless
        });
    } else {
        doStartEndless();
    }
}

function spawnEndlessWave(wave) {
    if (!monsters) monsters = [];
    monsters = [];
    const count = Math.min(35, 6 + wave * 3);
    
    // Pilih anomali dari 12 kanon berdasarkan gelombang
    const roster = ['slime', 'bat'];
    if (wave >= 2) roster.push('crawl');
    if (wave >= 3) roster.push('ghost');
    if (wave >= 4) roster.push('harvester');
    if (wave >= 5) roster.push('darkKnight');
    if (wave >= 6) roster.push('dragon');
    if (wave >= 7) roster.push('lich');
    if (wave >= 8) roster.push('beholder');
    if (wave >= 9) roster.push('mimic');
    if (wave >= 10 && wave % 5 === 0) roster.push('theMonolith');

    for (let i = 0; i < count; i++) {
        let spawned = false;
        for (let tries = 0; tries < 50; tries++) {
            const rx = Math.floor(Math.random() * (maze[0].length - 4)) + 2;
            const ry = Math.floor(Math.random() * (maze.length - 4)) + 2;
            if (maze[ry] && maze[ry][rx] === 0) {
                const distToP = Math.hypot((rx * CELL + CELL/2) - player.x, (ry * CELL + CELL/2) - player.y);
                if (distToP > 5 * CELL) {
                    const typeKey = roster[Math.floor(Math.random() * roster.length)];
                    const m = createMonster(typeKey, rx * CELL + CELL/2, ry * CELL + CELL/2);
                    if (m) {
                        m.maxHp = Math.round(m.maxHp * (1 + (wave - 1) * 0.15));
                        m.hp = m.maxHp;
                        monsters.push(m);
                        spawned = true;
                        break;
                    }
                }
            }
        }
    }

    setHudText(hudEl('lblLevel'), lang === 'en' ? 'Wave:' : 'Gelombang:');
    setHudText(hudEl('levelText'), wave);
    setHudText(hudEl('levelMaxText'), ' (∞)');
    const badge = hudEl('uiBadge') || document.getElementById('uiBadge');
    if (badge) setHudText(badge, (lang === 'en' ? 'SURVIVAL ARENA — WAVE ' : 'ARENA SURVIVAL — GELOMBANG ') + wave);
    const exitText = hudEl('exitText') || document.getElementById('exitText');
    if (exitText) setHudText(exitText, tt('endless_objective'));
}

function checkEndlessWaveProgress() {
    if (!isEndlessMode || gameState !== 'playing') return;
    
    let aliveCount = 0;
    for (let i = 0; i < monsters.length; i++) {
        if (monsters[i] && monsters[i].hp > 0) aliveCount++;
    }
    if (aliveCount === 0 && !endlessWaveCleared) {
        endlessWaveCleared = true;
        endlessWaveClearTimer = Date.now();
        
        // Reward: Pulihkan HP pemain + drop medpod + ammo recharge
        if (player) {
            player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * 0.4));
        }
        
        // Beri nanite untuk pohon talenta
        if (typeof addNaniteShards === 'function') {
            addNaniteShards(50 + endlessWave * 10);
        } else if (typeof addNanites === 'function') {
            addNanites(50 + endlessWave * 10);
        }

        // Drop amunisi / medpod di ubin lantai valid dekat posisi pemain
        if (typeof medPods !== 'undefined' && Array.isArray(medPods) && player && typeof maze !== 'undefined' && maze.length) {
            let gx = Math.max(1, Math.min(maze[0].length - 2, Math.floor(player.x / CELL)));
            let gy = Math.max(1, Math.min(maze.length - 2, Math.floor(player.y / CELL)));
            if (maze[gy] && maze[gy][gx] !== 0) {
                for (let r = 1; r <= 3; r++) {
                    let found = false;
                    for (let dy = -r; dy <= r && !found; dy++) {
                        for (let dx = -r; dx <= r && !found; dx++) {
                            const tx = gx + dx, ty = gy + dy;
                            if (maze[ty] && maze[ty][tx] === 0) {
                                gx = tx; gy = ty; found = true;
                            }
                        }
                    }
                    if (found) break;
                }
            }
            medPods.push({
                x: gx * CELL + CELL / 2,
                y: gy * CELL + CELL / 2,
                gx: gx,
                gy: gy,
                used: false,
                pulse: 0
            });
        }

        const clearMsg = tt('endless_wave_clear').replace('{w}', endlessWave);
        if (typeof announceLevel === 'function') announceLevel(clearMsg + ' — ' + tt('endless_evac_open'));
        if (typeof blip === 'function') blip(580, 0.25, 'triangle');
        const exitText = hudEl('exitText') || document.getElementById('exitText');
        if (exitText) setHudText(exitText, tt('endless_evac_open'));
    }

    if (endlessWaveCleared && Date.now() - endlessWaveClearTimer >= 3200) {
        endlessWave++;
        endlessWaveCleared = false;
        spawnEndlessWave(endlessWave);
        const inMsg = tt('endless_wave_banner').replace('{w}', endlessWave);
        if (typeof announceLevel === 'function') announceLevel(inMsg);
    }
}

function evacuateEndlessSurvival() {
    if (!isEndlessMode) return;
    sExitOpen();
    try {
        const high = loadHigh();
        const prevWave = Math.floor(Number(high.endlessBestWave || 0));
        if (endlessWave > prevWave) {
            high.endlessBestWave = endlessWave;
        }
        // Beri bonus ekstra nanite atas evakuasi sukses dengan selamat
        const bonusNanite = 100 + endlessWave * 25;
        if (typeof addNaniteShards === 'function') addNaniteShards(bonusNanite);
        saveHigh(high);
    } catch (_) {}

    const evacMsg = tt('endless_evac_success').replace('{w}', endlessWave);
    if (typeof announceLevel === 'function') announceLevel(evacMsg);

    setTimeout(() => {
        backToMenu();
    }, 1200);
}

// Window global bindings for in-game UI & modal triggers
window.restartGame = restartGame;
window.restartFromPause = typeof restartFromPause === 'function' ? restartFromPause : restartGame;
window.continueGame = continueGame;
window.togglePause = togglePause;
window.retryLevel = retryLevel;
window.backToMenu = backToMenu;
window.finishEpilogue = typeof finishEpilogue === 'function' ? finishEpilogue : () => {};
window.openWorkbenchModal = typeof openWorkbenchModal === 'function' ? openWorkbenchModal : () => {};
window.closeWorkbenchModal = typeof closeWorkbenchModal === 'function' ? closeWorkbenchModal : () => {};
window.openTalentTreeModal = typeof openTalentTreeModal === 'function' ? openTalentTreeModal : () => {};
window.closeTalentTreeModal = typeof closeTalentTreeModal === 'function' ? closeTalentTreeModal : () => {};
window.openBestiaryModal = typeof openBestiaryModal === 'function' ? openBestiaryModal : () => {};
window.closeBestiaryModal = typeof closeBestiaryModal === 'function' ? closeBestiaryModal : () => {};
window.closeRobotMemoryModal = typeof closeRobotMemoryModal === 'function' ? closeRobotMemoryModal : () => {};
window.closeTerminalPuzzleModal = typeof closeTerminalPuzzleModal === 'function' ? closeTerminalPuzzleModal : () => {};
window.openTerminalPuzzleModal = typeof openTerminalPuzzleModal === 'function' ? openTerminalPuzzleModal : () => {};
window.submitTerminalAnswer = typeof submitTerminalAnswer === 'function' ? submitTerminalAnswer : () => {};
window.terminalKeypadPress = typeof terminalKeypadPress === 'function' ? terminalKeypadPress : () => {};
window.toggleTerminalSwitch = typeof toggleTerminalSwitch === 'function' ? toggleTerminalSwitch : () => {};
window.submitTerminalSwitchCircuit = typeof submitTerminalSwitchCircuit === 'function' ? submitTerminalSwitchCircuit : () => {};
window.openAdminLogin = typeof openAdminLogin === 'function' ? openAdminLogin : () => {};
window.submitAdminLogin = typeof submitAdminLogin === 'function' ? submitAdminLogin : () => {};
window.openAdminArsenalModal = typeof openAdminArsenalModal === 'function' ? openAdminArsenalModal : () => {};
window.closeAdminArsenalModal = typeof closeAdminArsenalModal === 'function' ? closeAdminArsenalModal : () => {};
window.adminFullGodLoadout = typeof adminFullGodLoadout === 'function' ? adminFullGodLoadout : () => {};
window.adminGiveAllWeapons = typeof adminGiveAllWeapons === 'function' ? adminGiveAllWeapons : () => {};
window.adminUnlockAllPerks = typeof adminUnlockAllPerks === 'function' ? adminUnlockAllPerks : () => {};
window.adminToggleGod = typeof adminToggleGod === 'function' ? adminToggleGod : () => {};
window.adminKillAll = typeof adminKillAll === 'function' ? adminKillAll : () => {};
window.adminHealFull = typeof adminHealFull === 'function' ? adminHealFull : () => {};
window.adminUnlockExit = typeof adminUnlockExit === 'function' ? adminUnlockExit : () => {};
window.adminRevealMap = typeof adminRevealMap === 'function' ? adminRevealMap : () => {};
window.adminEquipWeapon = typeof adminEquipWeapon === 'function' ? adminEquipWeapon : () => {};
window.adminAddPerk = typeof adminAddPerk === 'function' ? adminAddPerk : () => {};
window.adminJump = typeof adminJump === 'function' ? adminJump : () => {};
window.adminStartAt = typeof adminStartAt === 'function' ? adminStartAt : () => {};
window.adminTestBoss = typeof adminTestBoss === 'function' ? adminTestBoss : () => {};
window.openPauseSettings = typeof openPauseSettings === 'function' ? openPauseSettings : () => {};
window.closePauseSettings = typeof closePauseSettings === 'function' ? closePauseSettings : () => {};
window.openTouchLayoutEditor = typeof openTouchLayoutEditor === 'function' ? openTouchLayoutEditor : () => {};
window.cancelTouchLayoutEditor = typeof cancelTouchLayoutEditor === 'function' ? cancelTouchLayoutEditor : () => {};
window.closeTouchLayoutEditor = typeof closeTouchLayoutEditor === 'function' ? closeTouchLayoutEditor : () => {};
window.saveTouchLayout = typeof saveTouchLayout === 'function' ? saveTouchLayout : () => {};
window.resetTouchLayout = typeof resetTouchLayout === 'function' ? resetTouchLayout : () => {};
window.onEditorScaleInput = typeof onEditorScaleInput === 'function' ? onEditorScaleInput : () => {};
window.onEditorOpacityInput = typeof onEditorOpacityInput === 'function' ? onEditorOpacityInput : () => {};
window.applyBrightness = typeof applyBrightness === 'function' ? applyBrightness : () => {};
window.setMasterVolume = typeof setMasterVolume === 'function' ? setMasterVolume : () => {};

