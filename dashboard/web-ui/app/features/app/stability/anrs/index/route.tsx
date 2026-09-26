
import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Clock,
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
import { getANRsOverview, type ANRRecord } from '~/shared/api/client';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { platformLensToSessionPlatform, useSharedPlatformLens } from '~/shared/hooks/useSharedPlatformLens';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { formatAge } from '~/shared/lib/formatDates';
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

export const ANRsList: React.FC = () => {
  const { selectedProject } = useSessionData();
  const manualRefreshVersion = useDashboardManualRefreshVersion();
  const { isDemoMode } = useDemoMode();
  const currentProject = selectedProject;
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();
  const [searchParams] = useSearchParams();

  const [anrs, setAnrs] = useState<ANRRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedAnr, setExpandedAnr] = useState<string | null>(null);
  const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(currentProject?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedStack, setCopiedStack] = useState<string | null>(null);
  const { platformLens } = useSharedPlatformLens(currentProject?.id, currentProject?.platforms);
  const platform = platformLensToSessionPlatform(platformLens);

  useEffect(() => {
    const fetchAnrs = async () => {
      if (!isDemoMode && !currentProject?.id) {
        setAnrs([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const data = await getANRsOverview(currentProject?.id || 'demo', timeRange, platform);
        setAnrs(data.anrs || []);
      } catch (error) {
        console.error('Failed to fetch ANRs:', error);
        setAnrs([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnrs();
  }, [currentProject?.id, manualRefreshVersion, timeRange, isDemoMode, platform]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const searchedAnrs = useMemo(() => {
    if (!searchQuery.trim()) return anrs;
    const query = searchQuery.toLowerCase();

    return anrs.filter(
      (anr) =>
        anr.threadState?.toLowerCase().includes(query) ||
        getDeviceModelSearchText(anr.deviceMetadata?.deviceModel).includes(query) ||
        anr.deviceMetadata?.appVersion?.toLowerCase().includes(query) ||
        anr.id.toLowerCase().includes(query),
    );
  }, [anrs, searchQuery]);

  const focusId = searchParams.get('focusId');
  useEffect(() => {
    if (!focusId || isLoading || anrs.length === 0) return;

    const targetAnr = anrs.find((anr) => anr.id === focusId);
    if (!targetAnr) return;

    setExpandedAnr(targetAnr.id);

    let attempts = 0;
    const scrollInterval = setInterval(() => {
      const element = document.getElementById(`anr-item-${targetAnr.id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearInterval(scrollInterval);
      }

      attempts += 1;
      if (attempts > 5) clearInterval(scrollInterval);
    }, 100);

    return () => clearInterval(scrollInterval);
  }, [focusId, isLoading, anrs]);

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
    link.download = `anr-thread-${id}-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const shouldShowInitialGhost = useInitialDashboardLoad(isLoading);

  if (shouldShowInitialGhost) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="ANRs"
        subtitle="Unified collection of App Not Responding events"
        icon={<Clock className="h-5 w-5" />}
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
                  placeholder="Search ANR threads or devices..."
                  className="w-full rounded-none border border-[#dadce0] bg-white py-1.5 pl-9 pr-3 text-sm text-[#202124] outline-none transition-colors placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
                />
              </div>
            </div>
            <div className="flex items-center text-sm font-medium text-[#5f6368] gap-4">
               <span>{searchedAnrs.length} Issues</span>
               <span className="hidden md:inline">|</span>
               <span className="hidden md:inline bg-[#f1f3f4] px-2 py-0.5 text-[#3c4043] tabular-nums">
                  {formatCompact(searchedAnrs.reduce((acc, a) => acc + (a.occurrenceCount || 1), 0))} Total Events
               </span>
            </div>
          </div>

          <div className="border-b border-[#e8eaed] bg-white px-4">
            <div className="flex items-center gap-4 py-3 text-xs font-medium text-[#5f6368]">
              <div className="w-6 shrink-0" />
              <div className="min-w-0 flex-1">Issue details</div>
              <div className="w-32 hidden md:block">Environment</div>
              <div className="w-24 text-right hidden sm:block">Occurrence</div>
              <div className="w-24 text-right lg:block">Blocked duration</div>
              <div className="w-16 text-right">Events</div>
              <div className="w-16 text-right">Users</div>
              <div className="w-8 shrink-0" />
            </div>
          </div>

          <div className="divide-y divide-[#e8eaed] bg-white">
            {searchedAnrs.length === 0 && (
              <div className="py-24 text-center text-[#80868b]">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-[#bdc1c6]" />
                <p className="text-lg font-medium text-[#5f6368]">No ANRs found</p>
                <p className="text-sm mt-1">App UI threads are running smoothly.</p>
              </div>
            )}

            {searchedAnrs.map((anr) => {
              const isExpanded = expandedAnr === anr.id;
              const rawDeviceModel = anr.deviceMetadata?.deviceModel || 'Unknown Device';
              const deviceModel = formatDeviceModel(rawDeviceModel);
              const appVersion = anr.deviceMetadata?.appVersion || '?';
              const shortThread = anr.threadState?.split('\n')[0] || 'App Not Responding';
              const canOpenReplay = Boolean(anr.sessionId && anr.canOpenReplay);
              
              return (
                <div
                  key={anr.id}
                  id={`anr-item-${anr.id}`}
                  className={`transition-colors ${isExpanded ? 'bg-[#f8fafd]' : 'hover:bg-[#f8fafd]'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-4 py-3"
                    onClick={() => setExpandedAnr(isExpanded ? null : anr.id)}
                  >
                    <div className="flex w-6 shrink-0 justify-center">
                      <div className={`h-2.5 w-2.5 rounded-full ${isExpanded ? 'bg-[#9334e6]' : 'bg-[#dadce0]'} transition-colors`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium text-[#202124] text-[13px]">{shortThread}</h3>
                      </div>
                      <p className="truncate text-xs text-[#5f6368] mt-0.5">
                        Detected UI block in main thread.
                      </p>
                    </div>

                    <div className="w-32 hidden md:block flex-shrink-0">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="text-[11px] font-medium text-[#3c4043] bg-[#f1f3f4] px-1.5 rounded-none" title={rawDeviceModel}>{deviceModel}</span>
                        <span className="text-[11px] font-medium text-[#3c4043] bg-[#f1f3f4] px-1.5 rounded-none">v{appVersion}</span>
                      </div>
                    </div>

                    <div className="w-24 text-right hidden sm:block">
                      <span className="text-xs font-medium text-[#5f6368]" title={new Date(anr.timestamp).toLocaleString()}>{formatAge(anr.timestamp)}</span>
                    </div>

                    <div className="w-24 text-right lg:block">
                      <span className="text-xs font-medium text-[#5f6368]">{Math.round(anr.durationMs / 100) / 10}s</span>
                    </div>

                    <div className="w-16 text-right">
                      <span className="inline-block px-2 py-0.5 rounded-none text-xs font-medium tabular-nums text-[#202124]">
                        {formatCompact(anr.occurrenceCount || 1)}
                      </span>
                    </div>

                    <div className="w-16 text-right">
                       <span className="inline-block text-xs font-mono font-medium text-[#3c4043]">
                        {formatCompact(anr.userCount || 1)}
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

                  {isExpanded && (
                    <div className="border-t border-[#e8eaed] bg-[#f8fafd] p-4 sm:p-5 cursor-default">
                         <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
                            <div className="lg:col-span-3 flex flex-col gap-4">
                               <NeoCard variant="flat" disablePadding className="overflow-hidden">
                                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eaed] px-4 py-2.5">
                                    <h4 className="flex items-center gap-2 text-sm font-medium text-[#202124]">
                                      <Code size={14} className="text-[#5f6368]" />
                                      Main thread state
                                    </h4>
                                    <div className="flex items-center gap-1.5">
                                       <NeoButton
                                        variant="ghost"
                                        size="sm"
                                        leftIcon={copiedStack === anr.threadState ? <Check size={13} /> : <Copy size={13} />}
                                        onClick={(e) => anr.threadState && handleCopyStack(anr.threadState, e)}
                                        disabled={!anr.threadState}
                                      >
                                        Copy
                                      </NeoButton>
                                      <NeoButton
                                        variant="ghost"
                                        size="sm"
                                        leftIcon={<Download size={13} />}
                                        onClick={(e) => anr.threadState && handleDownloadStack(anr.threadState, anr.id, e)}
                                        disabled={!anr.threadState}
                                      >
                                        Save
                                      </NeoButton>
                                    </div>
                                  </div>

                                  {anr.threadState ? (
                                    <div className="m-4 max-h-[400px] overflow-auto whitespace-pre border border-[#e8eaed] bg-[#f8fafd] p-4 font-mono text-xs leading-relaxed text-[#202124]">
                                      {anr.threadState}
                                    </div>
                                  ) : (
                                    <div className="px-6 py-10 text-center text-sm text-[#5f6368] bg-[#f8fafd]">No thread state captured.</div>
                                  )}
                               </NeoCard>
                               
                               <div className="flex flex-wrap gap-4 text-xs">
                                 <div className="flex items-center gap-1.5 text-[#3c4043] bg-white px-2 py-1 rounded-none border border-[#dadce0]">
                                   <Smartphone size={12} className="text-[#80868b]" />
                                   <span className="font-medium text-[#5f6368]">Device model:</span>{' '}
                                   <span title={rawDeviceModel}>{deviceModel}</span>
                                 </div>
                                 <div className="flex items-center gap-1.5 text-[#3c4043] bg-white px-2 py-1 rounded-none border border-[#dadce0]">
                                   <Activity size={12} className="text-[#80868b]" />
                                   <span className="font-medium text-[#5f6368]">OS Version:</span> {anr.deviceMetadata?.osVersion || 'Unknown'}
                                 </div>
                               </div>
                            </div>

                            <div className="lg:col-span-1 flex flex-col gap-4">
                               <NeoCard variant="flat" disablePadding className="p-4">
                                  <h4 className="text-sm font-medium text-[#202124] mb-3 flex items-center gap-2">
                                    <Play size={14} className="text-[#5f6368]" />
                                    Session replay
                                  </h4>
                                  <p className="text-xs text-[#3c4043] mb-4 leading-relaxed">
                                    Watch the session leading to the ANR to trace user behavior preceding the UI thread block.
                                  </p>
                                  {canOpenReplay ? (
                                    <NeoButton 
                                      variant="primary" 
                                      className="w-full justify-center"
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          navigate(`${pathPrefix}/sessions/${anr.sessionId}`);
                                      }}
                                    >
                                      Play session
                                    </NeoButton>
                                  ) : (
                                    <p className="rounded-none border border-[#dadce0] bg-white px-3 py-2 text-xs text-[#5f6368]">
                                      Replay unavailable for this sampled ANR.
                                    </p>
                                  )}
                               </NeoCard>

                               <NeoCard variant="flat" disablePadding className="p-4 flex-1">
                                 <h4 className="text-sm font-medium text-[#202124] mb-3 border-b border-[#e8eaed] pb-2">
                                   ANR properties
                                 </h4>
                                 <dl className="space-y-3 text-xs">
                                   <div>
                                      <dt className="text-[#5f6368] mb-0.5">Occurred at</dt>
                                      <dd className="font-medium text-[#202124]">{new Date(anr.timestamp).toLocaleString()}</dd>
                                   </div>
                                   <div>
                                      <dt className="text-[#5f6368] mb-0.5">App version</dt>
                                      <dd className="font-medium text-[#202124]">{anr.deviceMetadata?.appVersion || 'Unknown'}</dd>
                                   </div>
                                   <div>
                                      <dt className="text-[#5f6368] mb-0.5">Block duration</dt>
                                      <dd className="font-medium text-[#202124] break-words">{anr.durationMs}ms</dd>
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

export default ANRsList;
