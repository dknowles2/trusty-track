# Roles, the public demo, the activity log, locking a race

Part of the Trusty Track agent guide; the index is in [`CLAUDE.md`](../../CLAUDE.md). Read this before touching `api/auth.py`, `api/demo_policy.py`, `domain/audit.py`, `api/race_lock.py`, or a schema extension.

---

### Roles and the operator PIN

`backend/api/auth.py`. Three roles — `VIEWER` (the wall displays, no credential, **no mutations at all**), `CHECKIN` (the registration desk: racers, photos, check-in), `OPERATOR` (everything). Derived from who is physically in the room, not from an abstract permission model.

**Off until a PIN is set.** An install with no `Organization.operator_pin_hash` treats every caller as `OPERATOR`, which is exactly what every install did before #15. That is what lets this land without locking an operator out of their own event mid-season, and it is why the deferral's concern — nobody wants a login prompt on race morning — is met: the prompt exists only if they choose to set a PIN.

**One enforcement seam, not the two the design sketch proposed.** `RolePolicyExtension.resolve` checks `info.field_name` against `POLICY[role]` for any field whose parent is `Mutation`. The sketch's second layer (`allowed_operation_types` for `VIEWER`) is *not* here, for three measured reasons: `AsyncBaseHTTPView.execute_single` recomputes that set from the HTTP method, so overriding `execute_operation` — the seam the sketch names — misses the ordinary path; `VIEWER` holds an empty set so every mutation is refused anyway; and `resolve` fires on the **WebSocket** too, which closes the gap the sketch flagged (`graphql-ws` permits a mutation on the socket a subscription arrived on, and observation is almost all subscriptions).

Two traps, both recorded on #15 and both still true:

- **`on_execute` swallows the exception** — the mutation runs to completion and returns data. Use `resolve`. Any test here must assert the mutation was *refused* (the row is absent), never that the check ran.
- **There are two `OperationType` enums** with identical reprs and no overlap under `is`. Not relevant now that layer 1 is gone, but it is why it was tried.

**Adding a mutation means classifying it.** `test_auth_policy.py::test_every_mutation_is_classified` compares `CHECKIN_MUTATIONS | OPERATOR_ONLY_MUTATIONS` against the schema **in both directions** — a new mutation nobody bucketed is denied to *every* role including the operator, silently, so this turns that into a red build; and the reverse direction catches an entry outliving the mutation it named.

**The client's half is `api/pin.ts`** — the PIN lives in `localStorage`, per device, which is the point: the operator's laptop holds the operator PIN, the desk's tablet the check-in one, and a wall display holds nothing and stays a viewer. `UnlockButton` is in **both** navigation surfaces, because the header and the mobile drawer are different components and a phone at the desk only ever sees the second.

**Entering a PIN reloads the page.** Heavy-handed for four digits and deliberate: the socket carries the PIN in its URL, so a new PIN needs a new socket, and rebuilding the urql client and its normalized cache mid-session to avoid a reload is a great deal more machinery for something that happens once per device per event.

**The PIN travels in the `x-trustytrack-pin` header**, or as a `?pin=` query parameter on the WebSocket, which has no headers of its own. Not a cookie: same-origin, so CORS stays simple and `allow_credentials` is off — the old `allow_origins=["*"]` with `allow_credentials=True` was rejected by browsers outright, so it was broken *and* permissive.

**`/ws/timer/{track_id}` is operator-only**, and its check runs *before* the track lookup so an unauthenticated caller learns nothing — not whether the track exists, nor whether proxy mode is on. It is not GraphQL, so the role policy does not reach it, and it is the one path that could change who won without touching a mutation: on a proxied track that socket *is* the timer. Refusals close with **4403**; 4000 is anything about the track.

**Role resolution is lazy** (`auth.resolve_role`). It costs a query for the configured PINs, and only a mutation ever asks — an audience display resolves no role at all. `test_query_counts.py` caught the eager version.

**Absent and empty PINs mean different things** in `InitialConfigInput`. Absent is *leave alone*; empty is *clear*. The settings page re-submits the whole config on every save and cannot send back a PIN it is never given, so treating absent as "clear" would switch enforcement off whenever the operator renamed a track.

### The public demo

