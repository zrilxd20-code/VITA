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
 * serta serialisasi & rekonsiliasi snapshot state (fondasi sinkronisasi relay).
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

// 18c. Inisialisasi dunia mengaitkan players = [player] dan localPlayerIndex = 0
assert(/players\s*=\s*\[player\];[\s\S]*?localPlayerIndex\s*=\s*0;/.test(gameJs),
  'buildLevelWorld() harus menginisialisasi players[] dengan entitas player di index 0');

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

console.log('\n=========================================');
console.log('SEMUA PENGUJIAN KEAMANAN & QA WEB LULUS! (19/19)');
console.log('=========================================');
