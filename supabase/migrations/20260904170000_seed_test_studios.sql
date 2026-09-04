-- =====================================================================
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


-- ---- Adé Bespoke (bespoke) ----
do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where slug = 'ade-bespoke';
  if v_biz is null then
    insert into public.businesses (name, slug, plan, status, contact_email, pending_owner_email)
    values ('Adé Bespoke', 'ade-bespoke', 'starter', 'active', 'test.bespoke@thelabelboard.com', 'test.bespoke@thelabelboard.com')
    returning id into v_biz;
  end if;

  if not exists (select 1 from public.branches where business_id = v_biz and name = 'The workroom') then
    insert into public.branches (business_id, name) values (v_biz, 'The workroom');
  end if;

  insert into public.app_state (business_id, key, data, updated_at)
  values (v_biz, 'layi_dash_settings', '{"company":{"name":"Adé Bespoke","address":"Yaba, Lagos","email":"test.bespoke@thelabelboard.com","phone":"","reg":"","logo":"","payInstructions":"Balance due on collection.","showPhotos":true,"banks":[]},"stagesV2":true,"branchScopeV1":true,"plan":"starter","budgets":{"Production":600000,"Marketing":150000,"Operations":400000,"Sales":120000},"branches":[{"id":"br-solo","name":"The workroom","location":"Yaba, Lagos","active":true,"does":["bespoke"],"type":"bespoke","channels":["showroom"]}],"productCatalog":[{"id":"pc-mtn396cibff","name":"Three-piece suit","category":"Garment","materials":[]},{"id":"pc-mtn396cijcm","name":"Agbada","category":"Garment","materials":[]},{"id":"pc-mtn396ci92z","name":"Kaftan","category":"Garment","materials":[]},{"id":"pc-mtn396ciiym","name":"Wedding gown","category":"Garment","materials":[]},{"id":"pc-mtn396cia6l","name":"Senator set","category":"Garment","materials":[]}],"garmentTypes":["Three-piece suit","Agbada","Kaftan","Wedding gown","Senator set"],"itemWord":"","productionStages":["Fabric Received","Cutting","Stitching","Fitting","Finishing"]}'::jsonb, now())
  on conflict (business_id, key) do update set data = excluded.data, updated_at = now();
end $$;

-- ---- Okoro & Sons Shoes (footwear) ----
do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where slug = 'okoro-and-sons';
  if v_biz is null then
    insert into public.businesses (name, slug, plan, status, contact_email, pending_owner_email)
    values ('Okoro & Sons Shoes', 'okoro-and-sons', 'starter', 'active', 'test.footwear@thelabelboard.com', 'test.footwear@thelabelboard.com')
    returning id into v_biz;
  end if;

  if not exists (select 1 from public.branches where business_id = v_biz and name = 'The bench') then
    insert into public.branches (business_id, name) values (v_biz, 'The bench');
  end if;

  insert into public.app_state (business_id, key, data, updated_at)
  values (v_biz, 'layi_dash_settings', '{"company":{"name":"Okoro & Sons Shoes","address":"Aba, Abia","email":"test.footwear@thelabelboard.com","phone":"","reg":"","logo":"","payInstructions":"Balance due on collection.","showPhotos":true,"banks":[]},"stagesV2":true,"branchScopeV1":true,"plan":"starter","budgets":{"Production":600000,"Marketing":150000,"Operations":400000,"Sales":120000},"branches":[{"id":"br-solo","name":"The bench","location":"Aba, Abia","active":true,"does":["footwear"],"type":"bespoke","channels":["showroom"]}],"productCatalog":[{"id":"pc-mtn396erwyt","name":"Oxford brogues","category":"Footwear","materials":[]},{"id":"pc-mtn396er0h8","name":"Chelsea boots","category":"Footwear","materials":[]},{"id":"pc-mtn396erbx1","name":"Loafers","category":"Footwear","materials":[]},{"id":"pc-mtn396er43k","name":"Leather sandals","category":"Footwear","materials":[]},{"id":"pc-mtn396er2is","name":"Bridal mules","category":"Footwear","materials":[]}],"garmentTypes":["Oxford brogues","Chelsea boots","Loafers","Leather sandals","Bridal mules"],"itemWord":"","productionStages":["Last & Pattern","Clicking","Closing","Lasting","Soling","Finishing"]}'::jsonb, now())
  on conflict (business_id, key) do update set data = excluded.data, updated_at = now();
end $$;

