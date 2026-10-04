/* =====================================================================
   THE PHOTOS COME BACK TOO.
   =====================================================================
   STAGING ONLY. Creates its own objects and removes them again. It never
   touches production storage, and it never deletes an object it did not
   upload in this run.

   WHY THIS EXISTS. Supabase's own documentation is explicit: "Database
   backups do not include objects you store via the Storage API, as the
   database only includes metadata about these objects." So the nightly
   studio export, the daily platform backup and the recovery drill all
   restore a studio whose client photos are gone. Nothing in the database
   can fix that, because the bytes were never in it.

   WHAT MAKES THIS TRACTABLE. The tenant association is the path. The
   bucket's policies resolve a studio with app.media_business_of(name),
   which is just the first path segment parsed as a uuid:

       studio-media/<business_id>/<whatever>

   So there is no separate mapping to back up and nothing to reconcile:
   an object restored to the path it came from belongs to the studio it
   belonged to, and an object restored to the wrong path would be
   refused to everyone, because no membership matches a made-up uuid.
   That is worth proving rather than assuming, so this does.

   usage: node tools/storage_recovery_probe.js
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BUCKET = 'studio-media';
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

const A = '7256137b-2d3b-4d2d-86da-a7651d6bb10c';   // Seed Multi Studio
const B = 'c80aba9c-d12e-4302-a442-2669b0907a95';   // Adé Bespoke
const EMAIL_A = 'probe.store.a@thelabelboard.com';
const EMAIL_B = 'probe.store.b@thelabelboard.com';

const OUT = path.join(process.env.TEMP || '/tmp', 'tlb-storage-drill');
const TAG = 'drill' + Date.now();

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const fn = async (name, body) => (await fetch(PROJ + '/functions/v1/' + name, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})).json();

/* A real session's access token, so the Storage API is exercised through
   the same policies a studio's own device goes through. */
async function tokenFor(email) {
  const s = await fn('e2e-signin', { email });
  if (!s || !s.action_link) return null;
  const v = await fetch(s.action_link, { redirect: 'manual' });
  return new URLSearchParams((v.headers.get('location') || '').split('#')[1] || '').get('access_token');
}

const store = async (token, method, objectPath, body, type) => {
  const r = await fetch(PROJ + '/storage/v1/object/' + BUCKET + '/' + objectPath, {
    method,
    headers: Object.assign({ apikey: KEY, Authorization: 'Bearer ' + token },
      type ? { 'Content-Type': type, 'x-upsert': 'true' } : {}),
    body,
  });
  let b = null; try { b = await r.text(); } catch {}
  return { status: r.status, body: b };
};

const list = async (token, prefix) => {
  const r = await fetch(PROJ + '/storage/v1/object/list/' + BUCKET, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, items: Array.isArray(b) ? b : [] };
};

const download = async (token, objectPath) => {
  const r = await fetch(PROJ + '/storage/v1/object/' + BUCKET + '/' + objectPath, {
    headers: { apikey: KEY, Authorization: 'Bearer ' + token },
  });
  if (!r.ok) return { status: r.status, bytes: null };
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) };
};

const sha = (buf) => require('crypto').createHash('sha256').update(buf).digest('hex');

