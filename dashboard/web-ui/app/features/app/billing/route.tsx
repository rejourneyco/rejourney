import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router';
import { useTeam } from '~/shared/providers/TeamContext';
import { useAuth } from '~/shared/providers/AuthContext';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useToast } from '~/shared/providers/ToastContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { SettingsLayout } from '~/shell/components/layout/SettingsLayout';
import {
  CreditCard,
  Check,
  Shield,
  ExternalLink,
  AlertTriangle,
  Info,
  Zap,
  Receipt,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  AlertOctagon,
  Bell,
  ArrowRight,
  Building,
  Minus,
  X,
} from 'lucide-react';
import {
  getTeamBillingUsage,
  getStripeStatus,
  getPaymentMethods,
  createBillingPortalSession,
  setupStripeForTeam,
  getTeamPlan,
  getTeamSessionUsage,
  clearCache,
  completeCheckoutSession,
  createBillingPortalPlanChangeSession,
  createCheckoutSession,
  TeamUsage,
  StripeStatus,
  PaymentMethod,
  TeamPlanInfo,
  TeamSessionUsage,
  getBillingAlertSettings,
  BillingAlertSettings,
  previewPlanChange,
  confirmPlanChange,
  PlanChangePreview,
  getAvailablePlans,
  BillingPlan,
} from '~/features/app/billing/api';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import {
  buildBillingCheckoutReturnUrls,
  buildCenteredPopupFeatures,
  isBillingCheckoutReturnMessage,
  launchBillingCheckout,
  parseBillingCheckoutSearchParams,
} from '~/features/app/billing/checkoutFlow';
import {
  buildBillingRevenueEvent,
  clearPendingCheckoutRevenueContext,
  mergeRevenuePlan,
  readPendingCheckoutRevenueContext,
  writePendingCheckoutRevenueContext,
} from '~/features/app/billing/revenueTracking';
import { trackRejourneyRevenueEvent } from '~/shared/compliance/rejourneyWebsiteTelemetry';
import { getDemoBillingFixtures } from '~/features/app/billing/demoBillingData';

const PLAN_DESCRIPTIONS: Record<string, string> = {
  free: 'Validate the funnel before traffic ramps',
  starter: 'Find the first leaks in real traffic',
  growth: 'Rank conversion leaks as traffic scales',
  pro: 'For high-volume product and checkout flows',
  scale: 'High-scale funnels with high-intent capture',
  enterprise: 'Custom captured-session volume & dedicated hardware',
};

const PLAN_STEPS = [
  { name: 'free', label: '5k', sessions: 5_000 },
  { name: 'starter', label: '25k', sessions: 25_000 },
  { name: 'growth', label: '100k', sessions: 100_000 },
  { name: 'pro', label: '350k', sessions: 350_000 },
  { name: 'scale', label: '1m', sessions: 1_000_000 },
  { name: 'enterprise', label: '1m+', sessions: 10_000_000 },
] as const;

const getRevenueLeakPredictionLabel = (planName: string) => {
  switch (planName) {
    case 'free':
      return <><strong>5,000 sessions</strong> of Revenue Leak Prediction</>;
    case 'starter':
      return <><strong>5x more</strong> Revenue Leak Prediction than Free</>;
    case 'growth':
      return <><strong>20x more</strong> Revenue Leak Prediction than Free</>;
    case 'pro':
      return <><strong>70x more</strong> Revenue Leak Prediction than Free</>;
    case 'scale':
      return <><strong>200x more</strong> Revenue Leak Prediction than Free</>;
    default:
      return <><strong>Custom</strong> Revenue Leak Prediction coverage</>;
  }
};

