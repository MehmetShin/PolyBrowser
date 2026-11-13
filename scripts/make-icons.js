// Generates installer icon (setup-icon.ico) and wizard header bitmap from src/assets/icon.png
// Run with: npx electron scripts/make-icons.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'src', 'assets');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  try {
    main();
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});

function cropToContent(img) {
  const { width: W, height: H } = img.getSize();
  const bmp = img.toBitmap();
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (bmp[(y * W + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return img;
  return img.crop({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
}

// Premultiplied BGRA canvas helpers
function compositeBlackLogo(buf, S, logo, fit, bgOpaque) {
  const { width: lw, height: lh } = logo.getSize();
  const scale = Math.min((S * fit) / lw, (S * fit) / lh);
  const tw = Math.max(1, Math.round(lw * scale));
  const th = Math.max(1, Math.round(lh * scale));
  const resized = logo.resize({ width: tw, height: th, quality: 'best' });
  const rs = resized.getSize();
  const lb = resized.toBitmap();
  const ox = Math.round((S - rs.width) / 2);
  const oy = Math.round((S - rs.height) / 2);
  for (let y = 0; y < rs.height; y++) {
    for (let x = 0; x < rs.width; x++) {
      const la = lb[(y * rs.width + x) * 4 + 3] / 255;
      if (la <= 0) continue;
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= S || dy >= S) continue;
      const i = (dy * S + dx) * 4;
      buf[i] = Math.round(buf[i] * (1 - la));
      buf[i + 1] = Math.round(buf[i + 1] * (1 - la));
      buf[i + 2] = Math.round(buf[i + 2] * (1 - la));
      if (!bgOpaque) buf[i + 3] = Math.max(buf[i + 3], Math.round(la * 255));
    }
  }
}

function buildTile(S, logo) {
  // White rounded square with black logo (visible on both dark and light backgrounds)
  const buf = Buffer.alloc(S * S * 4);
  const r = S * 0.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      const cx = Math.min(Math.max(px, r), S - r);
      const cy = Math.min(Math.max(py, r), S - r);
      const d = Math.hypot(px - cx, py - cy);
      const a = Math.max(0, Math.min(1, r - d + 0.5));
      const v = Math.round(255 * a);
      const i = (y * S + x) * 4;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = v; // premultiplied white
    }
  }
  compositeBlackLogo(buf, S, logo, 0.74, true);
  return buf;
}

function unpremultiply(bgra) {
  const out = Buffer.from(bgra);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a > 0 && a < 255) {
      out[i] = Math.min(255, Math.round((out[i] * 255) / a));
      out[i + 1] = Math.min(255, Math.round((out[i + 1] * 255) / a));
      out[i + 2] = Math.min(255, Math.round((out[i + 2] * 255) / a));
    }
  }
  return out;
}

function dibEntry(img, s) {
  const bgra = unpremultiply(img.toBitmap());
  const maskRow = Math.ceil(s / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(s, 4);
  header.writeInt32LE(s * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(s * s * 4 + maskRow * s, 20);
  const pixels = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    bgra.copy(pixels, (s - 1 - y) * s * 4, y * s * 4, (y + 1) * s * 4);
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * s)]);
}

function writeIco(file, tileImg) {
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const blobs = sizes.map((s) => {
    const img = tileImg.resize({ width: s, height: s, quality: 'best' });
    return s === 256 ? img.toPNG() : dibEntry(img, s);
  });
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(s >= 256 ? 0 : s, e);
    head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt8(0, e + 2);
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(blobs[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += blobs[i].length;
  });
  fs.writeFileSync(file, Buffer.concat([head, ...blobs]));
}

function writeBmp24(file, S, bgraPremul) {
  const rowSize = Math.ceil((S * 3) / 4) * 4;
  const dataSize = rowSize * S;
  const buf = Buffer.alloc(54 + dataSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + dataSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(S, 18);
  buf.writeInt32LE(S, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(dataSize, 34);
  buf.writeInt32LE(3780, 38);
  buf.writeInt32LE(3780, 42);
  for (let y = 0; y < S; y++) {
    const row = 54 + (S - 1 - y) * rowSize;
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      buf[row + x * 3] = bgraPremul[i];
      buf[row + x * 3 + 1] = bgraPremul[i + 1];
      buf[row + x * 3 + 2] = bgraPremul[i + 2];
    }
  }
  fs.writeFileSync(file, buf);
}

function main() {
  const src = nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
  if (src.isEmpty()) throw new Error('icon.png okunamadı');
  const logo = cropToContent(src);

  // 1) Installer icon
  const S = 256;
  const tile = nativeImage.createFromBitmap(buildTile(S, logo), { width: S, height: S });
  writeIco(path.join(ASSETS, 'setup-icon.ico'), tile);
  fs.writeFileSync(path.join(ASSETS, 'setup-icon.png'), tile.toPNG());

  // 2) Wizard small header images (white background, black logo) for 100%..200% DPI
  for (const [name, size] of [['wizard-small-55.bmp', 55], ['wizard-small-83.bmp', 83], ['wizard-small-110.bmp', 110]]) {
    const buf = Buffer.alloc(size * size * 4, 255);
    compositeBlackLogo(buf, size, logo, 0.86, true);
    writeBmp24(path.join(ASSETS, name), size, buf);
  }

  console.log('OK: setup-icon.ico, setup-icon.png, wizard-small-*.bmp oluşturuldu');
}

