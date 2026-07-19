import type {
  BillingAlertSettings,
  BillingPlan,
  PaymentMethod,
  StripeStatus,
  TeamPlanInfo,
  TeamSessionUsage,
  TeamUsage,
} from '~/features/app/billing/api';

const DEMO_PLANS: BillingPlan[] = [
  { priceId: 'demo_free', name: 'free', displayName: 'Free', sessionLimit: 5_000, videoRetentionTier: 1, videoRetentionDays: 7, videoRetentionLabel: '7 days', priceCents: 0, interval: 'month' },
  { priceId: 'demo_starter', name: 'starter', displayName: 'Starter', sessionLimit: 25_000, videoRetentionTier: 2, videoRetentionDays: 14, videoRetentionLabel: '14 days', priceCents: 500, interval: 'month' },
  { priceId: 'demo_growth', name: 'growth', displayName: 'Growth', sessionLimit: 100_000, videoRetentionTier: 3, videoRetentionDays: 30, videoRetentionLabel: '30 days', priceCents: 1_500, interval: 'month' },
  { priceId: 'demo_pro', name: 'pro', displayName: 'Pro', sessionLimit: 350_000, videoRetentionTier: 4, videoRetentionDays: 60, videoRetentionLabel: '60 days', priceCents: 3_500, interval: 'month' },
  { priceId: 'demo_scale', name: 'scale', displayName: 'Scale', sessionLimit: 1_000_000, videoRetentionTier: 4, videoRetentionDays: 60, videoRetentionLabel: '60 days', priceCents: 14_900, interval: 'month', smartCaptureEnabled: true },
];

const DEMO_REPLAYS_USED = 184_320;
const DEMO_ANALYTICS_SESSIONS = 421_860;
const DEMO_REPLAY_LIMIT = 350_000;
const DEMO_PERCENT_USED = Number(((DEMO_REPLAYS_USED / DEMO_REPLAY_LIMIT) * 100).toFixed(1));

export type DemoBillingFixtures = {
  usage: TeamUsage;
  stripeStatus: StripeStatus;
  paymentMethods: PaymentMethod[];
  plan: TeamPlanInfo;
  sessionUsage: TeamSessionUsage;
  alertSettings: BillingAlertSettings;
  availablePlans: BillingPlan[];
};

export function getDemoBillingFixtures(now = new Date()): DemoBillingFixtures {
  const cycleEnd = new Date(now);
  cycleEnd.setDate(cycleEnd.getDate() + 12);

  const usage: TeamUsage = {
    sessionsUsed: DEMO_REPLAYS_USED,
    sessionsCaptured: DEMO_ANALYTICS_SESSIONS,
    sessionReplaysUsed: DEMO_REPLAYS_USED,
    sessionLimit: DEMO_REPLAY_LIMIT,
    sessionReplayLimit: DEMO_REPLAY_LIMIT,
    planSessionLimit: DEMO_REPLAY_LIMIT,
    sessionReplayPlanLimit: DEMO_REPLAY_LIMIT,
    bonusSessionsActive: 0,
    sessionsRemaining: DEMO_REPLAY_LIMIT - DEMO_REPLAYS_USED,
    sessionReplaysRemaining: DEMO_REPLAY_LIMIT - DEMO_REPLAYS_USED,
    percentUsed: DEMO_PERCENT_USED,
    sessionReplayPercentUsed: DEMO_PERCENT_USED,
    isAtLimit: false,
    isReplayAtLimit: false,
    isNearLimit: false,
    isReplayNearLimit: false,
  };

  return {
    usage,
    stripeStatus: {
      enabled: true,
      selfHosted: false,
      hasCustomer: true,
      hasPaymentMethod: true,
      paymentFailed: false,
    },
    paymentMethods: [{
      id: 'demo_payment_method',
      type: 'card',
      brand: 'visa',
      last4: '4242',
      expiryMonth: 9,
      expiryYear: now.getFullYear() + 2,
      isDefault: true,
    }],
    plan: {
      priceId: 'demo_pro',
      planName: 'pro',
      displayName: 'Pro',
      sessionLimit: DEMO_REPLAY_LIMIT,
      sessionReplayLimit: DEMO_REPLAY_LIMIT,
      videoRetentionTier: 4,
      videoRetentionDays: 60,
      videoRetentionLabel: '60 days',
      priceCents: 3_500,
      interval: 'month',
      isCustom: false,
      smartCaptureEnabled: false,
      subscriptionId: 'demo_subscription',
      subscriptionStatus: 'active',
      cancelAtPeriodEnd: false,
      scheduledPriceId: null,
      scheduledPlanName: null,
    },
    sessionUsage: {
      ...usage,
      planName: 'pro',
      period: now.toISOString().slice(0, 7),
    },
    alertSettings: {
      sessionLimit: DEMO_REPLAY_LIMIT,
      sessionReplayLimit: DEMO_REPLAY_LIMIT,
      sessionWarningThresholdPercent: 80,
      sessionWarningEnabled: true,
      billingCycleEndDate: cycleEnd.toISOString(),
      currentPeriod: now.toISOString().slice(0, 7),
    },
    availablePlans: DEMO_PLANS.map(plan => ({ ...plan })),
  };
}
