# Rejourney Web Next Example

Minimal Next.js fixture for `@rejourneyco/browser/next`.

```bash
npm install
npm run dev
```

Configure `.env.local` from `.env.example`, then open the app on port `3100`.

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
