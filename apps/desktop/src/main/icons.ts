import { deflateSync } from "node:zlib";

/** Tiny PNG encoder so the app ships its icons as code (no binary assets in the repo). */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

type RGBA = [number, number, number, number];

/** Rasterize with 4×4 supersampling; `shade(x, y)` gets normalized coordinates and returns a color or null. RGBA rows, top-down. */
function rasterize(width: number, height: number, shade: (x: number, y: number) => RGBA | null): Buffer {
  const out = Buffer.alloc(width * height * 4);
  const S = 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = shade((x + (sx + 0.5) / S) / width, (y + (sy + 0.5) / S) / height);
          if (!c) continue;
          const alpha = c[3] / 255;
          r += c[0] * alpha;
          g += c[1] * alpha;
          b += c[2] * alpha;
          a += alpha;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  return out;
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function render(size: number, shade: (x: number, y: number) => RGBA | null): Buffer {
  return encodePng(size, size, rasterize(size, size, shade));
}

/** 24-bit BMP over an opaque background (NSIS installer images must be BMP). */
function encodeBmp(width: number, height: number, rgba: Buffer, background: RGBA): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const row = (height - 1 - y) * rowSize; // bottom-up
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const a = rgba[o + 3]! / 255;
      pixels[row + x * 3] = Math.round(rgba[o + 2]! * a + background[2] * (1 - a));
      pixels[row + x * 3 + 1] = Math.round(rgba[o + 1]! * a + background[1] * (1 - a));
      pixels[row + x * 3 + 2] = Math.round(rgba[o]! * a + background[0] * (1 - a));
    }
  }
  const header = Buffer.alloc(54);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  return Buffer.concat([header, pixels]);
}

const ACCENT: RGBA = [63, 125, 112, 255];
const WHITE: RGBA = [255, 255, 255, 255];

function inRoundedSquare(x: number, y: number, radius: number): boolean {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** The speech bubble in a unit box: white bubble with an accent line, or null outside it. */
function bubble(x: number, y: number): RGBA | null {
  const inBubble = ((x - 0.5) / 0.3) ** 2 + ((y - 0.46) / 0.24) ** 2 <= 1;
  const inTail = y > 0.58 && y < 0.78 && x > 0.3 && x < 0.44 && x - 0.3 < (0.78 - y) * 0.7;
  if (!inBubble && !inTail) return null;
  const line = Math.abs(y - 0.46) < 0.035 && x > 0.36 && x < 0.64;
  return line ? ACCENT : WHITE;
}

/** Muted teal tile with a quiet white speech bubble. */
export function appIconPng(size = 256): Buffer {
  return render(size, (x, y) => (inRoundedSquare(x, y, 0.22) ? (bubble(x, y) ?? ACCENT) : null));
}

/** Circular variant (Android round launcher icon). */
export function roundIconPng(size = 192): Buffer {
  return render(size, (x, y) => ((x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.25 ? (bubble(x, y) ?? ACCENT) : null));
}

/** Android adaptive-icon foreground: the bubble alone, inside the launcher's safe zone. */
export function adaptiveForegroundPng(size = 432): Buffer {
  const inset = 0.15;
  return render(size, (x, y) => bubble((x - inset) / (1 - 2 * inset), (y - inset) / (1 - 2 * inset)));
}

export function dotPng(size = 32, color: RGBA = ACCENT): Buffer {
  return render(size, (x, y) => ((x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.2 ? color : null));
}

/** A Windows .ico with every size rendered natively (crisp at 16 px, not a downscaled 256). */
export function appIconIco(sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]): Buffer {
  const images = sizes.map((size) => appIconPng(size));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + entries.length;
  images.forEach((png, i) => {
    const size = sizes[i]!;
    const e = i * 16;
    entries[e] = size >= 256 ? 0 : size;
    entries[e + 1] = size >= 256 ? 0 : size;
    entries.writeUInt16LE(1, e + 4); // planes
    entries.writeUInt16LE(32, e + 6); // bpp
    entries.writeUInt32LE(png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images]);
}

const WARM: RGBA = [246, 244, 240, 255];

/** NSIS welcome/finish sidebar (164×314): the teal tile with the bubble, near the top. */
export function installerSidebarBmp(): Buffer {
  const w = 164;
  const h = 314;
  const tile = 88;
  const left = (w - tile) / 2 / w;
  const top = 56 / h;
  const rgba = rasterize(w, h, (x, y) => {
    const tx = (x - left) / (tile / w);
    const ty = (y - top) / (tile / h);
    if (tx >= 0 && tx <= 1 && ty >= 0 && ty <= 1 && inRoundedSquare(tx, ty, 0.22)) return bubble(tx, ty) ?? ACCENT;
    return null;
  });
  return encodeBmp(w, h, rgba, WARM);
}

/** NSIS page header image (150×57): a small tile at the right edge. */
export function installerHeaderBmp(): Buffer {
  const w = 150;
  const h = 57;
  const tile = 40;
  const left = (w - tile - 10) / w;
  const top = (h - tile) / 2 / h;
  const rgba = rasterize(w, h, (x, y) => {
    const tx = (x - left) / (tile / w);
    const ty = (y - top) / (tile / h);
    if (tx >= 0 && tx <= 1 && ty >= 0 && ty <= 1 && inRoundedSquare(tx, ty, 0.22)) return bubble(tx, ty) ?? ACCENT;
    return null;
  });
  return encodeBmp(w, h, rgba, [255, 255, 255, 255]);
}
