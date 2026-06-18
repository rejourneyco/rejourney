# Issue Detection Handoff

This document is the Rejourney-side contract for the private `issue-detection`
service. Rejourney stays open source; issue-detection stays private.

## Ownership

Rejourney owns:

- Dashboard UI under `Automations > Leaks`
- Dashboard proxy API under `/api/automations/leaks`
- Read-only internal Data API under `/api/internal/issue-detection`
- Service-to-service HMAC signing and verification
- Demo fixtures and the `SHOW_ISSUE_DETECTION_UI` gate

Issue-detection owns:

- Daily scan orchestration
- Candidate session selection after receiving Rejourney's bounded candidate list
- Paid analysis budget enforcement
- Private detection database
- Context generation
- Leaks API consumed by Rejourney

## Required Env

Rejourney env:

```env
SHOW_ISSUE_DETECTION_UI=false
ISSUE_DETECTION_API_URL=
ISSUE_DETECTION_SERVICE_SECRET=
REJOURNEY_INTERNAL_API_URL=
REJOURNEY_INTERNAL_SERVICE_SECRET=
```

Issue-detection env:

```env
REJOURNEY_INTERNAL_API_URL=https://api.rejourney.co
REJOURNEY_INTERNAL_SERVICE_SECRET=<provided-by-rejourney>
ISSUE_DETECTION_SERVICE_SECRET=<same value configured in Rejourney for outbound calls>
SPA_COST_USD=0.03
SPA_DAILY_USD=0.50
```

Only the exact string `true` enables `SHOW_ISSUE_DETECTION_UI`. Missing, empty,
`false`, or invalid values are disabled.

## Secrets Boundary

Give issue-detection only:

- `REJOURNEY_INTERNAL_API_URL`
- `REJOURNEY_INTERNAL_SERVICE_SECRET`

Do not give issue-detection:

- Rejourney `DATABASE_URL`
- S3, R2, MinIO, or object-store keys
- `JWT_SECRET`
- `JWT_SIGNING_KEY`
- `INGEST_HMAC_SECRET`
- dashboard user/session tokens
- kubeconfig
- general admin credentials

Use separate secrets per direction:

- `REJOURNEY_INTERNAL_SERVICE_SECRET`: issue-detection calls Rejourney.
- `ISSUE_DETECTION_SERVICE_SECRET`: Rejourney calls issue-detection.

## HMAC Signing

Every service-to-service request uses these headers:

```http
X-RJ-Internal-Service: issue-detection
X-RJ-Internal-Timestamp: 2026-06-13T12:00:00.000Z
X-RJ-Internal-Nonce: 11111111-1111-4111-8111-111111111111
X-RJ-Internal-Signature: <hex hmac sha256>
```

Signature payload:

```text
METHOD
PATH_WITH_QUERY
TIMESTAMP
NONCE
SHA256_HEX_CANONICAL_BODY
```

Example payload:

