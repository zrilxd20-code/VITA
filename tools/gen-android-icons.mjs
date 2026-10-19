// VITA Android launcher icon & splash generator — pure Node.js stdlib, no dependencies.
// Memakai ulang seni prosedural dari tools/gen-icons.mjs (impor, bukan duplikasi) agar
// branding PWA dan APK identik tanpa menambah satu pun aset eksternal.
//
// Menulis ulang berkas di android/app/src/main/res:
//   mipmap-*/ic_launcher.png            → ikon legacy (sudut membulat, opaque #0a0a12)
//   mipmap-*/ic_launcher_round.png      → ikon legacy bulat penuh
//   mipmap-*/ic_launcher_foreground.png → lapisan adaptive (latar TRANSPARAN, safe zone 66dp)
//   drawable*/splash.png                → splash gelap #0a0a12 + logo (dimensi dipertahankan)
//   values/ic_launcher_background.xml   → warna latar adaptive disetel ke ICON_BG
//
// Run: npm run icons:android
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, drawContent, makeIcon } from './gen-icons.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ICON_BG = '#0A0A12';

// Densitas Android: ikon launcher 48dp, lapisan adaptive 108dp.
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];
// Safe zone adaptive icon = 66dp / 108dp. Seni menempati 62.5% kotak 512-unit,
// sehingga contentScale 0.9 menghasilkan cakupan ~56dp (aman dari mask bulat/squircle).
const ADAPTIVE_CONTENT_SCALE = 0.9;
const ROUND_CONTENT_SCALE = 0.94;

function pngSize(file) {
  const b = readFileSync(file);
  const sig = b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a;
  if (!sig) throw new Error('Bukan PNG yang valid: ' + file);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (!w || !h) throw new Error('Dimensi PNG tidak terbaca: ' + file);
  return { w, h };
}

// Lapisan foreground adaptive wajib transparan; warna latar disediakan @color/ic_launcher_background.
function adaptiveForeground(size) {
  const cv = new Canvas(size, size);
  cv.px.fill(0);
  const k = (size / 512) * ADAPTIVE_CONTENT_SCALE;
  const off = (size - 512 * k) / 2;
  drawContent(cv, k, off, off);
  return cv;
}

function legacyRound(size) {
  const cv = makeIcon(size, false, ROUND_CONTENT_SCALE);
  cv.roundCorners(Math.floor(size / 2));
  return cv;
}

function splashFrame(w, h) {
  const cv = new Canvas(w, h); // terisi ICON_BG (#0a0a12)
  const art = Math.min(w, h) * 0.5;
  const k = art / 512;
  drawContent(cv, k, (w - art) / 2, (h - art) / 2);
  return cv;
}

function listSplashes(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSplashes(full, out);
    else if (entry.name === 'splash.png') out.push(full);
  }
  return out;
}

function ensureBackgroundColor() {
  const file = join(RES, 'values', 'ic_launcher_background.xml');
  const src = readFileSync(file, 'utf8');
  const next = src.replace(
    /(<color\s+name="ic_launcher_background">\s*)(#[0-9A-Fa-f]{3,8})(\s*<\/color>)/,
    (m, head, _color, tail) => head + ICON_BG + tail
  );
  if (next === src) return false;
  writeFileSync(file, next);
  return true;
}

let written = 0;

for (const [density, scale] of DENSITIES) {
  const dir = join(RES, 'mipmap-' + density);
  const legacy = Math.round(48 * scale);
  const adaptive = Math.round(108 * scale);
  makeIcon(legacy, true, 1.0).save(join(dir, 'ic_launcher.png'));
  legacyRound(legacy).save(join(dir, 'ic_launcher_round.png'));
  adaptiveForeground(adaptive).save(join(dir, 'ic_launcher_foreground.png'));
  written += 3;
}

const splashes = listSplashes(RES).sort();
for (const file of splashes) {
  const { w, h } = pngSize(file);
  splashFrame(w, h).save(file);
  written++;
}

const bgChanged = ensureBackgroundColor();
console.log('OK: icons:android — ' + written + ' PNG + latar adaptive ' + ICON_BG +
  (bgChanged ? ' (diperbarui)' : ' (sudah sesuai)'));
