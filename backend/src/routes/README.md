`index.ts` defines main routes.

Use this command to test the Stripe webhook endpoint:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```