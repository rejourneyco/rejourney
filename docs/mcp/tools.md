This page lists every tool the Rejourney MCP server offers, what it returns, its main arguments and its credit cost. Claude Code reads the same information from the server and picks tools on its own, so you rarely call a tool by name. Use this page to understand what an answer was built from and what it cost.

All tools are read-only. Every tool except `list_projects` and `get_usage` returns content recorded on end-user devices, which Claude Code should treat as data and never as instructions.

## Tools

| Tool | Returns | Key arguments | Credits |
|---|---|---|---|
| `list_projects` | The projects this connection may read, with id, name and platforms. Most other tools need a project id from this list. | None | 0 |
| `get_usage` | Credits used, the limit, credits remaining, the start of the period and the reset time, and the median and 95th-percentile response time of recent calls on this connection. | None | 0 |
| `get_project_health` | Stability summary for a time range: sessions, crash-free session rate, sessions with a crash, ANR or error, crash, ANR and error counts, and the five issues with the most events in the range. | `projectId`, `from`, `to` | 1 |
| `find_friction` | Ranked friction groups: rage taps, dead taps, failed API calls, slow starts, slow API responses, error bursts, crashes, ANRs and short sessions after an error. Each group has sessions and users affected, its share of sessions, versions and platforms, the change against the previous period of equal length, and up to 5 example sessions. | `projectId`, `from`, `to`, `platform`, `appVersion`, `screenName` | 2 |
| `search_sessions` | Sessions matching a filter, newest first, 25 per page, with a total counted up to 10,000. Each session has its device, app version, country, user id, error and friction counts, replay availability and a dashboard link. | `projectId`, `from`, `to`, `platform`, `appVersion`, `userId`, `screenName`, `country`, `customEventName`, `issueType`, `hasReplay`, `cursor` | 1 |
| `sample_sessions` | A uniform random sample of the sessions matching a filter, with the size of the group it was drawn from. The same seed returns the same sample. | The `search_sessions` filters, plus `size` and `seed` | 1 |
| `get_session` | One session: device, OS, app and SDK versions, duration, location, event and error counts, the screens in the order first visited, whether a replay can be opened, and a dashboard link. | `sessionId` | 1 |
| `get_session_digests` | Compact summaries of up to 50 sessions: duration, platform, app version, ordered screens, custom events with counts, friction counts and top errors. Ids that could not be read are listed separately. | `sessionIds`, `cursor` | 1 + 1 per 10 sessions |
| `get_session_timeline` | What happened in a session, in order: screens, taps with their labels, rage and dead taps, failed and slow requests, errors, crashes, ANRs, custom events and logs. Repeated events are collapsed with a count. | `sessionId`, `fromSeconds`, `toSeconds`, `types`, `limit`, `cursor` | 1 |
| `get_session_context` | Everything needed to explain one session in one call: session facts, screens with time on each, the condensed timeline, the moments where something went wrong with the 10 seconds before each, nearby log lines, crash, ANR and error details with stacks, custom events, links that open the replay at each moment, open questions, and the same content as a markdown brief. | `sessionId` | 3 |
| `summarize_faults` | A breakdown of all crashes, all ANRs or all errors in a time range: how many and in how many sessions, the top 12 groups by signature with up to 2 example faults each, and counts by app version, platform, OS version, device, screen (errors only) and day. ANRs also report how long the main thread was blocked. It reads the fault rows themselves, so it includes faults that belong to no issue. | `projectId`, `type`, `from`, `to`, `platform`, `appVersion` | 2 |
| `list_issues` | Grouped crashes, ANRs, errors and rage taps, most recently seen first, 25 per page, with a total counted up to 10,000. | `projectId`, `from`, `to`, `type`, `status`, `cursor` | 1 |
| `get_issue` | One issue: what it is, how often it happens and for how many users, a sample stack trace, the app versions and devices affected, and sample sessions with links. | `issueId` | 1 |
| `get_issue_context` | Everything needed to explain one issue in one call: first and last seen, counts and trend, affected versions, devices and OS versions, the stack, the 30 seconds before the issue in up to 3 example sessions, what those lead-ups have in common, open questions, and the same content as a markdown brief. | `issueId` | 3 |
| `get_crash_context` | One crash, ANR or error: what it was, the device, the stack trace and the session timeline for the 30 seconds before it. | `faultId`, `type` | 4 |

