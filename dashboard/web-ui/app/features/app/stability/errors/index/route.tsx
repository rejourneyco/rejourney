import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { getErrorsOverview, type ErrorOverviewGroup } from '~/shared/api/client';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '~/shared/ui/core/TimeFilter';
import { MiniSessionCard } from '~/shared/ui/core/MiniSessionCard';
import { formatAge, formatLastSeen } from '~/shared/lib/formatDates';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';

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

  const [errorGroups, setErrorGroups] = useState<ErrorOverviewGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isDemoMode && !currentProject) {
      setErrorGroups([]);
      setLoading(false);
      return;
    }

    const fetchErrors = async () => {
      setLoading(true);
      try {
        const data = await getErrorsOverview(currentProject?.id || 'demo', timeRange);
        setErrorGroups(data.groups || []);
      } catch (err) {
        console.error('Failed to fetch errors:', err);
        setErrorGroups([]);
      } finally {
        setLoading(false);
      }
    };

    fetchErrors();
  }, [currentProject?.id, isDemoMode, timeRange]);

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
        group.screens.some((screen) => screen.toLowerCase().includes(query)),
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

  if ((loading && errorGroups.length === 0) || contextLoading) {
    return <DashboardGhostLoader variant="list" />;
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
                        {formatCompact(group.users.length)}
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
                      <div className="space-y-4">
                        <NeoCard variant="flat" disablePadding className="overflow-hidden">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                              <Activity size={14} className="text-amber-500" />
                              Root Cause Details
                            </h4>
                            <NeoButton
                              variant="secondary"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`${pathPrefix}/stability/errors/${currentProject?.id}/${group.sampleError.id}`);
                              }}
                              rightIcon={<ChevronRight size={14} />}
                            >
                              Open More Details
                            </NeoButton>
                          </div>

                          {group.sampleError.stack ? (
                            <div className="max-h-96 overflow-auto bg-slate-950 p-5 font-mono text-xs leading-relaxed text-slate-300">
                              {group.sampleError.stack}
                            </div>
                          ) : (
                            <div className="px-6 py-8 text-center text-sm text-slate-500">No stack trace captured for this issue.</div>
                          )}
                        </NeoCard>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
                          <NeoCard variant="flat" className="p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evidence Sample</p>
                            <div className="mt-3 flex justify-center border border-gray-200 bg-white px-3 py-4" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
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
