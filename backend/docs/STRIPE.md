# Stripe Billing

How Stripe is used in this backend and how to work with it.

---

## What Stripe Does Here

- **Plans** come from Stripe **Products** and **Prices** (no hardcoded plans in code).
- **Teams** are billed per **subscription**; session limits come from Price metadata.
- **Free tier** (5,000 sessions) is tracked in-app; paid plans are Stripe subscriptions.
- **Payment methods** are collected in-app (Stripe Elements) or via Stripe Billing Portal.
- **Webhooks** keep the database in sync with Stripe (subscriptions, invoices, payment methods).

When Stripe is disabled (e.g. self-hosted), the app still runs with the free tier only.

---

## Key Concepts

| Concept | Role in this app |
|--------|-------------------|
| **Customer** | One per team. Created when billing is first set up. Stored as `teams.stripeCustomerId`. |
| **Product** | A plan (e.g. "Starter", "Growth"). Has one or more Prices. |
| **Price** | Recurring price for a plan. **Must have** `metadata.session_limit` (used for quotas). Optional: `metadata.plan_name`, `metadata.sort_order`, `metadata.is_custom`. |
| **Subscription** | Links a Customer to a Price. Stored as `teams.stripeSubscriptionId` and `teams.stripePriceId`. |
| **Webhook** | Stripe sends events to our API; we update DB (subscription state, payment failed, etc.). |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | For billing | Secret key (`sk_...`). Backend only; never expose to frontend. |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Signing secret (`whsec_...`) for `POST /api/webhooks/stripe`. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | For frontend | Publishable key (`pk_...`) for Stripe.js / Elements (env in dashboard, not backend). |

If `STRIPE_SECRET_KEY` is unset or empty, Stripe is disabled (e.g. self-hosted). Webhooks return 503 when Stripe is disabled.

---

## Stripe Dashboard Setup

### Products and Prices

1. **Products**: Create one product per plan (e.g. "Starter", "Growth", "Pro").
2. **Prices**: For each product, create a recurring Price (monthly or yearly).
3. **Price metadata** (required for plans to be used):
   - `session_limit` – integer, e.g. `10000`, `50000`. Used as the team’s session cap.
   - Optional: `plan_name` (e.g. `starter`), `sort_order`, `is_custom` (`true`/`false`).

Only Prices that have `session_limit` are treated as billing plans; others are ignored.

### Webhook

1. In Stripe Dashboard: Developers → Webhooks → Add endpoint.
2. URL: `https://your-api-host/api/webhooks/stripe`.
3. Select events (or “Send all events” for simplicity). We use at least:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `payment_method.attached`
   - `payment_method.detached`
4. Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET`.

**Important:** The webhook route must receive the **raw body** (no JSON body parser) so the signature can be verified. The app uses Express `raw({ type: 'application/json' })` for that route.

---

## Backend Layout

| Path | Purpose |
|------|--------|
| `src/services/stripe.ts` | Stripe client, customers, payment methods, subscriptions, portal, webhook verification and **event handlers**. |
| `src/services/stripeProducts.ts` | Plans from Stripe (Products/Prices), team subscription state, plan change preview/execute, checkout session creation. |
| `src/utils/billing.ts` | Pure helpers: session usage math, free tier constants, billing period from anchor, formatting. No Stripe API calls. |
| `src/routes/stripeBilling.ts` | Billing API: status, setup, payment methods, portal, plans, plan preview/change, free tier. |
| `src/routes/stripeWebhooks.ts` | `POST /api/webhooks/stripe`: raw body, signature check, delegate to `handleWebhookEvent`. |

---

## Flows

### 1. Enabling billing for a team

1. User goes to Billing and clicks “Set up billing”.
2. Frontend calls `POST /api/teams/:teamId/billing/stripe/setup`.
3. Backend creates (or reuses) a Stripe Customer, saves `stripeCustomerId` on the team.
4. User adds a payment method (in-app via SetupIntent + Elements, or later in Stripe Portal).

### 2. Adding a payment method in-app

1. Frontend requests `POST /api/teams/:teamId/billing/stripe/setup-intent` → gets `clientSecret`.
2. Stripe Elements uses that to collect card (or Link); no card data hits our server.
3. Frontend sends `paymentMethodId` to `POST /api/teams/:teamId/billing/stripe/payment-methods`.
4. Backend attaches the payment method to the customer and sets it as default; saves `stripePaymentMethodId` on the team.

### 3. Subscribing / changing plan

1. **Preview:** `POST /api/teams/:teamId/billing/plan/preview` with `planName` (or price id) → upgrade/downgrade/same, proration, warnings.
2. **Execute:** `PUT /api/teams/:teamId/billing/plan` with `planName` and `confirmed: true`.
3. **New subscription:** Stripe subscription is created for the team’s customer and default payment method.
4. **Upgrade:** Subscription is updated to the new price, billing cycle anchor reset to “now”, session usage for the new period cleared.
5. **Downgrade:** Subscription schedule is used so the new price applies at period end; anchor is not changed.

Plan names are resolved to Stripe Price IDs via `getStripePlan()` (from Products/Prices with `session_limit` metadata).

### 4. Webhooks keeping the app in sync

- **checkout.session.completed** – Store `subscription_id` on the team when checkout was used.
- **customer.subscription.created** – Set `billingCycleAnchor`, `stripePriceId`, subscription id.
- **customer.subscription.updated** – Update price and anchor (upgrades reset anchor; downgrades keep it).
- **customer.subscription.deleted** – Clear subscription and price on team; team reverts to free tier.
- **invoice.paid** – Clear `paymentFailedAt`; optional period/invoice status updates.
- **invoice.payment_failed** – Set `paymentFailedAt` (recording can be blocked until fixed).
- **payment_method.attached / detached** – Update or clear `stripePaymentMethodId` when the default method changes in Stripe.

Events are stored (e.g. in `stripe_webhook_events`) so each event is processed only once (idempotency).

---

## Billing cycle and usage

- **Anchor:** A team’s billing cycle is 30 days from `teams.billingCycleAnchor` (set when they first get a subscription; reset on upgrade).
- **Usage:** Session usage is aggregated per team per billing period (see `getTeamBillingPeriod` / `getTeamBillingPeriodDates` in `src/utils/billing.ts`).
- **Free tier:** 5,000 sessions per user across all their free teams (no Stripe); tracked in-app.

---

## Testing

- Use Stripe **test keys** (`sk_test_...`, `pk_test_...`) and test mode webhook secret.
- Stripe CLI can forward webhooks: `stripe listen --forward-to localhost:PORT/api/webhooks/stripe`.
- Test cards: <https://stripe.com/docs/testing#cards>.

---

## Security

- **Secret key** is server-only; never send to the browser.
- **Publishable key** is safe for frontend (Stripe.js, Elements).
- **Webhook signature** must be verified using `STRIPE_WEBHOOK_SECRET`; the webhook route uses the raw body for this.
- In-app payment collection uses SetupIntent + Elements so we never see full card numbers.
