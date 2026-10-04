# Rebuild

What to do when the **project** is gone, not just the data in it.

`RECOVERY.md` is the other half and the one far more likely to be needed: a
studio deleted something, a device went wrong, a studio closed and changed
its mind. Everything there assumes a working Supabase project and a working
set of Netlify sites. This file assumes neither.

**Nothing in this file is a secret.** It lists the NAMES of the secrets and
where each must be put back. The values live in the dashboards and in
Kayode's password manager, and they are not in git, which is the point. If
you are reading this because the project is gone, you will need them from
there.

---

## The shape of the problem

Four things have to come back, and only two of them come back by themselves.

| | comes back from | automatic? |
|---|---|---|
| Schema — every table, policy, function, trigger | `supabase/migrations/` in git | **yes**, one command |
| Studio data — orders, money, clients, history | the nightly export, or a platform backup | **yes**, proven nightly |
| Accounts — who can sign in | a platform backup only | **no**, see below |
| Everything in this file | typing it in | **no** |

The measured part takes seconds. The typing is the recovery time.

---

## 0. First, decide which disaster this is

**The project still exists and something in it is wrong** → stop reading
this, use `RECOVERY.md`.

**The project is gone, paused, or being left behind** → carry on. And before
anything else:

> Supabase deletes a project's backups when the project is deleted. If the
> project still exists in any form, take a backup out of it before you touch
> anything else, because restoring from the dashboard is only possible while
> there is a dashboard.

---

## 1. Supabase

### 1.1 The project

- Organisation: **The Label Board** (`etfixjfombalqizryzla`), plan **Pro**
- Production project ref: `eskubrbgbcbaejynjxvh`, region **eu-west-2**,
  Postgres **17**
- Staging project ref: `pakxhimjhrcpqvtsqwqz`

A new project gets a new ref, and the ref is in the URL every app talks to.
Section 2.4 is where that is changed.

### 1.2 The schema

```bash
node supabase/tests/schema_inventory.mjs --fingerprint   # what it should be
# apply supabase/migrations/ in filename order, then:
node supabase/tests/schema_inventory.mjs --sql           # run this on the project
```

The two md5s must match. They are the only proof that the new project is the
old one. `recovery_drill.mjs` does exactly this against an empty database on
every release.

### 1.3 Auth settings

None of this is in the database.

- **Providers**: email only. No social, no phone, no SSO.
- **Confirm email**: on.
- **Site URL** and **Redirect URLs** — must list all three apps or sign-in
  links land nowhere:
  - `https://app.thelabelboard.com`
  - `https://admin.thelabelboard.com`
  - `https://partners.thelabelboard.com`
- **SMTP**: custom SMTP via Resend (section 3). Without it, Supabase's shared
  sender is rate-limited to a handful of messages an hour and invitations
  silently stop arriving.
- **Leaked-password protection**: Authentication → Policies. Currently **off**
  on production.

### 1.4 Storage

One bucket, and its settings matter as much as its contents:

- name `studio-media`, **private** (never public)
- file size limit **10 MB**
- allowed MIME types: `image/webp`, `image/jpeg`, `image/png`, `image/gif`,
  `image/heic`, `image/heif` — and nothing else. A restore that recreates the
  bucket without this list will accept anything.
- the policies come from the migrations, not from the dashboard.

**Objects are not in any database backup.** Supabase's documentation is
explicit that a database backup holds only the metadata. The bytes need their
own copy, and `tools/storage_recovery_probe.js` is the tested procedure:
download each object with its full path, keep a manifest of path + sha256 +
size, and upload each back to the path it came from.

The tenant association **is the path**: `studio-media/<business_id>/...`,
resolved by `app.media_business_of()`, which is just the first segment parsed
as a uuid. So preserving paths preserves ownership, and there is no separate
mapping to back up. An object restored under a studio id nobody belongs to is
refused to everyone, which the probe proves.

### 1.5 Edge Function secrets

Set in **Project Settings → Edge Functions → Secrets**. In nobody's git and
nobody's backup. Names only:

