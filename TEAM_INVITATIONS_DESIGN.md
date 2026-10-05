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

| # | Step | Who | Size |
|---|---|---|---|
| 1 | `RESEND_API_KEY` on the production project | Kayode | one command |
| 2 | Point Supabase Auth's own SMTP at Resend, so confirmations work too | Kayode | dashboard |
| 3 | Real password reset to a live mailbox, end to end | me, once 1 is done | minutes |
| 4 | Rewrite the four harness assertions around the switch | me | S |
| 5 | One real invitation to a real mailbox **on staging**, all the way to the studio | me | S |
| 6 | Flip both switches, release, and run it once on production | me, on your word | S |

**No new tables, no new functions, no new screens, and no migration.** This
is the rarest kind of item on the launch checklist: the work was done, it was
done well, and what is in the way is a missing environment variable and a
comment nobody went back to check.

---

## 5. The one design question left for you

**What should happen to somebody who is removed from a studio?**

`delete` exists on the gateway and removes the membership. What it does not
decide is the account. Three options:

- **Membership only.** Their account survives, they can be re-invited, and
  they can still sign in — to nothing. Simplest, and reversible.
- **Membership and account**, when the studio is the only one they belong
  to. Cleanest, and irreversible.
- **Membership, and the account is suspended** until re-invited.

I would take the first: this app already has a close-and-reopen lifecycle
for a whole studio, and a person who leaves a label and comes back six months
later is a normal thing in this trade. But it decides what "remove" means on
a screen an owner will use in anger, so it is yours.
