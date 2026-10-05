# Team invitations — the design, and how much of it already exists

Asked for before building. Written 5 October 2026, read from the shipped
code and the live production database.

**The short answer: it is built. Nearly all of it, and carefully.** The
reason it is switched off is written in the app, and that reason stopped
being true on 25 September. What is actually missing is one thing, and it is
not invitations — it is email that leaves the building.

---

## 1. What the switch says, and why it is wrong

Two switches hold it closed, deliberately and in two places:

| Where | What it says |
|---|---|
| `site/layi_dashboard.html` | `const TEAM_INVITES_ENABLED=false;` — the owner gets a modal reading "Temporarily unavailable" |
| `supabase/functions/team-admin/index.ts` | on by hostname: true only on the staging project ref, so production is off by default rather than by an edit somebody remembered |

The app records the reason:

> *inviting somebody currently makes them the owner of a brand new studio
> named after them, because the provisioning trigger has no way to attach an
> account to a business that already exists.*

**That is no longer the case.** Read today from production,
`app.provision_studio()` — the `on_auth_user_created` trigger — opens with a
block that recognises an invited teammate and **returns before creating
anything**:

```
v_inv_id := new.raw_user_meta_data ->> 'team_invitation_id';
v_nonce  := new.raw_user_meta_data ->> 'team_invitation_nonce';
...
      return new;          -- no business, no profile, no membership
```

It verifies a **one-time server nonce** against `team_invitations.nonce_hash`
(sha256), requires the invitation to be pending, unexpired and for that exact
address, and then **clears the hash** so the same pair can never identify a
second insert. The metadata carries provenance only — which INSERT this is —
and never the business, role or branch, which are read from the invitation
row later, at acceptance, as the invitee.

Its own comment says it was verified against real GoTrue on staging on 25
September, including the detail that the obvious alternative, `new.invited_at`,
is still NULL at that point because GoTrue stamps it a fraction of a
millisecond later.

So the app's stated reason is a fortnight stale, and the switch is now held
closed by a comment rather than by a defect. **That is the single most
important thing in this document**, and it is the second time this week a
stale note has been the thing standing in the way.

---

## 2. What exists, end to end

Walking the path a real teammate takes, naming what is already there.

### The owner invites somebody

`team-admin` serves `invite`, and it does the following in order:

1. **Checks the role is this studio's**, and refuses a non-owner inviting an
   owner.
2. **Refuses a Label Board operator's address**, read from
   `platform_admins` — support staff holding a studio membership is how a
   support account ends up inside a tenant's data.
3. **Checks the branch belongs to this studio.**
4. **Creates the invitation first**, in one transaction
   (`create_team_invitation`), which takes the seat lock, refuses somebody
   already on the team, and refuses an invite that would break the plan. The
   nonce comes back exactly once and is never stored on the function's side.
5. **Creates the account second**, carrying the nonce, so the trigger
   recognises its own invitation and writes nothing.
6. **Clears the nonce pair from the invitee's metadata immediately**, merging
   rather than replacing, because the name has to survive — `accept_invitation`
   reads it to write their profile.
7. **Sends the email**, and if that fails **discards the invitation and
   deletes the account it just made**, because an invitation nobody was told
   about is worse than none: it holds a seat, expires silently, and the owner
   believes it was sent.
8. Returns the invitation id, the kind, the expiry, and the link's **host**
   rather than the link — enough to catch a staging build emailing a
   production link.

An address that already has an account is **not** an error: it is the other
half of the feature. They sign in as themselves and the invitation is
waiting.

### The teammate accepts

The email links to `app.thelabelboard.com/?invitation=<id>`. The app reads
that parameter before the Supabase client is created (creating it clears the
URL), and calls `accept_invitation`, which:

- requires a signed-in account with a **confirmed** email
- requires the invitation to be **for that signed-in address**, pending and
  unexpired — and gives the same message, *"That invitation is no longer
  valid"*, for all three, so nothing is disclosed
