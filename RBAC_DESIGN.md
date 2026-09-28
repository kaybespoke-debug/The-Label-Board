# Business-scoped role based access control — audit and design

**28 September 2026. Design and audit only. Nothing here is implemented.**

---

## The headline, before the detail

**The Label Board already has a permission system.** Thirty-four named
permissions, five built-in roles, custom roles, a Roles & Permissions screen the
owner can already open, and `can('finance')` guarding two hundred places in the
app. It is not missing. It is *not security*, and it is assigned to the wrong
thing.

Three facts, all measured on staging today rather than reasoned about:

1. **A staff member can grant themselves every permission in the studio.** The
   permission table lives in `app_state` under `layi_dash_roles`, whose RLS is
   `in_scope` — any active member may write it. Signed in as a staff member,
   straight to the API: rewrote the workroom role to include finance, payroll,
   profit, the audit trail and *Accounts & roles*. **HTTP 200.**

2. **The assignment is global, not per business.** Which role a person holds is
   `profiles.role_id`, and `profiles` has one row per person for the whole
   platform. `accept_invitation` overwrites it. Somebody who is an accountant in
   one studio and a tailor in another has one answer, and it is whichever they
   joined last.

3. **The database knows two permission levels.** Every policy on every tenant
   table resolves to either `app.in_scope` (any active member) or
   `app.is_business_admin` (owner **or manager**). Staff and viewer are
   indistinguishable from each other at the data layer, and a manager is
   indistinguishable from an owner except on nine policies.

So the work is not "build RBAC". It is: **take the vocabulary that exists, move
the assignment onto the membership, move the table out of reach, and teach the
database to read it.**

And one thing that cannot be fixed by this design, stated up front rather than
discovered later: **§9**. All real data lives in one JSON blob per business. A
permission that hides a *field* — cost price, profit, a customer's phone number
— cannot be enforced against somebody who is allowed to read the blob those
fields are inside. Those permissions are honest UI and dishonest security, and
they stay that way until orders move into rows.

---

## 1. Current authorization architecture

There are **three** role systems. None of them is both business-scoped and
enforceable, and they disagree with each other.

### System A — `memberships.role`, the only one the database believes

```
memberships(business_id, user_id, branch_id, role, status)
role in ('owner','manager','staff','viewer')
```

Read by exactly two functions, both `SECURITY DEFINER` with a pinned
`search_path`:

| function | true for | used by |
|---|---|---|
| `app.in_scope(business, branch)` | any **active** member, branch-aware | 44 policies |
| `app.is_business_admin(business)` | **owner or manager** | 9 policies |

Policy census, staging, all 43 public tables:

| decided by | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `in_scope` | 14 | 11 | 10 | 9 |
| `is_business_admin` | 1 | 3 | 3 | 2 |
| `platform_admins` | 6 | 5 | 3 | — |
| `auth.uid()` directly | 2 | — | 1 | — |

`is_business_admin` covers `branches`, `businesses` and `memberships`.
Everything else — app_state, orders, customers, transactions, staff, products,
suppliers, attendance, profiles, feedback — is `in_scope`: **all four roles, same
rights.**

**Branch scope is real** on the five relational tables that carry a
`branch_id`: `orders`, `customers`, `transactions`, `staff`, `attendance`. Their
policies pass the row's branch into `in_scope`, which returns true when the
membership's `branch_id` is null (whole business) or matches. That part of the
model is sound and should be kept exactly as it is.

### System B — `profiles.role_id`, which drives the entire app

```
profiles(id, name, role_id, business_id, staff_id)
role_id in ('owner','manager','cre','tailor','accountant', <custom>)
```

`currentUser.roleId` comes from here, `currentRole()` looks it up in the roles
table, and `can(k)` reads that role's permissions. **Every UI decision in the
customer app runs through it.**

It is not security anywhere — no policy, no function and no Edge Function reads
it since the multi-business fix of 26 September — but it is also **one row per
person for the whole platform**, and `accept_invitation` overwrites
`business_id` and `role_id` on acceptance. A person in two studios has one
role_id.

### System C — `layi_dash_roles`, the permission table

An `app_state` row per business holding an array of role objects:

