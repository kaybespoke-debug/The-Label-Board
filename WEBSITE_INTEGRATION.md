# Website integration (any tenant site → studio)

Each business can connect its own website so orders and ready-to-wear sales flow into the studio
automatically, and stock is kept in step. The mapping is built and gated; only the **transport**
(receiving orders from a live site) is switched on at go-live.

## What is already built and tested
- **`normalizeWebOrder(raw)`** — maps any platform's fields onto one canonical shape. It already
  understands common aliases from Shopify, WooCommerce, Wix and custom carts:
  - order ref: `ref` / `id` / `order_id` / `order_number` / `number` / `name` (a leading `#` is stripped)
  - total: `total_ngn` / `total` / `amount` / `total_price`
  - payment: `payment_status` / `financial_status` (`paid`/`completed`/`success` → paid)
  - customer: `customer_name` or `customer.name` or `first_name`+`last_name`; `email`; `phone`
  - items: `items` / `line_items` / `products`, each mapping `product_id`/`studio_ref`/`sku`/`variant_id`,
    `name`/`title`, `qty`/`quantity`, `price_ngn`/`price`/`unit_price`, colour/variant
  - made-to-measure vs retail: if `measurements` is present → a studio **order**; else a **sale**;
    `is_consultation` (or `type: "consultation"`) → an **appointment**
- **`webOrderToStudio(order, items)`** — turns one normalized order into the right studio record.
  Money is only counted when actually **paid** (a reported bank transfer is a claim, not cash).
- **`importWebOrders(rows)`** — idempotent batch import (re-running never duplicates), and a website
  **retail sale automatically decrements studio stock** via `webDecrementStock` (matches a product by
  its id, `studio_ref`, or a variant SKU).

Gate: `audit_webimport.js`.

## What go-live adds (needs the backend)
1. **A transport.** Two clean options:
   - **Pull:** an Edge Function that reads the shop's `orders` where `synced_to_studio_at is null`,
     calls `importWebOrders`, then stamps them synced.
   - **Push (webhook):** the site POSTs each new order to an ingestion endpoint that calls
     `importWebOrders`. Works for Shopify/Woo/Wix webhooks with no schema changes here.
2. **Product linking.** Give each studio product a `studio_ref`/`sku` matching the website product so
   stock decrements land on the right item. (The matcher already supports all three keys.)
3. **An "Import from website" button** wired to the transport.

## The rule
The two systems stay separate databases. The website never writes studio data directly; it only hands
over orders, which `importWebOrders` maps and records. Nothing is trusted as paid unless the payment
status says so.