`backend/demo_mode.py` for the flag, `backend/api/demo_policy.py` for what a demo refuses. `TRUSTYTRACK_DEMO_MODE` is **off by default and read at call time**, like `TRUSTYTRACK_DEMO_SEED` — absent means an ordinary install, which is every install that exists.

The whole feature exists because two things are one click from ending a public instance. **`createInitialConfig` sets the operator PIN, and an install with no PIN treats every caller as `OPERATOR`** — so the first visitor to open System Settings owns the demo until somebody resets it. And `POST /upload/` wrote a permanent file from an unauthenticated request, which on a public URL is an anonymous image host and the route by which a real photograph of a real child arrives on a machine that exists to avoid holding one.

**A denylist, not an allowlist, and the asymmetry with `auth.py` is deliberate.** The role policy classifies every mutation and denies anything absent from the table, because an unclassified mutation should fail closed — `test_auth_policy.py` compares against the schema in **both** directions for that reason. Here the opposite is right: a new mutation is ordinary demo behaviour, and failing closed would mean every feature added after this file silently stops working on the demo with nothing to say so. So `test_demo_mode.py::test_every_refused_mutation_exists` checks **one** direction — a stale entry — and says so, because beside its neighbour it reads as an oversight.

**Extension order is load-bearing in two directions at once**, and it reads backwards — a later extension wraps an earlier one, so execution runs from the end of the list towards the front:

```python
schema = strawberry.Schema(
    ...,
    extensions=[RolePolicyExtension, DemoPolicyExtension, AuditExtension],
)
```

