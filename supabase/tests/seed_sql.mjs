/* Turn the headless run into a seed migration. The settings blob is taken
   from the app's own applyExampleStudio(), so the trade, its stages, its
   catalogue and its wording are whatever the app actually produces rather
   than a second copy of them written in SQL that would drift. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');
const seed = JSON.parse(readFileSync(join(repo, '.seed', 'studios.json'), 'utf8'));

const STUDIOS = [
  { key: 'bespoke',  slug: 'ade-bespoke',        email: 'test.bespoke@thelabelboard.com' },
  { key: 'footwear', slug: 'okoro-and-sons',     email: 'test.footwear@thelabelboard.com' },
  { key: 'leather',  slug: 'ife-leather',        email: 'test.leather@thelabelboard.com' },
  { key: 'rtw',      slug: 'house-of-nneka',     email: 'test.rtw@thelabelboard.com' },
  { key: 'fabrics',  slug: 'balogun-fabrics',    email: 'test.fabrics@thelabelboard.com' },
  { key: 'multi',    slug: 'layi-multi-studio',  email: 'test.multi@thelabelboard.com' },
];

const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const lines = [];

lines.push(`-- =====================================================================
-- Six studios to test against, one per trade.
--
-- Each is a real tenant: its own business row, its own branches, its own
-- settings. None of them has an owner yet — pending_owner_email says which
-- address will claim it, and the trigger in studio_onboarding attaches the
-- account as owner the moment it is created in Auth. That split is
-- deliberate: a studio can be fully prepared here, and the password is set
-- by a person, in the dashboard, and never appears in this repo.
--
-- The settings blob is generated from the app's own applyExampleStudio(),
-- not written by hand, so each studio's trade, production stages,
-- catalogue and item wording are exactly what the app produces for that
-- trade. Regenerate with supabase/tests/seed_gen.mjs if the presets move.
--
-- ownerPassword is stripped. It is the local demo PIN and has no meaning
-- for an account that signs in through Supabase Auth, and a column called
-- password in a seeded row is a thing somebody will one day copy.
--
-- Orders, products and staff are NOT seeded. The app already fills an
-- empty cloud from the device on first sign-in (hydrateFromCloud calls
-- pushAllState when it finds nothing), so loading the matching example in
-- the browser and signing in gives each studio its full worked data —
-- about 109 KB of it — without that data living in a migration.
--
-- Idempotent: re-running adopts the existing rows rather than duplicating
-- them, so this is safe to replay when resetting a test environment.
-- =====================================================================
`);

for (const s of STUDIOS) {
  const bundle = seed[s.key];
  if (!bundle) throw new Error('no generated data for ' + s.key);
  const settings = JSON.parse(JSON.stringify(bundle.settingsDiff));
  delete settings.ownerPassword;
  const name = (settings.company && settings.company.name) || s.slug;
  const branches = (settings.branches || []).map(b => b.name);

  /* applyExampleStudio only re-skins company.name, so everything else in the
     company block is still the demo tenant's: LAYI's address, its RC number,
     and three bank accounts. Seeding those into six unrelated studios would
     put made-up account numbers in front of anyone testing an invoice, and
     they would be the same made-up numbers in all six. Keep the name, give
     each studio its own branch address and contact, and leave the rest for
     whoever sets the studio up to fill in. */
  const loc = (settings.branches && settings.branches[0] && settings.branches[0].location) || '';
  settings.company = {
    name,
    address: loc,
    email: s.email,
    phone: '',
    reg: '',
    logo: '',
    payInstructions: 'Balance due on collection.',
    showPhotos: true,
    banks: [],
  };

  /* recipes map a garment to supply ids from the bespoke example. Nothing
     seeds those supplies, and a shoemaker has no use for an agbada recipe
     regardless, so it would be a broken reference dressed up as data. */
  delete settings.recipes;

  lines.push(`
-- ---- ${name} (${s.key}) ----`);
  lines.push(`do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where slug = ${q(s.slug)};
  if v_biz is null then
    insert into public.businesses (name, slug, plan, status, contact_email, pending_owner_email)
    values (${q(name)}, ${q(s.slug)}, ${q(settings.plan === 'trial' ? 'trial' : 'starter')}, 'active', ${q(s.email)}, ${q(s.email)})
    returning id into v_biz;
  end if;
${branches.map(b => `
  if not exists (select 1 from public.branches where business_id = v_biz and name = ${q(b)}) then
    insert into public.branches (business_id, name) values (v_biz, ${q(b)});
  end if;`).join('')}

  insert into public.app_state (business_id, key, data, updated_at)
  values (v_biz, 'layi_dash_settings', ${q(JSON.stringify(settings))}::jsonb, now())
  on conflict (business_id, key) do update set data = excluded.data, updated_at = now();
end $$;`);
}

const sql = lines.join('\n') + '\n';
const out = join(repo, 'supabase', 'migrations', '20260904170000_seed_test_studios.sql');
writeFileSync(out, sql);
console.log('wrote ' + out.replace(repo, '.') + '  ' + (Buffer.byteLength(sql) / 1024).toFixed(1) + ' KB');
console.log('\nstudios and the address that claims each:');
for (const s of STUDIOS) {
  const n = (seed[s.key].state['layi_dash_settings'].company || {}).name;
  console.log('  ' + String(n).padEnd(22) + s.email);
}
