# Browser SDK 0.4.0

Published to npm as `@rejourneyco/browser@0.4.0`.

## Highlights

- Adds dashboard-controlled image and video privacy for web replays. When image/video masking is enabled, Rejourney blocks page media from visual replay capture while preserving the surrounding page layout so the replay is still useful for debugging.
- Adds explicit media masking attributes for one-off sensitive areas. Use `data-rj-mask-media` or `data-rejourney-mask-media` on images, videos, canvases, SVG images, or background-image containers you always want hidden.
- Masks media URLs at the source when media privacy is enabled. Replay snapshots scrub image/video attributes such as `src`, `srcset`, `poster`, `href`, `xlink:href`, `data`, `rr_dataURL`, `alt`, `title`, and `aria-label`, and replace CSS background images with `background-image: none`.
- Improves self-hosted network capture. If your API URL includes a base path, Rejourney now hides only its own config, ingest, and upload calls under that path while keeping your application API traffic visible.
- Keeps presigned replay upload URLs out of captured app network logs after the SDK receives an upload destination.

## Compatibility

- No breaking API changes.
- Image/video masking is off by default, so existing web replays continue to show media unless you enable the new privacy setting.
- Existing text input masking, `rr-block`, `rr-mask`, and custom privacy selectors continue to work as before.

## Upgrade

```bash
npm install @rejourneyco/browser@0.4.0
```
