# @rejourneyco/browser Release Notes

## 0.4.0 - 2026-06-02

### Added

- Image and video privacy controls for web replays. Project Settings can now enable media masking so images, videos, canvases, SVG images, and background images are hidden from replay capture while normal page layout remains visible.
- Explicit media masking hooks for sensitive page areas: add `data-rj-mask-media` or `data-rejourney-mask-media` to block a specific media element without changing the project-wide default.
- Cleaner network timelines for self-hosted deployments that serve Rejourney behind a base path, such as `https://example.com/rejourney`, so SDK config, ingest, and upload calls stay out of your app's captured API traffic.

### Fixed

- Prevents presigned replay upload URLs from appearing as app network requests after the SDK receives a storage upload target.
- Scrubs media URLs from serialized replay snapshots when image/video masking is enabled, including `src`, `srcset`, `poster`, `href`, `xlink:href`, `data`, `rr_dataURL`, `alt`, `title`, `aria-label`, and CSS `background-image` URLs.
- Keeps ordinary app routes such as `/api/orders` visible in network capture while still hiding Rejourney's own internal routes under self-hosted API base paths.

## 0.3.0 - 2026-05-29

### Added

- Dynamic UTM attribution capture for web sessions, including `utm_source`, `utm_medium`, `utm_campaign`, `utm_id`, `utm_term`, `utm_content`, `utm_source_platform`, `utm_creative_format`, and `utm_marketing_tactic`.
- Stronger referral tracking for web sessions, with referrer domain capture, channel classification, and safer redaction of sensitive referrer/query values.
- Automatic host app version detection from page globals, metadata, manifests, and same-origin version files, so `appVersion` reflects the developer's website/app when available instead of the SDK package version.

### Fixed

- Preserves first-touch UTM/referral data when cookie consent banners delay SDK startup and the site later cleans or replaces the URL before recording begins.
- Handles delayed `init()` and delayed `start()` flows more reliably by keeping the strongest available attribution snapshot when the SDK bundle loads before consent acceptance.
- Allows `beforeSendAttribution` to drop attribution by returning `null`.

## 0.2.0 - 2026-05-21

### Added

- UTM tracking for web replays, including first-touch campaign metadata and referral attribution.
- Console Logs For Every Replay, with browser console output captured as replay timeline events by default.
- JS API Call Tracking for `fetch` and `XMLHttpRequest` requests, including timing, method, status, and URL telemetry.

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
