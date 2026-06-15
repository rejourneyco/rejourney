# Issue Detection Internal Data API Handoff

Final production smoke test: 2026-06-15 local time.

## Required `.env` Update

For issue-detection calling Rejourney, use the API host:

```env
REJOURNEY_INTERNAL_API_URL=https://api.rejourney.co
REJOURNEY_INTERNAL_SERVICE_SECRET=<provided-by-rejourney>
```

Do not swap this with the reverse-direction secret:

```env
ISSUE_DETECTION_API_URL=<issue-detection-service-url>
ISSUE_DETECTION_SERVICE_SECRET=<secret Rejourney uses when calling issue-detection>
```

The Rejourney internal endpoints are under:

```text
${REJOURNEY_INTERNAL_API_URL}/api/internal/issue-detection
```

## HMAC Signing Contract

All requests require these headers:

```http
X-RJ-Internal-Service: issue-detection
X-RJ-Internal-Timestamp: <current ISO timestamp>
X-RJ-Internal-Nonce: <unique uuid>
X-RJ-Internal-Signature: <hex hmac sha256>
```

Canonical signature payload:

```text
METHOD
PATH_WITH_QUERY
TIMESTAMP
NONCE
SHA256_HEX_CANONICAL_BODY
```

For these GET endpoints, the request body is empty, so the body hash is:

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

Important: sign the path with query only, not the full URL. Example path:

```text
/api/internal/issue-detection/issues/9c48bed7-0239-4d78-8f3b-28b3c5044f9c
```

## Curl Template

```bash
base="${REJOURNEY_INTERNAL_API_URL:-https://api.rejourney.co}"
path="/api/internal/issue-detection/issues/9c48bed7-0239-4d78-8f3b-28b3c5044f9c"
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
nonce="$(uuidgen | tr '[:upper:]' '[:lower:]')"
body_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
payload="$(printf "GET\n%s\n%s\n%s\n%s" "$path" "$timestamp" "$nonce" "$body_hash")"
signature="$(printf "%s" "$payload" | openssl dgst -sha256 -hmac "$REJOURNEY_INTERNAL_SERVICE_SECRET" -hex | awk '{print $2}')"

curl -sS "$base$path" \
  -H "X-RJ-Internal-Service: issue-detection" \
  -H "X-RJ-Internal-Timestamp: $timestamp" \
  -H "X-RJ-Internal-Nonce: $nonce" \
  -H "X-RJ-Internal-Signature: $signature"
```

## Final Production Test Results

All five requested endpoints returned `HTTP 200` against `https://api.rejourney.co`.

| Endpoint | ID | Result |
| --- | --- | --- |
| `GET /errors/:id` | `277ee42d-4214-48ca-8d7e-263fa0bbcef2` | `200` |
| `GET /crashes/:id` | `01aed2db-d153-4f31-a6d4-bded06711318` | `200` |
| `GET /issues/:id` | `9c48bed7-0239-4d78-8f3b-28b3c5044f9c` | `200` |
| `GET /anrs/:id` | `ec3d8096-5609-4ef6-8c87-4f56a2e3eb14` | `200` |
| `GET /issue-events/:id` | `1b4f8179-d7ad-4694-8011-dd6dd3a90bfc` | `200` |

### `GET /errors/:id`

```json
{
  "id": "277ee42d-4214-48ca-8d7e-263fa0bbcef2",
  "sessionId": null,
  "projectId": "6fb93c70-2771-41f0-ad4c-a7544f47f9cf",
  "timestamp": "2026-03-28T12:31:54.044Z",
  "errorType": "js_error",
  "errorName": "iOS App Attest key generation failed",
  "message": "ATTESTATION_ERROR",
  "stack": "{...large native stack trimmed for readability...}",
  "screenName": "__root > Play-minigame",
  "componentName": null,
  "deviceModel": "iPhone14,3",
  "osVersion": "26.3.1",
  "appVersion": "1.0.12",
  "fingerprint": "d70c9596c3bad1459ad8d5e2a30fb4c28284cd3f0da89672169835c66da63b0e",
  "occurrenceCount": 1,
  "status": "open",
  "createdAt": "2026-03-28T12:33:26.568Z",
  "updatedAt": "2026-06-14T20:33:56.549Z"
}
```

### `GET /crashes/:id`

