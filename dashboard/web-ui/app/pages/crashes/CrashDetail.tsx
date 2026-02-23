import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bug,
  Calendar,
  Check,
  Copy,
  Download,
  Play,
  Server,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { api, CrashReport } from '../../services/api';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { useSessionData } from '../../context/SessionContext';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';

const getCrashStatusVariant = (status?: string): 'danger' | 'warning' | 'success' | 'neutral' | 'info' => {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'new') return 'danger';
  if (normalized === 'investigating') return 'warning';
  if (normalized === 'resolved') return 'success';
  if (normalized === 'ignored') return 'neutral';
  return 'info';
};

const formatCompact = (value?: number): string => {
  if (!value || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
};

export const CrashDetail: React.FC<{ crashId?: string; projectId?: string }> = ({
  crashId: propCrashId,
  projectId: propProjectId,
}) => {
  const { crashId: paramCrashId, projectId: paramProjectId } = useParams<{ crashId: string; projectId: string }>();
  const crashId = propCrashId || paramCrashId;
  const projectId = propProjectId || paramProjectId;

  const { projects, isLoading: contextLoading } = useSessionData();
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();

  const [crash, setCrash] = useState<CrashReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const currentProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (!crashId) {
      setError('Missing crash id.');
      setLoading(false);
      return;
    }

    if (contextLoading) return;

    if (!currentProject) {
      setError('Project not found or access revoked.');
      setLoading(false);
      return;
    }

    const fetchCrash = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await api.getCrash(currentProject.id, crashId);
        setCrash(data);
      } catch (err) {
        console.error('Failed to load crash details:', err);
        setError('Failed to load crash details. It may have been deleted or moved.');
      } finally {
        setLoading(false);
      }
    };

    fetchCrash();
  }, [crashId, currentProject, contextLoading]);

  const stackTrace = crash?.stackTrace || '';

  const handleCopyStack = () => {
    if (!stackTrace) return;
    navigator.clipboard.writeText(stackTrace);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadStack = () => {
    if (!stackTrace || !crash?.id) return;

    const blob = new Blob([stackTrace], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `crash-trace-${crash.id}-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const statusVariant = useMemo(() => getCrashStatusVariant(crash?.status), [crash?.status]);

  if (loading || contextLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="text-2xl font-semibold uppercase tracking-tight animate-pulse">Loading crash analysis...</div>
      </div>
    );
  }

  if (error || !crash) {
    return (
      <div className="min-h-screen bg-transparent pb-8">
        <DashboardPageHeader
          title="Crash Root Cause"
          subtitle="Deep crash analysis"
          icon={<Bug className="h-5 w-5" />}
          iconColor="bg-rose-50"
        />
        <div className="mx-auto w-full max-w-[960px] px-6 pt-8">
          <NeoCard variant="flat" className="p-8 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
            <p className="text-lg font-semibold text-slate-900">{error || 'Crash not found.'}</p>
            <NeoButton variant="primary" className="mt-5" onClick={() => navigate(`${pathPrefix}/stability/crashes`)}>
              Back to Crashes
            </NeoButton>
          </NeoCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="Crash Root Cause"
        subtitle="Analyze stack frames, release context, and replay evidence"
        icon={<Bug className="h-5 w-5" />}
        iconColor="bg-rose-50"
      >
        <NeoButton
          variant="secondary"
          size="sm"
          leftIcon={<ArrowLeft size={14} />}
          onClick={() => navigate(`${pathPrefix}/stability/crashes`)}
        >
          Back to Crashes
        </NeoButton>
        <NeoButton
          variant="primary"
          size="sm"
          leftIcon={<Play size={14} />}
          onClick={() => navigate(`${pathPrefix}/sessions/${crash.sessionId}`)}
        >
          Replay Session
        </NeoButton>
      </DashboardPageHeader>

      <div className="mx-auto w-full max-w-[1800px] space-y-4 px-6 pt-6">
        <NeoCard variant="flat" className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <NeoBadge variant={statusVariant} size="sm">
                  {crash.status || 'unknown'}
                </NeoBadge>
                <NeoBadge variant="danger" size="sm">
                  fatal crash
                </NeoBadge>
              </div>
              <h2 className="truncate text-xl font-semibold text-slate-900 md:text-2xl">{crash.exceptionName}</h2>
              <p className="mt-2 text-sm text-slate-600">{crash.reason || 'No crash reason was provided.'}</p>
            </div>

            <div className="grid w-full max-w-md grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Occurred At</p>
                <p className="mt-1 text-xs font-semibold text-slate-800">{new Date(crash.timestamp).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Occurrences</p>
                <p className="mt-1 text-xs font-semibold text-slate-800">{formatCompact(crash.occurrenceCount || 1)}</p>
              </div>
            </div>
          </div>
        </NeoCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <NeoCard variant="flat" disablePadding className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Activity className="h-4 w-4 text-rose-500" />
                  Crash Stack Trace
                </h3>
                <div className="flex items-center gap-2">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={handleCopyStack}
                    disabled={!stackTrace}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </NeoButton>
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<Download size={14} />}
                    onClick={handleDownloadStack}
                    disabled={!stackTrace}
                  >
                    Download
                  </NeoButton>
                </div>
              </div>

              {stackTrace ? (
                <pre className="max-h-[560px] overflow-auto bg-slate-950 p-5 font-mono text-xs leading-relaxed text-emerald-300">
                  {stackTrace}
                </pre>
              ) : (
                <div className="p-8 text-center text-sm text-slate-500">No stack trace available for this crash.</div>
              )}
            </NeoCard>

            <NeoCard variant="flat" className="border-rose-200 bg-rose-50 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                <Sparkles size={14} />
                Root Cause Playbook
              </p>
              <div className="mt-3 space-y-2 text-xs leading-relaxed text-rose-700/90">
                <p>1. Isolate the first app-owned frame where the crash begins.</p>
                <p>2. Correlate that frame with the release and device context on the right.</p>
                <p>3. Replay this session to confirm the exact user action sequence before failure.</p>
              </div>
            </NeoCard>
          </div>

          <div className="space-y-4 lg:col-span-4">
            <NeoCard variant="flat" className="p-4">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <Smartphone size={14} className="text-slate-500" />
                Device Context
              </p>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Model</p>
                  <p className="mt-1 font-semibold text-slate-800">{crash.deviceMetadata?.model || 'Unknown device'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">OS</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {crash.deviceMetadata?.systemName || 'Unknown'} {crash.deviceMetadata?.systemVersion || ''}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Device ID</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-600">
                    {crash.deviceMetadata?.identifierForVendor || 'N/A'}
                  </p>
                </div>
              </div>
            </NeoCard>

            <NeoCard variant="flat" className="p-4">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <Server size={14} className="text-slate-500" />
                Event Identifiers
              </p>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Session ID</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">{crash.sessionId}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Crash ID</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">{crash.id}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Timestamp</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-700">
                    <Calendar size={12} className="text-slate-400" />
                    {new Date(crash.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            </NeoCard>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrashDetail;
