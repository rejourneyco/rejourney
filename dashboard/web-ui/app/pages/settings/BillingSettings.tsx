import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router';
import { useTeam } from '../../context/TeamContext';
import { useAuth } from '../../context/AuthContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { SettingsLayout } from '../../components/layout/SettingsLayout';
import { PaymentMethodModal } from '../../components/billing/StripePaymentForm';
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
  X,
} from 'lucide-react';
import {
  getTeamBillingUsage,
  getStripeStatus,
  getPaymentMethods,
  createBillingPortalSession,
  setupStripeForTeam,
  getTeamPlan,
  updateTeamPlan,
  getTeamSessionUsage,
  clearCache,
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
} from '../../services/api';

const PLAN_DESCRIPTIONS: Record<string, string> = {
  free: 'Perfect for Stable Monthly Rejourney',
  starter: 'For Apps Growing Fast',
  growth: 'For Apps with more users',
  pro: 'For high-traffic applications',
};

export const BillingSettings: React.FC = () => {
  const { user } = useAuth();
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
  const [isSettingUpStripe, setIsSettingUpStripe] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

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
  const isBillingAdmin = isOwner || currentMember?.role === 'admin' || currentMember?.role === 'billing_admin';
  const hasPaymentMethod = paymentMethods.length > 0;

  // Load billing data
  const loadTeamBilling = useCallback(async () => {
    if (!currentTeam) {
      setTeamUsage(null);
      setStripeStatus(null);
      setPaymentMethods([]);
      setTeamPlan(null);
      setSessionUsage(null);
      return;
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
    } catch (err) {
      console.error('Failed to load billing:', err);
      setBillingError(err instanceof Error ? err.message : 'Failed to load billing');
    } finally {
      setIsLoadingBilling(false);
    }
  }, [currentTeam?.id]);

  useEffect(() => {
    loadTeamBilling();
  }, [loadTeamBilling]);

  // Listen for messages from the Stripe portal return page
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'STRIPE_PORTAL_CLOSED') {
        // Refresh billing data when portal closes
        await loadTeamBilling();

        // If plan change modal is open, refresh the preview with updated payment methods
        if (planChangeModal.isOpen && planChangeModal.selectedPlan && currentTeam) {
          try {
            const preview = await previewPlanChange(currentTeam.id, planChangeModal.selectedPlan);
            setPlanChangeModal(prev => ({
              ...prev,
              preview,
            }));
          } catch (err) {
            console.error('Failed to refresh plan preview:', err);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadTeamBilling, planChangeModal.isOpen, planChangeModal.selectedPlan, currentTeam]);

  // Handle deep link from email
  useEffect(() => {
    const billingParam = searchParams.get('action');
    if (billingParam === 'setup' && !hasPaymentMethod && isBillingAdmin && stripeStatus?.enabled && !stripeStatus?.selfHosted) {
      setSearchParams(prev => {
        prev.delete('action');
        return prev;
      });
    }
  }, [searchParams, hasPaymentMethod, isBillingAdmin, stripeStatus, setSearchParams]);

  // Open plan change preview modal
  const handlePlanClick = async (planName: string) => {
    if (!currentTeam) return;

    // Don't allow clicking on current plan
    if (teamPlan?.planName?.toLowerCase() === planName) return;

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
    if (!currentTeam || !planChangeModal.selectedPlan) return;

    setPlanChangeModal(prev => ({ ...prev, isConfirming: true }));

    try {
      const result = await confirmPlanChange(currentTeam.id, planChangeModal.selectedPlan);
      if (result.success) {
        // Clear ALL caches to force fresh data from server
        clearCache();

        // Reload all billing data (this will fetch fresh from server)
        await loadTeamBilling();

        // Also trigger a window event to refresh other components
        window.dispatchEvent(new CustomEvent('planChanged', {
          detail: { teamId: currentTeam.id }
        }));

        setPlanChangeModal({
          isOpen: false,
          preview: null,
          isLoading: false,
          isConfirming: false,
          selectedPlan: null,
        });
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
      setPlanChangeModal({
        isOpen: false,
        preview: null,
        isLoading: false,
        isConfirming: false,
        selectedPlan: null,
      });
    }
  };

  // Legacy handler (kept for compatibility)
  const handleUpgradePlan = async (planName: string) => {
    // Now redirects to the modal flow
    handlePlanClick(planName);
  };

  const handleSetupStripe = async () => {
    if (!currentTeam) return;
    try {
      setIsSettingUpStripe(true);
      setBillingError(null);
      await setupStripeForTeam(currentTeam.id);

      // Open the in-app payment method modal instead of popup
      setShowPaymentModal(true);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to setup billing');
    } finally {
      setIsSettingUpStripe(false);
    }
  };

  const handleOpenBillingPortal = async () => {
    if (!currentTeam) return;
    try {
      setIsLoadingPortal(true);
      // Use current origin to ensure it works in both dev (localhost) and prod (your domain)
      // Use special return page that closes the popup window
      const returnUrl = `${window.location.origin}${pathPrefix}/billing/return`;
      const { url } = await createBillingPortalSession(currentTeam.id, returnUrl);

      // Open window as a centered modal-like popup to feel more integrated
      // Calculate center position
      const width = 1000;
      const height = 700;
      const left = (window.screen.width / 2) - (width / 2);
      const top = (window.screen.height / 2) - (height / 2);

      // Open window immediately (synchronously) to avoid pop-up blocker
      const portalWindow = window.open(
        url,
        'stripeBillingPortal',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no`
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

  // Calculate usage percentage
  const usagePercent = sessionUsage?.sessionsUsed && teamPlan?.sessionLimit
    ? Math.min(100, Math.round((sessionUsage.sessionsUsed / teamPlan.sessionLimit) * 100))
    : 0;

  const isNearLimit = usagePercent >= 80;
  const isAtLimit = usagePercent >= 100;

  if (teamsLoading) {
    return (
      <SettingsLayout title="Billing" description="Loading...">
        <div className="h-32 bg-slate-100 border-2 border-slate-200 animate-pulse"></div>
      </SettingsLayout>
    );
  }

  if (!currentTeam) {
    return (
      <SettingsLayout title="Billing" description="Select a team to manage billing">
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
        title="Billing"
        description={`Enterprise billing for ${currentTeam.name}`}
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

  return (
    <SettingsLayout
      title="Billing"
      description={`Plan & usage for ${currentTeam.name}`}
      headerAction={
        <div className="flex items-center gap-3">
          <NeoBadge variant={teamPlan?.planName === 'free' ? 'warning' : 'success'} className="font-mono uppercase">
            {teamPlan?.planName || 'Free'} Plan
          </NeoBadge>
        </div>
      }
    >
      {/* Scheduled Downgrade Alert */}
      {(teamPlan?.scheduledPriceId || teamPlan?.cancelAtPeriodEnd) && (
        <div className="p-4 bg-amber-50 border-4 border-amber-500 flex items-center gap-4 mb-6">
          <Info className="w-6 h-6 text-amber-600 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-amber-900 uppercase tracking-wide text-sm">Scheduled Plan Change</div>
            <div className="text-sm font-bold text-amber-800">
              {teamPlan.cancelAtPeriodEnd
                ? 'Your subscription will be canceled at the end of your current billing period. You\'ll continue to have access to your current plan features until then.'
                : 'Your plan change is scheduled for the end of your current billing period. You\'ll keep your current plan features until then.'}
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {billingError && (
        <div className="p-4 bg-rose-50 border-4 border-rose-600 flex items-center gap-4 mb-6">
          <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-rose-900 uppercase tracking-wide text-sm">Error</div>
            <div className="text-sm font-bold text-rose-700">{billingError}</div>
          </div>
          <button onClick={() => setBillingError(null)} className="text-rose-600 hover:text-rose-800">
            ✕
          </button>
        </div>
      )}

      {/* Current Plan & Usage Overview */}
      <NeoCard className={`p-6 border-b-[6px] ${isAtLimit ? 'border-rose-600 bg-rose-50' : isNearLimit ? 'border-amber-500 bg-amber-50' : 'border-emerald-500 bg-emerald-50'}`}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Usage Bar */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-semibold uppercase text-slate-500 tracking-widest">Sessions This Period</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-semibold text-slate-900 font-mono">
                    {(sessionUsage?.sessionsUsed ?? 0).toLocaleString()}
                  </span>
                  <span className="text-lg font-bold text-slate-500">
                    / {(teamPlan?.sessionLimit ?? 5000).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-semibold uppercase text-slate-500 tracking-widest">Period Ends</span>
                <div className="text-lg font-semibold text-slate-900 font-mono">
                  {alertSettings ? new Date(alertSettings.billingCycleEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '---'}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="w-full bg-white h-4 border-2 border-slate-900 overflow-hidden shadow-inner">
                <div
                  className={`h-full transition-all duration-500 ${isAtLimit ? 'bg-rose-500' : isNearLimit ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase ${isAtLimit ? 'text-rose-600' : isNearLimit ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {usagePercent}% used
                </span>
                <span className="text-xs font-bold text-slate-500">
                  {((teamPlan?.sessionLimit ?? 5000) - (sessionUsage?.sessionsUsed ?? 0)).toLocaleString()} remaining
                </span>
              </div>
            </div>

            {/* Warning Messages */}
            {isAtLimit && (
              <div className="flex items-center gap-3 p-3 bg-rose-100 border-2 border-rose-600">
                <AlertOctagon className="w-5 h-5 text-rose-600" />
                <span className="text-sm font-semibold text-rose-800">
                  Session limit reached. Recording is paused until next billing cycle or upgrade.
                </span>
              </div>
            )}
            {isNearLimit && !isAtLimit && (
              <div className="flex items-center gap-3 p-3 bg-amber-100 border-2 border-amber-500">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">
                  Approaching limit. Consider upgrading to avoid recording interruption.
                </span>
              </div>
            )}
          </div>

          {/* Current Plan Summary */}
          <div className="bg-white/50 p-4 border-2 border-slate-900 flex flex-col justify-center items-center text-center">
            <span className="text-[10px] font-semibold uppercase text-slate-500 tracking-widest mb-1">Current Plan</span>
            <span className="text-3xl font-semibold text-slate-900 uppercase mb-2">
              {teamPlan?.planName || 'Free'}
            </span>
            <span className="text-lg font-bold text-slate-600">
              {teamPlan?.priceCents ? `$${(teamPlan.priceCents / 100).toFixed(0)}/mo` : 'Free'}
            </span>
            {(teamPlan?.scheduledPriceId || teamPlan?.cancelAtPeriodEnd) && (
              <div className="mt-3 pt-3 border-t-2 border-amber-500 w-full">
                <div className="flex items-center gap-2 justify-center mb-1">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-[10px] font-semibold uppercase text-amber-600 tracking-widest">Scheduled Change</span>
                </div>
                <span className="text-xs font-bold text-amber-800">
                  {teamPlan.cancelAtPeriodEnd
                    ? 'Canceling at period end'
                    : 'Downgrade scheduled'}
                </span>
              </div>
            )}
          </div>
        </div>
      </NeoCard>


      {/* Plan Selection */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold uppercase tracking-tight">Choose Your Plan</h2>
          <div className="text-xs font-bold text-slate-500">
            Need more? <a href="mailto:sales@rejourney.co" className="text-slate-900 hover:underline font-semibold">Contact Sales</a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
          {(availablePlans.length > 0 ? availablePlans : [
            { name: 'free', displayName: 'Free', sessionLimit: 5000, priceCents: 0 },
            { name: 'starter', displayName: 'Starter', sessionLimit: 25000, priceCents: 500 },
            { name: 'growth', displayName: 'Growth', sessionLimit: 100000, priceCents: 1500 },
            { name: 'pro', displayName: 'Pro', sessionLimit: 350000, priceCents: 3500 },
          ]).map((plan) => {
            const currentPlanName = teamPlan?.planName?.toLowerCase() || 'free';
            const isCurrentPlan = currentPlanName === plan.name;
            const isDowngrade = teamPlan && availablePlans.findIndex(p => p.name === currentPlanName) > availablePlans.findIndex(p => p.name === plan.name);
            // Disable free plan only if already on free
            const isFreePlanDisabled = plan.name === 'free' && isCurrentPlan;
            // Disable plan if it's already scheduled for downgrade
            const isScheduledPlan = teamPlan?.scheduledPlanName?.toLowerCase() === plan.name;
            const price = plan.priceCents / 100;

            return (
              <NeoCard
                key={plan.name}
                className={`p-5 relative transition-all overflow-visible ${isCurrentPlan
                  ? 'border-emerald-600 bg-emerald-50 border-b-[6px]'
                  : isFreePlanDisabled || isScheduledPlan
                    ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                    : 'border-slate-300 hover:border-slate-900 hover:-translate-y-1 cursor-pointer'
                  }`}
                onClick={isCurrentPlan || isFreePlanDisabled || isScheduledPlan ? undefined : () => handlePlanClick(plan.name)}
              >
                {isCurrentPlan && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <NeoBadge variant="success" size="sm">CURRENT PLAN</NeoBadge>
                  </div>
                )}
                {isScheduledPlan && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <NeoBadge variant="warning" size="sm">SCHEDULED</NeoBadge>
                  </div>
                )}


                <div className="pt-2 space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold uppercase tracking-tight">{plan.displayName}</h3>
                    <p className="text-xs font-bold text-slate-500 mt-1">{PLAN_DESCRIPTIONS[plan.name] || 'Subscription Plan'}</p>
                  </div>

                  <div>
                    <span className="text-4xl font-semibold text-slate-900">
                      {price === 0 ? 'Free' : `$${price}`}
                    </span>
                    {price > 0 && <span className="text-sm font-bold text-slate-500">/mo</span>}
                  </div>

                  <div className="py-3 border-t border-slate-200">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-slate-900" />
                      <span className="text-sm font-semibold text-slate-900">
                        {plan.sessionLimit.toLocaleString()} sessions
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 ml-4">per month</p>
                  </div>

                  {isCurrentPlan ? (
                    <div className="py-3 text-center border-2 border-emerald-600 bg-emerald-100">
                      <span className="text-sm font-semibold text-emerald-700 uppercase">Current Plan</span>
                    </div>
                  ) : isScheduledPlan ? (
                    <div className="py-3 text-center border-2 border-amber-500 bg-amber-100">
                      <span className="text-sm font-semibold text-amber-700 uppercase">Already Scheduled</span>
                    </div>
                  ) : isBillingAdmin ? (
                    <NeoButton
                      variant="secondary"
                      className="w-full"
                      onClick={() => handlePlanClick(plan.name)}
                      disabled={isSavingPlan || isFreePlanDisabled}
                    >
                      {isSavingPlan ? '...' : isDowngrade ? 'Downgrade' : 'Upgrade'}
                    </NeoButton>
                  ) : (
                    <div className="py-3 text-center border-2 border-slate-200 bg-slate-100">
                      <span className="text-xs font-bold text-slate-500">Billing admin required</span>
                    </div>
                  )}
                </div>
              </NeoCard>
            );
          })}
        </div>
      </section>

      {/* Payment Methods - Only show if user has a paid plan or payment methods */}
      {stripeStatus?.enabled && (teamPlan?.planName?.toLowerCase() !== 'free' || paymentMethods.length > 0) && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold uppercase tracking-tight">Payment Method</h2>

          <NeoCard className="p-6">
            {stripeStatus.paymentFailed && (
              <div className="p-4 bg-rose-50 border-4 border-rose-600 flex items-center gap-4 mb-6">
                <AlertOctagon className="w-8 h-8 text-rose-600" />
                <div className="flex-1">
                  <div className="font-semibold text-rose-900 uppercase tracking-wide">Payment Failed</div>
                  <div className="text-sm font-bold text-rose-700">Please update your payment method to continue recording.</div>
                </div>
              </div>
            )}

            {paymentMethods.length > 0 ? (
              <div className="space-y-4">
                {paymentMethods.map(pm => (
                  <div key={pm.id} className="flex items-center justify-between p-4 border-2 border-slate-900 bg-slate-50 shadow-[4px_4px_0_0_#000]">
                    <div className="flex items-center gap-4">
                      <div className="bg-white p-3 border-2 border-slate-900">
                        <CreditCard className="w-6 h-6 text-slate-800" />
                      </div>
                      <div>
                        <span className="font-mono font-semibold text-slate-900">
                          {pm.brand ? pm.brand.toUpperCase() : 'CARD'} •••• {pm.last4 || '****'}
                        </span>
                        <div className="text-xs font-bold text-slate-500">
                          {pm.expiryMonth && pm.expiryYear
                            ? `Expires ${String(pm.expiryMonth).padStart(2, '0')}/${pm.expiryYear}`
                            : 'No expiry info'}
                        </div>
                      </div>
                      {pm.isDefault && <NeoBadge variant="success" size="sm">DEFAULT</NeoBadge>}
                    </div>
                    {isBillingAdmin && (
                      <NeoButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPaymentModal(true)}
                      >
                        Update
                      </NeoButton>
                    )}
                  </div>
                ))}

                {isBillingAdmin && (
                  <div className="flex gap-3 pt-2">
                    <NeoButton
                      variant="secondary"
                      onClick={() => setShowPaymentModal(true)}
                      leftIcon={<CreditCard className="w-4 h-4" />}
                    >
                      Add Another Payment Method
                    </NeoButton>
                    <NeoButton
                      variant="ghost"
                      onClick={handleOpenBillingPortal}
                      disabled={isLoadingPortal}
                      leftIcon={<ExternalLink className="w-4 h-4" />}
                    >
                      {isLoadingPortal ? 'Opening...' : 'Manage in Stripe Portal'}
                    </NeoButton>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-slate-100 border-2 border-slate-300 flex items-center justify-center mx-auto mb-4">
                  <CreditCard className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 uppercase mb-2">No Payment Method</h3>
                <p className="text-sm font-bold text-slate-500 mb-4 max-w-md mx-auto">
                  Add a payment method to upgrade your plan. Recording pauses at your session limit.
                </p>
                {isBillingAdmin && (
                  <NeoButton
                    variant="primary"
                    onClick={() => setShowPaymentModal(true)}
                    leftIcon={<CreditCard className="w-4 h-4" />}
                  >
                    Add Payment Method
                  </NeoButton>
                )}
              </div>
            )}
          </NeoCard>
        </section>
      )}



      {/* Plan Change Confirmation Modal */}
      {planChangeModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" onClick={handleCloseModal}>
          <div
            className="bg-white border-4 border-slate-900 shadow-[8px_8px_0_0_#000] max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b-4 border-slate-900 bg-slate-100">
              <h2 className="text-xl font-semibold uppercase tracking-tight">
                {planChangeModal.isLoading ? 'Loading...' :
                  planChangeModal.preview?.changeType === 'new' ? 'Subscribe to Plan' :
                    planChangeModal.preview?.changeType === 'upgrade' ? 'Confirm Upgrade' :
                      planChangeModal.preview?.changeType === 'downgrade' ? 'Confirm Downgrade' :
                        'Confirm Plan Change'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="p-2 hover:bg-slate-200 transition-colors"
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
                    <div className="text-center p-4 bg-slate-100 border-2 border-slate-300 flex-1">
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
                    <div className={`text-center p-4 border-2 flex-1 ${planChangeModal.preview.changeType === 'upgrade' || planChangeModal.preview.changeType === 'new'
                      ? 'bg-emerald-50 border-emerald-600'
                      : 'bg-amber-50 border-amber-600'
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

                  {/* Session Limit Change */}
                  <div className="p-4 bg-slate-50 border-2 border-slate-200">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-600">Monthly Session Limit</span>
                      <div className="text-right">
                        <span className="line-through text-slate-400 mr-2">
                          {planChangeModal.preview.currentPlan.sessionLimit.toLocaleString()}
                        </span>
                        <span className={`font-semibold ${planChangeModal.preview.changeType === 'upgrade' || planChangeModal.preview.changeType === 'new'
                          ? 'text-emerald-600'
                          : 'text-amber-600'
                          }`}>
                          {planChangeModal.preview.newPlan.sessionLimit.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>


                  {/* Payment Method Warning */}
                  {planChangeModal.preview.requiresPaymentMethod && !planChangeModal.preview.hasPaymentMethod && (
                    <div className="p-4 bg-slate-100 border-2 border-slate-300">
                      <div className="font-semibold text-slate-900 mb-2">Payment Method Required</div>
                      <p className="text-sm text-slate-600 mb-3">
                        You must add a payment method before subscribing to a paid plan.
                      </p>
                      <NeoButton
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          handleCloseModal();
                          setShowPaymentModal(true);
                        }}
                      >
                        Add Payment Method
                      </NeoButton>
                    </div>
                  )}

                  {/* Warnings */}
                  {planChangeModal.preview.warnings.length > 0 &&
                    !(planChangeModal.preview.requiresPaymentMethod && !planChangeModal.preview.hasPaymentMethod) && (
                      <div className="p-4 bg-slate-100 border-2 border-slate-300">
                        <div className="font-semibold text-slate-900 mb-2">Important</div>
                        <ul className="text-sm text-slate-600 space-y-1">
                          {planChangeModal.preview.warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {/* When change takes effect */}
                  {planChangeModal.preview.isImmediate ? (
                    <div className="p-3 bg-slate-100 border-2 border-slate-300 text-sm">
                      <div className="font-semibold text-slate-900">Takes effect immediately</div>
                      <p className="text-slate-600 mt-1">Your new session limit will be active right away.</p>
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-100 border-2 border-slate-300 text-sm">
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
              <div className="flex gap-3 p-4 border-t-4 border-slate-900 bg-slate-50">
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
                    onClick={() => {
                      handleCloseModal();
                      setShowPaymentModal(true);
                    }}
                  >
                    Add Payment Method
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
                      'Subscribe'
                    ) : planChangeModal.preview.changeType === 'upgrade' ? (
                      'Confirm Upgrade'
                    ) : planChangeModal.preview.changeType === 'downgrade' ? (
                      'Confirm Downgrade'
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

      {/* Payment Method Modal */}
      {currentTeam && (
        <PaymentMethodModal
          teamId={currentTeam.id}
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={async () => {
            await loadTeamBilling();
            setShowPaymentModal(false);

            // If plan change modal is open, refresh the preview with updated payment methods
            if (planChangeModal.isOpen && planChangeModal.selectedPlan && currentTeam) {
              try {
                const preview = await previewPlanChange(currentTeam.id, planChangeModal.selectedPlan);
                setPlanChangeModal(prev => ({
                  ...prev,
                  preview,
                }));
              } catch (err) {
                console.error('Failed to refresh plan preview:', err);
              }
            }
          }}
        />
      )}
    </SettingsLayout>
  );
};

export default BillingSettings;
