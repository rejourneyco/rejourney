This page lists questions that work well with the Rejourney MCP server, grouped by the job you are doing. Each one names the tools Claude Code will typically call and what the calls cost. Claude Code chooses the tools itself, so the exact sequence can differ.

## How answers are produced

The server and Claude Code do different parts of the work.

- **The server finds things by fixed rules.** It counts sessions, groups crashes, picks example sessions and marks the moments in a session where something went wrong. The rules are the same on every call and no AI model is involved.
- **The server returns evidence.** Results carry counts with their denominators, timelines, stack traces and links that open the session, the issue or the exact moment in the replay on rejourney.co.
- **Claude Code draws the conclusions.** Causes, priorities and recommendations come from Claude Code and the model it uses, not from Rejourney. Ask it to cite the links so you can check its reading against the replay.

The larger results also include a list of open questions: plain statements of what the data cannot show, such as a timeline that is incomplete or a common pattern that rests on three sessions. A careful client repeats those limits in its answer.

## Health check

Start here when you want the state of a project before looking at anything in detail.

```text
How stable was the Acme iOS project over the last 7 days? Give me the crash-free session rate and the top issues.
```

Typical tools: `list_projects` to find the project id, then `get_project_health`. Cost: 1 credit.

```text
Write a stability review of the last week for Acme iOS: crash-free rate, where users struggled, what is new, and three things to fix first.
```

Typical tools: `get_usage`, `find_friction`, `get_project_health`, then `get_issue_context` or `get_session_context` for the two or three largest groups. This is what the built-in `weekly_stability_review` prompt does. Cost: about 20 credits.

```text
List the unresolved crashes seen in the last 14 days, most recent first.
```

Typical tools: `list_issues` with a type and a status. Cost: 1 credit per page of 25.

## Crash and ANR investigation

Use these when you have an issue in front of you and want to know who it affects and what leads up to it.

```text
Explain this issue: who is affected, what the stack says, and what users were doing before it. <issue link>
```

Typical tools: `get_issue_context`. One call returns the counts and trend, the affected versions, devices and OS versions, the stack, and the 30 seconds before the issue in up to three example sessions. It also lists the screens and events present in more than half of those lead-ups and states how many sessions were sampled. The built-in `triage_crash` prompt starts the same way. Cost: 3 credits.

```text
Why are we getting ANRs? Break down this week's ANRs by signature, device and OS version, and show me what happened before one of them.
```

Typical tools: `summarize_faults` for ANRs, then `get_crash_context` for one of the example faults. The summary groups the ANRs by signature, counts them by app version, platform, OS version, device and day, and reports how long the main thread was blocked. It reads every ANR in the range, including those that belong to no issue. Cost: 6 credits.

```text
Which app versions and devices does this crash affect? List three sessions where it happened. <issue link>
```

Typical tools: `get_issue`. Cost: 1 credit.

## A single session

Paste a session link from the dashboard, or give the session id.

```text
Review this session and tell me what the user did, where they got stuck, and what to fix first: <session link>
```

Typical tools: `get_session_context`. One call returns the session facts, the screens in order with the time on each, a condensed timeline, each moment where something went wrong with the 10 seconds before it, stacks, and a link that opens the replay at each moment. The built-in `review_session` prompt starts the same way. Cost: 3 credits.

```text
Why did this session crash? Show the stack and what the user did just before: <session link>
```

Typical tools: `get_session_context`, then `get_issue_context` if the crash belongs to a known issue and you want to know whether other sessions share the lead-up. Cost: 3 to 6 credits.

```text
Show me every failed request and error in this session between minute 2 and minute 4.
```

Typical tools: `get_session_timeline` with a time window and event types. Cost: 1 credit per page.

## Friction

Use these to find where users struggle when nothing has crashed.

```text
Where are users struggling in Acme iOS this week, and is it better or worse than last week?
```

Typical tools: `find_friction`. It ranks friction groups, gives the share of sessions each one affects with the number of sessions it was measured against, and compares each group with the previous period of the same length. Cost: 2 credits.

