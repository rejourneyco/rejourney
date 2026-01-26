import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { SettingsLayout } from '../../components/layout/SettingsLayout';
import { LogOut, Mail, Calendar, CheckCircle, AlertCircle, Zap, UserCircle, Download, Clock, Gift, CreditCard } from 'lucide-react';
import { getFreeTierStatus, FreeTierStatus, getDataExportStatus, exportUserData, DataExportStatus } from '../../services/api';

export const AccountSettings: React.FC = () => {
  const { user, logout } = useAuth();
  const pathPrefix = usePathPrefix();
  const [freeTierStatus, setFreeTierStatus] = useState<FreeTierStatus | null>(null);
  const [isLoadingFreeTier, setIsLoadingFreeTier] = useState(true);
  const [exportStatus, setExportStatus] = useState<DataExportStatus | null>(null);
  const [isLoadingExportStatus, setIsLoadingExportStatus] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
  }, [user]);

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
  }, [user]);

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

  const getDaysUntilNextExport = (): number | null => {
    if (!exportStatus?.nextExportAt) return null;
    const nextDate = new Date(exportStatus.nextExportAt);
    const now = new Date();
    const diffMs = nextDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  };

  if (!user) {
    return (
      <SettingsLayout title="Account" description="Manage your personal settings">
        <div className="p-8 text-center border-2 border-dashed border-slate-300 bg-slate-50">
          <p className="text-sm font-bold uppercase text-slate-400">Not logged in</p>
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout title="Account" description="Manage your personal settings">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Profile Card */}
        <section className="space-y-4">
          <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
            <UserCircle className="w-5 h-5" /> My Profile
          </h2>
          <NeoCard className="p-6">
            <div className="flex items-center gap-6 mb-8">
              <div className="w-20 h-20 bg-black text-white text-3xl font-black flex items-center justify-center border-2 border-black shadow-[4px_4px_0_0_#94a3b8]">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-black text-xl text-black tracking-tight">{user.email}</div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1 bg-slate-100 px-2 py-1 inline-block rounded">Personal Account</div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-slate-400">
                  <Mail className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Email</span>
                </div>
                <span className="font-mono text-sm font-bold text-black">{user.email}</span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-slate-400">
                  <Calendar className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Member Since</span>
                </div>
                <span className="font-mono text-sm font-bold text-black">{new Date(user.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400">
                  {user.emailVerified ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                  )}
                  <span className="text-[10px] font-black uppercase tracking-widest">Verification</span>
                </div>
                <NeoBadge variant={user.emailVerified ? 'success' : 'warning'}>
                  {user.emailVerified ? 'VERIFIED' : 'UNVERIFIED'}
                </NeoBadge>
              </div>
            </div>
          </NeoCard>

          {/* Sign Out - moved here, not in danger zone */}
          <NeoCard className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <LogOut className="w-4 h-4 text-slate-400" />
                <div>
                  <span className="text-sm font-bold text-slate-700">Sign Out</span>
                  <p className="text-[10px] text-slate-400">End your current session</p>
                </div>
              </div>
              <NeoButton
                variant="secondary"
                size="sm"
                onClick={logout}
                leftIcon={<LogOut className="w-3 h-3" />}
              >
                Sign Out
              </NeoButton>
            </div>
          </NeoCard>
        </section>

        {/* Actions Column */}
        <div className="space-y-6">
          {/* Free Tier Card */}
          <section className="space-y-4">
            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
              <Gift className="w-5 h-5 text-emerald-500" /> Free Tier
            </h2>
            <NeoCard className="p-6">
              {isLoadingFreeTier ? (
                <div className="h-24 bg-slate-100 border border-slate-200 animate-pulse"></div>
              ) : freeTierStatus ? (
                <div className="space-y-4">
                  {/* Status badge */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-widest text-slate-500">Free Tier Status</span>
                    <NeoBadge variant={freeTierStatus.isExhausted ? 'warning' : 'success'}>
                      {freeTierStatus.isExhausted ? 'EXHAUSTED' : 'ACTIVE'}
                    </NeoBadge>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-black font-bold uppercase tracking-wide">Sessions Used</span>
                      <span className="font-mono font-bold text-black">
                        {freeTierStatus.sessionsUsed.toLocaleString()} <span className="text-slate-400">/</span> {freeTierStatus.freeTierSessions.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-4 bg-slate-100 border border-slate-900 overflow-hidden relative">
                      <div
                        className={`absolute top-0 left-0 bottom-0 transition-all ${freeTierStatus.percentUsed >= 100 ? 'bg-red-500' :
                          freeTierStatus.percentUsed >= 80 ? 'bg-amber-400' : 'bg-emerald-500'
                          }`}
                        style={{ width: `${Math.min(freeTierStatus.percentUsed, 100)}%` }}
                      />
                      {/* Ticks */}
                      <div className="absolute top-0 bottom-0 left-[25%] w-px bg-white/30"></div>
                      <div className="absolute top-0 bottom-0 left-[50%] w-px bg-white/30"></div>
                      <div className="absolute top-0 bottom-0 left-[75%] w-px bg-white/30"></div>
                    </div>
                  </div>

                  {/* Info text based on status */}
                  {freeTierStatus.isExhausted ? (
                    <div className="bg-amber-50 border border-amber-200 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-amber-600" />
                        <span className="text-xs font-bold text-amber-800">Free tier exhausted</span>
                      </div>
                      <p className="text-[11px] text-amber-700">
                        Usage is now billed per team. Visit <a href={`${pathPrefix}/billing`} className="underline font-bold">Billing</a> to view your team's usage and upgrade your plan.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      {freeTierStatus.freeTierSessions.toLocaleString()} free sessions shared across all {freeTierStatus.ownedTeamCount} team{freeTierStatus.ownedTeamCount !== 1 ? 's' : ''} you own
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm font-bold text-slate-500">Unable to load free tier status</p>
              )}
            </NeoCard>
          </section>

          {/* Data Export Card (GDPR) */}
          <section className="space-y-4">
            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
              <Download className="w-5 h-5" /> Export My Data
            </h2>
            <NeoCard className="p-6">
              {isLoadingExportStatus ? (
                <div className="h-20 bg-slate-100 border border-slate-200 animate-pulse"></div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs font-bold text-slate-500">
                    Download all your account data including session summaries. Limited to once every {exportStatus?.cooldownDays || 30} days.
                  </p>

                  {exportStatus?.lastExportAt && (
                    <div className="flex items-center gap-2 text-xs">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span className="text-slate-500">
                        Last export: {new Date(exportStatus.lastExportAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}

                  {exportError && (
                    <div className="bg-red-50 border border-red-200 p-3 text-xs text-red-600 font-bold">
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
                      {isExporting ? 'Preparing Export...' : 'Download My Data'}
                    </NeoButton>
                  ) : (
                    <div className="space-y-2">
                      <NeoButton
                        disabled
                        className="w-full opacity-50"
                        leftIcon={<Clock className="w-4 h-4" />}
                      >
                        Export Available in {getDaysUntilNextExport()} Day{getDaysUntilNextExport() !== 1 ? 's' : ''}
                      </NeoButton>
                      <p className="text-[10px] text-slate-400 text-center">
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

