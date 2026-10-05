-- =====================================================================
-- A MATERIAL'S COST PRICE IS A seeCost THING
-- =====================================================================
-- The status check of 5 October put the question plainly: the materials
-- live in one JSON blob behind the `supplies` permission, a blob is
-- all-or-nothing, so anybody who may count the stock also reads what the
-- studio paid for it. Kayode's answer: a material's cost price IS a
-- seeCost item.
--
-- A blob cannot hold that line, so the materials become rows with a cost
-- satellite — the same shape v68 gave an order's money, for the same
-- reason, so there is one pattern to understand rather than two.
--
--   public.materials             name, category, unit, quantity, reorder
--                               level, supplier, note, code   -> supplies
--   public.material_costs       the running weighted average and the last
--                               price actually paid             -> seeCost
--   public.material_moves       every in and out, with its note and the
--                               order reference                -> supplies
--   public.material_move_costs  what that movement cost, at the time
--                                                              -> seeCost
--
-- WHY THE MOVEMENTS GET A COST TABLE OF THEIR OWN. The ledger recorded
-- quantities and never money, so there was no way to ask what a studio
-- paid for the cloth it used in March — only what the same cloth costs
-- today. An average computed from "the current cost field" is not an
-- average, it is the last thing somebody typed. Costing a movement at the
-- moment it happens is what makes the average real and what stops a
-- restock in October rewriting a margin from June.
--
-- MEASURED BEFORE WRITING ANY OF IT, production, 5 October 2026:
--   48 materials across 2 studios (24 each)
--   5 distinct branch names, and every one of them resolves to a branch
--   22 supplier references, and every one of them resolves to a supplier
--   48 of 48 carry a cost greater than zero
--   92 movements, 48 of them stock-ins
--   stock on hand at cost: ₦1,900,110 per studio
--
-- Nothing is deleted here. The blob stays exactly where it is and keeps
-- syncing; app.retire_supplies_blob() is the separate, refusing step, the
-- way the order blob was retired.

-- ---------------------------------------------------------------------
-- 1. The rows
-- ---------------------------------------------------------------------
-- NAMED `materials`, NOT `supplies`. public.suppliers already exists and
-- holds vendors — the people you buy from. A table called `supplies` one
-- letter away from it is a mistake waiting for a tired afternoon. The app
-- calls them supplies in its own code and its storage key, which never
-- changes; the table says what they are.
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  app_id      text not null,
  name        text not null,
  cat         text,
  subcat      text,
  unit        text not null default 'pcs',
  qty         numeric not null default 0,
  reorder     numeric not null default 0,
  supplier_id uuid references public.suppliers(id) on delete set null,
  note        text,
  photo       text,
  code        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint materials_app_id_per_business unique (business_id, app_id)
);
create index if not exists materials_business_idx on public.materials(business_id);
create index if not exists materials_branch_idx   on public.materials(business_id, branch_id);

/* A CODE IS UNIQUE WITHIN A STUDIO, and blank is not a code. Phase 1 asks
   for generated codes, and a generator that can collide is worse than no
   generator: the second item silently becomes unfindable. Case-insensitive
   because nobody types a code the same way twice. */
create unique index if not exists materials_code_per_business
  on public.materials(business_id, lower(btrim(code)))
  where code is not null and btrim(code) <> '';

