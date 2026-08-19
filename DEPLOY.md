# Deploy — get a public link

The app is one file (`layi_dashboard.html`), so hosting is trivial and the public URL runs the **full live Supabase stack** (cloud sync, realtime, team auth) — unlike a local preview.

## Fastest: Netlify Drop (no account setup, ~30 seconds)
1. Go to **https://app.netlify.com/drop**
2. Drag this whole folder onto the page.
3. You get a public URL (e.g. `https://your-name.netlify.app`). The included `netlify.toml` serves the app at the root.

Re-drag the folder any time to publish an update.

## Auto-deploy on every change: connect a repo
1. Push this folder to a GitHub repo.
2. Netlify → **Add new site → Import from Git** → pick the repo. Leave build command empty; publish directory `.`.
3. Every `git push` now redeploys automatically.

## Before the live features work on the deployed site
Run these once (see `supabase_setup.sql` and `supabase/functions/team-admin/`):
1. **SQL Editor** → run `supabase_setup.sql` (creates tables + RLS + realtime, adds `profiles.staff_id`).
2. **Deploy the function**: `supabase functions deploy team-admin`.
3. **Auth → Users → Add user** (your email + password), then run the `insert into profiles …` at the bottom of the SQL with that user's UUID.
4. Open the deployed URL and sign in with your **email** — an email (not a username) triggers the cloud path.

Offline/demo (username `owner` / `layi2025`) keeps working with no setup, fully local.
