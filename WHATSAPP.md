# Automatic WhatsApp updates — go-live wiring

Today LAYI messages customers over WhatsApp with a **manual hand-off**: it opens WhatsApp with the
message pre-filled and the owner taps send. This needs no API, keeps numbers private, and always
works. The groundwork below turns that into **automatic** sending (like WATI/Stitchflow) once the
backend is live. Nothing here changes current behaviour until an endpoint is set AND the app is live.

## What's already in the app (client)

- `waCfg()` — per-business config on `SETTINGS.wa`: `{auto, events:{confirm,ready,reminder}, endpoint, sender}`.
- `waOnEvent(kind, order)` — called at the milestones below. A **no-op** unless `waAutoReady()`.
- `waAutoReady()` — true only when `auto` is on, an `endpoint` is set, the app is in `liveMode`, and Supabase Functions are available.
- `waAutoSend(kind, order)` — POSTs `{to, template, text, order, sender}` to the Edge Function.
- Settings → Company & invoices → Message templates → **Automatic WhatsApp updates** (toggle + per-event checkboxes).

### Milestones wired
- **`confirm`** — fired in `saveOrder()` when a NEW order is created.
- **`ready`** — fired in `saveUpdate()` when an order reaches *Ready for Delivery*.
- **`reminder`** — event exists; wire to your overdue sweep when you build the reminder cron.

## What to add at go-live (server — the ONLY place the API token lives)

1. Pick a WhatsApp Business API sender: **Meta Cloud API** (cheapest, direct), **360dialog**, or **WATI**.
2. Get message **templates approved** by Meta (business-initiated messages must use approved templates). Map one template per `kind` (confirm / ready / reminder).
3. Deploy a Supabase Edge Function **`send-whatsapp`** that reads `to, template, text, order, sender`, looks up the tenant's approved template, and calls the provider. Store the provider token in the function's env (`WHATSAPP_TOKEN`), **never** in the client.
4. In the tenant's Settings, set `SETTINGS.wa.endpoint = 'send-whatsapp'` and `SETTINGS.wa.sender = '<phone-number-id>'`, then turn the toggle on.

`endpoint` and `sender` are safe to store client-side (a function name and a public phone id). The secret
token stays server-side. Re-sends are idempotent per order+kind if you dedupe in the function.

## Cost note (why Meta Cloud API is usually right)
Meta Cloud API bills per conversation and is far cheaper than reseller seats. WATI/360dialog add a
friendlier dashboard and onboarding for a monthly fee. Start on Cloud API unless a tenant wants the
hand-holding.