```text
GET
/api/internal/issue-detection/projects/demo-project-001/candidate-sessions?lookback=7d&limit=16
2026-06-13T12:00:00.000Z
11111111-1111-4111-8111-111111111111
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

For GET requests, the body is an empty string. For JSON requests, sign the exact
JSON string sent as the request body. Requests with timestamps outside a 5-minute
window or reused nonces are rejected.

## Rejourney Internal Data API

Base URL:

```text
{REJOURNEY_INTERNAL_API_URL}/api/internal/issue-detection
```

All endpoints require HMAC auth with service name `issue-detection`.

### List Projects

```http
GET /projects
```

Response:

```json
{
  "projects": [
    {
      "id": "demo-project-001",
      "teamId": "demo-team",
      "name": "ShopFlow Mobile",
      "platform": "ios",
      "bundleId": "com.shopflow.mobile",
      "packageName": null,
      "webDomain": "shopflow.example",
      "webAllowedDomains": ["shopflow.example"],
      "recordingEnabled": true,
      "rejourneyEnabled": true,
      "createdAt": "2026-05-18T12:00:00.000Z",
      "updatedAt": "2026-06-13T12:00:00.000Z"
    }
  ]
}
```

### Candidate Sessions

```http
GET /projects/:projectId/candidate-sessions?lookback=7d&limit=2000&minReplayDurationSeconds=15
```

Rules:

- `limit` is clamped to 1-2000 and defaults to 2000.
- Default lookback is `24h`.
- `lookback` accepts `m`, `h`, `d`, or `w`, for example `30m`, `24h`, `7d`, or `4w`.
- Use `lookback=all` for all retained sessions.
- Exact `since=<ISO timestamp>` is still supported and takes precedence over `lookback`.
- Only replay-available, saved, non-deleted, non-expired sessions are returned.
- `minReplayDurationSeconds` defaults to `15` and filters sessions with too little replay footage. Use `0` to disable the filter.
- Sessions are ordered by `startedAt` descending. Issue-detection does its own scoring and random-tail sampling from the returned pool.
- Cheap signal counts are still returned as scoring inputs.

Response:

```json
{
  "projectId": "demo-project-001",
  "lookback": "7d",
  "since": "2026-06-12T00:00:00.000Z",
  "limit": 2000,
  "minReplayDurationSeconds": 15,
  "sessions": [
    {
      "id": "session_123",
      "projectId": "demo-project-001",
      "startedAt": "2026-06-13T10:00:00.000Z",
      "endedAt": "2026-06-13T10:04:12.000Z",
      "durationSeconds": 252,
      "platform": "web",
      "appVersion": "2026.06.1",
      "deviceModel": "Chrome",
      "osVersion": "macOS",
      "userDisplayId": "user_123",
      "anonymousHash": "anon_hash",
      "replayAvailable": true,
      "smartCaptureStatus": "not_applicable",
      "readyVisualArtifactCount": 2,
      "replayStartTime": 1781354400000,
      "replayEndTime": 1781354652000,
      "replayDurationSeconds": 252,
      "replayRangeComplete": true,
      "metrics": {
        "totalEvents": 216,
        "errorCount": 3,
        "crashCount": 0,
        "anrCount": 0,
        "apiErrorCount": 5,
        "rageTapCount": 2,
        "deadTapCount": 1,
        "touchCount": 24,
        "scrollCount": 8,
        "screenshotSegmentCount": 1,
        "hierarchySnapshotCount": 0
      }
    }
  ]
}
```

### Batch Session Metrics

```http
POST /metrics:batch
Content-Type: application/json

{ "sessionIds": ["session_123", "session_456"] }
```

Returns only cheap session columns and signal counts, keyed by session id:

```json
{
  "metrics": {
    "session_123": {
      "durationSeconds": 252,
      "startedAt": "2026-06-13T10:00:00.000Z",
      "endedAt": "2026-06-13T10:04:12.000Z",
      "readyVisualArtifactCount": 2,
      "replayStartTime": 1781354400000,
      "replayEndTime": 1781354652000,
      "replayDurationSeconds": 252,
      "totalEvents": 216,
      "errorCount": 3,
      "crashCount": 0,
      "anrCount": 0,
      "apiErrorCount": 5,
      "rageTapCount": 2,
      "deadTapCount": 1,
      "touchCount": 24,
      "scrollCount": 8,
      "screenshotSegmentCount": 1,
      "hierarchySnapshotCount": 0
    }
  }
}
```

### Batch Digest

```http
POST /digest:batch
Content-Type: application/json