## Arguments

Arguments are validated before any data is read. A call with an unknown argument or a value of the wrong shape is rejected.

- `projectId` comes from `list_projects`.
- `sessionId` comes from `search_sessions`, `sample_sessions`, an example in another result, or a session link in the dashboard.
- `issueId` comes from `list_issues`, `get_project_health`, `find_friction` or `summarize_faults`.
- `faultId` is the id of a single crash, ANR or error. It comes from `get_session_timeline`, `get_session_context` or `summarize_faults`. The optional `type` says which of the three it is, if known.
- `platform` is `ios`, `android`, `web` or `mobile`. `mobile` means iOS or Android.
- `appVersion`, `userId` and `customEventName` match exactly. `screenName` matches the exact name without regard to case. `country` is a two-letter country code or an exact country name.
- `issueType` on the session filters is `crash`, `anr`, `error`, `rage_tap`, `dead_tap` or `slow_start`. A slow start is one that took over 3 seconds.
- `hasReplay` keeps only sessions with (`true`) or without (`false`) a replay that can be opened.
- `type` on `summarize_faults` is required and is `crash`, `anr` or `error`.
- `includeLeadUp` on `summarize_faults` (default `false`) also reads the 30 seconds before the fault in up to 8 sessions and reports what those lead-ups have in common. The sessions are drawn by a stable hash across all the rows read, so large groups appear in proportion and the same call draws the same sessions. Use it for "what are users doing right before these" instead of opening sessions one by one. With it the call costs 5 credits.
- `type` on `list_issues` is `error`, `crash`, `anr` or `rage_tap`, and `status` is `unresolved`, `resolved`, `ignored` or `ongoing`.
- `size` on `sample_sessions` defaults to 25 and can be at most 50. `seed` defaults to 0. Change the seed for a fresh sample.
- `limit` on `get_session_timeline` defaults to 200 events per page and can be at most 500.

Filtering by `userId` is not available while identifier masking is on for the team.

## Results

Every successful result has the same outer shape.

- **Structured data and a text copy.** The result is returned as structured content and as the same JSON in text, followed by a line such as `(took 182 ms, 1 credit)`.
- **A `meta` block.** `tookMs` is the server time for the call, `credits` is what it cost, `truncated` says whether a list was shortened to fit the size cap, and `cached` says whether the result came from a cache.
- **Dashboard links.** Sessions, issues and moments carry a `link` to the Rejourney dashboard. A link to a moment opens the replay at that time. These are the only URLs in a result.
- **A markdown brief.** `get_session_context` and `get_issue_context` also return a `markdown` field with the same content under fixed headings, ready to paste. It is written from the returned data only and contains no causes or advice.
- **Open questions.** The two context tools list what the data cannot show, for example that the timeline is incomplete or that a stack is not symbolicated.

Stack traces are returned as stored. They are not symbolicated, and a stack is limited to 60 frames, with the total number of frames and a `truncated` flag alongside.

The server does not return replay frames. `get_crash_context` has an empty `frames` list and states the reason in `framesUnavailableReason`.

## Paging and cursors

Four tools return pages: `search_sessions`, `list_issues`, `get_session_timeline` and `get_session_digests`.

