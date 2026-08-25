# Demo Stage 5: A Private Demo Per Visitor

> **Not built.** Stages 1 to 4 built one shared, public demo. This proposes a
> second front door beside it: a landing page that provisions a private,
> disposable instance for one visitor.
>
> **Revised once already, before anything was built.** The first draft
> reasoned from evaluation comfort and got three things wrong — thirty
> minutes with a *keep going* button, and lifting the refusals on export
> and bulk import. All three made it easier for a pack to run a real event
> on a demo, which is a worse outcome than having no demo at all. See
> "Never load-bearing". The shared demo already had this right and needed
> no change.

## Why, beyond the obvious

The obvious reason is collisions — one stranger deleting a race while another
is reading it. That is real but may be rare: this is a niche app and concurrent
visitors are not guaranteed. **It is not the strongest argument, and it should
not be the one this is built on.**

The stronger argument is that **the shared demo cannot show most of the app.**
Stage 1's denylist exists entirely because one visitor can spoil it for
everyone. Give each visitor their own instance and almost all of it lifts:

**Show the app; do not move data.** That is the rule, and it is sharper than
"isolation lifts the denylist" — which was this file's first answer and was
wrong in two places. A refusal that only existed to stop one visitor spoiling
it for another can go. A refusal that stops the demo becoming a *tool* must
stay, however private the instance is. See "Never load-bearing" below.

| Refused today | Because | With isolation |
| --- | --- | --- |
| `createInitialConfig`, `updateInitialConfig` | a visitor could set a PIN and lock the demo | **allow** — it is their instance, and it is the only way to show the first-run wizard |
| `populateRace`, `createPracticeRace` | bulk rows on a shared instance | **allow** — and they are what remove any reason to type in real children |
| `uploadImage`, `POST /upload/` | anonymous writes to a shared disk | **allow**, with caps |
| `importRacers` | bulk rows on a shared instance | **still refused** — importing a real roster is the first step of using this for real |
| `GET /api/backup`, restore | amplification, and replacing everyone's event | **still refused** — an export is what would make work done here worth doing |

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

## Never load-bearing

The risk this whole design has to be steered away from: **a pack decides the
demo is good enough to run their actual event on.**

That would be worse than having no demo. The instance is ephemeral by
construction — it dies on a restart, on scale-to-zero, on a redeploy — so a
pack that trusted it would lose their roster with a queue of children at the
weigh-in table. And this project would be holding real names, real ages and
real photographs, which is precisely what stages 1 to 4 were built to avoid.

A time limit alone does not prevent it. What prevents it is that **nothing
built on a demo can be carried out of it**:

- **no export.** `GET /api/backup` stays refused. This is the load-bearing
  refusal, and the one an earlier draft of this file got wrong: with a download,
  a pack could reasonably build a roster here and restore it at home, and doing
  real work on a demo would start making sense to them.
- **no bulk import.** `importRacers` stays refused, for the mirror reason —
  it is the first move of somebody setting up for real.
- **a roster that is invented, not typed.** `populateRace` fills the race in a
  click, so there is never a reason to enter a real child. Consider capping it
  well below a real pack's size, so entering one by hand is visibly not the
  intent.
- **it says so, everywhere, including on the projector.** A persistent
  watermark — *Demo. Everything here is deleted within 20 minutes* — on the
  ordinary chrome **and on the full-screen observation and ceremony views**,
  which is where it matters most: those are the audience-facing screens, so a
  pack that tried this on race day would be announcing it to the room. Cheap,
  and a stronger deterrent than any timeout.

The honest summary for the landing page is short: *this is for looking at, not
for running your derby on. When you are ready, install it — it is free and it
runs on a laptop.*

---

## What a private demo is called

The generated Cloud Run hostname, with the tag chosen to make it read like
something rather than nothing:

```
https://<tag>---<service>-<hash>-<region>.a.run.app
  e.g.  https://brave-wolf-7f3k---trusty-track-sessions-svsqmrsaba-uc.a.run.app
```

