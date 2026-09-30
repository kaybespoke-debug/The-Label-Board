/* =====================================================================
   REPAIR: orders that were imported before history was a real thing.

   Until 30 September 2026 the CSV order importer wrote records that
   looked live. Three consequences, all of them visible to the studio and
   none of them their fault:

     - every imported order arrived at stage 0, so a job delivered in
       2024 sat on the production board as work for the bench, in the
       chase list, and overdue against a date long gone
     - its deposit was written onto the order and never became a
       transaction. The headline money figures in this app are CASH
       basis, so those studios have correct balances and an empty
       revenue chart
     - the only marker was the word "Imported" in a notes field, which
       nothing read

   The app is fixed. This is for data that came in before the fix. It
   finds those orders by the marker they do carry, and for each one:

     1. sets doc.historical = true
     2. maps the stored status to a stage, so delivered work files
        itself as finished instead of sitting on the board. The client
        decides open-versus-finished from the stage on load, so setting
        the stage here is the whole of that move
     3. creates the missing transaction for a deposit, dated when the
        money arrived rather than today

   DRY RUN IS THE DEFAULT. It writes nothing without --apply, and it
   prints what it would change per business either way.

   usage:
     node tools/repair_imported_orders.js                  # dry run
     node tools/repair_imported_orders.js --business <uuid>
     node tools/repair_imported_orders.js --apply          # writes

   needs, from the environment and never from a file in this repo:
     SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY

   The service role is required because this reads across every studio,
   which no tenant key can do and no tenant should be able to.
   ===================================================================== */
'use strict';

const APPLY    = process.argv.includes('--apply');
const ONLY_BIZ = (function () {
  const i = process.argv.indexOf('--business');
  return i >= 0 ? process.argv[i + 1] : null;
})();

/* A fixture stands in for the three reads this makes, so the logic can be proven
   without a service-role key and without touching a real studio. It is how this
   script was verified before it was ever pointed at a project. --apply is refused
   against a fixture, because there is nothing there to write to. */
