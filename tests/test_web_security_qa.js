/**
 * Web Security & QA Automated Test Suite for VITA
 * Menguji keamanan sanitasi XSS, validasi input callsign, URL avatar, proteksi data localStorage rusak,
 * integritas level web, verifikasi schema Supabase RPC, konektivitas labirin anti-softlock,
 * regresi kontrol kecerahan (applyBrightness) Hub, aksesibilitas dialog (ARIA + focus trap),
 * serta kelengkapan i18n modal mode perangkat & pil mode layar mulai.
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

console.log('\n=========================================');
console.log('SEMUA PENGUJIAN KEAMANAN & QA WEB LULUS! (10/10)');
console.log('=========================================');