-- ---- Ìfé Leather (leather) ----
do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where slug = 'ife-leather';
  if v_biz is null then
    insert into public.businesses (name, slug, plan, status, contact_email, pending_owner_email)
    values ('Ìfé Leather', 'ife-leather', 'starter', 'active', 'test.leather@thelabelboard.com', 'test.leather@thelabelboard.com')
    returning id into v_biz;
  end if;

  if not exists (select 1 from public.branches where business_id = v_biz and name = 'The studio') then
    insert into public.branches (business_id, name) values (v_biz, 'The studio');
  end if;

  insert into public.app_state (business_id, key, data, updated_at)
  values (v_biz, 'layi_dash_settings', '{"company":{"name":"Ìfé Leather","address":"Lekki, Lagos","email":"test.leather@thelabelboard.com","phone":"","reg":"","logo":"","payInstructions":"Balance due on collection.","showPhotos":true,"banks":[]},"stagesV2":true,"branchScopeV1":true,"plan":"starter","budgets":{"Production":600000,"Marketing":150000,"Operations":400000,"Sales":120000},"branches":[{"id":"br-solo","name":"The studio","location":"Lekki, Lagos","active":true,"does":["leather"],"type":"bespoke","channels":["showroom"]}],"productCatalog":[{"id":"pc-mtn396h2x1g","name":"Tote bag","category":"Bag","materials":[]},{"id":"pc-mtn396h2uds","name":"Weekender holdall","category":"Bag","materials":[]},{"id":"pc-mtn396h2ar4","name":"Crossbody bag","category":"Bag","materials":[]},{"id":"pc-mtn396h2soc","name":"Belt","category":"Accessory","materials":[]},{"id":"pc-mtn396h2z9o","name":"Card wallet","category":"Accessory","materials":[]}],"garmentTypes":["Tote bag","Weekender holdall","Crossbody bag","Belt","Card wallet"],"itemWord":"","productionStages":["Pattern","Cutting","Skiving","Edge Finishing","Assembly","Hardware","Stitching"]}'::jsonb, now())
  on conflict (business_id, key) do update set data = excluded.data, updated_at = now();
end $$;

-- ---- House of Nneka (rtw) ----
do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where slug = 'house-of-nneka';
  if v_biz is null then
    insert into public.businesses (name, slug, plan, status, contact_email, pending_owner_email)
    values ('House of Nneka', 'house-of-nneka', 'starter', 'active', 'test.rtw@thelabelboard.com', 'test.rtw@thelabelboard.com')
    returning id into v_biz;
  end if;

  if not exists (select 1 from public.branches where business_id = v_biz and name = 'The boutique') then
    insert into public.branches (business_id, name) values (v_biz, 'The boutique');
  end if;

  insert into public.app_state (business_id, key, data, updated_at)
  values (v_biz, 'layi_dash_settings', '{"company":{"name":"House of Nneka","address":"Ikoyi, Lagos","email":"test.rtw@thelabelboard.com","phone":"","reg":"","logo":"","payInstructions":"Balance due on collection.","showPhotos":true,"banks":[]},"stagesV2":true,"branchScopeV1":true,"plan":"starter","budgets":{"Production":600000,"Marketing":150000,"Operations":400000,"Sales":120000},"branches":[{"id":"br-solo","name":"The boutique","location":"Ikoyi, Lagos","active":true,"does":["rtw"],"type":"rtw","channels":["showroom"]}],"productCatalog":[{"id":"pc-mtn396jdalg","name":"Ankara bomber","category":"Garment","materials":[]},{"id":"pc-mtn396jdm55","name":"Linen co-ord","category":"Garment","materials":[]},{"id":"pc-mtn396jdfwd","name":"Silk slip dress","category":"Garment","materials":[]},{"id":"pc-mtn396jdimk","name":"Cotton shirt dress","category":"Garment","materials":[]},{"id":"pc-mtn396jd5js","name":"Wide-leg trousers","category":"Garment","materials":[]}],"garmentTypes":["Ankara bomber","Linen co-ord","Silk slip dress","Cotton shirt dress","Wide-leg trousers"],"itemWord":"","productionStages":["Sampling","Cutting","Sewing","Finishing","Pressing"]}'::jsonb, now())
  on conflict (business_id, key) do update set data = excluded.data, updated_at = now();
end $$;

-- ---- Balogun Fabrics (fabrics) ----
do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where slug = 'balogun-fabrics';
  if v_biz is null then
    insert into public.businesses (name, slug, plan, status, contact_email, pending_owner_email)
    values ('Balogun Fabrics', 'balogun-fabrics', 'starter', 'active', 'test.fabrics@thelabelboard.com', 'test.fabrics@thelabelboard.com')
    returning id into v_biz;
  end if;

  if not exists (select 1 from public.branches where business_id = v_biz and name = 'The shop') then
    insert into public.branches (business_id, name) values (v_biz, 'The shop');
  end if;

  insert into public.app_state (business_id, key, data, updated_at)
  values (v_biz, 'layi_dash_settings', '{"company":{"name":"Balogun Fabrics","address":"Balogun Market, Lagos","email":"test.fabrics@thelabelboard.com","phone":"","reg":"","logo":"","payInstructions":"Balance due on collection.","showPhotos":true,"banks":[]},"stagesV2":true,"branchScopeV1":true,"plan":"starter","budgets":{"Production":600000,"Marketing":150000,"Operations":400000,"Sales":120000},"branches":[{"id":"br-solo","name":"The shop","location":"Balogun Market, Lagos","active":true,"does":["fabrics"],"type":"rtw","channels":["showroom"]}],"productCatalog":[{"id":"pc-mtn396m42lf","name":"Aso-oke","category":"Fabric","materials":[]},{"id":"pc-mtn396m4x88","name":"Swiss lace","category":"Fabric","materials":[]},{"id":"pc-mtn396m4irs","name":"Ankara","category":"Fabric","materials":[]},{"id":"pc-mtn396m4i8a","name":"Guinea brocade","category":"Fabric","materials":[]},{"id":"pc-mtn396m45af","name":"Silk georgette","category":"Fabric","materials":[]}],"garmentTypes":["Aso-oke","Swiss lace","Ankara","Guinea brocade","Silk georgette"],"itemWord":"","productionStages":["Cloth Received","Measured & Cut","Packed"]}'::jsonb, now())
  on conflict (business_id, key) do update set data = excluded.data, updated_at = now();