const PlanCheck: React.FC<{ children: React.ReactNode; tone?: 'check' | 'minus' | 'warning' }> = ({ children, tone = 'check' }) => (
  <div className="flex gap-2.5 text-xs font-medium leading-5 text-slate-605">
    <span className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full ${tone === 'minus' || tone === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
      {tone === 'minus' || tone === 'warning'
        ? <Minus className="h-2.5 w-2.5 stroke-[3px]" aria-hidden />
        : <Check className="h-2.5 w-2.5 stroke-[3px]" aria-hidden />}
    </span>
    <span className="min-w-0 flex-1">{children}</span>
  </div>
);

export const BillingSettings: React.FC = () => {
  const { isDemoMode } = useDemoMode();
  const manualRefreshVersion = useDashboardManualRefreshVersion();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { currentTeam, teamMembers, isLoading: teamsLoading } = useTeam();
  const [searchParams, setSearchParams] = useSearchParams();
  const pathPrefix = usePathPrefix();

  // Billing state
  const [isLoadingBilling, setIsLoadingBilling] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [teamUsage, setTeamUsage] = useState<TeamUsage | null>(null);
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [teamPlan, setTeamPlan] = useState<TeamPlanInfo | null>(null);
  const [sessionUsage, setSessionUsage] = useState<TeamSessionUsage | null>(null);
  const [alertSettings, setAlertSettings] = useState<BillingAlertSettings | null>(null);
  const [availablePlans, setAvailablePlans] = useState<BillingPlan[]>([]);

  // UI state
  const [isLoadingPortal, setIsLoadingPortal] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [volumeIndex, setVolumeIndex] = useState(2);

  // Plan change modal state
  const [planChangeModal, setPlanChangeModal] = useState<{
    isOpen: boolean;
    preview: PlanChangePreview | null;
    isLoading: boolean;
    isConfirming: boolean;
    selectedPlan: string | null;
  }>({
    isOpen: false,
    preview: null,
    isLoading: false,
    isConfirming: false,
    selectedPlan: null,
  });

  // Permissions
  const isOwner = currentTeam?.ownerUserId === user?.id;
  const currentMember = teamMembers.find(m => m.userId === user?.id);
  const isBillingAdmin = isDemoMode || isOwner || currentMember?.role === 'admin' || currentMember?.role === 'billing_admin';
  const hasPaymentMethod = paymentMethods.length > 0;

  const resetPlanChangeModal = useCallback(() => {
    setPlanChangeModal({
      isOpen: false,
      preview: null,
      isLoading: false,
      isConfirming: false,
      selectedPlan: null,
    });
  }, []);

  const wait = useCallback((ms: number) => new Promise(resolve => setTimeout(resolve, ms)), []);

  // Load billing data
  const loadTeamBilling = useCallback(async (): Promise<TeamPlanInfo | null> => {
    if (isDemoMode) {
      const demoBilling = getDemoBillingFixtures();
      setBillingError(null);
      setTeamUsage(demoBilling.usage);
      setStripeStatus(demoBilling.stripeStatus);
      setPaymentMethods(demoBilling.paymentMethods);
      setTeamPlan(demoBilling.plan);
      setSessionUsage(demoBilling.sessionUsage);
      setAlertSettings(demoBilling.alertSettings);
      setAvailablePlans(demoBilling.availablePlans);
      setIsLoadingBilling(false);
      return demoBilling.plan;
    }

    if (!currentTeam) {
      setTeamUsage(null);
      setStripeStatus(null);
      setPaymentMethods([]);
      setTeamPlan(null);
      setSessionUsage(null);
      return null;
    }
    try {
      setIsLoadingBilling(true);
      setBillingError(null);

      // Clear cache for fresh data
      clearCache(`/api/teams/${currentTeam.id}/billing/stripe/status`);
      clearCache(`/api/teams/${currentTeam.id}/billing/stripe/payment-methods`);
      clearCache(`/api/teams/${currentTeam.id}/billing/plan`);
      clearCache(`/api/teams/${currentTeam.id}/billing/dashboard`);

      const [usageData, stripeStatusData, planData, sessionUsageData, alertSettingsData, availablePlansData] = await Promise.all([
        getTeamBillingUsage(currentTeam.id).catch(() => null),
        getStripeStatus(currentTeam.id).catch(() => null),
        getTeamPlan(currentTeam.id).catch(() => null),
        getTeamSessionUsage(currentTeam.id).catch(() => null),
        getBillingAlertSettings(currentTeam.id).catch(() => null),
        getAvailablePlans().catch(() => []),
      ]);

      setTeamUsage(usageData?.usage ?? null);
      setTeamPlan(planData);
      setSessionUsage(sessionUsageData);
      setAlertSettings(alertSettingsData);
      setAvailablePlans(availablePlansData || []);

      if (stripeStatusData) {
        setStripeStatus(stripeStatusData);
        if (stripeStatusData.enabled && stripeStatusData.hasCustomer) {
          const pmData = await getPaymentMethods(currentTeam.id);
          setPaymentMethods(pmData.paymentMethods);
        }
      }

      return planData ?? null;
    } catch (err) {
      console.error('Failed to load billing:', err);
      setBillingError(err instanceof Error ? err.message : 'Failed to load billing');
      return null;
    } finally {
      setIsLoadingBilling(false);
    }
  }, [currentTeam?.id, isDemoMode, manualRefreshVersion]);

  useEffect(() => {
    loadTeamBilling();
  }, [loadTeamBilling]);

  useEffect(() => {
    if (!teamPlan?.planName || teamPlan.planName.toLowerCase() === 'free') {
      setVolumeIndex(2);
      return;
    }
    const subscribedPlanIndex = PLAN_STEPS.findIndex(
      step => step.name === teamPlan.planName.toLowerCase(),
    );
    if (subscribedPlanIndex >= 0) {
      setVolumeIndex(subscribedPlanIndex);
    }
  }, [teamPlan?.planName]);

  const refreshPlanPreview = useCallback(async () => {
    if (isDemoMode || !planChangeModal.isOpen || !planChangeModal.selectedPlan || !currentTeam) {
      return;
    }

    try {
      const preview = await previewPlanChange(currentTeam.id, planChangeModal.selectedPlan);
      setPlanChangeModal(prev => ({
        ...prev,
        preview,
      }));
    } catch (err) {
      console.error('Failed to refresh plan preview:', err);
    }
  }, [currentTeam, isDemoMode, planChangeModal.isOpen, planChangeModal.selectedPlan]);

  const syncCompletedCheckout = useCallback(async (sessionId: string) => {
    if (!currentTeam) {
      return null;
    }

    let lastResult: Awaited<ReturnType<typeof completeCheckoutSession>> | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      lastResult = await completeCheckoutSession(currentTeam.id, sessionId);
      if (lastResult.provisioned) {
        return lastResult;
      }

      if (attempt < 4) {
        await wait(800 * (attempt + 1));
      }
    }

    return lastResult;
  }, [currentTeam, wait]);

  const refreshBillingAfterCheckout = useCallback(async (
    status: 'success' | 'canceled',
    sessionId?: string | null,
  ) => {
    if (isDemoMode) {
      await loadTeamBilling();
      showToast('Checkout is disabled in the demo. Sample billing data was restored.');
      return;
    }

    if (status === 'success') {
      let checkoutSyncResult: Awaited<ReturnType<typeof completeCheckoutSession>> | null = null;
      if (sessionId && currentTeam) {
        checkoutSyncResult = await syncCompletedCheckout(sessionId);
      }

      clearCache();
      const refreshedPlan = await loadTeamBilling();
      if (checkoutSyncResult?.provisioned && sessionId && currentTeam) {
        const pendingContext = readPendingCheckoutRevenueContext(sessionId);
        const pendingPlan = pendingContext?.teamId === currentTeam.id ? pendingContext.plan : null;
        const revenueEvent = buildBillingRevenueEvent({
          transactionId: sessionId,
          teamId: currentTeam.id,
          plan: pendingPlan || refreshedPlan || teamPlan,
          availablePlans,
          selectedPlan: pendingContext?.teamId === currentTeam.id ? pendingContext.selectedPlan : undefined,
          subscriptionId: checkoutSyncResult.subscriptionId,
          checkoutSessionId: sessionId,
          source: 'stripe_checkout',
          changeType: 'new',
          dedupeKey: `stripe_checkout:${sessionId}`,
        });

        if (revenueEvent) {
          trackRejourneyRevenueEvent(revenueEvent);
        }
        clearPendingCheckoutRevenueContext(sessionId);
      }
      if (currentTeam) {
        window.dispatchEvent(new CustomEvent('planChanged', {
          detail: { teamId: currentTeam.id }
        }));
      }
      resetPlanChangeModal();
      setBillingError(null);
      if (checkoutSyncResult && !checkoutSyncResult.provisioned) {
        showToast('Checkout finished, but Stripe is still finalizing the subscription. Billing will update shortly.');
      } else {
        showToast('Subscription complete. Refreshing billing...');
      }
      return;
    }

    setPlanChangeModal(prev => ({ ...prev, isConfirming: false }));
    clearPendingCheckoutRevenueContext(sessionId);
    showToast('Checkout canceled.');
  }, [availablePlans, currentTeam, isDemoMode, loadTeamBilling, resetPlanChangeModal, showToast, syncCompletedCheckout, teamPlan]);

  // Listen for messages from Stripe return pages
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) return;

      if (isBillingCheckoutReturnMessage(event.data)) {
        await refreshBillingAfterCheckout(event.data.status, event.data.sessionId);
        return;
      }

      if (event.data?.type === 'STRIPE_PORTAL_CLOSED') {
        // Refresh billing data when portal closes
        await loadTeamBilling();

        // If plan change modal is open, refresh the preview with updated payment methods
        await refreshPlanPreview();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadTeamBilling, refreshBillingAfterCheckout, refreshPlanPreview]);

  // Handle billing return query params and deep links
  useEffect(() => {
    const billingParam = searchParams.get('action');
    if (billingParam === 'setup' && !hasPaymentMethod && isBillingAdmin && stripeStatus?.enabled && !stripeStatus?.selfHosted) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('action');
      setSearchParams(nextParams);
      return;
    }

    const { status, sessionId } = parseBillingCheckoutSearchParams(searchParams);
    if (!status) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('checkout');
    nextParams.delete('session_id');
    setSearchParams(nextParams);

    refreshBillingAfterCheckout(status, sessionId).catch((err) => {
      console.error('Failed to refresh billing after checkout return:', err);
      setBillingError(err instanceof Error ? err.message : 'Failed to refresh billing');
    });
  }, [
    searchParams,
    hasPaymentMethod,
    isBillingAdmin,
    stripeStatus,
    setSearchParams,
    refreshBillingAfterCheckout,
  ]);

  // Open plan change preview modal
  const handlePlanClick = async (planName: string) => {
    if (!currentTeam) return;

    // Don't allow clicking on current plan
    if (teamPlan?.planName?.toLowerCase() === planName) return;
    if (isDemoMode) {
      showToast('Plan changes are disabled in the demo. This is sample billing data.');
      return;
    }

    setPlanChangeModal({
      isOpen: true,
      preview: null,
      isLoading: true,
      isConfirming: false,
      selectedPlan: planName,
    });

    try {
      const preview = await previewPlanChange(currentTeam.id, planName);
      setPlanChangeModal(prev => ({
        ...prev,
        preview,
        isLoading: false,
      }));
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to load plan details');
      setPlanChangeModal(prev => ({
        ...prev,
        isOpen: false,
        isLoading: false,
      }));
    }
  };

  // Confirm the plan change
  const handleConfirmPlanChange = async () => {
    if (isDemoMode) {
      resetPlanChangeModal();
      showToast('Plan changes are disabled in the demo.');
      return;
    }

    const selectedPlan = planChangeModal.selectedPlan;
    const preview = planChangeModal.preview;
    if (!currentTeam || !selectedPlan || !preview) return;

    setPlanChangeModal(prev => ({ ...prev, isConfirming: true }));

    try {
      if (preview.changeType === 'new') {
        const { successUrl, cancelUrl } = buildBillingCheckoutReturnUrls(window.location.origin, pathPrefix);
        const result = await createCheckoutSession(
          currentTeam.id,
          selectedPlan,
          successUrl,
          cancelUrl,
        );

        writePendingCheckoutRevenueContext(result.sessionId, {
          teamId: currentTeam.id,
          selectedPlan,
          plan: mergeRevenuePlan(preview.newPlan, availablePlans, selectedPlan),
          createdAt: new Date().toISOString(),
        });

        const launchMode = launchBillingCheckout(result.url, {
          openWindow: (url, target, features) => window.open(url, target, features),
          assignLocation: (url) => window.location.assign(url),
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        });

        if (launchMode === 'popup') {
          resetPlanChangeModal();
        }
        return;
      }

      if (preview.changeType === 'upgrade' || preview.changeType === 'downgrade') {
        const returnUrl = `${window.location.origin}${pathPrefix}/billing/return`;
        const { url } = await createBillingPortalPlanChangeSession(currentTeam.id, selectedPlan, returnUrl);
        const features = buildCenteredPopupFeatures({
          width: 1000,
          height: 700,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        });
        const portalWindow = window.open(url, 'stripeBillingPortalPlanChange', features);

        if (!portalWindow) {
          window.location.assign(url);
          return;
        }

        portalWindow.focus();
        resetPlanChangeModal();

        const checkClosed = setInterval(() => {
          if (portalWindow.closed) {
            clearInterval(checkClosed);
            clearCache();
            loadTeamBilling();
          }
        }, 500);
        return;
      }

      const result = await confirmPlanChange(currentTeam.id, selectedPlan);
      if (result.success) {
        if (result.isImmediate && result.changeType !== 'downgrade') {
          const subscriptionId = result.subscriptionId || result.plan.subscriptionId || null;
          const transactionId = [
            'stripe_plan_change',
            subscriptionId || currentTeam.id,
            result.changeType,
            result.plan.planName || selectedPlan,
            String(result.effectiveDate),
          ].join(':');
          const revenueEvent = buildBillingRevenueEvent({
            transactionId,
            teamId: currentTeam.id,
            plan: result.plan || preview.newPlan,
            availablePlans,
            selectedPlan,
            subscriptionId,
            source: 'stripe_plan_change',
            changeType: result.changeType,
            dedupeKey: transactionId,
          });

          if (revenueEvent) {
            trackRejourneyRevenueEvent(revenueEvent);
          }
        }

        // Clear ALL caches to force fresh data from server
        clearCache();

        // Reload all billing data (this will fetch fresh from server)
        await loadTeamBilling();

        // Also trigger a window event to refresh other components
        window.dispatchEvent(new CustomEvent('planChanged', {
          detail: { teamId: currentTeam.id }
        }));

        resetPlanChangeModal();
        // Show success message
        setBillingError(null);
      }
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to update plan');
      setPlanChangeModal(prev => ({ ...prev, isConfirming: false }));
    }
  };

  // Close the modal
  const handleCloseModal = () => {
    if (!planChangeModal.isConfirming) {
      resetPlanChangeModal();
    }
  };

  // Legacy handler (kept for compatibility)
  const handleUpgradePlan = async (planName: string) => {
    // Now redirects to the modal flow
    handlePlanClick(planName);
  };

  const handleOpenBillingPortal = async () => {
    if (!currentTeam) return;
    if (isDemoMode) {
      showToast('Stripe Billing is disabled in the demo. This payment method is sample data.');
      return;
    }
    try {
      setIsLoadingPortal(true);
      setBillingError(null);
      if (!stripeStatus?.hasCustomer) {
        await setupStripeForTeam(currentTeam.id);
      }

      // Use current origin to ensure it works in both dev (localhost) and prod (your domain)
      // Use special return page that closes the popup window
      const returnUrl = `${window.location.origin}${pathPrefix}/billing/return`;
      const { url } = await createBillingPortalSession(currentTeam.id, returnUrl);

      const features = buildCenteredPopupFeatures({
        width: 1000,
        height: 700,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
      });

      const portalWindow = window.open(
        url,
        'stripeBillingPortal',
        features,
      );

      if (!portalWindow) {
        throw new Error('Pop-up blocked. Please allow pop-ups for this site.');
      }

      // Focus the window
      portalWindow.focus();

      // The return page will send a message when it loads, which triggers refresh
      // Also poll as fallback in case return page doesn't load
      const checkClosed = setInterval(() => {
        if (portalWindow.closed) {
          clearInterval(checkClosed);
          // Fallback: refresh billing data if window closes without return page
          loadTeamBilling();
        }
      }, 500);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to open billing portal');
    } finally {
      setIsLoadingPortal(false);
    }
  };

  // Effective cap includes time-limited bonus sessions (same as ingest); plan row is base plan only
  const sessionReplaysUsed =
    sessionUsage?.sessionReplaysUsed ?? sessionUsage?.sessionsUsed ?? 0;
  const sessionsCapturedDisplay =
    sessionUsage?.sessionsCaptured ?? teamUsage?.sessionsCaptured ?? sessionReplaysUsed;
  const effectiveSessionLimit =
    sessionUsage?.sessionReplayLimit ?? sessionUsage?.sessionLimit ?? teamPlan?.sessionReplayLimit ?? teamPlan?.sessionLimit ?? 5000;
  const planSessionCap =
    sessionUsage?.sessionReplayPlanLimit ?? sessionUsage?.planSessionLimit ?? teamPlan?.sessionReplayLimit ?? teamPlan?.sessionLimit ?? 5000;
  const bonusSessionsActive = sessionUsage?.bonusSessionsActive ?? 0;

  const usagePercent =
    sessionUsage != null ? Math.min(100, sessionUsage.sessionReplayPercentUsed ?? sessionUsage.percentUsed) : 0;

  const isNearLimit =
    sessionUsage != null ? (sessionUsage.isReplayNearLimit ?? sessionUsage.isNearLimit) : usagePercent >= 80;
  const isAtLimit =
    sessionUsage != null ? (sessionUsage.isReplayAtLimit ?? sessionUsage.isAtLimit) : usagePercent >= 100;

  const sessionsRemainingDisplay =
    sessionUsage?.sessionReplaysRemaining ??
    sessionUsage?.sessionsRemaining ??
    Math.max(0, effectiveSessionLimit - sessionReplaysUsed);
  const isInitialBillingLoading = Boolean(currentTeam)
    && isLoadingBilling
    && !teamPlan
    && !sessionUsage
    && !stripeStatus
    && paymentMethods.length === 0;

  if (teamsLoading) {
    return <DashboardGhostLoader variant="settings" />;
  }

  if (isInitialBillingLoading) {
    return <DashboardGhostLoader variant="settings" />;
  }

  if (!currentTeam) {
    return (
      <SettingsLayout className="rejourney-settings-page rejourney-billing-settings-page" title="Billing" description="Select a team to manage billing" icon={<CreditCard className="w-6 h-6" />} iconColor="bg-[#f4f4f5]">
        <div className="p-12 text-center border-2 border-dashed border-slate-300 bg-slate-50">
          <Building className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900 mb-1">No Team Selected</h2>
          <p className="text-sm text-slate-500">Please select or create a team from the sidebar.</p>
        </div>
      </SettingsLayout>
    );
  }

  // Self-hosted mode
  if (stripeStatus?.selfHosted) {
    return (
      <SettingsLayout
        className="rejourney-settings-page rejourney-billing-settings-page"
        title="Billing"
        description={`Enterprise billing for ${currentTeam.name}`}
        icon={<CreditCard className="w-6 h-6" />}
        iconColor="bg-[#f4f4f5]"
      >
        <NeoCard className="p-8 border-emerald-600 bg-emerald-50">
          <div className="flex items-start gap-6">
            <div className="w-16 h-16 bg-emerald-600 flex items-center justify-center border-2 border-slate-900 shadow-[4px_4px_0_0_#000]">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-semibold uppercase tracking-tight mb-2">Self-Hosted Enterprise</h2>
              <p className="text-sm font-bold text-emerald-800 mb-4">
                Your instance is running in self-hosted mode with unlimited sessions.
              </p>
              <div className="flex flex-wrap gap-3">
                <NeoBadge variant="success">Unlimited Sessions</NeoBadge>
                <NeoBadge variant="success">No Billing Required</NeoBadge>
                <NeoBadge variant="neutral">Full Data Control</NeoBadge>
              </div>
            </div>
          </div>
        </NeoCard>
      </SettingsLayout>
    );
  }

  const basePlans = availablePlans.length > 0 ? availablePlans : [
    { name: 'free', displayName: 'Free', sessionLimit: 5000, videoRetentionTier: 1, videoRetentionDays: 7, videoRetentionLabel: '7 days', priceCents: 0 },
    { name: 'starter', displayName: 'Starter', sessionLimit: 25000, videoRetentionTier: 2, videoRetentionDays: 14, videoRetentionLabel: '14 days', priceCents: 500 },
    { name: 'growth', displayName: 'Growth', sessionLimit: 100000, videoRetentionTier: 3, videoRetentionDays: 30, videoRetentionLabel: '30 days', priceCents: 1500 },
    { name: 'pro', displayName: 'Pro', sessionLimit: 350000, videoRetentionTier: 4, videoRetentionDays: 60, videoRetentionLabel: '60 days', priceCents: 3500 },
    { name: 'scale', displayName: 'Scale', sessionLimit: 1000000, videoRetentionTier: 4, videoRetentionDays: 60, videoRetentionLabel: '60 days', priceCents: 14900, smartCaptureEnabled: true },
  ];
  const plansForDisplay: BillingPlan[] = [
    ...basePlans,
    ...(!basePlans.some(p => p.name === 'enterprise') ? [{
      name: 'enterprise',
      displayName: 'Enterprise',
      sessionLimit: 10000000,
      videoRetentionTier: 5,
      videoRetentionDays: 90,
      videoRetentionLabel: 'Custom',
      priceCents: -1,
      isCustom: true
    }] : [])
  ];
  const currentPlanName = teamPlan?.planName?.toLowerCase() || 'free';
  const currentPlanIndex = plansForDisplay.findIndex(plan => plan.name === currentPlanName);
  const selectedPlanStep = PLAN_STEPS[volumeIndex];
  const paidPreviewIndex = Math.min(4, Math.max(1, volumeIndex));
  const plansForSliderDisplay = [
    plansForDisplay.find(plan => plan.name === 'free'),
    plansForDisplay.find(plan => plan.name === PLAN_STEPS[paidPreviewIndex].name),
    plansForDisplay.find(plan => plan.name === 'enterprise'),
  ].filter((plan): plan is BillingPlan => Boolean(plan));
  const currentPlanDisplay = teamPlan?.displayName || teamPlan?.planName || 'Free';
  const currentPlanPriceLabel = teamPlan?.priceCents ? `$${(teamPlan.priceCents / 100).toFixed(0)}/mo` : 'Free';
  const periodEndsLabel = alertSettings
    ? new Date(alertSettings.billingCycleEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '---';
  const usageBarClass = isAtLimit || isNearLimit ? 'bg-rose-500' : 'bg-emerald-500';
  const usageToneClass = isAtLimit || isNearLimit ? 'text-rose-600' : 'text-emerald-600';
  const showPaymentSummary = stripeStatus?.enabled && (currentPlanName !== 'free' || paymentMethods.length > 0 || isBillingAdmin);
  const hasScheduledPlanChange = Boolean(teamPlan?.scheduledPriceId || teamPlan?.cancelAtPeriodEnd);

  return (
    <SettingsLayout
      className="rejourney-settings-page rejourney-billing-settings-page relative overflow-hidden"
      title="Billing"
      description={`Plan & usage for ${currentTeam.name}`}
      icon={<CreditCard className="w-6 h-6" />}
      iconColor="bg-[#f4f4f5]"
      headerAction={
        <div className="flex items-center gap-3">
          <NeoBadge variant={teamPlan?.planName === 'free' ? 'warning' : 'success'} className="font-mono uppercase">
            {teamPlan?.planName || 'Free'} Plan
          </NeoBadge>
        </div>
      }
    >
      <div className="relative z-10 space-y-6">
      {isDemoMode && (
        <div className="flex items-start gap-3 rounded-xl border border-sky-200/70 bg-sky-50/80 p-4 backdrop-blur-md">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          <div>
            <div className="text-sm font-semibold text-sky-950">Demo billing preview</div>
            <div className="mt-0.5 text-xs font-medium text-sky-800">
              Usage, plan, and payment details are sample data. Billing actions are safely disabled.
            </div>
          </div>
        </div>
      )}
      {hasScheduledPlanChange && (
        <div className="rounded-xl border border-rose-200/60 bg-rose-50/75 backdrop-blur-md flex items-start gap-3 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-rose-900">Scheduled plan change</div>
            <div className="mt-1 text-sm font-medium text-rose-800">
              {teamPlan?.cancelAtPeriodEnd
                ? 'Your subscription will be canceled at the end of your current billing period. You keep access until then.'
                : 'Your plan change is scheduled for the end of your current billing period.'}
            </div>
          </div>
        </div>
      )}

      {billingError && (
        <div className="rounded-xl border border-rose-200/60 bg-rose-50/75 backdrop-blur-md flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-rose-900">Billing error</div>
            <div className="mt-1 text-sm font-medium text-rose-700">{billingError}</div>
          </div>
          <button onClick={() => setBillingError(null)} className="rounded-md p-1 text-rose-600 hover:bg-rose-100 hover:text-rose-800" aria-label="Dismiss billing error">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="billing-glass-card p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/50 pb-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-black">Usage This Period</h2>
              <p className="mt-1 text-xs font-medium text-slate-500">Replay quota, unlimited analytics sessions, and renewal timing.</p>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-xs font-medium text-slate-500">Period ends</div>
              <div className="font-mono text-sm font-semibold text-slate-950">{periodEndsLabel}</div>
            </div>
          </div>

          <div>
            <div className="min-w-0">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue evidence recorded</div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-4xl font-semibold text-slate-950">
                  {sessionReplaysUsed.toLocaleString()}
                </span>
                <span className="text-base font-semibold text-slate-500">
                  / {effectiveSessionLimit.toLocaleString()}
                </span>
              </div>
              {bonusSessionsActive > 0 ? (
                <p className="mt-2 max-w-xl text-xs font-medium text-slate-600">
                  Plan includes {planSessionCap.toLocaleString()} captured sessions; +{bonusSessionsActive.toLocaleString()} bonus this billing period.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 space-y-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${usageToneClass}`}>
                  {usagePercent}% of captured-session quota used
                </span>
                <span className="font-mono text-xs font-semibold text-slate-500">
                  {sessionReplaysUsed.toLocaleString()} / {effectiveSessionLimit.toLocaleString()}
                </span>
              </div>
              <div className="billing-progress-track">
                <div
                  className={`billing-progress-fill ${usageBarClass}`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>{sessionsRemainingDisplay.toLocaleString()} captured sessions remaining</span>
                <span>{planSessionCap.toLocaleString()} base plan cap</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-emerald-700">
                  Analytics sessions captured
                </span>
                <span className="font-mono text-xs font-semibold text-slate-500">
                  {sessionsCapturedDisplay.toLocaleString()} / ∞
                </span>
              </div>
              <div className="billing-progress-track">
                <div
                  className="billing-progress-fill bg-emerald-500"
                  style={{ width: sessionsCapturedDisplay > 0 ? '100%' : '0%' }}
                />
              </div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>No analytics cap this period</span>
                <span>∞ analytics sessions</span>
              </div>
            </div>
          </div>

          {(isAtLimit || isNearLimit) && (
            <div className="dashboard-inner-surface mt-4 flex items-start gap-3 border-rose-200 bg-rose-50/60 p-3">
              {isAtLimit ? <AlertOctagon className="mt-0.5 h-5 w-5 text-rose-600" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600" />}
              <span className="text-sm font-medium text-rose-800">
                {isAtLimit
                  ? 'Captured-session limit reached. Fresh AI leak packets, heatmaps, journey drill-downs, crash context, and replay evidence pause until the next billing cycle or upgrade. General analytics still counts every session.'
                  : 'Approaching captured-session limit. Consider upgrading to keep revenue-leak evidence flowing.'}
              </span>
            </div>
          )}

        </section>

        <div className="space-y-4">
          <section className="billing-glass-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-black">Current Plan</h2>
                <p className="mt-1 text-sm text-slate-500">{PLAN_DESCRIPTIONS[currentPlanName] || 'Subscription Plan'}</p>
              </div>
              <NeoBadge variant={currentPlanName === 'free' ? 'warning' : 'success'} size="sm">
                {currentPlanName}
              </NeoBadge>
            </div>
            <div className="mt-5">
              <div className="text-3xl font-semibold text-slate-950">{currentPlanDisplay}</div>
              <div className="mt-1 text-sm font-semibold text-slate-500">{currentPlanPriceLabel}</div>
            </div>
            {hasScheduledPlanChange && (
              <div className="dashboard-inner-surface mt-4 border-rose-200 bg-rose-50/60 p-3 text-sm font-medium text-rose-800">
                {teamPlan?.cancelAtPeriodEnd ? 'Canceling at period end' : 'Plan change scheduled'}
              </div>
            )}
            {isBillingAdmin && stripeStatus?.enabled && (
              <NeoButton
                variant="secondary"
                className="mt-4 w-full"
                onClick={handleOpenBillingPortal}
                disabled={isLoadingPortal}
                leftIcon={<ExternalLink className="h-4 w-4" />}
              >
                {isLoadingPortal ? 'Opening...' : 'Manage Stripe Billing'}
              </NeoButton>
            )}
          </section>

          {showPaymentSummary && (
            <section className="billing-glass-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-black">Payment</h2>
                <NeoBadge variant={stripeStatus?.paymentFailed ? 'warning' : hasPaymentMethod ? 'success' : 'neutral'} size="sm">
                  {stripeStatus?.paymentFailed ? 'Failed' : hasPaymentMethod ? 'On file' : 'None'}
                </NeoBadge>
              </div>
              {stripeStatus?.paymentFailed && (
                <div className="dashboard-inner-surface mb-3 flex items-start gap-3 border-rose-200 bg-rose-50/60 p-3">
                  <AlertOctagon className="mt-0.5 h-5 w-5 text-rose-600" />
                  <div className="text-sm font-medium text-rose-800">Update your payment method in Stripe Billing to continue recording.</div>
                </div>
              )}
              {paymentMethods.length > 0 ? (
                <div className="space-y-2">
                  {paymentMethods.map(pm => (
                    <div key={pm.id} className="dashboard-inner-surface p-3">
                      <div className="flex items-center gap-3">
                        <div className="rounded-md border border-slate-200/60 bg-white/60 backdrop-blur-sm p-2">
                          <CreditCard className="h-4 w-4 text-slate-700" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-sm font-semibold text-slate-950">
                            {pm.brand ? pm.brand.toUpperCase() : 'CARD'} **** {pm.last4 || '****'}
                          </div>
                          <div className="text-xs font-medium text-slate-500">
                            {pm.expiryMonth && pm.expiryYear
                              ? `Expires ${String(pm.expiryMonth).padStart(2, '0')}/${pm.expiryYear}`
                              : 'No expiry info'}
                          </div>
                        </div>
                        {pm.isDefault && <NeoBadge variant="success" size="sm">Default</NeoBadge>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dashboard-inner-surface p-4 text-sm font-medium text-slate-600">
                  {currentPlanName === 'free'
                    ? 'No payment method is needed while this team is on Free.'
                    : 'Add a payment method in Stripe Billing before reaching the captured-session limit.'}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <section className="billing-glass-card relative z-10 mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/60 pb-5">
          <div className="max-w-2xl">
            <h2 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Choose your evidence volume</h2>
            <p className="mt-1.5 text-sm font-medium leading-6 text-slate-500">
              Every plan includes the analytics toolkit. Choose based on monthly session replays, retention, and capture control.
            </p>
          </div>
          <a
            href="mailto:contact@rejourney.co"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-bold text-indigo-650 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50"
          >
            Need a custom plan?
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Monthly session replays</div>
              <div className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                {selectedPlanStep.name === 'enterprise'
                  ? 'Custom volume'
                  : selectedPlanStep.sessions.toLocaleString()}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Previewing</div>
              <div className="mt-1 text-sm font-black uppercase text-indigo-650">{selectedPlanStep.name}</div>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={PLAN_STEPS.length - 1}
            step={1}
            value={volumeIndex}
            onChange={event => setVolumeIndex(Number(event.target.value))}
            className="pricing-range-slider mt-5"
            style={{ '--slider-fill': `${(volumeIndex / (PLAN_STEPS.length - 1)) * 100}%` } as React.CSSProperties}
            aria-label="Preview a billing plan by monthly session replay volume"
          />

          <div className="mt-3 flex justify-between px-1">
            {PLAN_STEPS.map((step, index) => (
              <button
                key={step.name}
                type="button"
                onClick={() => setVolumeIndex(index)}
                className={`text-[10px] font-bold uppercase transition-colors ${
                  volumeIndex === index ? 'text-indigo-650' : 'text-slate-400 hover:text-slate-650'
                }`}
                aria-label={`Preview ${step.name} plan`}
                aria-pressed={volumeIndex === index}
              >
                {step.label}
              </button>
            ))}
          </div>
          <p className="mt-4 text-center text-xs font-medium text-slate-500">
            Your subscribed plan is selected automatically whenever you return.
          </p>
        </div>

        <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-3">
          {plansForSliderDisplay.map((plan) => {
            const isCurrentPlan = currentPlanName === plan.name;
            const planIndex = plansForDisplay.findIndex(p => p.name === plan.name);
            const isDowngrade = Boolean(teamPlan && currentPlanIndex > planIndex);
            const isNewPaidSubscription = currentPlanName === 'free' && plan.priceCents > 0;
            const isFreePlanDisabled = plan.name === 'free' && isCurrentPlan;
            const isScheduledPlan = teamPlan?.scheduledPlanName?.toLowerCase() === plan.name;
            const isSelectedPlan = selectedPlanStep.name === plan.name;
            const isEnterprise = plan.name === 'enterprise';
            const hasSmartCapture = Boolean(plan.smartCaptureEnabled || plan.name === 'scale' || isEnterprise);
            const isFree = plan.name === 'free';
            const price = plan.priceCents / 100;
            const actionLabel = isSavingPlan
              ? '...'
              : isDowngrade
                ? 'Downgrade'
                : isNewPaidSubscription
                  ? 'Subscribe'
                  : 'Upgrade';

            const isHighlighted = isSelectedPlan;
            const badgeText = isFree ? 'Getting Started' : isEnterprise ? 'Contact Us' : 'Best Value';
            const cardClassName = isHighlighted
              ? 'border-2 border-slate-950 bg-white shadow-[8px_8px_0_#0f172a] -translate-y-1'
              : 'border border-slate-200 bg-white/80 shadow-sm hover:-translate-y-0.5 hover:border-slate-350 hover:shadow-md';
            const actionClassName = isHighlighted
              ? 'border-slate-950 bg-[#86efac] text-black shadow-[2px_2px_0_#0f172a] hover:-translate-y-0.5 hover:bg-[#6ee7a0] active:translate-y-0 active:shadow-none'
              : 'border-slate-250 bg-white text-slate-800 hover:border-slate-350 hover:bg-slate-50';
            const features: Array<{ key: string; content: React.ReactNode; active: boolean }> = isFree
              ? [
                  { key: 'sessions', content: <><strong>{plan.sessionLimit.toLocaleString()}</strong> session replays / mo</>, active: true },
                  { key: 'retention', content: <><strong>7 days</strong> evidence retention</>, active: true },
                  { key: 'prediction', content: getRevenueLeakPredictionLabel('free'), active: true },
                  { key: 'events', content: 'Unlimited events, DAU, and MAU', active: true },
                  { key: 'funnels', content: 'Standard funnel and cohort trends', active: true },
                  { key: 'controls', content: 'Standard session recording controls', active: true },
                  { key: 'smart', content: 'Smart Capture customizable rules', active: false },
                  { key: 'support', content: 'Priority support & Dedicated hardware', active: false },
                ]
              : isEnterprise
                ? [
                    { key: 'sessions', content: <><strong>Custom volume</strong> of monthly sessions</>, active: true },
                    { key: 'retention', content: <><strong>Custom</strong> evidence retention history</>, active: true },
                    { key: 'prediction', content: getRevenueLeakPredictionLabel('enterprise'), active: true },
                    { key: 'events', content: 'Unlimited events, DAU, and MAU', active: true },
                    { key: 'funnels', content: 'Full suite of custom funnels & analytics', active: true },
                    { key: 'hardware', content: 'Dedicated hardware & custom storage bucket', active: true },
                    { key: 'support', content: 'Dedicated support team & custom SLA', active: true },
                  ]
                : [
                    { key: 'sessions', content: <><strong>{plan.sessionLimit.toLocaleString()}</strong> session replays / mo</>, active: true },
                    { key: 'retention', content: <><strong>{plan.videoRetentionLabel}</strong> evidence retention</>, active: true },
                    { key: 'prediction', content: getRevenueLeakPredictionLabel(plan.name), active: true },
                    { key: 'events', content: 'Unlimited events, DAU, and MAU', active: true },
                    { key: 'funnels', content: 'Checkout, onboarding, & paywall drill-downs', active: true },
                    { key: 'diagnostics', content: 'Crash, API, and ANR diagnostic tools', active: true },
                    { key: 'smart', content: 'Smart Capture customizable rules', active: hasSmartCapture },
                    { key: 'support', content: 'Priority support & Dedicated hardware', active: false },
                  ];

            return (
              <article
                key={plan.name}
                className={`relative flex min-h-[650px] flex-col justify-between rounded-2xl p-8 transition-all duration-300 ${cardClassName}`}
              >
                {isHighlighted && (
                  <span className="absolute -top-3 left-6 inline-flex items-center rounded-full border border-emerald-500 bg-emerald-100 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-800">
                    {isCurrentPlan ? 'Current Plan' : badgeText}
                  </span>
                )}

                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900">{plan.displayName}</h3>
                      <p className="mt-3 min-h-12 text-sm font-semibold leading-relaxed text-slate-500">
                      {PLAN_DESCRIPTIONS[plan.name] || 'Subscription plan'}
                      </p>
                    </div>
                    {!isHighlighted && isCurrentPlan && <NeoBadge variant="success" size="sm">Current</NeoBadge>}
                    {isScheduledPlan && <NeoBadge variant="warning" size="sm">Scheduled</NeoBadge>}
                  </div>

                  <div className="mt-6 flex items-end gap-x-2">
                    <span className="text-4xl font-black tracking-tight text-slate-900">
                    {isEnterprise ? 'Custom' : price === 0 ? '$0' : `$${price}`}
                    </span>
                    {!isFree && !isEnterprise && <span className="pb-1 text-sm font-bold text-slate-400">/ month</span>}
                  </div>

                  <div className="mt-8 space-y-4">
                    {features.map(feature => (
                      <PlanCheck key={feature.key} tone={feature.active ? 'check' : 'minus'}>
                        {feature.content}
                      </PlanCheck>
                    ))}
                  </div>
                </div>

                <div className="mt-8 pt-2">
                  {isCurrentPlan ? (
                    <div className="flex h-12 w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-extrabold uppercase text-indigo-700">
                      Your current plan
                    </div>
                  ) : isScheduledPlan ? (
                    <div className="flex h-12 w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-extrabold uppercase text-rose-700">
                      Already scheduled
                    </div>
                  ) : isEnterprise ? (
                    <a
                      href="mailto:contact@rejourney.co?subject=Enterprise%20Plan%20Inquiry"
                      className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-extrabold uppercase transition-all duration-150 ${actionClassName}`}
                    >
                      Contact Sales
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  ) : isBillingAdmin ? (
                    <button
                      type="button"
                      className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-extrabold uppercase transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${actionClassName}`}
                      onClick={() => handlePlanClick(plan.name)}
                      disabled={isSavingPlan || isFreePlanDisabled}
                    >
                      {actionLabel}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <div className="flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-xs font-semibold text-slate-500">
                      Billing admin required
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-5 grid gap-3 rounded-xl border border-slate-200/70 bg-white/55 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            'Web and mobile replay',
            'AI Leak Detection',
            'Heatmaps and journeys',
            'Crash and API context',
          ].map(feature => (
            <div key={feature} className="flex items-center gap-2 text-xs font-semibold text-slate-650">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-3 w-3 stroke-[3px]" />
              </span>
              {feature}
            </div>
          ))}
        </div>
      </section>

      {/* Plan Change Confirmation Modal */}
      {planChangeModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onClick={handleCloseModal}>
          <div
            className="billing-modal-panel bg-white max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold tracking-tight">
                {planChangeModal.isLoading ? 'Loading...' :
                  planChangeModal.preview?.changeType === 'new' ? 'Subscribe to Plan' :
                    planChangeModal.preview?.changeType === 'upgrade' ? 'Confirm Upgrade' :
                      planChangeModal.preview?.changeType === 'downgrade' ? 'Confirm Downgrade' :
                        'Confirm Plan Change'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                disabled={planChangeModal.isConfirming}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {planChangeModal.isLoading ? (
                <div className="h-32 flex items-center justify-center">
                  <div className="animate-spin w-8 h-8 border-4 border-slate-300 border-t-slate-900 rounded-full" />
                </div>
              ) : planChangeModal.preview ? (
                <div className="space-y-6">
                  {/* Plan Change Summary */}
                  <div className="flex items-center justify-center gap-4">
                    <div className="dashboard-inner-surface flex-1 p-4 text-center">
                      <div className="text-xs font-bold text-slate-500 uppercase mb-1">Current</div>
                      <div className="text-lg font-semibold">
                        {planChangeModal.preview.currentPlan.displayName}
                      </div>
                      <div className="text-sm font-bold text-slate-600">
                        {planChangeModal.preview.currentPlan.priceCents === 0
                          ? 'Free'
                          : `$${(planChangeModal.preview.currentPlan.priceCents / 100).toFixed(0)}/mo`}
                      </div>
                    </div>
                    <div className="text-slate-400 font-semibold text-xl">→</div>
                    <div className={`dashboard-inner-surface flex-1 p-4 text-center ${planChangeModal.preview.changeType === 'upgrade' || planChangeModal.preview.changeType === 'new'
                      ? 'bg-emerald-50 border-emerald-600'
                      : 'bg-rose-50 border-rose-600'
                      }`}>
                      <div className="text-xs font-bold text-slate-500 uppercase mb-1">New Plan</div>
                      <div className="text-lg font-semibold">{planChangeModal.preview.newPlan.displayName}</div>
                      <div className="text-sm font-bold text-slate-600">
                        {planChangeModal.preview.newPlan.priceCents === 0
                          ? 'Free'
                          : `$${(planChangeModal.preview.newPlan.priceCents / 100).toFixed(0)}/mo`}
                      </div>
                    </div>
                  </div>

                  {/* Session Replay Limit Change */}
                  <div className="dashboard-inner-surface p-4">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-600">Monthly Session Replay Limit</span>
                      <div className="text-right">
                        <span className="line-through text-slate-400 mr-2">
                          {planChangeModal.preview.currentPlan.sessionLimit.toLocaleString()}
                        </span>
                        <span className={`font-semibold ${planChangeModal.preview.changeType === 'upgrade' || planChangeModal.preview.changeType === 'new'
                          ? 'text-emerald-600'
                          : 'text-rose-600'
                          }`}>
                          {planChangeModal.preview.newPlan.sessionLimit.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="dashboard-inner-surface p-4">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-600">Video Retention</span>
                      <div className="text-right">
                        <span className="line-through text-slate-400 mr-2">
                          {planChangeModal.preview.currentPlan.videoRetentionLabel}
                        </span>
                        <span className={`font-semibold ${planChangeModal.preview.changeType === 'upgrade' || planChangeModal.preview.changeType === 'new'
                          ? 'text-emerald-600'
                          : 'text-rose-600'
                          }`}>
                          {planChangeModal.preview.newPlan.videoRetentionLabel}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 mt-2">Replay media only. Everything else retained unlimited.</p>
                  </div>


                  {/* Payment Method Warning */}
                  {planChangeModal.preview.requiresPaymentMethod && !planChangeModal.preview.hasPaymentMethod && (
                    <div className="dashboard-inner-surface p-4">
                      <div className="font-semibold text-slate-900 mb-2">Payment Method Required</div>
                      <p className="text-sm text-slate-600 mb-3">
                        Add or update your payment method in Stripe Billing, then return here to finish this change.
                      </p>
                      <NeoButton
                        variant="primary"
                        size="sm"
                        onClick={handleOpenBillingPortal}
                        disabled={isLoadingPortal}
                      >
                        {isLoadingPortal ? 'Opening...' : 'Open Stripe Billing'}
                      </NeoButton>
                    </div>
                  )}

                  {/* Warnings */}
                  {planChangeModal.preview.warnings.length > 0 &&
                    !(planChangeModal.preview.requiresPaymentMethod && !planChangeModal.preview.hasPaymentMethod) && (
                      <div className="dashboard-inner-surface p-4">
                        <div className="font-semibold text-slate-900 mb-2">Important</div>
                        <ul className="text-sm text-slate-600 space-y-1">
                          {planChangeModal.preview.warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {/* When change takes effect */}
                  {planChangeModal.preview.changeType === 'downgrade' ? (
                    <div className="dashboard-inner-surface p-3 text-sm">
                      <div className="font-semibold text-slate-900">Confirm in Stripe</div>
                      <p className="mt-1 text-slate-600">
                        Stripe will show the downgrade timing and any billing adjustment before you confirm.
                      </p>
                    </div>
                  ) : planChangeModal.preview.isImmediate ? (
                    <div className="dashboard-inner-surface p-3 text-sm">
                      <div className="font-semibold text-slate-900">Takes effect immediately</div>
                      <p className="text-slate-600 mt-1">Your new captured-session limit will be active right away.</p>
                    </div>
                  ) : (
                    <div className="dashboard-inner-surface p-3 text-sm">
                      <div className="font-semibold text-slate-900">Scheduled for end of billing period</div>
                      <p className="text-slate-600 mt-1">
                        Your downgrade will take effect on {new Date(planChangeModal.preview.effectiveDate).toLocaleDateString()}.
                      </p>
                    </div>
                  )}

                  {/* Session Carryover Notice */}
                  {(planChangeModal.preview.changeType === 'new' || planChangeModal.preview.changeType === 'upgrade') && (
                    <div className="text-sm text-slate-600">
                      <span className="font-bold">Note:</span> Unused sessions do not carry over to your new plan.
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Modal Footer */}
            {!planChangeModal.isLoading && planChangeModal.preview && (
              <div className="flex gap-3 border-t border-slate-200 bg-slate-50 p-4">
                <NeoButton
                  variant="secondary"
                  className="flex-1"
                  onClick={handleCloseModal}
                  disabled={planChangeModal.isConfirming}
                >
                  Cancel
                </NeoButton>
                {planChangeModal.preview.requiresPaymentMethod && !planChangeModal.preview.hasPaymentMethod ? (
                  <NeoButton
                    variant="primary"
                    className="flex-1"
                    onClick={handleOpenBillingPortal}
                    disabled={isLoadingPortal}
                  >
                    {isLoadingPortal ? 'Opening...' : 'Open Stripe Billing'}
                  </NeoButton>
                ) : (
                  <NeoButton
                    variant={planChangeModal.preview.changeType === 'downgrade' ? 'secondary' : 'primary'}
                    className="flex-1"
                    onClick={handleConfirmPlanChange}
                    disabled={planChangeModal.isConfirming}
                  >
                    {planChangeModal.isConfirming ? (
                      'Processing...'
                    ) : planChangeModal.preview.changeType === 'new' ? (
                      'Continue to Stripe'
                    ) : planChangeModal.preview.changeType === 'upgrade' ? (
                      'Continue to Stripe'
                    ) : planChangeModal.preview.changeType === 'downgrade' ? (
                      'Continue to Stripe'
                    ) : (
                      'Confirm'
                    )}
                  </NeoButton>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </SettingsLayout>
  );
};

export default BillingSettings;