- A result with more to read has a `nextCursor`. When there is nothing more, `nextCursor` is `null`.
- To read the next page, call the same tool again with `cursor` set to that value and **every other argument unchanged**.
- A page can be shorter than the page size. When a result would exceed the size cap for its credit cost, the server shortens the list, sets `meta.truncated` to `true` and returns a `nextCursor` for the rest.
- Each page is a separate call and is charged separately.
- A cursor is an opaque position marker. It carries no project or access information, so a cursor from another connection cannot widen what a call may read. A cursor that the server cannot read is rejected with `invalid_argument`.

`sample_sessions` is never paged and its `nextCursor` is always `null`. If a sample comes back with `meta.truncated` set, ask for a smaller `size`.

Page order is fixed: `search_sessions` returns the newest sessions first, and `list_issues` returns the most recently seen issues first. Neither order is a random sample. Use `sample_sessions` when you want to draw conclusions about a whole group.

## Time ranges

Tools that take a range use two optional arguments, `from` and `to`.

- Both are ISO 8601 date-times with a time zone, for example `2026-11-20T00:00:00Z` or `2026-11-20T09:00:00+01:00`. A date without a time is rejected.
- `to` is exclusive and defaults to now.
- `from` defaults to 7 days before `to`.
- If you give only `from`, the range runs from there to now, or for 90 days if that is shorter.
- A range can span at most 90 days. `find_friction` accepts at most 30 days.
- `from` must be before `to`.

Each result repeats the range it used in a `range` field, so you can see which defaults were applied.

These are example arguments for `search_sessions`:

```json
{
  "projectId": "3f2b8c1e-6d4a-4b7e-9a51-0c2d7e8f1a34",
  "from": "2026-11-20T00:00:00Z",
  "to": "2026-11-27T00:00:00Z",
  "platform": "ios",
  "issueType": "rage_tap"
}
```

A few details differ by tool:

- `find_friction` compares the range with the period of the same length immediately before it and returns that period as `previousRange`.
- `list_issues` selects issues that were last seen inside the range.
- `get_issue_context` reports a fixed trend: events in the last 7 days, events in the 7 days before, and events per UTC day.
- Times inside a session are seconds since the session started, in the field `t`. `get_session_timeline` takes `fromSeconds` and `toSeconds` in the same unit. All other timestamps are ISO 8601 in UTC.

## Caps and capped counts

Counts and scans are bounded so that a call on a large project stays fast. When a bound is reached the result says so.

A capped count is an object with three fields:

```json
{
  "count": 10000,
  "capped": true,
  "display": "10,000+"
}
```

When `capped` is `true`, `count` is a lower bound and not the total. `display` is the value to show, with a plus sign when capped.

- **List totals stop at 10,000.** This applies to `total` on `search_sessions` and `list_issues`, to `population` on `sample_sessions`, and to the crash, ANR and error counts on `get_project_health`.
- **`get_project_health` reads the most recent 250,000 sessions in the range.** When its session count is capped, the crash-free rate and the other session figures describe those most recent sessions only.
- **`find_friction` reads at most 200,000 sessions, newest first, across the range and the previous period together.** The limit cuts the previous period first. When `previousRangeComplete` is `false`, `previousSessionsInRange` is `null` and the previous shares are computed over the most recent `previousSessionsScanned` sessions of that period: compare shares, not counts. When `rangeComplete` is `false`, the range itself was cut and a shorter range is needed.
- **`summarize_faults` reads at most 50,000 fault rows, newest first.** When `total.capped` is `true`, every figure describes only the most recent rows.

When a result is capped, use a shorter time range or add a filter, and treat the numbers as lower bounds.

`summarize_faults` returns counts of fault rows, not rates. For a rate, divide by the session count from `get_project_health` or `search_sessions` with the same filters.

Larger results are also trimmed to fixed sizes, and each trim is reported in the result:

- `get_session_context` keeps the start and end of a long timeline and every window around a moment, and reports the number of events left out in `timeline.omittedFromMiddle`. It lists at most 20 moments and 5 crash, ANR or error rows, and reports the rest in `momentsDropped` and `faultsOmitted`.
- `get_issue_context` and `get_crash_context` keep the events closest to the fault when a lead-up window holds too many, and set `leadUpDropped` or `eventsDropped`.
- Screen lists set `screensTruncated` when a session visited more screens than are returned.
- Long text values are shortened and end with an ellipsis.

