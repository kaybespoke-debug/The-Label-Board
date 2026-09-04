-- =====================================================================
-- Clearing what one studio's device wrote into another's business.
--
-- hydrateFromCloud read an empty cloud as "a new studio's first device"
-- and pushed whatever was in localStorage up as that studio's data. So
-- signing into the test accounts from a device that already held the demo
-- tenant filled two of them with its supplies: 24 entries, opening stock
-- and all, under a shoemaker's name and a boutique's.
--
-- Nothing was wrong at the database. The rows arrived with the right
-- credentials, for the right business_id, and row level security did
-- precisely what it was asked. That is the point worth keeping: isolation
-- in the database cannot catch a client that sends the wrong data
-- correctly. audit_tenant_device.js is where that is caught now.
--
-- Scoped to the six seeded slugs, so it can never reach a real studio's
-- data, and idempotent — the seeded studios are meant to hold exactly one
-- key, their settings, and anything else arrived by this route.
-- =====================================================================

delete from public.app_state a
using public.businesses b
where b.id = a.business_id
  and a.key <> 'layi_dash_settings'
  and b.slug in ('ade-bespoke','okoro-and-sons','ife-leather',
                 'house-of-nneka','balogun-fabrics','layi-multi-studio');

delete from public.customers c
using public.businesses b
where b.id = c.business_id
  and b.slug in ('ade-bespoke','okoro-and-sons','ife-leather',
                 'house-of-nneka','balogun-fabrics','layi-multi-studio');

delete from public.suppliers s
using public.businesses b
where b.id = s.business_id
  and b.slug in ('ade-bespoke','okoro-and-sons','ife-leather',
                 'house-of-nneka','balogun-fabrics','layi-multi-studio');