const FIXTURE = (function () {
  const i = process.argv.indexOf('--fixture');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const URL = FIXTURE ? 'fixture://' + FIXTURE : process.env.SUPABASE_URL;
const KEY = FIXTURE ? 'fixture' : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment,');
  console.error('or pass --fixture <file.json> to run the logic against a local sample.');
  console.error('Nothing was read and nothing was written.');
  process.exit(2);
}
if (FIXTURE && APPLY) {
  console.error('--apply cannot be used with --fixture. A fixture is a file, not a studio.');
  process.exit(2);
}

/* The stages, and the words a spreadsheet uses for them. Kept in step with
   IMPORT_STAGE_WORDS in the app by hand, which is a cost worth naming: this
   script runs once per studio that needs it and then never again, so a copy
   is cheaper than a shared module in a repo with no build step. */
const STAGE_HEAD = 'Order Received';
const STAGE_TAIL = ['Quality Check', 'Ready for Delivery', 'Dispatched', 'Delivered'];
const DEFAULT_MIDDLE = ['Fabric Received', 'Cutting', 'Stitching', 'Fitting', 'Finishing'];
const STAGE_WORDS = [
  [['delivered','completed','complete','collected','picked up','pickup','fulfilled','closed','done','finished','shipped'], 'Delivered'],
  [['dispatched','sent out','with courier','out for delivery','in transit'], 'Dispatched'],
  [['ready','ready for delivery','awaiting collection','awaiting pickup','for collection'], 'Ready for Delivery'],
  [['qc','quality','quality check','checking','inspection'], 'Quality Check'],
  [['finishing','finish','hemming','pressing'], 'Finishing'],
  [['fitting','fit','first fitting'], 'Fitting'],
  [['sewing','stitching','stitch','in progress','wip','production','making','being made','at the tailor'], 'Stitching'],
  [['cutting','cut','cut out'], 'Cutting'],
  [['fabric received','fabric in','materials received','material in'], 'Fabric Received'],
  [['received','new','pending','order received','booked','placed','confirmed','open'], 'Order Received'],
];
const PAY_WORDS = ['paid','unpaid','partial','part payment','part','deposit','settled','outstanding','owing','balance','due'];

function stagesFor(settings) {
  const mid = (settings && Array.isArray(settings.productionStages) && settings.productionStages.length)
    ? settings.productionStages : DEFAULT_MIDDLE;
  return [STAGE_HEAD].concat(mid, STAGE_TAIL);
}
function stageFor(text, STAGES) {
  const raw = String(text || '').trim();
  if (!raw) return { index: 0, known: false, raw: '' };
  const t = raw.toLowerCase();
  if (PAY_WORDS.indexOf(t) >= 0) return { index: 0, known: false, raw: raw, payWord: true };
  const exact = STAGES.findIndex(s => s.toLowerCase() === t);
  if (exact >= 0) return { index: exact, known: true, raw: raw };
  for (const [words, target] of STAGE_WORDS) {
    if (words.indexOf(t) < 0) continue;
    let at = STAGES.indexOf(target);
    if (at < 0) at = (target === 'Delivered') ? Math.max(0, STAGES.length - 1) : 0;
    return { index: at, known: true, raw: raw };
  }
  return { index: 0, known: false, raw: raw };
}

/* The fixture answers the same three questions the database does, matched on the
   same query strings, so nothing above or below here knows which it is talking to. */
const FX = FIXTURE ? JSON.parse(require('fs').readFileSync(FIXTURE, 'utf8')) : null;
function fixtureRead(path) {
  if (/^businesses/.test(path)) return FX.businesses || [];
  if (/^orders\?business_id=eq\.([0-9a-f-]+)/.test(path)) {
    const id = path.match(/business_id=eq\.([0-9a-f-]+)/)[1];
    return (FX.orders || []).filter(o => o.business_id === id);
  }
  if (/^app_state/.test(path)) {
    const id = path.match(/business_id=eq\.([0-9a-f-]+)/)[1];
    const s = (FX.settings || {})[id];
    return s ? [{ data: s }] : [];
  }
  if (/^transactions/.test(path)) {
    const id = path.match(/business_id=eq\.([0-9a-f-]+)/)[1];
    return (FX.transactions || []).filter(t => t.business_id === id && t.kind === 'in');
  }
  return [];
}

const rest = async (path, opts) => {
  if (FIXTURE) {
    if (opts && opts.method && opts.method !== 'GET')
      throw new Error('a fixture run tried to write, which should be impossible');
    return fixtureRead(path);
  }
  const r = await fetch(URL.replace(/\/$/, '') + '/rest/v1/' + path, Object.assign({
    headers: {
      apikey: KEY, Authorization: 'Bearer ' + KEY,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
  }, opts || {}));
  const body = await r.text();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + body.slice(0, 300));
  return body ? JSON.parse(body) : null;
};

/* The marker an imported order carries. Deliberately several, because the
   importer has written more than one shape over time and a repair that
   misses half the rows is worse than no repair: it leaves a studio with
   two kinds of history and no way to tell them apart. */
function looksImported(o) {
  const d = o.doc || {};
  if (d.historical === true) return false;                 // already repaired
  if (String(d.notes || '').toLowerCase().indexOf('import') >= 0) return true;
  if (/^web-csv-/.test(String(o.app_id || ''))) return true;
  return false;
}
const money = n => '₦' + Number(n || 0).toLocaleString('en-NG');

(async function main() {
  console.log('');
  console.log('REPAIR: imported orders that were written as live work');
  console.log('mode: ' + (APPLY ? '*** APPLY, this writes ***' : 'dry run, nothing will be written'));
  console.log('project: ' + URL.replace(/^https?:\/\//, '').split('.')[0]);
  console.log('');

  let businesses = await rest('businesses?select=id,name&order=name');
  if (ONLY_BIZ) businesses = businesses.filter(b => b.id === ONLY_BIZ);
  if (!businesses.length) { console.log('No businesses matched.'); return; }

  const totals = { biz: 0, orders: 0, toFinished: 0, stayed: 0, txns: 0, money: 0, unknown: [] };

  for (const b of businesses) {
    const orders = await rest('orders?business_id=eq.' + b.id + '&select=id,app_id,doc,created_at');
    const mine = orders.filter(looksImported);
    if (!mine.length) continue;

    const st = await rest('app_state?business_id=eq.' + b.id + '&key=eq.layi_dash_settings&select=data');
    const STAGES = stagesFor(st && st[0] && st[0].data);
    const DELIVERED = STAGES.indexOf('Delivered');

    const existing = await rest('transactions?business_id=eq.' + b.id + '&select=app_id,detail&kind=eq.in');
    const haveRef = new Set();
    existing.forEach(t => {
      const ref = (t.detail && t.detail.importRef) || '';
      if (ref) haveRef.add(ref);
    });

    console.log('=== ' + b.name + '  (' + b.id + ')');
    console.log('    ' + mine.length + ' imported order' + (mine.length === 1 ? '' : 's') + ' to repair');
    totals.biz++;

    let toFinished = 0, stayed = 0, txns = 0, added = 0;
    for (const o of mine) {
      const d = o.doc || {};
      const src = d.importStatus || d.status || '';
      const s = stageFor(src, STAGES);
      if (!s.known && s.raw && !s.payWord && totals.unknown.indexOf(s.raw) < 0) totals.unknown.push(s.raw);

      const paid = Number(d.paid || 0);
      const value = Number(d.value || 0);
      const settles = DELIVERED >= 0 && s.index >= DELIVERED && paid >= value;
      settles ? toFinished++ : stayed++;

      const needsTxn = paid > 0 && !haveRef.has(o.app_id);
      if (needsTxn) { txns++; added += paid; }

      const was = STAGES[Math.max(0, Math.min(STAGES.length - 1, Number(d.stageIndex) || 0))];
      console.log('      ' + String(o.app_id || o.id).slice(0, 28).padEnd(30)
        + String(d.client || 'Client').slice(0, 18).padEnd(20)
        + (was + ' -> ' + STAGES[s.index]).padEnd(34)
        + (settles ? '[finished]  ' : '[stays live] ')
        + (needsTxn ? '+ ' + money(paid) + ' on ' + String(d.createdAt || o.created_at).slice(0, 10) : ''));

      if (APPLY) {
        const doc = Object.assign({}, d, { historical: true, stageIndex: s.index });
        if (settles && !doc.deliveredAt) doc.deliveredAt = d.createdAt || o.created_at;
        await rest('orders?id=eq.' + o.id, { method: 'PATCH', body: JSON.stringify({ doc: doc }) });
        if (needsTxn) {
          await rest('transactions', {
            method: 'POST',
            body: JSON.stringify({
              business_id: b.id,
              order_id: o.id,
              kind: 'in',
              amount: paid,
              at: d.createdAt || o.created_at,
              app_id: 't-repair-' + o.app_id,
              method: '',
              note: (d.client || 'Client') + ' · imported payment (' + o.app_id + ')',
              detail: { historical: true, importRef: o.app_id, channel: 'Imported' },
            }),
          });
        }
      }
    }
    console.log('    -> ' + toFinished + ' to finished, ' + stayed + ' stay live, '
      + txns + ' payment' + (txns === 1 ? '' : 's') + ' worth ' + money(added));
    console.log('');
    totals.orders += mine.length; totals.toFinished += toFinished;
    totals.stayed += stayed; totals.txns += txns; totals.money += added;
  }

  console.log('--------------------------------------------------------');
  if (!totals.biz) {
    console.log('Nothing to repair. No business has an order carrying an import marker.');
  } else {
    console.log('businesses affected : ' + totals.biz);
    console.log('orders to flag      : ' + totals.orders);
    console.log('  to finished       : ' + totals.toFinished);
    console.log('  staying live      : ' + totals.stayed);
    console.log('payments to create  : ' + totals.txns + '  (' + money(totals.money) + ')');
    if (totals.unknown.length)
      console.log('statuses not placed : ' + totals.unknown.join(', ') + '  (left at the first stage)');
  }
  console.log(APPLY ? 'WRITTEN.' : 'Dry run. Nothing was written. Re-run with --apply to make these changes.');
  console.log('');
})().catch(e => { console.error('\nFailed: ' + e.message); process.exit(1); });
