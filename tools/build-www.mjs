// VITA web bundle builder — pure Node.js stdlib, no dependencies.
// Menyalin HANYA berkas runtime ke dist/ sehingga pengemasan aplikasi
// (Capacitor/Android) tidak pernah menelan metadata repo: .git, tests/, tools/,
// js/modules/*.ts, script.md (kanon narasi), supabase_schema.sql, dsb.
// Daftar di bawah adalah WHITELIST eksplisit dan harus selaras dengan precache
// sw.js (CORE) ditambah sw.js + version.json itu sendiri.
// Run: npm run build:www
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'dist');

const WWW = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'version.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'screenshot-wide.png',
  'screenshot-narrow.png',
  'css/tokens.css',
  'css/home.css',
  'css/game.css',
  'js/supabase.js',
  'js/home.js',
  'js/prologue.js',
  'js/game.js',
];

// Pengaman: dist/ harus berada DI DALAM root proyek, tidak boleh menimpanya.
if (OUT === ROOT || !OUT.startsWith(ROOT + sep)) {
  console.error('FAIL: direktori keluaran dist/ tidak valid');
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const missing = [];
const ignored = [];
let totalBytes = 0;

for (const rel of WWW) {
  const src = join(ROOT, rel);
  try {
    const st = await stat(src);
    if (!st.isFile()) { missing.push(rel + ' (bukan berkas)'); continue; }
    const dest = join(OUT, rel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest);
    totalBytes += st.size;
  } catch {
    missing.push(rel);
  }
}

if (missing.length) {
  console.error('FAIL: berkas runtime hilang: ' + missing.join(', '));
  process.exit(1);
}

// Sanity: berkas non-runtime tidak boleh ikut terbawa.
for (const forbidden of ['script.md', 'AGENTS.md', 'package.json', 'tests', 'tools']) {
  try {
    await stat(join(OUT, forbidden));
    ignored.push(forbidden);
  } catch { /* tidak ada — benar */ }
}
if (ignored.length) {
  console.error('FAIL: berkas non-runtime bocor ke dist/: ' + ignored.join(', '));
  process.exit(1);
}

console.log(
  'OK: dist/ siap — ' + WWW.length + ' berkas runtime, ' +
  (totalBytes / 1024).toFixed(0) + ' KB (metadata repo tidak disertakan)'
);
