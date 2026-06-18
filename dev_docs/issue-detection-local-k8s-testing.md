# Issue Detection Local K8s Testing

This guide documents how to test the private issue-detection service against a
local Rejourney k8s/dev stack without committing private service code, secret
values, or private project identifiers to this open-source repository.

## Boundary

Rejourney is the local data source:

- local k8s namespace: `rejourney-local`
- local API: usually `http://localhost:3000`
- local dashboard: usually `http://localhost:8080`
- read-only internal API: `/api/internal/issue-detection/*`

Issue-detection remains private:

- scan orchestration
- brain/video analysis
- private detection storage
- Cloud Run Job used for scheduled scans
- Cloud Run service used by the Rejourney dashboard Leaks UI

Do not copy private issue-detection source files, private schema dumps, or
private service logs into this repo. Keep this repo limited to the Rejourney
contract, placeholders, and local test harnesses.

## Required Local State

1. Start the local Rejourney stack.

```bash
npm run dev:resume
```

Use `npm run dev` for a fresh daily start. The helper assumes the local API is
reachable on `http://localhost:3000` and that `kubectl config current-context`
is `k3d-rejourney-dev`.

2. Keep `.env.k8s.local` local and uncommitted.

Required keys for this flow:

```env
SHOW_ISSUE_DETECTION_UI=true
ISSUE_DETECTION_API_URL=<private-issue-detection-edge-url>
ISSUE_DETECTION_SERVICE_SECRET=<secret Rejourney uses when calling issue-detection>
REJOURNEY_INTERNAL_SERVICE_SECRET=<secret issue-detection uses when calling Rejourney>
```

`SHOW_ISSUE_DETECTION_UI=true` is for local UI testing. Production can and often
should keep this `false` while backend integration remains configured.

`REJOURNEY_INTERNAL_API_URL` can stay production-shaped in GCP. The helper
overrides it per execution with a temporary public URL for your local API, so do
not commit local tunnel URLs or private production URLs here.

3. Sync local k8s secrets after changing `.env.k8s.local`.

```bash
scripts/local-k8s/k8s-sync-secrets.sh
```

4. Ensure your local dataset has replay-ready sessions for the project you want
to scan. The scan only sees sessions that are replay-available, saved, not
expired, and have ready visual artifacts.

## Required GCP Access

You need access to the private GCP project that hosts issue-detection. Do not
hardcode that project id in committed docs or scripts.

Required local tools:

```bash
gcloud
kubectl
cloudflared
node
```

Required permissions:

- execute the private Cloud Run Job, usually named `scan`
- read Cloud Run Job logs for the execution summary
- use the job's existing Secret Manager references

The helper does not need to print or read private secret values. The Cloud Run
Job already receives its own production secrets from GCP Secret Manager.

## Helper Script

Use:

```bash
scripts/local-k8s/issue-detection-local-test.sh
```

The helper:

- checks local k8s context and local env shape without printing private URLs
- signs a request to the local Rejourney internal candidate-session API
- optionally starts a temporary `trycloudflare.com` tunnel to local API
- executes the private Cloud Run scan job with execution-only env overrides
- summarizes scan logs
- checks the signed Leaks API after real runs when local reverse-direction env is present
- stops the tunnel on exit

It intentionally never prints secret values.

### Check Local Wiring

```bash
scripts/local-k8s/issue-detection-local-test.sh check \
  --project-id <PROJECT_UUID>
```

Expected output:

- secret keys reported as `set (<n> chars)` instead of raw values
- candidate API returns `HTTP 200`

If this fails with `401`, check the Rejourney internal service secret, timestamp
skew, or whether the request path is signed with the query string.

### Dry Run

Dry run proves the private scan job can reach local Rejourney through a
temporary tunnel. It writes scan-decision audit data in issue-detection, but it
does not run the expensive per-session analysis path.

```bash
GCP_PROJECT=<GCP_PROJECT_ID> \
scripts/local-k8s/issue-detection-local-test.sh dry-run \
  --project-id <PROJECT_UUID> \
  --lookback-hours 168 \
  --top-percent 100 \
  --daily-cap 150
```

