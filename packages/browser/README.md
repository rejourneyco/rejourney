# @rejourneyco/browser

Web analytics and rrweb-powered session replay for Rejourney.

```ts
import { initRejourney, startRejourney } from '@rejourneyco/browser';

initRejourney('rj_xxxxxxxxxxxx', {
  apiUrl: 'https://api.rejourney.co',
  autoStart: false,
});

startRejourney();
```

The package does not access browser globals at module import time. Call `initRejourney`
and `startRejourney` from browser-only code after consent when your site requires it.
