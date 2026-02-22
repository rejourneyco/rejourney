import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDemoMode } from '../../context/DemoModeContext';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { api, ANRRecord } from '../../services/api';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { MiniSessionCard } from '../../components/ui/MiniSessionCard';
import { formatLastSeen } from '../../utils/formatDates';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';

const formatCompact = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
};

const getStackPreview = (threadState: string | null): string => {
  if (!threadState) return 'No main-thread snapshot available.';
  const lines = threadState.split('\n').filter((line) => line.trim().length > 0);
  return lines.slice(0, 8).join('\n');
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

  useEffect(() => {
    const fetchAnrs = async () => {
      if (!isDemoMode && !currentProject?.id) return;

      setIsLoading(true);
      try {
        const data = await api.getANRs(currentProject?.id || 'demo', { timeRange });
        setAnrs(data.anrs || []);
      } catch (error) {
        console.error('Failed to fetch ANRs:', error);
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

  const summary = useMemo(() => {
    return searchedAnrs.reduce(
      (acc, anr) => {
        acc.issues += 1;
        acc.events += anr.occurrenceCount || 0;
        acc.users += anr.userCount || 0;
        return acc;
      },
      { issues: 0, events: 0, users: 0 },
    );
  }, [searchedAnrs]);

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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="text-2xl font-semibold uppercase tracking-tight animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="ANRs"
        subtitle="App Not Responding events"
        icon={<Clock className="h-5 w-5" />}
        iconColor="bg-violet-50"
      >
        <div className="relative hidden w-72 md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search ANRs..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          />
        </div>
        <TimeFilter value={timeRange} onChange={setTimeRange} />
      </DashboardPageHeader>

      <div className="mx-auto w-full max-w-[1800px] space-y-4 px-6 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NeoCard variant="flat" className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open ANR Issues</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCompact(summary.issues)}</p>
          </NeoCard>
          <NeoCard variant="flat" className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Freeze Events</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCompact(summary.events)}</p>
          </NeoCard>
          <NeoCard variant="flat" className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Impacted Users</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCompact(summary.users)}</p>
          </NeoCard>
        </div>

        <NeoCard variant="flat" disablePadding className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-6">
            <div className="flex items-center gap-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <div className="w-8 shrink-0" />
              <div className="min-w-0 flex-1">Issue</div>
              <div className="hidden w-20 text-right md:block">Last Seen</div>
              <div className="w-16 text-right">Events</div>
              <div className="w-16 text-right">Users</div>
              <div className="w-10" />
            </div>
          </div>

          <div className="divide-y divide-slate-100 bg-white">
            {searchedAnrs.length === 0 && (
              <div className="py-16 text-center text-slate-400">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p className="text-lg font-semibold text-slate-700">No ANRs detected</p>
                <p className="text-sm">Main-thread freeze issues will appear here.</p>
              </div>
            )}

            {searchedAnrs.map((anr) => {
              const isExpanded = expandedAnr === anr.id;

              return (
                <div
                  key={anr.id}
                  id={`anr-item-${anr.id}`}
                  className={`transition-colors ${isExpanded ? 'bg-slate-50/70' : 'hover:bg-slate-50/60'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-6 py-4"
                    onClick={() => setExpandedAnr(isExpanded ? null : anr.id)}
                  >
                    <div className="flex w-8 shrink-0 justify-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-slate-900">ANR: {anr.durationMs}ms freeze</h3>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
                        {(anr.deviceMetadata?.deviceModel || 'Unknown device')}
                        {anr.deviceMetadata?.appVersion ? ` • v${anr.deviceMetadata.appVersion}` : ''}
                      </p>
                    </div>

                    <div className="hidden w-20 text-right md:block">
                      <span className="text-xs font-semibold text-slate-700">{formatLastSeen(anr.timestamp)}</span>
                    </div>

                    <div className="w-16 text-right">
                      <NeoBadge variant="anr" size="sm" className="font-mono">
                        {formatCompact(anr.occurrenceCount || 0)}
                      </NeoBadge>
                    </div>

                    <div className="w-16 text-right">
                      <NeoBadge variant="info" size="sm" className="font-mono">
                        {formatCompact(anr.userCount || 0)}
                      </NeoBadge>
                    </div>

                    <div className="flex w-10 justify-end">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition ${
                          isExpanded ? 'rotate-180 text-slate-900' : 'group-hover/row:bg-slate-100'
                        }`}
                      >
                        <ChevronDown size={16} />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-200 bg-slate-50/70 px-6 py-6">
                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                        <div className="space-y-4 lg:col-span-8">
                          <NeoCard variant="flat" disablePadding className="overflow-hidden">
                            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                <Activity size={14} className="text-violet-500" />
                                Main Thread Snapshot
                              </h4>
                            </div>
                            <div className="max-h-80 overflow-x-auto bg-slate-950 p-5 font-mono text-xs leading-relaxed text-violet-200">
                              {getStackPreview(anr.threadState)}
                            </div>
                          </NeoCard>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <NeoCard variant="flat" className="p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Freeze Duration</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{(anr.durationMs / 1000).toFixed(2)}s</p>
                            </NeoCard>
                            <NeoCard variant="flat" className="p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Detected At</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{new Date(anr.timestamp).toLocaleString()}</p>
                            </NeoCard>
                            <NeoCard variant="flat" className="p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Environment</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <NeoBadge variant="neutral" size="sm">
                                  {anr.deviceMetadata?.deviceModel || 'Unknown'}
                                </NeoBadge>
                                <NeoBadge variant="anr" size="sm">
                                  {anr.deviceMetadata?.osVersion ? `OS ${anr.deviceMetadata.osVersion}` : 'OS unknown'}
                                </NeoBadge>
                              </div>
                            </NeoCard>
                          </div>
                        </div>

                        <div className="space-y-4 lg:col-span-4">
                          <NeoCard variant="flat" className="p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                <Play size={14} className="text-indigo-500" />
                                Evidence Sample
                              </h4>
                              {anr.sessionId && (
                                <NeoButton
                                  variant="ghost"
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    navigate(`${pathPrefix}/sessions/${anr.sessionId}`);
                                  }}
                                >
                                  Watch Replay
                                </NeoButton>
                              )}
                            </div>
                            <div className="flex justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-4">
                              <MiniSessionCard
                                session={{
                                  id: anr.sessionId,
                                  deviceModel: anr.deviceMetadata?.deviceModel,
                                  createdAt: anr.timestamp,
                                }}
                                onClick={() => navigate(`${pathPrefix}/sessions/${anr.sessionId}`)}
                              />
                            </div>
                          </NeoCard>

                          <NeoCard variant="flat" className="border-violet-200 bg-violet-50 p-4">
                            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                              <Sparkles size={14} />
                              Root Cause Focus
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-violet-700/90">
                              Prioritize expensive synchronous work and long-running callbacks in this snapshot. Replay
                              context helps identify exactly what blocked the main thread.
                            </p>
                            <NeoButton
                              variant="primary"
                              size="sm"
                              className="mt-4"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`${pathPrefix}/stability/anrs/${currentProject?.id}/${anr.id}`);
                              }}
                              rightIcon={<ChevronRight size={14} />}
                            >
                              Analyze Root Cause
                            </NeoButton>
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
