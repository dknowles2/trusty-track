# Demo Stage 3: Idle Disconnect and Cold Start

> **Not built.**

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
  clicked.
- A real network drop still retries as it does today.
- An instance with no visitors reaches zero.
- Cold start is low enough that the first page paint does not read as broken;
  measure it rather than assuming.
- None of the above changes behaviour with the demo flag unset.
