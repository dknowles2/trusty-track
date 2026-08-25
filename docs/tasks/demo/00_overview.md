# Cloud Demo Instance — Overview

> **Built, less the deployment itself.** All four stages ship, apart from
> two pieces that measurement or the deploy target made unnecessary —
> stage 2's always-on reset timer and stage 3's cold-start work — and the
> act of creating the Cloud Run service, which needs an account rather
> than a commit. The markers on each file say which; see the plan-file
> convention in `CLAUDE.md`.

## Goal

A single public URL where somebody evaluating Trusty Track can click through a
populated race — roster, schedule, a heat run on the fake timer, standings,
awards — without installing anything.

This is deliberately **not** the multi-tenant hosted product. It is one shared,
disposable instance. Everything here should stay useful if a hosted product is
built later, and none of it should create debt against that work.

---

## Why this is a small problem

Almost every obstacle to hosting Trusty Track is about *tenancy* or *real
data*, and a demo has neither.

One container, one process, one SQLite file means the three structural
blockers stay exactly as they are and need no work:

| Constraint | Why it is fine here |
| --- | --- |
| `pubsub` is a module-level singleton over asyncio queues | One process, so every subscriber is reachable |
| `TIMER_MANAGERS` is a module dict built at startup | One process owns every track; no actor placement problem |
| SQLite file plus a local uploads directory | Ephemeral container storage; nothing is worth keeping |

The fake timer (`TimerType.FAKE`) removes the hardware question entirely: no
venue laptop, no serial port, no browser-proxied WebSocket.

## What already exists

Most of the demo is written.

- `crud.create_practice_race` builds a whole event — dens, roster, check-in, a
  general round and a championship round — in one mutation. It exists for
  exactly this audience: see
  [#201](https://github.com/dknowles2/trusty-track/issues/201).
- `populate` invents a believable roster with photographs.
- The fake timer runs heats with no hardware.
- `TRUSTYTRACK_DEMO_SEED` (`backend/demo_seed.py`) makes both repeatable.
- The Dockerfile builds and boots, and CI already checks `/health`.
- `services/backup.py` can produce and restore a whole install as one archive,
  and takes an engine and two directories rather than importing the app.

So the work is not "build a demo". It is: stop a stranger breaking it, give it
a reset, and deploy it.

---

## The actual problem: a shared mutable instance

The demo is writable by anyone who loads it. Two failure modes matter, and both
are one click.

**A visitor can lock everyone out.** `api/auth.py` treats every caller as
`OPERATOR` when no operator PIN is set — deliberately, so that upgrades do not
break an event mid-season
([#15](https://github.com/dknowles2/trusty-track/issues/15)). On a public demo
that means the first visitor to open System Settings and set a PIN owns the
instance until it is reset.

**`POST /upload/` is unauthenticated and uncapped.** In `api/main.py` it reads
the whole body into memory with no size limit, writes a permanent file, and has
no `_require_operator` call — unlike the three REST endpoints that guard
themselves (backup, restore, timer-test report). Its GraphQL twin `uploadImage`
*is* classified as a `CHECKIN` mutation; the REST path is not classified at all,
because `RolePolicyExtension` only sees mutations.

That second one is worth stating plainly, because it is true today and not
only in the demo: on a Pi on venue wifi it sits inside the stated threat model
(#15's "bored child with a phone"). It leaves that threat model the moment the
app has a public URL. It is also how a demo acquires the compliance problem it
was supposed to avoid — a visitor uploading a real photograph of a real child.

---

## Decisions taken, and why

**Demo mode is a denylist behind one seam, not scattered conditionals.** A
`DemoPolicyExtension` beside `RolePolicyExtension`, with a two-directional test
against the schema. Scattering `if DEMO_MODE` through resolvers is the failure
[#48](https://github.com/dknowles2/trusty-track/issues/48) keeps recording: a
rule that depends on every caller remembering reaches only some of them.

**The demo is stateless.** No volume, no durable data. This is what makes the
hosting choice reversible — persistent storage is the single largest difference
between providers, and the demo does not need any.

**Reset is seeding on boot, not a scheduled wipe.** With no durable state, a
restart *is* a reset, and every platform can restart a container. A scheduled
job would be the second-largest per-provider difference, and it is avoidable.

**Reset reuses `services/backup.py`.** A seed archive baked into the image,
restored through the existing path — which already validates before moving
anything, disposes the connection pool before the swap, stops the timer
managers whose track ids are about to change, re-runs `init_db()` and rebuilds
the registry. That sequence is what a live re-seed needs and it is already
written and tested in `restore_backup`. A second reset path would be a second
copy of it.

**Cloud Run is the deploy target, with Fly as the fallback.** Reasoning and the
cost model are in `04_deploy_and_portability.md`; both are reachable from the
same image with no code difference.

---

## Explicitly out of scope

- Accounts, sign-up, billing, tenancy — the hosted product is a different piece
  of work and this must not pre-empt its design.
- Any durable data. Nothing a visitor types is kept.
- Real timers. Fake only.
- Photograph uploads. Refused rather than limited (see `01`).
- A hosting abstraction layer. Portability here comes from having no state and
  calling no platform APIs, not from wrapping four platforms.

---

## Stages

| # | File | What it covers |
| --- | --- | --- |
| 1 [COMPLETED] | `01_demo_mode_gate.md` | The flag, the policy seam, what is refused, and the test that keeps it honest |
| 2 [PARTLY BUILT] | `02_seed_and_reset.md` | Seeding on boot (built, from code rather than an archive), and reset on each host (deferred) |
| 3 [PARTLY BUILT] | `03_idle_and_cold_start.md` | Idle disconnect and session cap (built); cold-start latency (measured at ~0.7 s, so not built) |
| 4 [COMPLETED] | `04_deploy_and_portability.md` | Cloud Run configuration, cost ceiling, and what makes a move cheap |

Stage 1 is the only one that gates a public URL. Stages 2 and 3 make it
survivable unattended; stage 4 is configuration.
