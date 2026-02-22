import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  Loader,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { MiniSessionCard } from '../../components/ui/MiniSessionCard';
import { formatAge, formatLastSeen } from '../../utils/formatDates';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { api, CrashReport } from '../../services/api';

interface CrashGroup {
  name: string;
  id: string;
  count: number;
  users: Set<string>;
  firstSeen: string;
  lastOccurred: string;
  affectedDevices: Record<string, number>;
  affectedVersions: Record<string, number>;
  sampleSessionId: string;
}

const formatCompact = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
};

export const CrashesList: React.FC = () => {
  const { sessions, isLoading, selectedProject } = useSessionData();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();

  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  const [searchQuery, setSearchQuery] = useState('');
  const [crashDetails, setCrashDetails] = useState<Record<string, CrashReport | null>>({});

  const projectSessions = useMemo(() => {
    if (!selectedProject?.id) return sessions;
    return sessions.filter(
      (session) => (session as any).projectId === selectedProject.id || (session as any).appId === selectedProject.id,
    );
  }, [sessions, selectedProject?.id]);

  const filteredSessions = useMemo(() => {
    if (timeRange === 'all') return projectSessions;

    const now = new Date();
    const cutoff = new Date();
    let days = 30;

    switch (timeRange) {
      case '24h':
        days = 1;
        break;
      case '7d':
        days = 7;
        break;
      case '30d':
        days = 30;
        break;
      case '90d':
        days = 90;
        break;
      default:
        days = 30;
    }

    cutoff.setDate(now.getDate() - days);
    return projectSessions.filter((session) => new Date(session.startedAt) >= cutoff);
  }, [projectSessions, timeRange]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const crashGroups = useMemo<CrashGroup[]>(() => {
    return filteredSessions
      .filter((session) => (session.crashCount || 0) > 0)
      .map((session) => {
        const lastScreen =
          session.screensVisited && session.screensVisited.length > 0
            ? session.screensVisited[session.screensVisited.length - 1]
            : 'Unknown Screen';

        return {
          name: `Crash in ${lastScreen}`,
          id: session.id,
          count: session.crashCount || 1,
          users: new Set([session.userId || session.deviceId || session.id]),
          firstSeen: session.startedAt,
          lastOccurred: session.startedAt,
          affectedDevices: { [session.deviceModel || 'Unknown']: 1 },
          affectedVersions: { [session.appVersion || 'Unknown']: 1 },
          sampleSessionId: session.id,
        };
      })
      .sort((a, b) => new Date(b.lastOccurred).getTime() - new Date(a.lastOccurred).getTime());
  }, [filteredSessions]);

  const filteredCrashGroups = useMemo(() => {
    if (!searchQuery.trim()) return crashGroups;
    const query = searchQuery.toLowerCase();

    return crashGroups.filter(
      (group) =>
        group.name.toLowerCase().includes(query) ||
        Object.keys(group.affectedDevices).some((device) => device.toLowerCase().includes(query)) ||
        Object.keys(group.affectedVersions).some((version) => version.toLowerCase().includes(query)),
    );
  }, [crashGroups, searchQuery]);

  const summary = useMemo(() => {
    const users = new Set<string>();
    const totalEvents = filteredCrashGroups.reduce((sum, group) => {
      group.users.forEach((user) => users.add(user));
      return sum + group.count;
    }, 0);

    return {
      issues: filteredCrashGroups.length,
      events: totalEvents,
      users: users.size,
    };
  }, [filteredCrashGroups]);

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

    const fetchCrashForGroup = async () => {
      try {
        const { crashes } = await api.getCrashes(selectedProject.id, 1, 100);
        const matchingCrash = crashes.find((crash) => crash.sessionId === group.sampleSessionId);

        if (!matchingCrash) {
          setCrashDetails((prev) => ({ ...prev, [expandedGroup]: null }));
          return;
        }

        const fullCrash = await api.getCrash(selectedProject.id, matchingCrash.id);
        setCrashDetails((prev) => ({ ...prev, [expandedGroup]: fullCrash }));
      } catch (err) {
        console.error('Failed to fetch crash details:', err);
        setCrashDetails((prev) => ({ ...prev, [expandedGroup]: null }));
      }
    };

    fetchCrashForGroup();
  }, [expandedGroup, selectedProject?.id, crashGroups, crashDetails]);

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
        title="Crash Reports"
        subtitle="Critical failures and runtime exceptions"
        icon={<Bug className="h-5 w-5" />}
        iconColor="bg-rose-50"
      >
        <div className="relative hidden w-72 md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search crashes..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
          />
        </div>
        <TimeFilter value={timeRange} onChange={setTimeRange} />
      </DashboardPageHeader>

      <div className="mx-auto w-full max-w-[1800px] space-y-4 px-6 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NeoCard variant="flat" className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Crash Issues</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCompact(summary.issues)}</p>
          </NeoCard>
          <NeoCard variant="flat" className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Crash Events</p>
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
              <div className="hidden w-16 text-right md:block">Age</div>
              <div className="w-16 text-right">Events</div>
              <div className="w-16 text-right">Users</div>
              <div className="w-10" />
            </div>
          </div>

          <div className="divide-y divide-slate-100 bg-white">
            {filteredCrashGroups.length === 0 && (
              <div className="py-16 text-center text-slate-400">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p className="text-lg font-semibold text-slate-700">No crashes detected</p>
                <p className="text-sm">Your app appears stable for the selected time range.</p>
              </div>
            )}

            {filteredCrashGroups.map((group) => {
              const isExpanded = expandedGroup === group.name;
              const detail = crashDetails[group.name];
              const hasLoadedDetail = Object.prototype.hasOwnProperty.call(crashDetails, group.name);

              return (
                <div
                  key={group.id}
                  id={`crash-group-${group.name}`}
                  className={`transition-colors ${isExpanded ? 'bg-slate-50/70' : 'hover:bg-slate-50/60'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-6 py-4"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.name)}
                  >
                    <div className="flex w-8 shrink-0 justify-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-slate-900">{group.name}</h3>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                        Affecting {Object.keys(group.affectedDevices).length} device model
                        {Object.keys(group.affectedDevices).length === 1 ? '' : 's'}
                      </p>
                    </div>

                    <div className="hidden w-20 text-right md:block">
                      <span className="text-xs font-semibold text-slate-700">{formatLastSeen(group.lastOccurred)}</span>
                    </div>

                    <div className="hidden w-16 text-right md:block">
                      <span className="text-xs font-semibold text-slate-500">{formatAge(group.firstSeen)}</span>
                    </div>

                    <div className="w-16 text-right">
                      <NeoBadge variant="danger" size="sm" className="font-mono">
                        {formatCompact(group.count)}
                      </NeoBadge>
                    </div>

                    <div className="w-16 text-right">
                      <NeoBadge variant="info" size="sm" className="font-mono">
                        {formatCompact(group.users.size)}
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
                                <Activity size={14} className="text-rose-500" />
                                Stack Trace Preview
                              </h4>
                            </div>

                            {!hasLoadedDetail ? (
                              <div className="flex items-center justify-center gap-2 px-6 py-8 text-sm text-slate-500">
                                <Loader size={18} className="animate-spin" />
                                Loading crash details...
                              </div>
                            ) : detail?.stackTrace ? (
                              <div className="max-h-80 overflow-x-auto bg-slate-950 p-5 font-mono text-xs leading-relaxed text-emerald-300">
                                {detail.stackTrace.split('\n').slice(0, 12).join('\n')}
                                {detail.stackTrace.split('\n').length > 12 && (
                                  <p className="mt-3 border-t border-slate-800 pt-3 text-[10px] text-slate-400">
                                    Preview clipped. Open root cause analysis for full trace.
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className="px-6 py-8 text-center text-sm text-slate-500">No stack trace captured.</div>
                            )}
                          </NeoCard>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <NeoCard variant="flat" className="p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">First Seen</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">
                                {new Date(group.firstSeen).toLocaleDateString()}
                              </p>
                            </NeoCard>
                            <NeoCard variant="flat" className="p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last Seen</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{formatLastSeen(group.lastOccurred)}</p>
                            </NeoCard>
                            <NeoCard variant="flat" className="p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Environment</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <NeoBadge variant="neutral" size="sm">
                                  {Object.keys(group.affectedDevices)[0] || 'Unknown'}
                                </NeoBadge>
                                <NeoBadge variant="info" size="sm">
                                  v{Object.keys(group.affectedVersions)[0] || '?'}
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
                            </div>
                            <div className="flex justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-4">
                              <MiniSessionCard
                                session={{
                                  id: group.sampleSessionId,
                                  deviceModel: Object.keys(group.affectedDevices)[0] || 'Sample Device',
                                  createdAt: group.lastOccurred,
                                }}
                                onClick={() => navigate(`${pathPrefix}/sessions/${group.sampleSessionId}`)}
                              />
                            </div>
                          </NeoCard>

                          <NeoCard variant="flat" className="border-rose-200 bg-rose-50 p-4">
                            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                              <Sparkles size={14} />
                              Root Cause Focus
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-rose-700/90">
                              Validate the failing frame, check the release version, and replay the user journey around the
                              crash to isolate the trigger.
                            </p>
                            <NeoButton
                              variant="primary"
                              size="sm"
                              className="mt-4"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (detail?.id) {
                                  navigate(`${pathPrefix}/stability/crashes/${selectedProject?.id}/${detail.id}`);
                                }
                              }}
                              disabled={!detail?.id}
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

export default CrashesList;
