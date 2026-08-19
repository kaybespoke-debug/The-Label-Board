# Storage (multi-tenant)

The key fact: **text is basically free, photos are the whole cost.** Measurements, profiles, orders and
records are tiny. What actually uses space is images: client photos, product/stock pictures, staff
documents, patterns. So we meter and tier **images only**.

## What is already built and tested
- **`storageUsage()`** — walks the data and sums the bytes of every base64 image (client photos, order
  and outfit photos, product images, staff photos and documents, the company logo). Returns
  `{bytes, photos}`. Text changes never move the number. (Gate proves this.)
- **`STORAGE_TIERS`** — Free 1 GB · Studio 20 GB · Growth 100 GB · Atelier 1 TB. Object storage is cheap,
  so these are generous enough to match and beat competitors who advertise "1 TB".
- **`storageLimitBytes()`** — the limit for the business's current tier (`SETTINGS.storageTier`).
- **Settings → Storage meter** — shows `X used · N images` against the tier, with a colour bar that goes
  amber at 70% and red at 90%.
- **`saveImageAsset(dataUrl)`** — the single seam. **Today it returns the image inline (base64).**

Gate: `audit_storage.js`.

## What go-live adds (needs the backend)
1. **Route every image save through `saveImageAsset`.** The uploaders (`uploadLogo`, `uploadStaffPhoto`,
   `addCustomerPhotos`, product images, order photos) currently store the base64 data URL directly. At
   go-live, change `saveImageAsset` to upload to **per-business cloud storage** (Supabase Storage bucket
   keyed by `business_id`) and return the file URL, then have the uploaders `await` it. That is the only
   place the switch happens.
2. **Store URLs, not base64.** Once images live in cloud storage, records hold short URLs, so the
   database and sync payloads shrink dramatically and the app loads faster.
3. **Enforce the tier.** Before an upload, check `storageUsage().bytes` against `storageLimitBytes()` and
   prompt to upgrade when full. The meter already computes both.
4. **Row-level security.** The storage bucket is private and scoped to `business_id`, same as the tables,
   so no business can read another's images.

## Why this is a wedge
Nobody in this niche shows storage honestly. A clear "you have used X of your Y", generous tiers, and
secure per-business isolation is a real selling point, and the metering is already live.
