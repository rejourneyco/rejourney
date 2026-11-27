MCP usage is metered in credits. Every plan includes a monthly allowance, there are no overage charges, and the two tools you need to check your usage are free. This page covers how calls are charged, what each plan includes, the rate limits, and how fast you can expect answers.

## Credits

A credit is the unit of MCP usage. Each tool has a fixed credit cost, listed in the [tool reference](/docs/mcp/tools).

- The cost of a call is known before it runs. It depends on the tool and, for `get_session_digests`, on how many sessions you ask for.
- `list_projects` and `get_usage` cost 0 credits.
- Most tools cost 1 credit. The tools that return more in one call cost more: `find_friction` and `summarize_faults` cost 2 (`summarize_faults` costs 5 when it also reads the lead-up), `get_session_context` and `get_issue_context` cost 3, and `get_crash_context` costs 4.
- `get_session_digests` costs 1 credit plus 1 for every 10 sessions, rounded up. Ten sessions cost 2 credits and fifty cost 6.
- A call that returns an error is not charged.
- Fetching the next page of a result is a new call and is charged again.

Some typical jobs, added up from the tool costs:

- Reviewing one session with `get_session_context`: 3 credits.
- Triaging one issue with `get_issue_context`: 3 credits.
- Reading a random sample of 50 sessions with `sample_sessions` and `get_session_digests`: 7 credits.
- A weekly stability review with the built-in prompt: about 20 credits.

## The size rule

No response is larger than 40 KB, whatever the call costs.

The 40 KB ceiling exists because the result is read by Claude Code. Clients set aside or refuse tool results beyond roughly 25,000 tokens, and a result that large would also fill its context. The tools that explain a session or an issue shrink their own output to about 32 KB: they shorten the plain timeline first and keep the moments where something went wrong. `get_session_timeline` has every event, a page at a time.

When a result with a list would be larger than its cap, the server shortens the list to the items that fit, sets `meta.truncated` to `true` and returns a `nextCursor` for the rest. It never cuts an item in half. If a result cannot be shortened to fit, the call fails with the error code `result_too_large` and you are asked to narrow the request.

A call is never charged more because its result was large.

## Allowance per plan

| Plan | MCP credits per month |
|---|---|
| Free | 300 |
| Starter | 2,000 |
| Growth | 6,000 |
| Pro | 20,000 |
| Scale | 75,000 |
| Enterprise | Custom |

The allowance follows the same rules as your replay allowance:

- On paid plans the allowance belongs to the team. Everyone who connects to that team draws from it.
- On the Free plan the allowance is pooled per account owner across all of that owner's free teams. Creating more free teams does not add credits.
- The allowance resets at the start of each billing period.

## Check your usage

Ask Claude Code how many credits are left. It calls `get_usage`, which is free and returns the credits used, the limit, the credits remaining and the time the allowance resets.

The **MCP** page in the dashboard shows the same figures with a breakdown by tool, and its **Activity** view lists recent calls with the tool, the user, the credits, the time and the outcome.

Rejourney sends an email when a team reaches 80% of its allowance and another at 100%.

## At the limit

When the allowance is used up:

- Tools that cost credits return an error result that states the credits used, the limit, the date the allowance resets and a link to upgrade.
- `list_projects` and `get_usage` keep working, so Claude Code can still explain what happened.
- Nothing is charged beyond the allowance. There are no overage charges.

Calls work again when the allowance resets or when the team moves to a plan with a larger allowance.

If a payment on the team's subscription has failed, tools that cost credits are refused with `limit_reached` until billing is fixed. `list_projects` and `get_usage` keep working.

## Rate and concurrency limits

These limits protect recording and the dashboard, which share the same systems as MCP.

- **Calls per minute.** Each user has a per-minute call limit set by the team's plan: 10 on Free, 20 on Starter, 30 on Growth, 60 on Pro and 120 on Scale.
- **Calls at the same time.** A user can have at most 4 calls running at once.
- **Server capacity.** The server runs a fixed number of tool calls at once. A call that finds every slot taken waits up to 1.5 seconds for one, then answers `busy`.
- **Per IP address.** Requests are rate limited per IP address before sign-in is checked.
- **Request size.** A request body can be at most 256 KB.
- **Call deadline.** A call that has not finished after 20 seconds is stopped and returns the error code `deadline_exceeded`. Narrow the time range or the filters and try again. Cancelling a call from Claude Code stops its work on the server.

When Rejourney's databases are under pressure, MCP calls are refused first so that recording and the dashboard are not slowed down.

## The busy answer

When the server has no free capacity, a call waits up to 1.5 seconds for a free slot. If none frees up, it answers with an error result that tells Claude Code when to try again:

```json
{
  "error": {
    "code": "busy",
    "message": "The server is busy. Retry in 2 seconds.",
    "requestId": "req_4be1c0d2a6f34c1f9a7d5e8b3c2f1a09",
    "retryAfterSeconds": 2
  }
}
```

A `busy` answer is not charged. Repeat the call after the number of seconds in `retryAfterSeconds`.

Every error result carries a `requestId`. Quote it if you contact support about a failed call.

## Response times

Every result says how long it took, and you can check the recent speed of your own connection.

- **Every result reports its time and cost.** The `meta` block of a result holds `tookMs`, `credits`, `truncated` and `cached`, and the text copy of the result ends with a line such as `(took 182 ms, 1 credit)`. `cached` is `true` when the result came from a cache.
- **Your connection's recent speed is available on request.** `get_usage` returns the median and the 95th-percentile response time of the most recent successful calls on your connection, up to the last 100.
- **The dashboard shows the same.** The MCP page shows the response time of each call in Activity, and the median and 95th percentile next to the allowance.

What to expect, measured on real projects with several clients working at once:

- **Tools that read only the database** (`list_projects`, `get_usage`, `get_session`, `get_issue`, `list_issues`, `search_sessions`, `get_session_digests`, and most `summarize_faults`, `sample_sessions` and `get_project_health` calls) answer in tens of milliseconds, up to about a second over long ranges on a busy project.
- **`find_friction`** reads every session of two periods and takes about 0.2 to 2 seconds.
- **Tools that read a session's recorded events** (`get_session_timeline`, `get_session_context`, `get_issue_context`, `get_crash_context`, and `summarize_faults` with the lead-up) take about 0.3 to 1.5 seconds, and a few seconds for a long session. A session read a moment ago is answered from memory in milliseconds.

The median across all tools was about 180 ms and the 95th percentile about 3.4 seconds. The hard limit for any call is the 20-second deadline. Recorded events that cannot be read within about 9 seconds come back marked `partial` rather than failing the call.

```json
{
  "meta": {
    "tookMs": 182,
    "credits": 1,
    "truncated": false,
    "cached": false
  }
}
```

The time in `tookMs` is measured on the server, from receiving the arguments to the finished result. It does not include the network or the time Claude Code spends reasoning.