```json
[{ "id":"manager", "name":"Manager", "builtin":true,
   "perms": { "orders":1, "finance":1, "payroll":1, "seeProfit":1, … } }]
```

Per business — which is right — with five built-ins (`owner`, `manager`, `cre`
“Client Relations”, `tailor` “Tailor / Workroom”, `accountant`), custom roles,
a migration routine that back-fills new keys onto existing roles, and a Settings
screen where the owner ticks boxes.

Governed by `app_state`'s RLS: **`in_scope`. Any active member may rewrite it.**

### The fourth thing: `ownsThisStudio()`

Added 28 September. Reads `myMembershipRole` — System A — and gates the studio's
own settings in the app, backed by a database trigger that refuses protected
JSON fields to non-owners. It is the only place in the app where an
authorization decision is made from the membership, and it is the pattern the
rest of this design follows.

### Edge Functions

| function | how it decides |
|---|---|
| `team-admin` | `OWNER_ONLY = ['invite','resendInvitation','update','sendReset','delete']`, checked against an **active membership** for the named business. `list` is any member. |
| `admin-api` | Platform operators only (`tlb_staff` roles), every action checked against that role's own list, every call written to `tlb_audit_log`. Out of scope for tenant RBAC, except that it holds the service role and therefore bypasses all of it by design. |

### Triggers

| trigger | decides |
|---|---|
| `app.guard_studio_settings` | protected keys in `layi_dash_settings` are owner-only; `plan` is stamped from `businesses.plan` |
| `app.guard_business_identity` | `businesses.name` / `contact_email` are owner-only |
| `app.enforce_seat_limit` | plan ceiling on memberships |
| `app.provision_studio` | creates a studio, or abstains for an invitation |

---

## 2. Problems in the current architecture

**P1 — The permission table is writable by the people it restricts.**
Measured, not inferred: a staff member granted their own role `finance`,
`payroll`, `seeProfit`, `users` and `audit` with one PATCH. 200 OK. This is a
privilege-escalation path that exists in production today. It is the single
most urgent item in this document and it is fixable on its own, before any of
the rest.

**P2 — Role assignment is global.** `profiles.role_id` is one value per person.
Multi-business membership already exists and is tested; the role model has not
caught up.

**P3 — The database has two levels where the product needs a dozen.** A
manager is an admin of the business row and the branch list. A viewer can
write every order, customer and transaction the studio has. "Read-only viewer"
is a UI convention with nothing under it.

**P4 — `is_business_admin` conflates owner and manager.** It is what lets a
manager rename the studio and edit memberships. Correct for "can administer the
branch list", wrong for "is the owner".

**P5 — Nothing the owner ticks reaches the database.** Turning off `finance`
for a role changes what the app draws. It does not change one byte of what that
person can fetch.

**P6 — Field-level permissions are unenforceable by construction.** See §9.

**P7 — No vocabulary for billing or ownership.** There is no permission for
"view subscription", "manage subscription" or "transfer ownership", because
there is no transfer-ownership feature. It needs to exist before the first
studio has an argument.

---

## 3. Recommended architecture

> **Keep the vocabulary. Move the assignment. Move the table. Teach the database.**

```
                          ┌──────────────────────────────┐
  what may be done  ───►  │ business_roles               │  one row per role
                          │  business_id, key, name,     │  PER BUSINESS
                          │  tier, is_system,            │
                          │  permissions jsonb           │
                          └──────────────┬───────────────┘
                                         │ role_id
                          ┌──────────────┴───────────────┐
  who may do it     ───►  │ memberships                  │  one row per
                          │  business_id, user_id,       │  (person, business)
                          │  role_id, branch_id,         │
                          │  role (tier), status         │
                          └──────────────┬───────────────┘
                                         │
        ┌────────────────────────────────┴───────────────────────────┐
        │  app.can(business, 'finance')     app.in_scope(biz,branch) │
        │  ── WHAT ──                       ── WHERE ──              │
        └────────────────────────────────────────────────────────────┘
                 both consulted, independently, by RLS · RPC · triggers · app
```

**Four decisions.**