| name | used by | note |
|---|---|---|
| `SUPABASE_URL` | all | provided by the platform |
| `SUPABASE_ANON_KEY` | all | provided by the platform |
| `SUPABASE_SERVICE_ROLE_KEY` | `admin-api`, `team-admin` | provided by the platform; never leaves it |
| `RESEND_API_KEY` | `team-admin`, `auth-recover` | from Resend, section 3 |
| `INVITE_FROM` | `team-admin`, `auth-recover` | the From address, must be on the verified domain |
| `STUDIO_APP_URL` | `team-admin`, `auth-recover` | `https://app.thelabelboard.com` |
| `CONSOLE_APP_URL` | `admin-api` | `https://admin.thelabelboard.com` |
| `PARTNER_APP_URL` | `team-admin` | `https://partners.thelabelboard.com` |
| `FLW_SECRET_KEY` | `billing`, `billing-webhook` | **not set** — externally blocked |
| `FLW_SECRET_HASH` | `billing-webhook` | **not set** — externally blocked |

### 1.6 Edge Function source

In git at `supabase/functions/`. Five exist; **three are deployed**:

| function | deployed | `verify_jwt` |
|---|---|---|
| `admin-api` | yes | true |
| `team-admin` | yes | true |
| `auth-recover` | yes | **false** — it is called before anybody is signed in |
| `billing` | no | Flutterwave, externally blocked |
| `billing-webhook` | no | Flutterwave, externally blocked |

```bash
npx supabase functions deploy admin-api    --project-ref <ref>
npx supabase functions deploy team-admin   --project-ref <ref>
npx supabase functions deploy auth-recover --project-ref <ref> --no-verify-jwt
```

`auth-recover` deployed **with** JWT verification is the subtle failure: it
returns 401 to everybody, password recovery stops, and nothing else breaks,
so it looks like an email problem for a day.

### 1.7 pg_cron

The nightly studio export is a cron job, not a trigger, and a restored
project will not have it unless the migration ran there:

```sql
select jobname, schedule, active from cron.job;
-- expect: nightly-studio-backups | 40 2 * * * | t
```

If that is empty, re-apply `20261004101000_schedule_the_nightly_backup.sql`.
It skips itself where `pg_cron` is unavailable, which is right for a test
database and silent in a project — so check it rather than assume it.

---

## 2. Netlify

Four sites, one repository, two branches.

| site serves | folder | branch | hostname |
|---|---|---|---|
| customer app | `site/` | `main` | `app.thelabelboard.com` |
| marketing site | `web/` | `main` | `thelabelboard.com` |
| operator console | `admin/` | `admin-deploy` | `admin.thelabelboard.com` |
| partner portal | `partners/` | ? | `partners.thelabelboard.com` |

- Repository: `github.com/kaybespoke-debug/The-Label-Board`
- **The publish directory is set by the root `netlify.toml`, which is
  deliberately different on the two branches** — `publish = "site"` on `main`,
  `publish = "admin"` on `admin-deploy`. Rebuilding a site and letting it pick
  up the wrong branch serves the operator console to every studio. Both copies
  of the file carry the warning.
- The partner portal's publish directory could not be determined from the
  repository: a `netlify.toml` sets one directory and `admin-deploy` sets
  `admin`, so the portal's site must have its own directory configured in the
  dashboard. **Check it there before relying on either answer.**
- **Environment variables: none.** Every app reads its Supabase URL and anon
  key from a literal in its own source, keyed by hostname. There is nothing to
  restore here, and that is deliberate — see 2.4.

### 2.4 If the Supabase ref changed

A new project means a new ref, and the ref is compiled into every app:

- `site/layi_dashboard.html` — the `SUPA_ENVS` map, keyed by hostname
- `admin/js/config.js`, `partners/js/config.js`, `web/js/config.js`

Change all four, bump `APP_VERSION` in `site/layi_dashboard.html` **and**
`CACHE` in `site/sw.js` to the same value, and push. Without the cache bump,
installed phones keep talking to a project that no longer exists.

---

## 3. Resend

- Sending domain: `thelabelboard.com`, verified by DNS records (section 5) —
  SPF, DKIM and the return-path CNAME. A rebuilt DNS zone that omits them
  leaves mail that sends successfully and arrives in spam.
- Secret name: `RESEND_API_KEY`, set in Supabase Edge Function secrets and in
  Supabase Auth's custom SMTP settings.
- `INVITE_FROM` must be an address on the verified domain.

