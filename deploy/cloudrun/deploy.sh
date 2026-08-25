#!/usr/bin/env bash
#
# Deploy the public demo to Cloud Run.
#
# Two ways in, and the default is the second:
#
#   IMAGE=ghcr.io/dknowles2/trusty-track:1.2.0 ./deploy/cloudrun/deploy.sh
#       Deploy a published image. Cloud Run pulls public GitHub Container
#       Registry images directly. Use a *version* tag: `latest` follows
#       releases, so the demo would change under you on somebody else's merge.
#
#   ./deploy/cloudrun/deploy.sh
#       Build the current working tree with Cloud Build and deploy that. What
#       you want when the demo is ahead of the last release, which it is
#       whenever demo work has landed and no tag has been cut since.
#
# The upload respects `.gitignore` (gcloud falls back to it when there is no
# `.gcloudignore`), which is what keeps a developer's local `backend/uploads`
# out of it — that directory reaches hundreds of megabytes on a machine that
# has actually run the app.
#
# Every flag below is load-bearing; the reasoning is in
# `docs/tasks/demo/04_deploy_and_portability.md`. The short version:
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

# The origin the browser will call. Left as the wildcard the LAN install uses
# unless given, but a real deployment should set it: `VIEWER` is the
# no-credential default and a viewer can read a roster. Cloud Run only tells
# you the URL after the first deploy, so the usual shape is deploy once, then
# re-run with ALLOWED_ORIGINS set to the URL it printed.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-*}"

# Fixed, so every visitor sees the same roster and the same times. In ordinary
# use this would read as the app being broken; for a demo it is the point.
DEMO_SEED="${DEMO_SEED:-trusty-track-demo}"

# `/tmp` rather than the image's `/data`: on Cloud Run the writable filesystem
# is in memory, and `/tmp` is the documented place for it. A seeded demo writes
# about 10 MB there — 24 photographs — which is why 512Mi is comfortable.
DATA_DIR="${DATA_DIR:-/tmp/trustytrack}"

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -n "${IMAGE:-}" ]]; then
  SOURCE_ARGS=(--image="$IMAGE")
  echo "Deploying published image: $IMAGE"
else
  SOURCE_ARGS=(--source="$SOURCE_ROOT")
  echo "Building $SOURCE_ROOT with Cloud Build."
fi

gcloud run deploy "$SERVICE" \
  "${SOURCE_ARGS[@]}" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=900 \
  --cpu-boost \
  --set-env-vars="TRUSTYTRACK_DEMO_MODE=1,TRUSTYTRACK_DEMO_SEED=${DEMO_SEED},TRUSTYTRACK_ALLOWED_ORIGINS=${ALLOWED_ORIGINS},TRUSTYTRACK_DATA_DIR=${DATA_DIR}"

cat <<'NOTE'

Deployed. Three things that are not flags:

  * Set a billing budget alert. --max-instances=1 bounds the worst case at one
    instance running continuously; the alert is what tells you if it does.
  * Re-run with ALLOWED_ORIGINS set to the URL above, so CORS stops being the
    wildcard that is only correct on a LAN.
  * The service must NOT be given a volume or a Cloud SQL instance. The demo is
    ephemeral on purpose: scale-to-zero is its reset.
NOTE