1. **`memberships.role` stays** as the *tier*: `owner | manager | staff |
   viewer`. It is load-bearing in nine policies and in `team-admin`, and it
   answers the one question permissions must never be able to answer — *is this
   the owner*. An owner cannot tick away their own ownership because ownership
   is not a tick.

2. **`memberships.role_id` is added**, pointing at a `business_roles` row in
   the same business. That is the capability set. A composite foreign key
   `(role_id, business_id)` makes a role from another studio unstorable, the
   same trick the branch columns already use.

3. **`business_roles` is a real table with owner-only writes.** The permission
   table stops being a document inside the data it governs.

4. **`app.can(p_business, p_perm)`** becomes the third `SECURITY DEFINER`
   function beside `in_scope` and `is_business_admin`, and every layer calls it:
   RLS, RPCs, triggers, Edge Functions and the app.

### Custom roles: yes, but the table gets them for free

`business_roles` is a table, not an enum, so *Production Manager*, *Accounts
Manager*, *Sales Assistant*, *Tailor* and *Inventory Officer* are rows. Nothing
in the design has to change to support them.

**The recommendation is to ship the four system roles first and hold the
custom-role UI for a later phase.** The tradeoff, honestly:

| | ship templates only | ship custom roles too |
|---|---|---|
| owner's first experience | four names they already understand | a blank role builder |
| support load | "make Tunde a manager" | "what did you call that role again" |
| data model work | identical | identical |
| UI work | one screen of checkboxes | plus create, rename, delete, reassign, and what happens to members of a deleted role |
| risk | a studio wants something in between and waits | a studio builds a role with `users` ticked and does not realise |

The app's Settings screen **already has** create-and-rename for custom roles, so
this is not a feature to build; it is a feature to keep switched off for one
release while the enforcement underneath is proved. The five app-level built-ins
(`cre`, `tailor`, `accountant`) map onto the four tiers and become *starting
templates* rather than a parallel system.

---

## 4. Permission catalogue

Thirty-four keys exist. The catalogue below keeps every one of them — renaming
them would invalidate every existing custom role — and adds the eleven the brief
asks for that have no key today.

**E** = enforceable in the database under this design.
**UI** = UI-only until orders move out of `app_state` (§9).

### Orders

| permission | key | today | notes |
|---|---|---|---|
| open Orders / Production | `orders` | E | per-key `app_state` gate |
| see all orders vs own only | `allOrders` | UI | rows inside one blob |
| create an order | **new** `orders.create` | UI | |
| edit an order | **new** `orders.edit` | UI | `orders` currently means all three |
| delete / cancel | `del` | UI | |
| assign a team member | **new** `orders.assign` | UI | |
| change status / post updates | `update` | UI | |
| quality check | `canQC` | UI | |
| dispatch | `canDispatch` | UI | |
| quote → confirm | **new** `orders.confirm` | UI | quoted work is a distinct act |

### Clients

| permission | key | today |
|---|---|---|
| open Customers | `customers` | E |
| see contact details | `seeContact` | **UI only — see §9** |
| create / edit | covered by `customers` | UI |
| delete | **new** `customers.delete` | UI |

### Finance

| permission | key | today |
|---|---|---|
| open Finance | `finance` | E |
| see prices and amounts | `money` | UI |
| see balances owed and money in | `receivables` | UI |
| see profit and margin | `seeProfit` | **UI only — see §9** |
| see cost prices | `seeCost` | **UI only — see §9** |
| expenses | `expenses` | E |
| funds and reserves | `funds` | E |
| retail sales | `sales` | E |
| payroll and salaries | `payroll` | E |
| record a payment | **new** `finance.record_payment` | UI |
| create / edit an invoice | **new** `finance.invoice` | UI |
| refund or credit note | **new** `finance.refund` | UI — feature does not exist yet |
| export financial data | **new** `finance.export` | E |

### Production, inventory, suppliers

| permission | key | today |
|---|---|---|
| supplies and suppliers | `supplies` | E — **one key for two things; split** |
| — open inventory | **new** `inventory.view` | E |
| — add stock | **new** `inventory.add` | UI |
| — adjust or write off | **new** `inventory.adjust` | UI |
| — suppliers | **new** `suppliers.manage` | E |
| shop / retail catalogue | `products` | E |

