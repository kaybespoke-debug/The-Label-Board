# Business-scoped role based access control — audit and design

**Version 2, 28 September 2026.** Phase 0 is implemented and on staging.
Phases 1–5 are design only; nothing else here is built.

Changes from v1, all four requested: the owner is the **only** inherent
superuser and `is_business_admin` is retired policy by policy (§4);
permissions are **normalised rows**, not another JSON blob (§5); branch scope
has explicit semantics and cannot be widened by omitting an argument (§6); and
the `app_state` limits are classified permission by permission rather than
described (§10).

---

## Contents

0. [Phase 0 — done, and what it found](#0)
1. [Current authorization architecture](#1)
2. [Problems in the current architecture](#2)
3. [Recommended architecture](#3)
4. [Owner versus manager, and every `is_business_admin`](#4)
5. [Data model — normalised, and why](#5)
6. [Branch scope semantics](#6)
7. [`app.can()` design](#7)
8. [Permission catalogue](#8)
9. [Default role matrix](#9)
10. [Enforceable today versus UI-only](#10)
11. [Migration](#11)
12. [App and Edge Function changes](#12)
13. [Security test matrix](#13)
14. [Implementation phases](#14)

---

<a name="0"></a>
## 0. Phase 0 — done, and what it found

**Implemented, staging only.** `supabase/migrations/20260928160000_phase0_role_authority.sql`,
`tools/rbac_phase0_probe.js`, app release `layi-v51`.

### The tests came first, and they failed

Real sessions for real members, straight to PostgREST, no app in the path:

```
a manager  rewrote the studio's permission table   200, landed
a staff    rewrote the studio's permission table   200, landed
a VIEWER   rewrote the studio's permission table   200, landed
a viewer   set their own profiles.role_id='owner'  200, accepted
                                                  8 failing assertions
```

The elevation gave the caller's own role `finance`, `payroll`, `seeProfit`,
`seeCost`, `users`, `settings`, `team`, `audit`, `setCompany` and `setData`.

### After

```
16 passed, 0 failed
```

Manager, staff and viewer each refused with **403** and a sentence naming the
reason; the owner can still manage roles; a viewer setting their own
`profiles.role_id` is now refused outright; and ordinary work — saving an order
— still succeeds for all four roles.

### What was built

| | |
|---|---|
| `layi_dash_roles` | owner-only **in full**, on insert and update. Every byte of that key is an authorization decision and no part of it is written during ordinary work, so there is no partial edit to argue about. |
| `profiles.role_id`, `business_id`, `staff_id` | not writable from a browser. The app has never written any of the three — only `name`, from two places. |
| the app | the role editor's four writers ask first, and the panel is not drawn for anybody but the owner |

### The mistake worth recording

**The first version of the guard did nothing at all.** It asked
`current_user in ('authenticated','anon')`, and inside a `SECURITY DEFINER`
function `current_user` is the function's *owner* — `postgres` on every call.
The trigger was installed, running, and returning early every time. The probe
still reported eight failures, which is the only reason it was caught.

A probe function settled it rather than reasoning: for an ordinary member's
request, `current_user=postgres`, `session_user=authenticator`,
`request.jwt.claims->>'role'=authenticated`.

So the two guards ask different questions because they stand in different
places:

- **`app_state`** is `SECURITY DEFINER` and asks the **JWT role claim**.
  Nothing but a browser writes `app_state`, so `authenticated` and `anon` are
  held to the rule and `service_role` is not.
- **`profiles`** is `SECURITY INVOKER` and asks **`current_user`**. It has to
  be: `public.accept_invitation` is a definer function that writes `role_id`
  and `business_id` *while running as the invitee, with that person's own JWT*.
  Asking the JWT would refuse a legitimate acceptance. It reads no tables, so
  invoker costs nothing.

### Staging regression

| | |
|---|---|
| settings guard matrix | unchanged across owner / manager / staff / viewer |
| **new user accepts** (profile INSERT) | 200 |
| **existing user accepts a second invitation** (profile UPDATE — the path that could have broken) | 200 |
| `team-admin` writing profiles with the service role | 200 |
| ordinary work, all four roles | saves |
| harnesses | `app_schema`, `rls`, `onboarding`, `team_invite`, `plan_limits`, `billing`, `tlb_policy`, `storage_rls` — all pass |
| app gates | `verify.js` 23 green (`audit_first_run.js` 139 checks), `audit_safearea` 66, `audit_edge_auth` 61 |

### Production recommendation

**Recommended, with one pre-flight.** The change is additive, refuses only
writes nothing in the shipped app performs, and every operational path was
re-proved after it. The pre-flight is the one thing staging cannot tell us:

> Run the two guard conditions as a **read-only query** against production
> first — does any live studio have a `profiles` row whose `role_id` or
> `business_id` disagrees with its membership, and has any live studio's
> `layi_dash_roles` been written by a non-owner? If the answer is yes anywhere,
> those studios need a look before the trigger starts refusing.

There is also a live **product** bug that Phase 0 does not fix and that
production should be checked for: `accept_invitation` writes
`profiles.role_id` as the membership tier (`staff`, `viewer`), and **no such
role exists in the app's role table** (`owner`, `manager`, `cre`, `tailor`,
`accountant`). Measured in the browser: with `role_id='staff'`, `currentRole()`
is undefined and `can('orders')`, `can('customers')`, `can('update')` are all
**false**. An invited staff member lands in an app where nothing is permitted.
A manager works only because the string `manager` happens to exist in both
vocabularies. §11 reconciles them; until then, an invitee needs their role set
by hand.

---

<a name="1"></a>
## 1. Current authorization architecture

Three role systems. None is both business-scoped and enforceable.

### A — `memberships.role`, the only one the database believes

`owner | manager | staff | viewer`, read by two `SECURITY DEFINER` functions:

| function | true for | policies |
|---|---|---|
| `app.in_scope(business, branch)` | any **active** member, branch-aware | 44 |
| `app.is_business_admin(business)` | **owner or manager** | 9 |

Everything except `branches`, `businesses` and `memberships` is `in_scope`:
**all four roles, identical rights.**

### B — `profiles.role_id`, which drives the entire app

One row per person **for the whole platform**, overwritten by
`accept_invitation`. Not security anywhere; the source of every UI decision.
Locked against browser writes as of Phase 0.

### C — `layi_dash_roles`, the permission table

Per business, five built-ins plus custom roles, thirty-four permission keys, a
Settings screen the owner already uses. Owner-only as of Phase 0.

### Edge Functions and triggers

`team-admin` checks an **active membership** for the named business, with
`OWNER_ONLY = [invite, resendInvitation, update, sendReset, delete]`.
`admin-api` is platform operators only and holds the service role, so it
bypasses tenant permissions by design.
Triggers: `guard_studio_settings`, `guard_business_identity`,
`guard_profile_authority`, `enforce_seat_limit`, `provision_studio`.

---

<a name="2"></a>
## 2. Problems

| | |
|---|---|
| **P1** | ~~The permission table is writable by the people it restricts~~ — **closed, Phase 0** |
| **P2** | Role assignment is global, not per membership |
| **P3** | The database has two levels where the product needs a dozen |
| **P4** | `is_business_admin` conflates owner and manager — §4 |
| **P5** | Nothing the owner ticks reaches the database |
| **P6** | Field- and row-level permissions are unenforceable by construction — §10 |
| **P7** | No vocabulary for billing or ownership |
| **P8** | **The two role vocabularies do not match**, so invited staff and viewers have no permissions at all — §0 |
| **P9** | **A "viewer" can delete every order in the studio.** `app_state` writes are `in_scope`, so read-only is a UI convention with nothing under it. Proved: a viewer's `POST` to `layi_dash_orders` returns 200. |

---

<a name="3"></a>
## 3. Recommended architecture

> **Keep the vocabulary. Move the assignment. Normalise the table. Teach the
> database. Never let a capability answer a question about place.**

```
   business_roles ──┬── business_role_permissions ──── permission_catalogue
   (per business)   │   (one ROW per grant)            (valid keys + labels)
                    │
                    │ role_id
             memberships ── branch_id ─────────────── branches
             (per person, per business)
                    │
        ┌───────────┴────────────┐
        │  app.can(biz, perm)    │  WHAT   — capability only
        │  app.can_here(biz,     │  WHAT + WHERE — for any row with a branch
        │      perm, branch)     │
        │  app.has_all_branches  │  for anything that aggregates
        └────────────────────────┘
```

Four decisions carried from v1, one of them now sharper:

1. **`memberships.role` stays as the tier** — `owner | manager | staff |
   viewer`. It answers the one question permissions must never answer: *is this
   the owner*. Ownership is not a tick, so it cannot be ticked away.
2. **`memberships.role_id`** points at a `business_roles` row in the same
   business, via a composite foreign key so a role from another studio is
   unstorable.
3. **`business_roles` + `business_role_permissions`** — normalised, §5.
4. **`app.can()` never implies a place** — §6, §7. This is the correction the
   brief asked for and it changes the function signature.

### Custom roles

The data model supports them from day one because a role is a row. **Ship the
four templates first; leave the custom-role builder switched off for one
release.** The app's Settings screen already has create-and-rename, so this is
not a feature to build — it is a feature to keep dark while the enforcement
underneath is proved. Tradeoff table in v1 stands; the deciding factor is that
a studio building its own role with `users` ticked, on a release where
enforcement is new, is a bad first week for everybody.

---

<a name="4"></a>
## 4. Owner versus manager — every `is_business_admin`, and its replacement

**The rule.** Under RBAC, *being called a manager must not bypass a denied
permission.* Authority comes from the role's permissions for every tier except
owner. Owner is fixed system authority and short-circuits before the permission
table is read, so an owner cannot lock themselves out and a corrupted or empty
role cannot strand a studio.

**`is_business_admin` is not deleted.** It is used in exactly nine policies and
no functions — the full census — and each is replaced individually, each with
its own before-and-after probe run. When the last one is gone the helper is
dropped in a separate migration.

| # | policy | today | proposed | default holder |
|---|---|---|---|---|
| 1 | `branches_insert` | owner+manager | `app.can(b,'branches.manage')` | owner |
| 2 | `branches_update` | owner+manager | `app.can(b,'branches.manage')` | owner |
| 3 | `branches_delete` | owner+manager | `app.can(b,'branches.manage')` **and** no rows reference it | owner |
| 4 | `businesses_insert` | owner+manager | **revoked from browsers entirely.** Studios are created by `provision_studio` and the console, never by a signed-in member. The policy is currently unreachable in practice (`is_business_admin` is false for an id you are not already in) — making that explicit removes a class of question. | nobody |
| 5 | `businesses_update` | owner+manager, plus the identity trigger | `app.can(b,'business.edit')` for `contact_email`; **`name` stays owner tier** via the existing trigger; `last_seen_at` / `app_version` need no permission at all (presence is not an edit) | owner |
| 6 | `memberships_select` | own row **or** owner+manager | own row **or** `app.can(b,'team.view')` | owner, manager, staff, viewer |
| 7 | `memberships_insert` | owner+manager | `app.can(b,'team.invite')` — and in practice service-role only, because acceptance goes through `accept_invitation` | owner |
| 8 | `memberships_update` | owner+manager | `app.can(b,'team.manage')` **and** `user_id <> auth.uid()` **and** the target's tier is not `owner` | owner |
| 9 | `memberships_delete` | owner+manager | `app.can(b,'team.remove')` **and** `user_id <> auth.uid()` | owner |

Three invariants fall out of rows 8 and 9 and they are worth naming, because
each is a way a permission system eats itself:

- **Nobody edits their own membership.** Not the owner either — an owner
  transferring ownership does it through a deliberate flow, not by editing a row.
- **Nobody edits an owner's membership but an owner.** Otherwise `team.manage`
  is a route to demoting the owner and taking the studio.
- **A studio always has at least one active owner.** A trigger refuses the last
  one being demoted, deleted or suspended, whoever is asking.

`team-admin`'s `OWNER_ONLY` array becomes permission-driven in the same step:
`invite → team.invite`, `delete → team.remove`, `update → users`, with owner
tier always true. `sendReset` stays owner-only — it is an account-recovery
power, not a team operation.

---

<a name="5"></a>
## 5. Data model — normalised, and why

**Recommendation: normalised rows.** The preference in the brief is the right
one, and the reasons are not aesthetic.

```sql
permission_catalogue                      -- global, seeded, not per business
  key            text primary key         -- 'finance', 'orders.edit'
  label          text not null            -- 'Finance'
  grp            text not null            -- 'Money'
  sort           int  not null
  tier_min       text                     -- null, or 'owner' for untickable powers
  enforceable    text not null            -- 'database' | 'ui_only'   (§10)

business_roles
  id             uuid pk
  business_id    uuid not null references businesses(id) on delete cascade
  key            text not null            -- 'manager', 'accountant', 'front-of-house'
  name           text not null            -- what the owner calls it
  tier           text not null            -- owner|manager|staff|viewer
  is_system      boolean not null default false
  created_at     timestamptz not null default now()
  updated_at     timestamptz not null default now()
  unique (business_id, key)
  unique (id, business_id)                -- so memberships can key on both

business_role_permissions
  role_id        uuid not null references business_roles(id) on delete cascade
  permission_key text not null references permission_catalogue(key)
  granted_at     timestamptz not null default now()
  granted_by     uuid
  primary key (role_id, permission_key)

memberships
  + role_id      uuid
  + foreign key (role_id, business_id) references business_roles(id, business_id)
```

### Rows versus a JSON blob, point by point

| | normalised rows | `permissions jsonb` |
|---|---|---|
| **RLS checks** | `exists (… where permission_key = $1)` on the composite primary key — an index lookup with a plan you can read | `->> 'finance'` on one small row; fast too, but the plan is opaque and a GIN index is overkill |
| **indexes** | the primary key *is* the index | needs a GIN index or nothing |
| **constraints** | `references permission_catalogue(key)` — **a typo is rejected at write time** | `{"finanace":1}` is accepted silently and denies silently. This is the argument. A permission that fails closed because of a spelling mistake is the hardest bug in this class to find |
| **audit** | a row per grant carries `granted_at` and `granted_by`; a revocation is a `DELETE` you can log | you diff two blobs and guess |
| **revocation** | `delete … where role_id = x and permission_key = y` — precise, and concurrent edits to different permissions both land | read-modify-write: two owners ticking different boxes at once, one loses, silently |
| **custom roles** | identical | identical |
| **migrations** | a new permission is one catalogue row | a new permission is a back-fill across every role of every business. **The app already carries a 40-line `migrateRoles()` whose entire job is this back-fill, with a comment explaining how reading the live object instead of a snapshot made the result depend on the order of the Settings screen.** That function is the evidence |

**The one real argument for JSON** is that the app reads a role as an object and
would need an aggregate. That is one view:

```sql
create view app.role_permissions_v as
  select r.id as role_id, r.business_id,
         coalesce(array_agg(p.permission_key) filter (where p.permission_key is not null), '{}') as keys
  from business_roles r
  left join business_role_permissions p on p.role_id = r.id
  group by r.id, r.business_id;
```

Not enough to give up constraints and precise revocation.

### The catalogue is global, the grants are not

`permission_catalogue` is platform-wide: it defines which keys *exist* and what
they are called, so the Roles screen is data-driven and a new permission does
not need an app release. **No business's grants are global** — every grant is a
row pointing at a role that points at one business. A person's permissions in
Business A are reachable only through their membership of A.

---

<a name="6"></a>
## 6. Branch scope semantics

Permission and branch are **separate dimensions**, and the failure the brief
names — *turning a branch permission into business-wide access by omitting an
argument* — is prevented by making the omission impossible rather than
discouraged.

### The four cases, defined

| case | meaning | check |
|---|---|---|
| **membership with a branch** | `memberships.branch_id = X` — this person works at X and nowhere else | `in_scope` is true only for rows at X, or rows with no branch |
| **membership with NULL branch** | whole business | `in_scope` is true everywhere in that business |
| **branch-specific resource** | the row has a `branch_id` — orders, customers, transactions, staff, attendance | **`app.can_here(business, perm, row.branch_id)`**, and the branch argument is the *row's column*, never a value from the request |
| **business-wide resource** | no branch column — settings, roles, suppliers, products, the business row | `app.can(business, perm)` to **read**; to **write**, `app.can(...)` and `app.has_all_branches(business)` |
| **reports across branches** | an aggregate that spans more than one branch | `app.can(business,'reports.financial')` **and** `app.has_all_branches(business)`; a branch-pinned member gets their own branch's figures or nothing, never a total |

### Why the two-argument form is not enough, and how that is enforced

`app.can(business, perm)` deliberately **answers only WHAT**. It has no branch
parameter with a `null` default, because a default is exactly the trap: a policy
author writes `app.can(biz,'finance')` on a table that has a `branch_id`, and a
member pinned to Ibadan reads Lagos.

So:

1. **There is no optional branch argument anywhere.** Branch-bearing tables use
   `can_here`, which requires three arguments.
2. **A static gate asserts it.** A harness walks `pg_policies`, and for every
   table with a `branch_id` column asserts that every policy's expression
   contains `can_here(` and the literal `branch_id`. A policy that forgets is a
   red gate, not a discovered incident. This is cheap and it is the only
   mechanical defence against a whole class of mistake.
3. **`has_all_branches` is separate** so "may see the whole business" is a
   distinct, greppable fact rather than an accident of a null.

### Worked examples

| | Production Manager | Accounts Manager |
|---|---|---|
| `production.update` | ✓ | ✗ |
| `orders.edit` | ✓ | ✗ |
| `finance.view` | ✗ | ✓ |
| `finance.record_payment` | ✗ | ✓ |
| branch | Ibadan — `branch_id = <Ibadan>` | all — `branch_id is null` |
| an Ibadan order | `can_here` ✓✓ → allowed | `can` ✗ → denied |
| a Lagos order | `can` ✓, `in_scope` ✗ → denied | `can` ✗ → denied |
| a Lagos payment | denied twice over | allowed |
| the monthly P&L | `has_all_branches` false → **Ibadan only** | full |

### Adversarial tests (also in §13)

| | attack |
|---|---|
| **B1** | Ibadan-pinned member `PATCH`es a Lagos row → denied |
| **B2** | Ibadan-pinned member inserts a row *with `branch_id = Lagos`* → denied by `with check`, not only by `using` |
| **B3** | Ibadan-pinned member inserts a row with `branch_id = null` on a branch-bearing table, hoping to make it business-wide → denied; `branch_id` is `not null` on those tables and the policy requires a match |
| **B4** | Ibadan-pinned member calls a report RPC with no branch argument → returns Ibadan only, never a total |
| **B5** | Ibadan-pinned member with `finance.record_payment` records a Lagos payment → denied |
| **B6** | Ibadan-pinned member updates a row's `branch_id` from Ibadan to Lagos → denied (the `with check` fails on the new value even though `using` passed on the old) |
| **B7** | Ibadan-pinned member writes a **business-wide** resource that aggregates — the settings blob, the supplier list → denied without `has_all_branches` |

B6 is the one most systems miss: `using` guards the row you can see, `with
check` guards the row you leave behind, and a move between branches needs both.

---

<a name="7"></a>
## 7. `app.can()` design

```sql
-- WHAT. Capability only. Never a place.
create or replace function app.can(p_business uuid, p_perm text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.business_id = p_business
      and m.status = 'active'
      and ( m.role = 'owner'                       -- the tier, never a tick
            or exists ( select 1
                        from public.business_role_permissions p
                        where p.role_id = m.role_id
                          and p.permission_key = p_perm ) )
  );
$$;

-- WHAT and WHERE. For every row that carries a branch.
create or replace function app.can_here(p_business uuid, p_perm text, p_branch uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select app.can(p_business, p_perm) and app.in_scope(p_business, p_branch);
$$;

-- Whether this member speaks for the whole business.
create or replace function app.has_all_branches(p_business uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.business_id = p_business
      and m.status = 'active' and m.branch_id is null
  );
$$;
```

Properties, each chosen rather than fallen into:

- **Owner short-circuits before the permission table is read.** No edit to any
  role can lock an owner out, and an empty or half-migrated table leaves the
  owner working.
- **A member with no `role_id` is false for everything.** A half-finished
  migration fails closed, loudly, for the people it has not reached.
- **`stable`**, so Postgres calls it once per query rather than once per row.
- **No `security definer` reads of anything the caller chose.** Both arguments
  are either a literal in a policy or a column of the row being tested.
- **`can_here` cannot be short-circuited** by passing `null` for the branch:
  `in_scope(business, null)` is true only when the *row* has no branch, and
  branch-bearing tables have `branch_id not null`.

---

<a name="8"></a>
## 8. Permission catalogue

Thirty-four keys exist and every one is kept — renaming them would invalidate
every custom role a studio has already built. Fifteen are added. The full
table, with the §10 classification, is:

**Orders** — `orders` (A) · `allOrders` (B) · `orders.create` (B) ·
`orders.edit` (B) · `del` (B) · `orders.assign` (B) · `update` (B) ·
`canQC` (B) · `canDispatch` (B) · `orders.confirm` (B)

**Clients** — `customers` (A) · `seeContact` (B) · `customers.delete` (B)

**Money** — `finance` (A) · `money` (B) · `receivables` (B) · `seeProfit` (B) ·
`seeCost` (B) · `expenses` (A) · `funds` (A) · `sales` (A) · `payroll` (B, see
§10) · `finance.record_payment` (B) · `finance.invoice` (B) · `finance.refund`
(B, feature does not exist) · `finance.export` (A)

**Stock and suppliers** — `supplies` (A) · `inventory.adjust` (B) ·
`suppliers.manage` (A) · `products` (A)

**Team** — `team` (A) · `editStaff` (B) · `users` (A) · `team.invite` (A) ·
`team.remove` (A) · `team.view` (A) · `attendance` (A)

**Branches** — `branchSwitch` (A) · `setBranches` → `branches.manage` (A)

**Studio** — `settings` (A) · `setCatalog` (A) · `setCompany` → `business.edit`
(A) · `setWorkflow` (A) · `setData` (A)

**Billing and ownership** — `billing.view` (A) · `billing.manage` (owner tier,
untickable) · `ownership.transfer` (owner tier, untickable)

**Audit and data** — `audit` (A) · `data.export` (A)

**Already there and not in the brief** — `appts`, `marketing`, `logistics`,
`tasks`, `ownTasksOnly`, `mywork` (staff portal), `companylog`, `leave`,
`rota`, the feedback channel, photo storage, the planner, import/migrate.

---

<a name="9"></a>
## 9. Default role matrix

Defaults only, all tickable except the locked rows.

| | Owner | Manager | Staff | Viewer |
|---|---|---|---|---|
| Orders — open / create / edit | ✓ | ✓ | ✓ | **read** |
| delete or cancel | ✓ | ✓ | ✗ | ✗ |
| Production — update, QC, dispatch | ✓ | ✓ | ✓ | ✗ |
| Clients — open / create / edit | ✓ | ✓ | ✓ | **read** |
| see contact details | ✓ | ✓ | ✓ | ✗ |
| Money — see prices | ✓ | ✓ | ✓ | ✓ |
| balances owed, money in | ✓ | ✓ | ✗ | ✗ |
| record a payment | ✓ | ✓ | ✗ | ✗ |
| **profit & margin** | ✓ | **✗** | ✗ | ✗ |
| **cost prices** | ✓ | **✗** | ✗ | ✗ |
| expenses | ✓ | ✓ | ✗ | ✗ |
| funds & reserves | ✓ | ✗ | ✗ | ✗ |
| **payroll & salaries** | ✓ | **✗** | ✗ | ✗ |
| export financial data | ✓ | ✗ | ✗ | ✗ |
| Stock — view / add | ✓ | ✓ | ✓ | read |
| adjust or write off | ✓ | ✓ | ✗ | ✗ |
| suppliers | ✓ | ✓ | ✗ | ✗ |
| Team — view | ✓ | ✓ | ✓ | ✓ |
| edit staff records | ✓ | ✓ | ✗ | ✗ |
| **invite / remove people** | ✓ | **✗** | ✗ | ✗ |
| **accounts & roles** | ✓ | **✗** | ✗ | ✗ |
| attendance | ✓ | ✓ | own | ✗ |
| Settings — operational | ✓ | ✓ | ✗ | ✗ |
| **company, branches, plan, import/wipe** | ✓ | **locked** | locked | locked |
| Audit trail | ✓ | ✓ | ✗ | ✗ |
| export business data | ✓ | ✗ | ✗ | ✗ |
| Billing — view | ✓ | ✗ | ✗ | ✗ |
| **manage subscription, transfer ownership** | ✓ | **locked** | locked | locked |

Where this differs from today's built-in Manager — which has `seeProfit`,
`seeCost` and `payroll` all on — the reason is in the brief and it is right:
what a garment costs and what everyone earns are the owner's business until the
owner says otherwise. Four seconds to tick; nobody can un-see them.

**Viewer becomes real**, which today it is not: a viewer can currently write
every `app_state` key, including deleting the orders blob. Phase 2 gives viewer
`select` and nothing else.

---

<a name="10"></a>
## 10. Enforceable today versus UI-only

The customer app's data is not in the relational tables. Measured on staging:
`orders`, `customers`, `transactions`, `staff`, `attendance`, `products`,
`suppliers` hold **zero rows** between them. Every one has careful
branch-scoped RLS and the app has never written to any of them. Everything is
in `app_state`: one row per `(business_id, key)`, one JSON blob, 21 keys.

### A — enforceable at the database, per key

RLS on `app_state` can be per key, because the key is a column. This is real,
cheap, and delivers most of what an owner thinks they are buying: **pages and
features, genuinely closed**, and separately for reading and writing.

| permission | key it gates | read | write |
|---|---|---|---|
| `finance` | `layi_dash_txns`, `layi_dash_bills`, `layi_dash_pots` | ✓ | ✓ |
| `audit` | `layi_dash_audit` | ✓ | ✓ |
| `marketing` | `layi_dash_campaigns` | ✓ | ✓ |
| `attendance` | `layi_dash_attendance` | ✓ | ✓ |
| `supplies` | `layi_dash_supplies` | ✓ | ✓ |
| `products` / `sales` | `layi_dash_products` | ✓ | ✓ |
| `team` | `layi_dash_staff` | ✓ | ✓ |
| `users` | `layi_dash_roles` | ✓ | ✓ (owner, Phase 0) |
| `settings` | `layi_dash_settings` | ✓ | field-level (done) |
| `tasks`, `appts`, `leave`, `rota`, `companylog` | their own keys | ✓ | ✓ |
| `orders` | `layi_dash_orders`, `_done` | ✓ | ✓ |

Plus everything on the relational tables once they are used, and everything on
`businesses`, `branches` and `memberships` today.

### B — UI-only, and it must say so on the screen

| permission | why it cannot be enforced |
|---|---|
| **`seeProfit`, `seeCost`, `money`, `receivables`** | the numbers are fields inside `layi_dash_orders` and `layi_dash_txns`. Anybody allowed to open Orders must be able to fetch the blob those fields are in |
| **`seeContact`** | there is **no customers key** — clients are derived from the orders blob, so a contact detail is a field inside an order. Anyone who can open Orders can read every phone number |
| **`allOrders`, `orders.assign`** | "only the orders assigned to you" is row-level scope inside a single value |
| **`del`, `update`, `canQC`, `canDispatch`, `orders.create`, `orders.edit`** | all of these are operations on rows inside one blob. **A member who may write `layi_dash_orders` at all may rewrite or empty the whole thing**, whatever these say |
| **salaries** | pay lives inside `layi_dash_staff`, the same key `team` opens. A manager with `team` but not `payroll` can read every salary |
| **`editStaff`** | same blob as viewing staff |
| **branch filtering of anything in `app_state`** | the blob is per business. **A branch-pinned member's scope is enforced by the app, not the database**, for all 21 keys |
| **audit-log integrity** | `layi_dash_audit` is readable and writable as one value, so an entry can be removed by anybody with the key. Reading is enforceable; *not tampering* is not |

### The rule this imposes on the product

> **A permission is only called secure if a request that skips the app is
> refused.** Everything in B is labelled on the Roles screen — *"Hides this on
> screen. Anyone who can open Orders can still reach the underlying data until
> orders move into the database."* An owner who knows that will not put a
> competitor's cousin on Staff and assume the margins are safe.

`permission_catalogue.enforceable` carries this, so the label is data and cannot
drift from the truth.

The permanent fix is moving `layi_dash_orders`, `layi_dash_txns` and the staff
records into the relational tables already waiting with the right policies. It
is a large, separate piece of work — migration, sync rewrite, offline story —
and it should be **scheduled, not bundled**.

---

<a name="11"></a>
## 11. Migration

Additive. No column changes meaning; each step inert until the next.

**M1** `permission_catalogue` seeded from `PERM_GROUPS` in the app, with
`enforceable` set per §10.

**M2** `business_roles` + `business_role_permissions`. For each business: seed
from that studio's `layi_dash_roles` blob if it has one, else from the five
built-ins. Keys preserved, so a studio that renamed *Client Relations* keeps it.
Unknown keys in a blob are dropped **and reported**, not silently kept.

**M3** `memberships.role_id`, nullable, back-filled:

```
role_id := the business_roles row whose key = profiles.role_id
           IF that profile points at THIS business AND such a role exists
       else the system role matching memberships.role (the tier)
```

The fallback carries the weight. It also **fixes P8**: everybody whose
`profiles.role_id` is `staff` or `viewer` — a value matching no role, leaving
them with no permissions at all — lands on the tier template and can work.

**M4** `app.can`, `app.can_here`, `app.has_all_branches`. Read by nothing.

**M5** Enforcement, one surface at a time, each with a before-and-after probe:
`business_roles` policies → `memberships` (the nine in §4) → `app_state` per
key → relational tables → `team-admin`.

**M6** App switches `getRoles()` and `currentRole()` to the table and the
membership.

**M7** `layi_dash_roles` stops being written, stays one release, then goes.

**Commitments.** The LAYI owner keeps everything (owner tier short-circuits).
Pending staging invitations keep working (`team_invitations.role_id` is
nullable and falls back to the tier). Every member keeps working through M1–M4
because nothing reads the new columns. Rollback is reverting the policy
migration alone.

---

<a name="12"></a>
## 12. App and Edge Function changes

**App.** `getRoles()` reads `business_roles` + the permissions view, cached for
the session. `currentRole()` resolves from `memberships.role_id`, not
`profiles.role_id`. Every one of the ~200 `can()` call sites is unchanged —
that is the point of keeping the vocabulary. The Roles screen writes rows,
renders from `permission_catalogue` so a new permission needs no release, and
**labels every `ui_only` permission**. A refused write surfaces the 403 rather
than showing a silent no-op.

**Invite Member** stays two fields and a sentence:

```
  Email        tunde@…
  Role         ( ) Manager   (•) Staff   ( ) Viewer
  Branch       [ The workroom ▾ ]   or   ( ) All branches

  Staff can: open orders, update production, see appointments, see their own pay.
  Staff cannot: see profit, run payroll, change studio settings.
                                              Change what Staff can do →
```

The invitation stores `role_id`, so an invitation accepted three days later
grants what the owner chose, not what the template says by then. **A role in
Business A has no effect in Business B**, because a grant is a row under a role
under one business.

**`team-admin`** takes its gate from permissions rather than an array, owner
tier always true. **`admin-api`** unchanged.

---

<a name="13"></a>
## 13. Security test matrix

Every row is a direct API request with a real session — the `as-user` harness
built on 28 September, the same one that produced the Phase 0 numbers.

| # | proves |
|---|---|
| T1 | UI controls follow permission |
| T2 | **direct API requests follow permission**, every role × every permission |
| T3 | wrong branch denied — §6 B1 |
| T4 | wrong business denied, including with a valid role_id from another business |
| T5 | one person, two studios, opposite permission sets, both asserted in one run |
| T6 | a role change takes effect without re-signing in |
| T7 | **removing a permission removes access immediately** |
| T8 | adding a permission grants **only** that capability |
| T9 | an owner stripped of every permission still passes everything |
| T10 | **staff cannot elevate themselves** — *written and green, Phase 0* |
| T11 | a manager cannot edit their own role |
| T12 | a manager cannot reassign their own membership |
| T13 | the client cannot forge permissions: fabricated role_id, a role from another business, a permissions object in the body |
| T14 | **`profiles.role_id` grants nothing** — *written and green, Phase 0* |
| T15 | the last owner cannot be demoted, deleted or suspended |
| T16 | a `ui_only` permission is declared as such in the catalogue and labelled on screen |
| T17 | **every policy on a branch-bearing table uses `can_here` with that table's `branch_id`** — static, over `pg_policies` |
| T18 | §6 B2–B7, the branch adversarial set |
| T19 | the fourteen existing harnesses stay green |

Every new gate is run against a deliberately broken copy before it is trusted.
Three gates were found lying this week by exactly that discipline, and Phase 0's
first guard was found doing nothing at all because the probe was written first.

---

<a name="14"></a>
## 14. Implementation phases

| phase | what | state |
|---|---|---|
| **0** | `layi_dash_roles` owner-only; `profiles` authority columns locked; probe written first | **done, staging** |
| **1** | catalogue, `business_roles`, `business_role_permissions`, `memberships.role_id`, `app.can` / `can_here` / `has_all_branches` — seeded, back-filled, **read by nothing** | design |
| **2** | enforcement: `business_roles` policies, the nine `is_business_admin` replacements, per-key `app_state` RLS with read and write separated | design |
| **3** | app reads the membership and the table; Roles screen writes rows; `ui_only` labelled | design |
| **4** | `team-admin` permission-driven; `team.invite` / `team.remove` real; invitations carry `role_id` | design |
| **5** | relational-table policies gain `app.can_here`; `is_business_admin` dropped | design |
| **later** | **orders, transactions and staff move out of `app_state`** — the only thing that makes the B list real. Its own document | not scheduled |

Phases 1–2 make "permissions are enforced" true. Phase 3–4 make it usable.
Phase 5 and the move make it complete.

---

**PHASE 0 READY FOR PRODUCTION REVIEW**

**RBAC DESIGN V2 READY FOR REVIEW**