{ "sessionIds": ["session_123"], "limitPerSession": 3 }
```

Returns the newest few errors and crashes per session for cheap text-only triage:

```json
{
  "errors": [],
  "crashes": []
}
```

### Feature Record

```http
GET /sessions/:sessionId/feature-record
```

Response includes:

- `session`
- `project`
- `metrics`
- `crashes`
- `anrs`
- `errors`
- `artifacts`

Artifact entries contain opaque artifact IDs and `bytesUrl`; they do not contain
raw S3 keys or credentials.

### Artifact Catalog

```http
GET /sessions/:sessionId/artifacts
GET /sessions/:sessionId/artifacts?kind=screenshots
```

Response:

```json
{
  "sessionId": "session_123",
  "artifacts": [
    {
      "id": "9b59d7ee-9c7d-4628-aa7d-85b933a55cb4",
      "sessionId": "session_123",
      "kind": "screenshots",
      "status": "ready",
      "sizeBytes": 124001,
      "declaredSizeBytes": 124001,
      "readyAt": "2026-06-13T10:05:00.000Z",
      "startTime": 1781354400000,
      "endTime": 1781354652000,
      "frameCount": 84,
      "bytesUrl": "/api/internal/issue-detection/artifacts/9b59d7ee-9c7d-4628-aa7d-85b933a55cb4/bytes"
    }
  ]
}
```

### Artifact Bytes

```http
GET /artifacts/:artifactId/bytes
```

Returns raw stored bytes after verifying the artifact belongs to a real session
and project. Missing or expired objects return `404`, forbidden storage returns
`403`, and storage/server failures return `5xx`. Bytes are returned exactly as
stored, including gzip compression. Do not assume signed S3 URLs or storage keys
are available.

### Evidence Rows By ID

These endpoints return one row, or `404` if the row no longer exists:

```http
GET /crashes/:id
GET /anrs/:id
GET /errors/:id
GET /issues/:id
GET /issue-events/:id
```

## Issue-Detection API Expected By Rejourney

Base URL:

```text
{ISSUE_DETECTION_API_URL}
```

All endpoints require HMAC auth with service name `rejourney`.

### List Leaks

```http
GET /v1/projects/:projectId/leaks?status=&q=&cursor=&limit=&severity=&type=
```

Response:

```json
{
  "leaks": [
    {
      "id": "leak_123",
      "shortId": "LEAK-101",
      "projectId": "demo-project-001",
      "title": "Checkout coupon validation loops after cart changes",
      "status": "ready",
      "severity": "high",
      "issueType": "abandon_after_api_error",
      "whyItMatters": "Users abandon checkout after repeated coupon validation failures.",
      "affectedSessionsCount": 14,
      "affectedUsersCount": 9,
      "firstSeenAt": "2026-06-12T12:00:00.000Z",
      "lastSeenAt": "2026-06-13T11:18:00.000Z",
      "estimatedCostUsd": 0.48,
      "contextStatus": "ready",
      "topSignals": ["session_replay", "api_error_cluster", "rage_tap"]
    }
  ],
  "stats": {
    "total": 1,
    "ready": 1,
    "queued": 0,
    "researching": 0,
    "budgetExhausted": 0,
    "resolved": 0
  },
  "nextCursor": null
}
```

### Leak Detail

```http
GET /v1/leaks/:leakId
```

Response extends the summary with:

- `evidenceGroups`
- `sessions`
- `contextMarkdown`
- `contextMarkdownUrl`

Rejourney does not display or require code pointers. The generated
`contextMarkdown` is the IDE handoff artifact; it should contain enough product,
session, replay, signal, and hypothesis context for the user's selected IDE agent
to inspect the local repository itself.

### Scan Run History

```http
GET /v1/projects/:projectId/scan-runs?limit=12
```

Response:

```json
{
  "runs": [
    {
      "id": "scan_run_123",
      "projectId": "demo-project-001",
      "trigger": "admin_scan",
      "status": "succeeded",
      "startedAt": "2026-06-18T03:00:00.000Z",
      "finishedAt": "2026-06-18T03:04:00.000Z",
      "durationMs": 240000,
      "sessionsScanned": 150,
      "admittedSessions": 7,
      "skippedSessions": 143,
      "candidatesEmitted": 7,
      "problemsFound": 7,
      "issuesUpserted": 3,
      "visibleIssues": 3,
      "renderFailures": 0,
      "analysisFailures": 0,
      "warningCount": 0,
      "settings": {
        "dryRun": false,
        "lookbackHours": 24,
        "dailyCap": 150,
        "dailyFloor": 0,
        "maxCandidates": 2000,
        "topPercent": 100,
        "spaGate": "scored"
      },
      "decisionBreakdown": {
        "admitted": 7,
        "skip_over_k": 143
      },
      "analysisBreakdown": {
        "succeeded": 7
      },
      "email": {
        "status": "unknown",
        "reason": "delivery_recorded_in_rejourney",
        "issueCount": 3,
        "recipientCount": null,
        "sentAt": null
      },
      "notes": [
        "3 inbox issues were visible after this run."
      ],
      "errors": []
    }
  ],
  "stats": {
    "total": 1,
    "lastRunAt": "2026-06-18T03:00:00.000Z",
    "lastSuccessAt": "2026-06-18T03:00:00.000Z",
    "recentFailures": 0
  }
}
```

This endpoint powers the Leaks page run-history modal. Return customer-safe
audit summaries only: counts, status, scan settings, digest status, and concise
warnings. Do not return raw private service logs, secret values, DB URLs, model
prompts, or full internal stack traces.

### Generate Context

```http
POST /v1/leaks/:leakId/context
```

Request:

```json
{
  "actorUserId": "user_123"
}
```

Response should be a full leak detail.

### Raw Context

```http
GET /v1/leaks/:leakId/context/raw.md
```

Returns `text/markdown`.

### Update Leak

```http
PATCH /v1/leaks/:leakId
```

Allowed status values:

- `queued`
- `researching`
- `ready`
- `resolved`
- `ignored`
- `budget_exhausted`
- `failed`

Request:

```json
{
  "status": "resolved",
  "actorUserId": "user_123"
}
```

Response should be a full leak detail.

## Budget Defaults

Default per-project daily paid analysis cap:

- `SPA_COST_USD=0.03`
- `SPA_DAILY_USD=0.50`
- Maximum paid analyses per project per day: `floor(0.50 / 0.03) = 16`

The 17th eligible paid session for a project/day must be skipped or marked
`budget_exhausted`.

## Local Testing

Rejourney local URLs:

```text
Dashboard: http://127.0.0.1:8080
API:       http://127.0.0.1:3000
Local k8s: http://api.localtest.me
```

Enable the UI locally:

```env
SHOW_ISSUE_DETECTION_UI=true
```

Demo route:

```text
http://127.0.0.1:8080/demo/leaks
```

Curl outline:

```bash
path="/api/internal/issue-detection/projects"
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
nonce="$(uuidgen)"
body_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
payload="$(printf "GET\n%s\n%s\n%s\n%s" "$path" "$timestamp" "$nonce" "$body_hash")"
signature="$(printf "%s" "$payload" | openssl dgst -sha256 -hmac "$REJOURNEY_INTERNAL_SERVICE_SECRET" -hex | awk '{print $2}')"

