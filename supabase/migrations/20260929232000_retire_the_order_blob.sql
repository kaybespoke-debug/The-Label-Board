-- =====================================================================
-- P2 — retiring the source, once and only once it is safe to
-- =====================================================================
-- Moving the orders into rows does not close anything by itself. The blob is
-- still sitting in app_state with the costs, the commissions and the delivery
-- addresses in it, and anybody who can open Orders can still ask for it by
-- name. Until it is gone, P2 has changed where the data ALSO lives.
--
-- But a source that is deleted cannot be checked afterwards, and the first
-- rule of this piece of work is that nothing destructive happens until the
-- relational copy is proven complete. So the deletion is not a statement in a
-- migration — it is a function that REFUSES unless that studio's own
-- reconciliation comes back green, identifier by identifier, money, cost,
-- commission and contact totals included.
--
-- The migration itself deletes nothing. It installs the way to.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 2. A stale client cannot put it back
-- ---------------------------------------------------------------------
-- REFUSED, NOT STRIPPED, and the opposite choice from the settings blob.
-- Stripping a settings write loses one field out of forty-seven and the save
-- is still mostly what the person meant. Silently accepting an order blob and
-- dropping it would tell a studio their morning's work had saved when it had
-- not. A refusal reaches outboxResult, which marks 42501 fatal, stops
-- retrying and shows it on the sync pill — which is what "fail visibly"
-- has to mean on a phone in a workroom.
--
-- CONDITIONAL, so nobody is broken by this. A studio that has not been
-- migrated yet still writes its blob exactly as before; the refusal only
-- begins once that studio's orders are rows, at which point the blob is not
-- where its work lives any more.
-- SECURITY DEFINER, and the check inlined rather than put in a helper, for
-- two separate reasons.
--
-- DEFINER, because the question is about the STUDIO and not about the person
-- asking. A tailor scoped to one branch sees none of the other branch's
-- orders, so asked as them the answer would be "no, it has not moved", and
-- their out-of-date build would be allowed to write the blob back.
--
-- INLINED, because a helper called from inside a trigger IS privilege
-- checked — unlike the trigger function itself, which is not — so it would
-- have to be granted to authenticated, and it would then be callable on its
-- own: a way to ask whether any studio id you can guess has orders in it.
-- The harness found this by failing with "permission denied for function
-- studio_has_relational_orders", which is the kind of thing that gets
-- fixed with a grant at four in the afternoon.
create or replace function app.refuse_retired_order_blob()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if new.key in ('layi_dash_orders','layi_dash_orders_done')
     and exists (select 1 from public.orders o where o.business_id = new.business_id) then
    raise exception 'orders are stored as rows for this studio; this app is out of date'
      using errcode = '42501',
            hint = 'Close and reopen the app to update, then try again.';
  end if;
  return new;
end $fn$;

drop trigger if exists app_state_no_retired_orders on public.app_state;
create trigger app_state_no_retired_orders before insert or update on public.app_state
  for each row execute function app.refuse_retired_order_blob();

revoke all on function app.refuse_retired_order_blob() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. The retirement itself, which refuses unless the copy is proven
-- ---------------------------------------------------------------------
-- DELETED RATHER THAN SANITISED. A sanitised archive would have to be a
-- second copy of every order, kept in a table with a weaker gate than the
-- one the orders now sit behind, for no runtime purpose — nothing in the app
-- reads the blob any more. The rows ARE the archive, and export_studio
-- carries them.
create or replace function app.retire_order_blob(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare v_rec jsonb; v_removed int;
begin
  v_rec := app.reconcile_orders(p_business);

  if coalesce((v_rec->>'green')::boolean, false) is not true then
    raise exception 'that studio does not reconcile, so its orders stay where they are'
      using errcode = '23514',
            detail = v_rec::text,
            hint = 'Run the migration again and compare the totals before retiring anything.';
  end if;

  /* The trigger from section 2 refuses these keys once the studio has rows,
     and a DELETE does not fire a BEFORE INSERT OR UPDATE trigger, so there
     is nothing to suspend here. */
  delete from public.app_state
   where business_id = p_business
     and key in ('layi_dash_orders','layi_dash_orders_done');
  get diagnostics v_removed = row_count;

  perform app.audit(p_business, 'Legacy order store retired',
    (v_rec->>'source_orders') || ' orders reconciled and moved into rows');

  return v_rec || jsonb_build_object('blob_rows_removed', v_removed, 'retired', true);
end $fn$;

create or replace function public.retire_my_order_blob(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if not app.is_owner(p_business) then
    raise exception 'Only the studio owner can retire the old order store'
      using errcode = '42501';
  end if;
  return app.retire_order_blob(p_business);
end $fn$;

revoke all on function app.retire_order_blob(uuid) from public, anon, authenticated;
revoke all on function public.retire_my_order_blob(uuid) from public, anon;
grant execute on function public.retire_my_order_blob(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. And the catalogue stops saying these are only enforced in the browser
-- ---------------------------------------------------------------------
-- permission_catalogue.enforceable has been the honest record of which
-- permissions are real. seeCost and seeContact were 'ui_only' and that was
-- true: the blob handed them out regardless. Now they are refusals at the
-- API, so the column says so.
--
-- `money` and `receivables` are deliberately LEFT as ui_only. They are still
-- browser-only — orders.total is readable by any member who can read the
-- order — and changing the label without changing the behaviour is how a
-- catalogue stops being worth reading.
update public.permission_catalogue set enforceable = 'database'
 where key in ('seeCost','seeContact');

comment on function app.retire_order_blob(uuid) is
  'Deletes a studio''s legacy order blob, and refuses unless that studio''s '
  'own reconciliation is green. The source is never removed before the copy '
  'is proven, because a deleted source cannot be checked.';
