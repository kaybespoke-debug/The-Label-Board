# Recovery

**A backup taken before 5 October restores correctly, and you do not have to
do anything about it.** Those are version 3 files, with the selling price and
the paid figure inside each order's document rather than in `order_pricing`
and `order_settlement`. `app.import_studio` reads the file's `_version` and,
below 4, copies them across with `app.order_pricing_detail` and
`app.order_settlement_detail` and then strips them with
`app.order_doc_without_secrets` — while the user triggers are still off, so no
revision is bumped. The result it returns names the format it read.
`restore_harness` builds a genuine version 3 file and restores it through the
real path on every run.

What to do when data is gone. Four situations, in the order they are likely,
and each one has a command rather than a plan.

The thing to know before any of it: **a backup nobody has restored is a file
nobody knows the shape of.** So the per-studio restore is drilled on every
run of the suites, end to end, against a database built from the migrations
alone:

```bash
node supabase/tests/restore_harness.mjs
```

It builds a studio with orders, costs, clients, contact details, money, a
team, a changed permission table and an audit trail; exports it; **purges it
for real**; restores it from the file alone; and then compares both sides row
for row and naira for naira, including the two things a careless restore
changes quietly — the history would name whoever ran the restore, and the
suspended member would come back able to sign in. 53 assertions.

---

## 1. A studio deleted something, or a device went wrong

The common one, and the only one that does not involve us touching the
project. Nothing has been lost from the database: a device wrote something
over something else, or a studio cleared the wrong thing.

**If the studio has an export**, restore it:

```sql
select public.import_studio('<the contents of the file>'::jsonb);
```

Platform admins only. It restores the studio **as itself** — same business
id, same row ids — so the devices that still have it open simply resync. It
refuses if the studio or its web address is still there, which means the
normal sequence is: close it, purge it, restore it. That refusal is
deliberate: restoring a studio beside a copy of itself is how two studios end
up believing they are the same one.

**If the studio has no export**, this becomes situation 3.

Tell every studio to use **Settings → Data & storage → Your data, from the
server → Download everything** rather than the browser backup beside it. The
browser backup only holds what that device was allowed to see: a manager's
copy has no costs in it, a workroom copy has no phone numbers, and no copy
has more than the last six hundred lines of the activity log.

## 2. A studio closed and changed its mind

```sql
select public.reopen_studio('<business id>');
```

Closing keeps everything for thirty days and reopening puts everybody back as
they were, including the person who was suspended coming back suspended. The
owner does not need us: signing in as the person who closed it is enough, for
the whole thirty days.

After the thirty days the studio can be purged, and only then:

```sql
select public.purge_studio('<business id>');
```

which writes what our own books need into `public.tlb_closed_studios` first —
the name, the plan, the dates, and the row counts — because
`partner_referrals` and `tlb_customers` both point at `businesses` with ON
DELETE SET NULL, so a purge does not fail, it quietly cuts a commission we
owe from the studio it was earned on.

## 3. The database itself

Supabase keeps the project. This is the one to reach for when the loss is
ours rather than a studio's: a bad migration, a table dropped, a mistake made
with the service role.

1. **Supabase dashboard → Database → Backups.** Daily backups are taken
   automatically. Point-in-time recovery, where it is enabled, restores to a
   chosen minute rather than to a day.
2. **Restore into a new project first, never over the live one.** The live
   project is the only evidence of what actually happened, and a restore over
   it is not reversible. Read what you need out of the copy.
3. **Check the restored project against the repo before trusting it:**

   ```bash
   node supabase/tests/schema_inventory.mjs --fingerprint
   node supabase/tests/schema_inventory.mjs --sql      # run this there
   ```

   One md5 against one md5. If they differ, diff the two lists and you have
   the exact objects.

**What a project restore does not fix:** it takes every other studio back to
that moment too. For one studio's data, situation 1 is the right tool.

## 4. Somebody's account

A person deleting their own account is refused if they are the only owner of
a studio that is still running, and told the two ways out — hand it to
somebody else, or close it as they go. Nothing about that is recoverable by
us afterwards: the auth user is gone. The studio is not; it was closed, so it
has its thirty days like any other.

---

## Verifying a backup is real

A backup that has never been read is a belief. Three things to check, and all
three take minutes:

1. **The per-studio path is drilled by the suite** (`restore_harness.mjs`),
   every run, including the purge. That one needs nothing from you.
2. **The project path needs a real restore, by hand, at least once.** Restore
   the most recent backup into a scratch project, run the fingerprint check
   above, and open the app against it. Write down the date you did it, because
   the next person will want to know how old that answer is.
3. **Ask a studio to download everything and open the file.** It should name
   the studio, and carry its orders, its costs, its clients' contact details
   and its activity log. If any of those sections is empty for a studio that
   has them, the export is broken and the drill missed it.

## What we watch

`public.error_reports` is what broke, from both halves of the system: the
browser posts its own errors and unhandled rejections, and the three Edge
Functions post their failures. Append-only, platform admins only, and the
`source` column is stamped by the database — a client cannot present itself
as the server.

```sql
select at, source, kind, app_version, left(message, 120) as message
  from public.error_reports
 order by at desc limit 50;
```

Two hundred rows an hour per studio, after which further reports are dropped
silently, because a page broken enough to throw on every frame must not be
able to post its own loop. Reports made before anybody signed in wait on the
device and go up when a session arrives, since a fault during boot is the one
that loses a studio a day.

## The rule that produced most of this file

**Never apply SQL to a project except from a migration file.** It has now
happened twice that objects existed on a project and in no migration — five
the first time, sixteen the second, and the second lot included the columns
and functions that the audit-authenticity checks rest on, so a probe was
proving something real about staging and nothing at all about a fresh project.

`supabase/schema_inventory.txt` is the snapshot that makes the check cheap.
One command each side, one md5 to compare.
