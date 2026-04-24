
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
import { useSessionData } from '~/shared/providers/SessionContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { getANRsOverview, type ANRRecord } from '~/shared/api/client';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '~/shared/ui/core/TimeFilter';
import { formatAge } from '~/shared/lib/formatDates';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';

const formatCompact = (value: number): string => {
  if (value >= 1_000_000) return `\${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `\${(value / 1_000).toFixed(1)}k`;
  return value.toString();
};

export const ANRsList: React.FC = () => {
  const { selectedProject } = useSessionData();
  const { isDemoMode } = useDemoMode();
  const currentProject = selectedProject;
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();
  const [searchParams] = useSearchParams();

  const [anrs, setAnrs] = useState<ANRRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedAnr, setExpandedAnr] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedStack, setCopiedStack] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnrs = async () => {
      if (!isDemoMode && !currentProject?.id) {
        setAnrs([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const data = await getANRsOverview(currentProject?.id || 'demo', timeRange);
        setAnrs(data.anrs || []);
      } catch (error) {
        console.error('Failed to fetch ANRs:', error);
        setAnrs([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnrs();
  }, [currentProject?.id, timeRange, isDemoMode]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const searchedAnrs = useMemo(() => {
    if (!searchQuery.trim()) return anrs;
    const query = searchQuery.toLowerCase();

    return anrs.filter(
      (anr) =>
        anr.threadState?.toLowerCase().includes(query) ||
        anr.deviceMetadata?.deviceModel?.toLowerCase().includes(query) ||
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
      const element = document.getElementById(`anr-item-\${targetAnr.id}`);
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
    link.download = `anr-thread-\${id}-\${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading && anrs.length === 0) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="ANRs Database"
        subtitle="Unified collection of App Not Responding events"
        icon={<Clock className="h-5 w-5" />}
        iconColor="bg-violet-50"
      >
        <TimeFilter value={timeRange} onChange={setTimeRange} />
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
                  placeholder="Search ANR threads or devices..."
                  className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </div>
              <NeoButton variant="secondary" size="sm" leftIcon={<Filter size={14} />}>
                Filter
              </NeoButton>
            </div>
            <div className="flex items-center text-sm font-medium text-slate-500 gap-4">
               <span>{searchedAnrs.length} Issues</span>
               <span className="hidden md:inline">|</span>
               <span className="hidden md:inline text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200">
                  {formatCompact(searchedAnrs.reduce((acc, a) => acc + (a.occurrenceCount || 1), 0))} Total Events
               </span>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-white px-4">
            <div className="flex items-center gap-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <div className="w-6 shrink-0" />
              <div className="min-w-0 flex-1">Issue Details</div>
              <div className="w-32 hidden md:block">Environment</div>
              <div className="w-24 text-right hidden sm:block">Occurrence</div>
              <div className="w-24 text-right lg:block">Blocked Duration</div>
              <div className="w-16 text-right">Events</div>
              <div className="w-16 text-right">Users</div>
              <div className="w-8 shrink-0" />
            </div>
          </div>

          <div className="divide-y divide-slate-100 bg-white">
            {searchedAnrs.length === 0 && (
              <div className="py-24 text-center text-slate-400">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                <p className="text-lg font-semibold text-slate-700">No ANRs found</p>
                <p className="text-sm mt-1">App UI threads are running smoothly.</p>
              </div>
            )}

            {searchedAnrs.map((anr) => {
              const isExpanded = expandedAnr === anr.id;
              const deviceModel = anr.deviceMetadata?.deviceModel || 'Unknown Device';
              const appVersion = anr.deviceMetadata?.appVersion || '?';
              const shortThread = anr.threadState?.split('\n')[0] || 'App Not Responding';
              
              return (
                <div
                  key={anr.id}
                  id={`anr-item-\${anr.id}`}
                  className={`transition-colors \${isExpanded ? 'bg-violet-50/20' : 'hover:bg-slate-50'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-4 py-3"
                    onClick={() => setExpandedAnr(isExpanded ? null : anr.id)}
                  >
                    <div className="flex w-6 shrink-0 justify-center">
                      <div className={`h-2.5 w-2.5 rounded-full \${isExpanded ? 'bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]' : 'bg-slate-300 group-hover/row:bg-violet-400'} transition-all`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-slate-900 text-[13px]">{shortThread}</h3>
                      </div>
                      <p className="truncate text-xs text-slate-500 mt-0.5">
                        Detected UI block in main thread.
                      </p>
                    </div>

                    <div className="w-32 hidden md:block flex-shrink-0">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1.5 rounded">{deviceModel}</span>
                        <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1.5 rounded">v{appVersion}</span>
                      </div>
                    </div>

                    <div className="w-24 text-right hidden sm:block">
                      <span className="text-xs font-medium text-slate-500" title={new Date(anr.timestamp).toLocaleString()}>{formatAge(anr.timestamp)}</span>
                    </div>

                    <div className="w-24 text-right lg:block">
                      <span className="text-xs font-semibold text-slate-700">{Math.round(anr.durationMs / 100) / 10}s</span>
                    </div>

                    <div className="w-16 text-right">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-medium bg-violet-100 text-violet-800 border border-violet-200">
                        {formatCompact(anr.occurrenceCount || 1)}
                      </span>
                    </div>

                    <div className="w-16 text-right">
                       <span className="inline-block text-xs font-mono font-medium text-slate-600">
                        {formatCompact(anr.userCount || 1)}
                      </span>
                    </div>

                    <div className="flex w-8 justify-end shrink-0">
                      <div
                        className={`flex h-6 w-6 items-center justify-center rounded text-slate-400 transition \${
                          isExpanded ? 'rotate-180 text-violet-600 bg-violet-100' : 'group-hover/row:bg-slate-200 group-hover/row:text-slate-600'
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
                                      <Code size={14} className="text-violet-500" />
                                      Main Thread State
                                    </h4>
                                    <div className="flex items-center gap-1.5">
                                       <NeoButton
                                        variant="ghost"
                                        size="sm"
                                        leftIcon={copiedStack === anr.threadState ? <Check size={13} /> : <Copy size={13} />}
                                        onClick={(e) => anr.threadState && handleCopyStack(anr.threadState, e)}
                                        disabled={!anr.threadState}
                                        className="h-7 text-xs px-2"
                                      >
                                        Copy
                                      </NeoButton>
                                      <NeoButton
                                        variant="ghost"
                                        size="sm"
                                        leftIcon={<Download size={13} />}
                                        onClick={(e) => anr.threadState && handleDownloadStack(anr.threadState, anr.id, e)}
                                        disabled={!anr.threadState}
                                        className="h-7 text-xs px-2"
                                      >
                                        Save
                                      </NeoButton>
                                    </div>
                                  </div>

                                  {anr.threadState ? (
                                    <div className="max-h-[400px] overflow-auto bg-[#0d1117] p-4 font-mono text-[11px] leading-relaxed text-[#c6a0f6] selection:bg-violet-900 overflow-x-auto">
                                      {anr.threadState}
                                    </div>
                                  ) : (
                                    <div className="px-6 py-10 text-center text-sm text-slate-500 bg-slate-50">No thread state captured.</div>
                                  )}
                               </NeoCard>
                               
                               <div className="flex flex-wrap gap-4 text-xs">
                                 <div className="flex items-center gap-1.5 text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm">
                                   <Smartphone size={12} className="text-slate-400" />
                                   <span className="font-semibold text-slate-700">Device Model:</span> {anr.deviceMetadata?.deviceModel || 'Unknown Device'}
                                 </div>
                                 <div className="flex items-center gap-1.5 text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm">
                                   <Activity size={12} className="text-slate-400" />
                                   <span className="font-semibold text-slate-700">OS Version:</span> {anr.deviceMetadata?.osVersion || 'Unknown'}
                                 </div>
                               </div>
                            </div>

                            <div className="lg:col-span-1 flex flex-col gap-4">
                               <NeoCard variant="flat" className="p-4 bg-violet-50/50 border-violet-200 shadow-sm">
                                  <h4 className="text-xs font-bold uppercase tracking-widest text-violet-800 mb-3 flex items-center gap-2">
                                    <Play size={14} className="text-violet-600 fill-current" />
                                    Session Replay
                                  </h4>
                                  <p className="text-xs text-violet-700/80 mb-4 leading-relaxed">
                                    Watch the session leading to the ANR to trace user behavior preceding the UI thread block.
                                  </p>
                                  {anr.sessionId ? (
                                    <NeoButton 
                                      variant="primary" 
                                      className="w-full justify-center bg-violet-500 hover:bg-violet-600 focus:ring-violet-500 text-white border-0 py-2 shadow-sm"
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          navigate(`\${pathPrefix}/sessions/\${anr.sessionId}`);
                                      }}
                                    >
                                      Play Session
                                    </NeoButton>
                                  ) : (
                                    <NeoButton variant="secondary" disabled className="w-full justify-center">
                                      No Session Linked
                                    </NeoButton>
                                  )}
                               </NeoCard>

                               <NeoCard variant="flat" className="p-4 border-slate-200 bg-white shadow-sm flex-1">
                                 <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 border-b border-slate-100 pb-2">
                                   ANR Properties
                                 </h4>
                                 <dl className="space-y-3 text-xs">
                                   <div>
                                      <dt className="text-slate-500 mb-0.5">Occurred At</dt>
                                      <dd className="font-medium text-slate-800">{new Date(anr.timestamp).toLocaleString()}</dd>
                                   </div>
                                   <div>
                                      <dt className="text-slate-500 mb-0.5">App Version</dt>
                                      <dd className="font-medium text-slate-800">{anr.deviceMetadata?.appVersion || 'Unknown'}</dd>
                                   </div>
                                   <div>
                                      <dt className="text-slate-500 mb-0.5">Block Duration</dt>
                                      <dd className="font-medium text-slate-800 break-words">{anr.durationMs}ms</dd>
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