### Team

| permission | key | today |
|---|---|---|
| open Team | `team` | E |
| edit staff records | `editStaff` | UI |
| accounts and roles | `users` | E — **and gates the role editor itself** |
| invite a member | **new** `team.invite` | E — `team-admin` reads it |
| remove a member | **new** `team.remove` | E — `team-admin` reads it |
| attendance | `attendance` | E |

### Branches

| permission | key | today |
|---|---|---|
| switch branches | `branchSwitch` | E |
| manage branches | `setBranches` | E — owner-only today |
| *which* branch | **not a permission** — `memberships.branch_id`, §5 | E |

### Studio settings

`settings`, `setCatalog`, `setCompany`, `setWorkflow`, `setBranches`, `setData`
— all **E**, and the protected subset is already owner-only by trigger as of
28 September.

### Billing and ownership — entirely new

| permission | key |
|---|---|
| view the subscription | **new** `billing.view` |
| manage the subscription | **new** `billing.manage` — owner tier only, never tickable |
| transfer ownership | **new** `ownership.transfer` — owner tier only, and it is a *flow*, not a checkbox |

### Audit and data

| permission | key | today |
|---|---|---|
| audit trail | `audit` | E |
| import, backup, wipe | `setData` | E |
| export business data | **new** `data.export` | E |

### Things the brief missed that already exist

`appts` (appointments and fittings), `marketing` (segments and campaigns),
`logistics` (deliveries and couriers), `tasks`, `ownTasksOnly` (the workroom
restriction that makes the Tailor role work), the staff portal (`mywork`), the
feedback channel, photo storage and its quota, the planner, and import/migrate.
All keep their keys.

---

## 5. Branch scope

**Branch scope stays exactly where it is and is never folded into permissions.**
They answer different questions and multiplying them together is how a model
becomes impossible to explain:

```
   app.can(business, 'finance')        WHAT   — from business_roles.permissions
   app.in_scope(business, branch_id)   WHERE  — from memberships.branch_id
```

A row is reachable when **both** are true. Neither can substitute for the other,
and neither needs to know the other exists.

```sql
-- the shape every permission-bearing policy takes
using ( app.can(business_id, 'finance') and app.in_scope(business_id, branch_id) )
```

The two worked examples from the brief:

| | Production Manager | Accounts Manager |
|---|---|---|
| `production.update` | ✓ | ✗ |
| `orders.edit` | ✓ | ✗ |
| `finance.view` | ✗ | ✓ |
| `finance.record_payment` | ✗ | ✓ |
| branch | Ibadan only — `branch_id = <Ibadan>` | all — `branch_id is null` |

The Production Manager fetching an Ibadan order passes both. Fetching a Lagos
order passes `can` and fails `in_scope`. The Accounts Manager fetching any
branch's transactions passes both; touching a production stage fails `can`
everywhere. **Nothing in the role mentions a branch and nothing in the branch
mentions a permission.**

`branchSwitch` is a permission about the *switcher control*, not about scope: it
decides whether somebody with whole-business scope may change what they are
looking at. Somebody pinned to one branch never sees it whatever the tick says.

---

## 6. Database and API enforcement

### The new function

```sql
create or replace function app.can(p_business uuid, p_perm text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce((
    select case
             when m.role = 'owner' then true          -- the tier, not a tick
             else coalesce((r.permissions ->> p_perm) in ('1','true'), false)
           end
    from public.memberships m
    left join public.business_roles r
      on r.id = m.role_id and r.business_id = m.business_id
    where m.user_id = auth.uid()
      and m.business_id = p_business
      and m.status = 'active'
  ), false);
$$;
```

Three properties worth stating: an **owner is true for everything without
consulting the table**, so no edit to a role can lock the owner out; a member
with **no role_id is false for everything**, so a half-finished migration fails
closed; and the function is `stable`, so Postgres calls it once per query rather
than once per row.

### Where it is called

