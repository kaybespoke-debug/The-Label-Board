# The Label Board — backend setup

Everything on this list is yours to do in the Supabase dashboard. The app side is
already finished and waiting. Budget about 30 minutes.

**Before you start, one thing to know:** the app used to point at a Supabase
project (`knrqlocxtrmpvwaplffq`) that no longer exists and is unreachable. That is
why nothing was syncing. The config is now blank on purpose, so the app runs
safely on-device until you fill it in at step 4.

Your account currently has exactly one project, `Layi-website`. That is the
**website** backend. Do not reuse it. You decided early on to keep the studio app
on its own project, and that decision still holds: different data, different
users, different blast radius.

---

## 1. Create the project

Supabase dashboard → **New project**.

| Field | Use |
|---|---|
| Name | `label-board` |
| Region | **eu-west-2 (London)** — same as Layi-website, and closest to Lagos of the EU regions |
| Password | Generate a strong one and save it in your password manager. You will rarely need it, and it is painful to rotate. |

Wait for it to finish provisioning before step 2.

---

## 2. Create the tables

Dashboard → **SQL Editor** → **New query**.

Open `supabase_setup.sql` from this folder, paste the whole file, press **Run**.

It is idempotent, so running it twice is harmless. It creates:

- `profiles` — one row per login, tying a user to a business and a role
- `customers` and `suppliers` — relational, because the app queries their columns
- `app_state` — one row per business per data key, holding everything else
  (orders, transactions, staff, roles, products, supplies, bills, pots, tasks,
  attendance, leave, campaigns, the company log and the audit trail)

It also switches on row-level security keyed on `business_id`, so one studio can
never read another's data, and enables realtime on all three data tables.

**Check it worked:** Table Editor should now list four tables, each showing
"RLS enabled".

---

## 3. Create your own login

**3a.** Authentication → **Users** → **Add user**.
Use a real email and a real password, and tick **Auto Confirm User**. Without
that tick you cannot sign in.

**3b.** Copy the new user's UUID, then SQL Editor → New query:

```sql
insert into public.profiles (id, name, role_id, business_id)
values (
  'PASTE-THE-AUTH-USER-UUID',
  'Kay Ojomo',
  'owner',
  '11111111-1111-1111-1111-111111111111'
);
```

That `business_id` is arbitrary but must be **identical for everyone in your
studio**. Keep this one, it matches the app's built-in default.

---

## 4. Point the app at the project

Project Settings → **API**. Copy the **Project URL** and the **anon / publishable**
key.

Open `layi_dashboard.html` and fill in the two blank strings near line 1513:

```js
const SUPA_URL='https://YOUR-PROJECT.supabase.co';
const SUPA_KEY='eyJhbGciOi...';
```

The anon key is designed to be public and is safe in the file. The **service role**
key is not, and must never appear here.

---

## 5. Auth URLs

Authentication → **URL Configuration**:

- **Site URL:** `https://thelabelboard.netlify.app`
- **Redirect URLs:** add `https://thelabelboard.netlify.app/**`

Skip this and password reset emails will bounce users to the wrong place.

---

## 6. Deploy the team-admin function

This is what lets you create team logins from inside the app. The service-role key
lives only here on the server, never in the browser.

```bash
supabase functions deploy team-admin --project-ref YOUR-PROJECT-REF
```

The source is at `supabase/functions/team-admin/index.ts`. `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically, so
there is nothing to configure.

If you have not used the CLI before: `npm i -g supabase`, then `supabase login`.

---

## 7. Ship and test

Drag the `site/` folder to Netlify, then:

1. Open the site and sign in with the **email address** from step 3, not a username.
   The `@` is what tells the app to use the cloud rather than the local demo login.
2. Watch for "Loading your studio…" — that is the cloud hydrate running.
3. Add a test order, then open the project's Table Editor and confirm a row
   appeared in `app_state` under key `layi_dash_orders`.
4. Sign in on a second device. The same data should appear. **That is the moment
   the phone and the laptop stop being separate sets of books.**

---

## What switches on by itself once this is done

You do not need to flip a flag. `liveMode` turns on the moment an email login
succeeds and a matching profile row is found. From there:

- Cloud sync starts, and the ↻ Sync button pulls the latest
- Realtime kicks in, so another device's changes chime and appear
- The storage note stops saying "this device only"
- Web Push and auto-WhatsApp become deployable, since both were waiting on a
  backend

---

## Rolling back

Blank `SUPA_URL` and `SUPA_KEY` again and redeploy. The app returns to
device-only, and your local data is untouched. Nothing about this is one-way.

---

## Still needs a decision, not today

- **Payments.** Model A first, each studio bringing its own Paystack, Flutterwave
  or Monnify account. Provider still unchosen. Tenant payment secrets live only in
  an Edge Function, never in the client.
- **Auto WhatsApp.** The client side is built and dormant. It needs a provider
  (Meta Cloud API is cheapest), Meta-approved templates, and a `send-whatsapp`
  function. See `WHATSAPP.md`.
- **Per-tenant image storage.** `saveImageAsset()` is the single seam that routes
  to Supabase Storage when you are ready. See `STORAGE.md`.