(async () => {
  console.log('=== STORAGE: BACK UP, LOSE, RESTORE, staging ===');
  await fn('e2e-fixture', { mode: 'clean', business_id: A, emails: [EMAIL_A] });
  await fn('e2e-fixture', { mode: 'clean', business_id: B, emails: [EMAIL_B] });
  await fn('e2e-fixture', { mode: 'member', email: EMAIL_A, name: 'Store A', business_id: A, role: 'owner' });
  await fn('e2e-fixture', { mode: 'member', email: EMAIL_B, name: 'Store B', business_id: B, role: 'owner' });

  const tA = await tokenFor(EMAIL_A);
  const tB = await tokenFor(EMAIL_B);
  ok('two real sessions', !!tA && !!tB, 'could not sign in');
  if (fail) process.exit(1);

  /* ------------------------------------------------------------------ */
  section('1. A studio puts some photos up');
  /* REAL PNGs, because the bucket means it: allowed_mime_types is the six
     image types and nothing else, and the limit is 10MB. A drill that
     uploaded a text file would be testing a path the product cannot take.
     Each is a valid 1x1 PNG with the run's tag appended as a trailing
     chunk, so the three differ and their checksums are distinguishable. */
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const png = (n) => Buffer.concat([PNG, Buffer.from(TAG + '-' + n)]);
  const FILES = [
    { p: A + '/orders/' + TAG + '-1.png', body: png(1) },
    { p: A + '/orders/' + TAG + '-2.png', body: png(2) },
    { p: A + '/clients/' + TAG + '-3.png', body: png(3) },
  ];
  for (const f of FILES) {
    const r = await store(tA, 'POST', f.p, f.body, 'image/png');
    ok('uploaded ' + f.p.split('/').slice(1).join('/'), r.status < 300, 'status ' + r.status + ' ' + (r.body || '').slice(0, 90));
  }
  const mine = await list(tA, A + '/orders');
  ok('the studio can list its own', mine.items.length >= 2, mine.status + ', ' + mine.items.length + ' items');

  section('2. And cannot see the other studio’s');
  {
    const theirs = await list(tB, A + '/');
    ok('another studio lists nothing under it', theirs.items.length === 0,
       theirs.status + ', ' + theirs.items.length + ' items');
    const grab = await download(tB, FILES[0].p);
    ok('  and cannot download one by its exact path', grab.status >= 400, 'status ' + grab.status);
  }

  /* ------------------------------------------------------------------ */
  section('3. Backing them up, path and bytes together');
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];
  for (const f of FILES) {
    const d = await download(tA, f.p);
    if (!d.bytes) { ok('downloaded ' + f.p, false, 'status ' + d.status); continue; }
    const local = path.join(OUT, f.p.replace(/\//g, '__'));
    fs.writeFileSync(local, d.bytes);
    manifest.push({ path: f.p, sha256: sha(d.bytes), bytes: d.bytes.length, local });
  }
  ok('every object was fetched', manifest.length === FILES.length, manifest.length + ' of ' + FILES.length);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  ok('  and a manifest records the path, the size and a checksum for each',
     manifest.every(m => m.path && m.sha256 && m.bytes > 0));
  console.log('        ' + OUT);

  /* ------------------------------------------------------------------ */
  section('4. The objects are lost');
  for (const f of FILES) await store(tA, 'DELETE', f.p);
  const afterLoss = await list(tA, A + '/orders');
  const stillThere = afterLoss.items.filter(i => i.name && i.name.includes(TAG));
  ok('they are gone', stillThere.length === 0, JSON.stringify(stillThere.map(i => i.name)));

  /* ------------------------------------------------------------------ */
  section('5. Restored from the manifest alone');
  for (const m of manifest) {
    const body = fs.readFileSync(m.local);
    const r = await store(tA, 'POST', m.path, body, 'image/png');
    ok('put back ' + m.path.split('/').slice(1).join('/'), r.status < 300,
       'status ' + r.status + ' ' + (r.body || '').slice(0, 80));
  }
  {
    const back = await list(tA, A + '/orders');
    const found = back.items.filter(i => i.name && i.name.includes(TAG));
    ok('the count is what it was', found.length === 2, found.length + ' of 2');
  }
  for (const m of manifest) {
    const d = await download(tA, m.path);
    ok('  ' + m.path.split('/').pop() + ' is byte for byte what it was',
       !!d.bytes && sha(d.bytes) === m.sha256 && d.bytes.length === m.bytes,
       'status ' + d.status);
  }

  section('6. And the walls are still up after the restore');
  {
    const theirs = await list(tB, A + '/');
    ok('the other studio still sees nothing', theirs.items.length === 0,
       theirs.items.length + ' items');
    const grab = await download(tB, manifest[0].path);
    ok('  and still cannot download one', grab.status >= 400, 'status ' + grab.status);

    /* AND A RESTORE TO THE WRONG PATH BELONGS TO NOBODY, which is the
       property that makes path-preservation the whole of the mapping. */
    const nowhere = '00000000-0000-0000-0000-000000000000/' + TAG + '-orphan.png';
    const r = await store(tA, 'POST', nowhere, png(9), 'image/png');
    ok('an object restored under a studio nobody belongs to is refused outright',
       r.status >= 400, 'status ' + r.status);
  }

  /* ------------------------------------------------------------------ */
  section('7. Tidying up after itself');
  for (const m of manifest) await store(tA, 'DELETE', m.path);
  const left = await list(tA, A + '/');
  const mess = left.items.filter(i => i.name && i.name.includes(TAG));
  ok('the probe leaves nothing behind in the bucket', mess.length === 0,
     JSON.stringify(mess.map(i => i.name)));
  try { for (const m of manifest) fs.unlinkSync(m.local);
        fs.unlinkSync(path.join(OUT, 'manifest.json')); fs.rmdirSync(OUT); } catch {}

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) console.log('\nSTORAGE RECOVERY IS NOT PROVEN.');
  else console.log('\nObjects were backed up with their paths, lost, restored byte for\nbyte, and the studio walls held before and after. The path is the\ntenant, so preserving it is the whole of preserving ownership.');
  process.exit(fail ? 1 : 0);
})();