Before `AuditExtension`, so a demo refusal is recorded like any other (#219's rule, from the other side). After `RolePolicyExtension`, so it runs *first*: on a demo nobody sets a PIN, so every caller is `OPERATOR` and the role policy would have allowed the mutation and reported the wrong reason. `test_demo_mode.py::test_the_refusal_is_recorded` fails to a one-line swap.

**Deleting things stays allowed.** Destroying a race is part of what a visitor is there to try, and the reset undoes it. What is refused is the set that ends the demo for everybody else, or that puts something on the disk which should not be there.

**The four REST routes check for themselves** — upload, backup, restore and `/ws/timer/{track_id}` — because the schema extensions cover GraphQL mutations and none of these is one. Same reason the backup routes already make their own `_require_operator` call (#15).

**`POST /upload/` is guarded and capped in every mode, not only the demo.** At `CHECKIN` rather than `OPERATOR`, matching its GraphQL twin `uploadImage`: requiring the operator would make the REST route stricter than the mutation that does the same thing, and photographing a car is the desk's job. The body is read in chunks against `MAX_UPLOAD_BYTES` rather than read whole and measured afterwards — measuring afterwards happens once the thing being guarded against is already in memory. Note the route has **no callers**: the frontend sends data URLs through `uploadImage`. Whether it should exist is a separate question from whether it should be open, and only the second is settled.

**Tracks are coerced to `TimerType.FAKE` when the managers are built.** Belt and braces — the mutations that could change a timer type are refused — but a seed archive carries whatever type it was built with, and an `AUTO_DETECT_BACKEND` track sends `autodetect()` walking the USB serial ports. A track that cannot be reconfigured should not be probed either.

**The demo builds its own event on first boot** (`backend/demo_content.py`, called from the lifespan). It opens on a raced preliminary round, standings drawn from it, a final whose field filled itself through the advancement cascade — and **a heat still left to run**, which is the one an all-raced demo loses: a visitor should be able to *do* something, not only read what already happened. Each of those three is pinned by a test that fails to a one-line change.

**Seeded from code, not from a baked-in archive.** The plan chose an archive so that reset could reuse `restore_archive`'s teardown; at boot there is nothing to tear down — that teardown exists because a restore replaces a *running* event. A committed binary would also be regenerated by hand and stale by default, where code is always at the current schema. The reset half is the other side of that: on Cloud Run scale-to-zero *is* the reset, and an always-on host would need a timer instead ([#297](https://github.com/dknowles2/trusty-track/issues/297)).

**`is_seeded` asks whether an `Organization` exists**, which is the question the first-run gate asks, so there is no marker column — #201 declined one for the practice race for the same reason. The consequence is deliberate: a demo container that somehow starts against a database holding somebody's real event seeds nothing on top of it.

**A migration failure stops a demo and not an install.** `init_db()` raising has always been logged and stepped over, which is right for an operator — they can read the log and the app is still there. The demo has nobody to read it and ephemeral storage, so carrying on means serving an empty or half-migrated database to every visitor with nothing to say so.

**The demo lets go of its socket when nobody is using it.** Rules in `frontend/src/api/demoSession.ts`, wiring in `features/core/components/DemoSessionGate.tsx` — `raceFlow.ts`'s split, for its reason. The host bills instance-time rather than request-time, so cost does not scale with viewers; the whole risk is **one visitor who leaves a tab open**, because a subscription socket in flight is an instance that never scales to zero.

**It latches, and does not disable any of `liveConnection.ts`.** That module is built to *never* stay disconnected — retry forever, ping an idle socket, close a half-open one so the retry path notices — and all three are right for a gym on race day and exactly wrong for scaling to zero. So the demo *disposes* the `graphql-ws` client, which is the one thing that policy cannot come back from, and the phases are one-way: reviving on a mouse move would leave a subscription-driven page silently receiving nothing, which is the failure `pingWatchdog` exists to prevent, reintroduced by the thing meant to save money. **Resuming is a page reload**, following the PIN's precedent (#15).

**The cap is checked before idleness**, or a visitor who keeps clicking holds a session open forever — which is the case the cap exists for. **The gate polls rather than arming a timer for the deadline**: a laptop that sleeps with the tab open does not fire a pending `setTimeout` on schedule, and waking to find the demo still connected is what this prevents.

**`initialConfig.demoMode` is how the page finds out**, reported on the unconfigured branch too — a first-run wizard is the one screen that must not be idled out from under somebody halfway through it.

**The image honours `$PORT`, and the `CMD` is shell form for it.** Cloud Run and Railway tell a container which port to listen on, and one that ignores it is marked unhealthy and killed; `${PORT:-8000}` keeps every documented `docker run -p 8000:8000` working. **Keep the `exec`** — without it `sh` stays PID 1, uvicorn is its child, and the SIGTERM a platform sends to stop the container never reaches the server, so every shutdown is a ten-second wait and then a kill.

**`deploy/cloudrun/deploy.sh` is the deployment, and its flags are the documentation.** `--max-instances=1` is both a hard cost ceiling and free correctness — the pub/sub singleton and the `TIMER_MANAGERS` dict need one instance, and WebSockets then need no session affinity. `--min-instances=0` lets the instance die, which is the reset. **Never set "CPU always allocated"**: it bills continuously and deletes the entire advantage. Don't grow this into a deployment framework — the portability comes from having no durable state and calling no platform APIs, not from a layer over four of them. `VOLUME ["/data"]` is deliberately left in the Dockerfile: ignored on the target, and the demo points `TRUSTYTRACK_DATA_DIR` at `/tmp` instead, so removing it would only change what a real Docker operator gets.

**A deploy moves traffic only while the service still points at LATEST, so the script says it out loud.** `gcloud run deploy` creates a revision and routes to it — unless the service's traffic names a specific revision, which is exactly what `update-traffic --to-revisions` leaves behind and is how a rollback is spelled. A pinned service keeps serving the pinned revision and the deploy reports success anyway. This demo sat pinned to a revision from 2026-08-25 across four releases: each built a healthy revision that reached nobody, while the front page's demo ran a build old enough to predate the version stamp (`/health` answering `0.0.0-dev-unknown` is the tell). `deploy.sh` follows every deploy with an explicit `update-traffic --to-latest`.

**The demo's health check asserts the version, not just a 200** (`deploy-demo.yml`). The pin above is invisible to a liveness check — the old revision answers `/health` perfectly — so the poll compares the version `/health` reports against the tag being deployed, and fails the job when they differ. It asserts only for a plain `X.Y.Z` tag and says so otherwise, since the workflow is also run by hand with a digest or a floating tag, where there is nothing to compare against.

**Releasing a stable version pushes it to the demo** (`.github/workflows/deploy-demo.yml`, called by `release.yml`'s `deploy-demo` job). Four rules, each of which is a way of getting it wrong:

- **It deploys the image the release just published, and never builds one.** The demo is then byte-for-byte what the release page hands out, and the workflow needs no Cloud Build permissions — the `IMAGE=…` arm of `deploy.sh`, which is why that arm exists.
- **It calls `deploy.sh` rather than repeating its flags.** Those flags are the description of what the demo *is* (`--max-instances=1` for the in-process pub/sub, `--min-instances=0` so the instance dying is the reset), and a second copy in a workflow would be free to disagree with the script the maintainer runs by hand.
- **Configuration is repository *variables*, not secrets**, and the reason is mechanical as well as tidy: `secrets` is not readable from a job-level `if` and `vars` is, so `if: vars.DEMO_CLOUD_RUN_PROJECT != ''` lets a fork — or this repository before anybody wired up a project — skip the job rather than fail a release. Keyless auth (Workload Identity Federation) is what makes that possible, since there is then no key that had to be a secret. `docs/demo.md` lists the variables.
- **The release does not wait on it.** `create-release` needs `[docker, macos-dmg, windows-exe]` and deliberately not this: a Cloud Run outage must not hold up the installers or the release page. Pre-releases are skipped for the same reason they do not claim `latest` — `docker`'s `stable` output is the gate.

**It is served at `demo.trusty-track.com`**, a Cloud Run domain mapping rather than a load balancer — a global external ALB would do the same job and bill for its forwarding rule whether anybody visits or not, which deletes the scale-to-zero property the whole design rests on. The CNAME to `ghs.googlehosted.com` is **DNS-only in Cloudflare, deliberately**: proxying it intercepts the challenge Google's managed certificate provisions against, hands Cloud Run a `Host` header the proxy is free to rewrite, and puts Cloudflare's 100-second idle cap on WebSockets that the app expects to hold open for the `--timeout=900` the service is deployed with. `TRUSTYTRACK_ALLOWED_ORIGINS` takes a comma-separated list so the `run.app` address can keep working while a domain settles — and that comma is why `deploy.sh` passes `--set-env-vars` with gcloud's `^|^` delimiter syntax, since the default splits on commas to find the next *variable* and reads a list-valued one as a key with no value.

`/health` is polled after the deploy, and that is not decoration: Cloud Run calls a revision healthy as soon as the container answers on `$PORT`, which happens before seeding has finished — and with `--min-instances=0` there is nothing running to ask until somebody asks, so the check doubles as the cold start.

**Cold start was measured, not optimised.** The plan assumed several seconds; it is about 0.7 — 0.41 s of Python import, 0.15 s for all 24 migrations on a fresh database, 0.13 s to seed (an M-series Mac, warm caches). An at-head `alembic upgrade` costs nothing measurable and `pillow_heif` is 7 ms of the import, so all four proposed cuts — skipping the at-head migration, baking a seeded database into the image, lazy-importing `pillow_heif`, and a startup CPU boost — were worthless or invisible. Re-measure before reviving any of them.

**`TRUSTYTRACK_ALLOWED_ORIGINS` narrows CORS**, defaulting to today's `*`. The wildcard's justification is a LAN — a display or a phone on venue wifi loads the page from this origin, and the PIN is what the server checks. On a public origin it does not hold: `VIEWER` is the no-credential default and a viewer can read a roster.

### The activity log

`backend/domain/audit.py` for the vocabulary, `models.AuditEntry` for the row, and two seams that write it ([#219](https://github.com/dknowles2/trusty-track/issues/219)). The database held the current state and no record of how it got there, so "who deleted that round" had no answer but whoever happened to be watching.

**Two seams, because one is not enough.** `AuditExtension` records every mutation at the same hook `RolePolicyExtension` uses. That alone would miss the results, which is the thing a dispute is actually about: `TimerManager` calls `crud.record_heat_result` through its own session outside any request (#9), so a mutation-only log records every *correction* to a time and never the time it corrected. `record_heat_result` and `update_free_race_heat_result` therefore take a **required keyword-only `source`**, and record the entry themselves — #48's lesson, that a rule depending on each caller remembering reaches only some of them.

**Extension order is load-bearing and reads backwards.** A *later* extension wraps an earlier one, so `AuditExtension` is listed **after** `RolePolicyExtension` in order to catch the `PermissionDeniedError` and record a refusal — which is the most interesting line the log holds. Listed first it records no refusals at all. Measured, not assumed; the first draft had them the other way round. `test_audit_log.py::TestRefusals` fails if they are swapped.

**Redaction is three defences, not a list.** `createInitialConfig` carries both PINs in plaintext, so this is the one part of the feature where being wrong writes a credential into a readable table. Names are matched as *fragments* on a normalised form, because a denylist that spelled `data_url` let `dataUrl` straight through — found by smoke-testing `redact`, not by reading it. Then the value is checked regardless of its name, and anything past `DROP_STRING_OVER` is dropped rather than shortened. Nested inputs are flattened one level, and every leaf goes through the same checks: `createInitialConfig` hides its PINs *inside* `config`, so a flattener trusting the outer name would undo the whole module.

**An entry is self-contained.** `describe` renders the sentence from the entry alone and never looks an id back up. That is the opposite of the standings, awards and recipients — all computed on demand so they cannot disagree with the race — and right for the opposite reason: an audit entry is a claim about a moment that has passed, and one that changed its story as the data moved would be a second view of the present.

**`race_id` is a plain integer, not a foreign key.** The one place the schema declines a cascade (#125): deleting a race must not take the record of what was done to it.

**A query, not a subscription.** Half the entries are written from `crud`, and publishing from there would mean `db` importing the api layer's pub/sub. The page refetches instead.

**The query guards itself.** `RolePolicyExtension` covers mutations only, so `auditLog` calls `_require_operator_role` — the same gap `/api/backup` and `/ws/timer/{track_id}` each close for themselves. `sourceIp` is a separate field so a screen can decline to ask, and the page does not show it by default.

**One insert per mutation, and `test_query_counts.py` measures it.** `record_audit` returns a value object rather than the ORM row: `db.commit()` expires the instance, so handing the row back made reading any field a second SELECT.

### Locking a race

`Race.is_locked`, enforced by `backend/api/race_lock.py`'s `RaceLockExtension` ([#585](https://github.com/dknowles2/trusty-track/issues/585)). An event concludes and the machine sits at the venue, or comes home to a shelf until next year — a shared laptop a curious sibling can reach, or an operator's own muscle memory reopening the wrong race weeks later. This is a guard against an accidental edit to a record that is otherwise done, not a permission system for a person with something to hide.

**A third schema extension, on the model `DemoPolicyExtension` already set.** A denylist rather than an allowlist, and for the same reason theirs is: enumerated so it reads next to the thing it protects, and checked against the schema in **one direction only** — a mutation `race_lock` has not heard of yet is ordinary behaviour on a locked race, and failing closed would mean every mutation added after this file silently stops working the moment a race is locked, with nothing to say so. `test_race_lock.py::test_every_locked_mutation_exists` is that one-direction check; contrast with `test_auth_policy.py`'s two-direction one, which is right for a table where an unclassified mutation should be refused to everyone.

**One resolver per argument shape, not one per mutation.** A locked race has to refuse a heat result, a racer edit, a round regeneration, a check-in — mutations that name a `raceId` directly (`createRacingGroup`, `createAward`, `createRound`…), a `heatId` (`updateHeatResult`, `prepareHeat`, `deleteHeat`…), a `roundId` (`regenerateRound`, `deleteRound`), a bare `id` meaning a racer, a racing group, or an award depending on which mutation it is, a `racerIds` list (the bulk roster actions), or a nested input object carrying its own `raceId`/`racerId` (`createRacer`, `bulkAssignPhotos`, `reorderHeats`). `LOCKED_MUTATION_RESOLVERS` maps each mutation name to the one function that knows its shape, several mutations sharing a function where the shape is identical. Resolving up to the race costs one query in the worst case (a heat's own `race_id`, a round's own `race_id`) — cheap next to what it protects, and the same trade `_race_id_from` in `api/auth.py` already makes for the audit log, just carried one step further since this module actually has to *find* the id rather than only reading one already named `raceId`.

**A mutation argument can arrive two ways, and this module cannot assume either.** An inline GraphQL literal argument reaches a resolver's own `**kwargs` as the input's dataclass instance; one supplied through `variables` — every test here, and every real client, since `urql`'s `gql` documents always use variables — arrives as a plain `dict` with **camelCase** keys instead (`heatId`, not `heat_id`). `_arg`/`_fields_of` check both shapes, mirroring `domain.audit._fields_of`'s own dict-or-dataclass branch; a single-word argument (`id`, `race`, `racer`) is unaffected either way, which is why this was easy to miss until a multi-word one (`heatId`, `roundId`, `racerIds`) was actually tested against real `variables`.

**`updateRace` and `deleteRace` are handled directly, not through the resolver table.** `deleteRace` stays reachable on a locked race — the issue's own requirement — and is never in the denylist at all; the frontend's own safeguard is typing the race's name into the confirmation, not a second server-side gate, since the operator PIN is already the credential that matters here. `updateRace` is refused unless the payload would change **nothing but `isLocked`**.

**That comparison is against the race's own current stored values, not against each field's schema default, and getting this backwards was a real bug caught before it shipped.** `RaceForm` is the operator's own way to unlock a race, and `RaceDetails.handleUpdateRace` — the only caller that matters — resends the *whole* race on every save, not a diff: `name`, `trackId`, `scoringStrategy`, every field, all non-null and unchanged, alongside `isLocked: false`. A first draft of `is_lock_only_update` treated any non-null field (other than the three explicit clear flags) as "touching" the race, which is correct for the *schema's* notion of absent-means-leave-alone but refused the unlock checkbox's own save outright — the payload it produces is indistinguishable, by that rule, from a rename smuggled in alongside the unlock. `is_lock_only_update(race, race_update)` takes the current `Race` row and asks whether applying the payload would actually move any field: `getattr(race, name) != value`, field by field, with the three clear flags translated to "does this flag's target column already hold `None`" first. A `str` `Enum` column compares equal to its own value as a plain string (`ScoringStrategy.TIMED == "TIMED"`), so no unwrapping is needed there. `test_race_lock.py::test_unlocking_works_when_the_form_resends_every_field_unchanged` is the regression test, built from exactly the shape `RaceForm` actually sends; `test_a_field_genuinely_changed_alongside_a_full_resend_is_still_refused` is its twin, proving the comparison still catches a real change hiding in the same full payload.

**Allowed while locked, and each is a deliberate exception:**

| Stays reachable | Why |
| --- | --- |
| Every read (a query or a subscription) | `resolve` only looks at fields whose parent is `Mutation` |
| `deleteRace` | The issue's own requirement — see above |
| `updateRace`, payload touching only `isLocked` | The operator's own way back out |
| `assignDisplay`, `advanceDisplay`, `identifyDisplay`, `renameDisplay`, `forgetDisplay` | About which screen shows what, not the race's own record |
| `castVote` | Gated by its own `Race.votingOpen` switch (#305) already; a second opinion here would be a rule with two homes |
| `createTrack`/`updateTrack`/`deleteTrack`, `setLaneOutages`, the historical track record mutations, `reconnectTimer`/`abortHeat`/`forceResults`/`startTimerTest`/`releaseStartGate`/`resetTimer` | A track is shared, global state — it can be running a second, unlocked race at the same venue, and disarming its timer over a *different* race's lock would break that race for no reason |
| `createInitialConfig`, `updateInitialConfig`, `uploadImage`, `createPracticeRace`, `createRace` | None names an existing race in its arguments, so there is nothing here to resolve a lock against |

**Extension order is load-bearing and reads backwards, same as its two neighbours — and `RaceLockExtension` sits at the far end from `AuditExtension`, innermost of all four:**

```python
extensions = [
    RaceLockExtension,
    RolePolicyExtension,
    DemoPolicyExtension,
    AuditExtension,
]
```

A *later* extension wraps an earlier one and so runs its own check *first*. `RaceLockExtension` is listed **before** `RolePolicyExtension` — to its left, the more deeply nested position — specifically so the role policy's own check runs first: a `VIEWER` attempting `updateHeatResult` on a locked race should be told their role cannot do that, not that the race happens to be locked; the lock check never runs unless the role policy has already let the mutation through. `test_race_lock.py::test_the_role_policy_is_asked_before_the_lock` is the test that fails to a one-line reordering, the same shape as `test_audit_log.py::TestRefusals` for the two extensions on the other end. Still inside `AuditExtension`'s wrap regardless of exactly where between it and the role policy it sits, so a lock refusal is recorded exactly like any other (#219).

**The frontend does not gate deletion by name server-side.** The issue asks that deleting a locked race require typing the race's name into the confirmation — a pure client-side rule (`features/management/deleteConfirmation.ts`), not a second credential: the operator PIN is what actually protects `deleteRace`, and a name-match check the server enforced would just be a worse copy of that.
