-- =====================================================================
-- Prepare LAYI as a real studio, waiting for its owner to claim it.
--
-- Kayode wants to run his own label on the product before the October
-- testers arrive, signing in as layiojomo@gmail.com. That address was
-- the console owner's login until 20260921120000 moved it to
-- layiwolaojomo@thelabelboard.com, so it is now free.
--
-- WHY A MIGRATION AND NOT THE CONSOLE'S INVITE BUTTON. The button does
-- two things: it writes this row, and it asks Supabase to email an
-- invitation. The row is the half that matters and the half that can be
-- checked. The email needs a service role key and sends mail in his
-- name, so it is not mine to send -- and it is not needed, because
-- app.provision_studio() claims a prepared row from ANY account
-- creation, not just an invited one. He creates the account with a
-- password only he ever sees, and the trigger attaches it here.
--
-- ORDER MATTERS. The row must exist BEFORE the account. provision_studio
-- looks for a pending address on insert into auth.users; if the account
-- comes first there is nothing to claim and the trigger cheerfully
-- builds him a second, empty studio instead.
--
-- PRO AT ZERO, ON PURPOSE. This is our own label, not a customer. It
-- needs everything Pro unlocks, and it must not appear in what we are
-- owed: set_studio_plan takes the price, and 49,000 naira typed here
-- would show up as revenue nobody is ever going to pay us. The plan
-- gates the app; the price is what we invoice. They are allowed to
-- differ, and this is the case they were allowed to differ for.
--
-- Safe to run twice: matched on the slug, and the plan call only
-- happens on the run that creates the row.
-- =====================================================================

do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where slug = 'layi';
  if v_biz is not null then
    raise notice 'LAYI already exists (%), leaving it alone', v_biz;
    return;
  end if;

  insert into public.businesses
    (name, slug, plan, status, contact_email, pending_owner_email)
  values
    ('LAYI', 'layi', 'trial', 'active', 'layiojomo@gmail.com', 'layiojomo@gmail.com')
  returning id into v_biz;

  -- the invite path creates this too; a studio with no branch has nowhere
  -- to put an order
  insert into public.branches (business_id, name) values (v_biz, 'Main studio');

  -- both books at once, which is the whole reason this function exists
  perform app.set_studio_plan(v_biz, 'pro', 'monthly', 0);
end $$;
