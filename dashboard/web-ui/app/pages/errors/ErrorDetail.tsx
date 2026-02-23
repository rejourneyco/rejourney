import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  Calendar,
  Check,
  Code,
  Copy,
  Download,
  Layers,
  Monitor,
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

interface JSErrorReport {
  id: string;
  sessionId: string;
  projectId: string;
  timestamp: string;
  errorType: string;
  errorName: string;
  message: string;
  stack?: string;
  screenName?: string;
  componentName?: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  status?: string;
}

const getStatusVariant = (status?: string): 'danger' | 'warning' | 'success' | 'neutral' | 'info' => {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'open' || normalized === 'new') return 'danger';
  if (normalized === 'investigating') return 'warning';
  if (normalized === 'resolved' || normalized === 'fixed') return 'success';
  if (normalized === 'ignored') return 'neutral';
  return 'info';
};

const getErrorTypeLabel = (errorType: string): string => {
  switch (errorType) {
    case 'promise_rejection':
      return 'Promise Rejection';
    case 'unhandled_exception':
      return 'Unhandled Exception';
    case 'js_error':
      return 'JavaScript Error';
    default:
      return errorType;
  }
};

const getErrorTypeVariant = (errorType: string): 'warning' | 'danger' | 'info' => {
  if (errorType === 'promise_rejection') return 'warning';
  if (errorType === 'unhandled_exception') return 'danger';
  return 'info';
};

