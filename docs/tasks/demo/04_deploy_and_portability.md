# Demo Stage 4: Deploy and Portability [COMPLETED]

> **Built**, as far as this repository can be: `deploy/cloudrun/deploy.sh`
> carries the flags, the Dockerfile honours `$PORT`, and `docs/demo.md` is the
> page. Actually creating the Cloud Run service needs a Google account and is
> not something a commit can do.
>
> **Three departures, recorded rather than silently taken:**
>
> * **`VOLUME ["/data"]` is left alone.** This file suggested reconsidering it.
>   It is ignored by Cloud Run, and `TRUSTYTRACK_DATA_DIR=/tmp/trustytrack` in
>   the deploy script sidesteps it entirely — so removing it would be a
>   behaviour change for real Docker operators (an anonymous volume they
>   currently get by forgetting `-v`) in exchange for nothing on the target.
> * **No "try the demo" line in `README.md` or `docs/index.md` yet.** There is
>   no URL. A pointer to a demo that does not exist is worse than no pointer,
>   so that line lands with the deployment.
> * **A shell script, not a `service.yaml`.** There is one deployment and the
>   flags are the documentation. A Knative manifest would carry a
>   project-specific image reference and rot between deployments.
>
> **Verified by running it, not by reading it.** The Docker daemon was not
> available locally, so the image itself was not run here — CI's Docker Build
> job does that — but the exact command line the Dockerfile now uses was run
> with `PORT` set, demo mode on and a narrowed origin. It listened on `$PORT`,
> seeded itself, reported `demoMode: true`, refused `createPracticeRace`,
> `POST /upload/` and `GET /api/backup` with 403, echoed the permitted origin
> and sent no `Access-Control-Allow-Origin` at all for another.
>
> One number worth having: **a seeded demo writes about 10 MB** — 24
> photographs copied out of `backend/assets/defaults/`, which the image carries
> anyway. On Cloud Run that lands in tmpfs and counts against the memory limit,
> so 512 MiB is comfortable rather than tight.

Configuration, plus two small changes to the image that decide whether moving
host later costs an hour or a week.

---

## Target: Cloud Run

Chosen for the free tier, on a hobby budget, and because stages 2 and 3 remove
the two things it cannot do (persistent storage and background work between
requests).

| Setting | Value | Why |
| --- | --- | --- |
| `min-instances` | 0 | The whole point. Idle costs nothing |
| `max-instances` | 1 | A hard cost ceiling, and free correctness: the `pubsub` singleton and the `TIMER_MANAGERS` registry are guaranteed colocated, and WebSockets need no session affinity |
| CPU allocation | during requests only | "Always allocated" bills continuously and deletes the entire advantage |
| Request timeout | 10–15 min | Well below the 60-minute maximum. Bounds a single socket; stage 3's idle disconnect is what bounds the *instance* |
| Memory | 512 MiB | Fits; memory is not the binding constraint |
| Startup CPU boost | on | Cold start, see stage 3 |

Add a billing budget alert as the backstop. `max-instances=1` bounds the worst
case at one instance running continuously — order of $60/month at 1 vCPU
(approximate; check current pricing) — and stage 3 is what makes the realistic
figure nothing.

### The free tier, roughly

About 180,000 vCPU-seconds and 360,000 GiB-seconds per month, of which vCPU
binds first: **around 50 instance-hours free at 1 vCPU**, more with fractional
CPU. For a demo with visitors staying five or ten minutes, that is hundreds of
sessions. Verify the current figures before relying on them.

---

## Two changes that make a move cheap

**`CMD` hardcodes `--port 8000`.** Cloud Run and Railway inject `$PORT`. Read
`${PORT:-8000}`. One line, and it is the difference between deploying anywhere
and deploying on some of them.

**`VOLUME ["/data"]` in the Dockerfile.** Ignored by Cloud Run and creates
anonymous volumes under plain `docker run`. Harmless, but pointless for a
stateless demo. `TRUSTYTRACK_DATA_DIR` already overrides the path, so the demo
can point elsewhere; consider whether the `VOLUME` line earns its place at all.

> **Left alone.** See the header: the demo points its data directory at `/tmp`
> instead, so the line costs the demo nothing, and removing it changes what a
> real Docker operator gets today.

Everything else is already portable: config through environment variables, a
`/health` probe that CI exercises, logging to stdout, and no managed-service
dependency.

---

## Fallbacks, reachable from the same image

| Host | Cost | Trade |
| --- | --- | --- |
| **Fly.io** | ~$2–4/mo always-on | No cold start, free wildcard TLS, WebSockets native. Needs stage 2's in-process reset timer |
| **Hetzner** | ~€4/mo | Sensible if a box already exists. Self-managed uptime and patching |
| **Railway** | ~$5–7/mo | Simplest deploy, highest floor |

Moving means: build the same image, write ten lines of provider configuration,
point DNS. Nothing in the application changes.

**Do not build a hosting abstraction.** The portability comes from having no
durable state and calling no platform APIs. A layer wrapping four providers
would be more code than the thing it wraps, and there would still be
per-provider configuration to write.

---

## Documentation

A public demo is a feature worth a reader's attention, so per the rules in
`CLAUDE.md` it needs:

- a line in `README.md` and `docs/index.md`;
- a short note saying what the demo does *not* do — no uploads, no real timer,
  resets periodically, nothing kept — so that a visitor does not report the
  refusals as bugs;
- a privacy line stating that nothing entered is retained.

No new nav group. A new page goes inside an existing group; the tab row is at
seven and adding beside them is how it reached fifteen and started scrolling.

---

## Done when

- The demo URL serves a populated race from a cold start. ⏳ needs the
  deployment; the same stack was verified locally on `$PORT`.
- An idle instance reaches zero and the next visit boots clean. ⏳ same.
- A budget alert exists. ⏳ needs the Google account. The deploy script prints
  a reminder rather than pretending it can set one.
- The same image runs unchanged on a second host, verified once rather than
  assumed. ⏳ needs a second host.

Everything a commit can do is done. What is left needs an account and a card,
and none of it is code.