- takes the seat lock, marks it accepted, and **raises if it was already
  used**, so a link is single-use
- **enforces the plan seat limit** and names the number in use
- writes the `profiles` row and the `memberships` row with the invitation's
  role, `role_id` and branch

### The rest of the team screen

`team-admin` also serves `list`, `update`, `resendInvitation`,
`cancelInvitation`, `sendReset` and `delete`, all owner-gated, and all
working today — only `invite` and `resendInvitation` are behind the switch.
Editing an existing teammate is untouched.

`resendInvitation` is the same invitation with a fresh link, never a new
invitation and never a new account, and it tries `invite` then `recovery`
then `magiclink` because GoTrue refuses `invite` for an address it already
holds, reporting which one worked rather than assuming.

### The table

`public.team_invitations` holds 16 columns: business, email, role, `role_id`,
branch, who invited, status, created, **a 14-day expiry**, accepted at/by,
`nonce_hash`, `nonce_issued_at`, and a cancelled reason and time. RLS is on
with **no policy**, which denies everything — so nothing reaches it except
through the owner-gated gateway, which is right.

### Seats, by plan

| Plan | Studios | Seats |
|---|---|---|
| Basic (`starter`) | 1 | 5 |
| Pro | 5 | 50 |
| Trial | 5 | 50 |
| Bespoke (`premium`) | unlimited | unlimited |

Enforced in the database at both ends — when the invitation is created and
again when it is accepted — so a studio cannot get a sixth person onto Basic
by having five invitations outstanding.

---

## 3. What is actually missing

Three things. Only the first is work.

### a. Email that delivers. This is the whole blocker.

`team-admin` sends through Resend and **returns a 502 and rolls everything
back when it cannot**, which is the right behaviour and means a production
invitation today would fail loudly rather than silently. But
`RESEND_API_KEY` is **not set on the production project** — it was set on
staging on 28 September and never on production, which holds only the seven
secrets Supabase provides. So every invitation on production would roll back
at step 7.

This is the same root cause as the password reset, and it is why the two
belong together: **until production can send email, invitations cannot work
no matter what the switch says.**

Worth knowing: `admin-api` (the operator console's invitations, a different
path) falls back to `inviteUserByEmail` when there is no Resend key — which
uses **Supabase's own mailer**, the one that has sent zero emails. So that
path fails quietly where `team-admin` fails loudly.

### b. Flip the two switches, after one real run

Not before. The function's own comment says it: *"Phase 1C flips this to a
plain `true` once the flow has been run end to end against a real mailbox and
a real person."* The run has to be: invite a real address, receive the email,
click it, choose a password, land in the studio, hold the right role, see the
right branch, and be visible on the owner's team screen.

### c. Update the harness, which currently asserts the switch is OFF

`team_admin_harness` is **45 passed, 4 failed** today, and all four failures
are the harness looking for the switch in its old shape:

```
FAIL  the switch exists and is off — Phase 1B turns it on
FAIL  it returns before it validates anything — guard -1, first validation 1266
FAIL  it returns before it reaches auth
FAIL  it answers 503, not 400 or 500
```

These are stale assertions, not defects — the switch moved from a literal
`false` to a hostname test and the harness still looks for the literal. They
have to be **rewritten rather than deleted**: what they were protecting (the
guard runs before any validation, and answers 503 rather than blaming the
caller) is worth keeping for the staging-vs-production test, and once the
switch is on, the thing to assert is the opposite — that an invitation
creates no business, no second membership, and refuses over the seat limit.

---

## 4. So the plan, in order

