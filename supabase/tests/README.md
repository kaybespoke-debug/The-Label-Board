# Database tests

Two scripts. Both run offline against a real Postgres, so nothing here
touches a live project.

```bash
cd supabase/tests
npm install
npm test          # the adversarial suite: 71 checks
npm run mutate    # proves the suite can actually fail
```

## What `npm test` does

Applies every migration in `supabase/migrations` in filename order to a
throwaway Postgres 18 (PGlite, compiled to WASM, no Docker), then attacks
the policies from the position of a signed-in tenant.

Impersonation matters here. The suite does not query as the superuser,
because a superuser bypasses RLS and every check would pass while proving
nothing. It does what the Supabase API layer does per request:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<user id>",...}', true);
```

`supabase/tests/auth_stub.sql` supplies `auth.uid()` and `auth.role()`,
which Supabase provides in a real project. It is shaped exactly like
Supabase's own, including putting the `nullif` before the `::jsonb` cast.
Casting first works for signed-in callers and raises for anonymous ones,
which is precisely the path that needs testing.

The fixtures are three studios: two unrelated, and a third with two
branches and a member pinned to one of them.

What is asserted, in nine groups:

1. Structure. RLS on and forced everywhere, `business_id` not null on
   every tenant table, no write policy missing its `WITH CHECK`, all four
   commands covered, helpers `SECURITY DEFINER` with a pinned
   `search_path`, every view `security_invoker`.
2. Anonymous callers read nothing, on every table and the view.
3. A member sees their own business and no more, including by naming
   another tenant's row id directly, through a join, and through the view.
   A blocked read returns zero rows rather than an error, because an error
   confirms the row exists.
4. Writes cannot cross the boundary: no inserting into another tenant, no
   updating or deleting their rows, and no moving your own row into them
   by rewriting `business_id`. A legitimate write still succeeds.
5. Branch scoping within one business, in both directions, and business
   wide rows still visible to a branch-pinned member.
6. No self-escalation: no granting yourself membership elsewhere, no
   promoting yourself to owner, no creating or deleting a business from a
   browser session, no making yourself a platform admin.
7. Platform admins get no RLS shortcut. A platform admin session reads no
   tenant rows; cross-tenant reads go through the Edge Function gateway
   under the service role, where they can be checked and logged.
8. A table added later without RLS is caught by the audit query, and the
   test confirms it really does leak until RLS is added.
9. Whole-schema audit: no table in `public` without RLS, no grants held by
   `anon`, the audit log readable only by platform admins and editable by
   nobody, and trial history (emails and IP addresses) unreachable from
   any session at all.

## What `npm run mutate` does

Sabotages the migration in the five ways this goes wrong in practice, runs
the suite against each, and fails if any sabotage goes unnoticed:

| Mutation | Should be caught by |
|---|---|
| drop `WITH CHECK` from the update policy | group 1 and group 4 |
| forget RLS on one tenant table | groups 1, 3, 8, 9 |
| policy trusts the row, not the session (`using (true)`) | 23 checks across groups 3 to 6 |
| remove `security_invoker` from the view | groups 1 and 3 |
| drop the composite FK pinning items to their order | group 4 |

The migration is restored afterwards.

## After deploying to a real project

RLS is only as good as the last table someone added. Run this against the
live database after every deploy; an empty result is the only acceptable
answer.

```sql
select * from app.unprotected_tables;
```

Supabase's own linter covers the same ground from the dashboard, under
Advisors. Check both.