export const ErrorDetail: React.FC<{ errorId?: string; projectId?: string }> = ({
  errorId: propErrorId,
  projectId: propProjectId,
}) => {
  const { errorId: paramErrorId, projectId: paramProjectId } = useParams<{ errorId: string; projectId: string }>();
  const errorId = propErrorId || paramErrorId;
  const projectId = propProjectId || paramProjectId;

  const { projects, isLoading: contextLoading } = useSessionData();
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();

  const [errorData, setErrorData] = useState<JSErrorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const currentProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (!errorId) {
      setFetchError('Missing error id.');
      setLoading(false);
      return;
    }

    if (contextLoading) return;

    if (!currentProject) {
      setFetchError('Project not found or access revoked.');
      setLoading(false);
      return;
    }

    const fetchErrorDetails = async () => {
      setLoading(true);
      setFetchError(null);

      try {
        const data = await api.getError(currentProject.id, errorId);
        setErrorData(data);
      } catch (err) {
        console.error('Failed to load error details:', err);
        setFetchError('Failed to load error details. It may have been deleted or moved.');
      } finally {
        setLoading(false);
      }
    };

    fetchErrorDetails();
  }, [errorId, currentProject, contextLoading]);

  const stackText = errorData?.stack || '';

  const handleCopyStack = () => {
    if (!stackText) return;
    navigator.clipboard.writeText(stackText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadStack = () => {
    if (!stackText || !errorData?.id) return;

    const blob = new Blob([stackText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `error-trace-${errorData.id}-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const statusVariant = useMemo(() => getStatusVariant(errorData?.status), [errorData?.status]);
  const typeVariant = useMemo(() => getErrorTypeVariant(errorData?.errorType || ''), [errorData?.errorType]);

  if (loading || contextLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="text-2xl font-semibold uppercase tracking-tight animate-pulse">Loading error analysis...</div>
      </div>
    );
  }

  if (fetchError || !errorData) {
    return (
      <div className="min-h-screen bg-transparent pb-8">
        <DashboardPageHeader
          title="Error Root Cause"
          subtitle="Deep runtime error analysis"
          icon={<Bug className="h-5 w-5" />}
          iconColor="bg-amber-50"
        />
        <div className="mx-auto w-full max-w-[960px] px-6 pt-8">
          <NeoCard variant="flat" className="p-8 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
            <p className="text-lg font-semibold text-slate-900">{fetchError || 'Error not found.'}</p>
            <NeoButton variant="primary" className="mt-5" onClick={() => navigate(`${pathPrefix}/stability/errors`)}>
              Back to Errors
            </NeoButton>
          </NeoCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="Error Root Cause"
        subtitle="Trace exception origins, component context, and replay evidence"
        icon={<Bug className="h-5 w-5" />}
        iconColor="bg-amber-50"
      >
        <NeoButton
          variant="secondary"
          size="sm"
          leftIcon={<ArrowLeft size={14} />}
          onClick={() => navigate(`${pathPrefix}/stability/errors`)}
        >
          Back to Errors
        </NeoButton>
        <NeoButton
          variant="primary"
          size="sm"
          leftIcon={<Play size={14} />}
          onClick={() => navigate(`${pathPrefix}/sessions/${errorData.sessionId}`)}
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
                  {errorData.status || 'active'}
                </NeoBadge>
                <NeoBadge variant={typeVariant} size="sm">
                  {getErrorTypeLabel(errorData.errorType)}
                </NeoBadge>
              </div>
              <h2 className="truncate text-xl font-semibold text-slate-900 md:text-2xl">{errorData.errorName}</h2>
              <p className="mt-2 text-sm text-slate-600">{errorData.message}</p>
            </div>

            <div className="grid w-full max-w-md grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Occurred At</p>
                <p className="mt-1 text-xs font-semibold text-slate-800">{new Date(errorData.timestamp).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">App Version</p>
                <p className="mt-1 text-xs font-semibold text-slate-800">{errorData.appVersion || 'N/A'}</p>
              </div>
            </div>
          </div>
        </NeoCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <NeoCard variant="flat" disablePadding className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Code className="h-4 w-4 text-amber-500" />
                  Error Stack Trace
                </h3>
                <div className="flex items-center gap-2">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={handleCopyStack}
                    disabled={!stackText}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </NeoButton>
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<Download size={14} />}
                    onClick={handleDownloadStack}
                    disabled={!stackText}
                  >
                    Download
                  </NeoButton>
                </div>
              </div>

              {stackText ? (
                <pre className="max-h-[560px] overflow-auto bg-slate-950 p-5 font-mono text-xs leading-relaxed text-slate-300">
                  {stackText}
                </pre>
              ) : (
                <div className="p-8 text-center text-sm text-slate-500">No stack trace available for this error.</div>
              )}
            </NeoCard>

            <NeoCard variant="flat" className="border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
                <Sparkles size={14} />
                Root Cause Playbook
              </p>
              <div className="mt-3 space-y-2 text-xs leading-relaxed text-amber-700/90">
                <p>1. Start at the first app frame in the stack and map it to the active screen/component.</p>
                <p>2. Validate app version and device environment to confirm blast radius.</p>
                <p>3. Replay this session and verify the exact user path that leads into the failing code.</p>
              </div>
            </NeoCard>
          </div>

          <div className="space-y-4 lg:col-span-4">
            <NeoCard variant="flat" className="p-4">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <Layers size={14} className="text-slate-500" />
                Error Context
              </p>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Screen</p>
                  <p className="mt-1 flex items-center gap-1 font-semibold text-slate-800">
                    <Monitor size={12} className="text-slate-400" />
                    {errorData.screenName || 'Unknown screen'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Component</p>
                  <p className="mt-1 font-semibold text-slate-800">{errorData.componentName || 'Unknown component'}</p>
                </div>
              </div>
            </NeoCard>

            <NeoCard variant="flat" className="p-4">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <Smartphone size={14} className="text-slate-500" />
                Device + IDs
              </p>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Device Model</p>
                  <p className="mt-1 font-semibold text-slate-800">{errorData.deviceModel || 'Unknown device'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">OS Version</p>
                  <p className="mt-1 font-semibold text-slate-800">{errorData.osVersion || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Session ID</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">{errorData.sessionId}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Error ID</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">{errorData.id}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Timestamp</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-700">
                    <Calendar size={12} className="text-slate-400" />
                    {new Date(errorData.timestamp).toLocaleString()}
                  </p>
                </div>
                <div className="pt-1">
                  <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <Server size={12} className="text-slate-400" />
                    Project Link
                  </p>
                  <p className="break-all font-mono text-[11px] text-slate-500">{errorData.projectId}</p>
                </div>
              </div>
            </NeoCard>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ErrorDetail;
