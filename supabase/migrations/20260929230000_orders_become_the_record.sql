-- =====================================================================
-- P2 — the order blob stops being the record
-- =====================================================================
-- seeCost and seeContact have been UI-only since they were written, and the
-- permission_catalogue says so in its own column: `enforceable = 'ui_only'`.
-- The mechanism is that layi_dash_orders is ONE blob per business, so anybody
-- allowed to open Orders must be handed the whole thing — costs, commissions
-- and delivery addresses included. A permission that hides four fields on a
-- screen hides nothing from a request.
--
-- WHAT THE 68 PRODUCTION ORDERS ACTUALLY CONTAIN, measured rather than
-- assumed, because the field list decides the whole design:
--
--   costs[]                210 lines, 1,974,000 naira        seeCost
--   commissions[]          46 lines carrying money           seeCost (decided)
--   saleItems[].unitCost   36 items                          seeCost
--   directorAmount/Pct     the owner's cut                   seeCost
--   referralAmount/rrerId  referral commission               seeCost
--   delivery.location      14 delivery addresses             seeContact
--   email/whatsapp/address present but EMPTY on all 68       seeContact
--
-- Three of those seven are inside nested structures and none of them was in
-- the original finding. A migration that moved "cost and contact" and called
-- it done would have left five of the seven where they were.
--
-- THE TRAP THIS FILE EXISTS TO AVOID. public.orders has a `doc jsonb` column
-- and `authenticated` holds SELECT on it, so doc is exactly as readable as the
-- blob was. Moving the order into a row and the blob into doc changes the
-- shape and nothing else. So doc is not a destination, it is a place with a
-- door on it: app.order_doc_carries_no_secrets() strips the protected keys on
-- the way in, for the migration and for every client, for ever.
--
-- WHAT IS NOT HERE. order_items is not backfilled. saleItems[] and outfits[]
-- stay in doc, minus their cost fields, because resolving a legacy productId
-- to a products row succeeds for some orders and not others, and a half
-- populated items table is worse than an honest document. Nothing is lost:
-- the item lines, quantities and prices are all still there.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Two satellites, both shaped like order_costs
-- ---------------------------------------------------------------------
-- order_costs already exists and is already gated by seeCost. These two are
-- deliberately the same shape — one row per order, a headline number and a
-- detail document — so there is one pattern to understand rather than three.

/* WHAT A PERSON EARNED IS NOT WHAT AN ORDER SOLD FOR.
   The app gates commissions on can('money'), which every role except tailor
   and headprod holds, viewer included. That is too wide for "what we paid
   Ada for this dress". Behind seeCost instead: a commission is money leaving
   the studio, which is what seeCost is about.

   Checked before deciding, on production: every one of the nine active
   members is an owner, and owner holds both money and seeCost. Nobody loses
   a screen they use today. */
