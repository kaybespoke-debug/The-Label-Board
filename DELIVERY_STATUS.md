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

### Batch B, RBAC enforcement. Staging, 29 Sep
Per-key RLS on `app_state`, read and write answered separately, so a viewer is
genuinely read-only and a tailor cannot fetch the transactions key. Four new
permissions where a viewer would otherwise have written everything they could
see, plus `tasks`, which the app was already asking for and the catalogue did
not have. The five remaining `is_business_admin` policies replaced. Custom
roles proved end to end: an owner creates one, a staff member cannot add to
it, the owner assigns it, and the database honours exactly its permissions.

Two regressions caught by older probes rather than by luck: the roles key went
quiet (zero-row write, 200, no message, the B1 shape) and the invoice counter
depended on writing settings, which a staff member no longer may. Both fixed.

Batch B probe 68 of 68. Release `layi-v53`.

---

### Batch C, invitations against RBAC. Staging, 29 Sep
team-admin’s gate is a permission rather than a tier: invite needs
`team.invite`, delete needs `team.remove`, update needs `users`, list needs
`team.view`, and the refusal names the missing one. `sendReset` stays
owner-only because it is account recovery, not team work. An owner can now
delegate inviting and take it back, proved both ways.

The invitation carries the business role, so permissions are chosen once on
the role rather than per person. Cancel added, and the seat returns with it.
Pending invitations come back with the team list, because `team_invitations`
has RLS forced and no policies at all and nothing reaches it from a browser.

Studio switching: which studio a device is looking at is a device-local
preference that decides what is drawn and never what is allowed. Local data
is cleared before the new studio is pulled. `profiles.business_id` is now
only a tiebreak between real memberships.

**The Ìfé Leather existing-user test is done.** The same person is staff in
one studio and manager in the other at the same moment: two memberships, two
roles, one profile, and the database answers per studio rather than per
person. 24 of 24.

### Batch D, password recovery. Staging, 29 Sep
Every "Forgot password?" in the product handed the message to Supabase SMTP,
broken since 13 September, so for two and a half weeks the only route back
into a studio told people to check an inbox nothing was sent to.

`auth-recover` mints the link with generateLink and Resend delivers it.
Unauthenticated, so: known, unknown, malformed and empty addresses all
return the same object byte for byte, including when the function throws;
it only ever sends to the address in the request; and one send per address
per minute. Somebody invited who never chose a password gets an invite link
rather than a recovery one, because GoTrue refuses recovery for an address
that has never confirmed, and without that they would get a 200 and no email
for ever. 16 of 16, including a grep that stops the dead call coming back.

---

### Batch E, relational orders and sync reliability. Staging, 29 Sep

**Orders are rows.** `public.orders` has existed since August with
branch-scoped RLS and had never held a row; it now carries `app_id`, `doc`,
`assigned_to` and `rev`, with cost in `order_costs` and contact in
`public.customers`. The device still holds one array and all thirty three
readers are untouched; what changed is the shape on the server and therefore
what the server is willing to send.

Measured in a browser on staging: an owner signs in and gets two orders with
costs; a staff member signs in and gets the same two orders **with no cost
and no contact detail on the device at all**, and cannot read the
transactions key. `seeCost` and `seeContact` are refusals now.

**Migration** is repeatable, owner-only, and returns the count and the money
total on both sides so a caller can compare rather than hope. It deletes
nothing: the blob stays until rows have been read back. It caught its own
bug, because returning both sides is what made a silent zero visible.

**The audit trail cannot be rewritten.** `public.audit_log` has an INSERT
policy, a SELECT policy behind the `audit` permission, and no UPDATE or
DELETE policy at all, so history is closed to everyone including the owner.
The actor is stamped from `auth.uid()`.

**The outbox.** Every write is recorded in localStorage before it is sent,
one entry per key, exponential backoff to a minute, and an entry leaves the
queue only when the server accepted it or the person has been told. Reconnect
and the tab returning to the front both trigger an immediate pass. A refusal
is not retried for ever. A pill shows what is still going up and what did
not, with a panel and a retry.

**Conflict is detected, never guessed.** Proved on staging with two writers:
device A edits, device B edits the same order, device A saves on a stale rev,
the write matches nothing, both versions are kept and the person is asked.
Resolving to either one lands correctly with the new revision.

Branch scope is adversarial-tested on a four-outlet studio: 23 assertions,
including moving a row between branches, which needs USING and WITH CHECK
both.

