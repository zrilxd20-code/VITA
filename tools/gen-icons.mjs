// VITA icon & screenshot generator — pure Node.js stdlib (fs + zlib), no dependencies.
// Redraws maze + red V + gold dot on #0a0a12, plus tactical PWA screenshots.
// Run: npm run icons
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BG = [10, 10, 18, 255];
const GRID1 = [58, 63, 85, 255];
const GRID2 = [90, 96, 118, 255];
const RED = [255, 59, 59, 255];
const GOLD = [241, 196, 15, 255];
const CYAN = [0, 240, 255, 255];
const AMBER = [245, 158, 11, 255];
const CHASSIS = [30, 41, 59, 255];
const TRACKS = [15, 23, 42, 255];

function chunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h || w;
    this.px = Buffer.alloc(this.w * this.h * 4);
    for (let i = 0; i < this.px.length; i += 4) {
      this.px[i] = BG[0]; this.px[i + 1] = BG[1]; this.px[i + 2] = BG[2]; this.px[i + 3] = BG[3];
    }
  }
  set(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const sa = c[3] / 255, da = this.px[i + 3] / 255;
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(c[k] * sa + this.px[i + k] * (1 - sa));
    this.px[i + 3] = Math.round(255 * (sa + da * (1 - sa)));
  }
  rect(x, y, w, h, c) {
    for (let py = Math.floor(y); py < y + h; py++) {
      for (let px = Math.floor(x); px < x + w; px++) {
        this.set(px, py, c);
      }
    }
  }
  disk(cx, cy, r, c) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) this.set(x, y, c);
  }
  line(x0, y0, x1, y1, w, c) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.floor(d));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c);
    }
  }
  roundCorners(radius) {
    const { w, h, px } = this, r = radius;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cx = Math.min(Math.max(x, r), w - r);
      const cy = Math.min(Math.max(y, r), h - r);
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
      }
    }
  }
  save(path) {
    const { w, h, px } = this;
    const rows = [];
    for (let y = 0; y < h; y++) rows.push(Buffer.concat([Buffer.from([0]), px.subarray(y * w * 4, (y + 1) * w * 4)]));
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    writeFileSync(path, png);
    console.log('wrote', path, png.length, 'bytes');
  }
}

function drawContent(cv, k, ox, oy) {
  const X = (v) => ox + v * k;
  cv.line(X(96), X(96), X(416), X(96), 20 * k, GRID1);
  cv.line(X(416), X(96), X(416), X(416), 20 * k, GRID1);
  cv.line(X(416), X(416), X(96), X(416), 20 * k, GRID1);
  cv.line(X(96), X(416), X(96), X(96), 20 * k, GRID1);
  for (const [x0, y0, x1, y1] of [
    [176, 96, 176, 216], [176, 216, 256, 216], [256, 216, 256, 96],
    [256, 216, 256, 296], [256, 296, 176, 296], [176, 296, 176, 216],
    [336, 216, 336, 416], [96, 336, 176, 336], [336, 336, 416, 336], [176, 416, 336, 416],
  ]) cv.line(X(x0), X(y0), X(x1), X(y1), 20 * k, GRID2);
  cv.line(X(186), X(196), X(256), X(330), 34 * k, RED);
  cv.line(X(326), X(196), X(256), X(330), 34 * k, RED);
  cv.disk(X(396), X(396), 26 * k, GOLD);
}

function makeIcon(size, rounded, contentScale) {
  const cv = new Canvas(size, size);
  const k = (size / 512) * contentScale;
  const off = (size - 512 * k) / 2;
  drawContent(cv, k, off, off);
  if (rounded) cv.roundCorners(Math.floor((size * 96) / 512));
  return cv;
}

