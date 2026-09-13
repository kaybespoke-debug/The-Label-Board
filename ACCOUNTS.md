# Accounts

How a studio, a referral partner and one of our own staff each get an account,
and why none of it should involve the Supabase dashboard.

Agreed with Kayode, 13 September 2026. **Not built yet.** Two blockers below
have to clear first.

---

## The shape

One pool of Supabase Auth accounts. What somebody *is* depends on which table
their user id appears in:

| Their row lives in | That makes them | They sign in at |
|---|---|---|
| `memberships` | staff of a studio | app.thelabelboard.com |
| `partners` | a referral partner | partners.thelabelboard.com |
| `platform_admins` | one of us | admin.thelabelboard.com |

Sharing one pool does not share data: a studio cannot read another studio's
orders because row level security checks `memberships` on every query. Separate
Supabase projects would add bills and no isolation we do not already have.

**Two ways in, and only two:**

| | Created in the console | Asked for on the website |
|---|---|---|
| Our team | Staff & Roles | — |
| Partners | Partners tab | "Become a partner" → enquiry → approve |
| Studios | Onboarding | "Request a demo" → enquiry → approve |

---

## What already works, and must not be rebuilt

**Provisioning is automatic.** `app.provision_studio()` runs on a trigger on
`auth.users` the moment any account is created, and decides in this order:

1. Is this address waiting on a **partner** row? Attach it and stop. A partner
   gets a partner account and **no studio**, because handing a referral partner
   a whole second product they never asked for is worse than useless.
2. Is it waiting on an **existing business**? Make them its owner. This is how a
   second person joins a studio that already exists.
3. Otherwise create a **new studio**: the business on a trial, a branch called
   Main studio, a profile, and an owner membership.

**The website already writes to the database safely.** `submit_enquiry` is an
INSERT-only function: it cannot read, list or return an enquiry. It throttles at
twenty in five minutes by address or kind, and caps every field's length. Kinds
are already `demo`, `contact`, `partner`, `referral`; states are already `new`,
`open`, `replied`, `converted`, `spam`, `closed`.

**So there is no new public endpoint in this work, and no new spam surface.** The
public can only ever add a line to a list we read. Everything that creates an
account happens inside the console, behind a login.

**What is missing is only the front door.** No app anywhere calls sign-up. Today
every account that exists was made by hand in the Supabase dashboard, with a
password Kayode invented and then sent to them.

---

## What gets built

### 1. One new action in `admin-api`

The only genuinely new machinery, and the reason this needs an Edge Function
deploy. Creating an account requires the service role key, which bypasses every
rule in the database and can never reach a browser. So the browser sends an
instruction and the function does the work:

1. Check the caller's role allows it.
2. Create the Auth account, or send an invite link.
3. Write the row that says what they are.
4. Write a `platform_audit` entry. Creating an account is exactly the kind of
   thing that must be logged, and the audit table already exists.

### 2. Staff &amp; Roles — an Access column

Not a new screen. Staff &amp; Roles already lists who works here and what they
do; it simply cannot let any of them in. Four states: **no access**, **invited**,
**can sign in**, **access removed**.

Removing access sets the `platform_admins` row inactive. Their staff record,
history and payroll stay. Leaving is not the same as never having been here.

### 3. Onboarding — "Invite a studio"

The pipeline already tracks studios through new / setup / ready / trial ending.
It has no way to *start* one. The invite is its missing first step.

### 4. Enquiries — "Approve and create account"

One button. Creates the record, marks the enquiry `converted`, sends the login.
A `partner` enquiry creates a partner; a `demo` enquiry creates a business.

**Rejection needs no new machinery.** Mark it `closed` or `spam`, which the
screen already does. No record, no login, and it stays in the list so nobody
approves it by accident next month.

### 5. A Partners tab

The one genuinely new screen. There is no home for partners in the console at
all today.

---

## Decisions taken

**Who can do what.** Studios and partners: any manager. **Operators: owner
only.** Creating another operator hands somebody the ability to see every
subscriber's books and every payment; that is not a support agent's call.

**Records exist before logins do.** At request time the *record* is created —
the partner row or the business row, carrying the address that will claim it.
The Auth login is created at **approval**. A login that exists can be attempted,
shows up in the user list, and has to be cleaned up if we say no. The schema was
already built for this: `partners.pending_email` and
`businesses.pending_owner_email` are waiting for exactly this use.

**Studios get a temporary password, operators get an invite link.** An invite
email that lands in spam is a studio that never onboards, and this market is
more reachable on WhatsApp than on email. So studios get a temporary password to
pass on, and must change it on first sign-in.

Operators do not, because **forcing a password change is enforced by our code,
not by Supabase** — somebody using the API directly could skip it. That is an
acceptable risk for a studio owner and not for an account that can read every
subscriber's finances. Nobody should ever know an operator's password, including
Kayode.

---

## Open, and needed before building

- [ ] **Is the `on_auth_user_created` trigger attached on the live project?**
      Everything here ends with "the trigger attaches them to their record". If
      it is not attached, every invite produces an account with nothing on it —
      which is what happened to Kayode's own account. This decides whether this
      work is a build or a repair.

      ```sql
      select tgname from pg_trigger
       where tgrelid = 'auth.users'::regclass and not tgisinternal;
      ```

- [ ] **Has one real email ever arrived?** SMTP is configured; nothing has been
      seen to deliver. The whole feature is "send someone an invite". Prove one
      lands before building on the assumption.

- [ ] **Two role lists, or one?** The console has Finance Manager, Support
      Manager, Head of Product. The gateway has `owner`, `finance`, `support`,
      `developer`. They are mapped roughly onto each other in code, which is
      fine with one operator and confusing the first time a title and an access
      level disagree. Blocks the Access column specifically.

- [ ] **Do temporary passwords expire?** Recommended 72 hours, then Forgot
      password. Otherwise a password Kayode generated and sent over WhatsApp
      stays valid forever if they never change it.

---

## Risks accepted knowingly

**Redeploying `admin-api` can lock us out of the console.** Every console action
goes through it. A bad deploy means no live sign-in and no way to fix it from
the console — back to the SQL editor. Deploy at a desk, not on a Friday night.

**Approving a demo enquiry creates a business on a trial**, and any manager can
do it. That is a commercial action performed by a support agent. Deliberate, not
inherited.

---

## Adjacent, and not part of this

**The customer app has two kinds of user.** If what you type contains an `@` it
signs in against Supabase; otherwise it falls back to a username and password
held on that device. So a studio adding staff today creates somebody who exists
**only on that phone** — they cannot sign in anywhere else and nothing syncs for
them. Fine for a one-device workroom, wrong for a studio with four outlets.

That is a separate decision, and a bigger one than these screens. It interacts
with this work — when a studio invites its own staff, which kind do they get? —
so it should be settled soon, but not inside this piece.