curl "$REJOURNEY_INTERNAL_API_URL$path" \
  -H "X-RJ-Internal-Service: issue-detection" \
  -H "X-RJ-Internal-Timestamp: $timestamp" \
  -H "X-RJ-Internal-Nonce: $nonce" \
  -H "X-RJ-Internal-Signature: $signature"
```

## Developer Checklist

- Implement HMAC signing and verification with the exact payload format above.
- Replace production direct Rejourney Postgres/S3 reads with the Data API.
- Keep direct DB/S3 mode only for local issue-detection development.
- Enforce the 50-cent project/day cap.
- Return Rejourney-compatible Leaks API response shapes.
- Verify `context.md` renders as plain markdown and can be copied into IDE tools.
- Never log secrets, S3 keys, signed URLs, or raw context for private sessions.

## Test Matrix

Config:

- Missing, empty, `false`, and invalid `SHOW_ISSUE_DETECTION_UI` values disable UI and APIs.
- Exact `SHOW_ISSUE_DETECTION_UI=true` enables UI and APIs.
- Web SSR receives the runtime gate without rebuilding the image.

Service auth:

- Valid HMAC succeeds.
- Missing signature, bad signature, stale timestamp, reused nonce, changed body, and unknown service fail.

Internal Data API:

- Project list exposes no secrets.
- Candidate sessions respect `limit`, `since`, project scope, replay availability, and ranking.
- Feature records match this contract.
- Artifact catalogs hide raw S3 keys.
- Artifact bytes verify ownership before streaming.
- Cross-project access is rejected by opaque artifact/session lookup.

Leaks proxy:

- Requires dashboard session auth and project membership.
- Returns 404/disabled when the gate is false.
- Handles missing issue-detection URL/secret as a clean service-unavailable error.
- Signs outbound requests.
- Sanitizes upstream errors.
- Validates `PATCH` status values.

UI and demo:

- Nav is hidden when false and visible when true.
- Direct route is disabled when false.
- `/demo/leaks` shows fixture examples when true and works without issue-detection running.
- Inbox/detail layout renders ready, queued, researching, budget exhausted, resolved, ignored, empty, loading, and error states.
- Filters and search work.
- Mobile list/detail flow works.
- Copy context works.
- VS Code and Cursor link builders encode local paths correctly.
- Missing local repo path opens IDE setup.

Deployment:

- Production k8s deploys with the gate false.
- Local Docker shows the UI by default.
- Local k8s can show the UI after setting `SHOW_ISSUE_DETECTION_UI=true`.
- Existing dashboard routes, `api-ingest`, and `api-dashboard` health/readiness remain unaffected.
