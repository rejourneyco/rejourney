
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
  Loader,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { api, CrashReport, getCrashesOverview, type CrashOverviewGroup } from '~/shared/api/client';
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

export const CrashesList: React.FC = () => {
  const { selectedProject, projectsLoading } = useSessionData();
  const manualRefreshVersion = useDashboardManualRefreshVersion();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();

  const [crashGroups, setCrashGroups] = useState<CrashOverviewGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [crashDetails, setCrashDetails] = useState<Record<string, CrashReport | null>>({});
  const [copiedStack, setCopiedStack] = useState<string | null>(null);
  const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
  const platform = platformLensToSessionPlatform(platformLens);

  useEffect(() => {
    if (!selectedProject?.id) {
      setCrashGroups([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    getCrashesOverview(selectedProject.id, timeRange, platform).then((response) => {
      if (cancelled) return;
      setCrashGroups(response.groups || []);
    }).catch((err) => {
      if (cancelled) return;
      console.error('Failed to fetch crashes overview:', err);
      setCrashGroups([]);
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
       cancelled = true;
    };
  }, [manualRefreshVersion, selectedProject?.id, timeRange, platform]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const filteredCrashGroups = useMemo(() => {
    if (!searchQuery.trim()) return crashGroups;
    const query = searchQuery.toLowerCase();

    return crashGroups.filter(
      (group) =>
        group.name.toLowerCase().includes(query) ||
        Object.keys(group.affectedDevices).some((device) => getDeviceModelSearchText(device).includes(query)) ||
        Object.keys(group.affectedVersions).some((version) => version.toLowerCase().includes(query)),
    );
  }, [crashGroups, searchQuery]);

  const focusId = searchParams.get('focusId');
  useEffect(() => {
    if (!focusId || isLoading || crashGroups.length === 0) return;

    const targetGroup = crashGroups.find((group) => group.name === focusId);
    if (!targetGroup) return;

    setExpandedGroup(targetGroup.name);
    setTimeout(() => {
      const element = document.getElementById(`crash-group-${targetGroup.name}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, [focusId, isLoading, crashGroups]);

  useEffect(() => {
    if (!expandedGroup || !selectedProject?.id) return;
    if (Object.prototype.hasOwnProperty.call(crashDetails, expandedGroup)) return;

    const group = crashGroups.find((item) => item.name === expandedGroup);
    if (!group) return;
    if (!group.sampleCrashId) {
      setCrashDetails((prev) => ({ ...prev, [expandedGroup]: null }));
      return;
    }

    const fetchCrashForGroup = async () => {
      try {
        const fullCrash = await api.getCrash(selectedProject.id, group.sampleCrashId);
        setCrashDetails((prev) => ({ ...prev, [expandedGroup]: fullCrash }));
      } catch (err) {
        console.error('Failed to fetch crash details:', err);
        setCrashDetails((prev) => ({ ...prev, [expandedGroup]: null }));
      }
    };

    fetchCrashForGroup();
  }, [expandedGroup, selectedProject?.id, crashGroups, crashDetails]);

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
    link.download = `crash-trace-${id}-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const shouldShowInitialGhost = useInitialDashboardLoad(isLoading || projectsLoading);

  if (shouldShowInitialGhost) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="Crashes"
        subtitle="Unified collection of critical failures and exceptions"
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
                  placeholder="Search crash names, devices or versions..."
                  className="w-full rounded-none border border-[#dadce0] bg-white py-1.5 pl-9 pr-3 text-sm text-[#202124] outline-none transition-colors placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
                />
              </div>
            </div>
            <div className="flex items-center text-sm font-medium text-[#5f6368] gap-4">
               <span>{filteredCrashGroups.length} Issues</span>
               <span className="hidden md:inline">|</span>
               <span className="hidden md:inline bg-[#f1f3f4] px-2 py-0.5 text-[#3c4043] tabular-nums">
                  {formatCompact(filteredCrashGroups.reduce((acc, g) => acc + g.count, 0))} Total Events
               </span>
            </div>
          </div>

          {/* Table Header */}
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
            {filteredCrashGroups.length === 0 && (
              <div className="py-24 text-center text-[#80868b]">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-[#bdc1c6]" />
                <p className="text-lg font-medium text-[#5f6368]">No crashes detected</p>
                <p className="text-sm mt-1">Your app appears stable for the selected time range.</p>
              </div>
            )}

            {filteredCrashGroups.map((group) => {
              const isExpanded = expandedGroup === group.name;
              const detail = crashDetails[group.name];
              const hasLoadedDetail = Object.prototype.hasOwnProperty.call(crashDetails, group.name);
              const deviceList = Object.keys(group.affectedDevices);
              const topDevice = deviceList[0] || 'Unknown';
              const topDeviceLabel = formatDeviceModel(topDevice, 'Unknown');
              const versionList = Object.keys(group.affectedVersions);
              const topVersion = versionList[0] || '?';
              const canOpenReplay = Boolean(group.sampleSessionId && group.canOpenReplay);

              return (
                <div
                  key={group.id}
                  id={`crash-group-${group.name}`}
                  className={`transition-colors ${isExpanded ? 'bg-[#f8fafd]' : 'hover:bg-[#f8fafd]'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-4 py-3"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.name)}
                  >
                    <div className="flex w-6 shrink-0 justify-center">
                      <div className={`h-2.5 w-2.5 rounded-full ${isExpanded ? 'bg-[#d93025]' : 'bg-[#dadce0]'} transition-colors`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium text-[#202124] text-[13px]">{group.name}</h3>
                      </div>
                      <p className="truncate text-xs text-[#5f6368] mt-0.5">
                         Affecting {deviceList.length} device model{deviceList.length === 1 ? '' : 's'}
                      </p>
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

                    <div className="flex w-8 justify-end shrink-0">
                      <div
                        className={`flex h-6 w-6 items-center justify-center rounded-none text-[#80868b] transition ${
                          isExpanded ? 'rotate-180 bg-[#f1f3f4] text-[#202124]' : 'group-hover/row:bg-[#f1f3f4] group-hover/row:text-[#3c4043]'
                        }`}
                      >
                        <ChevronDown size={14} />
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="border-t border-[#e8eaed] bg-[#f8fafd] p-4 sm:p-5 cursor-default">
                      {!hasLoadedDetail ? (
                         <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-[#5f6368]">
                            <Loader size={18} className="animate-spin" />
                            Loading crash details...
                         </div>
                      ) : (
                         <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
                            {/* Deep Analysis Main (Stacktrace) */}
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
                                        leftIcon={copiedStack === detail?.stackTrace ? <Check size={13} /> : <Copy size={13} />}
                                        onClick={(e) => detail?.stackTrace && handleCopyStack(detail.stackTrace, e)}
                                        disabled={!detail?.stackTrace}
                                      >
                                        Copy
                                      </NeoButton>
                                      <NeoButton
                                        variant="ghost"
                                        size="sm"
                                        leftIcon={<Download size={13} />}
                                        onClick={(e) => detail?.stackTrace && detail?.id && handleDownloadStack(detail.stackTrace, detail.id, e)}
                                        disabled={!detail?.stackTrace}
                                      >
                                        Save
                                      </NeoButton>
                                    </div>
                                  </div>

                                  {detail?.stackTrace ? (
                                    <div className="m-4 max-h-[400px] overflow-auto whitespace-pre border border-[#e8eaed] bg-[#f8fafd] p-4 font-mono text-xs leading-relaxed text-[#202124]">
                                      {detail.stackTrace}
                                    </div>
                                  ) : (
                                    <div className="px-6 py-10 text-center text-sm text-[#5f6368] bg-[#f8fafd]">No stack trace captured.</div>
                                  )}
                               </NeoCard>
                               
                               {/* Small contextual facts */}
                               <div className="flex flex-wrap gap-4 text-xs">
                                 <div className="flex items-center gap-1.5 text-[#3c4043] bg-white px-2 py-1 rounded-none border border-[#dadce0]">
                                   <Smartphone size={12} className="text-[#80868b]" />
                                   <span className="font-medium text-[#5f6368]">Device model:</span>{' '}
                                   <span title={detail?.deviceMetadata?.model || topDevice}>
                                     {formatDeviceModel(detail?.deviceMetadata?.model || topDevice, 'Unknown')}
                                   </span>
                                 </div>
                                 <div className="flex items-center gap-1.5 text-[#3c4043] bg-white px-2 py-1 rounded-none border border-[#dadce0]">
                                   <Activity size={12} className="text-[#80868b]" />
                                   <span className="font-medium text-[#5f6368]">OS:</span> {detail?.deviceMetadata?.systemName || 'Unknown'} {detail?.deviceMetadata?.systemVersion || ''}
                                 </div>
                               </div>
                            </div>

                            {/* Action Panel / Context */}
                            <div className="lg:col-span-1 flex flex-col gap-4">
                               <NeoCard variant="flat" disablePadding className="p-4">
                                  <h4 className="text-sm font-medium text-[#202124] mb-3 flex items-center gap-2">
                                    <Play size={14} className="text-[#5f6368]" />
                                    Session replay
                                  </h4>
                                  <p className="text-xs text-[#3c4043] mb-4 leading-relaxed">
                                    Watch the exact user journey up to the fatal crash sequence.
                                  </p>
                                  {canOpenReplay ? (
                                    <NeoButton 
                                      variant="primary" 
                                      className="w-full justify-center"
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          navigate(`${pathPrefix}/sessions/${group.sampleSessionId}`);
                                      }}
                                    >
                                      Play session
                                    </NeoButton>
                                  ) : (
                                    <p className="rounded-none border border-[#dadce0] bg-white px-3 py-2 text-xs text-[#5f6368]">
                                      Replay unavailable for this sampled crash.
                                    </p>
                                  )}
                               </NeoCard>

                               <NeoCard variant="flat" disablePadding className="p-4 flex-1">
                                 <h4 className="text-sm font-medium text-[#202124] mb-3 border-b border-[#e8eaed] pb-2">
                                   Crash properties
                                 </h4>
                                 <dl className="space-y-3 text-xs">
                                   <div>
                                      <dt className="text-[#5f6368] mb-0.5">Occurred at</dt>
                                      <dd className="font-medium text-[#202124]">{new Date(detail?.timestamp || group.lastOccurred).toLocaleString()}</dd>
                                   </div>
                                   <div>
                                      <dt className="text-[#5f6368] mb-0.5">App version</dt>
                                      <dd className="font-medium text-[#202124]">{detail?.deviceMetadata?.appVersion || topVersion}</dd>
                                   </div>
                                   <div>
                                      <dt className="text-[#5f6368] mb-0.5">Memory</dt>
                                      <dd className="font-medium text-[#202124]">{detail?.deviceMetadata?.freeMemory && `${Math.round(detail.deviceMetadata.freeMemory / 1024 / 1024)}MB Free` || 'Unknown'}</dd>
                                   </div>
                                   <div>
                                      <dt className="text-[#5f6368] mb-0.5">Orientation</dt>
                                      <dd className="font-medium text-[#202124] break-words">{detail?.deviceMetadata?.orientation || 'Unknown'}</dd>
                                   </div>
                                 </dl>
                               </NeoCard>
                            </div>
                         </div>
                      )}
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

export default CrashesList;
