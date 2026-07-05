<!-- AI_PROMPT_SECTION -->
**Using Cursor, Claude, or ChatGPT?** Copy the integration prompt and paste it into your AI assistant to add Rejourney to your Shopify storefront.

<!-- /AI_PROMPT_SECTION -->

> [!IMPORTANT]
> Add every storefront host to **Web allowed domains** in Project Settings before testing. Rejourney will not start on Shopify until the browser origin matches your allowlist.

## Overview

Use Rejourney on Shopify storefronts to capture browser session replay, navigation context, custom commerce events, errors, network timing, and privacy-safe product analytics.

Rejourney supports Shopify in two common setups:

| Shopify setup | Recommended install |
|---|---|
| Headless Shopify storefront | Install `@rejourneyco/browser` in your Hydrogen, Next.js, Remix, or other web app. |
| Shopify custom theme | Install `@rejourneyco/browser` in the theme's storefront JavaScript bundle when the theme has a build step. |

Rejourney does not record inside third-party payment, CAPTCHA, or cross-origin checkout iframes. Treat those areas as blocked by default.

## Before You Start

- Create or open a Rejourney project.
- Copy the project's public key.
- Add your storefront domains to **Project Settings -> Web allowed domains**.
- Decide whether replay starts automatically or waits for consent.

For Shopify, allow the exact customer-facing hosts that load your storefront:

```text
example.com
www.example.com
shop.example.com
*.myshopify.com
```

Use wildcards only when you really serve the same storefront across subdomains.

## Headless Shopify

For Hydrogen, Next.js, Remix, Gatsby, or another headless storefront, install the Web SDK in your app:

```bash
npm install @rejourneyco/browser
```

Then initialize Rejourney from browser-only code:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

If your framework has a dedicated adapter, use that adapter from the [Web SDK guide](/docs/web/getting-started). The Shopify-specific requirements are the same: allowed domains, consent, and privacy masking.

## Shopify Theme Install

For a Shopify theme, put the initialization in a storefront JavaScript source file, bundle it, and load the bundled output from the theme's `assets` directory or a theme app extension app embed.

If your theme uses a build step, import the package from your storefront JavaScript:

```javascript
import { Rejourney } from '@rejourneyco/browser';

void (async () => {
  await Rejourney.init('pk_live_your_public_key', {
    autoStart: false,
  });

  // Start after your consent banner allows analytics/session replay.
  await Rejourney.start();
})();
```

Then load the bundled asset from the Shopify theme:

```liquid
<script src="{{ 'rejourney-shopify.js' | asset_url }}" defer></script>
```

> [!NOTE]
> The npm install is the supported path today. A bare `import { Rejourney } from '@rejourneyco/browser'` pasted directly into Shopify's theme code editor will not work unless your theme build step bundles it first. Do not use unversioned CDN snippets or generic npm CDN imports for a Shopify theme unless your Rejourney deployment explicitly publishes a browser bundle for that install path.

## Consent

`autoStart` is `false` by default. That works well for Shopify because you can initialize early and start recording only after your cookie or privacy banner allows it.

```javascript
await Rejourney.init('pk_live_your_public_key', { autoStart: false });

const startRejourneyIfAllowed = async () => {
  const privacy = window.Shopify?.customerPrivacy;
  if (!privacy || privacy.analyticsProcessingAllowed()) {
    await Rejourney.start();
  }
};

if (window.Shopify?.loadFeatures) {
  window.Shopify.loadFeatures(
    [{ name: 'consent-tracking-api', version: '0.1' }],
    (error) => {
      if (!error) void startRejourneyIfAllowed();
    },
  );
} else {
  void startRejourneyIfAllowed();
}

document.addEventListener('visitorConsentCollected', () => {
  if (window.Shopify?.customerPrivacy?.analyticsProcessingAllowed()) {
    void Rejourney.start();
  } else {
    Rejourney.setConsent({ analytics: false, replay: false });
  }
});
```

If consent is later revoked, stop capture:

```javascript
Rejourney.setConsent({ analytics: false, replay: false });
```

## Commerce Events

Send stable commerce events so session replay connects to funnel and revenue analysis.

```javascript
Rejourney.logEvent('product_view', {
  productId: product.id,
  title: product.title,
});

Rejourney.logEvent('add_to_cart', {
  productId: variant.productId,
  variantId: variant.id,
  quantity: 1,
});

Rejourney.logEvent('checkout_started', {
  amount: cart.totalPrice,
  currency: cart.currencyCode,
});

Rejourney.logEvent('purchase_completed', {
  orderId: order.id,
  transactionId: order.checkoutToken,
  amount: order.totalPrice,
  currency: order.currencyCode,
});
```

Use `purchase_completed` only when the order is actually complete. Client events are useful for replay context, but your server-side order webhook is still the best source for authoritative revenue.

## Customer Identity

Use your internal Shopify customer ID, not a raw email address.

```javascript
if (customer?.id) {
  Rejourney.setUserIdentity(String(customer.id));
}
```

Hash emails before sending them if you need email-based lookup.

## Privacy Controls

All text inputs are masked by default. Add explicit masks or blocks around customer, payment, discount, and account areas.

```html
<div data-rj-mask>
  {{ customer.email }}
</div>

<div data-rj-block>
  Sensitive checkout or payment content
</div>

<div data-rj-ignore>
  Interaction-only widget that should not emit click/input events
</div>
```

Useful defaults for Shopify themes:

- Mask customer account details.
- Block payment, address, and authentication widgets.
- Avoid capturing cart notes if shoppers can enter personal data.
- Keep console log capture off if your theme logs customer or order data.

```javascript
await Rejourney.init('pk_live_your_public_key', {
  trackConsoleLogs: false,
  maskTextSelector: '[data-rj-mask], [data-rejourney-mask], [data-private], .customer-address, .customer-email',
  blockSelector: '[data-rj-block], [data-rejourney-block], .payment-widget',
});
```

## Checkout Limits

Shopify checkout and payment providers may run on domains or frames your theme cannot control. Rejourney records the pages where the Web SDK is loaded and allowed, but it cannot inspect third-party iframe DOM.

For checkout, prefer event instrumentation:

- `checkout_started` before leaving the cart.
- `payment_failed` when your storefront receives a recoverable failure.
- `purchase_completed` after confirmed order completion.
- Server-side webhook data for final revenue truth.

## Verify

1. Open your storefront in a normal browser tab.
2. Confirm the storefront host is in **Web allowed domains**.
3. Accept consent if your site requires it.
4. Browse product, cart, and account pages.
5. Trigger one custom event such as `product_view` or `add_to_cart`.
6. Open Rejourney and check that the session appears with platform `web`.

If the SDK does not start, check the browser console for a domain allowlist warning and verify that your host matches exactly, including subdomain and port for local development.
