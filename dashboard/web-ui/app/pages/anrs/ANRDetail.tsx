import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Copy,
  Download,
  Play,
  Server,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { api } from '../../services/api';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';

interface ANRReport {
  id: string;
  sessionId: string;
  projectId: string;
  timestamp: string;
  durationMs: number;
  threadState: string;
  deviceMetadata?: {
    model?: string;
    manufacturer?: string;
    systemName?: string;
    systemVersion?: string;
    osVersion?: string;
    sdkInt?: number;
    [key: string]: any;
  };
  status: string;
  fullReport?: any;
}

const getStatusVariant = (status?: string): 'danger' | 'warning' | 'success' | 'neutral' | 'info' => {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'open' || normalized === 'new') return 'danger';
  if (normalized === 'investigating') return 'warning';
  if (normalized === 'resolved' || normalized === 'fixed') return 'success';
  if (normalized === 'ignored') return 'neutral';
  return 'info';
};

export const ANRDetail: React.FC<{ anrId?: string; projectId?: string }> = ({
  anrId: propAnrId,
  projectId: propProjectId,
}) => {
  const { anrId: paramAnrId, projectId: paramProjectId } = useParams<{ anrId: string; projectId: string }>();
  const anrId = propAnrId || paramAnrId;
  const projectId = propProjectId || paramProjectId;

  const { projects, isLoading: contextLoading } = useSessionData();
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();

  const [anr, setAnr] = useState<ANRReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const currentProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (!anrId) {
      setError('Missing ANR id.');
      setLoading(false);
      return;
    }

    if (contextLoading) return;

    if (!currentProject) {
      setError('Project not found or access revoked.');
      setLoading(false);
      return;
    }

    const fetchANR = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await api.getANR(currentProject.id, anrId);
        setAnr(data);
      } catch (err) {
        console.error('Failed to load ANR details:', err);
        setError('Failed to load ANR details. It may have been deleted or moved.');
      } finally {
        setLoading(false);
      }
    };

    fetchANR();
  }, [anrId, currentProject, contextLoading]);

  const threadState = anr?.threadState || anr?.fullReport?.threadState || '';
  const deviceMeta = anr?.deviceMetadata || anr?.fullReport?.deviceInfo || {};

  const handleCopyStack = () => {
    if (!threadState) return;
    navigator.clipboard.writeText(threadState);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadStack = () => {
    if (!threadState || !anr?.id) return;

    const blob = new Blob([threadState], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `anr-trace-${anr.id}-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const statusVariant = useMemo(() => getStatusVariant(anr?.status), [anr?.status]);

  if (loading || contextLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="text-2xl font-semibold uppercase tracking-tight animate-pulse">Loading ANR analysis...</div>
      </div>
    );
  }

  if (error || !anr) {
    return (
      <div className="min-h-screen bg-transparent pb-8">
        <DashboardPageHeader
          title="ANR Root Cause"
          subtitle="Deep ANR analysis"
          icon={<Clock className="h-5 w-5" />}
          iconColor="bg-violet-50"
        />
        <div className="mx-auto w-full max-w-[960px] px-6 pt-8">
          <NeoCard variant="flat" className="p-8 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-violet-500" />
            <p className="text-lg font-semibold text-slate-900">{error || 'ANR not found.'}</p>
            <NeoButton variant="primary" className="mt-5" onClick={() => navigate(`${pathPrefix}/stability/anrs`)}>
              Back to ANRs
            </NeoButton>
          </NeoCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="ANR Root Cause"
        subtitle="Inspect main-thread freeze signatures and replay context"
        icon={<Clock className="h-5 w-5" />}
        iconColor="bg-violet-50"
      >
        <NeoButton
          variant="secondary"
          size="sm"
          leftIcon={<ArrowLeft size={14} />}
          onClick={() => navigate(`${pathPrefix}/stability/anrs`)}
        >
          Back to ANRs
        </NeoButton>
        <NeoButton
          variant="primary"
          size="sm"
          leftIcon={<Play size={14} />}
          onClick={() => navigate(`${pathPrefix}/sessions/${anr.sessionId}`)}
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
                  {anr.status || 'unknown'}
                </NeoBadge>
                <NeoBadge variant="anr" size="sm">
                  app not responding
                </NeoBadge>
              </div>
              <h2 className="truncate text-xl font-semibold text-slate-900 md:text-2xl">Main Thread Blocked</h2>
              <p className="mt-2 text-sm text-slate-600">
                Freeze duration: <span className="font-semibold text-violet-700">{anr.durationMs}ms</span>
              </p>
            </div>

            <div className="grid w-full max-w-md grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Duration</p>
                <p className="mt-1 text-xs font-semibold text-slate-800">{(anr.durationMs / 1000).toFixed(2)}s</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Occurred At</p>
                <p className="mt-1 text-xs font-semibold text-slate-800">{new Date(anr.timestamp).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </NeoCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <NeoCard variant="flat" disablePadding className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Activity className="h-4 w-4 text-violet-500" />
                  Main Thread Snapshot
                </h3>
                <div className="flex items-center gap-2">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={handleCopyStack}
                    disabled={!threadState}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </NeoButton>
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<Download size={14} />}
                    onClick={handleDownloadStack}
                    disabled={!threadState}
                  >
                    Download
                  </NeoButton>
                </div>
              </div>

              {threadState ? (
                <pre className="max-h-[560px] overflow-auto bg-slate-950 p-5 font-mono text-xs leading-relaxed text-violet-200">
                  {threadState}
                </pre>
              ) : (
                <div className="p-8 text-center text-sm text-slate-500">No main-thread snapshot was captured.</div>
              )}
            </NeoCard>

            <NeoCard variant="flat" className="border-violet-200 bg-violet-50 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                <Sparkles size={14} />
                Root Cause Playbook
              </p>
              <div className="mt-3 space-y-2 text-xs leading-relaxed text-violet-700/90">
                <p>1. Locate synchronous calls and long loops at the top of this snapshot.</p>
                <p>2. Compare freeze timing with user actions in replay to identify trigger paths.</p>
                <p>3. Confirm whether the same code path appears across multiple ANR reports.</p>
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
                  <p className="mt-1 font-semibold text-slate-800">
                    {deviceMeta.model || deviceMeta.manufacturer || 'Unknown device'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">OS</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {deviceMeta.systemName || 'Unknown'} {deviceMeta.systemVersion || deviceMeta.osVersion || ''}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">SDK Level</p>
                  <p className="mt-1 font-semibold text-slate-800">{deviceMeta.sdkInt || 'N/A'}</p>
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
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">{anr.sessionId}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">ANR ID</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">{anr.id}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Timestamp</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-700">
                    <Calendar size={12} className="text-slate-400" />
                    {new Date(anr.timestamp).toLocaleString()}
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

export default ANRDetail;
