
import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Check,
  Download,
  Play,
  Monitor,
  Smartphone,
  Search,
  Filter,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { getErrorsOverview, type ErrorOverviewGroup } from '~/shared/api/client';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { platformLensToSessionPlatform, useSharedPlatformLens } from '~/shared/hooks/useSharedPlatformLens';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { formatAge, formatLastSeen } from '~/shared/lib/formatDates';
import { formatDeviceModel, getDeviceModelSearchText } from '~/shared/lib/deviceModelNames';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { DashboardGhostLoader, useInitialDashboardLoad } from '~/shared/ui/core/DashboardGhostLoader';

const formatCompact = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
};

export const ErrorsList: React.FC = () => {
  const { selectedProject, isLoading: contextLoading } = useSessionData();
  const manualRefreshVersion = useDashboardManualRefreshVersion();
  const { isDemoMode } = useDemoMode();
  const currentProject = selectedProject;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();

  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(currentProject?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedStack, setCopiedStack] = useState<string | null>(null);

  const [errorGroups, setErrorGroups] = useState<ErrorOverviewGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const { platformLens } = useSharedPlatformLens(currentProject?.id, currentProject?.platforms);
  const platform = platformLensToSessionPlatform(platformLens);

  useEffect(() => {
    if (!isDemoMode && !currentProject) {
      setErrorGroups([]);
      setLoading(false);
      return;
    }

    const fetchErrors = async () => {
      setLoading(true);
      try {
        const data = await getErrorsOverview(currentProject?.id || 'demo', timeRange, platform);
        setErrorGroups(data.groups || []);
      } catch (err) {
        console.error('Failed to fetch errors:', err);
        setErrorGroups([]);
      } finally {
        setLoading(false);
      }
    };

    fetchErrors();
  }, [currentProject?.id, isDemoMode, manualRefreshVersion, timeRange, platform]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return errorGroups;
    const query = searchQuery.toLowerCase();

    return errorGroups.filter(
      (group) =>
        group.errorName.toLowerCase().includes(query) ||
        group.message.toLowerCase().includes(query) ||
        group.screens.some((screen) => screen.toLowerCase().includes(query)) ||
        Object.keys(group.affectedDevices).some((device) => getDeviceModelSearchText(device).includes(query)),
    );
  }, [errorGroups, searchQuery]);

  const focusId = searchParams.get('focusId');
  useEffect(() => {
    if (!focusId || loading || errorGroups.length === 0) return;

    const targetGroup = errorGroups.find(
      (group) =>
        group.fingerprint === focusId ||
        group.errorName === focusId ||
        group.errorName.toLowerCase() === focusId.toLowerCase(),
    );

    if (!targetGroup) return;

    setExpandedGroup(targetGroup.fingerprint);
    setTimeout(() => {
      const element = document.getElementById(`error-group-${targetGroup.fingerprint}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, [focusId, loading, errorGroups]);

  const handleCopyStack = (stack: string, event: React.MouseEvent) => {
    event.stopPropagation();
    navigator.clipboard.writeText(stack);
    setCopiedStack(stack);
    setTimeout(() => setCopiedStack(null), 2000);
  };

  const handleDownloadStack = (stack: string, id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const blob = new Blob([stack], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `error-trace-${id}-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const shouldShowInitialGhost = useInitialDashboardLoad(loading || contextLoading);

  if (shouldShowInitialGhost) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="Errors Database"
        subtitle="Unified collection of all exceptions and runtime failures"
        icon={<Bug className="h-5 w-5" />}
        iconColor="bg-[#fce7f3]"
      >
        <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
      </DashboardPageHeader>

      <div className="mx-auto w-full max-w-[1800px] space-y-4 px-6 pt-6">
        <NeoCard variant="flat" disablePadding className="overflow-hidden bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="relative w-64 md:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search error names, messages or screens..."
                  className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                />
              </div>
            </div>
            <div className="flex items-center text-sm font-medium text-slate-500 gap-4">
               <span>{filteredGroups.length} Issues</span>
               <span className="hidden md:inline">|</span>
               <span className="hidden md:inline text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                  {formatCompact(filteredGroups.reduce((acc, g) => acc + g.count, 0))} Total Events
               </span>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-white px-4">
            <div className="flex items-center gap-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <div className="w-6 shrink-0" />
              <div className="min-w-0 flex-1">Issue Details</div>
              <div className="w-32 hidden md:block">Environment</div>
              <div className="w-24 text-right hidden sm:block">First Seen</div>
              <div className="w-24 text-right hidden lg:block">Last Seen</div>
              <div className="w-16 text-right">Events</div>
              <div className="w-16 text-right">Users</div>
              <div className="w-8 shrink-0" />
            </div>
          </div>

          <div className="divide-y divide-slate-100 bg-white">
            {filteredGroups.length === 0 && (
              <div className="py-24 text-center text-slate-400">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                <p className="text-lg font-semibold text-slate-700">No errors found</p>
                <p className="text-sm mt-1">Runtime issues will appear here when they are detected.</p>
              </div>
            )}

            {filteredGroups.map((group) => {
              const isExpanded = expandedGroup === group.fingerprint;
              const deviceList = Object.keys(group.affectedDevices);
              const topDevice = deviceList[0] || 'Unknown';
              const topDeviceLabel = formatDeviceModel(topDevice, 'Unknown');
              const versionList = Object.keys(group.affectedVersions);
              const topVersion = versionList[0] || '?';
              const sampleError = group.sampleError;
              const stackTrace = sampleError?.stack || null;
              const canOpenReplay = Boolean(sampleError?.sessionId && sampleError.canOpenReplay);

              return (
                <div
                  key={group.fingerprint}
                  id={`error-group-${group.fingerprint}`}
                  className={`transition-colors ${isExpanded ? 'bg-rose-50/20' : 'hover:bg-slate-50'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-4 py-3"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.fingerprint)}
                  >
                    <div className="flex w-6 shrink-0 justify-center">
                      <div className={`h-2.5 w-2.5 rounded-full ${isExpanded ? 'bg-rose-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-slate-300 group-hover/row:bg-rose-400'} transition-all`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-slate-900 text-[13px]">{group.errorName}</h3>
                        {group.screens.length > 0 && (
                          <span className="hidden xl:inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-medium border border-slate-200">
                            {group.screens[0]}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500 mt-0.5" title={group.message}>{group.message}</p>
                    </div>
                    
                    <div className="w-32 hidden md:block flex-shrink-0">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1.5 rounded" title={topDevice}>{topDeviceLabel}</span>
                        <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1.5 rounded">v{topVersion}</span>
                      </div>
                    </div>

                    <div className="w-24 text-right hidden sm:block">
                      <span className="text-xs font-medium text-slate-500" title={new Date(group.firstSeen).toLocaleString()}>{formatAge(group.firstSeen)}</span>
                    </div>

                    <div className="w-24 text-right hidden lg:block">
                      <span className="text-xs font-semibold text-slate-700" title={new Date(group.lastOccurred).toLocaleString()}>{formatLastSeen(group.lastOccurred)}</span>
                    </div>

                    <div className="w-16 text-right">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-medium bg-rose-100 text-rose-800 border border-rose-200">
                        {formatCompact(group.count)}
                      </span>
                    </div>

                    <div className="w-16 text-right">
                       <span className="inline-block text-xs font-mono font-medium text-slate-600">
                        {formatCompact(group.users.length)}
                      </span>
                    </div>

                    <div className="flex w-8 shrink-0 justify-end">
                      <div
                        className={`flex h-6 w-6 items-center justify-center rounded text-slate-400 transition ${
                          isExpanded ? 'rotate-180 text-rose-600 bg-rose-100' : 'group-hover/row:bg-slate-200 group-hover/row:text-slate-600'
                        }`}
                      >
                        <ChevronDown size={14} />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-200 bg-slate-50/50 p-4 sm:p-5 shadow-inner cursor-default">
                      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
                        
                        <div className="lg:col-span-3 flex flex-col gap-4">
                           <NeoCard variant="flat" disablePadding className="overflow-hidden border border-slate-200 bg-white">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 bg-slate-50">
                                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
                                  <Code size={14} className="text-rose-500" />
                                  Stack Trace Analysis
                                </h4>
                                <div className="flex items-center gap-1.5">
                                  <NeoButton
                                    variant="ghost"
                                    size="sm"
                                    leftIcon={copiedStack === stackTrace ? <Check size={13} /> : <Copy size={13} />}
                                    onClick={(e) => {
                                      if (stackTrace) handleCopyStack(stackTrace, e);
                                    }}
                                    disabled={!stackTrace}
                                    className="h-7 text-xs px-2"
                                  >
                                    Copy
                                  </NeoButton>
                                  <NeoButton
                                    variant="ghost"
                                    size="sm"
                                    leftIcon={<Download size={13} />}
                                    onClick={(e) => {
                                      if (stackTrace) handleDownloadStack(stackTrace, group.fingerprint, e);
                                    }}
                                    disabled={!stackTrace}
                                    className="h-7 text-xs px-2"
                                  >
                                    Save
                                  </NeoButton>
                                </div>
                              </div>

                              {stackTrace ? (
                                <div className="max-h-[400px] overflow-auto bg-[#0d1117] p-4 font-mono text-[11px] leading-relaxed text-slate-300 selection:bg-rose-900 overflow-x-auto">
                                  {stackTrace}
                                </div>
                              ) : (
                                <div className="px-6 py-10 text-center text-sm text-slate-500 bg-slate-50">No stack trace captured for this occurrence.</div>
                              )}
                           </NeoCard>
                           
                           <div className="flex flex-wrap gap-4 text-xs">
                             <div className="flex items-center gap-1.5 text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm">
                               <Monitor size={12} className="text-slate-400" />
                               <span className="font-semibold text-slate-700">Screen:</span> {sampleError?.screenName || group.screens[0] || 'Unknown'}
                             </div>
                             {(sampleError?.appVersion || topVersion !== '?') && (
                               <div className="flex items-center gap-1.5 text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm">
                                 <Smartphone size={12} className="text-slate-400" />
                                 <span className="font-semibold text-slate-700">App Version:</span> {sampleError?.appVersion || topVersion}
                               </div>
                             )}
                           </div>
                        </div>

                        <div className="lg:col-span-1 flex flex-col gap-4">
                           <NeoCard variant="flat" className="p-4 bg-rose-50/50 border-rose-200 shadow-sm">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-rose-800 mb-3 flex items-center gap-2">
                                <Play size={14} className="text-rose-600 fill-current" />
                                Session Replay
                              </h4>
                              <p className="text-xs text-rose-700/80 mb-4 leading-relaxed">
                                Watch the exact user journey leading up to this exception to understand the steps to reproduce.
                              </p>
                              {canOpenReplay ? (
                                <NeoButton 
                                  variant="primary" 
                                  className="w-full justify-center bg-rose-500 hover:bg-rose-600 focus:ring-rose-500 text-white border-0 py-2 shadow-sm"
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      if (sampleError?.sessionId) navigate(`${pathPrefix}/sessions/${sampleError.sessionId}`);
                                  }}
                                >
                                  Play Session
                                </NeoButton>
                              ) : (
                                <p className="rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700">
                                  Replay unavailable for this sampled occurrence.
                                </p>
                              )}
                           </NeoCard>

                           <NeoCard variant="flat" className="p-4 border-slate-200 bg-white shadow-sm flex-1">
                             <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 border-b border-slate-100 pb-2">
                               Event Properties
                             </h4>
                             <dl className="space-y-3 text-xs">
                               <div>
                                  <dt className="text-slate-500 mb-0.5">Occurred At</dt>
                                  <dd className="font-medium text-slate-800">{new Date(sampleError?.timestamp || group.lastOccurred).toLocaleString()}</dd>
                               </div>
                               <div>
                                  <dt className="text-slate-500 mb-0.5">Device</dt>
                                  <dd className="font-medium text-slate-800" title={sampleError?.deviceModel || topDevice}>
                                    {formatDeviceModel(sampleError?.deviceModel || topDevice, 'Unknown')}
                                  </dd>
                               </div>
                               <div>
                                  <dt className="text-slate-500 mb-0.5">Error Name</dt>
                                  <dd className="font-medium text-slate-800 break-words">{group.errorName || 'Unknown'}</dd>
                               </div>
                             </dl>
                           </NeoCard>
                        </div>
                        
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </NeoCard>
      </div>
    </div>
  );
};

export default ErrorsList;