```json
{
  "id": "01aed2db-d153-4f31-a6d4-bded06711318",
  "sessionId": "session_1781297427297_73432cdec30a4502bcd8d6ab5fbdcf3e",
  "projectId": "6fb93c70-2771-41f0-ad4c-a7544f47f9cf",
  "timestamp": "2026-06-12T20:50:59.467Z",
  "exceptionName": "java.lang.OutOfMemoryError",
  "reason": "Failed to allocate a 4919536 byte allocation with 388368 free bytes and 379KB until OOM",
  "stackTrace": "[]",
  "fingerprint": null,
  "deviceMetadata": {
    "threadName": "FrescoDecodeExecutor-4",
    "isMain": "false",
    "priority": "5"
  },
  "status": "open",
  "occurrenceCount": 1,
  "createdAt": "2026-06-14T20:41:25.829Z",
  "updatedAt": "2026-06-14T20:41:25.829Z"
}
```

### `GET /issues/:id`

```json
{
  "id": "9c48bed7-0239-4d78-8f3b-28b3c5044f9c",
  "projectId": "6fb93c70-2771-41f0-ad4c-a7544f47f9cf",
  "shortId": "PREEZY-20",
  "fingerprint": "crash:java.lang.OutOfMemoryError:crash",
  "issueType": "crash",
  "title": "java.lang.OutOfMemoryError",
  "subtitle": "",
  "culprit": null,
  "screenName": null,
  "componentName": null,
  "status": "ongoing",
  "isHandled": false,
  "assigneeId": null,
  "priority": "medium",
  "environment": null,
  "firstSeen": "2026-03-20T09:50:17.890Z",
  "lastSeen": "2026-06-12T20:50:59.467Z",
  "eventCount": 17,
  "userCount": 1,
  "events24h": 15,
  "events90d": 17,
  "sampleSessionId": "session_1781297427297_73432cdec30a4502bcd8d6ab5fbdcf3e",
  "sampleStackTrace": "[]",
  "sampleDeviceModel": null,
  "sampleOsVersion": null,
  "sampleAppVersion": null,
  "dailyEvents": {
    "2026-03-20": 1,
    "2026-03-22": 1,
    "2026-04-10": 1,
    "2026-04-22": 2,
    "2026-04-24": 2,
    "2026-04-25": 3,
    "2026-04-28": 1,
    "2026-04-30": 1,
    "2026-06-04": 3,
    "2026-06-12": 2
  },
  "affectedVersions": {},
  "affectedDevices": {},
  "createdAt": "2026-03-20T09:50:39.711Z",
  "updatedAt": "2026-06-14T20:41:25.893Z"
}
```

### `GET /anrs/:id`

```json
{
  "id": "ec3d8096-5609-4ef6-8c87-4f56a2e3eb14",
  "sessionId": null,
  "projectId": "6fb93c70-2771-41f0-ad4c-a7544f47f9cf",
  "timestamp": "2026-03-28T12:51:12.034Z",
  "durationMs": 5714,
  "threadState": "blocked",
  "deviceMetadata": null,
  "status": "open",
  "occurrenceCount": 1,
  "createdAt": "2026-03-28T12:51:15.455Z",
  "updatedAt": "2026-06-14T20:37:37.160Z"
}
```

### `GET /issue-events/:id`

```json
{
  "id": "1b4f8179-d7ad-4694-8011-dd6dd3a90bfc",
  "issueId": "9c48bed7-0239-4d78-8f3b-28b3c5044f9c",
  "sessionId": "session_1781297427297_73432cdec30a4502bcd8d6ab5fbdcf3e",
  "timestamp": "2026-06-12T20:50:59.467Z",
  "screenName": null,
  "userId": null,
  "deviceModel": null,
  "osVersion": null,
  "appVersion": null,
  "errorMessage": "Failed to allocate a 4919536 byte allocation with 388368 free bytes and 379KB until OOM",
  "stackTrace": "[]",
  "createdAt": "2026-06-14T20:41:25.931Z"
}
```

## Notes

- Production `api-dashboard` has the evidence-row routes deployed and healthy.
- `/health/ready` returned `200` after rollout.
- Rejourney local env files were updated to use `https://api.rejourney.co` for `REJOURNEY_INTERNAL_API_URL`.
- If you see `401`, check timestamp skew, nonce reuse, service name, and that you are signing the path with query rather than the full URL.
- If you see `404`, confirm the request path includes `/api/internal/issue-detection`.