create table if not exists public.order_commissions (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  total       numeric not null default 0,
  detail      jsonb   not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

/* A DELIVERY ADDRESS BELONGS TO THE ORDER, NOT TO THE CLIENT.
   customer_contacts is keyed by customer_id and holds where somebody lives.
   "Send this one to her sister's shop in Yaba" is a fact about one order and
   forcing it onto the customer would overwrite the next order's answer. Same
   gate as customer_contacts, different grain. */
create table if not exists public.order_contacts (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  detail      jsonb   not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists order_commissions_business_idx on public.order_commissions(business_id, branch_id);
create index if not exists order_contacts_business_idx    on public.order_contacts(business_id, branch_id);

alter table public.order_commissions enable row level security;
alter table public.order_contacts    enable row level security;
alter table public.order_commissions force row level security;
alter table public.order_contacts    force row level security;

/* Copied from order_costs, which has been enforcing seeCost since Batch E,
   rather than written fresh. can_here, not can: a branch manager sees the
   costs of their own branch and not of the one across town. */
drop policy if exists order_commissions_select on public.order_commissions;
create policy order_commissions_select on public.order_commissions for select to authenticated
  using (app.can_here(business_id, 'seeCost', branch_id));
drop policy if exists order_commissions_insert on public.order_commissions;
create policy order_commissions_insert on public.order_commissions for insert to authenticated
  with check (app.can_here(business_id, 'seeCost', branch_id));
drop policy if exists order_commissions_update on public.order_commissions;
create policy order_commissions_update on public.order_commissions for update to authenticated
  using (app.can_here(business_id, 'seeCost', branch_id))
  with check (app.can_here(business_id, 'seeCost', branch_id));
drop policy if exists order_commissions_delete on public.order_commissions;
create policy order_commissions_delete on public.order_commissions for delete to authenticated
  using (app.can_here(business_id, 'seeCost', branch_id));

drop policy if exists order_contacts_select on public.order_contacts;
create policy order_contacts_select on public.order_contacts for select to authenticated
  using (app.can_here(business_id, 'seeContact', branch_id));
drop policy if exists order_contacts_insert on public.order_contacts;
create policy order_contacts_insert on public.order_contacts for insert to authenticated
  with check (app.can_here(business_id, 'seeContact', branch_id));
drop policy if exists order_contacts_update on public.order_contacts;
create policy order_contacts_update on public.order_contacts for update to authenticated
  using (app.can_here(business_id, 'seeContact', branch_id))
  with check (app.can_here(business_id, 'seeContact', branch_id));
drop policy if exists order_contacts_delete on public.order_contacts;
create policy order_contacts_delete on public.order_contacts for delete to authenticated
  using (app.can_here(business_id, 'seeContact', branch_id));

/* Supabase grants all on new public tables to anon and authenticated by
   default. anon has no business here at all, and the explicit grant is what
   `revoke from public` would not have undone. */
revoke all on public.order_commissions from anon, authenticated;
revoke all on public.order_contacts    from anon, authenticated;
grant select, insert, update, delete on public.order_commissions to authenticated;
grant select, insert, update, delete on public.order_contacts    to authenticated;

-- ---------------------------------------------------------------------
-- 2. doc is not a hiding place
-- ---------------------------------------------------------------------
-- The whole of P2 rests on this. Without it, "orders are relational now" is a
-- sentence about storage rather than about access, because authenticated
-- holds SELECT on orders.doc and RLS is per row, never per column.
--
-- STRIPPED, NOT REFUSED, for the same reason as the credential trigger: an
-- old build must keep working. It simply stops being able to put these
-- particular things where everyone can read them.
create or replace function app.order_doc_carries_no_secrets()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare
  v_items jsonb;
begin
  if jsonb_typeof(new.doc) <> 'object' then
    return new;
  end if;

  /* Money that leaves the studio, and the people it goes to. */
  new.doc := new.doc - 'costs' - 'cost' - 'commissions'
                     - 'directorAmount' - 'directorPct' - 'directorOn'
                     - 'referralAmount' - 'referrerId';

  /* How to reach the client. `phone` has never appeared in the live data and
     is listed because the app's own writers still name it. */
  new.doc := new.doc - 'email' - 'whatsapp' - 'address' - 'phone';

  /* A cost hiding one level down, inside each sold item. This is the one the
     original finding missed: 36 of the production items carry it. */
  if jsonb_typeof(new.doc -> 'saleItems') = 'array' then
    select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'unitCost' else e end)
      into v_items
      from jsonb_array_elements(new.doc -> 'saleItems') e;
    new.doc := jsonb_set(new.doc, '{saleItems}', coalesce(v_items, '[]'::jsonb));
  end if;

  /* And an address hiding one level down, inside the delivery block. The rest
     of delivery — the courier, the fee, the tracking number, whether it is
     switched on — is ordinary order information and stays. */
  if jsonb_typeof(new.doc -> 'delivery') = 'object' then
    new.doc := jsonb_set(new.doc, '{delivery}', (new.doc -> 'delivery') - 'location');
  end if;

  /* NOT STRIPPED, on purpose: outfits[].meas and .person. Measurements are
     already member-readable — public.customers.measurements is gated by the
     `customers` permission and nothing stricter — so pulling them out of doc
     would claim a boundary the rest of the app does not keep. Holding the
     existing line is honest; inventing a new one here and nowhere else is
     not. Recorded so the next person does not think it was missed. */

  return new;
end $fn$;

drop trigger if exists orders_doc_carries_no_secrets on public.orders;
create trigger orders_doc_carries_no_secrets before insert or update on public.orders
  for each row execute function app.order_doc_carries_no_secrets();

revoke all on function app.order_doc_carries_no_secrets() from public, anon, authenticated;

comment on function app.order_doc_carries_no_secrets() is
  'orders.doc is readable by every member who can read the order, so the '
  'things seeCost and seeContact exist to protect are stripped out of it on '
  'the way in — including the two that hide inside saleItems and delivery.';
