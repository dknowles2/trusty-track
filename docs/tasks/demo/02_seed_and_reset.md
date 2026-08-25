# Demo Stage 2: Seeding and Reset

> **Not built.**

The demo is writable by strangers, so it needs to return to a known state. This
stage makes that happen without a volume and without a scheduled job — which is
also what keeps the hosting choice reversible.

---

## The shape

**No durable state.** The data directory is ephemeral container storage. Nothing
a visitor types survives the instance.

That single decision removes the two largest differences between hosting
providers: persistent volumes (Fly volumes, Hetzner bind mounts, Railway
volumes, and nothing at all on Cloud Run) and scheduled jobs (Machines API,
Cloud Scheduler, Railway cron, systemd timers). With neither, the platform's
whole job is "run this image".

It is also the retention answer. Anything a visitor enters is gone by the next
restart, which is a defensible line in a privacy notice and the reason the demo
does not inherit the compliance problem discussed in `00_overview.md`.

---

## The seed archive

Build the demo's starting state **once**, as a backup archive, and bake it into
the image.

1. Run an instance with `TRUSTYTRACK_DEMO_SEED` set.
2. `createInitialConfig`, then `createPracticeRace` — which already produces a
   populated roster, a general round and a championship round
   ([#201](https://github.com/dknowles2/trusty-track/issues/201)).
3. Run a few heats on the fake timer so that standings and awards have
   something in them. A demo that opens on an empty leaderboard shows the
   least interesting version of the app.
4. `GET /api/backup`, and commit the archive (or generate it in the Docker
   build).

Set `TRUSTYTRACK_DEMO_SEED` in the deployed image too. In ordinary use a fixed
seed reads as the app being broken — the same thirty children every evening,
identical lane times to three decimal places — which is why `demo_seed.py`
makes it opt-in. For a demo it is the point: stable support answers, and the
same roster a reader has already seen in the documentation screenshots.

### Why an archive rather than seeding from code

`services/backup.py` already restores one, and `restore_backup` in `api/main.py`
already does the hard parts in the right order: validate before moving
anything, close the request's session, stop the timer managers whose track ids
are about to change, dispose the connection pool before the swap, re-run
`init_db()`, rebuild the manager registry.

A second seeding path would be a second copy of that sequence, and the parts of
it that are easy to get wrong are invisible when wrong.

---

## Seeding on boot

In the lifespan, when the flag is set and the database is absent or empty,
restore the baked archive before serving.

Two wrinkles:

**The `.pre-restore` copies.** `restore_archive` keeps the replaced database and
uploads directory beside the new ones. That is right for an operator and wrong
for a demo that resets repeatedly — it doubles disk each time. Add a parameter
to skip the copies, and use it only from the demo path; do not change the
operator default.

**Migration failure currently only logs.** The lifespan catches an `init_db()`
exception, logs it, and goes on to serve. For a Pi that is arguably right — the
operator can see the log and the app is still there. For a demo booting from an
archive it means silently serving a broken instance. In demo mode, fail the
startup instead.

---

## Reset, per host

| Host | Reset |
| --- | --- |
| **Cloud Run** | Scale-to-zero *is* the reset. The instance dies when idle and the next visitor gets a fresh container with the baked seed. Nothing to build |
| **Fly / Hetzner / Railway** (always on) | An asyncio task in the lifespan that re-restores the archive every N hours |

The in-process timer is the portable form of a scheduled job — same code
everywhere, no per-provider configuration. But it does **not** work on Cloud
Run: with CPU allocated during requests only (the mode the cost model depends
on), background tasks are throttled to near-nothing between requests.

So build seed-on-boot first, since it works everywhere and is all Cloud Run
needs, and treat the timer as an extra required only by an always-on host.

### If the timer is built

It re-enters `restore_archive` under live subscribers, so it must go through
the same teardown `restore_backup` performs, and it must not fire mid-session.
Gate it on there being no active WebSocket subscribers, with a maximum wait so
that one abandoned tab cannot postpone the reset indefinitely — which is the
same abandoned-tab problem stage 3 solves for cost.

---

## Done when

- A cold container boots into a populated race with standings, with no volume
  mounted and no manual step.
- The reset leaves no `.pre-restore` copies behind.
- A failed migration in demo mode stops the process rather than serving.
- The same image, with the flag unset, still boots against a real data
  directory and changes nothing for an operator.
