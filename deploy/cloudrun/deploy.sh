#!/usr/bin/env bash
#
# Deploy the public demo to Cloud Run.
#
#   ./deploy/cloudrun/deploy.sh
#       Build the current working tree and deploy it. What you want whenever
#       the demo is ahead of the last release, which it is unless a tag has
#       been cut since the demo work landed.
#
#   IMAGE=ghcr.io/dknowles2/trusty-track:1.2.0 ./deploy/cloudrun/deploy.sh
#       Skip the build and deploy a published image. Cloud Run pulls public
#       GitHub Container Registry images directly. Use a *version* tag —
#       `latest` follows releases, so the demo would change under you on
#       somebody else's merge.
#
# Why the build is a separate step and not `gcloud run deploy --source`
# ---------------------------------------------------------------------
# `--source` uses Cloud Build's default docker step, which is the *legacy*
# builder. The Dockerfile's first line is
#
#     FROM --platform=$BUILDPLATFORM node:24-slim AS frontend-build
#
# and `BUILDPLATFORM` is a BuildKit built-in, so under the legacy builder it
# expands to nothing and the build fails with "'' is an invalid component of
# ''". That line is load-bearing for the release workflow's multi-arch build —
# it keeps `npm ci` and the Vite build off QEMU — so `cloudbuild.yaml` beside
# this script turns BuildKit on rather than the Dockerfile giving it up.
#
# The upload respects `.gitignore` (gcloud falls back to it when there is no
# `.gcloudignore`), which is what keeps a developer's local `backend/uploads`
# out of it — that directory reaches hundreds of megabytes on a machine that
# has actually run the app. Adding a `.gcloudignore` later would take over that
# fallback, so it would have to exclude that directory itself.
#
# The Cloud Run flags
# -------------------
# Every one is load-bearing; the reasoning is in `CLAUDE.md` under "The public
# demo". The short version:
#
#   --max-instances=1   A hard cost ceiling, and free correctness: the app's
#                       pub/sub is an in-process singleton and its timer
#                       managers are a module dict, so one instance is what
#                       makes every subscriber reachable. It also means
#                       WebSockets need no session affinity.
#   --min-instances=0   The whole point. An idle demo costs nothing, and the
#                       instance dying *is* the demo's reset — storage is
#                       ephemeral and it seeds itself on boot.
#   --timeout=900       Fifteen minutes rather than the 60-minute maximum. This
#                       bounds one socket; what bounds the *instance* is the
#                       client-side idle disconnect, which is why 900 is safe.
#
# "CPU always allocated" is never set: it bills continuously and would delete
# the entire advantage.
#
# A script rather than a `service.yaml` because there is one deployment and the
# flags are the documentation. Do not grow this into a deployment framework —
# the portability of this app comes from having no durable state and calling no
# platform APIs, not from a layer over four of them.
set -euo pipefail

SERVICE="${SERVICE:-trusty-track-demo}"
REGION="${REGION:-us-central1}"

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "No project. Pass PROJECT=… or run: gcloud config set project <id>" >&2
  exit 1
fi

# The origin the browser will call. Left as the wildcard the LAN install uses
# unless given, but a real deployment should set it: `VIEWER` is the
# no-credential default and a viewer can read a roster. Cloud Run only tells
# you the URL after the first deploy, so the usual shape is deploy once, then
# re-run with ALLOWED_ORIGINS set to the URL it printed.
#
# The app takes a comma-separated list, which is what a custom domain needs —
# `https://demo.example.org,https://<service>.run.app`, so the old address goes
# on working while DNS and the certificate settle. That comma is also why the
# `--set-env-vars` below uses gcloud's `^|^` delimiter syntax rather than the
# default: gcloud splits that flag on commas to find the *next variable*, so a
# list-valued one is read as a key with no value and the deploy fails on a
# syntax error naming the second origin. A single origin never showed it.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-*}"

# Fixed, so every visitor sees the same roster and the same times. In ordinary
# use this would read as the app being broken; for a demo it is the point.
DEMO_SEED="${DEMO_SEED:-trusty-track-demo}"

# `/tmp` rather than the image's `/data`: on Cloud Run the writable filesystem
# is in memory, and `/tmp` is the documented place for it. A seeded demo writes
# about 10 MB there — 24 photographs — which is why 512Mi is comfortable.
DATA_DIR="${DATA_DIR:-/tmp/trustytrack}"

# Where a built image goes. One repository, one tag: a demo has no rollback
# story worth keeping images for, and an accumulating tag per deploy is storage
# nobody prunes. Cloud Run resolves a tag to a digest at deploy time, so
# redeploying the same tag does pick up the new build.
REPOSITORY="${REPOSITORY:-cloud-run-source-deploy}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$HERE/../.." && pwd)"

if [[ -z "${IMAGE:-}" ]]; then
  IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPOSITORY}/${SERVICE}:demo"

  # Created on demand rather than assumed. `gcloud run deploy --source` makes
  # this repository as a side effect, so a project that has only ever used this
  # script would not otherwise have one.
  if ! gcloud artifacts repositories describe "$REPOSITORY" \
      --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
    echo "Creating Artifact Registry repository [$REPOSITORY] in [$REGION]."
    gcloud artifacts repositories create "$REPOSITORY" \
      --project="$PROJECT" --location="$REGION" \
      --repository-format=docker \
      --description="Images built by deploy/cloudrun/deploy.sh"
  fi

  echo "Building $SOURCE_ROOT with Cloud Build (BuildKit)."
  gcloud builds submit "$SOURCE_ROOT" \
    --project="$PROJECT" \
    --region="$REGION" \
    --config="$HERE/cloudbuild.yaml" \
    --substitutions="_IMAGE=$IMAGE"
else
  echo "Skipping the build; deploying $IMAGE"
fi

gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=900 \
  --cpu-boost \
  --set-env-vars="^|^TRUSTYTRACK_DEMO_MODE=1|TRUSTYTRACK_DEMO_SEED=${DEMO_SEED}|TRUSTYTRACK_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}|TRUSTYTRACK_DATA_DIR=${DATA_DIR}"

cat <<'NOTE'

Deployed. Three things that are not flags:

  * Set a billing budget alert. --max-instances=1 bounds the worst case at one
    instance running continuously; the alert is what tells you if it does.
  * Re-run with ALLOWED_ORIGINS set to the URL above, so CORS stops being the
    wildcard that is only correct on a LAN.
  * The service must NOT be given a volume or a Cloud SQL instance. The demo is
    ephemeral on purpose: scale-to-zero is its reset.
NOTE