| # | Step | Who | State on 5 October, 17:30 |
|---|---|---|---|
| 1 | `RESEND_API_KEY` on the production project | Kayode | **not landed.** Four independent checks at 17:02 say production still holds only Supabase's seven default secrets, and the live function still answers `503 mail_not_configured` |
| 2 | Point Supabase Auth's own SMTP at Resend | Kayode | **cannot be read from here**, but leaked-password protection — same dashboard — is still reported off on **both** projects, so it looks as though none of the three landed where they were aimed |
| 3 | Real password reset to a live mailbox | me | **blocked on 1** |
| 4 | Rewrite the four harness assertions around the switch | me | **done.** `team_admin_harness` 45/49 → **78 passed, 0 failed** |
| 5 | Everything else the code can decide | me | **done.** Switches flipped, `delete` rewritten, migration written, `release.js` 37/37 offline |
| 6 | Apply the migration, deploy `team-admin`, push the app, invite a real address | me, on your word | **held** |

**Nothing is pushed and nothing is deployed, deliberately.** The three parts
are coupled and have to go in one order — the migration, then `team-admin`,
then the app:

- pushing the app alone would put an invite form in front of an owner while
  the deployed gateway still answers 503;
- deploying the gateway before the migration would leave `delete` unable to
  revoke a session, so somebody removed would keep a live session;
- and all of it is pointless until the Resend key is on production, because
  every invitation would roll itself back at the email step.

**Correction to this document's first version**, which said *"no new tables,
no new functions, no new screens, and no migration"*. The invitation half of
that is still true — nothing was built for invitations. But the removal
decision needed one new function and therefore one migration, which is
written and applied nowhere.

---

## 5. Remove from studio — decided, and built

**Kayode's decision, 5 October: remove the membership only. The account
survives, they are signed out of every device and lose access immediately,
and their past work stays attributed to them.**

### What the code did instead

`delete` removed the membership, and then, if that studio was the only one
they belonged to, **deleted their profile and called
`auth.admin.deleteUser`**. Removing a tailor from the only studio they had
ever worked in destroyed their account. No undo, and re-inviting them later
would have meant a new account and a new password. For a trade where people
leave a label and come back, that was the wrong default.

### The three parts, and only one needed building

| Part | How |
|---|---|
| **The membership** | An ordinary delete. Every policy in this schema reads `memberships` through `app.can()` and `app.in_scope()`, so the moment the row is gone every read and every write is refused. Access dies here, whatever their token still says |
| **Their past work** | Already safe, and not by luck. **Nothing in this database has a foreign key to `profiles` or `memberships`** — checked on production, eleven foreign keys point at `auth.users` and none at either. Work is attributed to `staff.id`, which belongs to the **studio** rather than to the account: `attendance.staff_id`, `orders.assigned_to`, `tlb_commissions.staff_id` |
| **The session** | The part that needed building, in `20261005130000_removing_somebody_takes_their_access_not_their_account.sql` |

**Why the session needed a migration.** Sessions live in `auth.sessions`,
PostgREST only exposes the schemas in its search path, so an Edge Function
holding the service role key cannot reach the `auth` schema over HTTP at all.
And there is no GoTrue endpoint that logs a user out by id — the client's
`admin.signOut()` wants that user's own JWT, which we do not have and should
not have. So `public.revoke_all_sessions(uuid)` exists, forwards to an `app.`
function, and is **granted to `service_role` and revoked from `public`, `anon`
and `authenticated` by name** — because Supabase grants EXECUTE on new
functions in `public` to the anon key by default, and `revoke from public`
does not undo a grant made to a role. A function that signs anybody out of
everything is not one to leave reachable with the publishable key.

**What happens without it, which is worth writing down:** not nothing. They
lose the data immediately because RLS reads memberships. What survives is the
session — they stay signed in to an account that can see nothing, and the app,
which enters from a stored session on its own, would show them a
studio-shaped shell RLS refuses to fill. Revoking the session is what turns
that into a sign-in screen.

**The profile goes, the account stays, and those are different things.** A
profile is per-studio by construction — `business_id` and `role_id` are both
NOT NULL, so there is no such thing as a profile belonging to nobody's studio.
Leaving it pointing at a studio they are no longer in is the worst of the
three options, because that is what the app opens.
`accept_invitation` writes it back `on conflict`, so being re-invited restores
them rather than creating a second person with the same name.