| layer | change |
|---|---|
| **RLS, relational tables** | add `app.can(business_id, '<perm>')` beside the existing `in_scope` on `transactions` (finance), `staff` (team), `attendance`, `products`, `suppliers`. `orders` and `customers` keep `in_scope` — see §9. |
| **RLS, `app_state`** | SELECT, INSERT, UPDATE and DELETE become per-key: `app.can(business_id, app.perm_for_key(key))`. `app.perm_for_key` is a small immutable mapping — `layi_dash_txns → 'finance'`, `layi_dash_staff → 'team'`, `layi_dash_audit → 'audit'`, and so on. **This is the single highest-value change in the document**: it turns "Finance is hidden from a tailor" from a UI claim into a fetch that returns nothing. |
| **`business_roles`** | SELECT to any member (the app must draw what it may do); INSERT, UPDATE and DELETE to **owner tier only**, by policy *and* by a trigger that refuses a write touching a system role's `tier`. |
| **`memberships.role_id`** | already `is_business_admin` for UPDATE — **tighten to owner tier**, otherwise a manager assigns themselves a better role, which is P1 with extra steps. |
| **RPCs** | `accept_invitation` sets `role_id` from the invitation; `create_team_invitation` gains a `p_role_id` and validates it belongs to the business. |
| **Triggers** | `guard_studio_settings` keeps its owner-only field list, and its escape hatch becomes `app.can(business,'setCompany')` for the non-protected remainder. A new trigger refuses any change to a **system** role's tier or to the owner role's permissions. |
| **`team-admin`** | `OWNER_ONLY` becomes permission-driven: `invite` requires `team.invite`, `delete` requires `team.remove`, `update` requires `users`, with the **owner tier always true**. `sendReset` stays owner-only. |
| **`admin-api`** | unchanged. It holds the service role and is meant to bypass tenant permissions; its own operator roles are a separate model and stay that way. |

### The rule that makes it testable

> Every permission must be provable by a request that does not go through the
> app. If the only thing stopping an action is a hidden button, the permission
> does not exist.

---

## 7. App changes

Small, because `can()` already exists and is already called everywhere.

1. `getRoles()` reads `business_roles` over the API instead of
   `layi_dash_roles` from the blob, cached in memory for the session.
2. `currentRole()` resolves from **`memberships.role_id`**, not
   `profiles.role_id`. `enterLiveStudio` already fetches the membership; it
   gains one join.
3. `profiles.role_id` becomes a **display label only**, and a comment says so.
   It is already not security; this makes it not authority either.
4. The Roles & Permissions screen writes to `business_roles` and is gated on
   `users` **and** owner tier for the first release.
5. Every `can()` call site is unchanged. That is the point of keeping the
   vocabulary.
6. A refused write must **say so**. A permission failure returns 403 from the
   database; the app must surface it rather than showing a silent no-op, which
   is the shape of the B1 bug.

### The owner's screen

Not an IAM console. The four roles, a short line each, and the checkboxes
already grouped the way the Settings screen groups them.

```
Settings › Team › Roles & permissions

  MANAGER                    Runs the studio when you are not there.   3 people
  ┌────────────────────────────────────────────────────────────────┐
  │ Orders & production                                            │
  │   ✓ Manage orders        ✓ Update production   ✓ Quality checks│
  │ Clients                                                        │
  │   ✓ Manage clients       ✓ See contact details                 │
  │ Money                                                          │
  │   ✓ Record payments      ☐ See profit & margins                │
  │   ☐ See cost prices      ☐ Payroll & salaries                  │
  │ Team & studio                                                  │
  │   ✓ View team            ☐ Invite people                       │
  │   ☐ Change studio settings                                     │
  └────────────────────────────────────────────────────────────────┘
        Reset to our defaults                              Save

  STAFF                      Does the work, sees what they need.      6 people
  VIEWER                     Can look, cannot change anything.        0 people
  OWNER                      You. Everything, always.                 locked
```

Three things that matter more than the layout:

- **The owner row is locked** and says so. Not disabled-looking; absent. There is
  no path in the UI to a studio with no owner.
- **"3 people"** — the count. A permission changed in the abstract is a
  permission changed for Tunde, and the owner should see that before saving.
- **Money is its own group with nothing pre-ticked beyond recording payments.**
  §8.

