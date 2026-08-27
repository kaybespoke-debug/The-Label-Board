/* pngcrop.js — decode a PNG, cut rectangles out of it, write them back as PNGs.
 * No dependencies: zlib is in Node, and the rest is the PNG spec.
 * Usage: node pngcrop.js <source.png> <outDir> name:x,y,w,h [name:x,y,w,h ...]
 * Coordinates are in source pixels.
 */
const fs = require('fs');
const zlib = require('zlib');

/* ---------- CRC, straight from the spec ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- decode ---------- */
function decode(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8, ihdr = null, idat = [], palette = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], colour: data[9], interlace: data[12]
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('no header');
  if (ihdr.depth !== 8) throw new Error('only 8 bit images, got ' + ihdr.depth);
  if (ihdr.interlace) throw new Error('interlaced images not handled');

  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = CHANNELS[ihdr.colour];
  if (!ch) throw new Error('colour type ' + ihdr.colour + ' not handled');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * ch;
  const out = Buffer.alloc(ihdr.height * stride);

  let rp = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= ch) ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }

  /* everything becomes RGB so the writer has one case to handle */
  const rgb = Buffer.alloc(ihdr.width * ihdr.height * 3);
  for (let i = 0, n = ihdr.width * ihdr.height; i < n; i++) {
    let r, g, b;
    if (ihdr.colour === 2 || ihdr.colour === 6) { r = out[i * ch]; g = out[i * ch + 1]; b = out[i * ch + 2]; }
    else if (ihdr.colour === 0 || ihdr.colour === 4) { r = g = b = out[i * ch]; }
    else { const p = out[i] * 3; r = palette[p]; g = palette[p + 1]; b = palette[p + 2]; }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  return { width: ihdr.width, height: ihdr.height, rgb };
}

/* ---------- encode ---------- */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encode(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       /* filter: none */
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- crop, with a box average when scaling down ---------- */
function crop(src, x, y, w, h, outW) {
  outW = outW || w;
  const scale = w / outW;
  const outH = Math.max(1, Math.round(h / scale));
  const out = Buffer.alloc(outW * outH * 3);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const x0 = x + Math.floor(ox * scale), x1 = Math.min(x + w, x + Math.ceil((ox + 1) * scale));
      const y0 = y + Math.floor(oy * scale), y1 = Math.min(y + h, y + Math.ceil((oy + 1) * scale));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < Math.max(y0 + 1, y1); sy++) {
        for (let sx = x0; sx < Math.max(x0 + 1, x1); sx++) {
          if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
          const i = (sy * src.width + sx) * 3;
          r += src.rgb[i]; g += src.rgb[i + 1]; b += src.rgb[i + 2]; n++;
        }
      }
      const o = (oy * outW + ox) * 3;
      out[o] = n ? Math.round(r / n) : 0;
      out[o + 1] = n ? Math.round(g / n) : 0;
      out[o + 2] = n ? Math.round(b / n) : 0;
    }
  }
  return { width: outW, height: outH, rgb: out };
}

/* ---------- run ---------- */
const [, , source, outDir, ...specs] = process.argv;
const img = decode(source);
console.log('source ' + img.width + 'x' + img.height);
specs.forEach(spec => {
  const [name, rest] = spec.split(':');
  const [x, y, w, h, outW] = rest.split(',').map(Number);
  const piece = crop(img, x, y, w, h, outW || w);
  const file = outDir + '/' + name + '.png';
  fs.writeFileSync(file, encode(piece.width, piece.height, piece.rgb));
  console.log('  ' + name + '.png  ' + piece.width + 'x' + piece.height +
    '  ' + Math.round(fs.statSync(file).size / 1024) + 'KB');
});
