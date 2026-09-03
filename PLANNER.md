# The Calendar — spec, and how it is built in the customer app

Written so the admin console can carry the same thing without rediscovering
the decisions. The customer app's version is built and committed (not
deployed) as `4903b15`.

## What it is

It used to show two things: appointments and order due dates. A studio
runs on more than that, and each person needs to see the part that is theirs.

Six kinds of entry, from five sources:

| Kind | Where it lives |
|---|---|
| fitting | an appointment — **already existed** |
| order due | an order's due date — **already existed** |
| task | a job assigned to someone — **already existed** |
| meeting | new record |
| reminder | new record |
| content | new record — this is the content calendar |

## The rule that matters

**The planner is a view, not a second set of records.**

Fittings are appointments, deadlines are orders, jobs are tasks. All three
already exist. If the planner writes its own copy of one, the studio ends up
with two records for one thing and an argument about which is right.

So booking a fitting *from the planner* creates an **appointment**. It does
not create a planner entry. `audit_planner.js` checks exactly this, and it is
the first thing to keep true in any port.

## The store

`layi_dash_planner`, wired into `STATE_KEYS` so it syncs like everything else.

```js
{ id, title, date, time,
  type,          // task | meeting | reminder | content
  link,          // a meeting link, if any
  repeat,        // '' | daily | weekly | fortnightly | monthly
  invitees[],    // staff ids
  notes, branch, staffId, by, at, done }
```

## Free video

```js
https://meet.jit.si/TheLabelBoard-<slug>-<10 random chars>
```

No server, no account, no bill. People invited just open the link. Jitsi may
ask whoever *starts* the call to sign in once, as its own anti-abuse check.

**The random salt is not decoration.** Two meetings must never share a room,
or one team walks into another team's call. The gate checks it.

This is a correction to earlier advice in this project, which said video was
months of WebRTC work and not worth building. That was true of *building* it
and wrong about *linking to* it.

## Repeats

Evaluated per day — `plannerHitsDay(entry, 'YYYY-MM-DD')` — rather than stored
as occurrences. Editing the entry therefore changes every future one, and a
year of weekly meetings costs one record instead of fifty-two.

## The two lenses

- **Everyone** — the studio's week
- **Mine** — assigned to me, or I was invited, or I created it

Order deadlines and announcements stay visible in **both**: they are the
studio's and everybody needs them. A tailor opening the planner should see
their own bench, not the owner's diary.

The lens control only appears once there are two or more people to filter
against — a one-person studio has nothing to choose between.

## Two traps

**Changing the Type dropdown re-renders the form.** Anything that reads a
field back as empty will wipe it. This cost the date and a freshly generated
video link during testing. Keep the existing value when a field reads blank,
and write the video link straight into the input rather than re-rendering.

**Do not rename the view key.** The key stays
`calendar`. It is stored in saved role permissions on real devices, and
renaming it would break roles that already exist for no gain. Kayode asked for the visible name to stay Calendar; the internal machinery is still called the planner because that is what it does.

## Where the code is

`site/layi_dashboard.html`:

- `===== THE PLANNER` — the model, types, repeats, lens
- `openPlannerEntry` / `renderPlannerEntry` / `savePlannerEntry` — the form
- `makeVideoLink` — the Jitsi room
- `calEventsByDay` — where the five sources are folded together

`audit_planner.js` is the gate. It is verified against four injected faults: a
fitting writing a planner entry instead of an appointment, every meeting
sharing one video room, the lens showing a tailor the owner's diary, and
repeats not landing.

## Open questions for the console

- Does the console already have a tasks/announcements store the planner should
  read rather than duplicate?
- Should a console meeting be able to invite a tenant (a studio owner), or
  only Label Board staff? That decides whether the invitee list is
  `platform_admins` only or reaches into `businesses`.
