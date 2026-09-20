/* Measure where the KPI cards sit in a screenshot, so a recapture can be
   matched to the original by arithmetic rather than by eye.

   The framing of these images is not written down anywhere and the last
   attempt to reproduce it by eye changed it, so this reads the picture: it
   scans one row of pixels across the card band and reports the runs that are
   not the page background. Two images whose runs line up as a FRACTION of
   their width are the same layout at different sizes.

   Decodes the PNG with zlib rather than a library, because this repo has no
   node_modules at the root and a measurement tool is not worth starting one.
   Only the filters PNG actually uses are handled. */
const fs = require('fs');
const zlib = require('zlib');

function decode(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const depth = b[24], type = b[25];
  if (depth !== 8 || (type !== 6 && type !== 2)) {
    throw new Error(file + ': only 8 bit RGB/RGBA, got depth ' + depth + ' type ' + type);
  }
  const ch = type === 6 ? 4 : 3;
  let idat = [];
  let p = 8;
  while (p < b.length) {
    const len = b.readUInt32BE(p), tag = b.toString('ascii', p + 4, p + 8);
    if (tag === 'IDAT') idat.push(b.slice(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const line = raw.slice(q, q + stride); q += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, bb = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += bb;
      else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) {
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, px: out };
}

/* Runs across one row that are not the near-black page ground. */
function runs(img, y, minRun) {
  const { w, ch, px } = img;
  const stride = w * ch;
  const out = [];
  let start = -1;
  for (let x = 0; x < w; x++) {
    const i = y * stride + x * ch;
    const lum = px[i] + px[i + 1] + px[i + 2];
    const on = lum > 60;                       // anything lighter than the ground
    if (on && start < 0) start = x;
    if ((!on || x === w - 1) && start >= 0) {
      const end = on ? x : x - 1;
      if (end - start >= (minRun || 40)) out.push([start, end]);
      start = -1;
    }
  }
  return out;
}

const file = process.argv[2];
const y = parseInt(process.argv[3], 10);
const img = decode(file);
const r = runs(img, y, parseInt(process.argv[4] || '40', 10));
console.log(file.split(/[\\/]/).pop() + '  ' + img.w + 'x' + img.h + '  row ' + y);
r.forEach(function (run) {
  console.log('   ' + String(run[0]).padStart(5) + ' .. ' + String(run[1]).padStart(5) +
    '   width ' + String(run[1] - run[0] + 1).padStart(5) +
    '   (' + (run[0] / img.w).toFixed(4) + ' .. ' + (run[1] / img.w).toFixed(4) + ')');
});
