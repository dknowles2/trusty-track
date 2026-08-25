# Demo Stage 5: A Private Demo Per Visitor

> **Not built.** Stages 1 to 4 built one shared, public demo. This proposes a
> second front door beside it: a landing page that provisions a private,
> disposable instance for one visitor.

## Why, beyond the obvious

The obvious reason is collisions — one stranger deleting a race while another
is reading it. That is real but may be rare: this is a niche app and concurrent
visitors are not guaranteed. **It is not the strongest argument, and it should
not be the one this is built on.**

The stronger argument is that **the shared demo cannot show most of the app.**
Stage 1's denylist exists entirely because one visitor can spoil it for
everyone. Give each visitor their own instance and almost all of it lifts:

| Refused today | Because | With isolation |
| --- | --- | --- |
| `createInitialConfig`, `updateInitialConfig` | a visitor could set a PIN and lock the demo | allow — it is their instance |
| `populateRace`, `createPracticeRace`, `importRacers` | bulk rows on a shared instance | allow |
| `uploadImage`, `POST /upload/` | anonymous writes to a shared disk | allow, with caps — see below |
| `GET /api/backup`, restore | amplification, and replacing everyone's event | allow |

Two of those are the demo's biggest gaps:

- **The first-run wizard is currently undemoable.** The shared demo arrives
  seeded and `createInitialConfig` is refused, so the one screen a nervous
  volunteer most wants to see — *what happens when I first open this?* — is the
  one screen they cannot reach. "Start from scratch" fixes exactly that.
- **Check-in with photographs is currently undemoable**, and it is the flow
  that most needs seeing rather than describing.

There is a third possibility worth noting and not building yet: with the timer
WebSocket allowed, a visitor could point `/timer-check` at their own hardware
over the browser proxy and find out whether their Micro Wizard works — without
installing anything. That is a genuinely useful thing to offer a pack, and it
is a separate piece of work.

---

## The platform question, measured

An earlier draft of this argued for Fly Machines on the grounds that
`gcloud run deploy` takes 30–60 seconds and Cloud Run's 1000-services-per-region
quota would bite. **Both were wrong**, and the numbers are recorded here so
nobody re-derives them:

| | |
| --- | --- |
| `gcloud run deploy`, new service — command returns | **18 s** |
| new service — URL actually serves | **41 s** |
| `gcloud run services delete` | **4 s** |
| **tagged revision on an existing service — serving** | **17 s** |

Measured on the real project, us-central1, from an already-built image.

Two things that matters:

- **The number gcloud prints is not the number a visitor waits.** A sync deploy
  reports done at 18 s while the brand-new service URL does not resolve for
  another twenty-odd. Anything timing this must curl the URL, not trust the
  CLI.
- **A tagged revision is 2.4× faster to usable than a new service**, because
  its hostname is a subdomain of a service URL that has already propagated:

  ```
  gcloud run deploy <service> --image=... --no-traffic --tag=abc123
    → https://abc123---<service>-<hash>-uc.a.run.app
  ```

  Its own container, its own environment, its own SQLite file. Verified against
  the live demo: the tagged instance served its own seeded race and the public
  demo was untouched.

The quota objection was also wrong. 1000 services per region, against a handful
of concurrent visitors and a four-second delete, is not a constraint.

**So this stays on Cloud Run.** No second provider, no second account, no
Machines API. Seventeen seconds behind a captcha that takes three to ten
seconds to solve is mostly hidden.

---

## Shape

```
 landing page (static)  ──captcha──>  provisioner (Cloud Run, scales to zero)
                                            │
                                            │  deploy --no-traffic --tag=<id>
                                            ▼
                              trusty-track-sessions  ── one revision per visitor
                                            ▲
   visitor redirected to  https://<id>---trusty-track-sessions-….run.app
```

- **Static landing page.** First impression, so it must not wait on a cold
  start. Two buttons: *Start from scratch* and *Pre-seed a race*, which is only
  `TRUSTYTRACK_DEMO_MODE` with and without the seeding step.
- **Provisioner**, a small Cloud Run service that verifies the captcha and
  creates the tagged revision. Scales to zero; its own cold start overlaps the
  captcha.