## Event stream status

A session's timeline is built from two sources: the recorded event stream, and the crash, ANR, error and custom event records stored with the session. The field `eventStream` says whether the recorded stream could be read. It appears on `get_session_timeline`, inside `timeline` on `get_session_context` and `get_crash_context`, and on each example of `get_issue_context`.

- `ok`: the recorded events were read in full.
- `none`: no recorded event stream was found for the session. The timeline holds only crashes, ANRs, errors and stored custom events.
- `expired`: the recorded event stream is past retention and has been removed. The timeline holds only crashes, ANRs, errors and stored custom events.
- `partial`: the recorded event stream was too large, or took too long, to read fully. The timeline is incomplete. Asking again a little later often returns the whole stream.

`get_crash_context` has one more value, `no_session`, for a crash, ANR or error whose session is gone. In that case `session` is `null` and the timeline is empty. The stack and device details are still returned.

Replay availability is reported separately. `get_session` returns `replay.available`, and when it is `false`, `replay.unavailableReason` is one of `deleted`, `expired`, `quota_exhausted`, `discarded_by_smart_capture`, `not_saved` or `not_recorded`.

## Timeline event types

`get_session_timeline` accepts these values in `types`, and every timeline event carries one of them in `type`:

- `screen`: a screen or route was shown.
- `tap`: a tap or click, with the label of its target when there is one.
- `rage_tap` and `dead_tap`: frustration taps.
- `input`: text input happened. What was typed is never included.
- `scroll`: a scroll or swipe.
- `network_error`: a request that failed, shown as method, host and path with the status.
- `slow_request`: a successful request that took 3,000 ms or longer.
- `error`, `crash` and `anr`: faults. These events carry a `faultId` you can pass to `get_crash_context`.
- `custom`: a custom event sent by your app.
- `app_state`: start-up, foreground, background, termination and gameplay markers.
- `log`: a console or log line, with its level.

Consecutive identical events are collapsed into one row with a `count`, and `tEnd` holds the time of the last one.

## Errors

A failed call returns an error result with a code, a short message, a `requestId` and, for `busy` and `rate_limited`, the number of seconds to wait. Failed calls are not charged.

- `not_found`: the id does not exist or is outside what this connection may read. The two cases return the same answer.
- `invalid_argument`: an argument is missing, malformed or out of range, for example a range longer than 90 days or an invalid cursor.
- `insufficient_scope`: the connection was not granted the scope the tool needs.
- `access_revoked`: you are no longer a member of the team. Reconnect to Rejourney.
- `busy`: the server has no free capacity, or you already have 4 calls running. Retry after `retryAfterSeconds`.
- `rate_limited`: you made more calls in the last minute than your plan allows. Retry after `retryAfterSeconds`.
- `limit_reached`: the team has used its MCP credits for this billing period, or MCP is paused after a failed payment. The message says when the allowance resets. `list_projects` and `get_usage` keep working.
- `disabled`: a team admin turned MCP off for the team, or Rejourney switched the server or this tool off for now.
- `deadline_exceeded`: the call took longer than 20 seconds and was stopped. Narrow the time range or the filters.
- `result_too_large`: the result cannot be shortened to fit the size cap. Narrow the request.
- `internal`: something went wrong on the server. Quote the `requestId` to support.

Limits, credits and the `busy` answer are described in [Limits and billing](/docs/mcp/limits-and-billing).

## Prompts

The server also publishes three prompts that Claude Code shows as commands: `review_session`, `triage_crash` and `weekly_stability_review`. Each one tells Claude Code which tools to call and in what order. See [Getting started](/docs/mcp/getting-started#built-in-prompts).