**`staff.user_id` is deliberately left alone.** Pointing at a surviving
account with no membership grants nothing — RLS reads memberships — and it is
what makes re-inviting them continuous.

**`auth.admin.deleteUser` has been removed from the gateway entirely.** A
helper that deletes accounts, sitting in the one file that holds the service
role key, is a thing waiting to be called by the next action somebody adds.
The only `deleteUser` left is the compensation for an invitation whose email
could not be sent, which removes an account the function created seconds
earlier and nobody has ever signed into. Deleting your **own** account is a
different path: `public.delete_my_account`, run as yourself.

Twelve assertions in `team_admin_harness` cover it, including the two grant
checks and that they can no longer read the studio's orders.

---

## 6. Where each team action lives

Asked for directly. The answer is cleaner than expected: **there is no
overlap at all.**

`admin-api`, the operator console's gateway, **never touches `memberships`,
`team_invitations` or `business_roles`.** Not in any of its twenty-five
actions. Checked by grep across the whole function.

### The studio app, owner-facing — `team-admin`

Everything about who is inside a studio. Owner-gated, and scoped to that
owner's own business by `verifyTarget`, which reads the row back rather than
trusting a scoped write.

| Action | What it does |
|---|---|
| `invite` | A teammate, by email, with a role and a branch |
| `resendInvitation` | The same invitation, a fresh link. Never a second invitation and never a second account |
| `cancelInvitation` | Frees the seat it was holding |
| `update` | Their role, their branch, the staff record they are linked to |
| `delete` | Remove from studio, as decided above |
| `sendReset` | A password link, to them, by email. The owner never sees it |
| `list` | The team and the outstanding invitations |

### The console, operator-facing — `admin-api`

Everything about the studio as a **customer**, and nothing about its people.

| Group | Actions |
|---|---|
| Creating accounts at the top | `inviteStudio` (a new studio's owner), `invitePartner`, `inviteOperator` |
| The commercial relationship | `setPlan`, `setStudioLimits`, `setStorageCap`, `setStatus`, `setPayoutFrozen`, `setNote` |
| Money | `billing`, `payments`, `recordPayment`, `partnerCommission`, `referralRisk` |
| Talking to them | `enquiries`, `setEnquiryState`, `feedback`, `feedbackThread`, `replyFeedback`, `setFeedbackState` |
| Looking | `tenants`, `tenant`, `audit`, `me` |

`inviteStudio` is the one that looks like an overlap and is not: it creates
the **owner of a new studio**, which is the start of a customer relationship.
It cannot add a second person to a studio that already exists.

### Should the console be able to remove a member from a studio?

**No, and I would keep it that way.** It can technically do anything — it
holds the service role key — so the restraint is a decision, not a
limitation, and it is worth keeping as one.

- A studio's team is **its own data**, like its customers and its orders. The
  console deliberately reads tenant records through narrow, named actions and
  writes almost nothing. Member management is the thickest possible wedge into
  that.
- The console already has the blunt instrument it needs: `setStatus` suspends
  a whole studio. Reaching inside one to remove a person is a different and
  much more dangerous power.
- The moment support **can** remove a member, support can be **talked into**
  removing a member. "The owner asked me to" is not something an operator can
  verify from a chat message, and the person removed loses access to their
  work immediately.

**The one case that genuinely needs an answer is not this one.** It is: the
owner's account is unreachable — lost mailbox, left the business, died — and
somebody must become owner of a studio that still has staff and customers in
it. That is **transfer ownership**, not remove a member. It deserves to be
its own named, logged, deliberately awkward action with a written reason, and
it should land in `platform_audit`. It is not on the launch checklist and I
would not build it until a real studio needs it, because the design depends
on what proof of entitlement we are willing to accept — which is a business
question, not an engineering one.
