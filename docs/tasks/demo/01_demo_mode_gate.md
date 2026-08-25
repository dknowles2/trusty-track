# Demo Stage 1: The Demo Mode Gate [COMPLETED]

> **Built.** `backend/demo_mode.py` holds the flag, `backend/api/demo_policy.py`
> the mutation denylist, and the four REST routes check for themselves.
> `backend/tests/test_demo_mode.py` covers it.
>
> **Two departures from what is written below**, both recorded rather than
> quietly taken:
>
> * `POST /upload/` is guarded at **check-in**, not operator, and that half
>   shipped separately in #263 because it is a live security gap rather than a
>   demo feature. This section said operator, matching the neighbouring backup
>   routes — but its GraphQL twin `uploadImage` is classified as a `CHECKIN`
>   mutation, and requiring the operator would make the REST route stricter
>   than the mutation that does the same thing. Photographing a car is the
>   desk's job.
> * `importRacers` was added to the denylist. It is bulk row creation from
>   caller-supplied text on an instance other people are looking at, which is
>   the same objection as `populateRace`.
>
> Also worth knowing: the route turns out to have **no callers at all** — not
> the frontend, not the e2e specs, not the suite. Images travel as data URLs
> through `uploadImage`. Whether it should exist is a separate question from
> whether it should be open, and only the second was settled here.

The only stage that gates a public URL. Everything here is about a stranger
with a browser, not about hosting.

---

## The flag

One environment variable, read in one place, exposed as one predicate.

```
TRUSTYTRACK_DEMO_MODE=1
```

Read it where `DATA_DIR` and friends are read, and give it a module of its own
(`backend/demo_mode.py`) so that nothing has to import `main` to ask. Follow
`demo_seed.py`: opt-in, absent everywhere but the deploy that wants it, and
inert in every test that does not set it.

The flag must be *inert by default*. An operator running the Docker image on
their own Pi must get exactly today's behaviour with nothing to turn off.

---

## Seam 1: a schema extension for mutations

Add `DemoPolicyExtension` beside `RolePolicyExtension` in the schema's
extension list. It refuses a denylist of mutation names when the flag is set,
and does nothing at all when it is not.

Two things carry over from `api/auth.py` and are not optional:

- **Use `resolve`, not `on_execute`.** Raising from `on_execute` is silently
  swallowed and the mutation completes — a guard that passes its own test while
  permitting everything.
- **Extension order is load-bearing and reads backwards.** A later extension
  wraps an earlier one. `AuditExtension` is listed after `RolePolicyExtension`
  so that it can catch the refusal and record it. Put `DemoPolicyExtension`
  where a demo refusal is *also* audited — that is, before `AuditExtension` in
  the list — and assert it, because the first draft of the audit work had this
  the other way round and recorded no refusals at all.

### What is refused

| Mutation | Why |
| --- | --- |
| `createInitialConfig`, `updateInitialConfig` | Sets the operator and check-in PINs. One visitor setting a PIN owns the instance until reset. Also reconfigures tracks, including the timer type |
| `uploadImage` | A public write-anything-to-disk path, and the route by which a real child's photograph could arrive |
| `populateRace`, `createPracticeRace` | Unbounded row generators behind no credential. The demo is seeded already; a visitor does not need to seed it again |

`deleteRace` and the destructive round and heat mutations stay **allowed**.
Deleting things is part of what a demo is for, and the reset undoes it.

### The test that keeps it honest

Mirror `test_auth_policy.py::test_every_mutation_is_classified` and compare in
both directions:

- left to right: a refused name the schema does not have, which is how a policy
  table quietly stops describing the schema;
- right to left is *not* wanted here — a new mutation should default to
  allowed, unlike the role policy where an unclassified mutation is correctly
  denied to everyone.

That asymmetry is deliberate and worth a comment in the test, because it is the
opposite of the neighbouring policy and will otherwise read as an oversight.

Assert the mutation was **refused** — that the row is absent — never that the
check ran. Same rule as the role policy tests, for the same reason.

---

## Seam 2: the REST endpoints, which the extension cannot see

`RolePolicyExtension` covers GraphQL mutations only. Four REST routes need
their own check, exactly as backup, restore and the timer-test report already
make their own `_require_operator` call.

| Route | Action in demo mode |
| --- | --- |
| `POST /upload/` | Refuse with 403 |
| `GET /api/backup` | Refuse — zip-the-world on demand is CPU and disk amplification behind no credential |
| `POST /api/backup/restore` | Refuse — replaces the whole instance from an anonymous upload |
| `/ws/timer/{track_id}` | Refuse — operator-only, and therefore open when no PIN is set |

### Fix `POST /upload/` regardless

Independent of the demo, and worth doing in the same change:

- it has no `_require_operator` call while its GraphQL twin is classified;
- `await file.read()` pulls the entire body into memory with no size cap;
- nothing ever removes what it writes. The test data directory reached 8,000
  files and 3.5 GB before anybody looked — see the suite's notes in
  `CLAUDE.md`.

Give it the same operator check the other REST routes make, and a size limit.
That is a small change with a security consequence, and it should not wait for
the demo to ship.

---

## Seam 3: CORS

`allow_origins=["*"]` with `allow_credentials=False` is correct on a LAN, and
the comment in `api/main.py` explains why: a display or a phone on venue wifi
loads the served page from this origin, and the PIN is what the server checks.

On a public origin the reasoning does not hold — `VIEWER` is the no-credential
default and viewers can read a roster. Set the allowed origin from an
environment variable, defaulting to `*` so that nothing changes for a LAN
install.

---

## Seam 4: force the fake timer

`initialize_timer_managers` walks every `Track` at startup and calls
`autodetect()` for anything set to `AUTO_DETECT_BACKEND`, which probes USB
serial ports. A container has none, so this is noise rather than danger — but a
visitor can change a track's timer type through the settings page, and
`/ws/timer/{track_id}` is operator-only and therefore open.

Refusing `updateInitialConfig` (above) closes the route in. Belt and braces:
in demo mode, coerce every track to `TimerType.FAKE` when the managers are
built, so a seed archive with the wrong timer type in it cannot start a probe.

---

## Done when

- The flag is off by default and no existing test changes behaviour.
- With the flag on, each refused mutation and route returns a refusal and
  leaves no row behind.
- A refusal appears in the activity log.
- `POST /upload/` requires the operator role and caps its body size in *every*
  mode, not only the demo.