**Custom subdomains are not worth it.** `brave-wolf.demo.trusty-track.com`
would be nicer, but a Cloud Run domain mapping is one per hostname and each
provisions its own certificate — minutes at best — which cannot be reconciled
with seventeen-second provisioning. A wildcard needs a load balancer and a
wildcard certificate, roughly $18 a month, which would cost more than
everything else in this area put together. Nobody types these URLs anyway: they
click through from the landing page, which can show *your demo: brave-wolf* as
the label whatever the address bar says.

**The budget is about 25 characters.** The whole thing is one DNS label capped
at 63; measured against the live service, `trusty-track-sessions` plus the hash
and region leaves roughly that much for the tag. Two words and a suffix fit
comfortably.

### The scheme, and why the suffix is not decoration

Two words from small fixed lists — the Scout Law, and the Cub ranks — plus
random characters:

```
brave-wolf-7f3k
```

**The random part is doing security work.** Twelve Scout Law words against five
usable ranks is sixty combinations; with a handful of live instances, guessing
somebody else's demo URL is trivial, and *private* is the whole premise of this
stage. Four base32 characters is about a million, which makes it hopeless while
leaving the readable half readable.

**It must come from `secrets`, never from `demo_seed`.** That module exists to
make invented data *repeatable*, which is exactly wrong here: a repeatable
suffix is a predictable URL. Reaching for the helper that is already there is
the obvious mistake and would quietly undo the paragraph above.

### Three things that are easy to get wrong

- **Do not reuse `models.Rank` for the word list.** The vocabulary is already
  there and it is tempting, but `ARROW_OF_LIGHT` does not slug well and `OTHER`
  means nothing. A small dedicated list is clearer and does not shift if the
  enum ever changes.
- **Tags need freeing, not just revisions.** A tag holds its name until it is
  removed, so the reaper has to drop the tag *and* the revision or names burn
  one per session. The provisioner should retry on collision rather than assume
  uniqueness.
- **The tag is public, in a hostname.** Nothing meaningful goes in it — no
  visitor identifier, no hashed address, nothing that would matter if logged by
  whatever sits between the visitor and Google.

---

## Decisions

**Twenty minutes, hard, and no way to extend it.** An earlier draft of this
file said thirty with a *keep going* button, argued from evaluation comfort.
That is the wrong thing to optimise, because the two failure modes are not
symmetric:

- **too short** — an evaluator is mildly annoyed, reloads, and carries on;
- **too long, or too comfortable** — a pack tries to run a real event on it and
  loses their race day, and this project ends up holding real children's names
  and photographs, which is the exact thing the demo exists to avoid.

The second is catastrophic and the first is not, so bias short. Twenty also
happens to be what the shared demo already enforces (`SESSION_LIMIT_MS`), and
one number is worth more than a tuned one. With `createPracticeRace` available
a genuine evaluation is ten to fifteen minutes of actual clicking anyway.

**The reaper is the enforcement; the client cap is only manners.**
`demoSession.ts` runs in the visitor's browser and anybody who wants to defeat
it can. That is fine for the shared demo, whose storage is ephemeral regardless
— but "never load-bearing" is a promise about the *server*. So the reaper
deletes the revision on a schedule whatever the client believes, and it should
run a few minutes *after* the client cap so the overlay appears before the
connection dies. An explained pause is a better last impression than a 502.

**Uploads are allowed, with caps.** The abuse case is somebody using it as an
anonymous file host — but the file is served from an instance that dies within
the half hour, which removes most of the value of doing so. Keep the 16 MB cap,
add a per-instance count, and keep the captcha in front. If that turns out to be
wrong, refusing uploads again is a one-line change to the denylist.

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
  in under twenty seconds, at a URL that reads like something.
- Two visitors provisioning at once get different names, and neither could have
  guessed the other's.
- Both modes work: seeded, and genuinely empty at the first-run wizard.
- A private demo can do everything the shared one refuses **except export and
  bulk import**, and the shared demo still refuses all of it.
- There is no route by which work done in a demo can leave it, and the page
  says so where a visitor cannot miss it.
- The concurrency cap holds under a deliberate flood, and the reaper leaves no
  orphans across a week.
- Nothing about the shared demo changed.