### Invite Member

```
  Invite someone to Adé Bespoke

  Email        tunde@…
  Role         ( ) Manager   (•) Staff   ( ) Viewer
  Branch       [ The workroom      ▾ ]   or   ( ) All branches

  Staff can: open orders, update production, see appointments, see their own pay.
  Staff cannot: see profit, run payroll, change studio settings.
                                              Change what Staff can do →

                                                   Cancel   Send invitation
```

Two fields and a sentence. The permissions come from the role; the link goes to
the screen above; **nobody ticks twenty boxes to hire a tailor.** The invitation
row stores `role_id` alongside the role tier, so an invitation accepted three
days later grants what the owner chose, not what the template says today.

---

## 8. Default role matrix

Defaults only. Every one is a tick the owner can change, except the owner row.

| | Owner | Manager | Staff | Viewer |
|---|---|---|---|---|
| **Orders** open / create / edit | ✓ | ✓ | ✓ | view only |
| delete or cancel | ✓ | ✓ | ✗ | ✗ |
| see all orders (vs assigned) | ✓ | ✓ | ✓ | ✓ |
| **Production** update, QC, dispatch | ✓ | ✓ | ✓ | ✗ |
| **Clients** open / create / edit | ✓ | ✓ | ✓ | view only |
| see contact details | ✓ | ✓ | ✓ | ✗ |
| delete a client | ✓ | ✓ | ✗ | ✗ |
| **Money** see prices | ✓ | ✓ | ✓ | ✓ |
| balances owed & money in | ✓ | ✓ | ✗ | ✗ |
| record a payment | ✓ | ✓ | ✗ | ✗ |
| **see profit & margin** | ✓ | **✗** | ✗ | ✗ |
| **see cost prices** | ✓ | **✗** | ✗ | ✗ |
| expenses | ✓ | ✓ | ✗ | ✗ |
| funds & reserves | ✓ | ✗ | ✗ | ✗ |
| **payroll & salaries** | ✓ | **✗** | ✗ | ✗ |
| export financial data | ✓ | ✗ | ✗ | ✗ |
| **Inventory** view / add | ✓ | ✓ | ✓ | view only |
| adjust or write off | ✓ | ✓ | ✗ | ✗ |
| suppliers | ✓ | ✓ | ✗ | ✗ |
| **Team** view | ✓ | ✓ | ✓ | ✓ |
| edit staff records | ✓ | ✓ | ✗ | ✗ |
| **invite / remove people** | ✓ | **✗** | ✗ | ✗ |
| **accounts & roles** | ✓ | **✗** | ✗ | ✗ |
| attendance | ✓ | ✓ | own only | ✗ |
| **Settings** operational (catalogue, workflow, tiers) | ✓ | ✓ | ✗ | ✗ |
| **company, branches, plan, import/wipe** | ✓ | **locked** | locked | locked |
| **Audit** trail | ✓ | ✓ | ✗ | ✗ |
| export business data | ✓ | ✗ | ✗ | ✗ |
| **Billing** view | ✓ | ✗ | ✗ | ✗ |
| manage subscription | ✓ | **locked** | locked | locked |
| transfer ownership | ✓ | **locked** | locked | locked |

**Where this differs from today, and why.**

- **A manager does not see profit, cost or payroll by default.** Today's
  built-in Manager role has `seeProfit:1`, `seeCost:1` and `payroll:1`. The
  brief is explicit and it is right: what a garment costs to make and what
  everyone earns are the owner's business until the owner says otherwise. The
  owner can tick all three in four seconds; nobody can un-see them.
- **A manager cannot invite or remove people by default**, because the seat
  count is money and the team list is who can read the studio. It is one tick
  away.
- **Funds & reserves is owner-only.** Money set aside is a decision, not an
  operation.
- **Locked rows are tier, not permission.** Billing, ownership and the studio's
  own identity are not tickable at all, so an owner cannot hand them over by
  accident and a manager cannot be given them by a tired owner at 11pm.
- **Viewer becomes real.** Today it is a word; here it is read-only everywhere
  and enforced per key at the database.

---

## 9. What `app_state` makes impossible — stated plainly

