import React, { useState, useEffect } from 'react';
import { useAuth } from '~/shared/providers/AuthContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { SettingsLayout } from '~/shell/components/layout/SettingsLayout';
import { LogOut, Mail, Calendar, CheckCircle, AlertCircle, UserCircle, Download, Clock, Gift, CreditCard, Globe2, Info } from 'lucide-react';
import { getFreeTierStatus, FreeTierStatus, getDataExportStatus, exportUserData, DataExportStatus, updateAccountSettings } from '~/shared/api/client';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { DashboardPreferences } from './DashboardPreferences';
import {
  dashboardCardClass,
  dashboardChipClass,
  dashboardFieldClass,
  dashboardLabelClass,
  dashboardSectionTitleClass,
} from '~/shared/ui/core/dashboardStyles';

const COMMON_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Hebron',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function getTimeZoneOptions(currentTimeZone: string | null): string[] {
  return Array.from(new Set([
    currentTimeZone || null,
    getBrowserTimeZone(),
    ...COMMON_TIME_ZONES,
  ].filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
}

export const AccountSettings: React.FC = () => {
  const { user, logout } = useAuth();
  const { isDemoMode } = useDemoMode();
  const manualRefreshVersion = useDashboardManualRefreshVersion();
  const pathPrefix = usePathPrefix();
  const [freeTierStatus, setFreeTierStatus] = useState<FreeTierStatus | null>(null);
  const [isLoadingFreeTier, setIsLoadingFreeTier] = useState(true);
  const [exportStatus, setExportStatus] = useState<DataExportStatus | null>(null);
  const [isLoadingExportStatus, setIsLoadingExportStatus] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [timeZoneDraft, setTimeZoneDraft] = useState(user?.timezone || getBrowserTimeZone());
  const [savedTimeZone, setSavedTimeZone] = useState<string | null>(user?.timezone || null);
  const [isSavingTimeZone, setIsSavingTimeZone] = useState(false);
  const [timeZoneMessage, setTimeZoneMessage] = useState<string | null>(null);
  const timeZoneOptions = getTimeZoneOptions(savedTimeZone || timeZoneDraft);

  useEffect(() => {
    setTimeZoneDraft(user?.timezone || getBrowserTimeZone());
    setSavedTimeZone(user?.timezone || null);
  }, [user?.timezone]);

  useEffect(() => {
    const loadFreeTier = async () => {
      try {
        setIsLoadingFreeTier(true);
        const data = await getFreeTierStatus();
        setFreeTierStatus(data);
      } catch (err) {
        console.error('Failed to load free tier status:', err);
      } finally {
        setIsLoadingFreeTier(false);
      }
    };
    if (user) {
      loadFreeTier();
    }
  }, [manualRefreshVersion, user]);

  useEffect(() => {
    const loadExportStatus = async () => {
      try {
        setIsLoadingExportStatus(true);
        const data = await getDataExportStatus();
        setExportStatus(data);
      } catch (err) {
        console.error('Failed to load export status:', err);
      } finally {
        setIsLoadingExportStatus(false);
      }
    };
    if (user) {
      loadExportStatus();
    }
  }, [manualRefreshVersion, user]);

  const handleExportData = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const blob = await exportUserData();
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rejourney-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      // Refresh export status
      const newStatus = await getDataExportStatus();
      setExportStatus(newStatus);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveTimeZone = async () => {
    setIsSavingTimeZone(true);
    setTimeZoneMessage(null);
    try {
      const result = await updateAccountSettings({ timezone: timeZoneDraft });
      setSavedTimeZone(result.user.timezone);
      setTimeZoneMessage('Time zone saved for alert emails.');
    } catch (err) {
      setTimeZoneMessage(err instanceof Error ? err.message : 'Failed to save time zone.');
    } finally {
      setIsSavingTimeZone(false);
    }
  };

  const getDaysUntilNextExport = (): number | null => {
    if (!exportStatus?.nextExportAt) return null;
    const nextDate = new Date(exportStatus.nextExportAt);
    const now = new Date();
    const diffMs = nextDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  };
  const isInitialAccountLoading = Boolean(user)
    && isLoadingFreeTier
    && isLoadingExportStatus
    && !freeTierStatus
    && !exportStatus;

  if (!user) {
    return (
      <SettingsLayout className="rejourney-settings-page rejourney-account-settings-page" title="Account" description="Manage your personal settings" {...dashboardPageHeaderProps('account')}>
        {isDemoMode && <DashboardPreferences />}
        {isDemoMode ? (
          <div className="flex items-start gap-3 border border-[#d2e3fc] bg-[#e8f0fe] p-4 text-[#1967d2]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="text-sm font-medium">Account settings aren't available in the demo</div>
              <div className="mt-0.5 text-sm">Your profile, time zone, and data export settings appear here when you're signed in.</div>
            </div>
          </div>
        ) : (
          <div className={`${dashboardCardClass} p-8 text-center`}>
            <p className="text-sm text-[#5f6368]">Not logged in</p>
          </div>
        )}
      </SettingsLayout>
    );
  }

  if (isInitialAccountLoading) {
    return <DashboardGhostLoader variant="settings" />;
  }

  const freeTierSessionReplaysUsed = freeTierStatus?.sessionReplaysUsed ?? freeTierStatus?.sessionsUsed ?? 0;
  const freeTierSessionReplayLimit = freeTierStatus?.freeTierSessionReplays ?? freeTierStatus?.freeTierSessions ?? 0;
  const freeTierReplayPercentUsed = freeTierStatus?.sessionReplayPercentUsed ?? freeTierStatus?.percentUsed ?? 0;

  return (
    <SettingsLayout className="rejourney-settings-page rejourney-account-settings-page" title="Account" description="Manage your personal settings" {...dashboardPageHeaderProps('account')}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile Card */}
        <section className="space-y-3">
          <h2 className={`flex items-center gap-2 ${dashboardSectionTitleClass}`}>
            <UserCircle className="h-4 w-4 text-[#5f6368]" /> My profile
          </h2>
          <NeoCard className="p-6">
            <div className="mb-6 flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-[#e8f0fe] text-xl font-medium text-[#1967d2]">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-medium text-[#202124]">{user.email}</div>
                <span className={`mt-1 ${dashboardChipClass('neutral')}`}>Personal account</span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-[#e8eaed] pb-4">
                <div className="flex items-center gap-2 text-[#5f6368]">
                  <Mail className="w-4 h-4" />
                  <span className={dashboardLabelClass}>Email</span>
                </div>
                <span className="min-w-0 truncate text-sm text-[#202124]">{user.email}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-[#e8eaed] pb-4">
                <div className="flex items-center gap-2 text-[#5f6368]">
                  <Calendar className="w-4 h-4" />
                  <span className={dashboardLabelClass}>Member since</span>
                </div>
                <span className="text-sm tabular-nums text-[#202124]">{new Date(user.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[#5f6368]">
                  {user.emailVerified ? (
                    <CheckCircle className="w-4 h-4 text-[#188038]" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-[#e37400]" />
                  )}
                  <span className={dashboardLabelClass}>Verification</span>
                </div>
                <NeoBadge variant={user.emailVerified ? 'success' : 'warning'} size="sm">
                  {user.emailVerified ? 'Verified' : 'Unverified'}
                </NeoBadge>
              </div>
            </div>
          </NeoCard>

          <NeoCard className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2 text-[#5f6368]">
                  <Globe2 className="h-4 w-4" />
                  <span className={dashboardLabelClass}>Time zone</span>
                </div>
                <select
                  value={timeZoneDraft}
                  onChange={(event) => {
                    setTimeZoneDraft(event.target.value);
                    setTimeZoneMessage(null);
                  }}
                  aria-label="Time zone"
                  className={dashboardFieldClass}
                >
                  {timeZoneOptions.map((timeZone) => (
                    <option key={timeZone} value={timeZone}>{timeZone}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[#5f6368]">
                  Alert email timestamps use this setting.
                </p>
                {timeZoneMessage && (
                  <p className={`mt-2 text-xs font-medium ${timeZoneMessage.includes('saved') ? 'text-[#137333]' : 'text-[#c5221f]'}`}>
                    {timeZoneMessage}
                  </p>
                )}
              </div>
              <NeoButton
                variant="secondary"
                size="sm"
                onClick={handleSaveTimeZone}
                disabled={isSavingTimeZone || timeZoneDraft === savedTimeZone}
                leftIcon={<Clock className="h-3.5 w-3.5" />}
              >
                {isSavingTimeZone ? 'Saving...' : 'Save'}
              </NeoButton>
            </div>
          </NeoCard>

          {/* Sign out */}
          <NeoCard className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <LogOut className="w-4 h-4 text-[#5f6368]" />
                <div>
                  <span className="text-sm font-medium text-[#202124]">Sign out</span>
                  <p className="text-xs text-[#5f6368]">End your current session</p>
                </div>
              </div>
              <NeoButton
                variant="secondary"
                size="sm"
                onClick={logout}
                leftIcon={<LogOut className="h-3.5 w-3.5" />}
              >
                Sign out
              </NeoButton>
            </div>
          </NeoCard>
        </section>

        {/* Actions Column */}
        <div className="space-y-6">
          <DashboardPreferences />
          {/* Free Tier Card */}
          <section className="space-y-3">
            <h2 className={`flex items-center gap-2 ${dashboardSectionTitleClass}`}>
              <Gift className="h-4 w-4 text-[#5f6368]" /> Free tier
            </h2>
            <NeoCard className="p-6">
              {isLoadingFreeTier ? (
                <div className="h-24 animate-pulse bg-[#f1f3f4]"></div>
              ) : freeTierStatus ? (
                <div className="space-y-4">
                  {/* Status badge */}
                  <div className="flex items-center justify-between gap-3">
                    <span className={dashboardLabelClass}>Free tier status</span>
                    <NeoBadge variant={freeTierStatus.isExhausted ? 'warning' : 'success'} size="sm">
                      {freeTierStatus.isExhausted ? 'Exhausted' : 'Active'}
                    </NeoBadge>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="mb-2 flex justify-between gap-3 text-xs">
                      <span className="font-medium text-[#3c4043]">Session replays used</span>
                      <span className="tabular-nums text-[#202124]">
                        {freeTierSessionReplaysUsed.toLocaleString()} <span className="text-[#80868b]">/</span> {freeTierSessionReplayLimit.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-none bg-[#e8eaed]">
                      <div
                        className={`h-full transition-[width] ${freeTierReplayPercentUsed >= 100 ? 'bg-[#d93025]' :
                          freeTierReplayPercentUsed >= 80 ? 'bg-[#f9ab00]' : 'bg-[#1a73e8]'
                          }`}
                        style={{ width: `${Math.min(freeTierReplayPercentUsed, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Info text based on status */}
                  {freeTierStatus.isExhausted ? (
                    <div className="space-y-1 border border-[#feefc3] bg-[#fef7e0] p-3 text-[#b06000]">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4" />
                        <span className="text-xs font-medium">Free tier exhausted</span>
                      </div>
                      <p className="text-xs">
                        Usage is now billed per team. Visit <a href={`${pathPrefix}/billing`} className="font-medium underline">Billing</a> to view your team's usage and upgrade your plan.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs tabular-nums text-[#5f6368]">
                      {freeTierSessionReplayLimit.toLocaleString()} free session replays shared across all {freeTierStatus.ownedTeamCount} team{freeTierStatus.ownedTeamCount !== 1 ? 's' : ''} you own
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[#5f6368]">Unable to load free tier status</p>
              )}
            </NeoCard>
          </section>

          {/* Data Export Card (GDPR) */}
          <section className="space-y-3">
            <h2 className={`flex items-center gap-2 ${dashboardSectionTitleClass}`}>
              <Download className="h-4 w-4 text-[#5f6368]" /> Export my data
            </h2>
            <NeoCard className="p-6">
              {isLoadingExportStatus ? (
                <div className="h-20 animate-pulse bg-[#f1f3f4]"></div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-[#3c4043]">
                    Download all your account data including session summaries. Limited to once every {exportStatus?.cooldownDays || 30} days.
                  </p>

                  {exportStatus?.lastExportAt && (
                    <div className="flex items-center gap-2 text-xs text-[#5f6368]">
                      <Clock className="h-3.5 w-3.5" />
                      <span className="tabular-nums">
                        Last export: {new Date(exportStatus.lastExportAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}

                  {exportError && (
                    <div className="border border-[#f6aea9] bg-[#fce8e6] p-3 text-xs text-[#a50e0e]">
                      {exportError}
                    </div>
                  )}

                  {exportStatus?.canExport ? (
                    <NeoButton
                      onClick={handleExportData}
                      disabled={isExporting}
                      className="w-full"
                      leftIcon={<Download className="w-4 h-4" />}
                    >
                      {isExporting ? 'Preparing export...' : 'Download my data'}
                    </NeoButton>
                  ) : (
                    <div className="space-y-2">
                      <NeoButton
                        disabled
                        className="w-full"
                        leftIcon={<Clock className="w-4 h-4" />}
                      >
                        Export available in {getDaysUntilNextExport()} day{getDaysUntilNextExport() !== 1 ? 's' : ''}
                      </NeoButton>
                      <p className="text-center text-xs tabular-nums text-[#5f6368]">
                        Next export available: {exportStatus?.nextExportAt ? new Date(exportStatus.nextExportAt).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </NeoCard>
          </section>
        </div>
      </div>
    </SettingsLayout>
  );
};

export default AccountSettings;
