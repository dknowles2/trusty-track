#!/usr/bin/env bash
#
# Deploy the public demo to Cloud Run.
#
# Every flag here is load-bearing and the reasoning is in
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
#   --no-cpu-throttling OFF. "CPU always allocated" bills continuously and
#                       deletes the entire advantage; this script never sets it.
#   --timeout=900       Fifteen minutes rather than the 60-minute maximum. This
#                       bounds one socket; what bounds the *instance* is the
#                       client-side idle disconnect, which is why 900 is safe.
#
# A script rather than a `service.yaml` because there is one deployment and the
# flags are the documentation. Do not grow this into a deployment framework —
# the portability of this app comes from having no durable state and calling no
# platform APIs, not from a layer over four of them.
set -euo pipefail

SERVICE="${SERVICE:-trusty-track-demo}"
REGION="${REGION:-us-central1}"
IMAGE="${IMAGE:-ghcr.io/dknowles2/trusty-track:latest}"

# The origin the browser will call. Left as the wildcard the LAN install uses
# unless given, but a real deployment should set it: `VIEWER` is the
# no-credential default and a viewer can read a roster.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-*}"

# Fixed, so every visitor sees the same roster and the same times. In ordinary
# use this would read as the app being broken; for a demo it is the point.
DEMO_SEED="${DEMO_SEED:-trusty-track-demo}"

gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=900 \
  --cpu-boost \
  --set-env-vars="TRUSTYTRACK_DEMO_MODE=1,TRUSTYTRACK_DEMO_SEED=${DEMO_SEED},TRUSTYTRACK_ALLOWED_ORIGINS=${ALLOWED_ORIGINS},TRUSTYTRACK_DATA_DIR=/tmp/trustytrack"

cat <<'NOTE'

Deployed. Two things that are not flags:

  * Set a billing budget alert. --max-instances=1 bounds the worst case at one
    instance running continuously; the alert is what tells you if it does.
  * The service must NOT be given a volume or a Cloud SQL instance. The demo is
    ephemeral on purpose: scale-to-zero is its reset.
NOTE