- **A reaper**, on a schedule, deleting revisions past their lifetime.

### Four constraints, each learned by hitting it

- **`--max-instances=1` is per revision, not per service.** Today it is a hard
  cost ceiling; with N private demos it is N ceilings. **The concurrency cap
  has to move into the provisioner** — a count of live revisions, and a polite
  "the demo is busy, try the shared one" past it. Without that, this is the one
  change in the whole area that can produce a surprising bill.
- **The most recently created revision cannot be deleted.** Cloud Run refuses
  with `FAILED_PRECONDITION`. The reaper needs a parking revision or a
  guaranteed newer successor, or it will always strand one.
- **Sessions get their own service.** Tagged revisions were tested against the
  live demo service and `--no-traffic` held — but one forgotten flag would swap
  the public demo for somebody's private one. A separate service makes that
  mistake impossible rather than merely avoided.
- **The provisioner holds a credential that can deploy.** Scope its service
  account to the sessions service alone. It is the most dangerous thing this
  design introduces and it does not need to be broad.

---

## Decisions

**Thirty minutes, not ten.** A real evaluation means generating a schedule,
running heats on the fake timer, watching standings fill and advancing a
championship round. Ten minutes does not cover that, and a hard kill mid-run
teaches an evaluator the app is flaky rather than that the demo expired. The
existing idle disconnect (five minutes) is what actually reclaims capacity;
the wall-clock cap is a backstop, and it should offer *keep going* rather than
a guillotine.

**Uploads are allowed, with caps.** The abuse case is somebody using it as an
anonymous file host — but the file is served from an instance that dies in
thirty minutes, which removes most of the value of doing so. Keep the 16 MB
cap, add a per-instance count, and keep the captcha in front. If that turns out
to be wrong, refusing uploads again is a one-line change to the denylist.

**Cloudflare Turnstile rather than reCAPTCHA.** Free, and it does not build an
advertising profile of a parent who wanted to look at a pinewood derby app —
which is the same instinct as the docs' rule about declining non-essential
cookies.

**The shared demo stays.** It is the zero-click front door and it costs
nothing; this is the "try it properly" path behind one click. Two front doors
is not duplication — a visitor who wants a thirty-second look should not have
to solve a captcha.

**Naming: this is a *private demo*, not a "session".** `demoSession.ts` already
means the idle-disconnect rules on the client, and reusing the word for a
provisioned instance would make every future sentence ambiguous.

---

## Staging

1. **The provisioner, no landing page.** An endpoint that takes a mode and
   returns a URL, with the concurrency cap and the reaper. Testable with
   `curl`, and it is where all four constraints above live.
2. **The landing page and captcha.** Static, two buttons.
3. **Relax the denylist under a second flag.** `TRUSTYTRACK_DEMO_MODE` stays as
   it is for the shared demo; a private demo sets something like
   `TRUSTYTRACK_DEMO_PRIVATE=1` which allows the config, populate, import,
   upload and backup mutations. **Two flags rather than a level**, because the
   shared demo's refusals must not weaken by accident when this ships.
4. **Start from scratch.** Skip seeding, which is a branch in the lifespan that
   already exists.

Stage 1 is the whole risk. Stages 2 to 4 are small.

---

## Open questions

- **Is the collision real?** Worth a month of logs on the shared demo before
  building any of this, if collisions are the motivation. If the motivation is
  showing the first-run wizard and photo check-in, the logs do not matter.
- **What does the reaper cost to run?** A scheduled Cloud Run job is a few
  cents a month, but it is another moving part with its own credential.
- **Does the version string matter?** The shared demo reports
  `0.0.0-dev-unknown` because the build carries no git metadata. On a private
  demo an evaluator may well look.

---

## Done when

- A visitor clicks through a captcha and lands on a working, private instance
  in under twenty seconds.
- Both modes work: seeded, and genuinely empty at the first-run wizard.
- A private demo can do everything the shared one refuses, and the shared demo
  still refuses all of it.
- The concurrency cap holds under a deliberate flood, and the reaper leaves no
  orphans across a week.
- Nothing about the shared demo changed.
