# Deploy — the customer app

The app is one file, `site/layi_dashboard.html`. There is no build step. The
public URL runs the full live Supabase stack (cloud sync, realtime, team auth),
which a local preview does not.

## How it ships today

Netlify is connected to `github.com/kaybespoke-debug/The-Label-Board` and
watches the **`main`** branch. The root `netlify.toml` on `main` publishes the
`site/` folder and serves the app at `/`. Push to `main` and it redeploys.

`site/` holds the app plus its PWA files and nothing else, so nothing internal —
gates, notes, SQL, the other three apps — is ever served to the public.

The admin console, the partner portal and the public website are three separate
Netlify sites from the same repo. See `CLAUDE.md` for which folder and branch
each one uses.

## Before you push

```bash
node verify.js
```

Twenty-three gates, exit 0 means green. Then bump `CACHE` in `site/sw.js`, or
installed phones will keep serving the old version.

## Before the live features work on a fresh deployment

Run these once — see `SUPABASE_SETUP.md` and `supabase/`:

1. **SQL Editor** → run the migrations in `supabase/migrations/` in filename order.
2. **Deploy the functions**: `supabase functions deploy team-admin` and `supabase functions deploy admin-api`.
3. **Auth → Users → Add user** (your email and password), then insert the matching `profiles` row with that user's UUID.
4. Open the deployed URL and sign in with your **email** — an email, rather than a username, is what triggers the cloud path.

Offline demo mode (username `owner` / `layi2025`) keeps working with no setup at
all, entirely on the device.
