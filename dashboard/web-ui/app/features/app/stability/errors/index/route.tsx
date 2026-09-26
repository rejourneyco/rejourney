
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
        title="Errors"
        subtitle="Unified collection of all exceptions and runtime failures"
        icon={<Bug className="h-5 w-5" />}
      >
        <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
      </DashboardPageHeader>

      <div className="mx-auto w-full max-w-[1800px] space-y-4 px-6 pt-6">
        <NeoCard variant="flat" disablePadding className="overflow-hidden bg-white">
          <div className="border-b border-[#e8eaed] bg-[#f8fafd] px-4 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="relative w-64 md:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#80868b]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search error names, messages or screens..."
                  className="w-full rounded-none border border-[#dadce0] bg-white py-1.5 pl-9 pr-3 text-sm text-[#202124] outline-none transition-colors placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
                />
              </div>
            </div>
            <div className="flex items-center text-sm font-medium text-[#5f6368] gap-4">
               <span>{filteredGroups.length} Issues</span>
               <span className="hidden md:inline">|</span>
               <span className="hidden md:inline bg-[#f1f3f4] px-2 py-0.5 text-[#3c4043] tabular-nums">
                  {formatCompact(filteredGroups.reduce((acc, g) => acc + g.count, 0))} Total Events
               </span>
            </div>
          </div>

          <div className="border-b border-[#e8eaed] bg-white px-4">
            <div className="flex items-center gap-4 py-3 text-xs font-medium text-[#5f6368]">
              <div className="w-6 shrink-0" />
              <div className="min-w-0 flex-1">Issue details</div>
              <div className="w-32 hidden md:block">Environment</div>
              <div className="w-24 text-right hidden sm:block">First seen</div>
              <div className="w-24 text-right hidden lg:block">Last seen</div>
              <div className="w-16 text-right">Events</div>
              <div className="w-16 text-right">Users</div>
              <div className="w-8 shrink-0" />
            </div>
          </div>

          <div className="divide-y divide-[#e8eaed] bg-white">
            {filteredGroups.length === 0 && (
              <div className="py-24 text-center text-[#80868b]">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-[#bdc1c6]" />
                <p className="text-lg font-medium text-[#5f6368]">No errors found</p>
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
                  className={`transition-colors ${isExpanded ? 'bg-[#f8fafd]' : 'hover:bg-[#f8fafd]'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-4 py-3"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.fingerprint)}
                  >
                    <div className="flex w-6 shrink-0 justify-center">
                      <div className={`h-2.5 w-2.5 rounded-full ${isExpanded ? 'bg-[#d93025]' : 'bg-[#dadce0]'} transition-colors`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium text-[#202124] text-[13px]">{group.errorName}</h3>
                        {group.screens.length > 0 && (
                          <span className="hidden xl:inline-block px-1.5 py-0.5 rounded-none bg-[#f1f3f4] text-[#5f6368] text-[11px] font-medium">
                            {group.screens[0]}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-[#5f6368] mt-0.5" title={group.message}>{group.message}</p>
                    </div>
                    
                    <div className="w-32 hidden md:block flex-shrink-0">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="text-[11px] font-medium text-[#3c4043] bg-[#f1f3f4] px-1.5 rounded-none" title={topDevice}>{topDeviceLabel}</span>
                        <span className="text-[11px] font-medium text-[#3c4043] bg-[#f1f3f4] px-1.5 rounded-none">v{topVersion}</span>
                      </div>
                    </div>

                    <div className="w-24 text-right hidden sm:block">
                      <span className="text-xs font-medium text-[#5f6368]" title={new Date(group.firstSeen).toLocaleString()}>{formatAge(group.firstSeen)}</span>
                    </div>

                    <div className="w-24 text-right hidden lg:block">
                      <span className="text-xs font-medium text-[#3c4043]" title={new Date(group.lastOccurred).toLocaleString()}>{formatLastSeen(group.lastOccurred)}</span>
                    </div>

                    <div className="w-16 text-right">
                      <span className="inline-block px-2 py-0.5 rounded-none text-xs font-medium tabular-nums text-[#202124]">
                        {formatCompact(group.count)}
                      </span>
                    </div>

                    <div className="w-16 text-right">
                       <span className="inline-block text-xs font-mono font-medium text-[#3c4043]">
                        {formatCompact(group.users.length)}
                      </span>
                    </div>

                    <div className="flex w-8 shrink-0 justify-end">
                      <div
                        className={`flex h-6 w-6 items-center justify-center rounded-none text-[#80868b] transition ${
                          isExpanded ? 'rotate-180 bg-[#f1f3f4] text-[#202124]' : 'group-hover/row:bg-[#f1f3f4] group-hover/row:text-[#3c4043]'
                        }`}
                      >
                        <ChevronDown size={14} />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[#e8eaed] bg-[#f8fafd] p-4 sm:p-5 cursor-default">
                      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
                        
                        <div className="lg:col-span-3 flex flex-col gap-4">
                           <NeoCard variant="flat" disablePadding className="overflow-hidden">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eaed] px-4 py-2.5">
                                <h4 className="flex items-center gap-2 text-sm font-medium text-[#202124]">
                                  <Code size={14} className="text-[#5f6368]" />
                                  Stack trace
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
                                  >
                                    Save
                                  </NeoButton>
                                </div>
                              </div>

                              {stackTrace ? (
                                <div className="m-4 max-h-[400px] overflow-auto whitespace-pre border border-[#e8eaed] bg-[#f8fafd] p-4 font-mono text-xs leading-relaxed text-[#202124]">
                                  {stackTrace}
                                </div>
                              ) : (
                                <div className="px-6 py-10 text-center text-sm text-[#5f6368] bg-[#f8fafd]">No stack trace captured for this occurrence.</div>
                              )}
                           </NeoCard>
                           
                           <div className="flex flex-wrap gap-4 text-xs">
                             <div className="flex items-center gap-1.5 text-[#3c4043] bg-white px-2 py-1 rounded-none border border-[#dadce0]">
                               <Monitor size={12} className="text-[#80868b]" />
                               <span className="font-medium text-[#5f6368]">Screen:</span> {sampleError?.screenName || group.screens[0] || 'Unknown'}
                             </div>
                             {(sampleError?.appVersion || topVersion !== '?') && (
                               <div className="flex items-center gap-1.5 text-[#3c4043] bg-white px-2 py-1 rounded-none border border-[#dadce0]">
                                 <Smartphone size={12} className="text-[#80868b]" />
                                 <span className="font-medium text-[#5f6368]">App Version:</span> {sampleError?.appVersion || topVersion}
                               </div>
                             )}
                           </div>
                        </div>

                        <div className="lg:col-span-1 flex flex-col gap-4">
                           <NeoCard variant="flat" disablePadding className="p-4">
                              <h4 className="text-sm font-medium text-[#202124] mb-3 flex items-center gap-2">
                                <Play size={14} className="text-[#5f6368]" />
                                Session replay
                              </h4>
                              <p className="text-xs text-[#3c4043] mb-4 leading-relaxed">
                                Watch the exact user journey leading up to this exception to understand the steps to reproduce.
                              </p>
                              {canOpenReplay ? (
                                <NeoButton 
                                  variant="primary" 
                                  className="w-full justify-center"
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      if (sampleError?.sessionId) navigate(`${pathPrefix}/sessions/${sampleError.sessionId}`);
                                  }}
                                >
                                  Play session
                                </NeoButton>
                              ) : (
                                <p className="rounded-none border border-[#dadce0] bg-white px-3 py-2 text-xs text-[#5f6368]">
                                  Replay unavailable for this sampled occurrence.
                                </p>
                              )}
                           </NeoCard>

                           <NeoCard variant="flat" disablePadding className="p-4 flex-1">
                             <h4 className="text-sm font-medium text-[#202124] mb-3 border-b border-[#e8eaed] pb-2">
                               Event Properties
                             </h4>
                             <dl className="space-y-3 text-xs">
                               <div>
                                  <dt className="text-[#5f6368] mb-0.5">Occurred at</dt>
                                  <dd className="font-medium text-[#202124]">{new Date(sampleError?.timestamp || group.lastOccurred).toLocaleString()}</dd>
                               </div>
                               <div>
                                  <dt className="text-[#5f6368] mb-0.5">Device</dt>
                                  <dd className="font-medium text-[#202124]" title={sampleError?.deviceModel || topDevice}>
                                    {formatDeviceModel(sampleError?.deviceModel || topDevice, 'Unknown')}
                                  </dd>
                               </div>
                               <div>
                                  <dt className="text-[#5f6368] mb-0.5">Error name</dt>
                                  <dd className="font-medium text-[#202124] break-words">{group.errorName || 'Unknown'}</dd>
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