create table if not exists public.material_costs (
  material_id  uuid primary key references public.materials(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete set null,
  avg_cost     numeric not null default 0,
  last_paid    numeric,
  last_paid_at timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists material_costs_business_idx on public.material_costs(business_id);

create table if not exists public.material_moves (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  kind        text not null check (kind in ('in','out')),
  qty         numeric not null check (qty > 0),
  note        text,
  ref         text,
  at          timestamptz not null default now(),
  app_key     text,
  created_at  timestamptz not null default now()
);
create index if not exists material_moves_material_idx on public.material_moves(material_id, at);
create index if not exists material_moves_business_idx on public.material_moves(business_id, at);
/* IDEMPOTENT BY (material, app_key). The device replays its ledger on
   every sync and 92 movements must not become 184.

   NOT a partial index. The obvious shape is "where app_key is not null",
   and `on conflict (material_id, app_key)` cannot infer a partial index,
   so every upsert fails with "no unique or exclusion constraint matching
   the ON CONFLICT specification". Postgres treats NULLs as distinct in a
   unique index anyway, so a movement with no app_key — one typed in rather
   than synced — is still free to repeat. */
create unique index if not exists material_moves_app_key
  on public.material_moves(material_id, app_key);

create table if not exists public.material_move_costs (
  move_id     uuid primary key references public.material_moves(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  unit_cost   numeric not null default 0,
  total_cost  numeric not null default 0
);
create index if not exists material_move_costs_business_idx on public.material_move_costs(business_id);

comment on table public.materials is
  'A studio''s stock: what it is, how much is left, where it lives. Behind '
  '`supplies`. What it COST is public.material_costs, behind `seeCost`, '
  'because a blob could not hold that line and the status check of 5 '
  'October asked for it.';
comment on table public.material_costs is
  'The running weighted average and the last price actually paid. Behind '
  '`seeCost`. Maintained by app.recalc_material_average from the movement '
  'history rather than incrementally, so it cannot drift.';
comment on table public.material_moves is
  'Every in and out, with the order it was used on. Behind `supplies`: '
  'knowing four metres left the shelf is stock-keeping, not money.';
comment on table public.material_move_costs is
  'What a movement cost at the time it happened. Behind `seeCost`. This is '
  'the table that makes an average real: the ledger used to record '
  'quantities only, so the only cost available was whatever somebody had '
  'typed into the material most recently.';

-- ---------------------------------------------------------------------
-- 2. The walls
-- ---------------------------------------------------------------------
alter table public.materials           enable row level security;
alter table public.material_costs      enable row level security;
alter table public.material_moves      enable row level security;
alter table public.material_move_costs enable row level security;
alter table public.materials           force row level security;
alter table public.material_costs      force row level security;
alter table public.material_moves      force row level security;
alter table public.material_move_costs force row level security;

/* Supabase grants all on a new table in `public` to anon and authenticated
   by default, and `revoke from public` does not undo an explicit grant. */
revoke all on public.materials           from anon, authenticated;
revoke all on public.material_costs      from anon, authenticated;
revoke all on public.material_moves      from anon, authenticated;
revoke all on public.material_move_costs from anon, authenticated;
grant select, insert, update, delete on public.materials           to authenticated;
grant select, insert, update, delete on public.material_costs      to authenticated;
grant select, insert, update, delete on public.material_moves      to authenticated;
grant select, insert, update, delete on public.material_move_costs to authenticated;

-- the stock itself: `supplies`, branch-scoped like everything else
drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials
  for select to authenticated using (app.can_here(business_id, 'supplies', branch_id));
drop policy if exists materials_insert on public.materials;
create policy materials_insert on public.materials
  for insert to authenticated with check (app.can_here(business_id, 'supplies', branch_id));
drop policy if exists materials_update on public.materials;
create policy materials_update on public.materials
  for update to authenticated using (app.can_here(business_id, 'supplies', branch_id))
  with check (app.can_here(business_id, 'supplies', branch_id));
drop policy if exists materials_delete on public.materials;
create policy materials_delete on public.materials
  for delete to authenticated using (app.can_here(business_id, 'supplies', branch_id));

-- THE LINE THIS MIGRATION EXISTS TO DRAW
drop policy if exists material_costs_select on public.material_costs;
create policy material_costs_select on public.material_costs
  for select to authenticated using (app.can_here(business_id, 'seeCost', branch_id));
drop policy if exists material_costs_insert on public.material_costs;
create policy material_costs_insert on public.material_costs
  for insert to authenticated with check (app.can_here(business_id, 'seeCost', branch_id));
drop policy if exists material_costs_update on public.material_costs;
create policy material_costs_update on public.material_costs
  for update to authenticated using (app.can_here(business_id, 'seeCost', branch_id))
  with check (app.can_here(business_id, 'seeCost', branch_id));
drop policy if exists material_costs_delete on public.material_costs;
create policy material_costs_delete on public.material_costs
  for delete to authenticated using (app.can_here(business_id, 'seeCost', branch_id));

drop policy if exists material_moves_select on public.material_moves;
create policy material_moves_select on public.material_moves
  for select to authenticated using (app.can_here(business_id, 'supplies', branch_id));
drop policy if exists material_moves_insert on public.material_moves;
create policy material_moves_insert on public.material_moves
  for insert to authenticated with check (app.can_here(business_id, 'supplies', branch_id));
/* A MOVEMENT IS HISTORY. Nothing updates one, and only the owner can
   delete one, the same deal the audit trail and the payments ledger get.
   Miscounted stock is corrected by another movement, which is how a
   stockroom works. */
drop policy if exists material_moves_update on public.material_moves;
create policy material_moves_update on public.material_moves
  for update to authenticated using (false);
drop policy if exists material_moves_delete on public.material_moves;
create policy material_moves_delete on public.material_moves
  for delete to authenticated using (app.is_owner(business_id));

drop policy if exists material_move_costs_select on public.material_move_costs;
create policy material_move_costs_select on public.material_move_costs
  for select to authenticated using (app.can(business_id, 'seeCost'));
drop policy if exists material_move_costs_insert on public.material_move_costs;
create policy material_move_costs_insert on public.material_move_costs
  for insert to authenticated with check (app.can(business_id, 'seeCost'));
drop policy if exists material_move_costs_update on public.material_move_costs;
create policy material_move_costs_update on public.material_move_costs
  for update to authenticated using (false);
drop policy if exists material_move_costs_delete on public.material_move_costs;
create policy material_move_costs_delete on public.material_move_costs
  for delete to authenticated using (app.is_owner(business_id));

-- ---------------------------------------------------------------------
-- 3. The average, recomputed from history rather than nudged
-- ---------------------------------------------------------------------
-- An incremental average is a number that drifts: one movement deleted,
-- one replay, one rounding, and it is quietly wrong for ever with nothing
-- to compare it against. This reads the whole costed history every time.
-- It is cheap — a studio has tens of movements per material, not millions
-- — and it is self-healing.
--
-- WHAT THE AVERAGE IS: total paid across every costed stock-in, divided by
-- the quantity those stock-ins brought in. Standard weighted average cost.
-- It is NOT revalued when stock is consumed, so it describes everything
-- the studio has ever bought rather than only what is left on the shelf.
-- For deciding what a metre of lace costs them, that is the right answer
-- and the stable one.
create or replace function app.recalc_material_average(p_material uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_biz   uuid;
  v_br    uuid;
  v_qty   numeric;
  v_spend numeric;
  v_last  numeric;
  v_lastat timestamptz;
begin
  select m.business_id, m.branch_id into v_biz, v_br
    from public.materials m where m.id = p_material;
  if v_biz is null then return; end if;

  select coalesce(sum(mv.qty), 0), coalesce(sum(c.total_cost), 0)
    into v_qty, v_spend
    from public.material_moves mv
    join public.material_move_costs c on c.move_id = mv.id
   where mv.material_id = p_material and mv.kind = 'in';

  select c.unit_cost, mv.at into v_last, v_lastat
    from public.material_moves mv
    join public.material_move_costs c on c.move_id = mv.id
   where mv.material_id = p_material and mv.kind = 'in'
   order by mv.at desc, mv.created_at desc limit 1;

  insert into public.material_costs (material_id, business_id, branch_id, avg_cost,
                                     last_paid, last_paid_at, updated_at)
  values (p_material, v_biz, v_br,
          case when v_qty > 0 then round(v_spend / v_qty, 4) else 0 end,
          v_last, v_lastat, now())
  on conflict (material_id) do update
    set avg_cost = excluded.avg_cost,
        last_paid = excluded.last_paid,
        last_paid_at = excluded.last_paid_at,
        branch_id = excluded.branch_id,
        updated_at = now();
end $fn$;

revoke all on function app.recalc_material_average(uuid) from public, anon, authenticated;

create or replace function app.material_cost_changed()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare v_move uuid; v_mat uuid;
begin
  v_move := coalesce(new.move_id, old.move_id);
  select material_id into v_mat from public.material_moves where id = v_move;
  if v_mat is not null then perform app.recalc_material_average(v_mat); end if;
  return coalesce(new, old);
end $fn$;

drop trigger if exists material_move_costs_recalc on public.material_move_costs;
create trigger material_move_costs_recalc
  after insert or update or delete on public.material_move_costs
  for each row execute function app.material_cost_changed();

revoke all on function app.material_cost_changed() from public, anon, authenticated;

/* AND WHAT A STUDIO ASKS FOR. The two figures Phase 1 names — the running
   average and the last price actually paid — read as one row behind
   seeCost. SECURITY INVOKER on purpose: the policy above is the check, and
   a definer function here would be a way round it. */
create or replace function public.material_cost_of(p_material uuid)
returns table (avg_cost numeric, last_paid numeric, last_paid_at timestamptz)
language sql stable security invoker
set search_path = public, pg_temp as $fn$
  select c.avg_cost, c.last_paid, c.last_paid_at
    from public.material_costs c where c.material_id = p_material;
$fn$;

-- ---------------------------------------------------------------------
-- 4. The 48 that are already here
-- ---------------------------------------------------------------------
-- RECONCILED BEFORE ANYTHING IS REMOVED, and nothing is removed here at
-- all: the blob is untouched and keeps syncing. Idempotent on
-- (business_id, app_id) and on (material_id, app_key), so running it twice
-- writes the same rows.
create or replace function app.migrate_materials_to_rows(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_mats int := 0; v_moves int := 0; v_costed int := 0;
  r record; mv record; v_id uuid; v_br uuid; v_sup uuid; v_n int;
begin
  for r in
    select e, e->>'id' as app_id
      from public.app_state s, lateral jsonb_array_elements(s.data) e
     where s.business_id = p_business and s.key = 'layi_dash_supplies'
       and jsonb_typeof(s.data) = 'array' and coalesce(e->>'id','') <> ''
  loop
    v_br := null;
    if coalesce(r.e->>'branch','') <> '' then
      select b.id into v_br from public.branches b
       where b.business_id = p_business
         and lower(btrim(b.name)) = lower(btrim(r.e->>'branch')) limit 1;
    end if;

    v_sup := null;
    if coalesce(r.e->>'supplierId','') <> '' then
      select sp.id into v_sup from public.suppliers sp
       where sp.business_id = p_business
         and sp.data->>'id' = r.e->>'supplierId' limit 1;
    end if;

    insert into public.materials
      (business_id, branch_id, app_id, name, cat, subcat, unit, qty, reorder,
       supplier_id, note, photo, code, updated_at)
    values (
      p_business, v_br, r.app_id,
      coalesce(nullif(btrim(r.e->>'name'),''), 'Unnamed item'),
      nullif(r.e->>'cat',''), nullif(r.e->>'subcat',''),
      coalesce(nullif(r.e->>'unit',''), 'pcs'),
      coalesce((r.e->>'qty')::numeric, 0),
      coalesce((r.e->>'reorder')::numeric, 0),
      v_sup, nullif(r.e->>'note',''), nullif(r.e->>'photo',''),
      /* the importer was the only thing that ever wrote one */
      nullif(btrim(coalesce(r.e->>'code', r.e->>'sku', '')), ''),
      coalesce((r.e->>'updatedAt')::timestamptz, now()))
    on conflict (business_id, app_id) do update
      set branch_id = excluded.branch_id, name = excluded.name,
          cat = excluded.cat, subcat = excluded.subcat, unit = excluded.unit,
          qty = excluded.qty, reorder = excluded.reorder,
          supplier_id = excluded.supplier_id, note = excluded.note,
          photo = excluded.photo,
          code = coalesce(public.materials.code, excluded.code),
          updated_at = excluded.updated_at
    returning id into v_id;
    v_mats := v_mats + 1;

    /* THE LEDGER, AND THE OPENING AVERAGE.
         The movements hold quantities and no money, so there is exactly one
         honest thing to do with the cost field: treat it as the price paid
         on every stock-in up to now. That makes the studio's current typed
         cost the opening average, which is what Kayode asked for, and it
         makes every future receipt move the average honestly from there. */
    v_n := 0;
    for mv in
      select m2 from jsonb_array_elements(
        case when jsonb_typeof(r.e->'moves') = 'array' then r.e->'moves' else '[]'::jsonb end) m2
    loop
      v_n := v_n + 1;
      declare
        v_move uuid;
        v_kind text := case when lower(coalesce(mv.m2->>'type','')) = 'out' then 'out' else 'in' end;
        v_qty  numeric := coalesce((mv.m2->>'qty')::numeric, 0);
        v_unit numeric := coalesce((r.e->>'cost')::numeric, 0);
      begin
        if v_qty <= 0 then continue; end if;
        insert into public.material_moves
          (business_id, material_id, branch_id, kind, qty, note, ref, at, app_key)
        values (p_business, v_id, v_br, v_kind, v_qty,
                nullif(mv.m2->>'note',''), nullif(mv.m2->>'ref',''),
                coalesce((mv.m2->>'at')::timestamptz, now()),
                'blob-' || v_n)
        on conflict (material_id, app_key) do update
          set qty = excluded.qty, note = excluded.note, ref = excluded.ref,
              at = excluded.at, kind = excluded.kind
        returning id into v_move;
        v_moves := v_moves + 1;

        if v_kind = 'in' and v_unit > 0 then
          insert into public.material_move_costs (move_id, business_id, unit_cost, total_cost)
          values (v_move, p_business, v_unit, round(v_qty * v_unit, 4))
          on conflict (move_id) do update
            set unit_cost = excluded.unit_cost, total_cost = excluded.total_cost;
          v_costed := v_costed + 1;
        end if;
      end;
    end loop;

    /* A material with no costed stock-in still needs a cost row, or an
       absent row would read as "not for you" rather than "nothing known". */
    perform app.recalc_material_average(v_id);
    if coalesce((r.e->>'cost')::numeric, 0) > 0
       and not exists (select 1 from public.material_costs c
                        where c.material_id = v_id and c.avg_cost > 0) then
      update public.material_costs
         set avg_cost = (r.e->>'cost')::numeric,
             last_paid = coalesce(last_paid, (r.e->>'cost')::numeric),
             updated_at = now()
       where material_id = v_id;
    end if;
  end loop;

  return jsonb_build_object(
    'business_id', p_business,
    'materials', v_mats, 'moves', v_moves, 'costed_moves', v_costed) ||
    app.reconcile_materials(p_business);
end $fn$;

-- ---------------------------------------------------------------------
-- 5. and the reconciliation, item by item
-- ---------------------------------------------------------------------
create or replace function app.reconcile_materials(p_business uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$
with src as (
  select e, e->>'id' as app_id,
         coalesce((e->>'qty')::numeric,0) as qty,
         coalesce((e->>'cost')::numeric,0) as cost
    from public.app_state s, lateral jsonb_array_elements(s.data) e
   where s.business_id = p_business and s.key = 'layi_dash_supplies'
     and jsonb_typeof(s.data) = 'array' and coalesce(e->>'id','') <> ''
),
dst as (select m.* from public.materials m where m.business_id = p_business),
j as (select src.*, dst.id dst_id, dst.qty dst_qty from src left join dst on dst.app_id = src.app_id)
select jsonb_build_object(
  'source_materials',      (select count(*) from src),
  'destination_materials', (select count(*) from dst),
  'missing',               (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb)
                              from j where dst_id is null),
  'quantity_mismatches',   (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb)
                              from j where dst_id is not null and qty is distinct from dst_qty),
  'source_stock_at_cost',  (select coalesce(round(sum(qty * cost),2),0) from src),
  'destination_stock_at_cost',
      (select coalesce(round(sum(m.qty * c.avg_cost),2),0)
         from public.materials m join public.material_costs c on c.material_id = m.id
        where m.business_id = p_business),
  'source_moves',          (select coalesce(sum(jsonb_array_length(
                              case when jsonb_typeof(e->'moves')='array' then e->'moves' else '[]'::jsonb end)),0)
                              from src),
  'destination_moves',     (select count(*) from public.material_moves where business_id = p_business),
  'materials_without_a_cost_row',
      (select count(*) from public.materials m where m.business_id = p_business
        and not exists (select 1 from public.material_costs c where c.material_id = m.id))
) || jsonb_build_object('green', (
     (select count(*) from src) = (select count(*) from dst)
 and (select count(*) from j where dst_id is null) = 0
 and (select count(*) from j where dst_id is not null and qty is distinct from dst_qty) = 0
 and (select coalesce(round(sum(qty * cost),2),0) from src)
   = (select coalesce(round(sum(m.qty * c.avg_cost),2),0)
        from public.materials m join public.material_costs c on c.material_id = m.id
       where m.business_id = p_business)
 and (select count(*) from public.materials m where m.business_id = p_business
       and not exists (select 1 from public.material_costs c where c.material_id = m.id)) = 0
));
$fn$;

comment on function app.reconcile_materials(uuid) is
  'Compares the supplies blob with the rows item by item: every identifier '
  'present, every quantity equal, the stock-on-hand valuation equal, and no '
  'material left without a cost row. The valuation is the check that matters '
  '— it is the one number that proves the opening average came across.';

-- the owner-facing pair, so a studio can run its own migration
create or replace function public.migrate_my_materials(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if not app.is_owner(p_business) then
    raise exception 'only the owner of this studio can move its materials'
      using errcode = '42501';
  end if;
  return app.migrate_materials_to_rows(p_business);
end $fn$;

create or replace function public.reconcile_my_materials(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if not app.in_scope(p_business, null) then
    raise exception 'that is not your studio' using errcode = '42501';
  end if;
  return app.reconcile_materials(p_business);
end $fn$;

revoke all on function app.migrate_materials_to_rows(uuid) from public, anon, authenticated;
revoke all on function app.reconcile_materials(uuid)      from public, anon, authenticated;

/* AND THE THREE IN public, WHICH IS THE ONE THAT BITES. Supabase grants
   EXECUTE on a new function in the exposed schema to anon and
   authenticated, and `revoke from public` does not undo it — that is a
   grant to a role, not to PUBLIC. storage_rls_harness caught all three of
   these the first time this release ran, which is exactly why it sweeps
   the schema rather than checking a list somebody maintains by hand.

   Each one does its own authorisation inside, so authenticated keeps
   EXECUTE and anon loses it. A signed-out caller has no business asking
   any of them anything. */
revoke all on function public.material_cost_of(uuid)       from public, anon;
revoke all on function public.migrate_my_materials(uuid)   from public, anon;
revoke all on function public.reconcile_my_materials(uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 6. An export carries them, and a restore puts them back
-- ---------------------------------------------------------------------
-- The commissions were missed once and the price was missed once. Four new
-- tables is four new chances to restore a studio that looks complete and
-- has no stock in it.
create or replace function app.export_studio_raw(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare b record; j jsonb;
begin
  select * into b from public.businesses where id = p_business;
  if b.id is null then
    raise exception 'no such studio' using errcode = '42704';
  end if;

  j := jsonb_build_object(
    '_app', 'The Label Board',
    '_export', 'studio',
    '_version', 5,
    '_exported_at', now(),
    'business', to_jsonb(b) - 'closed_by',
    'branches',      coalesce((select jsonb_agg(to_jsonb(t)) from public.branches t         where t.business_id = p_business), '[]'::jsonb),
    'memberships',   coalesce((select jsonb_agg(to_jsonb(t)) from public.memberships t      where t.business_id = p_business), '[]'::jsonb),
    'profiles',      coalesce((select jsonb_agg(to_jsonb(t)) from public.profiles t         where t.business_id = p_business), '[]'::jsonb),
    'business_roles',coalesce((select jsonb_agg(to_jsonb(t)) from public.business_roles t   where t.business_id = p_business), '[]'::jsonb),
    'role_permissions', coalesce((select jsonb_agg(to_jsonb(t)) from public.business_role_permissions t
                                   where t.role_id in (select id from public.business_roles where business_id = p_business)), '[]'::jsonb),
    'app_state',     coalesce((select jsonb_agg(to_jsonb(t)) from public.app_state t        where t.business_id = p_business), '[]'::jsonb),
    'orders',        coalesce((select jsonb_agg(to_jsonb(t)) from public.orders t           where t.business_id = p_business), '[]'::jsonb),
    'order_costs',   coalesce((select jsonb_agg(to_jsonb(t)) from public.order_costs t      where t.business_id = p_business), '[]'::jsonb),
    'order_pricing',    coalesce((select jsonb_agg(to_jsonb(t)) from public.order_pricing t    where t.business_id = p_business), '[]'::jsonb),
    'order_settlement', coalesce((select jsonb_agg(to_jsonb(t)) from public.order_settlement t where t.business_id = p_business), '[]'::jsonb),
    'order_commissions', coalesce((select jsonb_agg(to_jsonb(t)) from public.order_commissions t where t.business_id = p_business), '[]'::jsonb),
    'order_contacts',    coalesce((select jsonb_agg(to_jsonb(t)) from public.order_contacts t    where t.business_id = p_business), '[]'::jsonb),
    'order_items',   coalesce((select jsonb_agg(to_jsonb(t)) from public.order_items t      where t.business_id = p_business), '[]'::jsonb),
    /* AND THE STOCK, FROM PHASE 1. Four tables, because a material's cost
       is a seeCost thing and a blob could not hold that line. */
    'materials',           coalesce((select jsonb_agg(to_jsonb(t)) from public.materials t      where t.business_id = p_business), '[]'::jsonb),
    'material_costs',      coalesce((select jsonb_agg(to_jsonb(t)) from public.material_costs t where t.business_id = p_business), '[]'::jsonb),
    'material_moves',      coalesce((select jsonb_agg(to_jsonb(t)) from public.material_moves t where t.business_id = p_business), '[]'::jsonb),
    'material_move_costs', coalesce((select jsonb_agg(to_jsonb(t)) from public.material_move_costs t where t.business_id = p_business), '[]'::jsonb),
    'customers',     coalesce((select jsonb_agg(to_jsonb(t)) from public.customers t        where t.business_id = p_business), '[]'::jsonb),
    'customer_contacts', coalesce((select jsonb_agg(to_jsonb(t)) from public.customer_contacts t where t.business_id = p_business), '[]'::jsonb),
    'transactions',  coalesce((select jsonb_agg(to_jsonb(t)) from public.transactions t     where t.business_id = p_business), '[]'::jsonb),
    'suppliers',     coalesce((select jsonb_agg(to_jsonb(t)) from public.suppliers t        where t.business_id = p_business), '[]'::jsonb),
    'products',      coalesce((select jsonb_agg(to_jsonb(t)) from public.products t         where t.business_id = p_business), '[]'::jsonb),
    'staff',         coalesce((select jsonb_agg(to_jsonb(t)) from public.staff t            where t.business_id = p_business), '[]'::jsonb),
    'attendance',    coalesce((select jsonb_agg(to_jsonb(t)) from public.attendance t       where t.business_id = p_business), '[]'::jsonb),
    'payment_methods', coalesce((select jsonb_agg(to_jsonb(t)) from public.payment_methods t where t.business_id = p_business), '[]'::jsonb),
    'feedback',      coalesce((select jsonb_agg(to_jsonb(t)) from public.feedback t         where t.business_id = p_business), '[]'::jsonb),
    'audit_log',     coalesce((select jsonb_agg(to_jsonb(t)) from public.audit_log t        where t.business_id = p_business), '[]'::jsonb));

  return j;
end $fn$;

revoke all on function app.export_studio_raw(uuid) from public, anon, authenticated;

comment on function app.export_studio_raw(uuid) is
  'A studio, whole, with no permission check: app.export_studio is the '
  'guard and the nightly round is the other caller. Version 4 added '
  'order_pricing and order_settlement. Version 5 adds the four materials '
  'tables. app.import_studio reads the version and carries older formats '
  'forward, so a version 3 or 4 file still restores correctly.';

-- ---------------------------------------------------------------------
-- 7. and the restore reads the version, as it already does for the money
-- ---------------------------------------------------------------------
-- COPIED FROM 20261005100000 with the four materials tables added to
-- v_tables and one more carry-forward branch. A version 4 file has no
-- materials arrays at all: its stock is still the blob inside app_state,
-- which this restores, and then the blob migration builds the rows from
-- it. So a backup taken this morning still restores complete tomorrow.
create or replace function app.import_studio(p_json jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_biz   uuid;
  v_slug  text;
  v_t     text;
  v_key   text;
  v_i     int;
  v_ver   int;
  v_fwd   int := 0;
  v_mat   jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_tables text[][] := array[
    ['branches','branches'],
    ['business_roles','business_roles'],
    ['business_role_permissions','role_permissions'],
    ['memberships','memberships'],
    ['profiles','profiles'],
    ['app_state','app_state'],
    ['customers','customers'],
    ['customer_contacts','customer_contacts'],
    ['products','products'],
    ['suppliers','suppliers'],
    ['materials','materials'],
    ['material_costs','material_costs'],
    ['material_moves','material_moves'],
    ['material_move_costs','material_move_costs'],
    ['staff','staff'],
    ['attendance','attendance'],
    ['orders','orders'],
    ['order_costs','order_costs'],
    ['order_commissions','order_commissions'],
    ['order_contacts','order_contacts'],
    ['order_pricing','order_pricing'],
    ['order_settlement','order_settlement'],
    ['order_items','order_items'],
    ['transactions','transactions'],
    ['payment_methods','payment_methods'],
    ['feedback','feedback'],
    ['audit_log','audit_log']
  ];
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform can restore a studio' using errcode = '42501';
  end if;
  if coalesce(p_json->>'_export','') <> 'studio' then
    raise exception 'that is not a studio export' using errcode = '22023';
  end if;

  v_biz  := (p_json->'business'->>'id')::uuid;
  v_slug := p_json->'business'->>'slug';
  v_ver  := coalesce((p_json->>'_version')::int, 1);
  if v_biz is null then
    raise exception 'the export names no studio' using errcode = '22023';
  end if;
  if exists (select 1 from public.businesses where id = v_biz) then
    raise exception 'studio % is still here; purge it first, or restore into a fresh project', v_biz
      using errcode = '42P10';
  end if;
  if v_slug is not null and exists (select 1 from public.businesses where slug = v_slug) then
    raise exception 'the address % is taken by another studio', v_slug using errcode = '42P10';
  end if;

  alter table public.businesses disable trigger user;
  for v_i in 1 .. array_length(v_tables, 1) loop
    execute format('alter table public.%I disable trigger user', v_tables[v_i][1]);
  end loop;

  insert into public.businesses
  select * from jsonb_populate_record(null::public.businesses, p_json->'business');

  for v_i in 1 .. array_length(v_tables, 1) loop
    v_t := v_tables[v_i][1];
    v_key := v_tables[v_i][2];
    execute format(
      'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)',
      v_t, v_t) using coalesce(p_json->v_key, '[]'::jsonb);
    v_counts := v_counts || jsonb_build_object(
      v_t, jsonb_array_length(coalesce(p_json->v_key, '[]'::jsonb)));
  end loop;

  perform setval(pg_get_serial_sequence('public.audit_log','id'),
                 greatest(coalesce((select max(id) from public.audit_log), 1), 1));

  /* THE MONEY, CARRIED FORWARD OUT OF AN OLDER FILE. Version 4 is the
     first format holding order_pricing and order_settlement; anything
     older has the price and the paid figure in each order's document. */
  if v_ver < 4 then
    insert into public.order_pricing (order_id, business_id, branch_id, value, discount, detail)
    select o.id, o.business_id, o.branch_id,
           coalesce((o.doc->>'value')::numeric, 0),
           coalesce((o.doc->>'discount')::numeric, 0),
           app.order_pricing_detail(o.doc)
    from public.orders o
    where o.business_id = v_biz and app.order_has_pricing(o.doc)
    on conflict (order_id) do nothing;
    get diagnostics v_fwd = row_count;

    insert into public.order_settlement (order_id, business_id, branch_id, paid, detail)
    select o.id, o.business_id, o.branch_id,
           coalesce((o.doc->>'paid')::numeric, 0),
           app.order_settlement_detail(o.doc)
    from public.orders o
    where o.business_id = v_biz and app.order_has_settlement(o.doc)
    on conflict (order_id) do nothing;

    update public.orders set doc = app.order_doc_without_secrets(doc)
     where business_id = v_biz
       and (doc ?| array['value','discount','paid','potContribs']
            or (doc->'delivery') ? 'fee'
            or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(doc->'outfits')='array'
                       then doc->'outfits' else '[]'::jsonb end) f where f ? 'price')
            or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(doc->'saleItems')='array'
                       then doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitPrice'));

    v_counts := v_counts || jsonb_build_object('money_carried_forward_from_v' || v_ver, v_fwd);
  end if;

  for v_i in 1 .. array_length(v_tables, 1) loop
    execute format('alter table public.%I enable trigger user', v_tables[v_i][1]);
  end loop;
  alter table public.businesses enable trigger user;

  /* AND THE STOCK. Version 5 is the first format holding the materials
     tables; anything older has its stock in the app_state blob, which has
     just been restored, so the ordinary migration builds the rows from it.
     Deliberately AFTER the triggers come back on, because this one wants
     the average recomputed as it goes. */
  if v_ver < 5 then
    v_mat := app.migrate_materials_to_rows(v_biz);
    v_counts := v_counts || jsonb_build_object('stock_carried_forward_from_v' || v_ver, v_mat);
  end if;

  update public.app_state
     set data = (data - 'ownerPassword')
               || case when jsonb_typeof(data -> 'company') = 'object'
                       then jsonb_build_object('company', (data -> 'company') - 'ownerPassword')
                       else '{}'::jsonb end
   where business_id = v_biz and key = 'layi_dash_settings'
     and jsonb_typeof(data) = 'object'
     and (data ? 'ownerPassword'
          or (jsonb_typeof(data -> 'company') = 'object' and (data -> 'company') ? 'ownerPassword'));
  delete from public.app_state where business_id = v_biz and key = 'layi_dash_users';

  perform app.audit(v_biz, 'Studio restored from an export',
    'exported ' || coalesce(p_json->>'_exported_at','at an unknown time')
    || ', format version ' || v_ver
    || case when v_ver < 5 then ' (the money and the stock were carried forward)' else '' end);

  return jsonb_build_object('restored', true, 'business_id', v_biz,
                            'export_version', v_ver, 'rows', v_counts);
end $fn$;

comment on function app.import_studio(jsonb) is
  'Restores a studio from an export, reading the file''s _version. Below 4, '
  'the price and the paid figure are inside each order''s document and are '
  'copied into order_pricing and order_settlement. Below 5, the stock is '
  'inside the app_state supplies blob and the materials rows are built from '
  'it. Without either branch an older file restores a studio that looks '
  'complete and has no money or no stock in it.';