```text
Find sessions from the last 7 days with rage taps on the Checkout screen and summarise what went wrong in three of them.
```

Typical tools: `search_sessions` with an issue type and a screen name, then `get_session_context` for three sessions. Cost: 10 credits.

```text
Take a random sample of 50 sessions from the last 7 days and list the most common friction points.
```

Typical tools: `sample_sessions`, then `get_session_digests` for the sampled ids. A random sample lets the answer describe the whole group rather than the newest sessions. Cost: 7 credits.

## Version and platform comparison

Use these after a release, or when one platform looks worse than another.

```text
Compare friction on version 4.2.0 with 4.1.0 over the last 14 days.
```

Typical tools: `find_friction` twice, once per app version. Cost: 4 credits.

```text
Do iOS and Android users hit different problems in Acme? Use the last 30 days.
```

Typical tools: `find_friction` twice, once per platform. Each group also lists the app versions and platforms of its affected sessions. Cost: 4 credits.

```text
Did crashes get worse in 4.2.0? Compare it with 4.1.0 over the last 14 days.
```

Typical tools: `summarize_faults` for crashes, which counts them by app version, then `search_sessions` once per version for the session counts needed to turn those counts into rates. Cost: 4 credits.

## The rules the server uses

A session counts towards a friction group in `find_friction` when it meets one of these fixed conditions:

- `rage_taps`: more than 3 rage taps in the session.
- `dead_taps`: at least 1 dead tap.
- `api_errors`: at least 1 failed API call.
- `slow_start`: app start-up took longer than 3,000 ms.
- `slow_api`: the session's average API response took longer than 1,000 ms.
- `error_burst`: at least 3 errors.
- `crash` and `anr`: at least one.
- `short_session_after_error`: an error or a failed API call in a session shorter than 30 seconds.

Inside one session, `get_session_context` marks these moments:

- A cluster of rage taps no more than 5 seconds apart on one screen.
- Every dead tap, failed request, error, crash and ANR.
- Every request that took 3,000 ms or longer.
- A stuck loop: the same screen entered 3 times within 60 seconds, or the same target on one screen tapped 4 times within 30 seconds.
- An abandonment after an error: the session's last event comes within 10 seconds of a failed request, error, rage tap or dead tap, and the session did not end in a crash or ANR.

Example sessions are picked by a stable hash of the session id, not by severity. You get typical sessions rather than the worst ones, and the same question returns the same examples.

## Getting better answers

- **Name the project and the time range.** Without a range, tools use the last 7 days. A range can span at most 90 days, and 30 days for `find_friction`.
- **Give a link or an id for a single session or issue.** It saves a search.
- **Ask for a sample when you want to generalise.** `search_sessions` returns the newest sessions first, which is not a fair picture of a group. `sample_sessions` is.
- **Ask for the denominator.** Shares are of the sessions in the range. A count shown as `10,000+` is a lower bound. `summarize_faults` returns counts, not rates, so a comparison between versions or platforms also needs their session counts.
- **Ask the client to cite links.** Every session, issue and moment in a result has a link you can open to check the claim.

## What the data cannot show

- **No screen images.** The server does not return replay frames. Claude Code reads the timeline, and you watch the replay through the links.
- **Stack traces are as stored.** They are not symbolicated, so minified or obfuscated frames stay that way.
- **Some friction cannot be tied to a screen.** Rage taps, dead taps, failed API calls, slow starts, slow API responses and short sessions after an error are counted per session, so the data says that a session had the problem and not where in the app. Crashes, ANRs and error bursts are backed by individual events and can point to an issue or a screen.
- **Typed text, tap coordinates and successful requests are not included** in timelines. Requests appear when they fail or take 3,000 ms or longer.
- **Old sessions lose detail.** When a session's recorded events pass your plan's retention, the timeline keeps only crashes, ANRs, errors and stored custom events. See [Tool reference](/docs/mcp/tools#event-stream-status).
