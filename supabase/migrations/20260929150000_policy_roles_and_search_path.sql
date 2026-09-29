-- =====================================================================
-- Two house rules the Batch E migrations broke, put back
-- =====================================================================
-- Neither of these is a hole today. Both are rules that exist so that a
-- hole tomorrow cannot open quietly, and tlb_policy_harness enforces them
-- precisely because nobody notices the day they lapse. Batch E recreated
-- thirty-seven policies and added four functions, and lapsed on both.
--
-- Rule one: a policy created without `to <role>` applies to PUBLIC, which
-- on Supabase includes anon. Every predicate involved returns false for
-- anon right now, so nothing leaks — but that makes the safety a property
-- of the predicate rather than of the grant, and a predicate is the thing
-- that gets edited.
--
-- ALTER POLICY, not DROP and CREATE. The predicates are correct and they
-- are long; retyping thirty-seven of them from memory is how you change
-- three things nobody asked for. ALTER touches the role list and nothing
-- else, so the catalogue stays the source of truth for the rest.
do $$
declare r record; n int := 0;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and 'public' = any(coalesce(roles,'{}'))
            order by tablename, policyname
  loop
    execute format('alter policy %I on public.%I to authenticated', r.policyname, r.tablename);
    n := n + 1;
  end loop;
  raise notice 'named the role on % policies', n;

  -- and say so if any survived, rather than leaving the harness to find out
  if exists (select 1 from pg_policies
              where schemaname = 'public' and 'public' = any(coalesce(roles,'{}'))) then
    raise exception 'a policy in public is still open to PUBLIC';
  end if;
end $$;

-- Rule two: a SECURITY DEFINER function without a pinned search_path can
-- be pointed at somebody else's table by whoever calls it. app.slugify
-- shipped without one once and Supabase's own linter found it before this
-- repo did; these four arrived the same way.
alter function app.default_permissions(text)   set search_path = public, pg_temp;
alter function app.perm_for_key(text)          set search_path = public, pg_temp;
alter function app.write_perm_for_key(text)    set search_path = public, pg_temp;
alter function app.bump_order_rev()            set search_path = public, pg_temp;
