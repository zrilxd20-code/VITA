// Fetch latest built artifacts from GitHub Actions using local Git Credential Manager
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOWNLOADS_DIR = join(ROOT, 'downloads');

if (!existsSync(DOWNLOADS_DIR)) {
  mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// 1. Get token from Git Credential Manager
console.log('Mengambil kredensial GitHub dari Git Credential Manager...');
const credOut = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8'
});

const passMatch = credOut.match(/password=([^\r\n]+)/);
if (!passMatch) {
  throw new Error('Gagal mendapatkan token GitHub dari credential manager');
}
const token = passMatch[1].trim();

// 2. Query artifacts list
console.log('Memeriksa daftar artefak dari GitHub Actions...');
const headers = {
  'Authorization': `Bearer ${token}`,
  'User-Agent': 'VITA-Build-Fetcher',
  'Accept': 'application/vnd.github+json'
};

const resp = await fetch('https://api.github.com/repos/zrilxd20-code/VITA/actions/artifacts', { headers });
const data = await resp.json();

const artifacts = data.artifacts || [];
console.log(`Ditemukan ${artifacts.length} artefak di repository.`);

const latestApk = artifacts.find(a => a.name === 'vita-debug-apk');
const latestWin = artifacts.find(a => a.name === 'vita-windows-x64');

if (!latestApk) console.warn('Peringatan: Artefak APK belum ditemukan');
if (!latestWin) console.warn('Peringatan: Artefak Windows belum ditemukan');

async function downloadAndExtract(artifact, targetPrefix) {
  if (!artifact) return;
  console.log(`Mengunduh ${artifact.name} (ID: ${artifact.id}, Ukuran: ${(artifact.size_in_bytes / 1024 / 1024).toFixed(2)} MB)...`);
  const dlResp = await fetch(`https://api.github.com/repos/zrilxd20-code/VITA/actions/artifacts/${artifact.id}/zip`, { headers });
  if (!dlResp.ok) {
    throw new Error(`Gagal mengunduh artefak: ${dlResp.status} ${dlResp.statusText}`);
  }
  const buf = Buffer.from(await dlResp.arrayBuffer());
  const zipPath = join(DOWNLOADS_DIR, `${artifact.name}.zip`);
  writeFileSync(zipPath, buf);
  console.log(`Menyimpan zip ke ${zipPath}`);

  // Ekstrak via PowerShell Expand-Archive
  const extractDir = join(DOWNLOADS_DIR, targetPrefix);
  if (!existsSync(extractDir)) mkdirSync(extractDir, { recursive: true });
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`);
  console.log(`Berhasil mengekstrak ke ${extractDir}`);
  unlinkSync(zipPath);
}

if (latestApk) await downloadAndExtract(latestApk, 'apk');
if (latestWin) await downloadAndExtract(latestWin, 'win');

// Rapikan file unduhan utama agar mudah diakses langsung:
// downloads/vita.apk
// downloads/vita.exe
// downloads/vita-setup.msi
const apkFiles = existsSync(join(DOWNLOADS_DIR, 'apk')) ? readdirSync(join(DOWNLOADS_DIR, 'apk')) : [];
const foundApk = apkFiles.find(f => f.endsWith('.apk'));
if (foundApk) {
  const src = join(DOWNLOADS_DIR, 'apk', foundApk);
  const dst = join(DOWNLOADS_DIR, 'vita.apk');
  const buf = (await import('node:fs')).readFileSync(src);
  writeFileSync(dst, buf);
  console.log(`✓ File APK siap: downloads/vita.apk (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

const winFiles = existsSync(join(DOWNLOADS_DIR, 'win')) ? readdirSync(join(DOWNLOADS_DIR, 'win')) : [];
const foundExe = winFiles.find(f => f.endsWith('.exe'));
const foundMsi = winFiles.find(f => f.endsWith('.msi'));
if (foundExe) {
  const src = join(DOWNLOADS_DIR, 'win', foundExe);
  const dst = join(DOWNLOADS_DIR, 'vita.exe');
  const buf = (await import('node:fs')).readFileSync(src);
  writeFileSync(dst, buf);
  console.log(`✓ File PC Exe siap: downloads/vita.exe (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}
if (foundMsi) {
  const src = join(DOWNLOADS_DIR, 'win', foundMsi);
  const dst = join(DOWNLOADS_DIR, 'vita-setup.msi');
  const buf = (await import('node:fs')).readFileSync(src);
  writeFileSync(dst, buf);
  console.log(`✓ File PC MSI siap: downloads/vita-setup.msi (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

console.log('Semua artefak berhasil disiapkan di folder downloads/!');
