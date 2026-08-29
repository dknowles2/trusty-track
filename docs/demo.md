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
- **create or edit a track.** Both can point a track's timer at a real serial
  port, which is the same door back into probing USB devices that booting the
  demo otherwise closes;
- **accept a photograph.** Uploads are refused outright, which keeps the demo
  from holding a picture of somebody's child;
- **populate, import or create a practice race.** These make rows in bulk with
  no credential, on an instance other people are looking at;
- **download or restore a backup**, or connect a timer over the browser.

Everything else works, including deleting a race — the reset undoes it. Track
setup is the one exception beyond the PIN itself: System Settings is otherwise
read-only for tracks on the demo.

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

### On a release

Tagging a stable version pushes it to the demo. The release workflow publishes
the image, and its `Public Demo` job then points Cloud Run at that exact
version and waits for `/health` to answer before it calls the deploy good.

Three things about it:

- **It deploys the published image; it never builds one.** What a visitor
  clicks through is the same image the release page hands out.
- **A release candidate is skipped**, exactly as one does not claim the
  `latest` Docker tag. The demo is where this site sends an evaluator, so it
  follows stable versions only.
- **A failed deploy does not fail the release.** The installers and the release
  page do not wait on it, and the job can be re-run on its own from the Actions
  tab — or run by hand from there against any published version.

It stays switched off until the repository has somewhere to deploy *to*: the
job is skipped unless a `DEMO_CLOUD_RUN_PROJECT` repository variable names a
project, so a fork releases without it.

Setting it up is four repository variables and one Google Cloud identity.
Authentication is [Workload Identity
Federation](https://cloud.google.com/iam/docs/workload-identity-federation) —
GitHub proves who it is with a short-lived token, so there is no service
account key in this repository to leak or rotate. In the Google Cloud project:
create a Workload Identity pool with a GitHub provider, restrict it to this
repository, and let it impersonate a service account holding **Cloud Run Admin**
(`roles/run.admin`) and **Service Account User** (`roles/iam.serviceAccountUser`)
— the first to deploy the service, the second to let it act as the runtime
account. Then, under **Settings → Secrets and variables → Actions →
Variables**:

| Variable | What it holds |
| --- | --- |
| `DEMO_CLOUD_RUN_PROJECT` | The project id. Absent, nothing deploys |
| `DEMO_WORKLOAD_IDENTITY_PROVIDER` | The provider's full resource name, `projects/…/providers/…` |
| `DEMO_DEPLOY_SERVICE_ACCOUNT` | The service account to impersonate |
| `DEMO_ALLOWED_ORIGINS` | The demo's own URL, so CORS stops being the LAN wildcard |
| `DEMO_CLOUD_RUN_SERVICE`, `DEMO_CLOUD_RUN_REGION` | Optional; empty takes the script's own defaults |

Variables rather than secrets, and not by accident: none of them is a secret
once the key is gone, and GitHub will not let a job decide whether to run based
on a secret — which is what lets the job skip quietly on a repository that has
no demo instead of failing somebody's release.

The workflow calls `deploy/cloudrun/deploy.sh` rather than repeating its flags,
so there is one description of what the demo is.

### By hand

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

The build is a step of its own rather than `gcloud run deploy --source`, and
`deploy/cloudrun/cloudbuild.yaml` is why: `--source` uses Cloud Build's legacy
docker builder, where the Dockerfile's `--platform=$BUILDPLATFORM` expands to
nothing and the build fails on its first line. That line keeps the frontend
build off QEMU in the release workflow's multi-arch build, so the build config
turns BuildKit on rather than the Dockerfile giving it up.

You need `gcloud`, a project with billing, and three APIs — `run`,
`cloudbuild`, `artifactregistry`. On a project that has never deployed from
source, the script creates its Artifact Registry repository itself. Google no
longer grants the default Compute Engine service account what Cloud Build
needs, so a first deploy may also want:

```bash
gcloud projects add-iam-policy-binding PROJECT   --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com   --role=roles/cloudbuild.builds.builder
```

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

The rules an agent needs are in `CLAUDE.md` under "The public demo", which
records what was built, what was measured and decided against, and why.
