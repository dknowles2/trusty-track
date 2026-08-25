# Demo Stage 3: Idle Disconnect and Cold Start [PARTLY BUILT]

> **The idle disconnect is built. The cold-start work was measured and is not
> needed.**
>
> `frontend/src/api/demoSession.ts` holds the rules,
> `features/core/components/DemoSessionGate.tsx` the wiring, and
> `initialConfig.demoMode` is how the page finds out what it is.
>
> **The cold-start section below rests on a number that turned out to be
> wrong.** It guessed "likely several seconds"; measured, a cold start is:
>
> | | |
> | --- | --- |
> | `import backend.api.main` (whole process, warm cache) | **0.41 s** |
> | `init_db()` on a fresh database — all 24 migrations | **0.15 s** |
> | `init_db()` when already at head | **~0 s** |
> | `demo_content.seed` — roster, photographs, schedule, a raced round | **0.13 s** |
>
> About **0.7 s** in total. Each of the four proposed cuts is therefore either
> worthless or invisible:
>
> * *skip the migration when already at head* — an at-head `alembic upgrade`
>   costs nothing measurable, and on the deploy target storage is ephemeral so
>   every boot runs the full chain anyway, for 0.15 s;
> * *bake the seeded database into the image* — seeding is 0.13 s, and stage 2
>   already replaced the archive with code;
> * *lazy-import `pillow_heif`* — 7 ms of a 410 ms import, and it would move
>   when the HEIF opener is registered for no visible gain;
> * *startup CPU boost* — free, and stage 4's to configure.
>
> Nothing was implemented for it. Measured on an M-series Mac with warm caches,
> so a cloud runner will be some multiple of this — but a multiple of 0.7 s is
> not the problem the section describes. **Re-measure before reviving any of
> it**, rather than reviving it because it is written down here.
>
> Also checked while measuring, because it would have broken the demo outright:
> `populate` copies its photographs from `backend/assets/defaults/`, which
> `COPY backend/ ./backend/` puts in the image and `.dockerignore` does not
> exclude. The demo's photographs are local files, not external URLs.

Two latency-and-cost problems that only exist because the demo scales to zero.
Neither affects an operator's install.

---

## The problem: one abandoned tab

Cloud Run bills **instance-time, not request-time**. An instance serving many
concurrent WebSockets is billed once, so cost does not scale with viewers — it
scales with how long an instance stays awake.

Which means the entire cost risk is a single visitor who opens the demo,
wanders off, and leaves the tab open. The subscription socket stays in flight,
the instance never scales to zero, and the month goes from roughly 50 free
instance-hours to 730 billed ones.

## What fights us

`frontend/src/api/liveConnection.ts` is built to *never* stay disconnected, and
every part of that is deliberate:

- `graphql-ws` gives up permanently after five reconnections — about thirty
  seconds of backoff, less than an access point reboot — so the retry limit was
  raised;
- it never pings an idle socket, so a half-open connection from wifi dropping a
  client fires no close event and triggers no retry at all, which leaves a wall
  display showing a stale payload while believing it is connected — so
  `keepAlive` was set;
- the library sends pings and does nothing when no pong returns, so
  `pingWatchdog` closes the socket to turn the hang into a close event.

All three are correct for a gym on race day and all three are exactly wrong for
scale-to-zero. The demo has to invert the behaviour, not disable it globally.

---

## Idle disconnect

**Server side.** In demo mode, close a subscription after a period with no
client activity. Track activity at the connection, not at the render — a
leaderboard subscription pushes payloads on its own and that is not a person.

**Client side.** When the socket closes for this reason, do *not* reconnect.
Show a "Demo paused — click to resume" state and reconnect on the click. Without
the client half the server half achieves nothing: the retry logic above will
reopen the socket within seconds and the instance never sleeps.

Distinguish this close from a network failure. A demo visitor on a flaky
connection should still get the ordinary retry behaviour; only a deliberate
idle close should latch.

**Absolute session cap.** Separately, end a session outright after roughly
twenty minutes. It bounds the worst case, limits abuse, and gives a natural
moment to offer a reload for a fresh demo.

Both timeouts belong in a pure module with the rules and the doing in the
component — the same split as `raceFlow.ts` and `chime.ts`. The test for
whether something belongs there: it does not survive a refresh.

---

## Cold start

> **Not built — measured instead, and not needed. See the header.** Kept
> because the reasoning is sound and only the premise was wrong; if the boot
> path ever grows, this is the list to work through.

The first visitor after an idle period waits for a boot. Today that is Python,
FastAPI, Strawberry, SQLAlchemy and `pillow_heif`, then `alembic upgrade head`
inside `init_db()`, then `initialize_timer_managers`. Likely several seconds,
and a demo's first impression should not be a spinner.

Four cuts, in order of value:

**Skip the migration when already at head.** A pre-seeded image is at head by
construction, so running `alembic upgrade head` on every cold start is pure
latency for no change. Compare the database's stamped revision against head and
skip when they match. This helps every install, not only the demo — a Pi pays
it on every restart too.

**Bake the seeded database into the image** rather than restoring an archive on
each boot. Stage 2's restore path stays, for the always-on hosts that reset in
place; the cold path can start from a database that is already there.

**Lazy-import `pillow_heif`.** It is imported at module scope in `api/main.py`
and its opener is registered there, but it is only needed on upload — which
demo mode refuses outright.

**Enable Cloud Run's startup CPU boost.** Configuration, not code.

---

## Done when

- An idle demo session closes its socket and the client stays closed until
  clicked. ✅
- A real network drop still retries as it does today. ✅ — `liveConnection.ts`
  is untouched. What changed is that the demo *disposes* the client, which is
  the one thing its retry policy cannot come back from.
- An instance with no visitors reaches zero. ✅ by construction: the socket is
  disposed and a parked page issues no queries.
- Cold start is low enough that the first page paint does not read as broken;
  measure it rather than assuming. ✅ measured at ~0.7 s, and the measurement
  is why nothing was built.
- None of the above changes behaviour with the demo flag unset. ✅ — the gate
  renders `null` and registers no listeners.
