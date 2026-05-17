# @rejourneyco/browser Release Notes

## 0.1.0 - 2026-05-17

First public release of the Rejourney web SDK.

### Added

- Browser analytics and rrweb-powered session replay capture for web projects.
- Framework adapters for React, Next.js, Vue, Nuxt, SvelteKit, Angular, Remix, Astro, and Gatsby.
- Web SDK remote configuration, including project enablement, recording enablement, session duration, sample rate, and allowed domain controls.
- Privacy controls for replay masking, including default all-input masking and secure-fields-only mode.
- Automatic route, interaction, network, startup, long task, resource error, console log, and attribution telemetry.
- Replay upload queueing with retry support for transient connectivity and ingest failures.
- Local web examples for Next.js, Nuxt, and SvelteKit.

### Notes

- This is the first release for `@rejourneyco/browser`; there are no prior migration steps.
- Package is in open-beta. Please report any issues to the repository 