The customer app's real data does not live in the relational tables. Measured on
staging: `orders`, `customers`, `transactions`, `staff`, `attendance`,
`products`, `suppliers` hold **zero rows**. Every one of them has careful,
branch-scoped RLS, and the app has never written to them. The data is in
`app_state`: one row per `(business_id, key)`, one JSON blob, twenty-one keys.

This has two consequences and they are different sizes.

### What IS enforceable — per key

RLS on `app_state` can be made per key, because the key is a column. A tailor
denied `finance` can be denied `select` on `layi_dash_txns` outright. That is
real, it is cheap, and it delivers most of what the owner thinks they are
buying: **pages and features, genuinely closed.**

Roughly: `layi_dash_txns → finance`, `layi_dash_staff → team`,
`layi_dash_audit → audit`, `layi_dash_campaigns → marketing`,
`layi_dash_supplies → supplies`, `layi_dash_attendance → attendance`,
`layi_dash_roles → users`, `layi_dash_settings → settings`.

### What is NOT enforceable — per field, and per row

`layi_dash_orders` is one blob containing every order, and inside each order:
the price, the deposit, the cost of materials, the margin, and the customer's
phone number. Anybody who may open Orders at all must be able to `select` that
blob. Therefore:

> **`seeCost`, `seeProfit`, `seeContact`, `allOrders`, `money` and every
> order-level or client-level permission are UI conventions. They hide fields on
> a screen. They do not stop the person fetching the blob those fields are in.**

The same is true of row-level scope inside a blob: "only the orders assigned to
you" cannot be enforced while all orders are one value. And **branch scope does
not apply inside a blob either** — the branch-aware policies protect the empty
relational tables, not the JSON the app actually reads. A member pinned to one
branch is pinned by the app, not by the database.

This is finding B3 of the September audit, and this design does not fix it. It
is honest about it instead:

- **Tier 1 permissions** (pages, features, whole keys) — enforced everywhere.
- **Tier 2 permissions** (fields and rows inside a blob) — UI only, and the
  Roles screen should **say so**: *"Hides this on screen. Anyone who can open
  Orders can still reach the underlying data until we finish moving orders into
  the database."* An owner who knows that will not put a competitor's cousin on
  Staff and assume the margins are safe.

The permanent fix is moving `layi_dash_orders`, `layi_dash_txns` and
`layi_dash_customers` into the relational tables that are already sitting there
with the right policies. That is a large, separate piece of work with its own
migration, sync rewrite and offline story. **It should be scheduled, not bundled
into this.**

---

## 10. Migration and backwards compatibility

Additive throughout. No existing column changes meaning, and every step is
inert until the one after it.

**M1 — `business_roles`.** New table. For every existing business, seed rows
from that business's `layi_dash_roles` blob if it has one, otherwise from the
five built-in defaults. Keys preserved, so a studio that renamed *Client
Relations* to *Front of house* keeps it.

**M2 — `memberships.role_id`.** Nullable at first. Back-fill per membership:

```
role_id := the business_roles row whose key = profiles.role_id
           for that person, IF that person's profile points at THIS business
       else the system role matching memberships.role (the tier)
```

The fallback is the important half: a multi-business member whose profile points
elsewhere gets their tier's template in the other studio rather than a wrong
role or a null. Nobody loses access; some people gain a slightly more
conservative set, which is the correct direction for an error.

**M3 — `app.can()`.** Created, granted, read by nothing yet.

**M4 — enforcement, one surface at a time**, each with its own gate run before
and after: `business_roles` policies → `memberships.role_id` owner-only →
`app_state` per-key → relational tables → `team-admin`.

**M5 — the app** switches `getRoles()` and `currentRole()` over. Deployed after
M4, so a stale app is over-permissive in its drawing and still refused by the
database.

**M6 — `layi_dash_roles`** stops being written, is left in place for one
release, then deleted.

**Specific commitments:**

- **The LAYI owner keeps everything.** `memberships.role = 'owner'` short-
  circuits `app.can()` before the table is consulted.
- **The staging invitation tests stay recoverable.** `team_invitations` gains a
  nullable `role_id`; existing pending invitations have none and fall back to
  the tier template on acceptance.
