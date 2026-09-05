// Photos: where they are stored, and whether they still appear with no signal.
//
// Two halves, both of which can fail silently, which is why this exists.
//
// THE APP HALF. Photos were base64 data URLs inside order records, and orders
// sync as one whole app_state row — so every photo was written into Postgres,
// re-read on every sign-in and re-broadcast to every device on every order
// update. They now live in object storage and the record holds a path. The
// thing that must never regress: an upload that cannot happen (no signal, a
// server that said no) keeps the bytes on the device rather than losing them,
// and a sweep moves them up later. That same sweep is the migration for the
// photos that were already in the database, so it is exercised constantly
// rather than once.
//
// THE SERVICE WORKER HALF, which is the fiddly one. The bucket is private, so
// a photo is fetched through a SIGNED url whose token changes every time one
// is minted. Cached naively by full URL, every request after a refresh is a
// miss against an entry that is already there under a slightly different
// name: a cache that fills the disk and never answers, and photos that vanish
// the moment the signal drops. So the cache key is the object PATH with the
// query stripped, and these tests hold that line — along with the eviction
// bound, the refusal to cache an error, and the fact that a shell release
// must not wipe a studio's photo library.
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = __dirname;
/* verify.js hands every gate an ABSOLUTE path; run by hand it is usually a
   relative one. path.join() on an absolute path produces nonsense, so resolve
   against the repo only when it is relative. */
const argPath = process.argv[2] || 'site/layi_dashboard.html';
const appPath = path.isAbsolute(argPath) ? argPath : path.join(root, argPath);
const html = fs.readFileSync(appPath, 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'site/sw.js'), 'utf8');