The `--update-env-vars` passed to `gcloud run jobs execute` are execution-only.
They do not permanently change the Cloud Run Job configuration.

### Real Run

Use a real run when you want to simulate the scheduled scan against local
sessions.

```bash
GCP_PROJECT=<GCP_PROJECT_ID> \
scripts/local-k8s/issue-detection-local-test.sh run \
  --project-id <PROJECT_UUID> \
  --lookback-hours 168 \
  --top-percent 100 \
  --daily-cap 150
```

For a broad backfill-style local test, increase the window:

```bash
GCP_PROJECT=<GCP_PROJECT_ID> \
scripts/local-k8s/issue-detection-local-test.sh run \
  --project-id <PROJECT_UUID> \
  --lookback-hours 8760 \
  --top-percent 100 \
  --daily-cap 200 \
  --spa-gate legacy
```

Use `--daily-cap` high enough for the local test pool. In production, keep the
normal production cap and budget settings.

Production-style scans should use the default scored SPA gate. `--spa-gate
legacy` is useful for intentionally broad local exploration.

### Existing Tunnel

If you already have a public URL to your local API, skip `cloudflared` startup:

```bash
GCP_PROJECT=<GCP_PROJECT_ID> \
scripts/local-k8s/issue-detection-local-test.sh dry-run \
  --project-id <PROJECT_UUID> \
  --public-rejourney-url <PUBLIC_LOCAL_API_URL>
```

## Reading Results

After a real run, check:

- Cloud Run execution summary printed by the helper
- local dashboard at `http://localhost:8080`
- `Automations > Leaks` for visible issues
- browser console/network if the Leaks UI cannot reach the private edge service

No visible leaks after a scan does not automatically mean the scan failed.
Issue-detection distinguishes:

- a session-level problem: one replay had a possible leak/friction event
- an issue: an aggregation of similar problems that should be solved together

A run can analyze sessions, produce isolated problem observations, and still
produce zero issue rows if promotion/clustering thresholds are not met.

The normal scheduled production scan is expected around 03:00 UTC, with issues
appearing a few minutes after the run starts. Manual helper runs execute
immediately and are useful for validating the same path before waiting for the
nightly schedule.

## Expected Failure Modes

`401` from Rejourney internal API:

- wrong `REJOURNEY_INTERNAL_SERVICE_SECRET`
- timestamp skew outside the accepted window
- nonce reused
- signed the full URL instead of the path with query

`403` from the private brain service:

- expected if you try to call private brain directly from your laptop
- use the Cloud Run scan job path; it runs under the service account allowed to invoke brain

`503` or connection errors from candidate sessions:

- local API is not running
- temporary tunnel cannot reach `localhost:3000`
- local k8s namespace or local backend process is down

No email:

- expected when no issue rows are created for that scan
- the digest is intentionally quiet for zero-issue runs

Blank Leaks UI:

- signed Leaks API returned zero issue rows
- local `SHOW_ISSUE_DETECTION_UI` is not `true`
- reverse-direction `ISSUE_DETECTION_API_URL` or `ISSUE_DETECTION_SERVICE_SECRET` is missing or stale

Many render failures:

- the private issue-detection image may not include the current video-renderer
  fix or may be using an old scan-job image
- deploying the edge service is not enough if the scheduled scan job still
  points at an old image

## Deployment Reminder

The private issue-detection deploy workflow may update the HTTP services without
updating the scheduled Cloud Run Job. If a fix affects scan behavior, verify the
scan job image after deploy and update it if necessary.

Do not change Rejourney production secrets for a renderer-only fix. Rejourney
prod only needs the service-to-service URL and shared secrets to remain present
and consistent.

## Cleanup

The helper stops the temporary tunnel automatically. To verify:

```bash
pgrep -fl cloudflared || true
```

The helper uses execution-only overrides for Cloud Run Job runs. To inspect the
persistent job config, use:

```bash
gcloud run jobs describe <SCAN_JOB> \
  --region <GCP_REGION> \
  --project <GCP_PROJECT_ID>
```

Do not paste secret values from that output into docs, tickets, or commits.