Used for: team invitations (`team-admin`) and password recovery
(`auth-recover`). Both fail quietly if the key is missing — the function
returns success so that nobody can learn whether an address exists.

---

## 4. Flutterwave

**Externally blocked. Nothing to restore, and nothing to set up.**

The schema is in the migrations and inert. No secret is set, no Edge
Function is deployed, and no checkout button exists in any app. When the
account is ready, the known configuration points are: `FLW_SECRET_KEY` and
`FLW_SECRET_HASH` as Edge Function secrets, the `billing` and
`billing-webhook` functions deployed, and the webhook URL registered with
Flutterwave. Do not deploy them before then: a webhook endpoint that exists
with no secret hash is an endpoint that accepts anything.

---

## 5. DNS

**At GoDaddy, both the domain and the email.** Never move the nameservers to
Netlify DNS — `hello@thelabelboard.com` dies with them.

| hostname | points at |
|---|---|
| `thelabelboard.com` | Netlify, marketing site |
| `app.thelabelboard.com` | Netlify, customer app |
| `admin.thelabelboard.com` | Netlify, operator console |
| `partners.thelabelboard.com` | Netlify, partner portal |

Plus, and easy to forget because nothing visibly breaks:

- the **Resend** verification records (SPF, DKIM, return-path CNAME)
- the existing **MX** records for GoDaddy email

---

## 6. The order to do it in

1. Supabase project, schema from git, fingerprint matched (1.1–1.2)
2. Auth settings and redirect URLs (1.3) — before anybody tries to sign in
3. Storage bucket with its limits (1.4)
4. Edge Function secrets, then deploy the three functions (1.5–1.6)
5. Restore studio data — platform backup, or per-studio exports
6. Restore storage objects with their paths (1.4)
7. Accounts (section 7)
8. Netlify sites, branches, publish directories (2)
9. DNS, including the mail records (5)
10. `select jobname, schedule, active from cron.job;` (1.7)
11. `node release.js --staging` pointed at the new project

---

## 7. Accounts, which are the hard part

**The per-studio export does not carry accounts.** It carries memberships and
profiles, which *point at* accounts by uuid. Restoring into a fresh project
gives you studios full of correct data that nobody can sign into.

Worse, quietly: there is **no foreign key** from `memberships`, `profiles`,
`partners` or `platform_admins` into `auth.users`. Only
`account_deletion_requests` has one. So a restore produces orphaned
memberships with no error at all. After any restore, run:

```sql
select count(*) from public.memberships m
 where not exists (select 1 from auth.users u where u.id = m.user_id);
```

Zero, or nobody in those studios can get in. `backup_harness` asserts this
after every restore it performs.

### What survives, and what does not

- **Password hashes are bcrypt** (`$2a$`) and portable. A platform backup that
  carries `auth.users` carries working passwords: nobody is forced to reset.
- **A per-studio export carries no hashes**, and must not — building an export
  that did would mean putting every studio's credentials in a file somebody
  can download.
- **Nothing load-bearing is in user metadata.** `raw_user_meta_data` holds
  only `email_verified`; `raw_app_meta_data` only `provider`/`providers`. The
  uuid is the whole of the link, so a restore needs to preserve ids and
  nothing else.
- **Sessions do not survive.** Everybody signs in again. This is correct and
  not worth engineering around.

### If accounts cannot be restored

Create each account with its **original uuid** through the Admin API, then
send everybody a password reset. Memberships then match without being
touched. If the uuids cannot be preserved, the memberships must be re-pointed
by email address, which is a data migration and needs writing at the time —
the addresses are in the export, under `profiles`.

---

## 8. What this costs, measured

`node supabase/tests/recovery_drill.mjs` performs the database half against
an empty Postgres and prints its own timings. The last run:

- empty database up: under a second
- schema from git, 66 migrations: ~1 second
- export, purge, restore of one studio: under a second each

So the database is minutes, dominated by the size of the real data rather
than by the process. **Everything else in this file is typing**, and it is
the honest majority of the recovery time: Supabase settings, three function
deployments, four Netlify sites, DNS, and a password reset for everybody.

A realistic figure for a total loss, done carefully by somebody who has read
this file first: **half a day**, most of it waiting for DNS and reading
dashboards. Not the seconds the drill reports, and saying so is the point of
the drill reporting what it did *not* cover.