- **Every member of every studio keeps working through M1–M3**, because nothing
  reads the new columns until M4.
- **Roll back** by reverting the policy migration alone. The columns are inert.

---

## 11. Test plan

Every row is a **direct API request with a real session, no app in the path** —
the harness built on 28 September (`as-user`) already does exactly this, and the
28-attempt matrix that opened this document is the template.

### The matrix

| # | proves | how |
|---|---|---|
| T1 | UI follows permission | each role, each gated screen, computed display |
| T2 | **the API follows permission** | each role × each permission × PATCH/GET, direct |
| T3 | wrong branch denied | branch-pinned member fetches another branch's rows |
| T4 | wrong business denied | member of A fetches B, with and without a valid role_id from A |
| T5 | different permissions per business | one person, two studios, opposite permission sets, both asserted in one run |
| T6 | role change takes effect | flip a permission, re-request without re-signing in |
| T7 | removing a permission removes access **immediately** | same, in the deny direction; no cached session survives it |
| T8 | adding a permission grants **only** that one | grant `finance`, assert `payroll` still 403 |
| T9 | owner cannot lock themselves out | strip every permission from the owner role, owner still passes |
| T10 | **staff cannot elevate themselves** | the exact PATCH that returned 200 today must return 403 |
| T11 | manager cannot edit their own role | PATCH `business_roles` as manager → 403 |
| T12 | manager cannot reassign their own membership | PATCH `memberships.role_id` as manager → 403 |
| T13 | the client cannot forge permissions | send a fabricated role_id, a role from another business, a permissions object in the request body |
| T14 | **`profiles.role_id` grants nothing** | set it to `owner` by hand for a viewer, assert every refusal still holds |
| T15 | seats, invitations, RLS isolation unchanged | the existing fourteen harnesses, green |
| T16 | a UI-only permission is **declared** as UI-only | assert the Roles screen labels Tier 2 permissions; the one test that protects an owner from a wrong assumption |

T10 and T14 are regression tests for holes that exist **today**. They should be
written first and should fail before anything is built.

### Mutation discipline

Every new gate is run against a deliberately broken copy before it is trusted —
the standing rule in this repo, and the reason three gates were found lying this
week.

---

## 12. Implementation phases

| phase | what | why in this order |
|---|---|---|
| **0 — today, standalone** | Move `layi_dash_roles` out of reach: either add it to the protected-key trigger or move it to `business_roles` immediately. **A studio can currently promote itself.** | It is a live escalation path and does not need the rest of this design. Half a day. |
| **1** | `business_roles` + `memberships.role_id` + `app.can()`, seeded and back-filled, **read by nothing** | reversible; proves the migration on real data |
| **2** | per-key `app_state` RLS + `business_roles` policies + `memberships.role_id` owner-only | the highest-value enforcement, and where T2, T10, T11, T12 go green |
| **3** | app switches to `memberships.role_id`; Roles screen writes the table; Tier 2 permissions labelled | the owner sees a screen that tells the truth |
| **4** | `team-admin` permission-driven; `team.invite` / `team.remove` real | unblocks delegating invitations, which is where this started |
| **5** | relational-table policies gain `app.can()` | free once the tables are used |
| **later, separately** | **orders, transactions and customers move out of `app_state`** | the only thing that makes Tier 2 real. Its own design document. |

Phases 0–2 are what make the claim "permissions are enforced" true. Phases 3–4
are what make it usable. Phase 5 and the move are what make it complete.

---

## What I recommend, in one paragraph

Do **Phase 0 this week** regardless of what happens to the rest: a member of any
studio can currently rewrite that studio's permission table and grant themselves
finance, payroll and the audit trail, and it takes one request. Then do Phases
1–4 before team invitations go live, because the product principle in the brief
— *the owner will not always be there* — is exactly the situation where somebody
holds a permission they were never meant to have and nobody is watching. Accept
that Tier 2 permissions are cosmetic for now, **say so on the screen**, and
schedule the move out of `app_state` as its own piece of work rather than
letting it hold this up.

---

**RBAC DESIGN READY FOR REVIEW**