end $$;

-- ---- LAYI (multi) ----
do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where slug = 'layi-multi-studio';
  if v_biz is null then
    insert into public.businesses (name, slug, plan, status, contact_email, pending_owner_email)
    values ('LAYI', 'layi-multi-studio', 'trial', 'active', 'test.multi@thelabelboard.com', 'test.multi@thelabelboard.com')
    returning id into v_biz;
  end if;

  if not exists (select 1 from public.branches where business_id = v_biz and name = 'Lagos studio') then
    insert into public.branches (business_id, name) values (v_biz, 'Lagos studio');
  end if;
  if not exists (select 1 from public.branches where business_id = v_biz and name = 'Abuja outlet') then
    insert into public.branches (business_id, name) values (v_biz, 'Abuja outlet');
  end if;
  if not exists (select 1 from public.branches where business_id = v_biz and name = 'Ibadan branch') then
    insert into public.branches (business_id, name) values (v_biz, 'Ibadan branch');
  end if;
  if not exists (select 1 from public.branches where business_id = v_biz and name = 'Kano store') then
    insert into public.branches (business_id, name) values (v_biz, 'Kano store');
  end if;

  insert into public.app_state (business_id, key, data, updated_at)
  values (v_biz, 'layi_dash_settings', '{"company":{"name":"LAYI","address":"Surulere, Lagos","email":"test.multi@thelabelboard.com","phone":"","reg":"","logo":"","payInstructions":"Balance due on collection.","showPhotos":true,"banks":[]},"stagesV2":true,"branchScopeV1":true,"plan":"trial","budgets":{"Production":600000,"Marketing":150000,"Operations":400000,"Sales":120000},"branches":[{"id":"br-lag","name":"Lagos studio","location":"Surulere, Lagos","active":true,"type":"bespoke","channels":["showroom"]},{"id":"br-abj","name":"Abuja outlet","location":"Wuse, Abuja","active":true,"type":"rtw","channels":["showroom","online"]},{"id":"br-ib","name":"Ibadan branch","location":"Bodija, Ibadan","active":true,"type":"rtw","does":["rtw","leather"],"channels":["showroom"]},{"id":"br-kan","name":"Kano store","location":"Nassarawa, Kano","active":true,"type":"fabrics","channels":["showroom","online"]}],"productCatalog":[{"id":"pc-agbada","name":"Agbada","category":"Garment","materials":[{"name":"Aso-oke","variants":["Royal blue","Wine","Silver"]},{"name":"Guinea brocade","variants":[]},{"name":"Velvet","variants":[]},{"name":"Atiku","variants":[]}]},{"id":"pc-kaftan","name":"Kaftan","category":"Garment","materials":[{"name":"Linen","variants":[]},{"name":"Cotton","variants":[]},{"name":"Atiku","variants":[]},{"name":"Senator (cashmere blend)","variants":[]}]},{"id":"pc-suit","name":"Two-piece suit","category":"Garment","materials":[{"name":"Wool","variants":["Super 120s","Holland & Sherry","Local worsted"]},{"name":"Cotton","variants":[]},{"name":"Linen","variants":[]}]},{"id":"pc-bespoke","name":"Bespoke outfit","category":"Garment","materials":[{"name":"Lace","variants":["Emerald","Champagne"]},{"name":"Aso-ebi","variants":[]},{"name":"Ankara","variants":[]},{"name":"Silk","variants":[]}]},{"id":"pc-casual","name":"Casual set","category":"Garment","materials":[{"name":"Cotton","variants":[]},{"name":"Linen","variants":[]},{"name":"Ankara","variants":[]}]},{"id":"pc-shoes","name":"Shoes","category":"Footwear","materials":[{"name":"Calf leather","variants":["Black","Brown"]},{"name":"Suede","variants":[]},{"name":"Patent leather","variants":[]}]},{"id":"pc-mules","name":"Mules","category":"Footwear","materials":[{"name":"Leather","variants":["Tan","Black"]},{"name":"Suede","variants":[]}]},{"id":"pc-acc","name":"Accessory","category":"Accessory","materials":[{"name":"Aso-oke","variants":[]},{"name":"Beaded silk","variants":[]},{"name":"Leather","variants":[]}]}],"garmentTypes":["Agbada","Kaftan","Two-piece suit","Bespoke outfit","Casual set","Shoes","Mules","Accessory"]}'::jsonb, now())
  on conflict (business_id, key) do update set data = excluded.data, updated_at = now();
end $$;