let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* =====================================================================
   PART ONE — the app
   ===================================================================== */
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html))) {
  const a = m[1] || '';
  if (/\bsrc\s*=/.test(a)) continue;
  const t = a.match(/type\s*=\s*["']([^"']+)["']/i);
  if (t && !/javascript|module/i.test(t[1])) continue;
  code += '\n;' + m[2] + '\n';
}
const cache = {}, _ls = {};
const mkEl = id => ({ _id: id, innerHTML: '', value: '', checked: false, textContent: '', placeholder: '', style: {}, dataset: {}, options: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, setAttribute() {}, getAttribute() { return null }, appendChild(c) { return c }, addEventListener() {}, removeEventListener() {}, querySelector() { return null }, querySelectorAll() { return [] }, focus() {} });
let alerts = [], toasts = [];
const sb = {
  console: { log() {}, warn() {}, error() {}, debug() {} },
  document: { getElementById(i) { return cache[i] || (cache[i] = mkEl(i)) }, querySelector() { return mkEl() }, querySelectorAll() { return [] }, createElement() { return mkEl() }, addEventListener() {}, removeEventListener() {}, body: mkEl(), documentElement: mkEl(), head: mkEl() },
  localStorage: { getItem(k) { return k in _ls ? _ls[k] : null }, setItem(k, v) { _ls[k] = String(v) }, removeItem(k) { delete _ls[k] } },
  setTimeout: f => { try { f && f() } catch (e) {} }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: f => { try { f && f() } catch (e) {} },
  navigator: { userAgent: 'node', onLine: true, storage: { persisted: async () => true, persist: async () => true } },
  location: { href: '', hash: '', search: '' },
  alert(msg) { alerts.push(String(msg)); }, confirm() { return true }, prompt() { return '' },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  Blob: class { constructor(parts, opts) { this.size = (parts[0] && parts[0].length) || 0; this.type = (opts || {}).type || ''; } },
  Uint8Array, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, Error, Intl,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent
};
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(code, sb, { filename: 'app' });
sb.demoLogin();
const run = e => vm.runInContext(e, sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
sb.toast = msg => toasts.push(String(msg));

// ---------------------------------------------------------------------
section('A photo is a path, not a blob of bytes');
// ---------------------------------------------------------------------
{
  ok('a stored photo is recognised by its marker',
    run("isStoredPhoto('sb:biz/progress/x.webp')") === true);
  ok('and a data URL is not mistaken for one',
    run("isStoredPhoto('data:image/webp;base64,AAAA')") === false);
  ok('an inline photo is recognised',
    run("isInlinePhoto('data:image/webp;base64,AAAA')") === true);
  ok('the path can be read back off it',
    run("storedPath('sb:biz/progress/x.webp')") === 'biz/progress/x.webp');
  ok('a stored photo with no signed URL yet renders a blank pixel, not a broken image',
    run("photoSrc('sb:biz/progress/never-signed.webp')").slice(0, 10) === 'data:image');
  ok('an inline photo still renders itself, so nothing regresses offline',
    run("photoSrc('data:image/webp;base64,AAAA')") === 'data:image/webp;base64,AAAA');
  ok('and a stored photo renders its signed URL once there is one',
    run("(function(){var m=mediaUrls();m['b/p/x.webp']={url:'https://s.co/storage/v1/object/sign/studio-media/b/p/x.webp?token=T',exp:9e9};return photoSrc('sb:b/p/x.webp');})()")
      .indexOf('token=T') > 0);
}

// ---------------------------------------------------------------------
section('Every photo-bearing record is swept, and none is invented');
// ---------------------------------------------------------------------
{
  /* If a new place to attach a photo is added and not listed here, its
     photos stay in the database forever and nobody notices, because the
     app works perfectly — it just costs 7.8x more than it should. */
  const src = html;
  ['clientPhotos', 'outfits', 'updates'].forEach(f =>
    ok('the sweep covers order ' + f, new RegExp('o\\.' + f + '\\|\\|\\[\\]|' + f).test(
      (src.match(/async function sweepInlinePhotos[\s\S]*?\n\}/) || [''])[0])));
  const sweep = (src.match(/async function sweepInlinePhotos[\s\S]*?\n\}/) || [''])[0];
  ok('and customer photos', /getCustomers\(\)/.test(sweep));

  /* Every place a photo is ADDED has to route through storage, or that one
     category quietly keeps writing base64 into the database and costs 7.8x
     while everything looks perfectly fine. */
  [['progress photos', "updateDraft.photos.push(await saveImageAsset(await compressFor(f,'progress'),'progress'))"],
   ['a client\'s own photos', "draft.clientPhotos.push(await saveImageAsset(await compressFor(f,'reference'),'client'))"],
   ['outfit photos', "draft.outfits[i].photos.push(await saveImageAsset(await compressFor(f,'reference'),'outfit'))"],
   ['photos added on the client record', "cust.photos.push(await saveImageAsset(await compressFor(f,'reference'),'client'))"]
  ].forEach(([label, needle]) =>
    ok(label + ' are compressed and put in storage', src.indexOf(needle) !== -1,
      'this category is still being written into the database as base64'));
  ok('the counter counts the same places the sweep moves',
    ['clientPhotos', 'outfits', 'updates', 'getCustomers'].every(f =>
      new RegExp(f).test((src.match(/function inlinePhotoCount[\s\S]*?\n\}/) || [''])[0])));
}

/* saveImageAsset is async and these assertions are about what it RESOLVES
   to, so they live in the async section below — read synchronously they were
   reading a promise that had not settled and reporting null, which is a test
   that can only ever pass by accident. */

