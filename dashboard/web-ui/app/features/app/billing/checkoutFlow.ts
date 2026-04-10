export const BILLING_CHECKOUT_POPUP_WIDTH = 520;
export const BILLING_CHECKOUT_POPUP_HEIGHT = 760;
const STRIPE_CHECKOUT_SESSION_TOKEN = '{CHECKOUT_SESSION_ID}';

export type BillingCheckoutStatus = 'success' | 'canceled';

export interface BillingCheckoutReturnMessage {
  type: 'STRIPE_CHECKOUT_RETURN';
  status: BillingCheckoutStatus;
  sessionId: string | null;
}

interface PopupSizing {
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
}

interface LaunchCheckoutOptions {
  openWindow: (url: string, target: string, features: string) => Window | null;
  assignLocation: (url: string) => void;
  screenWidth: number;
  screenHeight: number;
}

export function buildCenteredPopupFeatures({
  width,
  height,
  screenWidth,
  screenHeight,
}: PopupSizing): string {
  const left = Math.max(0, Math.round((screenWidth - width) / 2));
  const top = Math.max(0, Math.round((screenHeight - height) / 2));

  return [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=yes',
    'toolbar=no',
    'menubar=no',
    'location=no',
  ].join(',');
}

export function launchBillingCheckout(
  url: string,
  {
    openWindow,
    assignLocation,
    screenWidth,
    screenHeight,
  }: LaunchCheckoutOptions,
): 'popup' | 'redirect' {
  const features = buildCenteredPopupFeatures({
    width: BILLING_CHECKOUT_POPUP_WIDTH,
    height: BILLING_CHECKOUT_POPUP_HEIGHT,
    screenWidth,
    screenHeight,
  });

  const popup = openWindow(url, 'stripeCheckout', features);
  if (popup) {
    popup.focus?.();
    return 'popup';
  }

  assignLocation(url);
  return 'redirect';
}

export function buildBillingCheckoutReturnUrls(origin: string, pathPrefix: string): {
  successUrl: string;
  cancelUrl: string;
} {
  const baseUrl = new URL(`${pathPrefix}/billing/return`, origin);

  const successUrl = new URL(baseUrl);
  successUrl.searchParams.set('flow', 'checkout');
  successUrl.searchParams.set('status', 'success');
  successUrl.searchParams.set('session_id', STRIPE_CHECKOUT_SESSION_TOKEN);

  const cancelUrl = new URL(baseUrl);
  cancelUrl.searchParams.set('flow', 'checkout');
  cancelUrl.searchParams.set('status', 'canceled');

  const encodedToken = encodeURIComponent(STRIPE_CHECKOUT_SESSION_TOKEN);

  return {
    successUrl: successUrl.toString().replace(`session_id=${encodedToken}`, `session_id=${STRIPE_CHECKOUT_SESSION_TOKEN}`),
    cancelUrl: cancelUrl.toString(),
  };
}

export function buildBillingCheckoutRedirectUrl(
  pathPrefix: string,
  status: BillingCheckoutStatus,
  sessionId?: string | null,
): string {
  const params = new URLSearchParams();
  params.set('checkout', status);
  if (sessionId) {
    params.set('session_id', sessionId);
  }

  return `${pathPrefix}/billing?${params.toString()}`;
}

export function parseBillingCheckoutSearchParams(searchParams: URLSearchParams): {
  status: BillingCheckoutStatus | null;
  sessionId: string | null;
} {
  const rawStatus = searchParams.get('checkout');
  const status = rawStatus === 'success' || rawStatus === 'canceled'
    ? rawStatus
    : null;

  return {
    status,
    sessionId: normalizeBillingCheckoutSessionId(searchParams.get('session_id')),
  };
}

export function buildBillingCheckoutReturnMessage(
  status: BillingCheckoutStatus,
  sessionId?: string | null,
): BillingCheckoutReturnMessage {
  return {
    type: 'STRIPE_CHECKOUT_RETURN',
    status,
    sessionId: normalizeBillingCheckoutSessionId(sessionId ?? null),
  };
}

export function isBillingCheckoutReturnMessage(value: unknown): value is BillingCheckoutReturnMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.type === 'STRIPE_CHECKOUT_RETURN'
    && (candidate.status === 'success' || candidate.status === 'canceled')
    && (candidate.sessionId === null || typeof candidate.sessionId === 'string' || candidate.sessionId === undefined);
}

function normalizeBillingCheckoutSessionId(sessionId: string | null): string | null {
  if (!sessionId || sessionId === STRIPE_CHECKOUT_SESSION_TOKEN) {
    return null;
  }

  return sessionId;
}
