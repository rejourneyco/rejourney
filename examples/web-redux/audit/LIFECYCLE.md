# Web session lifecycle verification

- Project: Redux Commerce Lab (`85313cde-4a08-43f0-aa50-31f72d608ce4`)
- Session: `session_1784227670566_a1867622bdb5649a78a4f1618f81a875`
- Browser: Chrome
- Test flow: Overview → Products → cart mutation → Cart → Orders → close the only app tab
- Manual session finalization: none

## Observations

| UTC time | Observation |
|---|---|
| 18:47:50 | Session created as `processing`; live replay artifacts began ingesting. |
| 18:49:37 | While the tab was open, `last_ingest_activity_at` advanced and the replay reached 6 ready segments. |
| 18:49:57 | Final ingest activity after tab closure; the replay reached 8 ready rrweb segments. |
| 18:51:08 | More than 60 seconds idle: no additional ingest activity. |
| 18:52:12 | More than two minutes idle: no additional ingest activity. |
| 18:53:19 | Final poll: activity timestamp and segment count were still unchanged. |

## Dashboard presentation result

The production `deriveSessionPresentationState` resolver was executed against the
live row and its current artifact aggregate. It returned:

```json
{
  "effectiveStatus": "processing",
  "isLiveIngest": false,
  "isBackgroundProcessing": false,
  "canOpenReplay": true,
  "hasPendingWork": false,
  "hasPendingReplayWork": false,
  "isIdle": true,
  "shouldFinalize": false
}
```

This is the intended web behavior: the dashboard stops labeling the replay as
live after the 60-second ingest window, while the underlying web session remains
within the 30-minute continuation/finalization window.

## Shared browser integration path

The Redux example uses the same `Rejourney` browser singleton as the Next.js,
React, Remix, Vue, Nuxt, Svelte, Astro, Angular, and Gatsby integrations. Redux
capture only adds timeline events through `logEvent`; it does not own or alter
session lifecycle behavior.

Next.js, React, and Remix intentionally do not stop the singleton during ordinary
component cleanup, so route transitions and development remounts do not split a
session. Svelte's mount helper is the explicit-teardown exception: its returned
cleanup calls `Rejourney.stop()` when the integration itself is unmounted.

## Focused automated verification

- Browser SDK lifecycle/config/tab-session/Redux tests: 22 passed.
- Backend presentation/evidence/project-duration tests: 42 passed.
