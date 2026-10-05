/* =====================================================================
   SERVE site/ UNDER THE REAL HEADERS, so the CSP can be tested in a
   browser before it is deployed rather than after.

   The headers come from netlify.toml, parsed out of it rather than typed
   again here — a preview that tests a policy nobody is going to ship is
   worse than no preview.

   A <meta http-equiv> cannot be used for this: frame-ancestors is ignored
   in a meta tag, and frame-ancestors is the half of the policy that stops
   a signed-in studio being framed.

   usage: node tools/csp_preview.js [port]
   then open http://localhost:8099/ and read the console.
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 8099);
const ROOT = path.join(__dirname, '..', 'site');

/* Lift the headers straight out of netlify.toml. */
function headersFromToml() {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const block = toml.slice(toml.indexOf('[headers.values]'));
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([A-Za-z-]+)\s*=\s*"([\s\S]*)"\s*$/);
    if (m) out[m[1]] = m[2];
  }
  if (!out['Content-Security-Policy']) {
    console.error('No Content-Security-Policy found in netlify.toml.');
    process.exit(1);
  }
  return out;
}
const HEADERS = headersFromToml();

/* upgrade-insecure-requests is a no-op on production, where everything is
   already https, and a trap in a preview served over http://localhost: the
   browser upgrades sub-resource fetches to https and the service worker
   script fetch fails with "an unknown error occurred", which reads exactly
   like a CSP refusal and is not one. NO_UIR=1 drops it so the rest of the
   policy can be tested honestly. */
/* NO_CSP=1 drops the policy entirely. The point of the preview is to tell a
   CSP refusal apart from a preview artefact, and the only honest way to do
   that is to run the same server both ways. */
if (process.env.NO_CSP === '1') {
  delete HEADERS['Content-Security-Policy'];
  console.log('(Content-Security-Policy dropped for this preview only)');
}
if (process.env.NO_STORE === '0') {
  console.log('(Cache-Control: no-store will not be set)');
}
if (process.env.NO_UIR === '1') {
  HEADERS['Content-Security-Policy'] =
    HEADERS['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  console.log('(upgrade-insecure-requests dropped for this preview only)');
}

const TYPES = {
  '.html': 'text/html; charset=UTF-8', '.js': 'text/javascript; charset=UTF-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css',
};

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/layi_dashboard.html';          // the netlify redirect
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
  fs.readFile(file, (err, buf) => {
    const h = Object.assign({}, HEADERS);
    if (err) { res.writeHead(404, h).end('not found'); return; }
    h['Content-Type'] = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (process.env.NO_STORE !== '0') h['Cache-Control'] = 'no-store';
    res.writeHead(200, h);
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log('site/ on http://localhost:' + PORT + '/  under the shipped headers');
  console.log('');
  for (const k of Object.keys(HEADERS)) {
    console.log('  ' + k + ': ' + HEADERS[k].slice(0, 110) + (HEADERS[k].length > 110 ? '…' : ''));
  }
  console.log('');
  console.log('The app runs entirely on the device at this hostname: SUPA_ENVS is');
  console.log('keyed on location.hostname and localhost is not in it, which is the');
  console.log('safe default. So this proves the POLICY, not the sync.');
});