// ---------------------------------------------------------------------
section('Full means uploads pause, and nothing else');
// ---------------------------------------------------------------------
{
  const setUsage = (used, cap) =>
    run("saveLocal('layi_dash_storage_usage',{used:" + used + ",cap:" + cap + ",pct:" + (cap ? Math.round(used * 1000 / cap) / 10 : 0) + ",at:Date.now()});");

  setUsage(10e9, 20e9);
  ok('at 50% nothing is flagged', run("storageState().warn") === false && run("storageState().full") === false);

  setUsage(16e9, 20e9);
  ok('at 80% a warning appears', run("storageState().warn") === true, JSON.stringify(run("storageState()")));
  ok('but it is NOT full', run("storageState().full") === false);
  alerts = [];
  ok('and an upload at 80% is not blocked', run("photoUploadBlocked()") === false);

  setUsage(20e9, 20e9);
  ok('at 100% it is full', run("storageState().full") === true);
  alerts = [];
  ok('and an upload IS blocked', run("photoUploadBlocked()") === true);
  const msg = alerts.join(' ');
  ok('the studio is told why, never a silent failure', msg.length > 0);
  ok('and told that everything else still works',
    /orders, clients, finance/i.test(msg) && /only new photo uploads/i.test(msg), msg);
  ok('and told how to fix it', /upgrade|talk to us/i.test(msg), msg);

  /* The promise that matters most: a full studio is not a stopped studio. */
  ok('saving an order does not consult storage at all',
    !/storageState\(\)|photoUploadBlocked\(\)/.test((html.match(/function saveOrder\(\)[\s\S]{0,3000}/) || [''])[0]),
    'the order save path checks the storage cap, so a full studio cannot trade');
  ok('nor does recording a payment',
    !/storageState\(\)|photoUploadBlocked\(\)/.test((html.match(/function savePayment\([\s\S]{0,2500}/) || [''])[0]));
  ok('nor does adding a client',
    !/storageState\(\)|photoUploadBlocked\(\)/.test((html.match(/function saveCustomer\([\s\S]{0,2000}/) || [''])[0]));

  // and the meter renders all three states
  ['50', '80', '100'].forEach((p, i) => {
    setUsage([10e9, 16e9, 20e9][i], 20e9);
    run("renderStorageMeter();");
    const box = run("(document.getElementById('storageMeter')||{}).innerHTML") || '';
    ok('the meter renders at ' + p + '%', box.length > 0);
    if (p === '80') ok('and says the figure out loud at 80%', /used/.test(box) && /GB/.test(box), box.slice(0, 120));
    if (p === '100') ok('and at 100% says only uploads are paused',
      /Only new photo uploads are paused/i.test(box), box.slice(0, 200));
  });

  run("saveLocal('layi_dash_storage_usage',{used:16e9,cap:20e9,pct:80,at:Date.now()});renderStorageMeter();");
  const box = run("(document.getElementById('storageMeter')||{}).innerHTML") || '';
  ok('and offers the way to buy more before they are stuck',
    /askForMoreStorage/.test(box), 'no "talk to us" route on a studio at 80%');
}

// ---------------------------------------------------------------------
section('The caps are the ones we agreed');
// ---------------------------------------------------------------------
{
  const P = run("PLANS");
  const by = {}; P.forEach(p => by[p.id] = p);
  ok('Basic is 20 GB', by.starter.storageGb === 20, String(by.starter.storageGb));
  ok('Pro is 200 GB', by.pro.storageGb === 200, String(by.pro.storageGb));
  ok('Bespoke has the most room', by.premium.storageGb > by.pro.storageGb);
  /* The app's number and the database's number are enforced in different
     places and must agree, or a studio is told one thing and refused by
     another. */
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20260905120000_studio_media_storage.sql'), 'utf8');
  [['starter', 20], ['pro', 200], ['trial', 2]].forEach(([id, gb]) => {
    ok('the database agrees that ' + id + ' is ' + gb + ' GB',
      new RegExp("when '" + id + "'\\s+then\\s+" + gb + "::bigint").test(mig),
      'app says ' + by[id].storageGb + ' GB');
  });
}

/* =====================================================================
   PART TWO — the service worker
   ===================================================================== */
section('The service worker: photos survive with no signal');

/* A Cache API faithful enough to catch the bugs that matter: keys are
   compared by URL, bodies have a size, and nothing is stored unless the
   worker actually asks for it. */
function bootSW(opts) {
  opts = opts || {};
  const stores = {};
  class FakeHeaders {
    constructor(h) { this._h = h || {}; }
    get(k) { return this._h[String(k).toLowerCase()] ?? null; }
  }
  class FakeResponse {
    constructor(body, init) {
      init = init || {};
      this._body = body || new Uint8Array(0);
      this.status = init.status === undefined ? 200 : init.status;
      this.headers = new FakeHeaders(
        Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])));
      this._tag = init._tag;
    }
    clone() { const r = new FakeResponse(this._body, { status: this.status, headers: {}, _tag: this._tag }); r.headers = this.headers; return r; }
    async arrayBuffer() { return { byteLength: this._body.length || this._body.byteLength || 0 }; }
  }
  class FakeRequest {
    constructor(url, init) { this.url = String(url); this.method = (init || {}).method || 'GET'; this.mode = (init || {}).mode || ''; this.headers = new FakeHeaders({}); }
  }
  class FakeCache {
    constructor() { this._m = new Map(); }
    async match(req) { return this._m.get(typeof req === 'string' ? req : req.url) || undefined; }
    async put(req, res) { this._m.set(typeof req === 'string' ? req : req.url, res); }
    async delete(req) { return this._m.delete(typeof req === 'string' ? req : req.url); }
    async keys() { return [...this._m.keys()].map(u => new FakeRequest(u)); }
    async addAll() {}
  }
  const caches = {
    async open(n) { return stores[n] || (stores[n] = new FakeCache()); },
    async keys() { return Object.keys(stores); },
    async delete(n) { const had = n in stores; delete stores[n]; return had; },
    async match(req) { for (const n of Object.keys(stores)) { const h = await stores[n].match(req); if (h) return h; } return undefined; }
  };
  const handlers = {};
  const self_ = {
    addEventListener(k, fn) { handlers[k] = fn; },
    skipWaiting() {}, clients: { claim() {} }, registration: { showNotification() {} },
    location: { origin: 'https://app.example.com' }
  };
  const fetchLog = [];
  const ctx = {
    self: self_, caches, fetch: async (req) => {
      fetchLog.push(typeof req === 'string' ? req : req.url);
      if (opts.offline) throw new Error('offline');
      return opts.fetchImpl ? opts.fetchImpl(req, FakeResponse) : new FakeResponse(new Uint8Array(1000), { status: 200, headers: { 'content-type': 'image/webp' } });
    },
    Response: FakeResponse, Request: FakeRequest, Headers: FakeHeaders, URL,
    Uint8Array, Promise, Map, Set, Object, Array, JSON, Math, Date, Error, String, Number, Boolean,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    console: { log() {}, warn() {}, error() {} }
  };
  ctx.globalThis = ctx; ctx.self = self_;
  vm.createContext(ctx);
  vm.runInContext(swSrc, ctx, { filename: 'sw.js' });
  return { ctx, handlers, caches, stores, self_, fetchLog, FakeRequest, FakeResponse };
}