// Procedural tactical screenshot showing BMPT robot drone, maze walls, headlights, and HUD
function makeScreenshot(w, h) {
  const cv = new Canvas(w, h);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

  // Background grid cells
  const cellSize = Math.floor(w / 16);
  for (let gx = 0; gx < w; gx += cellSize) {
    cv.line(gx, 0, gx, h, 1, [24, 28, 44, 255]);
  }
  for (let gy = 0; gy < h; gy += cellSize) {
    cv.line(0, gy, w, gy, 1, [24, 28, 44, 255]);
  }

  // Maze walls (slate stone corridors)
  cv.rect(cx - 260, cy - 180, 520, 24, [30, 41, 59, 255]);
  cv.rect(cx - 260, cy + 160, 520, 24, [30, 41, 59, 255]);
  cv.rect(cx - 260, cy - 180, 24, 364, [30, 41, 59, 255]);
  cv.rect(cx + 236, cy - 180, 24, 364, [30, 41, 59, 255]);

  // Headlights beam (warm amber/yellow glow)
  for (let r = 20; r <= 180; r += 10) {
    const alpha = Math.max(10, Math.floor(100 * (1 - r / 180)));
    cv.disk(cx + r, cy, Math.floor(r * 0.42), [254, 240, 138, alpha]);
  }

  // Mini-BMPT combat drone robot in the center
  // Dual caterpillar tracks
  cv.rect(cx - 36, cy - 28, 72, 14, TRACKS);
  cv.rect(cx - 36, cy + 14, 72, 14, TRACKS);
  // Track road wheels
  for (let wx = -24; wx <= 24; wx += 16) {
    cv.disk(cx + wx, cy - 21, 5, [71, 85, 105, 255]);
    cv.disk(cx + wx, cy + 21, 5, [71, 85, 105, 255]);
  }
  // Sloped composite armored hull
  cv.rect(cx - 28, cy - 16, 56, 32, CHASSIS);
  cv.rect(cx + 10, cy - 12, 18, 24, [51, 65, 85, 255]);
  // Front dual tactical LED headlights
  cv.disk(cx + 28, cy - 18, 4, AMBER);
  cv.disk(cx + 28, cy + 18, 4, AMBER);
  // Rotating turret ring & cyclops optical sensor eye
  cv.disk(cx, cy, 14, [15, 23, 42, 255]);
  cv.disk(cx + 4, cy, 6, CYAN);
  cv.disk(cx + 6, cy, 2, [255, 255, 255, 255]);
  // Deployable dual autocannon barrels
  cv.rect(cx + 12, cy - 4, 22, 3, [15, 23, 42, 255]);
  cv.rect(cx + 12, cy + 1, 22, 3, [15, 23, 42, 255]);

  // Ambient artifacts and foes in corridor
  cv.disk(cx - 160, cy - 80, 12, [147, 51, 234, 220]); // Bat
  cv.disk(cx - 160, cy + 80, 14, [34, 197, 94, 220]);  // Slime
  cv.disk(cx + 140, cy - 80, 10, GOLD); // Ancient Artifact
  cv.disk(cx + 140, cy + 80, 10, CYAN); // Lore Data Disc

  // Tactical HUD corner brackets
  const hudColor = [0, 240, 255, 200];
  cv.line(24, 24, 80, 24, 2, hudColor);
  cv.line(24, 24, 24, 80, 2, hudColor);
  cv.line(w - 24, 24, w - 80, 24, 2, hudColor);
  cv.line(w - 24, 24, w - 24, 80, 2, hudColor);
  cv.line(24, h - 24, 80, h - 24, 2, hudColor);
  cv.line(24, h - 24, 24, h - 80, 2, hudColor);
  cv.line(w - 24, h - 24, w - 80, h - 24, 2, hudColor);
  cv.line(w - 24, h - 24, w - 24, h - 80, 2, hudColor);

  return cv;
}

// Generate Icons
makeIcon(512, true, 1.0).save(join(ROOT, 'icon-512.png'));
makeIcon(192, true, 1.0).save(join(ROOT, 'icon-192.png'));
makeIcon(180, false, 1.0).save(join(ROOT, 'apple-touch-icon.png'));
makeIcon(512, false, 0.72).save(join(ROOT, 'icon-maskable-512.png'));

// Generate PWA Screenshots (W3C Rich Install UI)
makeScreenshot(1280, 720).save(join(ROOT, 'screenshot-wide.png'));
makeScreenshot(540, 960).save(join(ROOT, 'screenshot-narrow.png'));
