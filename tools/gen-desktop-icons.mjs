// VITA Desktop launcher icon generator — pure Node.js stdlib, no dependencies.
// Memakai ulang seni prosedural dari tools/gen-icons.mjs (impor, bukan duplikasi)
// untuk menghasilkan aset icon Tauri / Windows Desktop (.ico dan .png multi-dimensi).
//
// Berkas tujuan di src-tauri/icons:
//   32x32.png, 128x128.png, 128x128@2x.png (256x256), icon.png (512x512), icon.ico
//
// Run: npm run icons:desktop
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIcon } from './gen-icons.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ICONS_DIR = join(ROOT, 'src-tauri', 'icons');

function buildIco(images) {
  // images: [{ width, height, buffer }]
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(count, 4); // count

  const entries = [];
  let offset = 6 + count * 16;
  for (const item of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(item.width >= 256 ? 0 : item.width, 0);
    entry.writeUInt8(item.height >= 256 ? 0 : item.height, 1);
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(item.buffer.length, 8); // image size
    entry.writeUInt32LE(offset, 12); // image offset
    entries.push(entry);
    offset += item.buffer.length;
  }

  return Buffer.concat([header, ...entries, ...images.map(i => i.buffer)]);
}

export function generateDesktopIcons() {
  if (!existsSync(ICONS_DIR)) {
    mkdirSync(ICONS_DIR, { recursive: true });
  }

  const p32 = join(ICONS_DIR, '32x32.png');
  const p128 = join(ICONS_DIR, '128x128.png');
  const p256 = join(ICONS_DIR, '128x128@2x.png');
  const p512 = join(ICONS_DIR, 'icon.png');
  const pIco = join(ICONS_DIR, 'icon.ico');

  // 1. Icon 32x32
  makeIcon(32, false, 1.0).save(p32);

  // 2. Icon 128x128
  makeIcon(128, false, 1.0).save(p128);

  // 3. Icon 256x256 (Tauri 128x128@2x)
  makeIcon(256, false, 1.0).save(p256);

  // 4. Icon 512x512 (icon.png)
  makeIcon(512, false, 1.0).save(p512);

  // 5. Windows icon.ico (kombinasi 32, 128, 256)
  const b32 = readFileSync(p32);
  const b128 = readFileSync(p128);
  const b256 = readFileSync(p256);

  const icoBuffer = buildIco([
    { width: 32, height: 32, buffer: b32 },
    { width: 128, height: 128, buffer: b128 },
    { width: 256, height: 256, buffer: b256 }
  ]);
  writeFileSync(pIco, icoBuffer);

  console.log('✓ Icon desktop (Tauri / Windows) berhasil digenerasi di src-tauri/icons/');
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/').toLowerCase() ===
    process.argv[1].replace(/\\/g, '/').toLowerCase();

if (invokedDirectly) {
  generateDesktopIcons();
}