(async function main(){

/* Let every promise the code under test started actually finish. Several
   things here are deliberately fire-and-forget in the app — the cache trim
   runs after a put rather than blocking the response — so measuring
   immediately measures the moment before the work happens. */
const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise(r => setImmediate(r)); };

// ---------------------------------------------------------------------
section('An upload that cannot happen never loses the photo');
// ---------------------------------------------------------------------
{
  const DATA = 'data:image/webp;base64,UklGRhoAAABXRUJQ';
  const call = async (js) => {
    run("globalThis.__t='PENDING';" + js + ".then(function(r){globalThis.__t=r;},function(){globalThis.__t='THREW';});");
    await settle();
    return run("globalThis.__t");
  };

  /* A controllable backend. Without one, saveImageAsset returns at its very
     first guard and every branch past it goes untested — which is exactly
     what happened: the "offline" case below was passing while never reaching
     the offline check at all, and a mutant that dropped the photo survived. */
  sb.__uploadMode = 'ok';
  run(`supa={storage:{from:function(){return{
    upload:async function(p){
      if(globalThis.__uploadMode==='throw')throw new Error('network died');
      if(globalThis.__uploadMode==='full')return {error:{message:'new row violates row-level security policy'}};
      if(globalThis.__uploadMode==='error')return {error:{message:'503 upstream'}};
      return {error:null,data:{path:p}};
    },
    createSignedUrls:async function(paths){
      return {data:paths.map(function(p){return {path:p,signedUrl:'https://x.co/storage/v1/object/sign/studio-media/'+p+'?token=T'};}),error:null};
    }};}}};`);

  // no backend at all: the demo, or a studio before it has one
  run("liveMode=false;");
  const noBackend = await call("saveImageAsset(" + JSON.stringify(DATA) + ",'progress')");
  ok('with no backend the bytes are handed straight back', noBackend === DATA, String(noBackend));

  // the happy path
  run("liveMode=true;myBusinessId='biz-1';navigator.onLine=true;globalThis.__uploadMode='ok';");
  const uploaded = await call("saveImageAsset(" + JSON.stringify(DATA) + ",'progress')");
  ok('online, the photo goes to storage and the record holds a path',
    run("isStoredPhoto(globalThis.__t)") === true, String(uploaded));
  ok('and the path is inside the studio\'s own folder',
    String(uploaded).indexOf('sb:biz-1/') === 0, String(uploaded));
  ok('and it is no longer bytes, which is the whole point',
    String(uploaded).indexOf('data:') < 0);

  // offline — the workroom with no signal, which must never lose a photo
  run("navigator.onLine=false;");
  const offline = await call("saveImageAsset(" + JSON.stringify(DATA) + ",'progress')");
  ok('offline, the photo is kept on the device instead of being dropped',
    offline === DATA, String(offline));
  ok('and is kept as bytes, so the sweep can find it later',
    run("isInlinePhoto(globalThis.__t)") === true);

  // the upload threw
  run("navigator.onLine=true;globalThis.__uploadMode='throw';");
  const threw = await call("saveImageAsset(" + JSON.stringify(DATA) + ",'progress')");
  ok('an upload that throws keeps the photo rather than losing it',
    threw === DATA, String(threw));

  // the server refused for a reason that is not the cap
  run("globalThis.__uploadMode='error';");
  toasts = [];
  const errored = await call("saveImageAsset(" + JSON.stringify(DATA) + ",'progress')");
  ok('a server error keeps the photo too', errored === DATA, String(errored));
  ok('and the studio is told it will go up later, never left guessing',
    toasts.join(' ').length > 0, 'nothing was said');

  // the cap: the one refusal the studio can act on
  run("globalThis.__uploadMode='full';");
  alerts = [];
  const full = await call("saveImageAsset(" + JSON.stringify(DATA) + ",'progress')");
  ok('a photo refused by the storage cap is still not lost', full === DATA, String(full));
  ok('and the studio is told the limit is the reason',
    /storage limit/i.test(alerts.join(' ')), alerts.join(' ').slice(0, 120));

  // something that is not bytes is left alone entirely
  run("globalThis.__uploadMode='ok';");
  const notPhoto = await call("saveImageAsset('sb:biz-1/progress/already.webp','progress')");
  ok('a photo already in storage is not uploaded twice',
    notPhoto === 'sb:biz-1/progress/already.webp', String(notPhoto));

  run("navigator.onLine=true;liveMode=false;supa=null;");
}

async function doFetch(sw, url, init) {
  const req = new sw.FakeRequest(url, init);
  let answered = null;
  const ev = { request: req, respondWith(p) { answered = p; }, waitUntil(p) { return p; } };
  sw.handlers.fetch(ev);
  return answered ? await answered : null;
}

const SUPA = 'https://eskubrbgbcbaejynjxvh.supabase.co';
const OBJ = '/storage/v1/object/sign/studio-media/biz-1/progress/abc.webp';

// ---------------------------------------------------------------------
{
  const sw = bootSW();
  const r1 = await doFetch(sw, SUPA + OBJ + '?token=FIRST');
  ok('a photo is fetched from the network the first time', r1 && r1.status === 200);
  ok('and stored', (await (await sw.caches.open('layi-media-v1')).keys()).length === 1);

  /* THE one that matters. A re-signed URL is a different string and must
     still hit. Cached by full URL this fails, the cache grows without
     bound, and every photo re-downloads after every refresh. */
  const before = sw.fetchLog.length;
  const r2 = await doFetch(sw, SUPA + OBJ + '?token=COMPLETELY-DIFFERENT');
  ok('a DIFFERENT signed url for the same photo hits the cache',
    sw.fetchLog.length === before, 'it went to the network again, so the cache key still includes the token');
  ok('and returns the image', r2 && r2.status === 200);

  const keys = (await (await sw.caches.open('layi-media-v1')).keys()).map(k => k.url);
  ok('the cache key carries no token', keys.every(u => u.indexOf('token') < 0), keys.join(' '));
  ok('and is the object path', keys[0] === SUPA + OBJ, keys[0]);
  ok('only one entry exists for one photo', keys.length === 1, String(keys.length));
}

// ---------------------------------------------------------------------
{
  // offline, with the photo already cached
  const sw = bootSW();
  await doFetch(sw, SUPA + OBJ + '?token=A');
  sw.ctx.fetch = async () => { throw new Error('offline'); };
  const r = await doFetch(sw, SUPA + OBJ + '?token=EXPIRED-LONG-AGO');
  ok('offline, with an expired token, the photo still appears',
    r && r.status === 200, 'a studio with no signal sees a broken image');

  // offline, never seen
  const r2 = await doFetch(sw, SUPA + '/storage/v1/object/sign/studio-media/biz-1/progress/never.webp?token=X');
  ok('a photo never seen before degrades to a blank pixel, not an error page',
    r2 && r2.status === 200 && (r2.headers.get('content-type') || '').indexOf('image/') === 0);
}

// ---------------------------------------------------------------------
{
  // an error must never be cached, or one bad moment poisons the photo
  const sw = bootSW({
    fetchImpl: (req, R) => new R(new Uint8Array(30), { status: 400, headers: { 'content-type': 'application/json' } })
  });
  const r = await doFetch(sw, SUPA + OBJ + '?token=EXPIRED');
  ok('a rejected token is passed through', r && r.status === 400);
  ok('and is NOT cached, so the photo recovers once re-signed',
    (await (await sw.caches.open('layi-media-v1')).keys()).length === 0,
    'an error response was cached and that photo is now permanently broken');

  const sw2 = bootSW({
    fetchImpl: (req, R) => new R(new Uint8Array(30), { status: 200, headers: { 'content-type': 'text/html' } })
  });
  await doFetch(sw2, SUPA + OBJ + '?token=T');
  ok('and neither is a 200 that is not an image',
    (await (await sw2.caches.open('layi-media-v1')).keys()).length === 0);
}

// ---------------------------------------------------------------------
{
  // the bound actually holds, and evicts oldest first
  const MB = 1024 * 1024;
  const sw = bootSW({
    fetchImpl: (req, R) => new R(new Uint8Array(20 * MB), { status: 200, headers: { 'content-type': 'image/webp' } })
  });
  for (let i = 0; i < 20; i++) {
    await doFetch(sw, SUPA + '/storage/v1/object/sign/studio-media/biz-1/progress/p' + i + '.webp?token=T');
    await settle(3);   // the trim runs after the put, not before the response
  }
  await settle(12);
  const c = await sw.caches.open('layi-media-v1');
  const keys = await c.keys();
  let total = 0;
  for (const k of keys) { const res = await c.match(k); total += (await res.arrayBuffer()).byteLength; }
  ok('the media cache stays under its bound', total <= 300 * MB,
    Math.round(total / MB) + 'MB of a 300MB cap — it can fill a phone');
  ok('and it kept the newest, not the oldest',
    keys.some(k => k.url.indexOf('p19.webp') > 0), 'the most recent photo was evicted');
  ok('and dropped the oldest',
    !keys.some(k => k.url.indexOf('/p0.webp') > 0), 'eviction is not oldest-first');
}

// ---------------------------------------------------------------------
{
  /* A release must not wipe the studio's photos. The activate handler
     deletes every cache that is not the current shell — and the media
     cache has to be spared by name, or every update silently re-downloads
     the library and leaves anybody with no signal looking at blanks. */
  const sw = bootSW();
  await doFetch(sw, SUPA + OBJ + '?token=T');
  await sw.caches.open('layi-v1-ANCIENT-SHELL');
  let done;
  sw.handlers.activate({ waitUntil(p) { done = p; } });
  await done;
  const names = await sw.caches.keys();
  ok('an old shell cache is cleared on release', !names.includes('layi-v1-ANCIENT-SHELL'));
  ok('and the media cache SURVIVES it', names.includes('layi-media-v1'),
    'a release wipes every studio photo held for offline');
  ok('the photos are still in it',
    (await (await sw.caches.open('layi-media-v1')).keys()).length === 1);
}

// ---------------------------------------------------------------------
{
  // the API, auth and realtime must be left completely alone
  const sw = bootSW();
  const r = await doFetch(sw, SUPA + '/rest/v1/app_state?select=*');
  ok('the Supabase API is not intercepted', r === null,
    'the service worker answered an API call, which could serve stale data');
  const r2 = await doFetch(sw, SUPA + '/auth/v1/token?grant_type=password', { method: 'GET' });
  ok('and neither is auth', r2 === null);
  const r3 = await doFetch(sw, 'https://fonts.gstatic.com/s/x.woff2');
  ok('and a font is left to the network', r3 === null);
}

console.log('\n' + '='.repeat(64));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('Photos live in storage, survive with no signal, cannot fill the');
console.log('phone, and a full studio still keeps every one of its books.');
console.log('='.repeat(64));

})();
