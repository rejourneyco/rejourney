# Stripe Billing Architecture

This document describes how Rejourney integrates with Stripe for billing, subscription management, and payment processing.

## High-Level Billing Flow

┌──────────────┐      ┌─────────────────────────────┐      ┌─────────────────┐
│  Dashboard   │─────▶│      API Backend            │─────▶│     Stripe      │
│  (Web UI)    │      │    (Billing Routes)         │      │      (API)      │
└──────────────┘      └──────────────┬──────────────┘      └────────┬────────┘
                                     │                              │
                                     │ 2) Webhook Response          │ 1) Trigger
                                     │    (Update DB)               │    Event
                                     ▼                              ▼
                      ┌────────────────────────────────────────────────────┐
                      │             Database (PostgreSQL)                  │
                      │         teams / stripe_webhook_events              │
                      └────────────────────────────────────────────────────┘

## Billing Infrastructure

┌──────────────────────────────────────────────────────────────────────────────┐
│                                Billing Logic                                 │
│                                                                              │
│  ┌────────────────────────┐          ┌────────────────────────────────────┐  │
│  │      Client Side       │          │          Server Side (Node)        │  │
│  │ ┌──────────────────┐   │          │  ┌──────────────┐    ┌────────────┐│  │
│  │ │ Stripe Elements  │◀──┼──────────┼──┤ stripeBilling│◀───┤ stripe.ts  ││  │
│  │ └───────┬──────────┘   │          │  │   (Routes)   │    │ (Service)  ││  │
│  └─────────┼──────────────┘          │  └──────┬───────┘    └─────┬──────┘│  │
│            │                         └─────────┼──────────────────┼───────┘  │
│            │            API Calls              │                  │          │
│  ┌─────────▼──────────────┐          ┌─────────▼──────────────────▼───────┐  │
│  │     Stripe JS SDK      │          │           Business Models          │  │
│  │ ┌──────────────────┐   │          │  ┌──────────────┐    ┌────────────┐│  │
│  │ │ Setup / Payment  │   │          │  │ billing.ts   │    │ products.ts││  │
│  │ │     Intents      │   │          │  │ (Usage/Math) │    │ (Plans/IDs)││  │
│  │ └──────────────────┘   │          │  └──────────────┘    └────────────┘│  │
│  └────────────────────────┘          └────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

## External Beyond: Connectivity

                        ┌────────────────────────┐
                        │      Stripe Cloud      │
                        │ (Products/Prices/Subs) │
                        └────────────┬───────────┘
                                     │
                        ┌────────────▼───────────┐
                        │   Stripe Webhooks      │
                        │  (/api/webhooks/stripe)│
                        └────────────┬───────────┘
                                     │
              ┌──────────────────────┴───────────────────────┐
              │                                              │
      ┌───────▼────────┐                             ┌───────▼────────┐
      │  Subscription  │                             │  Payment Status│
      │    Updated     │                             │  (Paid/Failed) │
      └───────┬────────┘                             └───────┬────────┘
              │                                              │
        ┌─────▼───────────┬─────────────────┬────────────────▼──────────┐
        │                 │                 │                           │
┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼────────┐        ┌─────────▼────────┐
│  Update Team  │ │ Reset Usage   │ │ Update Payment │        │ Send Alerts      │
│  (Price ID)   │ │ (Anchor)      │ │ Method ID      │        │ (On Failure)     │
└───────────────┘ └──────────────┘ └────────────────┘        └────────────────────┘

## Core Concepts

| Component | Description | Visual Mapping |
|-----------|-------------|----------------|
| **Customer** | Linked to Rejourney Team | `teams.stripeCustomerId` |
| **Product** | The Plan (Starter, Growth, etc.) | Stripe Dashboard Product |
| **Price** | Recurring cost + Quotas | `metadata.session_limit` (Required) |
| **Subscription** | Current Team Status | `teams.stripeSubscriptionId` |

## Key Sequences

### 1. Subscription Setup
1. **Frontend**: Requests `SetupIntent` -> **Backend**: Calls Stripe for `clientSecret`.
2. **Frontend**: Collects card via Stripe Elements -> **Stripe**: Returns `paymentMethod`.
3. **Frontend**: Sends `paymentMethodId` -> **Backend**: Attaches to Customer, sets as Default.

### 2. Plan Change (Upgrade/Downgrade)
- **Upgrade**: Immediate change + resets billing anchor + clears usage for new period.
- **Downgrade**: Scheduled change; applies at the end of the current period.

## Environment Configuration

```env
# Backend Required
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Frontend Required
VITE_STRIPE_PUBLISHABLE_KEY=pk_...
```

## Security & Verification
- **Signature Check**: All webhooks are verified using the raw request body.
- **PCI Compliance**: No raw card data ever touches our servers (Elements + Tokens only).
- **Idempotency**: Webhook events are tracked in `stripe_webhook_events` to prevent double-processing.
