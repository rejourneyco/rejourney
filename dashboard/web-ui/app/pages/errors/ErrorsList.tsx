import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDemoMode } from '../../context/DemoModeContext';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { api, JSError } from '../../services/api';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { MiniSessionCard } from '../../components/ui/MiniSessionCard';
import { formatAge, formatLastSeen } from '../../utils/formatDates';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';

interface ErrorGroup {
  fingerprint: string;
  errorName: string;
  message: string;
  count: number;
  users: Set<string>;
  firstSeen: string;
  lastOccurred: string;
  affectedDevices: Record<string, number>;
  affectedVersions: Record<string, number>;
  sampleError: JSError;
  screens: Set<string>;
}

const formatCompact = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
};

export const ErrorsList: React.FC = () => {
  const { selectedProject, isLoading: contextLoading } = useSessionData();
  const { isDemoMode } = useDemoMode();
  const currentProject = selectedProject;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();

  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  const [searchQuery, setSearchQuery] = useState('');

  const [errors, setErrors] = useState<JSError[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isDemoMode && !currentProject) return;

    const fetchErrors = async () => {
      setLoading(true);
      try {
        const data = await api.getErrors(currentProject?.id || 'demo');
        setErrors(data.errors || []);
      } catch (err) {
        console.error('Failed to fetch errors:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchErrors();
  }, [currentProject, isDemoMode]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const filteredErrors = useMemo(() => {
    if (timeRange === 'all') return errors;

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
    return errors.filter((error) => new Date(error.timestamp) >= cutoff);
  }, [errors, timeRange]);

  const errorGroups = useMemo<ErrorGroup[]>(() => {
    return filteredErrors
      .map((error, index) => {
        const fingerprint = `${error.id || index}-${error.timestamp}`;

        return {
          fingerprint,
          errorName: error.errorName,
          message: error.message,
          count: 1,
          users: new Set([error.sessionId || 'unknown']),
          firstSeen: error.timestamp,
          lastOccurred: error.timestamp,
          affectedDevices: { [error.deviceModel || 'Unknown']: 1 },
          affectedVersions: { [error.appVersion || 'Unknown']: 1 },
          sampleError: error,
          screens: new Set(error.screenName ? [error.screenName] : []),
        };
      })
      .sort((a, b) => new Date(b.lastOccurred).getTime() - new Date(a.lastOccurred).getTime());
  }, [filteredErrors]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return errorGroups;
    const query = searchQuery.toLowerCase();

    return errorGroups.filter(
      (group) =>
        group.errorName.toLowerCase().includes(query) ||
        group.message.toLowerCase().includes(query) ||
        Array.from(group.screens).some((screen) => screen.toLowerCase().includes(query)),
    );
  }, [errorGroups, searchQuery]);

  const summary = useMemo(() => {
    const users = new Set<string>();
    const totalEvents = filteredGroups.reduce((sum, group) => {
      group.users.forEach((user) => users.add(user));
      return sum + group.count;
    }, 0);

    return {
      issues: filteredGroups.length,
      events: totalEvents,
      users: users.size,
    };
  }, [filteredGroups]);

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

  if (loading || contextLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="text-2xl font-semibold uppercase tracking-tight animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="Errors"
        subtitle="Caught exceptions and runtime failures"
        icon={<Bug className="h-5 w-5" />}
        iconColor="bg-amber-50"
      >
        <div className="relative hidden w-72 md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search errors..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
          />
        </div>
        <TimeFilter value={timeRange} onChange={setTimeRange} />
      </DashboardPageHeader>

      <div className="mx-auto w-full max-w-[1800px] space-y-4 px-6 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NeoCard variant="flat" className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Error Issues</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCompact(summary.issues)}</p>
          </NeoCard>
          <NeoCard variant="flat" className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Error Events</p>
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
            {filteredGroups.length === 0 && (
              <div className="py-16 text-center text-slate-400">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p className="text-lg font-semibold text-slate-700">No errors found</p>
                <p className="text-sm">Runtime issues will appear here when they are detected.</p>
              </div>
            )}

            {filteredGroups.map((group) => {
              const isExpanded = expandedGroup === group.fingerprint;

              return (
                <div
                  key={group.fingerprint}
                  id={`error-group-${group.fingerprint}`}
                  className={`transition-colors ${isExpanded ? 'bg-slate-50/70' : 'hover:bg-slate-50/60'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-6 py-4"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.fingerprint)}
                  >
                    <div className="flex w-8 shrink-0 justify-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-slate-900">{group.errorName}</h3>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{group.message}</p>
                    </div>

                    <div className="hidden w-20 text-right md:block">
                      <span className="text-xs font-semibold text-slate-700">{formatLastSeen(group.lastOccurred)}</span>
                    </div>

                    <div className="hidden w-16 text-right md:block">
                      <span className="text-xs font-semibold text-slate-500">{formatAge(group.firstSeen)}</span>
                    </div>

                    <div className="w-16 text-right">
                      <NeoBadge variant="warning" size="sm" className="font-mono">
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
                                <Activity size={14} className="text-amber-500" />
                                Stack Trace Preview
                              </h4>
                            </div>

                            {group.sampleError.stack ? (
                              <div className="max-h-80 overflow-x-auto bg-slate-950 p-5 font-mono text-xs leading-relaxed text-slate-300">
                                {group.sampleError.stack.split('\n').slice(0, 12).join('\n')}
                                {group.sampleError.stack.split('\n').length > 12 && (
                                  <p className="mt-3 border-t border-slate-800 pt-3 text-[10px] text-slate-400">
                                    Preview clipped. Open root cause analysis for full trace.
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className="px-6 py-8 text-center text-sm text-slate-500">No stack trace captured for this issue.</div>
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
                                <NeoBadge variant="warning" size="sm">
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
                                  id: group.sampleError.sessionId || '',
                                  deviceModel: group.sampleError.deviceModel || undefined,
                                  createdAt: group.sampleError.timestamp,
                                }}
                                onClick={() =>
                                  group.sampleError.sessionId &&
                                  navigate(`${pathPrefix}/sessions/${group.sampleError.sessionId}`)
                                }
                              />
                            </div>
                          </NeoCard>

                          <NeoCard variant="flat" className="border-amber-200 bg-amber-50 p-4">
                            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
                              <Sparkles size={14} />
                              Root Cause Focus
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-amber-700/90">
                              Correlate the top frame with the active screen and release version, then replay the same
                              session to reproduce the exact failing path.
                            </p>
                            <NeoButton
                              variant="primary"
                              size="sm"
                              className="mt-4"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`${pathPrefix}/stability/errors/${currentProject?.id}/${group.sampleError.id}`);
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

export default ErrorsList;
