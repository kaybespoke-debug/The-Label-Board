# Delivery status

Full required scope. Nothing is deferred to a later release. Work is sequenced
for speed, not moved out of the programme.

**Updated 29 September 2026.**

---

## The date, reported immediately as asked

**7 to 10 October is not achievable with the required scope.**

The reason is one specific decision in the correction: sensitive data must not
remain a UI-only boundary while real studio staff have access. That converts
the `app_state` blob from a January problem into current scope, and it is the
largest single change this app has had.

Measured rather than estimated: `layi_dash_orders` is referenced in 43 places,
`rawOrders()` in 33, and an order record carries `o.cost`, `o.email`,
`o.phone` and `o.whatsapp` inline. Those four fields are exactly what
`seeCost` and `seeContact` claim to hide.

| work | days |
|---|---|
| B, RBAC enforcement including per-key `app_state` RLS | 2 |
| C, invitations against RBAC and multi-business switching | 2 |
| D, password recovery through Resend | 1 |
| Sensitive fields out of the orders blob, plus E sync hardening | 8 to 10 |
| F, monitoring, backup, restore drill, export, deletion, audit integrity | 3 |
| G, Flutterwave end to end | 4 |
| H, consolidated release candidate and full regression | 2 |
| **total** | **22 to 24 working days** |

That puts full pilot readiness at roughly **27 to 31 October**, with November
rollout intact but without much slack. The estimate assumes no further
discoveries, and the record this month says that is optimistic.

### There is a second shape, and it defers nothing

A studio with **one person in it has no permission surface at all**. Every gap
above is about what a second person can reach. So the pilot could start with
owner-only studios while the team-facing work completes, and nothing leaves the
programme.

| | full scope first | owner-only pilot first |
|---|---|---|
| pilot starts | 27 to 31 Oct | **13 to 15 Oct** |
| needs first | everything | D, E, F core, H release |
| studios can invite staff | day one | when C and the orders move land, late Oct |
| anything deferred | no | no |
| November rollout | tight | comfortable |

**This is a product decision and it is the only thing I am waiting on.** Work
continues on B in the meantime, because B is required in both shapes.

---

## DONE

### Phase 0, a studio cannot promote itself. **PRODUCTION**, 28 Sep
Preflight clean: nine studios, nine memberships, every one an owner, no profile
disagreeing with its membership. `layi_dash_roles` is owner-only in full;
`profiles.role_id`, `business_id` and `staff_id` are not writable from a
browser. Deployed with the studio-settings field guard and the business
identity guard. Tests written first and failing: a manager, a staff member and
a viewer each rewrote the permission table and got 200. Now 16 of 16 green.

### Batch A, RBAC foundation. Staging, 29 Sep
`permission_catalogue` (45 keys, 32 database-enforceable, 13 marked `ui_only`),
`business_roles`, `business_role_permissions`, `memberships.role_id`,
`team_invitations.role_id`, `app.can` / `can_here` / `has_all_branches` /
`is_owner`. 40 system roles, 6 custom roles imported, 978 grants, all 19
memberships resolving to a real role.

The app takes roles from the database and the person's role from their
membership. Fixed on the way: an invited staff member previously had zero
permissions. Found by the probe and fixed in the batch: a manager could point
their own membership at the owner role. Batch A probe 51 of 51.

---

## IN PROGRESS

### Batch B, RBAC enforcement
Per-key RLS on `app_state` so a permission refuses a request that skips the
app; the nine `is_business_admin` replacements; custom roles connected to the
secure model so the existing screen is honest about what it offers.

---

## BLOCKED

| item | blocked on | dependency |
|---|---|---|
| Pilot start date | **Kayode**: full scope first, or owner-only pilot first | the table above |
| G, Flutterwave | nothing technical. Needs live and test API keys on the staging and production projects | after the checkout flow is built |

---

## The required programme, in sequence

Every item below is current scope.

**B. RBAC enforcement.** Per-key `app_state` RLS separating read from write, so
a viewer is genuinely read-only and a tailor cannot fetch the transactions key.
The nine `is_business_admin` policies replaced by named capabilities. Custom
roles wired to `business_roles`. Bypass test per capability.

**C. Team invitations against RBAC.** Role and branch chosen at invite,
permissions inherited, new user and existing user, resend, cancel, expiry,
acceptance, seat accounting, and a business switcher so a multi-business person
is never stranded on a 409.

**D. Password recovery through Resend.** Supabase SMTP has been dead since 13
September. Owner recovery, staff recovery, multi-business recovery, link reuse
and expiry, no duplicate accounts.

**E. Sync and the orders move, together.** They are one piece of work because
both rewrite the same persistence layer. Durable outbox, retry, visible sync
state, failure visibility, conflict detection, two devices, reconnect, offline
changes, membership revoked while offline. Alongside it: cost and contact
fields out of the orders blob into relational rows so `seeCost` and
`seeContact` become real, orders into rows so assigned-only and branch
filtering become real, and an append-only audit table so history cannot be
rewritten by anybody holding the key.

**F. Operations.** Frontend error and unhandled rejection monitoring, Edge
Function failure monitoring, backup verification, an actual restore drill,
recovery procedure, tenant recovery, secure audit trail, export, account
deletion, studio offboarding including the `partners` foreign key that
currently makes a studio undeletable.

**G. Flutterwave.** Checkout, plans, trials, success, failure, renewal,
cancellation, upgrade and downgrade, webhook verification, server-controlled
subscription state, `businesses.plan` written only by trusted server paths,
plan limits, billing history, customer billing management.

**H. One consolidated release candidate.** No dripping into production. Full
staging regression, then back for promotion approval.

---

## Known issues, all inside the programme

- Sensitive fields inline in the orders blob: `o.cost`, `o.email`, `o.phone`,
  `o.whatsapp`. Fixed in E.
- A viewer can currently write and delete every `app_state` key. Fixed in B.
- The audit trail can be rewritten by anybody who can read it. Fixed in E.
- A studio cannot be deleted: `provision_studio` writes a `partners` row of
  kind `customer`, `partners.business_id` is ON DELETE SET NULL, and a check
  constraint requires a business. Fixed in F.
- The platform can leave a studio without an owner. Browsers cannot. Fixed in
  F with the offboarding flow.
- `sendReset` still uses Supabase SMTP. Fixed in D.
- Production serves `layi-v46`; the branch is on `layi-v52`. Resolved by H.
- Staging's migration history diverges from the repo because of earlier
  `staging_only_*` migrations. Production's does not. Cleaned up before H.
