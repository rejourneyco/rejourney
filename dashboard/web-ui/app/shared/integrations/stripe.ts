import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { getStripePublishableKey } from "~/shared/config/runtimeEnv";

let stripePromise: Promise<Stripe | null> | null = null;

export type StripeKeyStatus = "missing" | "secret" | "invalid" | "valid";

export function getStripeKeyStatus(stripePublishableKey = getStripePublishableKey()): StripeKeyStatus {
  if (!stripePublishableKey) return "missing";
  if (stripePublishableKey.startsWith("sk_")) return "secret";
  if (!stripePublishableKey.startsWith("pk_")) return "invalid";
  return "valid";
}

export function getStripeKeyError(stripePublishableKey = getStripePublishableKey()): string | null {
  const status = getStripeKeyStatus(stripePublishableKey);

  if (status === "missing") {
    return "Stripe publishable key not configured. Please set VITE_STRIPE_PUBLISHABLE_KEY.";
  }

  if (status === "secret") {
    return "VITE_STRIPE_PUBLISHABLE_KEY appears to be a secret key. Use a publishable key that starts with pk_.";
  }

  if (status === "invalid") {
    return "VITE_STRIPE_PUBLISHABLE_KEY does not appear to be a valid Stripe publishable key.";
  }

  return null;
}

export function getStripeClient(): Promise<Stripe | null> | null {
  const stripePublishableKey = getStripePublishableKey();
  if (getStripeKeyStatus(stripePublishableKey) !== "valid") {
    return null;
  }

  if (!stripePromise) {
    stripePromise = loadStripe(stripePublishableKey);
  }

  return stripePromise;
}
