# Delivery status

**Pilot target: 7–10 October 2026. Broad rollout: November 2026.**
Updated at the end of each batch. Everything below is staging unless it says
PRODUCTION.

---

## DONE

### Phase 0 — a studio cannot promote itself · **PRODUCTION**, 28 Sep
Preflight was read-only and clean: nine studios, nine memberships, **every one
an owner**, no profile disagreeing with its membership, no unknown role. So the
guards cannot refuse anything live today. `layi_dash_roles` is owner-only in
full; `profiles.role_id`, `business_id` and `staff_id` are not writable from a
browser. Also deployed: the studio-settings field guard and the business
identity guard, because the Phase 0 function replaces theirs.

Tests first, and they failed: a manager, a staff member **and a viewer** each
rewrote the studio's permission table and got 200. Now 16/16 green.

*One behaviour change in production:* the plan in a studio's settings blob is
stamped from `businesses.plan` on the next save. Two studios differ — **LAYI**
(billing pro, app said trial: the stamp fixes it) and a seed studio (billing
trial, app said pro: trial carries every Pro feature).

### Batch A — RBAC foundation · staging, 29 Sep
`permission_catalogue` (45 keys, 32 database-enforceable, **13 honestly marked
`ui_only`**), `business_roles`, `business_role_permissions`,
`memberships.role_id`, `team_invitations.role_id`, and
`app.can` / `can_here` / `has_all_branches` / `is_owner`.

Seeded 40 system roles, 6 custom roles imported from studios that had built
their own, 978 grants. **All 19 memberships resolve to a real role** — owners
44 permissions, managers 27, staff 14.

The app takes its roles from the database and the person's role from their
**membership**. The existing Roles & Permissions screen is unchanged and writes
through as a diff. Release `layi-v52`.

**Fixed on the way:** an invited staff member had *no permissions at all*.
`accept_invitation` wrote `profiles.role_id` as the tier (`staff`), which
matches no role in the app's table. Kayode's own invited manager account had
zero; it now has 27. Verified end to end in a browser: an invited staff member
lands in Adé Bespoke with orders, customers and production, and without
finance, payroll, settings, delete or roles.

**Found by the probe, fixed in the batch:** a manager pointed their own
membership at the owner role and got 44 permissions. Membership writes are now
owner-only and never your own row.

Probes: Batch A 51/51, Phase 0 16/16. Harnesses: 8 green. Gates: `verify.js` 23,
safearea 66, edge-auth 61.

---

## IN PROGRESS

Nothing. Batch B is next.

---

## BLOCKED

| what | on | since |
|---|---|---|
| Batch G — billing | a payment provider decision (Paystack / Flutterwave / Stripe) | not yet asked |

---

## PILOT BLOCKER — must be true before a real studio starts

| # | item | state |
|---|---|---|
| P1 | RBAC enforced at the database, not only in the UI | **Batch B**, next |
| P2 | Team invitations working end to end against RBAC | Batch C |
| P3 | Forgot-password working (Supabase SMTP has been dead since 13 Sep) | Batch D |
| P4 | No silent data loss on save; failed saves visible | Batch E |
| P5 | Backup verified and a restore actually performed once | Batch F |
| P6 | Error and Edge Function monitoring | Batch F |
| P7 | Data export for a studio | Batch F |
| P8 | The customer app released to `main` — production still serves `layi-v46`, eleven versions behind | not scheduled |
| P9 | Production invitations switched on (`TEAM_INVITES_ENABLED` is project-scoped and off) | after C |

## NOVEMBER BLOCKER — needed for broad rollout, not for one pilot studio

| # | item |
|---|---|
| N1 | Payment provider, subscription lifecycle, webhook-driven plan state |
| N2 | Trial, failed and cancelled subscription behaviour |
| N3 | Invoices and receipts |
| N4 | Account and business deletion workflow — **note: a studio currently cannot be deleted at all**, see below |
| N5 | Privacy and data-handling statement |
| N6 | Custom-role builder exposed in the UI (schema already supports it) |

## NON-BLOCKER — known, written down, not in the way

- **Field-level permissions are UI-only.** `seeCost`, `seeProfit`,
  `seeContact`, `allOrders` and every order-level operation hide things on a
  screen inside a blob the reader may fetch. There is **no customers key** —
  clients are derived from the orders blob, so contact details are fields
  inside an order. Salaries live in the same key as the team list. The
  catalogue marks all of these `ui_only` and the Roles screen will say so.
  Real fix: move orders, transactions and staff into the relational tables
  that already have the right policies. Its own piece of work.
- **A studio cannot be deleted.** `provision_studio` writes a `partners` row
  of kind `customer` beside the business; `partners.business_id` is ON DELETE
  SET NULL and a check constraint requires a business, so the delete fails on
  `partners_kind_matches_business`. Becomes N4.
- **The platform can leave a studio without an owner.** Browsers cannot; the
  service role is not stopped. No console screen offers it and every admin-api
  call is written to `tlb_audit_log`.
- `sendReset` still uses Supabase SMTP — becomes Batch D.
- Staging's migration history diverges from the repo (many `staging_only_*`
  rows). Production's does not. A future `db push` against staging will
  complain; production is the one that matters.

---

## Projected pilot readiness

**On track for 7–10 October.** Batches B, C and D are the critical path; E and
F can run alongside. The one item outside the batches is **P8** — the customer
app on `main` is eleven releases behind and the pilot needs the current build,
which is a merge with the `netlify.toml` recipe and a full regression, not a
push.
