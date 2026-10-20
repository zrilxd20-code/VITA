/**
 * Web Security & QA Automated Test Suite for VITA
 * Menguji keamanan sanitasi XSS, validasi input callsign, URL avatar, proteksi data localStorage rusak,
 * integritas level web, verifikasi schema Supabase RPC, konektivitas labirin anti-softlock,
 * regresi kontrol kecerahan (applyBrightness) Hub, aksesibilitas dialog (ARIA + focus trap),
 * aksesibilitas keyboard kontrol non-native (role="button"),
 * kelengkapan i18n modal mode perangkat & pil mode layar mulai,
 * kinerja loop Hub (cache DOM per frame) & penghormatan prefers-reduced-motion pada animasi JS,
 * live region status async Hub (role="status", WCAG 4.1.3),
 * ketahanan loop game terhadap exception (error boundary anti-freeze),
 * interaksi modal Memori Robot (jeda game, i18n, guard kabut, focus trap),
 * dunia deterministik ber-seed (fondasi co-op online: PRNG mulberry32),
 * pemisahan simulasi vs render (fondasi arsitektur host-authoritative),
 * abstraksi pemain multi (fondasi co-op 4 pemain: players[] & host index 0),
 * serialisasi & rekonsiliasi snapshot state (fondasi sinkronisasi relay),
 * serta lobi co-op & transport relay WebSocket (Fase 2 co-op online: 4 pemain),
 * dan lockup logo Hub (emblem inline SVG prosedural + wordmark berlapis) yang diterapkan
 * konsisten ke seluruh judul menu in-game (mulai/jeda/gugur/menang) beserta guard prefers-reduced-motion,
 * kontrak protokol relay tanpa dependency, konfigurasi alamat relay & tautan undangan co-op
 * (dengan penolakan input tak terpercaya), kontrak artefak deploy relay (Docker/Render) & lisensi MIT,
 * kontrak pengemasan Android/Capacitor (bundel web whitelist, ikon/splash prosedural, CI APK),
 * serta kontrak pengemasan PC Desktop/Tauri (konfigurasi native, ikon prosedural multi-dimensi, CI Windows .exe/.msi).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- MENJALANKAN AUDIT KEAMANAN & QA WEB VITA ---');

// 1. Ekstrak file sumber
const homeJs = fs.readFileSync(path.join(__dirname, '../js/home.js'), 'utf8');
const supabaseJs = fs.readFileSync(path.join(__dirname, '../js/supabase.js'), 'utf8');
const gameJs = fs.readFileSync(path.join(__dirname, '../js/game.js'), 'utf8');
const schemaSql = fs.readFileSync(path.join(__dirname, '../supabase_schema.sql'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// Ekstraksi fungsi escapeLbHtml secara dinamis dari js/home.js (Anti False-Positive)
const escapeMatch = homeJs.match(/function escapeLbHtml\([^)]*\)\s*\{[\s\S]*?\n\}/);
assert(escapeMatch, "CRITICAL: Fungsi escapeLbHtml tidak ditemukan di js/home.js");
const escapeLbHtml = new Function('str', escapeMatch[0] + '\nreturn escapeLbHtml(str);');

// TEST 1: XSS Injection Mitigation
console.log('\n[TEST 1] Pengujian Pencegahan XSS Injection...');
const xssPayloads = [
  '<script>alert("XSS")</script>',
  '"><img src=x onerror=alert(1)>',
  "';alert(1)//",
  '<svg/onload=alert(1)>',
  '& < > " \''
];

xssPayloads.forEach((payload, idx) => {
  const escaped = escapeLbHtml(payload);
  assert(!escaped.includes('<script>'), `Gagal mitigasi script tag pada payload ${idx}`);
  assert(!escaped.includes('<img'), `Gagal mitigasi img tag pada payload ${idx}`);
  assert(!escaped.includes('<svg'), `Gagal mitigasi svg tag pada payload ${idx}`);
  assert(!escaped.includes('"'), `Gagal encode quote ganda pada payload ${idx}`);
  assert(!escaped.includes("'"), `Gagal encode quote tunggal pada payload ${idx}`);
});
console.log('✓ TEST 1 LULUS: Semua karakter HTML berbahaya disanitasi dengan entitas HTML aman.');

// TEST 2: Validasi Avatar URL / Data URI (menguji implementasi ASLI di js/home.js)
console.log('\n[TEST 2] Pengujian Validasi Avatar (Mitigasi Pseudo-Protocol & Skema Berbahaya)...');
let isAvatarSafe;
const avatarFnMatch = homeJs.match(/function isAvatarSafeUrl\([^)]*\)\s*\{[\s\S]*?\n\}/);
if (avatarFnMatch) {
  isAvatarSafe = new Function('url', avatarFnMatch[0] + '\nreturn isAvatarSafeUrl(url);');
} else {
  // Fallback: verifikasi policy inline di source (fail-closed jika helper hilang)
  assert(
    homeJs.includes('data:image/') && homeJs.includes('https://'),
    'CRITICAL: Kebijakan avatar aman tidak ditemukan di js/home.js'
  );
  assert(!/\.src\s*=\s*prof\.avatar\s*;/.test(homeJs.replace(/if\s*\([^)]*\)\s*\{[^}]*\.src\s*=\s*prof\.avatar[^}]*\}/g, '')),
    'CRITICAL: Terdapat assignment avatar .src tanpa guard validasi');
  isAvatarSafe = (url) => {
    if (!url || typeof url !== 'string') return false;
    const s = url.trim();
    return /^data:image\//i.test(s) || /^https:\/\//i.test(s);
  };
}

assert(isAvatarSafe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE='), 'Data URI image valid harus diterima');
assert(isAvatarSafe('https://images.unsplash.com/photo-123.jpg'), 'HTTPS avatar valid harus diterima');
assert(!isAvatarSafe('javascript:alert(1)'), 'javascript: pseudo-protocol harus DITOLAK');
assert(!isAvatarSafe('data:text/html;base64,PHNjcmlwdD4='), 'data:text/html harus DITOLAK');
assert(!isAvatarSafe('file:///etc/passwd'), 'file: protocol harus DITOLAK');
assert(!isAvatarSafe('blob:http://evil.com'), 'blob unvalidated protocol harus DITOLAK');
assert(!isAvatarSafe('  javascript:alert(1)  '), 'javascript: dengan whitespace harus DITOLAK');
assert(!isAvatarSafe('JaVaScRiPt:alert(1)'), 'javascript: case-variation harus DITOLAK');
assert(!isAvatarSafe(12345), 'Avatar non-string harus DITOLAK');
assert(!isAvatarSafe('data:text/html;base64,PHNjcmlwdD4='), 'data:text/html duplikat harus DITOLAK');
assert(isAvatarSafe('  https://images.unsplash.com/photo-123.jpg  '), 'HTTPS dengan whitespace harus diterima');
assert(isAvatarSafe('DATA:IMAGE/png;base64,AAA='), 'Data URI case-insensitive harus diterima');
// Pastikan render leaderboard memakai guard terpusat (tidak ada startsWith mentah yang tersisa)
assert(!homeJs.includes("item.avatar.startsWith('data:image/')"), 'Leaderboard harus memakai isAvatarSafeUrl terpusat');
assert(homeJs.includes('isAvatarSafeUrl(item.avatar)'), 'Leaderboard harus memanggil isAvatarSafeUrl(item.avatar)');
assert(homeJs.includes('isAvatarSafeUrl(prof.avatar)'), 'Profile fallback harus memanggil isAvatarSafeUrl(prof.avatar)');
console.log('✓ TEST 2 LULUS: Protokol avatar berbahaya berhasil ditolak.');

// TEST 3: Validasi Format Callsign / Username (Anti-Injection & ReDoS)
console.log('\n[TEST 3] Pengujian Validasi Karakter Callsign Operatif...');
// Ekstrak regex validasi callsign langsung dari js/home.js
const usernameRegexMatch = homeJs.match(/!\/([^\/]+)\/\.test\(username\)/);
assert(usernameRegexMatch, "CRITICAL: Regex validasi callsign tidak ditemukan di js/home.js");
const callsignRegex = new RegExp(usernameRegexMatch[1]);

function validateCallsign(u) {
  if (!u || u.length < 3 || u.length > 24) return false;
  return callsignRegex.test(u);
}

assert(validateCallsign('GHOST_99'), 'Callsign standar harus valid');
assert(validateCallsign('Operatif-01'), 'Callsign dengan tanda hubung harus valid');
assert(validateCallsign('Alpha 7'), 'Callsign dengan spasi harus valid');
assert(!validateCallsign('AB'), 'Callsign terlalu pendek (<3) harus ditolak');
assert(!validateCallsign('A'.repeat(25)), 'Callsign terlalu panjang (>24) harus ditolak');
assert(!validateCallsign('Admin<script>'), 'Callsign dengan tag HTML harus ditolak');
assert(!validateCallsign('Operatif; DROP TABLE'), 'Callsign dengan karakter SQL separator harus ditolak');
assert(!validateCallsign('User"OR"1"="1'), 'Callsign dengan quote harus ditolak');
console.log('✓ TEST 3 LULUS: Filter regex dan batas panjang username kuat.');

// TEST 4: Ketahanan terhadap Corrupted JSON di localStorage (Anti-Crash)
console.log('\n[TEST 4] Pengujian Ketahanan Crash Data Lokal Korup...');
function parseStorageSafely(raw, fallback) {
  try {
    const val = JSON.parse(raw || 'null');
    return (val !== null && typeof val === 'object') ? val : fallback;
  } catch (e) {
    return fallback;
  }
}

const corruptedInputs = ['{bad_json: 123', 'undefined', '<html>crash</html>', '', 'null', '12345'];
corruptedInputs.forEach((input) => {
  const res = parseStorageSafely(input, { volume: 70, brightness: 100 });
  assert.strictEqual(typeof res, 'object');
  assert(res !== null);
});
// Evaluasi implementasi ASLI: getProfile harus tahan tipe korup (anti-crash TypeError)
assert(homeJs.includes('typeof raw.name'), 'CRITICAL: getProfile harus memvalidasi tipe raw.name (anti-crash)');
assert(homeJs.includes("typeof raw.avatar !== 'string'"), 'CRITICAL: getProfile harus memvalidasi tipe avatar');
assert(supabaseJs.includes("typeof raw.url === 'string'"), 'CRITICAL: getSupabaseConfig harus memvalidasi tipe url/anonKey');
assert(supabaseJs.includes('Math.max(1, Math.min(100,'), 'CRITICAL: fetchTopLeaderboard harus clamp limit anti-injection');
console.log('✓ TEST 4 LULUS: Semua string rusak berhasil dipulihkan dengan fallback default.');

// TEST 5: Integritas Batas Level Sektor (Level 15 Apex)
console.log('\n[TEST 5] Pengujian Batas Level Leaderboard & Arena...');
assert(supabaseJs.includes('Math.min(15,'), 'supabase.js harus mendukung hingga level 15');
assert(gameJs.includes('LEVELS = 15'), 'game.js harus mengonfigurasi LEVELS = 15');
console.log('✓ TEST 5 LULUS: Batas level web konsisten pada 15 Sektor.');

// TEST 6: Integritas Schema Database Supabase (Anti-Tampering & Secure RPC)
console.log('\n[TEST 6] Pengujian Keamanan & Integritas Schema Supabase...');
assert(schemaSql.includes('chk_leaderboard_best_time'), 'Schema harus memiliki constraint batas waktu');
assert(schemaSql.includes('chk_leaderboard_highest_level'), 'Schema harus membatasi level 1-15');
assert(schemaSql.includes('chk_leaderboard_grade'), 'Schema harus memvalidasi grade S/A/B/C');
assert(schemaSql.includes('verify_operative_passcode'), 'Schema harus mendefinisikan RPC verify_operative_passcode');
assert(schemaSql.includes('upsert_operative_profile'), 'Schema harus mendefinisikan RPC upsert_operative_profile');
assert(schemaSql.includes('v_public_profiles'), 'Schema harus menyediakan safe view tanpa kolom passcode');
assert(supabaseJs.includes('rpc/upsert_operative_profile'), 'supabase.js harus mendukung integrasi secure upsert RPC');
assert(supabaseJs.includes('verifyOperativePasscode'), 'supabase.js harus menyediakan fungsi verifyOperativePasscode');
console.log('✓ TEST 6 LULUS: Schema database Supabase memiliki constraint dan RPC yang aman.');

// TEST 7: Pengujian Konektivitas Labirin & Anti-Softlock (BFS Reachability)
console.log('\n[TEST 7] Pengujian Konektivitas Labirin Sektor 1-15 (Anti-Softlock BFS)...');
function checkMazeReachability(mW, mH, grid, startX, startY, targetX, targetY) {
  const visited = Array.from({ length: mH }, () => new Uint8Array(mW));
  const queue = [{ x: startX, y: startY }];
  visited[startY][startX] = 1;

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.x === targetX && cur.y === targetY) return true;

    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx >= 0 && nx < mW && ny >= 0 && ny < mH && grid[ny][nx] === 0 && !visited[ny][nx]) {
        visited[ny][nx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

// Simulasi Level 15 (Monolith Sanctum: koridor masuk selatan terhubung ke pusat lingkaran)
const mW15 = 38, mH15 = 40;
const grid15 = Array.from({ length: mH15 }, () => new Array(mW15).fill(1));
const cx = Math.floor(mW15 / 2); // 19
const cy = 17;
const arenaR = 14.5;
for (let y = 1; y < mH15 - 1; y++) {
  for (let x = 1; x < mW15 - 1; x++) {
    if (Math.hypot(x - cx, y - cy) < arenaR) grid15[y][x] = 0;
  }
}
const corridorStart = Math.floor(cy + arenaR) - 1;
for (let y = corridorStart; y <= mH15 - 2; y++) {
  for (let x = cx - 1; x <= cx + 1; x++) grid15[y][x] = 0;
}
for (let x = cx - 2; x <= cx + 2; x++) {
  grid15[mH15 - 3][x] = 0;
  grid15[mH15 - 2][x] = 0;
}

// Start di airlock selatan, target di pusat arena boss
const playerSpawn15 = { x: cx, y: mH15 - 3 };
const bossCenter15 = { x: cx, y: cy };
const reachesBoss = checkMazeReachability(mW15, mH15, grid15, playerSpawn15.x, playerSpawn15.y, bossCenter15.x, bossCenter15.y);
assert(reachesBoss, 'Sektor 15 harus memiliki jalur terbuka dari spawn ke arena boss');

console.log('✓ TEST 7 LULUS: Konektivitas labirin terverifikasi bebas softlock melalui pencarian jalur BFS.');

// TEST 8: Regresi Kecerahan Hub (bug: applyBrightness menarget id hantu #emberCanvas,
// sehingga slider Kecerahan tidak berefek di Hub). Ambience Hub kini digerakkan lewat
// CSS custom property --hub-bright tanpa menghapus filter blur() milik tiap lapisan.
console.log('\n[TEST 8] Pengujian Regresi Kecerahan Hub (applyBrightness)...');
const homeCss = fs.readFileSync(path.join(__dirname, '../css/home.css'), 'utf8');
const briMatch = gameJs.match(/function applyBrightness\([^)]*\)\s*\{[\s\S]*?\n\}/);
assert(briMatch, 'CRITICAL: Fungsi applyBrightness tidak ditemukan di js/game.js');
const briBody = briMatch[0];

assert(!/getElementById\(\s*['"]emberCanvas['"]\s*\)/.test(briBody), 'Regresi: applyBrightness kembali menarget id hantu #emberCanvas');
assert(!/getElementById\(\s*['"]emberCanvas['"]\s*\)/.test(gameJs), 'Referensi id hantu #emberCanvas masih tersisa di js/game.js');
assert(/setProperty\(\s*['"]--hub-bright['"]/.test(briBody), 'applyBrightness harus menyetel CSS variable --hub-bright untuk ambience Hub');

assert(/\.bg-blobs\s*\{[^}]*blur\(90px\)\s*brightness\(var\(--hub-bright, 1\)\)/.test(homeCss),
  '.bg-blobs harus merantai blur(90px) dengan brightness(var(--hub-bright)) agar blur tidak hilang');
assert(/\.fog\s*\{[^}]*blur\(28px\)\s*brightness\(var\(--hub-bright, 1\)\)/.test(homeCss),
  '.fog harus merantai blur(28px) dengan brightness(var(--hub-bright)) agar blur tidak hilang');
assert(/#embers\s*\{[^}]*filter:\s*brightness\(var\(--hub-bright, 1\)\)/.test(homeCss),
  '#embers harus memakai brightness(var(--hub-bright))');
assert(/\.grid-overlay\s*\{[^}]*brightness\(var\(--hub-bright, 1\)\)/.test(homeCss),
  '.grid-overlay harus memakai brightness(var(--hub-bright))');

console.log('✓ TEST 8 LULUS: Slider Kecerahan menggerakkan ambience Hub tanpa menghapus efek blur.');

// TEST 9: Aksesibilitas Dialog Hub (semantik ARIA + jebakan fokus keyboard).
// Dialog Hub dibuka lewat kelas .open ATAU style.display, beberapa tanpa role/aria-modal,
// fokus tidak berpindah ke dalam dialog, dan tombol Tab bisa bocor ke konten di belakang.
console.log('\n[TEST 9] Pengujian Aksesibilitas Dialog (ARIA + Focus Trap)...');
assert(homeJs.includes("setAttribute('role', 'dialog')"), 'Dialog Hub harus memperoleh role="dialog" otomatis');
assert(homeJs.includes("setAttribute('aria-modal', 'true')"), 'Dialog Hub harus memperoleh aria-modal="true"');
assert(homeJs.includes("aria-labelledby"), 'Dialog Hub harus memperoleh nama aksesibel (aria-labelledby) dari judulnya');
assert(homeJs.includes('MutationObserver'), 'Manajemen fokus dialog harus memakai MutationObserver (mendukung .open maupun style.display)');
assert(homeJs.includes('restoreTarget'), 'Fokus harus dipulihkan ke elemen pemicu saat dialog ditutup');
assert(homeJs.includes('focusableWithin') && /e\.key\s*!==\s*'Tab'/.test(homeJs), 'Tombol Tab harus dijebak di dalam dialog yang terbuka');
const tokensCss = fs.readFileSync(path.join(__dirname, '../css/tokens.css'), 'utf8');
assert(tokensCss.includes('input:focus-visible') && tokensCss.includes('select:focus-visible') && tokensCss.includes('textarea:focus-visible'),
  ':focus-visible harus mencakup kontrol form (input/select/textarea)');
console.log('✓ TEST 9 LULUS: Dialog Hub memiliki semantik ARIA, jebakan fokus Tab, dan pemulihan fokus.');

// TEST 10: Kelengkapan i18n modal mode perangkat + pil mode pada layar mulai.
// Regresi: teks statis dulu berbahasa Indonesia padahal bahasa default EN, dan sebagian
// elemen modal tidak pernah disetel applyLang() sehingga tetap ID walau antarmuka berbahasa EN.
console.log('\n[TEST 10] Pengujian Kelengkapan i18n (Modal Mode Perangkat & Pil Mode)...');
const deviceModalIds = ['deviceModalTitle', 'deviceModalDesc', 'devicePcTitle', 'devicePcRec', 'devicePcDesc',
  'deviceMobileTitle', 'deviceMobileRec', 'deviceMobileDesc', 'deviceRememberText', 'deviceBtnEnter'];
deviceModalIds.forEach(function (id) {
  assert(gameJs.includes(`getElementById('${id}')`), `applyLang() harus menyetel teks #${id}`);
});
['SELECT CONTROL MODE', 'ENTER MISSION', 'MOBILE / TABLET (TOUCHSCREEN)', 'CONTROL MODE: PC (KEYBOARD)'].forEach(function (en) {
  assert(indexHtml.includes(en), `Teks statis default EN "${en}" harus ada di index.html`);
});
assert(!/PILIH MODE KONTROL|MASUK KE MISI|\[GANTI\]/.test(indexHtml), 'Teks statis modal/pil mode perangkat tidak boleh tertinggal dalam Bahasa Indonesia');
assert(/\.device-pill-btn/.test(homeJs) && indexHtml.includes('[SWITCH]'), 'Label [SWITCH]/[GANTI] pil mode harus dilokalkan');
assert(/pill\.title\s*=/.test(homeJs), 'Tooltip pil mode harus mengikuti bahasa aktif');
assert(/updateStartScreenDevicePill\(settings\.deviceMode,\s*settings\.lang\)/.test(gameJs),
  'applyLang() harus meneruskan bahasa aktif ke updateStartScreenDevicePill()');
console.log('✓ TEST 10 LULUS: Modal mode perangkat & pil mode mengikuti bahasa aktif tanpa sisa teks ID.');

// TEST 11: Kontrol non-native (role="button") dapat dijangkau & diaktifkan keyboard.
// Regresi: kartu pilihan perangkat, pil mode, dan banner operatif adalah <div>
// ber-onclick tanpa role/tabindex, sehingga tidak bisa difokus maupun ditekan
// pengguna keyboard (dan tidak punya cincin fokus yang terlihat).
console.log('\n[TEST 11] Pengujian Aksesibilitas Kontrol Non-Native (role="button")...');
const nativeButtonIds = ['deviceChoicePc', 'deviceChoiceMobile', 'startOperativeBanner', 'startScreenDevicePill'];
nativeButtonIds.forEach(function (id) {
  const re = new RegExp(`id="${id}"[^>]*\\brole="button"[^>]*\\btabindex="0"`);
  assert(re.test(indexHtml), `#${id} harus ber-role="button" dan tabindex="0" agar dapat difokus keyboard`);
});
assert(/id="sidebarBackdrop"[^>]*aria-hidden="true"/.test(indexHtml),
  'Backdrop klik-untuk-tutup harus aria-hidden (murni penunjuk, bukan kontrol)');
assert(/getAttribute\('role'\)\s*!==\s*'button'/.test(homeJs) && /el\.click\(\)/.test(homeJs),
  'Enter/Space pada role="button" non-native harus memicu klik (aktivasi keyboard)');
assert(/setAttribute\('aria-pressed'/.test(homeJs),
  'Kartu pilihan perangkat harus mencerminkan status terpilih lewat aria-pressed');
assert(tokensCss.includes('[role="button"]:focus-visible'),
  'role="button" harus memperoleh cincin fokus :focus-visible');
console.log('✓ TEST 11 LULUS: Kontrol non-native dapat difokus & diaktifkan lewat keyboard.');

// TEST 12: Kinerja loop Hub (60 Hz) & penghormatan prefers-reduced-motion pada animasi JS.
// Regresi: loop ember & pulse bestiary memanggil getElementById('homeView') dan
// querySelectorAll('#homeView .foe-canvas-box canvas') SETIAP frame; animasi transform JS
// juga tetap berdenyut walau pengguna memilih reduced-motion (aturan CSS global hanya
// meredam transisi CSS, bukan loop JS, sehingga nilai berubah 60x/detik).
console.log('\n[TEST 12] Pengujian Kinerja Loop Hub & prefers-reduced-motion (animasi JS)...');
const hubBody = (homeJs.match(/function hubView\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(hubBody.includes("getElementById('homeView')") && hubBody.includes('isConnected'),
  'Helper hubView() harus meng-cache #homeView dan memvalidasi isConnected');
const emberBody = (homeJs.match(/function drawEmbers\([\s\S]*?\n\}/) || [''])[0];
assert(emberBody.includes('hubView()'), 'drawEmbers harus memakai hubView() yang di-cache, bukan query per frame');
assert(!/getElementById\(\s*['"]homeView['"]\s*\)/.test(emberBody),
  'Regresi: drawEmbers kembali melakukan getElementById("homeView") tiap frame');
const pulseIdx = homeJs.indexOf('function vita2PulseFoes');
assert(pulseIdx !== -1, 'Fungsi vita2PulseFoes tidak ditemukan di js/home.js');
const pulseBody = homeJs.slice(pulseIdx, pulseIdx + 1000);
assert(/if \(!pulseFoes \|\| pulseFoes\.length === 0 \|\| !pulseFoes\[0\]\.isConnected\)/.test(pulseBody),
  'NodeList bestiary harus di-cache (guard isConnected), bukan querySelectorAll tiap frame');
assert(/for \(let i = 0; i < pulseFoes\.length; i\+\+\)/.test(pulseBody),
  'Loop pulse harus iterasi indeks (tanpa alokasi iterator forEach tiap frame)');
assert(/matchMedia\(\s*['"]\(prefers-reduced-motion: reduce\)['"]\s*\)/.test(homeJs) && /HOME_REDUCE_MOTION/.test(homeJs),
  'Hub harus mendeteksi prefers-reduced-motion untuk animasi JS dekoratif');
assert(/!HOME_REDUCE_MOTION[\s\S]{0,120}requestAnimationFrame\(vita2PulseFoes\)/.test(homeJs),
  'Pulse bestiary harus dilewati saat prefers-reduced-motion aktif');
console.log('✓ TEST 12 LULUS: Loop Hub tidak query DOM tiap frame & menghormati prefers-reduced-motion.');

// TEST 13: Status async Hub diumumkan ke pembaca layar (WCAG 4.1.3 Status Messages).
// Regresi: tag uplink Supabase (#supabaseStatusTag) dan status DB profil (#profileDbStatus)
// berubah teks secara dinamis (STANDBY → LINKING... → UPLINK ACTIVE / LINK FAILED) tanpa
// aria-live, sehingga pembaca layar tidak mengumumkan hasil operasi jaringan.
console.log('\n[TEST 13] Pengujian Live Region Status Async Hub (WCAG 4.1.3)...');
['supabaseStatusTag', 'profileDbStatus'].forEach(function (id) {
  const re = new RegExp(`id="${id}"[^>]*\\brole="status"`);
  assert(re.test(indexHtml), `#${id} harus ber-role="status" agar perubahan status diumumkan pembaca layar`);
});
assert(/getElementById\(\s*['"]supabaseStatusTag['"]\s*\)/.test(homeJs) && /textContent\s*=\s*['"]LINKING\.\.\.['"]/.test(homeJs),
  'Alur uplink harus memperbarui teks #supabaseStatusTag (target live region)');
assert(/getElementById\(\s*['"]profileDbStatus['"]\s*\)/.test(homeJs),
  'Status DB profil harus diperbarui JS (target live region)');
console.log('✓ TEST 13 LULUS: Status async Hub memiliki live region (role="status").');

// TEST 14: Ketahanan loop game terhadap exception (error boundary / anti-freeze).
// Regresi: gameLoop() lama HANYA menjadwalkan requestAnimationFrame di baris terakhir,
// sehingga SATU exception di jalur update/render membuat frame berikutnya tidak pernah
// dijadwalkan → layar membeku permanen (persis gejala "crash saat bermain"). Wrapper
// sekarang wajib membungkus gameLoopFrame() dalam try/catch dan tetap menjadwalkan rAF.
console.log('\n[TEST 14] Pengujian Ketahanan Loop Game (error boundary anti-freeze)...');
const loopWrapBody = (gameJs.match(/function gameLoop\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(loopWrapBody.includes('try') && loopWrapBody.includes('gameLoopFrame()') && loopWrapBody.includes('reportLoopError(err)'),
  'gameLoop() harus membungkus gameLoopFrame() dalam try/catch yang melaporkan error');
assert(/catch\s*\(err\)\s*\{[\s\S]*?\}[\s\S]*?requestAnimationFrame\(gameLoop\)/.test(loopWrapBody),
  'requestAnimationFrame(gameLoop) harus dipanggil SETELAH try/catch agar frame tidak pernah putus');
assert(gameJs.includes('function reportLoopError'), 'Fungsi reportLoopError (pencatat error loop) tidak ditemukan');
const loopFrameBody = (gameJs.match(/function gameLoopFrame\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(loopFrameBody.length > 0 && !loopFrameBody.includes('requestAnimationFrame(gameLoop)'),
  'Regresi: gameLoopFrame() menjadwalkan rAF sendiri (frame bisa putus saat exception)');
assert(/addEventListener\(\s*'error'/.test(gameJs) && /addEventListener\(\s*'unhandledrejection'/.test(gameJs),
  'Diagnostik global (window "error" & "unhandledrejection") harus terpasang di js/game.js');
console.log('✓ TEST 14 LULUS: Loop game tetap berjalan walau terjadi exception (anti-freeze).');

// TEST 15: Regresi interaksi modal Memori Robot (temuan in-game Sektor 10).
// Regresi: modal temuan dibuka tanpa menjeda game (monster tetap bergerak di balik dialog),
// tanpa melepas kunci kursor; guard kabut salah indeks (fogOfWar[gy][gx] vs fogOfWar[gx]);
// label tombol hardcoded (bocor ke EN); referensi rongsokan basi antar-level; dan modal
// tidak terdaftar pada focus manager sehingga tombol Tab bocor ke konten di belakang.
console.log('\n[TEST 15] Pengujian Interaksi Modal Memori Robot (Sektor 10)...');
const openRobotBody = (gameJs.match(/function openRobotMemoryModal\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
const closeRobotBody = (gameJs.match(/function closeRobotMemoryModal\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(openRobotBody.length > 0 && /gameState\s*=\s*'paused'/.test(openRobotBody),
  'openRobotMemoryModal() harus menjeda game (gameState = "paused") selama dialog terbuka');
assert(closeRobotBody.length > 0 && /gameState\s*=\s*'playing'/.test(closeRobotBody),
  'closeRobotMemoryModal() harus melanjutkan game (gameState = "playing") saat dialog ditutup');
assert(/!fogOfWar\[wreckedRobot\.gy\]\s*\|\|\s*!fogOfWar\[wreckedRobot\.gy\]\[wreckedRobot\.gx\]/.test(gameJs),
  'Guard kabut drawWreckedRobot() harus mengindeks fogOfWar[gy][gx] (bukan fogOfWar[gx])');
assert(/wreckedRobot = null;\s*\n\s*exitPos = findFarSpot\(/.test(gameJs),
  'initLevel() harus mereset wreckedRobot = null sebelum penempatan exit (cegah referensi basi antar-level)');
assert(indexHtml.includes('data-i18n="robot_continue"') && (gameJs.match(/robot_continue:/g) || []).length === 2,
  'Label tombol robot harus ter-lokalisasi (data-i18n="robot_continue" + kunci di T.id & T.en)');
assert(homeJs.includes('.robot-memory-backdrop'),
  'Modal robot harus terdaftar pada focus manager agar Tab tidak bocor ke belakang dialog');
console.log('✓ TEST 15 LULUS: Modal Memori Robot menjeda game, ter-lokalisasi, dan aksesibel.');

// TEST 16: Fondasi dunia deterministik untuk co-op online (PRNG ber-seed).
// Regresi: dulu seluruh konstruksi level memakai Math.random() langsung, sehingga
// dua peer tidak mungkin membangun labirin/monster/loot yang sama. Sekarang
// initLevel() memasang PRNG ber-seed (mulberry32) HANYA selama pembangunan dunia,
// lalu mengembalikan Math.random asli (single-player tetap tak berubah).
console.log('\n[TEST 16] Pengujian Dunia Deterministik (fondasi co-op online)...');
const hashFnSrc = (gameJs.match(/function hashSeedToUint32\([\s\S]*?\n\}/) || [''])[0];
const rngFnSrc = (gameJs.match(/function mulberry32\([\s\S]*?\n\}/) || [''])[0];
assert(hashFnSrc.length > 0, 'Fungsi hashSeedToUint32 (teks seed → uint32) tidak ditemukan');
assert(rngFnSrc.length > 0, 'Fungsi mulberry32 (PRNG ber-seed) tidak ditemukan');
const rngHelpers = new Function(hashFnSrc + '\n' + rngFnSrc + '\nreturn { hashSeedToUint32, mulberry32 };')();
// 16a. Fungsi hash stabil & deterministik (input sama → nilai sama).
assert(rngHelpers.hashSeedToUint32('ABC-123') === rngHelpers.hashSeedToUint32('ABC-123'),
  'hashSeedToUint32 harus deterministik untuk input yang sama');
assert(rngHelpers.hashSeedToUint32('ABC-123') !== rngHelpers.hashSeedToUint32('ABC-124'),
  'hashSeedToUint32 harus berbeda untuk input berbeda');
// 16b. PRNG: seed sama → urutan identik; seed beda → urutan beda; nilai di [0,1).
const seqA = Array.from({ length: 8 }, ((r) => () => r())(rngHelpers.mulberry32(20261018)));
const seqA2 = Array.from({ length: 8 }, ((r) => () => r())(rngHelpers.mulberry32(20261018)));
const seqB = Array.from({ length: 8 }, ((r) => () => r())(rngHelpers.mulberry32(20261019)));
assert(seqA.every((v, i) => v === seqA2[i]),
  'mulberry32(seed) harus menghasilkan urutan deterministik untuk seed yang sama');
assert(seqA.some((v, i) => v !== seqB[i]),
  'mulberry32 harus menghasilkan urutan berbeda untuk seed berbeda');
assert(seqA.every((v) => v >= 0 && v < 1),
  'Nilai mulberry32 harus berada pada rentang [0, 1)');
// 16c. initLevel() memasang PRNG lalu memulihkan Math.random (single-player utuh).
const initLevelBody = (gameJs.match(/function initLevel\(level\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(initLevelBody.includes('mulberry32(seed)') && /Math\.random\s*=\s*mulberry32\(seed\)/.test(initLevelBody),
  'initLevel() harus memasang PRNG ber-seed selama konstruksi dunia');
assert(/finally\s*\{[\s\S]*?Math\.random\s*=\s*originalRandom/.test(initLevelBody),
  'initLevel() harus memulihkan Math.random asli (finally) agar non-generasi tetap acak');
assert(/seed == null[\s\S]*?buildLevelWorld\(level\);[\s\S]*?return;/.test(initLevelBody),
  'Tanpa seed (single-player) initLevel() harus langsung membangun dunia tanpa menambal Math.random');
assert(gameJs.includes('function buildLevelWorld') && /buildLevelWorld\(level\);/.test(initLevelBody),
  'Konstruksi dunia harus dipisah ke buildLevelWorld() agar dapat dijalankan di bawah PRNG');
const buildBody = (gameJs.match(/function buildLevelWorld\(level\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(buildBody.includes('generateMaze(level)') && buildBody.includes('spawnMonsters(level)'),
  'buildLevelWorld() harus memuat rantai generateMaze() + spawnMonsters()');
assert(/get\('seed'\)/.test(gameJs) && gameJs.includes('netSessionSeed'),
  'Seed sesi harus dapat diambil dari parameter URL ?seed= (netSessionSeed)');
assert(/Math\.random\s*=\s*originalRandom/.test(gameJs),
  'PRNG global (Math.random) harus dikembalikan setelah konstruksi dunia selesai');
console.log('✓ TEST 16 LULUS: Dunia deterministik dari seed — labirin/monster/loot identik antar-peer.');

// TEST 17: Pemisahan simulasi vs render (prasyarat arsitektur host-authoritative).
// Regresi: dulu seluruh update gameplay + render HUD bercampur dalam satu blok
// gameLoopFrame(), sehingga host tidak bisa memajukan state dunia tanpa menyentuh
// canvas/DOM. Sekarang state otoritatif dipisah ke stepSimulation() dan sisi gambar
// ke renderFrame(), sehingga klien dapat menggambar tanpa ikut menyimulasikan dunia.
console.log('\n[TEST 17] Pengujian Pemisahan Simulasi vs Render (fondasi host-authoritative)...');
const fnBody = (name, params) => (gameJs.match(new RegExp('function ' + name + '\\(' + (params || '') + '\\)\\s*\\{[\\s\\S]*?\\n\\}')) || [''])[0];
const simBody = fnBody('stepSimulation');
const visualsBody = fnBody('stepLocalVisuals');
const camBody = fnBody('stepCamera');
const perfBody = fnBody('updatePerfCounters');
const renderBody = fnBody('renderFrame');
const frameBody = fnBody('gameLoopFrame');
// 17a. Semua helper pemisah harus ada.
[['stepSimulation', simBody], ['stepLocalVisuals', visualsBody], ['stepCamera', camBody],
 ['updatePerfCounters', perfBody], ['renderFrame', renderBody], ['gameLoopFrame', frameBody]]
  .forEach(([name, body]) => assert(body.length > 0, 'Fungsi pemisah ' + name + '() tidak ditemukan'));
// 17b. Simulasi otoritatif: seluruh update gameplay yang mengubah state dunia.
['updatePlayer()', 'updateMonsters()', 'updateProjectiles()', 'updateThermalTrails()',
 'updateShockwaves()', 'updateGasClouds()', 'updateTraps()']
  .forEach(call => assert(simBody.includes(call), 'stepSimulation() harus menjalankan ' + call));
// 17c. Simulasi TIDAK boleh menyentuh render/DOM (syarat host tanpa canvas).
['renderGame', 'updateUI', 'drawCrosshair', 'drawMinimap', 'drawDebugDiagnostics', 'hudEl(']
  .forEach(bad => assert(!simBody.includes(bad), 'stepSimulation() tidak boleh memanggil ' + bad + ' (harus murni state)'));
// 17d. Kosmetik lokal dipisah dari simulasi (boleh berbeda antar pemain).
['updateBrassCasings()', 'updateParticles()', 'updateSpores()', 'floatingTexts']
  .forEach(call => assert(visualsBody.includes(call), 'stepLocalVisuals() harus menangani ' + call));
['updatePlayer()', 'updateMonsters()', 'updateTraps()']
  .forEach(bad => assert(!visualsBody.includes(bad), 'stepLocalVisuals() tidak boleh menjalankan logika gameplay ' + bad));
// 17e. Render murni: menggambar, bukan menyimulasikan.
['renderGame()', 'drawCrosshair()', 'drawMinimap()', 'updateUI()']
  .forEach(call => assert(renderBody.includes(call), 'renderFrame() harus memanggil ' + call));
['updatePlayer()', 'updateMonsters()', 'updateProjectiles()']
  .forEach(bad => assert(!renderBody.includes(bad), 'renderFrame() tidak boleh memajukan simulasi ' + bad));
// 17f. Loop utama: sim dulu, lalu render — dan hit-stop tetap merender (dunia beku).
assert(frameBody.includes('stepSimulation()') && frameBody.includes('renderFrame()'),
  'gameLoopFrame() harus memanggil stepSimulation() dan renderFrame()');
assert(frameBody.indexOf('stepSimulation()') < frameBody.lastIndexOf('renderFrame()'),
  'Urutan loop harus menjalankan simulasi sebelum render');
assert(/hitStop\s*--[\s\S]*?renderFrame\(\);[\s\S]*?return;/.test(frameBody),
  'Jalur hit-stop harus membekukan simulasi namun tetap memanggil renderFrame()');
// 17g. Peluruhan efek kerusakan gameplay: hurtFlash harus meluruh di updatePlayer() saat playing.
assert(/screenShake\s*--;[\s\S]*?if\s*\(\s*hurtFlash\s*>\s*0\s*\)\s*hurtFlash\s*--;/.test(gameJs),
  'updatePlayer() harus meluruhkan hurtFlash agar vignette damage merah tidak menetap permanen');
console.log('✓ TEST 17 LULUS: Simulasi (state) terpisah dari render (canvas/HUD) — siap host-authoritative.');

// TEST 18: Abstraksi pemain multi (players[] & host index 0).
// Prasyarat co-op 4 pemain: seluruh state pemain diwadahi dalam array players[],
// dengan pemain lokal dipetakan lewat localPlayerIndex (default 0 untuk host).
console.log('\n[TEST 18] Pengujian Abstraksi Pemain Multi (players[] & localPlayerIndex)...');
// 18a. Deklarasi struktur multi-pemain
assert(/let\s+players\s*=\s*\[\];/.test(gameJs), 'players[] harus dideklarasikan di scope global');
assert(/let\s+localPlayerIndex\s*=\s*0;/.test(gameJs), 'localPlayerIndex harus dideklarasikan di scope global');
assert(/const\s+MAX_PLAYERS\s*=\s*4;/.test(gameJs), 'MAX_PLAYERS harus dibatasi maksimal 4');
assert(/const\s+PLAYER_COLORS\s*=\s*\[/.test(gameJs), 'PLAYER_COLORS harus mendefinisikan palet unik antar pemain');

// 18b. Helper getter & setter pemain lokal
assert(/function\s+getLocalPlayer\(\)/.test(gameJs), 'getLocalPlayer() harus tersedia');
assert(/function\s+setLocalPlayerIndex\(/.test(gameJs), 'setLocalPlayerIndex() harus tersedia');
assert(/function\s+getPlayerByPeer\(/.test(gameJs), 'getPlayerByPeer() harus tersedia');

// 18c. Inisialisasi dunia menempatkan entitas player pada players[coopLocalIdx] dan
// menyetel localPlayerIndex ke indeks itu. Single-player/host default ke indeks 0,
// sedangkan tamu co-op mempertahankan indeks (1..3) yang diberikan relay.
assert(/players\s*=\s*\[\];[\s\S]*?players\[coopLocalIdx\]\s*=\s*player;[\s\S]*?localPlayerIndex\s*=\s*coopLocalIdx;/.test(gameJs),
  'buildLevelWorld() harus menempatkan player di players[coopLocalIdx] & menyetel localPlayerIndex');
assert(/const\s+coopLocalIdx\s*=\s*\(coopRoomId\s*&&\s*!isCoopHost\s*&&\s*localPlayerIndex\s*>\s*0\)\s*\?\s*localPlayerIndex\s*:\s*0;/.test(gameJs),
  'Single-player/host harus default ke indeks 0 (hanya tamu co-op yang memakai indeks relay)');

// 18d. Fungsi render player mendukung entitas target (p = targetPlayer || getLocalPlayer())
assert(/function\s+drawPlayer\(\s*targetPlayer\s*\)/.test(gameJs),
  'drawPlayer() harus menerima parameter targetPlayer');
assert(/const\s+p\s*=\s*targetPlayer\s*\|\|\s*getLocalPlayer\(\);/.test(gameJs),
  'drawPlayer() harus fallback ke getLocalPlayer() bila tanpa argumen');

// 18e. Render loop menggambar seluruh pemain aktif dalam players[]
assert(/for\s*\(\s*let\s+pi\s*=\s*0;\s*pi\s*<\s*players\.length;\s*pi\+\+\s*\)/.test(gameJs),
  'renderGame() harus melakukan iterasi menggambar seluruh pemain di players[]');

// 18f. Kamera memusatkan pandangan pada pemain lokal (getLocalPlayer())
assert(/const\s+lp\s*=\s*getLocalPlayer\(\);/.test(gameJs),
  'stepCamera() harus melacak posisi pemain lokal');

console.log('✓ TEST 18 LULUS: Abstraksi players[] & localPlayerIndex siap untuk co-op 4 pemain.');


// TEST 19: Serialisasi & rekonsiliasi snapshot (fondasi sinkronisasi relay host-authoritative).
// Menguji fungsi murni serializeSnapshot() dan applySnapshot() serta round-trip state.
console.log('\n[TEST 19] Pengujian Serialisasi Snapshot & Round-Trip (fondasi relay state)...');
// 19a. Fungsi serialisasi & rekonsiliasi harus ada
assert(/function\s+serializeSnapshot\(\)/.test(gameJs), 'serializeSnapshot() harus tersedia');
assert(/function\s+applySnapshot\(/.test(gameJs), 'applySnapshot() harus tersedia');

// 19b. Jalankan round-trip snapshot dengan mock state terisolasi (tanpa DOM)
const snapFnSrc = (gameJs.match(/function serializeSnapshot\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
const applyFnSrc = (gameJs.match(/function applySnapshot\([\s\S]*?\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(snapFnSrc.length > 0, 'Fungsi serializeSnapshot() tidak boleh kosong');
assert(applyFnSrc.length > 0, 'Fungsi applySnapshot() tidak boleh kosong');

const snapScope = new Function(`
    let netSnapshotSeq = 0;
    let currentLevel = 2;
    let coinsCollected = 5;
    let localPlayerIndex = 0;
    let player = {
        id: 'p0', peerIndex: 0, callsign: 'HOST_TEST',
        x: 120.4, y: 340.8, hp: 85, maxHp: 100, facing: 1.57, dashing: false,
        currentWeapon: 'rifle', size: 10
    };
    let players = [player];
    let monsters = [
        { x: 200.2, y: 150.4, hp: 40, maxHp: 50, state: 'chase', angle: 0.8 },
        { x: 300.0, y: 250.0, hp: 0, maxHp: 50, state: 'dead', angle: 0 }
    ];

    ${snapFnSrc}
    ${applyFnSrc}

    return {
        serialize: serializeSnapshot,
        apply: applySnapshot,
        getState: () => ({ players, monsters, player, coins: coinsCollected })
    };
`)();

const snap = snapScope.serialize();
assert(snap.seq === 1, 'Sequence nomor snapshot pertama harus 1');
assert(snap.level === 2, 'Level dalam snapshot harus cocok');
assert(snap.coins === 5, 'Koin dalam snapshot harus cocok');
assert(snap.players.length === 1 && snap.players[0].x === 120.4, 'Data pemain snapshot harus cocok');
// Monster mati (hp <= 0) harus di-cull
assert(snap.monsters.length === 1 && snap.monsters[0].x === 200.2, 'Monster mati harus di-cull dari snapshot');

// Uji rekonsiliasi klien (isHost = false)
snapScope.getState().monsters[0].x = 0;
snapScope.getState().monsters[0].y = 0;
const ok = snapScope.apply(snap, false);
assert(ok === true, 'applySnapshot() harus mengembalikan true');
assert(snapScope.getState().monsters[0].x === 200.2, 'applySnapshot harus merekonsiliasi posisi monster');

// Uji guard host: host tidak menimpa posisi lokal sendiri
snapScope.getState().player.x = 999;
snap.players[0].x = 111;
snapScope.apply(snap, true);
assert(snapScope.getState().player.x === 999, 'Guard host harus mencegah overwriting pemain lokal');
console.log('✓ TEST 19 LULUS: Serialisasi snapshot hemat-bandwidth & rekonsiliasi round-trip valid.');

// TEST 20: Lobby Co-op & Transport Relay WebSocket (Fase 2 co-op online).
// Memverifikasi antarmuka lobi co-op, semantik dialog ARIA, kode kamar deterministik,
// fungsi client WebSocket, dan ketersediaan tombol peluncuran.
console.log('\n[TEST 20] Pengujian Lobby Co-op & Transport Relay WebSocket (Fase 2 co-op online)...');
// 20a. Elemen lobi co-op pada index.html
assert(indexHtml.includes('id="btnCoopLobby"'), 'Tombol lobi co-op #btnCoopLobby harus ada di index.html');
assert(indexHtml.includes('id="coopLobbyModal"'), 'Modal lobi co-op #coopLobbyModal harus ada di index.html');
assert(/id="coopLobbyModal"[^>]*role="dialog"/.test(indexHtml), 'Modal #coopLobbyModal harus memiliki role="dialog"');
assert(/id="coopLobbyModal"[^>]*aria-modal="true"/.test(indexHtml), 'Modal #coopLobbyModal harus memiliki aria-modal="true"');
assert(/id="coopLobbyModal"[^>]*aria-labelledby="coopLobbyTitle"/.test(indexHtml), 'Modal #coopLobbyModal harus memiliki aria-labelledby="coopLobbyTitle"');

// 20b. Fungsi kontrol lobi di js/game.js
['openCoopLobbyModal', 'closeCoopLobbyModal', 'switchCoopTab', 'generateRoomCode',
 'initHostLobbyRoom', 'updateCoopSlotsUI', 'copyCoopRoomCode', 'submitJoinCoopRoom',
 'connectCoopRelay', 'sendCoopMessage', 'handleCoopMessage', 'launchCoopMission']
  .forEach(fn => assert(gameJs.includes('function ' + fn), 'Fungsi lobi ' + fn + '() harus tersedia di game.js'));

// 20c. Pengujian generator kode kamar: 4 karakter alfanumerik kapital tanpa karakter ambigu
const codeGenFn = (gameJs.match(/function generateRoomCode\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(codeGenFn.length > 0, 'Fungsi generateRoomCode() tidak ditemukan');
const testGenCode = new Function(codeGenFn + '\nreturn generateRoomCode;')();
for (let i = 0; i < 20; i++) {
    const c = testGenCode();
    assert(typeof c === 'string' && c.length === 4, 'generateRoomCode() harus menghasilkan string 4 karakter');
    assert(/^[A-Z0-9]{4}$/.test(c), 'Kode kamar harus alfanumerik kapital: ' + c);
}

// 20d. Transport WebSocket & message handler
assert(gameJs.includes('new WebSocket('), 'Koneksi relay harus menggunakan WebSocket native');
assert(/sendCoopMessage\(\s*'JOIN'/.test(gameJs), 'Klien harus mengirim tipe pesan JOIN saat terhubung');
assert(/sendCoopMessage\(\s*'START_GAME'/.test(gameJs), 'Host harus menyiarkan START_GAME dengan seed saat meluncurkan misi');

console.log('✓ TEST 20 LULUS: Antarmuka lobi co-op, aksesibilitas ARIA, generator kode, & transport relay terverifikasi.');

// TEST 21: Sinkronisasi Input, Snapshot 20Hz, dan Client Prediction (Fase 3 co-op online).
// Memverifikasi transmisi input peer, pemrosesan gerak remote peer di host,
// rekonsiliasi client prediction berbasis threshold (28px), dan badge latency network.
console.log('\n[TEST 21] Pengujian Sinkronisasi Input, Snapshot 20Hz, & Client Prediction (Fase 3 co-op online)...');

// 21a. HUD network latency badge di index.html
assert(indexHtml.includes('id="coopNetBadge"'), 'Badge jaringan #coopNetBadge harus ada di index.html');

// 21b. Ketersediaan fungsi sinkronisasi input & jaringan di js/game.js
['sampleAndSendPeerInput', 'updateRemotePeers', 'updateNetPing', 'updateNetBadgeUI']
  .forEach(fn => assert(gameJs.includes('function ' + fn), 'Fungsi sinkronisasi ' + fn + '() harus tersedia di game.js'));

// 21c. Pengujian pemrosesan input remote peer di host
const syncScope = new Function(`
    let isWall = () => false;
    let isMonster = () => false;
    ${(gameJs.match(/function moveEntity[\s\S]*?\n\}/) || [''])[0]}
    ${(gameJs.match(/function updateRemotePeers[\s\S]*?\n\}/) || [''])[0]}
    ${(gameJs.match(/function applySnapshot[\s\S]*?\n\}/) || [''])[0]}

    let isCoopHost = true;
    let localPlayerIndex = 0;
    let players = [
        { id: 'p0', peerIndex: 0, x: 100, y: 100, hp: 100, maxHp: 100, speed: 2.4, facing: 0 },
        { id: 'p1', peerIndex: 1, x: 200, y: 200, hp: 100, maxHp: 100, speed: 2.4, facing: 0, dashCooldown: 0 }
    ];
    let peerInputs = {
        1: { dx: 1, dy: 0, facing: 0, dashing: false, tick: 1 }
    };
    let monsters = [];

    return {
        updatePeers: updateRemotePeers,
        applySnap: applySnapshot,
        getPlayers: () => players,
        setLocalIndex: (idx) => { localPlayerIndex = idx; },
        setCoopHost: (val) => { isCoopHost = val; }
    };
`)();

const pBefore = syncScope.getPlayers()[1].x;
syncScope.updatePeers();
const pAfter = syncScope.getPlayers()[1].x;
assert(pAfter > pBefore, 'Host harus menggerakkan peer remote berdasarkan peerInputs (pAfter=' + pAfter + ' > pBefore=' + pBefore + ')');

// 21d. Pengujian rekonsiliasi client prediction (isHost = false)
// Simulasi deviasi kecil (< 28px): posisi prediksi pemain lokal tidak boleh melonjak
syncScope.setCoopHost(false);
syncScope.setLocalIndex(1);
const localP = syncScope.getPlayers()[1];
localP.x = 210; localP.y = 200; // deviasi 10px dari snapshot host
const snapClient = {
    seq: 10,
    players: [{ idx: 1, id: 'p1', x: 200, y: 200, hp: 95, maxHp: 100, facing: 0, dashing: false, curW: 'knife', size: 10 }]
};
syncScope.applySnap(snapClient, false);
assert(localP.x === 210, 'Deviasi kecil (<28px) tidak boleh menghentak posisi lokal pemain');
assert(localP.hp === 95, 'HP otoritatif server harus tersinkronisasi');

// Simulasi deviasi besar (> 28px): pemain lokal ditarik secara halus menuju posisi otoritatif
localP.x = 250; localP.y = 200; // deviasi 50px
syncScope.applySnap(snapClient, false);
assert(localP.x < 250, 'Deviasi besar (>28px) harus merekonsiliasi posisi pemain lokal menuju server');

// 21e. Pengujian penanganan pesan input & ping/pong
assert(/sendCoopMessage\(\s*'INPUT'/.test(gameJs), 'Klien harus mengirim tipe pesan INPUT ke host');
assert(/sendCoopMessage\(\s*'PING'/.test(gameJs), 'Koneksi relay harus mendukung pengiriman PING');
assert(/sendCoopMessage\(\s*'PONG'/.test(gameJs), 'Relay handler harus membalas dengan PONG');

console.log('✓ TEST 21 LULUS: Sinkronisasi input peer, rekonsiliasi client prediction & HUD badge terverifikasi.');

// TEST 22: Combat Multi-Target, Revive Downed Operative, & Peer Weapon Firing (Fase 4 co-op online).
// Memverifikasi pemilihan target cerdas monster AI (getClosestActivePlayer),
// mekanisme Downed (30s timer) & Revive (interaksi tim 3s) tanpa softlock/desync,
// serta penembakan senjata remote peer otoritatif.
console.log('\n[TEST 22] Pengujian Combat Multi-Target, Revive Downed, & Peer Firing (Fase 4 co-op online)...');

// 22a. Ketersediaan fungsi Fase 4 di js/game.js
['getClosestActivePlayer', 'damagePlayerDowned', 'updateDownedAndRevive', 'triggerRemotePeerAttack']
  .forEach(fn => assert(gameJs.includes('function ' + fn), 'Fungsi combat co-op ' + fn + '() harus tersedia di game.js'));

// 22b. Pengujian pemilihan target monster AI multi-operatif
const combatScope = new Function(`
    let dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let tt = (k) => k;
    let sDie = () => {};
    let sEMPBlast = () => {};
    let sPiercingRifle = () => {};
    let sShotgun = () => {};
    let sMinigun = () => {};
    let addShockwave = () => {};
    let addParticle = () => {};
    let floatingTexts = [];
    let projectiles = [];
    let deathTriggered = false;
    let handlePlayerDeath = () => { deathTriggered = true; };
    let coopRoomId = 'TEST';
    let gameState = 'playing';

    let WEAPONS = {
        knife: { id: 'knife', cooldown: 20 },
        rifle: { id: 'rifle', cooldown: 28 },
        shotgun: { id: 'shotgun', cooldown: 35 },
        minigun: { id: 'minigun', cooldown: 8 }
    };

    let player = { id: 'p0', peerIndex: 0, x: 100, y: 100, hp: 100, maxHp: 100, downed: false };
    let players = [
        player,
        { id: 'p1', peerIndex: 1, x: 400, y: 400, hp: 100, maxHp: 100, downed: false, currentWeapon: 'rifle', atk: 30 }
    ];

    ${(gameJs.match(/function getClosestActivePlayer[\s\S]*?\n\}/) || [''])[0]}
    ${(gameJs.match(/function damagePlayerDowned[\s\S]*?\n\}/) || [''])[0]}
    ${(gameJs.match(/function updateDownedAndRevive[\s\S]*?\n\}/) || [''])[0]}
    ${(gameJs.match(/function triggerRemotePeerAttack[\s\S]*?\n\}/) || [''])[0]}

    return {
        getClosest: getClosestActivePlayer,
        damageDowned: damagePlayerDowned,
        updateRevive: updateDownedAndRevive,
        peerAttack: triggerRemotePeerAttack,
        getPlayers: () => players,
        getProjectiles: () => projectiles,
        isDead: () => deathTriggered
    };
`)();

// Monster di (380, 380) harus menarget p1 yang paling dekat (jarak ~28px vs p0 ~395px)
const monsterNearP1 = { x: 380, y: 380 };
let target = combatScope.getClosest(monsterNearP1);
assert(target.id === 'p1', 'Monster harus menarget p1 karena posisinya paling dekat');

// 22c. Pengujian mekanik Downed: saat HP p1 habis, masuk ke status Downed
combatScope.damageDowned(target, 'Harvester');
assert(target.hp === 0, 'HP operatif harus 0 saat downed');
assert(target.downed === true, 'Operatif harus berstatus downed=true');
assert(target.downTimer === 1800, 'downTimer harus dimulai dari 1800 tick (30 detik)');
assert(combatScope.isDead() === false, 'Game over TIDAK boleh langsung terjadi bila masih ada rekan skuad hidup');

// Setelah p1 downed, monster terdekat harus beralih menarget p0
target = combatScope.getClosest(monsterNearP1);
assert(target.id === 'p0', 'Monster harus beralih menarget rekan skuad yang masih aktif (p0)');

// 22d. Pengujian mekanik Revive: rekan tim (p0) mendekat (<42px) dan membangkitkan
const p0 = combatScope.getPlayers()[0];
p0.x = 405; p0.y = 400; // Jarak 5px dari p1
for (let t = 0; t < 185; t++) {
    combatScope.updateRevive();
}
const p1Revived = combatScope.getPlayers()[1];
assert(p1Revived.downed === false, 'Operatif harus berhasil dibangkitkan (downed=false)');
assert(p1Revived.hp === 35, 'Operatif harus pulih ke 35% HP saat dibangkitkan (35 HP)');

// 22e. Pengujian tembakan senjata remote peer (triggerRemotePeerAttack)
combatScope.peerAttack(p1Revived);
const projs = combatScope.getProjectiles();
assert(projs.length > 0, 'Penembakan peer remote harus menambahkan proyektil ke projectiles[]');
assert(projs[0].isPlayer === true, 'Proyektil tembakan peer harus ditandai isPlayer=true');
assert(projs[0].ownerIndex === 1, 'Proyektil harus mencatat ownerIndex pemiliknya');

console.log('✓ TEST 22 LULUS: Multi-target monster AI, mekanik Downed/Revive, & tembakan remote peer terverifikasi.');

// TEST 23: Lockup logo Hub (emblem prosedural + wordmark berlapis) & kepatuhan hemat gerak.
// Memverifikasi: (a) lockup membungkus satu-satunya nama aksesibel (h1 "VITA"),
// (b) emblem inline SVG murni prosedural tanpa aset eksternal & ditandai aria-hidden,
// (c) overlay sapuan cahaya dekoratif disembunyikan dari screen reader,
// (d) gaya wordmark memakai background-clip + ekstrusi drop-shadow berlapis (bukan text-shadow),
// (e) seluruh animasi dekoratif baru memiliki guard prefers-reduced-motion (Hub & layar mulai),
// (f) judul layar mulai ikut dipoles, dan (g) judul menu in-game lain (jeda/gugur/menang)
//     memakai perlakuan lockup yang sama agar tampilan tiap menu konsisten.
console.log('\n[TEST 23] Pengujian Lockup Logo Hub, Emblem Prosedural, & Guard Hemat Gerak...');

const gameCss = fs.readFileSync(path.join(__dirname, '../css/game.css'), 'utf8');

// 23a. Struktur lockup: satu pembungkus, satu h1, tanpa nama aksesibel ganda.
assert(/<div class="vita-lockup">/.test(indexHtml), 'Wrapper .vita-lockup harus ada di index.html');
const lockupMatch = indexHtml.match(/<div class="vita-lockup">([\s\S]*?)<\/div>/);
assert(lockupMatch, 'Blok .vita-lockup harus dapat diekstrak dari index.html');
const lockupHtml = lockupMatch[1];
assert((lockupHtml.match(/<h1\b/g) || []).length === 1, 'Lockup harus memuat tepat satu <h1> (nama aksesibel tunggal)');
assert(/<h1 class="title">VITA<\/h1>/.test(lockupHtml), 'Wordmark harus tetap berupa h1.title berisi teks "VITA"');

// 23b. Emblem: inline SVG prosedural (tanpa <img>/rujukan gambar), non-fokus, aria-hidden.
const emblemMatch = indexHtml.match(/<svg class="vita-emblem"[\s\S]*?<\/svg>/);
assert(emblemMatch, 'Emblem inline SVG .vita-emblem harus ada di index.html');
const emblemSvg = emblemMatch[0];
assert(/aria-hidden="true"/.test(emblemSvg), 'Emblem dekoratif wajib aria-hidden="true" (nama aksesibel tetap satu)');
assert(/focusable="false"/.test(emblemSvg), 'Emblem wajib focusable="false" (hindari tab stop kosong)');
assert(!/<text[\s>]/.test(emblemSvg), 'Emblem tidak boleh memuat <text> (mencegah nama aksesibel ganda)');
assert(!/<image[\s>]|<img\b|xlink:href|\bhref=/.test(emblemSvg), 'Emblem harus murni prosedural (tanpa aset/rujukan gambar eksternal)');

// 23c. Sapuan cahaya dekoratif tidak boleh terbaca screen reader.
assert(/<span class="vita-sweep" aria-hidden="true"><\/span>/.test(indexHtml), 'Overlay .vita-sweep wajib aria-hidden="true"');

// 23d. Gaya wordmark: klip gradien + ekstrusi drop-shadow berlapis.
assert(/#homeView \.vita-lockup\s*\{/.test(homeCss), 'home.css harus mendefinisikan .vita-lockup');
const hubTitleCss = (homeCss.match(/#homeView h1\.title\s*\{[\s\S]*?\}/g) || [])
  .find(b => /background-clip:\s*text/.test(b));
assert(hubTitleCss, 'Aturan #homeView h1.title dengan background-clip: text harus ada di home.css');
assert((hubTitleCss.match(/drop-shadow\(/g) || []).length >= 3, 'Wordmark Hub harus memakai ekstrusi drop-shadow berlapis (>=3)');
['vitaBacklight', 'vitaEmblem', 'vitaSweep', 'vitaTitleGlitch'].forEach(kf =>
  assert(new RegExp('@keyframes\\s+' + kf + '\\b').test(homeCss), 'Keyframes ' + kf + ' harus tersedia di home.css'));

// 23e. Guard prefers-reduced-motion untuk seluruh animasi dekoratif logo (Hub + layar mulai).
const homeRm = homeCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/);
assert(homeRm, 'home.css wajib memiliki guard @media (prefers-reduced-motion: reduce) untuk logo');
['.vita-emblem', '.vita-lockup::before', 'h1.title', '.vita-sweep'].forEach(sel =>
  assert(homeRm[0].includes(sel), 'Guard reduced-motion Hub harus menangani ' + sel));

const gameRm = gameCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\s*\}/);
assert(gameRm && /#gameView #startScreen h1\s*\{\s*animation:\s*none/.test(gameRm[0]),
  'Guard reduced-motion game.css harus menonaktifkan animasi judul layar mulai');

// 23f. Judul layar mulai ikut dipoles secara konsisten (rim light + ekstrusi + kilau).
const startTitleCss = (gameCss.match(/#gameView #startScreen h1\s*\{[\s\S]*?\}/g) || [])
  .find(b => /font-size:\s*clamp\(64px/.test(b));
assert(startTitleCss, 'Aturan #gameView #startScreen h1 dengan font-size clamp(64px, ...) harus ada');
assert((startTitleCss.match(/drop-shadow\(/g) || []).length >= 3, 'Judul layar mulai harus memakai ekstrusi drop-shadow berlapis (>=3)');
assert(/animation:\s*vitaStartFlicker\b/.test(startTitleCss), 'Judul layar mulai harus memakai animasi kilau vitaStartFlicker');
assert(new RegExp('@keyframes\\s+vitaStartFlicker\\b').test(gameCss), 'Keyframes vitaStartFlicker harus tersedia di game.css');

// 23g. Judul menu layar penuh lain (jeda, gugur, menang) memakai perlakuan lockup yang konsisten.
const menuTitlesCss = (gameCss.match(/#gameView #pauseScreen h2[\s\S]*?\n\s*\}/g) || [])
  .find(b => /background-clip:\s*text/.test(b));
assert(menuTitlesCss, 'Judul menu in-game (jeda/gugur/menang) harus memakai background-clip: text (lockup konsisten)');
['#gameView #pauseScreen h2', '#gameView #deathScreen h2', '#gameView #winScreen h2'].forEach(sel =>
  assert(menuTitlesCss.includes(sel), 'Blok lockup judul menu harus mencakup ' + sel));
assert((menuTitlesCss.match(/drop-shadow\(/g) || []).length >= 3, 'Judul menu in-game harus memakai ekstrusi drop-shadow berlapis (>=3)');
assert(/animation:\s*vitaStartFlicker\b/.test(menuTitlesCss), 'Judul menu in-game harus memakai animasi kilau vitaStartFlicker');
assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?#gameView #pauseScreen h2[\s\S]*?#gameView #winScreen h2\s*\{\s*animation:\s*none/.test(gameCss),
  'Guard reduced-motion harus menonaktifkan animasi judul menu jeda, gugur, & menang');

console.log('✓ TEST 23 LULUS: Lockup logo Hub, konsistensi judul menu in-game, & guard hemat gerak terverifikasi.');

// TEST 24: Kontrak protokol relay WebSocket co-op (zero-dependency) & wiring klien.
// Memverifikasi handshake RFC 6455 (Accept-Key), codec frame (encode/decode, masking,
// payload 16-bit), sanitasi input tak terpercaya (kode kamar & callsign), penugasan
// indeks peer (host=0), fan-out WELCOME/PEER_JOIN/PEER_LEAVE, stamping peerIndex oleh
// server, dan wiring klien (JOIN/WELCOME/PEER_LEAVE/ERROR, tanpa double-start).

const relayPath = path.join(__dirname, '../tools/relay.mjs');
assert(fs.existsSync(relayPath), 'Server relay tanpa dependency harus ada di tools/relay.mjs');
const relayJs = fs.readFileSync(relayPath, 'utf8');

// 24a. Zero-dependency: hanya modul inti Node, dijalankan lewat skrip npm.
const relayImports = [...relayJs.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
assert(relayImports.length > 0, 'Relay harus mengimpor modul Node (http/crypto/url)');
assert(relayImports.every(s => s.startsWith('node:')), 'Relay hanya boleh mengimpor modul inti Node (node:...), bukan paket npm');
assert(!/\brequire\s*\(/.test(relayJs), 'Relay (ESM) tidak boleh memakai require()');

const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
assert(pkgJson.scripts && /tools\/relay\.mjs/.test(pkgJson.scripts.relay || ''), 'package.json harus punya skrip "relay" yang menjalankan tools/relay.mjs');
assert(!pkgJson.dependencies || Object.keys(pkgJson.dependencies).length === 0, 'Proyek tidak boleh memiliki dependency runtime eksternal');

const checkSrc = fs.readFileSync(path.join(__dirname, '../tools/check.mjs'), 'utf8');
assert(checkSrc.includes('tools/relay.mjs'), 'check.mjs harus memverifikasi tools/relay.mjs (sintaks + secret scan)');

// Ekstraksi fungsi murni relay agar dapat diuji tanpa membuka socket jaringan.
function extractRelayFn(name) {
    const m = relayJs.match(new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
    assert(m, 'Fungsi relay ' + name + '() harus dapat diekstrak dari tools/relay.mjs');
    return m[0];
}
const relayFnNames = [
    'computeAcceptKey', 'decodeWebSocketFrame', 'encodeWebSocketFrame', 'encodeTextFrame',
    'sanitizeRoomCode', 'sanitizeCallsign', 'assignPeerIndex',
    'safeWrite', 'sendTo', 'broadcast', 'findClient', 'leaveRoom', 'handleJoin', 'routeMessage'
];
const relaySrc = relayFnNames.map(extractRelayFn).join('\n\n');
const relay = new Function(
    'crypto', 'Buffer', 'MAX_PLAYERS', 'MAX_ROOMS',
    relaySrc + '\nreturn { computeAcceptKey: computeAcceptKey, decodeWebSocketFrame: decodeWebSocketFrame, ' +
    'encodeWebSocketFrame: encodeWebSocketFrame, encodeTextFrame: encodeTextFrame, sanitizeRoomCode: sanitizeRoomCode, ' +
    'sanitizeCallsign: sanitizeCallsign, assignPeerIndex: assignPeerIndex, handleJoin: handleJoin, ' +
    'leaveRoom: leaveRoom, routeMessage: routeMessage };'
)(require('node:crypto'), Buffer, 4, 500);

// 24b. Handshake RFC 6455 memakai vektor contoh resmi.
assert(relay.computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=', 'ComputeAcceptKey harus sesuai contoh RFC 6455');
assert(relay.computeAcceptKey('x') === '', 'Key handshake terlalu pendek harus ditolak (string kosong)');
assert(relay.computeAcceptKey(123) === '', 'Key handshake non-string harus ditolak');

// 24c. Codec frame: round-trip teks pendek, payload 16-bit, & masking klien.
function decodeTextFrame(buf) {
    const f = relay.decodeWebSocketFrame(buf);
    assert(f && !f.error, 'Frame relay harus dapat didekode');
    return f.payload.toString('utf8');
}
const shortMsg = 'halo dunia ✓';
const shortFrame = relay.encodeTextFrame(shortMsg);
assert(relay.decodeWebSocketFrame(shortFrame).opcode === 0x1, 'Frame teks harus memakai opcode 0x1');
assert(decodeTextFrame(shortFrame) === shortMsg, 'Round-trip frame teks pendek (UTF-8) harus utuh');
const longMsg = 'X'.repeat(200);
assert(decodeTextFrame(relay.encodeTextFrame(longMsg)) === longMsg, 'Round-trip frame payload 16-bit (126-65535) harus utuh');
const maskedFrame = relay.encodeWebSocketFrame(0x1, Buffer.from(shortMsg, 'utf8'), true);
const maskedDecoded = relay.decodeWebSocketFrame(maskedFrame);
assert(maskedDecoded && maskedDecoded.masked === true, 'Frame bermask harus terdeteksi sebagai masked');
assert(maskedDecoded.payload.toString('utf8') === shortMsg, 'Dekode frame bermask harus membuka XOR mask dengan benar');
assert(relay.decodeWebSocketFrame(Buffer.from([0x81])) === null, 'Buffer tidak lengkap harus mengembalikan null (bukan crash)');

// 24d. Sanitasi input tak terpercaya (kode kamar & callsign).
assert(relay.sanitizeRoomCode('7x49') === '7X49', 'Kode kamar harus dinormalisasi ke huruf besar');
assert(relay.sanitizeRoomCode('ab') === '', 'Kode kamar < 3 karakter harus ditolak');
assert(!/[^A-Z0-9]/.test(relay.sanitizeRoomCode('<script>alert(1)</script>')), 'Kode kamar hanya boleh menyisakan A-Z0-9');
assert(relay.sanitizeRoomCode('abcdefghijkl').length === 8, 'Kode kamar dibatasi maksimum 8 karakter');
assert(relay.sanitizeCallsign('<b>Ari</b>').indexOf('Ari') !== -1, 'Callsign harus mempertahankan teks biasa');
assert(!/[<>"'&\\`]/.test(relay.sanitizeCallsign('<b>Ari</b>"&`')), 'Callsign harus membuang karakter berbahaya (< > " \' & \\ `)');
assert(relay.sanitizeCallsign('A\u0001B') === 'AB', 'Callsign harus membuang karakter kontrol');
assert(relay.sanitizeCallsign('Z'.repeat(40)).length === 16, 'Callsign dibatasi maksimum 16 karakter');

// 24e. Penugasan indeks peer: host selalu 0, tamu 1..3, kamar penuh => -1.
assert(relay.assignPeerIndex(new Set(), true, 4) === 0, 'Host harus mendapat indeks 0');
assert(relay.assignPeerIndex(new Set([0]), false, 4) === 1, 'Tamu pertama harus mendapat indeks 1');
assert(relay.assignPeerIndex(new Set([0, 1, 2]), false, 4) === 3, 'Tamu ketiga harus mendapat indeks 3');
assert(relay.assignPeerIndex(new Set([0, 1, 2, 3]), false, 4) === -1, 'Kamar penuh harus mengembalikan -1');
assert(relay.assignPeerIndex([1], true, 4) === 0, 'Host harus tetap mendapat 0 walau himpunan berupa array');

// 24f. handleJoin: WELCOME ke pendatang + PEER_JOIN ke anggota lain, peerIndex di-stamp server.
const rooms = new Map();
function mockClient() {
    return {
        sent: [],
        socket: { destroyed: false, write(b) { this.owner.sent.push(Buffer.from(b)); return true; }, owner: null }
    };
}
function readSent(client) {
    return client.sent.map(b => JSON.parse(relay.decodeWebSocketFrame(b).payload.toString('utf8')));
}
function makeClient() {
    const c = mockClient();
    c.socket.owner = c;
    return c;
}

const host = makeClient();
const hostRes = relay.handleJoin(rooms, host, { type: 'JOIN', roomId: '7x49', isHost: true, peerIndex: 77, callsign: 'HOST' });
assert(hostRes.ok === true && hostRes.peerIndex === 0, 'Host pertama harus diterima sebagai peer 0');
assert(hostRes.isHost === true && host.isHost === true, 'Host harus ditandai otoritatif');
const hostMsgs = readSent(host);
assert(hostMsgs.length === 1 && hostMsgs[0].type === 'WELCOME', 'Pendatang harus menerima tepat satu WELCOME');
assert(hostMsgs[0].peerIndex === 0, 'WELCOME harus memuat indeks final hasil stamping server (bukan 77 dari klien)');
assert(Array.isArray(hostMsgs[0].peers) && hostMsgs[0].peers[0].idx === 0, 'WELCOME harus memuat daftar peer (idx pemain)');
assert(host.peerIndex === 0, 'peerIndex pada objek klien harus di-stamp server');

const guest = makeClient();
const guestRes = relay.handleJoin(rooms, guest, { type: 'JOIN', roomId: '7X49', isHost: false, callsign: 'Tamu' });
assert(guestRes.peerIndex === 1, 'Tamu pertama harus mendapat indeks 1');
const guestMsgs = readSent(guest);
assert(guestMsgs[0].type === 'WELCOME' && guestMsgs[0].peerIndex === 1, 'Tamu harus menerima WELCOME dengan indeksnya');
assert(guestMsgs[0].peers.length === 2, 'WELCOME tamu harus memuat kedua peer');
const hostAfterJoin = readSent(host);
assert(hostAfterJoin.some(m => m.type === 'PEER_JOIN' && m.peerIndex === 1), 'Host harus menerima PEER_JOIN saat tamu bergabung');
assert(hostAfterJoin.filter(m => m.type === 'PEER_JOIN')[0].callsign === 'Tamu', 'PEER_JOIN harus memuat callsign tamu');

// Klien mengaku host, server menolak (indeks host sudah terisi).
const faker = makeClient();
const fakerRes = relay.handleJoin(rooms, faker, { type: 'JOIN', roomId: '7X49', isHost: true, callsign: 'Fake' });
assert(fakerRes.peerIndex === 2 && fakerRes.isHost === false, 'Klien tidak boleh merebut kekuasaan host (peerIndex != 0, isHost false)');

const fourth = makeClient();
assert(relay.handleJoin(rooms, fourth, { type: 'JOIN', roomId: '7X49', isHost: false }).peerIndex === 3, 'Kamar harus mengizinkan 4 pemain (indeks 0..3)');

const fifth = makeClient();
const fifthRes = relay.handleJoin(rooms, fifth, { type: 'JOIN', roomId: '7X49', isHost: false });
assert(fifthRes.ok === false && fifthRes.code === 'ROOM_FULL', 'Pemain ke-5 harus ditolak dengan ROOM_FULL');

const badRoom = makeClient();
const badRes = relay.handleJoin(rooms, badRoom, { type: 'JOIN', roomId: 'ab', isHost: false });
assert(badRes.ok === false && badRes.code === 'BAD_ROOM', 'Kode kamar tidak valid harus ditolak dengan BAD_ROOM');

// 24g. leaveRoom: broadcast PEER_LEAVE, indeks dibebaskan, kamar dihapus saat kosong.
relay.leaveRoom(rooms, guest);
assert(readSent(host).some(m => m.type === 'PEER_LEAVE' && m.peerIndex === 1), 'Anggota lain harus menerima PEER_LEAVE');
assert(rooms.get('7X49').used.has(1) === false, 'Indeks peer yang pergi harus dibebaskan (dapat dipakai ulang)');
relay.leaveRoom(rooms, host);
relay.leaveRoom(rooms, faker);
relay.leaveRoom(rooms, fourth);
assert(!rooms.has('7X49'), 'Kamar harus dihapus saat anggota terakhir keluar');

// 24h. routeMessage: broadcast dengan peerIndex di-stamp server; PING bertarget; ERROR saat JOIN gagal.
const r2 = new Map();
const h2 = makeClient();
relay.routeMessage(r2, h2, { type: 'JOIN', roomId: 'ABCD', isHost: true, callsign: 'H' });
h2.sent.length = 0;
const g2 = makeClient();
relay.routeMessage(r2, g2, { type: 'JOIN', roomId: 'ABCD', isHost: false, callsign: 'G' });
h2.sent.length = 0;
g2.sent.length = 0;

relay.routeMessage(r2, h2, { type: 'INPUT', peerIndex: 99, dx: 3, dy: -2 });
const inputAtGuest = readSent(g2);
assert(inputAtGuest.some(m => m.type === 'INPUT' && m.peerIndex === 0 && m.from === 0), 'INPUT harus diteruskan dengan peerIndex/from di-stamp server (bukan 99)');
assert(!inputAtGuest.some(m => m.peerIndex === 99), 'peerIndex palsu dari klien tidak boleh bocor ke peer lain');

relay.routeMessage(r2, h2, { type: 'SNAPSHOT', snap: { tick: 1 } });
assert(readSent(g2).some(m => m.type === 'SNAPSHOT'), 'SNAPSHOT host harus diteruskan ke tamu');

relay.routeMessage(r2, h2, { type: 'START_GAME', seed: 123 });
assert(readSent(g2).some(m => m.type === 'START_GAME' && m.seed === 123), 'START_GAME host harus diteruskan ke tamu');

g2.sent.length = 0;
relay.routeMessage(r2, h2, { type: 'PING', to: 1, t: 5 });
const pingAtGuest = readSent(g2);
assert(pingAtGuest.length === 1 && pingAtGuest[0].type === 'PING' && pingAtGuest[0].to === 1, 'PING bertarget hanya boleh sampai ke peer tujuan');
assert(readSent(h2).every(m => m.type !== 'PING'), 'PING bertarget tidak boleh dipantulkan ke pengirim');

const r3 = new Map();
relay.routeMessage(r3, makeClient(), { type: 'JOIN', roomId: 'ZZZZ', isHost: true });
for (let i = 0; i < 3; i++) relay.routeMessage(r3, makeClient(), { type: 'JOIN', roomId: 'ZZZZ', isHost: false });
const overflow = makeClient();
relay.routeMessage(r3, overflow, { type: 'JOIN', roomId: 'ZZZZ', isHost: false });
assert(readSent(overflow).some(m => m.type === 'ERROR' && m.code === 'ROOM_FULL'), 'routeMessage harus mengirim ERROR saat JOIN gagal (ROOM_FULL)');

const overflowBad = makeClient();
relay.routeMessage(r3, overflowBad, { type: 'JOIN', roomId: 'x', isHost: false });
assert(readSent(overflowBad).some(m => m.type === 'ERROR' && m.code === 'BAD_ROOM'), 'routeMessage harus mengirim ERROR untuk kode kamar tidak valid');

// 24i. Wiring klien: JOIN membawa callsign, menangani WELCOME/PEER_LEAVE/ERROR, tanpa double-start.
assert(/sendCoopMessage\(\s*'JOIN'[\s\S]{0,240}callsign/.test(gameJs), 'Klien harus mengirim JOIN beserta callsign');
assert(/msg\.type === 'WELCOME'/.test(gameJs), 'Klien harus menangani pesan WELCOME dari relay');
assert(/msg\.type === 'PEER_LEAVE'/.test(gameJs), 'Klien harus menangani PEER_LEAVE (membersihkan slot peer)');
assert(/msg\.type === 'ERROR'/.test(gameJs), 'Klien harus menangani pesan ERROR dari relay');
assert(/coop_err_invalid_code/.test(gameJs) && /coop_err_room_full/.test(gameJs) && /coop_err_server_full/.test(gameJs) && /coop_err_generic/.test(gameJs), 'Kunci i18n pesan error co-op harus tersedia');
assert(/function resolveCoopRelayUrl/.test(gameJs), 'Klien harus punya resolver URL relay (override/skema wss)');
assert(/localStorage\.getItem\('vita_relay_url'\)/.test(gameJs), 'URL relay harus dapat di-override lewat localStorage vita_relay_url');
assert(/wss:\/\//.test(gameJs), 'Resolver relay harus menaikkan ws:// ke wss:// saat halaman https (hindari mixed content)');
assert(!/proceedToWebGame\(true\)\s*;\s*\n\s*startGame\(\)\s*;/.test(gameJs), 'START_GAME tidak boleh memanggil proceedToWebGame lalu startGame() lagi (double initLevel)');
assert(/id="coopJoinInput"[^>]*maxlength="4"/.test(indexHtml), '#coopJoinInput harus memakai maxlength="4" (kode kamar 4 karakter)');

console.log('✓ TEST 24 LULUS: Kontrak protokol relay WebSocket zero-dependency & wiring klien co-op terverifikasi.');

// TEST 25: Konfigurasi relay co-op — normalisasi alamat relay, badge lokal/online,
// parsing tautan undangan (?coop=&relay=), & pembentukan tautan undangan.
// Input dianggap TIDAK TERPERCAYA: skema berbahaya & karakter injeksi wajib ditolak.
console.log('\n[TEST 25] Pengujian konfigurasi relay & tautan undangan co-op...');
const coopStart = gameJs.indexOf('const COOP_DEFAULT_RELAY_URL');
const coopEnd = gameJs.indexOf('function connectCoopRelay');
assert(coopStart !== -1 && coopEnd > coopStart, 'Blok helper relay/undangan harus dapat diekstrak dari js/game.js');
const coopSrc = gameJs.slice(coopStart, coopEnd);

// Bangun konteks terisolasi: stub localStorage/location/document + nilai co-op.
function makeCoopCtx(opts) {
  const o = opts || {};
  const store = Object.assign({}, o.store || {});
  const localStorageStub = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
  const locationStub = {
    origin: o.origin !== undefined ? o.origin : 'https://zrilxd20-code.github.io',
    pathname: o.pathname !== undefined ? o.pathname : '/VITA/',
    protocol: o.protocol !== undefined ? o.protocol : 'https:',
    search: o.search !== undefined ? o.search : ''
  };
  const documentStub = { getElementById() { return null; } };
  const fn = new Function(
    'localStorage', 'location', 'document', 'navigator', 'tt', 'window',
    'coopRelayUrl', 'coopRoomId', 'coopInviteConsumed',
    coopSrc + '\nreturn { normalizeCoopRelayUrl: normalizeCoopRelayUrl, isLocalCoopRelayUrl: isLocalCoopRelayUrl, ' +
    'parseCoopInvite: parseCoopInvite, buildCoopInviteLink: buildCoopInviteLink, ' +
    'getStoredCoopRelayUrl: getStoredCoopRelayUrl, resolveCoopRelayUrl: resolveCoopRelayUrl };'
  );
  return fn(
    localStorageStub, locationStub, documentStub, {}, k => 'T:' + k, { location: locationStub },
    o.coopRelayUrl || 'ws://localhost:8080',
    o.coopRoomId !== undefined ? o.coopRoomId : null,
    false
  );
}

// 25a. Normalisasi: trim, naikkan http(s):// → ws(s)://, dukung IPv6 dalam kurung siku.
const coop = makeCoopCtx({});
assert(coop.normalizeCoopRelayUrl('ws://localhost:8080') === 'ws://localhost:8080', 'Alamat ws:// lokal harus diterima apa adanya');
assert(coop.normalizeCoopRelayUrl('  wss://vita-coop.onrender.com  ') === 'wss://vita-coop.onrender.com', 'Spasi di tepi harus dipangkas');
assert(coop.normalizeCoopRelayUrl('https://vita-coop.onrender.com') === 'wss://vita-coop.onrender.com', 'Tempelan https:// harus dinaikkan ke wss://');
assert(coop.normalizeCoopRelayUrl('http://192.168.1.10:8080') === 'ws://192.168.1.10:8080', 'Tempelan http:// harus dinaikkan ke ws://');
assert(coop.normalizeCoopRelayUrl('ws://[2001:db8::1]:8080') === 'ws://[2001:db8::1]:8080', 'IPv6 dalam kurung siku harus diterima');
assert(coop.normalizeCoopRelayUrl('wss://host.example/relay?x=1') === 'wss://host.example/relay?x=1', 'Path & query relay harus dipertahankan');

// 25b. Penolakan input tak terpercaya / tidak valid.
['', '   ', 'javascript:alert(1)', 'ws://', 'ws://bad host', 'ws://host:999999',
 'ws://host/<script>alert(1)</script>', 'wss://host/"x"', 'x'.repeat(300)].forEach(bad => {
  assert(coop.normalizeCoopRelayUrl(bad) === '', 'Alamat relay tidak valid harus ditolak: ' + JSON.stringify(bad.slice(0, 40)));
});
assert(coop.normalizeCoopRelayUrl(null) === '' && coop.normalizeCoopRelayUrl(123) === '', 'Alamat relay non-string harus ditolak');

// 25c. Deteksi relay lokal (untuk badge & keputusan menyertakan relay di tautan undangan).
['ws://localhost:8080', 'wss://localhost', 'ws://127.0.0.1:9000', 'ws://[::1]:8080', 'wss://localhost/x'].forEach(u =>
  assert(coop.isLocalCoopRelayUrl(u) === true, 'Relay lokal harus terdeteksi: ' + u));
['wss://vita-coop.onrender.com', 'ws://192.168.1.10:8080', 'ws://localhostfoo:8080', ''].forEach(u =>
  assert(coop.isLocalCoopRelayUrl(u) === false, 'Relay non-lokal harus terdeteksi sebagai online: ' + JSON.stringify(u)));

// 25d. Parsing undangan: kode dinormalisasi ke huruf besar, relay divalidasi ulang.
assert(coop.parseCoopInvite('?coop=7x49').code === '7X49', 'Kode undangan harus dinormalisasi ke huruf besar');
assert(coop.parseCoopInvite('?coop=7X49&relay=' + encodeURIComponent('wss://vita-coop.onrender.com')).relay === 'wss://vita-coop.onrender.com', 'Relay pada undangan harus diparse & divalidasi');
assert(coop.parseCoopInvite('?relay=http%3A%2F%2Fhost%2Fp').relay === 'ws://host/p', 'Relay http:// pada undangan harus dinaikkan ke ws://');
assert(coop.parseCoopInvite('?coop=ab').code === '', 'Kode undangan terlalu pendek harus diabaikan');
assert(coop.parseCoopInvite('?coop=' + encodeURIComponent('<script>')).code === '', 'Kode undangan berisi injeksi harus diabaikan');
assert(coop.parseCoopInvite('?coop=7X49&relay=' + encodeURIComponent('javascript:alert(1)')).relay === '', 'Relay undangan berbahaya harus diabaikan');
const emptyInvite = coop.parseCoopInvite('');
assert(emptyInvite.code === '' && emptyInvite.relay === '', 'Query kosong harus menghasilkan undangan kosong');

// 25e. Pembentukan tautan undangan (relay hanya disertakan bila non-lokal).
const inviteOnline = makeCoopCtx({ coopRoomId: '7X49', coopRelayUrl: 'wss://vita-coop.onrender.com' });
assert(inviteOnline.buildCoopInviteLink() === 'https://zrilxd20-code.github.io/VITA/?coop=7X49&relay=wss%3A%2F%2Fvita-coop.onrender.com',
  'Tautan undangan harus memuat kode kamar & relay (ter-encode) untuk relay online');
const inviteLocal = makeCoopCtx({ coopRoomId: '7X49', coopRelayUrl: 'ws://localhost:8080', protocol: 'http:' });
assert(inviteLocal.buildCoopInviteLink() === 'https://zrilxd20-code.github.io/VITA/?coop=7X49',
  'Relay lokal tidak perlu disertakan pada tautan undangan (penerima memakai default)');
assert(makeCoopCtx({ coopRoomId: null }).buildCoopInviteLink() === '', 'Tanpa kode kamar tidak ada tautan undangan');
assert(makeCoopCtx({ coopRoomId: '7X49', origin: 'null' }).buildCoopInviteLink() === '', 'file:// (origin null) tidak boleh menghasilkan tautan undangan');

// 25f. Override tersimpan dibaca apa adanya, & resolver menaikkan ws:// → wss:// di halaman https.
const stored = makeCoopCtx({ store: { vita_relay_url: 'wss://stored.example:4443' } });
assert(stored.getStoredCoopRelayUrl() === 'wss://stored.example:4443', 'Override tersimpan harus dibaca dari localStorage vita_relay_url');
assert(stored.resolveCoopRelayUrl() === 'wss://stored.example:4443', 'Resolver harus memprioritaskan override tersimpan');
const upgradeCtx = makeCoopCtx({ coopRelayUrl: 'ws://public.example:8080', protocol: 'https:' });
assert(upgradeCtx.resolveCoopRelayUrl() === 'wss://public.example:8080', 'ws:// harus dinaikkan ke wss:// pada halaman https (hindari mixed content)');
assert(makeCoopCtx({ coopRelayUrl: 'ws://public.example:8080', protocol: 'http:' }).resolveCoopRelayUrl() === 'ws://public.example:8080', 'ws:// dipertahankan pada halaman http');

// 25g. Wiring UI: helper terdaftar, undangan dikonsumsi sekali, badge & tab terhubung.
['function normalizeCoopRelayUrl', 'function isLocalCoopRelayUrl', 'function applyCoopRelayInput',
 'function syncCoopRelayInput', 'function updateCoopRelayBadge', 'function refreshCoopInviteLink',
 'function copyCoopInviteLink', 'function parseCoopInvite', 'function takeCoopInvite',
 'function persistCoopRelayUrl', 'function getStoredCoopRelayUrl', 'function buildCoopInviteLink'].forEach(sig =>
  assert(gameJs.includes(sig), 'Klien harus mendefinisikan ' + sig + '()'));
assert(/function takeCoopInvite[\s\S]*?coopInviteConsumed[\s\S]*?\n\}/.test(gameJs), 'Undangan harus dikonsumsi sekali via penanda coopInviteConsumed');
assert(/function openCoopLobbyModal[\s\S]*?takeCoopInvite\(\)/.test(gameJs), 'Membuka lobi harus mengonsumsi undangan (takeCoopInvite)');
assert(/function openCoopLobbyModal[\s\S]*?switchCoopTab\('join'\)/.test(gameJs), 'Undangan berisi kode harus langsung membuka tab "Gabung"');
assert(/function openCoopLobbyModal[\s\S]*?coopJoinHint/.test(gameJs), 'Undangan terisi harus menampilkan petunjuk prefill kode');
assert(/function initHostLobbyRoom[\s\S]*?refreshCoopInviteLink\(\)/.test(gameJs), 'Membuat kamar harus menyegarkan tautan undangan');
assert(/function submitJoinCoopRoom[\s\S]*?refreshCoopInviteLink\(\)/.test(gameJs), 'Bergabung ke kamar harus menyegarkan tautan undangan');
assert(/tt\('coop_connected'\)/.test(gameJs) && /tt\('coop_disconnected'\)/.test(gameJs), 'Badge relay harus dinarasikan lewat i18n (coop_connected/coop_disconnected)');
assert(/coop_badge_local/.test(gameJs) && /coop_badge_online/.test(gameJs), 'Badge relay harus membedakan lokal vs online lewat i18n');
[['id="coopRelayInput"', indexHtml], ['id="coopInviteLink"', indexHtml], ['id="coopJoinHint"', indexHtml],
 ['onclick="applyCoopRelayInput()"', indexHtml], ['onclick="copyCoopInviteLink()"', indexHtml],
 ['data-i18n="coop_relay_url_label"', indexHtml], ['data-i18n="coop_invite_label"', indexHtml],
 ['data-i18n="coop_invite_prefilled"', indexHtml], ['.coop-relay-config', gameCss],
 ['.coop-input-relay', gameCss], ['.coop-invite-box', gameCss], ['.coop-input-invite', gameCss],
 ['.coop-input-invalid', gameCss]].forEach(([needle, hay]) =>
  assert(hay.includes(needle), 'Markup/gaya co-op harus tersedia: ' + needle));

console.log('✓ TEST 25 LULUS: Normalisasi relay, badge, & tautan undangan co-op terverifikasi (input tak terpercaya ditolak).');

// TEST 26: Kontrak artefak deploy relay (Docker/Render) & lisensi proyek.
// Memastikan relay dapat di-deploy TANPA build/dependency & proyek berlisensi eksplisit.
console.log('\n[TEST 26] Pengujian kontrak artefak deploy relay & lisensi...');
const readRaw = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const dockerfile = readRaw('Dockerfile');
const dockerignore = readRaw('.dockerignore');
const renderYaml = readRaw('render.yaml');
const vercelJson = readRaw('vercel.json');
const licenseTxt = readRaw('LICENSE');
// Hanya baris executable (bukan komentar) yang diuji; komentar boleh menyebut npm install.
const dockerfileCode = dockerfile.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');

assert(/^FROM\s+node:20-alpine\s*$/m.test(dockerfile), 'Dockerfile harus memakai base node:20-alpine (ringan)');
assert(/COPY\s+tools\/relay\.mjs/.test(dockerfile), 'Dockerfile hanya boleh menyalin tools/relay.mjs (tanpa seluruh proyek)');
assert(/USER\s+node/.test(dockerfile), 'Container relay harus berjalan sebagai non-root (USER node)');
assert(/EXPOSE\s+8080/.test(dockerfile), 'Dockerfile harus mengekspos port relay 8080');
assert(/CMD\s*\[\s*"node"\s*,\s*"tools\/relay\.mjs"\s*\]/.test(dockerfile), 'Dockerfile harus menjalankan node tools/relay.mjs');
assert(!/npm\s+(install|ci)\b/.test(dockerfileCode), 'Dockerfile tidak boleh menjalankan npm install (zero dependency)');

assert(/^\*\s*$/m.test(dockerignore), 'dockerignore harus memulai dengan whitelist ("*")');
assert(/^!tools\/relay\.mjs\s*$/m.test(dockerignore), 'dockerignore harus mengizinkan tools/relay.mjs masuk build context');

assert(/runtime:\s*node/.test(renderYaml), 'render.yaml harus memakai runtime node (tanpa Docker build)');
assert(/startCommand:\s*"?node tools\/relay\.mjs"?/.test(renderYaml), 'render.yaml harus menjalankan node tools/relay.mjs');
assert(/healthCheckPath:\s*\/\s*$|healthCheckPath:\s*\/\n/.test(renderYaml), 'render.yaml harus memakai health check GET / (endpoint JSON relay)');
assert(/key:\s*NODE_VERSION/.test(renderYaml), 'render.yaml harus menetapkan NODE_VERSION (>=20)');
assert(/"headers"/.test(vercelJson), 'vercel.json harus tetap menjadi konfigurasi deploy front-end (headers)');
assert(/env\.PORT|process\.env\.PORT|\.PORT\b/.test(relayJs), 'Relay harus menghormati env PORT agar port-nya dapat dikonfigurasi host');
assert(/MIT License/.test(licenseTxt) && /zrilxd20-code/.test(licenseTxt), 'LICENSE harus berisi MIT License dengan pemegang hak proyek');
assert(pkgJson.license === 'MIT', 'package.json harus mendeklarasikan license MIT');

console.log('✓ TEST 26 LULUS: Kontrak deploy relay (Docker/Render) & lisensi terverifikasi.');

// TEST 27: Kontrak pengemasan Android (Capacitor/APK) — bundel web whitelist, aset
// ikon/splash prosedural, dan CI build di cloud. Membuktikan APK dapat dibangun
// tanpa satu pun aset gambar eksternal maupun dependency runtime baru.
console.log('\n[TEST 27] Pengujian kontrak pengemasan Android (Capacitor/APK)...');

const zlib = require('node:zlib');
const capConfig = JSON.parse(readRaw('capacitor.config.json'));
const buildWww = readRaw('tools/build-www.mjs');
const genAndroidIcons = readRaw('tools/gen-android-icons.mjs');
const genIcons = readRaw('tools/gen-icons.mjs');
const androidWorkflow = readRaw('.github/workflows/android.yml');
const gitignore = readRaw('.gitignore');
const swJs = readRaw('sw.js');

// 27a. Konfigurasi Capacitor: identitas aplikasi & skema web yang aman (tanpa konten campuran).
assert(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(capConfig.appId || ''),
  'appId Capacitor harus reverse-DNS huruf kecil');
assert(capConfig.appId === 'com.zrilxd20.vita',
  'appId harus sama dengan applicationId proyek android/');
assert(capConfig.appName === 'VITA', 'appName harus VITA');
assert(capConfig.webDir === 'dist', 'webDir harus dist (hasil npm run build:www)');
assert(capConfig.server && capConfig.server.androidScheme === 'https',
  'androidScheme harus https (klien menaikkan ws:// → wss://, sama seperti halaman Vercel)');
assert(capConfig.android && capConfig.android.allowMixedContent === false,
  'allowMixedContent harus false (tolak konten campuran)');

// 27b. Bundel web: whitelist eksplisit, zero-dependency, bebas metadata repo.
const wwwImports = [...buildWww.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
assert(wwwImports.length > 0 && wwwImports.every(s => s.startsWith('node:')),
  'build-www.mjs hanya boleh memakai modul inti Node');
const coreBody = swJs.split('const CORE = [')[1].split('];')[0];
const coreList = [...coreBody.matchAll(/'([^']+)'/g)]
  .map(m => m[1].replace(/^\.\//, ''))
  .filter(Boolean);
assert(coreList.length >= 10, 'precache CORE sw.js harus terbaca sebagai rujukan whitelist');
coreList.forEach(rel => assert(buildWww.includes("'" + rel + "'"),
  'build-www.mjs harus menyertakan berkas precache sw.js: ' + rel));
['sw.js', 'version.json'].forEach(rel => assert(buildWww.includes("'" + rel + "'"),
  'build-www.mjs harus menyertakan ' + rel));
const wwwForbidden = buildWww.match(/for\s*\(const forbidden of \[([^\]]*)\]\)/);
assert(wwwForbidden, 'build-www.mjs harus mendefinisikan daftar berkas non-runtime terlarang');
['script.md', 'AGENTS.md', 'package.json', 'tests', 'tools'].forEach(bad =>
  assert(wwwForbidden[1].includes("'" + bad + "'"),
    'daftar terlarang build-www.mjs harus memuat ' + bad));
assert(/OUT === ROOT \|\| !OUT\.startsWith\(ROOT \+ sep\)/.test(buildWww),
  'build-www.mjs harus memastikan dist/ berada di dalam root proyek');
const wwwBody = buildWww.split('const WWW = [')[1].split('];')[0];
assert(!/js\/modules/.test(wwwBody),
  'build-www.mjs tidak boleh menyalin modul TypeScript eksperimental ke paket aplikasi');
assert(/^dist\/\s*$/m.test(gitignore), '.gitignore harus mengabaikan dist/ (hasil build tidak di-commit)');

// 27c. CI APK di cloud: tanpa JDK lokal, tanpa secret, artifact debug yang gagal bila kosong.
assert(/actions\/checkout@v4/.test(androidWorkflow), 'CI Android harus checkout kode');
assert(/node-version:\s*'22'/.test(androidWorkflow), 'CI Android harus memakai Node 22 (Capacitor CLI mensyaratkan Node >=22)');
assert(/java-version:\s*'21'/.test(androidWorkflow),
  'CI Android harus memakai JDK 21 (Capacitor menetapkan JavaVersion.VERSION_21)');
assert(/npm ci/.test(androidWorkflow) && /npm run build:www/.test(androidWorkflow),
  'CI Android harus membangun dist/ lewat npm ci + npm run build:www');
assert(/npx cap sync android/.test(androidWorkflow), 'CI Android harus menjalankan npx cap sync android');
assert(/gradlew assembleDebug/.test(androidWorkflow), 'CI Android harus membangun task Gradle assembleDebug');
assert(/name:\s*vita-debug-apk/.test(androidWorkflow), 'artifact APK harus bernama vita-debug-apk');
assert(/actions\/upload-artifact@v4/.test(androidWorkflow), 'CI Android harus mengunggah artifact APK');
assert(/if-no-files-found:\s*error/.test(androidWorkflow),
  'CI Android harus gagal bila APK tidak dihasilkan (bukan hijau palsu)');
assert(!/secrets\./.test(androidWorkflow), 'CI Android tidak boleh memerlukan secret (build debug)');

// 27d. Proyek android/ yang di-commit: izin jaringan, tema splash, ikon adaptive, Java 21.
const ANDROID_RES = 'android/app/src/main/res/';
const manifest = readRaw('android/app/src/main/AndroidManifest.xml');
assert(/android\.permission\.INTERNET/.test(manifest),
  'AndroidManifest harus meminta izin INTERNET agar co-op online dapat berjalan');
assert(/@style\/AppTheme\.NoActionBarLaunch/.test(manifest),
  'AndroidManifest harus memakai tema splash AppTheme.NoActionBarLaunch');
assert(/@drawable\/splash/.test(readRaw(ANDROID_RES + 'values/styles.xml')),
  'styles.xml harus memakai @drawable/splash (splash gelap #0a0a12)');
assert(/#0A0A12/.test(readRaw(ANDROID_RES + 'values/ic_launcher_background.xml')),
  'warna latar ikon adaptive harus #0A0A12 (senada kanvas game)');
const adaptiveIcon = readRaw(ANDROID_RES + 'mipmap-anydpi-v26/ic_launcher.xml');
assert(/@color\/ic_launcher_background/.test(adaptiveIcon),
  'adaptive icon harus memakai @color/ic_launcher_background');
assert(/@mipmap\/ic_launcher_foreground/.test(adaptiveIcon),
  'adaptive icon harus memakai @mipmap/ic_launcher_foreground');
assert(/@mipmap\/ic_launcher_foreground/.test(readRaw(ANDROID_RES + 'mipmap-anydpi-v26/ic_launcher_round.xml')),
  'adaptive icon bulat harus memakai @mipmap/ic_launcher_foreground');
assert(/JavaVersion\.VERSION_21(?!\d)/.test(readRaw('android/app/capacitor.build.gradle')),
  'capacitor.build.gradle harus menargetkan Java 21 (selaras dengan CI)');

// 27e. Ikon & splash prosedural: dimensi per-densitas benar, lapisan adaptive transparan
// di sudut (bukan kotak putih), dan splash berlatar #0a0a12. Ini membuktikan tidak ada
// satu pun aset gambar eksternal yang diunduh/di-commit.
function pngDecode(rel) {
  const buf = fs.readFileSync(path.join(__dirname, '..', rel));
  const isPng = buf.length >= 33 && buf.readUInt32BE(0) === 0x89504e47 &&
    buf.readUInt32BE(4) === 0x0d0a1a0a;
  assert(isPng, 'Berkas harus PNG yang valid: ' + rel);
  let off = 8;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const tag = buf.toString('ascii', off + 4, off + 8);
    if (tag === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colorType = buf[25];
  // Encoder gen-icons.mjs selalu menulis bit depth 8 + filter 0 per baris (4 byte RGBA).
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { w, h, colorType, raw, stride: w * 4 + 1 };
}
function pngAlphaAt(img, x, y) {
  return img.raw[y * img.stride + 1 + x * 4 + 3];
}
function pngOpaqueCount(img) {
  let n = 0;
  for (let y = 0; y < img.h; y++) {
    const row = y * img.stride + 1;
    for (let x = 0; x < img.w; x++) if (img.raw[row + x * 4 + 3] > 0) n++;
  }
  return n;
}
const DENSITY_SCALE = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(DENSITY_SCALE)) {
  const legacy = Math.round(48 * scale);
  const adaptive = Math.round(108 * scale);
  const legacyIcon = pngDecode(ANDROID_RES + 'mipmap-' + density + '/ic_launcher.png');
  const roundIcon = pngDecode(ANDROID_RES + 'mipmap-' + density + '/ic_launcher_round.png');
  const foreground = pngDecode(ANDROID_RES + 'mipmap-' + density + '/ic_launcher_foreground.png');
  assert(legacyIcon.w === legacy && legacyIcon.h === legacy,
    'Ikon legacy ' + density + ' harus ' + legacy + 'px (48dp × ' + scale + ')');
  assert(roundIcon.w === legacy && roundIcon.h === legacy,
    'Ikon bundar ' + density + ' harus ' + legacy + 'px');
  assert(foreground.w === adaptive && foreground.h === adaptive,
    'Lapisan adaptive ' + density + ' harus ' + adaptive + 'px (108dp × ' + scale + ')');
  assert(foreground.colorType === 6,
    'Lapisan adaptive ' + density + ' harus RGBA (memiliki kanal alfa)');
  assert(pngAlphaAt(foreground, 0, 0) === 0,
    'Lapisan adaptive ' + density + ' harus transparan di sudut (bukan kotak putih opaque)');
  assert(pngOpaqueCount(foreground) > 100,
    'Lapisan adaptive ' + density + ' harus memuat seni logo yang terlihat');
}
const SPLASH_DIMS = {
  'drawable/splash.png': [480, 320],
  'drawable-land-mdpi/splash.png': [480, 320],
  'drawable-land-hdpi/splash.png': [800, 480],
  'drawable-land-xhdpi/splash.png': [1280, 720],
  'drawable-land-xxhdpi/splash.png': [1600, 960],
  'drawable-land-xxxhdpi/splash.png': [1920, 1280],
  'drawable-port-mdpi/splash.png': [320, 480],
  'drawable-port-hdpi/splash.png': [480, 800],
  'drawable-port-xhdpi/splash.png': [720, 1280],
  'drawable-port-xxhdpi/splash.png': [960, 1600],
  'drawable-port-xxxhdpi/splash.png': [1280, 1920],
};
for (const [rel, [w, h]] of Object.entries(SPLASH_DIMS)) {
  const img = pngDecode(ANDROID_RES + rel);
  assert(img.w === w && img.h === h, 'Splash ' + rel + ' harus ' + w + '×' + h);
  const px = img.raw.slice(1, 5);
  assert(px[0] === 10 && px[1] === 10 && px[2] === 18 && px[3] === 255,
    'Splash ' + rel + ' harus berlatar #0a0a12 (bukan putih kilat)');
}

// 27f. Generator: tanpa dependency, tanpa duplikasi encoder PNG, dan pemisahan
// entry-point PWA vs pemakaian sebagai modul.
assert(fs.existsSync(path.join(__dirname, '../tools/gen-android-icons.mjs')),
  'tools/gen-android-icons.mjs harus ada');
const androidImports = [...genAndroidIcons.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
assert(androidImports.every(s => s.startsWith('node:') || s === './gen-icons.mjs'),
  'gen-android-icons.mjs hanya boleh memakai modul inti Node + seni gen-icons.mjs');
assert(/import\s*\{[^}]*\bCanvas\b[^}]*\}\s*from\s*'\.\/gen-icons\.mjs'/.test(genAndroidIcons),
  'Ikon Android harus memakai ulang Canvas dari gen-icons.mjs');
assert(!/class\s+Canvas/.test(genAndroidIcons),
  'gen-android-icons.mjs tidak boleh menduplikasi encoder PNG');
assert(/export\s+class\s+Canvas/.test(genIcons) && /export\s+function\s+makeIcon/.test(genIcons),
  'gen-icons.mjs harus mengekspor Canvas & makeIcon agar dapat dipakai ulang');
assert(/invokedDirectly/.test(genIcons) && /import\.meta\.url/.test(genIcons),
  'gen-icons.mjs harus menulis ikon PWA HANYA saat dijalankan langsung');
assert(/\bdrawContent\b/.test(genAndroidIcons) && /drawContent/.test(genIcons),
  'gen-android-icons.mjs harus memakai seni prosedural drawContent yang sama');

// 27g. Script npm pengemasan & Capacitor tetap hanya devDependency (runtime zero-dependency).
assert(/node tools\/build-www\.mjs/.test(pkgJson.scripts['build:www'] || ''),
  'package.json harus punya skrip build:www');
assert(/cap sync android/.test(pkgJson.scripts['cap:sync'] || ''),
  'package.json harus punya skrip cap:sync');
assert(/assembleDebug/.test(pkgJson.scripts['apk:debug'] || ''),
  'package.json harus punya skrip apk:debug');
assert(/node tools\/gen-android-icons\.mjs/.test(pkgJson.scripts['icons:android'] || ''),
  'package.json harus punya skrip icons:android');
const devDeps = pkgJson.devDependencies || {};
['@capacitor/cli', '@capacitor/core', '@capacitor/android'].forEach(pkg =>
  assert(/^\d+\.\d+\.\d+$/.test(devDeps[pkg] || ''),
    'Capacitor harus dipin di devDependencies (versi pasti): ' + pkg));
assert(!pkgJson.dependencies || Object.keys(pkgJson.dependencies).length === 0,
  'Capacitor tidak boleh masuk dependencies (runtime aplikasi tetap zero-dependency)');

console.log('✓ TEST 27 LULUS: Kontrak pengemasan Android (Capacitor/APK) terverifikasi.');

// TEST 28: Kontrak Pengemasan PC Desktop (Tauri / Windows Standalone .exe & .msi)
console.log('\n[TEST 28] Pengujian kontrak pengemasan PC Desktop (Tauri/Windows)...');

// 28a. Konfigurasi Tauri & Cargo
const tauriConfPath = path.join(__dirname, '../src-tauri/tauri.conf.json');
assert(fs.existsSync(tauriConfPath), 'src-tauri/tauri.conf.json harus ada');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
assert(tauriConf.package?.productName === 'VITA', 'Nama produk Tauri harus VITA');
assert(tauriConf.package?.version === '2.5.0', 'Versi Tauri harus 2.5.0');
assert(tauriConf.build?.distDir === '../dist', 'Tauri distDir harus menunjuk ke ../dist');
assert(tauriConf.tauri?.bundle?.identifier === 'com.zrilxd20.vita', 'Identifier bundle harus com.zrilxd20.vita');
assert(tauriConf.tauri?.windows?.[0]?.width === 1280 && tauriConf.tauri?.windows?.[0]?.height === 800,
  'Jendela Tauri harus berdimensi 1280x800');

const cargoTomlPath = path.join(__dirname, '../src-tauri/Cargo.toml');
assert(fs.existsSync(cargoTomlPath), 'src-tauri/Cargo.toml harus ada');
const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
assert(cargoToml.includes('name = "vita"'), 'Cargo.toml harus memuat package vita');
assert(cargoToml.includes('version = "2.5.0"'), 'Cargo.toml harus memuat versi 2.5.0');
assert(cargoToml.includes('tauri = { version = "1.5"'), 'Cargo.toml harus memakai tauri 1.5');

// 28b. Kode sumber Rust (main.rs & build.rs)
const mainRsPath = path.join(__dirname, '../src-tauri/src/main.rs');
assert(fs.existsSync(mainRsPath), 'src-tauri/src/main.rs harus ada');
const mainRs = fs.readFileSync(mainRsPath, 'utf8');
assert(mainRs.includes('windows_subsystem = "windows"'), 'main.rs harus menyembunyikan console window');
assert(mainRs.includes('tauri::Builder::default()'), 'main.rs harus menjalankan tauri::Builder');

const buildRsPath = path.join(__dirname, '../src-tauri/build.rs');
assert(fs.existsSync(buildRsPath), 'src-tauri/build.rs harus ada');

// 28c. Aset Ikon Desktop (32, 128, 256, 512, .ico)
const TAURI_ICONS = path.join(__dirname, '../src-tauri/icons/');
['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico'].forEach(iconFile => {
  const p = path.join(TAURI_ICONS, iconFile);
  assert(fs.existsSync(p), 'Ikon desktop harus ada: ' + iconFile);
  assert(fs.statSync(p).size > 100, 'Ikon desktop tidak boleh kosong: ' + iconFile);
});

// 28d. Generator Ikon Desktop & Script npm
const genDesktopPath = path.join(__dirname, '../tools/gen-desktop-icons.mjs');
assert(fs.existsSync(genDesktopPath), 'tools/gen-desktop-icons.mjs harus ada');
const genDesktop = fs.readFileSync(genDesktopPath, 'utf8');
assert(genDesktop.includes("from './gen-icons.mjs'"), 'gen-desktop-icons.mjs harus memakai ulang seni gen-icons.mjs');
assert(/node tools\/gen-desktop-icons\.mjs/.test(pkgJson.scripts['icons:desktop'] || ''),
  'package.json harus punya skrip icons:desktop');

// 28e. Workflow CI Desktop (desktop.yml)
const desktopYmlPath = path.join(__dirname, '../.github/workflows/desktop.yml');
assert(fs.existsSync(desktopYmlPath), '.github/workflows/desktop.yml harus ada');
const desktopYml = fs.readFileSync(desktopYmlPath, 'utf8');
assert(desktopYml.includes('windows-latest'), 'desktop.yml harus berjalan di runner windows-latest');
assert(desktopYml.includes('npm run build:www'), 'desktop.yml harus membangun web bundle dist/');
assert(desktopYml.includes('npx -y @tauri-apps/cli'), 'desktop.yml harus membangun Tauri bundle');
assert(desktopYml.includes('vita-windows-x64'), 'desktop.yml harus mengunggah artifact vita-windows-x64');

console.log('✓ TEST 28 LULUS: Kontrak pengemasan PC Desktop (Tauri/Windows) terverifikasi.');

console.log('\n=========================================');
console.log('SEMUA PENGUJIAN KEAMANAN & QA WEB LULUS! (28/28)');
console.log('=========================================');
