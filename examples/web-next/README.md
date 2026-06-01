# Rejourney Web Next Example

Minimal Next.js fixture for `@rejourneyco/browser/next`.

```bash
npm install
npm run dev
```

Configure `.env.local` from `.env.example`, then open the app on port `3100`.
The dev/build/start scripts rebuild `../../packages/browser` first so local web
SDK changes are reflected when the command starts.

The home page includes a Brew-style media replay lab with local images, a native
browser video, and a nested video button using the same demo clip/poster as
`examples/brew-coffee-labs`. Project privacy settings now flow through the web
SDK too: set **Image and video masking** to **Mask Images and Videos** to make
rrweb block media nodes and scrub serialized media URLs. Individual web nodes can
also be marked with `data-rj-mask-media` or `data-rejourney-mask-media`.

For local device testing, open the app with your machine's LAN IP instead of
`localhost`, just like the mobile examples:

```bash
ipconfig getifaddr en0
npm run dev
```

If your IP is `192.168.1.25`, open `http://192.168.1.25:3100`. When
`NEXT_PUBLIC_REJOURNEY_API_URL` is blank, the example automatically points the
SDK at `http://192.168.1.25:3000`. Add `192.168.1.25:3100` to the project's
web allowed domains.
