# The public demo

A single, disposable instance of Trusty Track that somebody evaluating it can
click through without installing anything: a populated race, standings, a
championship field that filled itself, and a heat still left to run.

It is the same image as every other install. What makes it a demo is one
environment variable.

## Running one

```bash
docker run --rm -p 8000:8000 \
  -e TRUSTYTRACK_DEMO_MODE=1 \
  -e TRUSTYTRACK_DEMO_SEED=trusty-track-demo \
  ghcr.io/dknowles2/trusty-track:latest
```

No volume. The demo keeps nothing, seeds itself on first boot, and a restart is
its reset.

## The environment

| Variable | What it does |
| --- | --- |
| `TRUSTYTRACK_DEMO_MODE` | Turns the demo on. Absent means an ordinary install, which is every install that exists |
| `TRUSTYTRACK_DEMO_SEED` | Fixes the invented data, so every visitor sees the same roster and the same times |
| `TRUSTYTRACK_ALLOWED_ORIGINS` | Narrows CORS to the demo's own hostname. Defaults to `*`, which is right on a LAN and wrong on the internet |
| `TRUSTYTRACK_DATA_DIR` | Where it writes. On a host with no disk, point it somewhere ephemeral |
| `PORT` | The port to listen on. Defaults to 8000; Cloud Run and Railway set it for you |

## What the demo refuses

A visitor can create races, run heats, edit results, delete things and hand out
awards. What it will not do:

- **set a PIN.** An install with no operator PIN treats every caller as the
  operator, so without this the first visitor to open System Settings would own
  the demo until somebody reset it;
- **accept a photograph.** Uploads are refused outright, which keeps the demo
  from holding a picture of somebody's child;
- **populate, import or create a practice race.** These make rows in bulk with
  no credential, on an instance other people are looking at;
- **download or restore a backup**, or connect a timer over the browser.

Everything else works, including deleting a race — the reset undoes it.

## What it keeps

Nothing. Storage is ephemeral, so anything a visitor types is gone by the next
restart. That is the demo's data-retention answer as well as its reset.

## It lets go when nobody is using it

After five idle minutes — or twenty minutes in total — the demo closes its
subscription connection and offers to start again. The page says so.

This is not tidiness. The app's live screens are built never to stay
disconnected, because a display frozen mid-event is the failure that matters at
a venue. On a host that bills for a running instance, that same policy means
one forgotten browser tab keeps the demo awake indefinitely. The demo therefore
disposes its connection rather than retrying, and starting again is a reload.

## Deploying it

`deploy/cloudrun/deploy.sh` deploys to Cloud Run, two ways:

```bash
./deploy/cloudrun/deploy.sh
```

builds the current working tree with Cloud Build, which is what you want
whenever the demo is ahead of the last release — and it is, unless a tag has
been cut since the demo work landed. To deploy a published image instead:

```bash
IMAGE=ghcr.io/dknowles2/trusty-track:1.2.0 ./deploy/cloudrun/deploy.sh
```

Use a version tag rather than `latest`, which follows releases and would change
the demo under you on somebody else's merge.

Every flag in the script is load-bearing and commented; the two that matter most
are `--max-instances=1`, which is both a hard cost ceiling and what keeps the
app's in-process pub/sub correct, and `--min-instances=0`, which lets the
instance die when nobody is there — which is the reset.

Set a billing budget alert as well. The instance cap bounds the worst case; the
alert is what tells you if you reach it.

Fly.io, Hetzner and Railway all run the same image with a different ten lines of
configuration, because the demo has no durable state and calls no platform APIs.
That, and not an abstraction layer, is what makes moving cheap.

## For maintainers

The design notes are in `docs/tasks/demo/`, which records what was built, what
was measured and decided against, and why. The rules an agent needs are in
`CLAUDE.md` under "The public demo".