Found by these tests rather than by luck: a studio created after the RBAC
migration had no roles at all; a key wired both as a row and as a blob; an
empty pull emptying a device of 28 orders; and a permission that was not
granted reading as *unanswered* rather than *denied*, so a staff member
holding `money` came back with `seeCost` true.

---

### Batch F, operations. Staging, 29 Sep

**It tells us when it breaks.** `window.onerror` and `unhandledrejection`
post to `public.error_reports`, along with the three Edge Functions when they
fail. Append-only, platform admins only, and `source` is stamped by the
database — a browser labelling itself `server` is overruled, measured. Phone
numbers, addresses and tokens are scrubbed out of the message before it
leaves the device, because a stack trace we can read is worth having and a
client’s number in our logs is not. Ten per load and one per message on the
device; two hundred an hour per studio in the database, because the client’s
throttle lives inside the page that is broken. Faults raised before anybody
signed in wait on the device and go up when a session arrives: a fault during
boot is the one that loses a studio a day.

**A studio can leave, and leaving is not deleting.** Closing keeps every row
for thirty days, signs everybody out, and can be undone by the person who did
it without asking us. Purging is ours, only after the thirty days, and writes
the name, plan, dates and row counts into `tlb_closed_studios` first —
`partner_referrals` and `tlb_customers` both point at `businesses` with ON
DELETE SET NULL, so a purge never fails, it just quietly cuts a commission we
owe from the studio it was earned on.

Enforcement is one mechanism, not thirty: closing sets the memberships to
`closed`, and since every policy in this database goes through an active
membership, nothing is reachable. Reopening restores what each person was, so
the suspended member comes back suspended rather than promoted.

**A person can leave.** Refused for the only owner of a running studio, with
both ways out in the message. And almost everybody is in that position, which
the suite found the first time it ran: signing up provisions a studio, so a
plain refusal would have meant nobody could ever delete an account. The caller
now says which they mean, and closing on the way out still gives each studio
its thirty days.

**The export is from the server, not the device.** A manager’s device never
held the costs and a workroom device never held a phone number, so the browser
backup was never the studio’s data. `export_studio` assembles it where all of
it is visible, and works for thirty days after closing — which is when people
think to ask. The browser backup was also missing four keys, the worst being
`layi_dash_orders_done`: it held the unfinished work and left out the finished
work, most of a studio’s history by year two.

**And the restore is drilled, not described.** `restore_harness.mjs` builds a
studio with orders, costs, contact details, money, a changed permission table
and an audit trail; exports it; **purges it for real**; restores it from the
file alone; and compares both sides row for row and naira for naira. 53
assertions, including the two a careless restore changes quietly: the history
would have named whoever ran the restore, and the suspended member would have
come back able to sign in. `RECOVERY.md` is the runbook for the cases a
per-studio restore does not cover.

**Sixteen objects existed on staging and in no migration.** Found by counting
both sides rather than by testing behaviour: a database built from the
migrations alone had 753 objects and the real project had 769. The sixteen
included `audit_log.source`, `app.audit` and the five audit triggers — the
whole audit-authenticity claim from Batch E — so `sensitive_data_probe` was
proving something true about staging and nothing at all about a fresh project.
Copied into a migration from the live definitions rather than retyped. The two
sides now agree on one md5 over 771 objects, and
`schema_inventory.mjs` makes that check one command each way.

Found by these tests rather than by luck: a purge was impossible, because the
AFTER DELETE audit triggers tried to record "Member removed" against a
business row that had already gone; the hourly ceiling on fault reports did
not exist, because a SECURITY INVOKER trigger counts with the invoker’s SELECT
and a tenant has none; and `outboxResult` computed `revoked` and then returned
`revoked:false`, so somebody removed from a studio mid-session was told
"something did not send" instead of "sign in again".

---

## IN PROGRESS

### Batch G, Flutterwave
Architecture confirmed against current documentation before anything was
written. **The current API is v3; there is no v4.** Checkout is the Standard
API; payment plans are created server side and a checkout references the plan
to start a subscription; Flutterwave sends `verif-hash` on every webhook and
the value is the Secret Hash set in the dashboard. Their own guidance is to
re-query the transaction before giving value rather than trusting the
webhook body, which is what the implementation will do, with a processed-
events table for idempotency.

No encryption key is needed: that is for direct card charges, and this uses
the hosted checkout.
## BLOCKED

| item | blocked on | dependency |
|---|---|---|
| Pilot start date | **Kayode**: full scope first, or owner-only pilot first | the table above |
| G, Flutterwave credentials | **Kayode**, when the code is ready: three secrets on the STAGING project only, named in the report. Test mode first; production after the whole staging billing flow passes | the code is being written now and does not need them yet |

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
