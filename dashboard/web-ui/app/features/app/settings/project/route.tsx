import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useTeam } from '~/shared/providers/TeamContext';
import { useAuth } from '~/shared/providers/AuthContext';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { Input } from '~/shared/ui/core/Input';
import { Modal } from '~/shared/ui/core/Modal';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { SettingsLayout } from '~/shell/components/layout/SettingsLayout';
import { InfoTooltip } from '~/shared/ui/core/InfoTooltip';
import { Copy, Plus, Minus, Trash2, Key, AlertTriangle, CheckCircle, Shield, Check, Settings, Save, AlertOctagon, Smartphone, MonitorSmartphone, Percent, Globe } from 'lucide-react';
import { formatWebAllowedDomainsInput, getAndroidPackageError, getIosBundleIdError, getWebAllowedDomainsError, parseWebAllowedDomainsInput } from '~/shared/lib/validation';
import {
  getProject,
  updateProject,
  deleteProject,
  requestProjectDeletionOtp,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  ApiKey,
  CreatedApiKey
} from '~/shared/api/client';

interface SettingsProps {
  projectId?: string;
}

type TextInputMasking = 'all' | 'secure_only';
type RecordingFps = 1 | 2 | 3;
type ProjectSettingsTone = 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';

const PROJECT_SETTINGS_TONES: Record<ProjectSettingsTone, {
  accent: string;
  icon: string;
  pill: string;
}> = {
  blue: {
    accent: 'bg-[#1a73e8]',
    icon: 'border-blue-100 bg-blue-50 text-blue-700',
    pill: 'border-blue-100 bg-blue-50 text-blue-700',
  },
  emerald: {
    accent: 'bg-emerald-500',
    icon: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    pill: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  },
  amber: {
    accent: 'bg-amber-400',
    icon: 'border-amber-100 bg-amber-50 text-amber-700',
    pill: 'border-amber-100 bg-amber-50 text-amber-700',
  },
  rose: {
    accent: 'bg-rose-500',
    icon: 'border-rose-100 bg-rose-50 text-rose-700',
    pill: 'border-rose-100 bg-rose-50 text-rose-700',
  },
  slate: {
    accent: 'bg-slate-300',
    icon: 'border-slate-200 bg-slate-50 text-slate-600',
    pill: 'border-slate-200 bg-slate-50 text-slate-600',
  },
};

interface SettingsSectionProps {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tone?: ProjectSettingsTone;
  action?: React.ReactNode;
  children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
  id,
  title,
  description,
  icon,
  tone = 'blue',
  action,
  children,
}) => {
  const toneClasses = PROJECT_SETTINGS_TONES[tone];
  return (
    <section id={id} className="project-settings-section dashboard-surface scroll-mt-24 overflow-hidden">
      <div className={`project-settings-section-accent ${toneClasses.accent}`} />
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`project-settings-section-icon ${toneClasses.icon}`}>{icon}</div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-black">{title}</h2>
            <p className="mt-1 max-w-2xl text-xs font-medium leading-5 text-slate-500">{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="divide-y divide-slate-100">
        {children}
      </div>
    </section>
  );
};

interface SettingRowProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const SettingRow: React.FC<SettingRowProps> = ({ title, description, icon, children }) => (
  <div className="project-settings-row grid gap-4 px-5 py-4 lg:grid-cols-[minmax(220px,0.62fr)_minmax(0,1fr)] lg:items-start">
    <div className="flex min-w-0 gap-3">
      {icon && <div className="project-settings-row-icon">{icon}</div>}
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        {description && <p className="mt-1 max-w-md text-xs font-medium leading-5 text-slate-500">{description}</p>}
      </div>
    </div>
    <div className="min-w-0">
      {children}
    </div>
  </div>
);

interface StatusPillProps {
  label: string;
  tone?: ProjectSettingsTone;
}

const StatusPill: React.FC<StatusPillProps> = ({ label, tone = 'slate' }) => (
  <span className={`project-settings-status-pill ${PROJECT_SETTINGS_TONES[tone].pill}`}>
    {label}
  </span>
);

interface SwitchControlProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

const SwitchControl: React.FC<SwitchControlProps> = ({ checked, disabled, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    disabled={disabled}
    className={`project-settings-switch ${checked ? 'project-settings-switch-on' : ''}`}
  >
    <span />
  </button>
);

interface RangeSettingProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  saveState?: string | null;
  error?: string | null;
  tooltip?: React.ReactNode;
  onDraftChange: (value: number) => void;
  onCommit: () => void;
}

const RangeSetting: React.FC<RangeSettingProps> = ({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  disabled,
  saveState,
  error,
  tooltip,
  onDraftChange,
  onCommit,
}) => {
  const rangeProgress = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const commitValue = (nextValue: number) => {
    const clamped = Math.min(max, Math.max(min, nextValue));
    if (clamped === value) return;
    onDraftChange(clamped);
    onCommit();
  };

  return (
    <div className="project-settings-range-card dashboard-inner-surface bg-white p-4">
      <div className="project-settings-range-header">
        <label className="project-settings-range-label text-sm font-semibold text-slate-900">
          <span className="project-settings-range-label-text">{label}</span>
          {tooltip ? <span className="project-settings-range-tooltip">{tooltip}</span> : null}
        </label>
        <div className="project-settings-stepper" aria-label={`${label} value`}>
          <button
            type="button"
            onClick={() => commitValue(value - step)}
            disabled={disabled || value <= min}
            aria-label={`Decrease ${label}`}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="project-settings-stepper-value">{value}{unit}</span>
          <button
            type="button"
            onClick={() => commitValue(value + step)}
            disabled={disabled || value >= max}
            aria-label={`Increase ${label}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onDraftChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) onCommit(); }}
        onBlur={onCommit}
        disabled={disabled}
        className="project-settings-range-input"
        style={{ '--range-progress': `${rangeProgress}%` } as React.CSSProperties}
      />
      <div className="mt-3 flex justify-between text-xs font-medium text-slate-400">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
      {(saveState || error) && (
        <p className={`mt-2 flex items-center gap-1 text-xs font-semibold ${error ? 'text-red-600' : 'text-slate-500'}`}>
          {error ? <AlertTriangle className="h-3 w-3" /> : null}{error || saveState}
        </p>
      )}
    </div>
  );
};

const normalizeTextInputMasking = (value: unknown): TextInputMasking => (
  value === 'secure_only' ? 'secure_only' : 'all'
);

const normalizeRecordingFps = (value: unknown): RecordingFps => {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(3, Math.max(1, numericValue)) as RecordingFps;
};

const normalizeMaxRecordingMinutes = (value: unknown): number => {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 10;
  return Math.min(10, Math.max(1, numericValue));
};

const normalizeWebMaxObservabilityMinutes = (value: unknown): number => {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 30;
  return Math.min(30, Math.max(1, numericValue));
};

const normalizeSampleRate = (value: unknown): number => {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 100;
  return Math.min(100, Math.max(0, numericValue));
};

export const ProjectSettings: React.FC<SettingsProps> = ({ projectId: propProjectId }) => {
  const { projects, refreshSessions, selectedProject, setSelectedProject } = useSessionData();
  const { currentTeam, teamMembers } = useTeam();
  const { user } = useAuth();
  const isSelfHosted = !!user?.isSelfHosted;
  const navigate = useNavigate();
  const location = useLocation();
  const pathPrefix = usePathPrefix();
  const { projectId: paramProjectId } = useParams<{ projectId: string }>();

  // Use prop projectId if available, fall back to URL param
  const projectId = propProjectId || paramProjectId;

  // If user switches projects while on the settings page, follow the selection.
  // This avoids the page appearing “stuck” on the previous project's settings.
  useEffect(() => {
    if (propProjectId) return; // Embedded usage controls the projectId.
    if (!paramProjectId) return;
    if (!selectedProject?.id) return;

    if (location.pathname.startsWith('/settings/') && paramProjectId !== selectedProject.id) {
      navigate(`${pathPrefix}/settings/${selectedProject.id}`, { replace: true });
    }
  }, [location.pathname, navigate, pathPrefix, paramProjectId, propProjectId, selectedProject?.id]);

  // Check if user is admin or owner (can edit settings)
  const currentMember = teamMembers.find(m => m.userId === user?.id);
  const isOwner = currentTeam?.ownerUserId === user?.id;
  const isAdmin = isOwner || currentMember?.role === 'admin';
  const canEdit = isAdmin;

  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [appName, setAppName] = useState('');
  const [maxRecordingMinutes, setMaxRecordingMinutes] = useState<number>(10);
  const [maxRecordingMinutesDraft, setMaxRecordingMinutesDraft] = useState<number | null>(null);
  const [webMaxObservabilityMinutes, setWebMaxObservabilityMinutes] = useState<number>(30);
  const [webMaxObservabilityMinutesDraft, setWebMaxObservabilityMinutesDraft] = useState<number | null>(null);
  const [sampleRate, setSampleRate] = useState<number>(100);
  const [sampleRateDraft, setSampleRateDraft] = useState<number | null>(null);
  const [recordingFps, setRecordingFps] = useState<RecordingFps>(1);
  const [recordingFpsDraft, setRecordingFpsDraft] = useState<RecordingFps | null>(null);
  const [recordingFpsConfirmation, setRecordingFpsConfirmation] = useState<RecordingFps | null>(null);
  const [rejourneyEnabled, setRejourneyEnabled] = useState<boolean>(true);
  const [recordingEnabled, setRecordingEnabled] = useState<boolean>(true);
  const [textInputMasking, setTextInputMasking] = useState<TextInputMasking>('all');
  const [webAllowedDomainsText, setWebAllowedDomainsText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingWebDomains, setIsSavingWebDomains] = useState(false);
  const [isSavingDuration, setIsSavingDuration] = useState(false);
  const [isSavingWebDuration, setIsSavingWebDuration] = useState(false);
  const [isSavingSampleRate, setIsSavingSampleRate] = useState(false);
  const [isSavingRecordingFps, setIsSavingRecordingFps] = useState(false);
  const [isSavingRejourney, setIsSavingRejourney] = useState(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const [isSavingMasking, setIsSavingMasking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [webDomainsSaveError, setWebDomainsSaveError] = useState<string | null>(null);
  const [durationSaveError, setDurationSaveError] = useState<string | null>(null);
  const [webDurationSaveError, setWebDurationSaveError] = useState<string | null>(null);
  const [sampleRateSaveError, setSampleRateSaveError] = useState<string | null>(null);
  const [recordingFpsSaveError, setRecordingFpsSaveError] = useState<string | null>(null);
  const [rejourneySaveError, setRejourneySaveError] = useState<string | null>(null);
  const [recordingSaveError, setRecordingSaveError] = useState<string | null>(null);
  const [maskingSaveError, setMaskingSaveError] = useState<string | null>(null);
  const pendingMaxRecordingMinutesRef = useRef<number | null>(null);
  const pendingWebMaxObservabilityMinutesRef = useRef<number | null>(null);
  const pendingSampleRateRef = useRef<number | null>(null);
  const pendingTextInputMaskingRef = useRef<TextInputMasking | null>(null);
  const pendingRecordingFpsRef = useRef<RecordingFps | null>(null);
  const maxRecordingMinutesDraftRef = useRef<number | null>(null);
  const webMaxObservabilityMinutesDraftRef = useRef<number | null>(null);
  const sampleRateDraftRef = useRef<number | null>(null);
  const recordingFpsDraftRef = useRef<RecordingFps | null>(null);

  // API Key state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [isCreatingKey, setIsCreatingKey] = useState(false);

  // Delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteOtpCode, setDeleteOtpCode] = useState('');
  const [isSendingDeleteOtp, setIsSendingDeleteOtp] = useState(false);
  const [deleteOtpSent, setDeleteOtpSent] = useState(false);
  const [deleteOtpMessage, setDeleteOtpMessage] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Copy state
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const setRecordingFpsDraftValue = (fps: RecordingFps | null) => {
    recordingFpsDraftRef.current = fps;
    setRecordingFpsDraft(fps);
  };

  const setMaxRecordingMinutesDraftValue = (minutes: number | null) => {
    maxRecordingMinutesDraftRef.current = minutes;
    setMaxRecordingMinutesDraft(minutes);
  };

  const setWebMaxObservabilityMinutesDraftValue = (minutes: number | null) => {
    webMaxObservabilityMinutesDraftRef.current = minutes;
    setWebMaxObservabilityMinutesDraft(minutes);
  };

  const setSampleRateDraftValue = (rate: number | null) => {
    sampleRateDraftRef.current = rate;
    setSampleRateDraft(rate);
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const applyProjectToForm = (nextProject: any) => {
    const sourceMasking = normalizeTextInputMasking(nextProject?.textInputMasking);
    const pendingMasking = pendingTextInputMaskingRef.current;
    const masking = pendingMasking && sourceMasking !== pendingMasking ? pendingMasking : sourceMasking;
    if (pendingMasking && sourceMasking === pendingMasking) {
      pendingTextInputMaskingRef.current = null;
    }
    const sourceMaxRecordingMinutes = normalizeMaxRecordingMinutes(nextProject?.maxRecordingMinutes);
    const pendingMaxRecordingMinutes = pendingMaxRecordingMinutesRef.current;
    const resolvedMaxRecordingMinutes = pendingMaxRecordingMinutes && sourceMaxRecordingMinutes !== pendingMaxRecordingMinutes
      ? pendingMaxRecordingMinutes
      : sourceMaxRecordingMinutes;
    if (pendingMaxRecordingMinutes && sourceMaxRecordingMinutes === pendingMaxRecordingMinutes) {
      pendingMaxRecordingMinutesRef.current = null;
    }
    const sourceWebMaxObservabilityMinutes = normalizeWebMaxObservabilityMinutes(nextProject?.webMaxObservabilityMinutes);
    const pendingWebMaxObservabilityMinutes = pendingWebMaxObservabilityMinutesRef.current;
    const resolvedWebMaxObservabilityMinutes = pendingWebMaxObservabilityMinutes && sourceWebMaxObservabilityMinutes !== pendingWebMaxObservabilityMinutes
      ? pendingWebMaxObservabilityMinutes
      : sourceWebMaxObservabilityMinutes;
    if (pendingWebMaxObservabilityMinutes && sourceWebMaxObservabilityMinutes === pendingWebMaxObservabilityMinutes) {
      pendingWebMaxObservabilityMinutesRef.current = null;
    }
    const sourceSampleRate = normalizeSampleRate(nextProject?.sampleRate);
    const pendingSampleRate = pendingSampleRateRef.current;
    const resolvedSampleRate = pendingSampleRate !== null && pendingSampleRate !== undefined && sourceSampleRate !== pendingSampleRate
      ? pendingSampleRate
      : sourceSampleRate;
    if (pendingSampleRate !== null && pendingSampleRate !== undefined && sourceSampleRate === pendingSampleRate) {
      pendingSampleRateRef.current = null;
    }
    const sourceRecordingFps = normalizeRecordingFps(nextProject?.recordingFps);
    const pendingRecordingFps = pendingRecordingFpsRef.current;
    const resolvedRecordingFps = pendingRecordingFps && sourceRecordingFps !== pendingRecordingFps
      ? pendingRecordingFps
      : sourceRecordingFps;
    if (pendingRecordingFps && sourceRecordingFps === pendingRecordingFps) {
      pendingRecordingFpsRef.current = null;
    }
    const sourceWebAllowedDomains = Array.isArray(nextProject?.webAllowedDomains) && nextProject.webAllowedDomains.length > 0
      ? nextProject.webAllowedDomains
      : nextProject?.webDomain
        ? [nextProject.webDomain]
        : [];
    const normalizedWebAllowedDomains = parseWebAllowedDomainsInput(formatWebAllowedDomainsInput(sourceWebAllowedDomains));

    setProject({
      ...nextProject,
      textInputMasking: masking,
      maxRecordingMinutes: resolvedMaxRecordingMinutes,
      webMaxObservabilityMinutes: resolvedWebMaxObservabilityMinutes,
      sampleRate: resolvedSampleRate,
      recordingFps: resolvedRecordingFps,
      webDomain: normalizedWebAllowedDomains[0] ?? null,
      webAllowedDomains: normalizedWebAllowedDomains,
    });
    setAppName(nextProject.name);
    setMaxRecordingMinutes(resolvedMaxRecordingMinutes);
    setMaxRecordingMinutesDraftValue(null);
    setWebMaxObservabilityMinutes(resolvedWebMaxObservabilityMinutes);
    setWebMaxObservabilityMinutesDraftValue(null);
    setSampleRate(resolvedSampleRate);
    setSampleRateDraftValue(null);
    setRecordingFps(resolvedRecordingFps);
    setRecordingFpsDraftValue(null);
    setRecordingFpsConfirmation(null);
    setRejourneyEnabled((nextProject as any).rejourneyEnabled ?? true);
    setRecordingEnabled(nextProject.recordingEnabled ?? true);
    setTextInputMasking(masking);
    setWebAllowedDomainsText(formatWebAllowedDomainsInput(normalizedWebAllowedDomains));
    setWebDomainsSaveError(null);
  };

  // Find project from context or fetch it
  useEffect(() => {
    const loadProject = async () => {
      // If no projectId provided, can't load anything
      if (!projectId) {
        setLoading(false);
        setError('No project selected');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Try to find in context first for fast paint, then verify from the
        // single-project endpoint so stale bootstrap/project-list cache cannot
        // reset newer settings such as recordingFps on refresh.
        const contextProject = projects.find(a => a.id === projectId);
        if (contextProject) {
          applyProjectToForm(contextProject);
          setLoading(false);
        }

        const fetchedProject = await getProject(projectId);
        applyProjectToForm(fetchedProject);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project');
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [projectId, projects]);

  // Load API keys
  useEffect(() => {
    const loadData = async () => {
      if (!projectId) return;

      // Load API Keys
      if (isSelfHosted) {
        try {
          setIsLoadingKeys(true);
          const keys = await getApiKeys(projectId);
          setApiKeys(keys);
        } catch (err) {
          setKeyError('Failed to load API keys');
        } finally {
          setIsLoadingKeys(false);
        }
      }
    };
    loadData();
  }, [projectId]);

  const handleSaveName = async () => {
    if (!project || !appName.trim()) {
      setSaveError('Project name cannot be empty');
      return;
    }

    if (appName.trim() === project.name) {
      return; // No change
    }

    try {
      setIsSaving(true);
      setSaveError(null);

      await updateProject(project.id, { name: appName.trim() });

      // Refresh projects list
      await refreshSessions();

      // Update local project
      setProject({ ...project, name: appName.trim() });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update project name');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveWebAllowedDomains = async () => {
    if (!project) {
      setWebDomainsSaveError('Project not loaded');
      return;
    }
    const isWebProject = project.platforms?.includes('web');
    const validationError = getWebAllowedDomainsError(webAllowedDomainsText, isWebProject);
    if (validationError) {
      setWebDomainsSaveError(validationError);
      return;
    }

    const domains = parseWebAllowedDomainsInput(webAllowedDomainsText);
    try {
      setIsSavingWebDomains(true);
      setWebDomainsSaveError(null);
      const updatedProject = await updateProject(project.id, {
        webAllowedDomains: domains,
        webDomain: domains[0] ?? null,
      });
      const confirmedDomains = parseWebAllowedDomainsInput(
        formatWebAllowedDomainsInput(updatedProject.webAllowedDomains?.length ? updatedProject.webAllowedDomains : domains),
      );
      setProject({
        ...project,
        ...updatedProject,
        webDomain: confirmedDomains[0] ?? null,
        webAllowedDomains: confirmedDomains,
      });
      setWebAllowedDomainsText(formatWebAllowedDomainsInput(confirmedDomains));
      const currentSelectedProject = selectedProject?.id === project.id ? selectedProject : null;
      if (currentSelectedProject) {
        setSelectedProject({
          ...currentSelectedProject,
          ...(updatedProject as any),
          webDomain: confirmedDomains[0] ?? null,
          webAllowedDomains: confirmedDomains,
          platforms: (updatedProject.platforms as any) || currentSelectedProject.platforms,
          bundleId: updatedProject.bundleId || currentSelectedProject.bundleId,
          createdAt: updatedProject.createdAt || currentSelectedProject.createdAt,
          sessionsLast7Days: currentSelectedProject.sessionsLast7Days,
          errorsLast7Days: currentSelectedProject.errorsLast7Days,
        });
      }
      await refreshSessions();
    } catch (err) {
      setWebDomainsSaveError(err instanceof Error ? err.message : 'Failed to update web allowed domains');
    } finally {
      setIsSavingWebDomains(false);
    }
  };

  const handleMaxRecordingMinutesChange = async (minutes: number): Promise<boolean> => {
    if (!project) {
      setDurationSaveError('Project not loaded');
      return false;
    }
    const clamped = normalizeMaxRecordingMinutes(minutes);
    if (clamped === maxRecordingMinutes) {
      return false;
    }
    const previous = maxRecordingMinutes;
    try {
      setIsSavingDuration(true);
      setDurationSaveError(null);
      pendingMaxRecordingMinutesRef.current = clamped;
      setMaxRecordingMinutes(clamped);
      const updatedProject = await updateProject(project.id, { maxRecordingMinutes: clamped });
      const confirmedMinutes = normalizeMaxRecordingMinutes(updatedProject.maxRecordingMinutes ?? clamped);
      pendingMaxRecordingMinutesRef.current = confirmedMinutes;
      setProject({ ...project, ...updatedProject, maxRecordingMinutes: confirmedMinutes });
      setMaxRecordingMinutes(confirmedMinutes);
      const currentSelectedProject = selectedProject?.id === project.id ? selectedProject : null;
      if (currentSelectedProject) {
        setSelectedProject({
          ...currentSelectedProject,
          ...(updatedProject as any),
          maxRecordingMinutes: confirmedMinutes,
          platforms: currentSelectedProject.platforms,
          bundleId: updatedProject.bundleId || currentSelectedProject.bundleId,
          createdAt: updatedProject.createdAt || currentSelectedProject.createdAt,
          sessionsLast7Days: currentSelectedProject.sessionsLast7Days,
          errorsLast7Days: currentSelectedProject.errorsLast7Days,
        });
      }
      await refreshSessions();
      return true;
    } catch (err) {
      pendingMaxRecordingMinutesRef.current = null;
      setDurationSaveError(err instanceof Error ? err.message : 'Failed to update max recording duration');
      setMaxRecordingMinutes(previous);
      return false;
    } finally {
      setIsSavingDuration(false);
    }
  };

  const handleMaxRecordingMinutesDraftChange = (minutes: number) => {
    setDurationSaveError(null);
    setMaxRecordingMinutesDraftValue(normalizeMaxRecordingMinutes(minutes));
  };

  const commitMaxRecordingMinutesDraft = async () => {
    const nextMinutes = maxRecordingMinutesDraftRef.current;
    if (isSavingDuration) {
      return;
    }
    if (!nextMinutes || nextMinutes === maxRecordingMinutes) {
      setMaxRecordingMinutesDraftValue(null);
      return;
    }
    setMaxRecordingMinutesDraftValue(null);
    await handleMaxRecordingMinutesChange(nextMinutes);
  };

  const handleWebMaxObservabilityMinutesChange = async (minutes: number): Promise<boolean> => {
    if (!project) {
      setWebDurationSaveError('Project not loaded');
      return false;
    }
    const clamped = normalizeWebMaxObservabilityMinutes(minutes);
    if (clamped === webMaxObservabilityMinutes) {
      return false;
    }
    const previous = webMaxObservabilityMinutes;
    try {
      setIsSavingWebDuration(true);
      setWebDurationSaveError(null);
      pendingWebMaxObservabilityMinutesRef.current = clamped;
      setWebMaxObservabilityMinutes(clamped);
      const updatedProject = await updateProject(project.id, { webMaxObservabilityMinutes: clamped });
      const confirmedMinutes = normalizeWebMaxObservabilityMinutes(updatedProject.webMaxObservabilityMinutes ?? clamped);
      pendingWebMaxObservabilityMinutesRef.current = confirmedMinutes;
      setProject({ ...project, ...updatedProject, webMaxObservabilityMinutes: confirmedMinutes });
      setWebMaxObservabilityMinutes(confirmedMinutes);
      const currentSelectedProject = selectedProject?.id === project.id ? selectedProject : null;
      if (currentSelectedProject) {
        setSelectedProject({
          ...currentSelectedProject,
          ...(updatedProject as any),
          webMaxObservabilityMinutes: confirmedMinutes,
          platforms: currentSelectedProject.platforms,
          bundleId: updatedProject.bundleId || currentSelectedProject.bundleId,
          createdAt: updatedProject.createdAt || currentSelectedProject.createdAt,
          sessionsLast7Days: currentSelectedProject.sessionsLast7Days,
          errorsLast7Days: currentSelectedProject.errorsLast7Days,
        });
      }
      await refreshSessions();
      return true;
    } catch (err) {
      pendingWebMaxObservabilityMinutesRef.current = null;
      setWebDurationSaveError(err instanceof Error ? err.message : 'Failed to update web observability duration');
      setWebMaxObservabilityMinutes(previous);
      return false;
    } finally {
      setIsSavingWebDuration(false);
    }
  };

  const handleWebMaxObservabilityMinutesDraftChange = (minutes: number) => {
    setWebDurationSaveError(null);
    setWebMaxObservabilityMinutesDraftValue(normalizeWebMaxObservabilityMinutes(minutes));
  };

  const commitWebMaxObservabilityMinutesDraft = async () => {
    const nextMinutes = webMaxObservabilityMinutesDraftRef.current;
    if (isSavingWebDuration) {
      return;
    }
    if (!nextMinutes || nextMinutes === webMaxObservabilityMinutes) {
      setWebMaxObservabilityMinutesDraftValue(null);
      return;
    }
    setWebMaxObservabilityMinutesDraftValue(null);
    await handleWebMaxObservabilityMinutesChange(nextMinutes);
  };

  const handleSampleRateChange = async (rate: number): Promise<boolean> => {
    if (!project) {
      setSampleRateSaveError('Project not loaded');
      return false;
    }
    const clamped = normalizeSampleRate(rate);
    if (clamped === sampleRate) {
      return false;
    }
    const previous = sampleRate;
    try {
      setIsSavingSampleRate(true);
      setSampleRateSaveError(null);
      pendingSampleRateRef.current = clamped;
      setSampleRate(clamped);
      const updatedProject = await updateProject(project.id, { sampleRate: clamped });
      if (typeof updatedProject.sampleRate !== 'number') {
        throw new Error('Sample rate was not confirmed by the API.');
      }
      const confirmedRate = normalizeSampleRate(updatedProject.sampleRate);
      pendingSampleRateRef.current = confirmedRate;
      setProject({ ...project, ...updatedProject, sampleRate: confirmedRate });
      setSampleRate(confirmedRate);
      const currentSelectedProject = selectedProject?.id === project.id ? selectedProject : null;
      if (currentSelectedProject) {
        setSelectedProject({
          ...currentSelectedProject,
          ...(updatedProject as any),
          sampleRate: confirmedRate,
          platforms: currentSelectedProject.platforms,
          bundleId: updatedProject.bundleId || currentSelectedProject.bundleId,
          createdAt: updatedProject.createdAt || currentSelectedProject.createdAt,
          sessionsLast7Days: currentSelectedProject.sessionsLast7Days,
          errorsLast7Days: currentSelectedProject.errorsLast7Days,
        });
      }
      await refreshSessions();
      return true;
    } catch (err) {
      pendingSampleRateRef.current = null;
      setSampleRateSaveError(err instanceof Error ? err.message : 'Failed to update sample rate');
      setSampleRate(previous);
      return false;
    } finally {
      setIsSavingSampleRate(false);
    }
  };

  const handleSampleRateDraftChange = (rate: number) => {
    setSampleRateSaveError(null);
    setSampleRateDraftValue(normalizeSampleRate(rate));
  };

  const commitSampleRateDraft = async () => {
    const nextRate = sampleRateDraftRef.current;
    if (isSavingSampleRate) {
      return;
    }
    if (nextRate === null || nextRate === sampleRate) {
      setSampleRateDraftValue(null);
      return;
    }
    setSampleRateDraftValue(null);
    await handleSampleRateChange(nextRate);
  };

  const handleRecordingFpsChange = async (fps: RecordingFps): Promise<boolean> => {
    if (!project || fps === recordingFps) {
      return false;
    }
    const previous = recordingFps;
    try {
      setIsSavingRecordingFps(true);
      setRecordingFpsSaveError(null);
      pendingRecordingFpsRef.current = fps;
      setRecordingFps(fps);
      const updatedProject = await updateProject(project.id, { recordingFps: fps });
      if (typeof updatedProject.recordingFps !== 'number') {
        throw new Error('Recording FPS was not confirmed by the API.');
      }
      const confirmedFps = normalizeRecordingFps(updatedProject.recordingFps);
      pendingRecordingFpsRef.current = confirmedFps;
      setProject({ ...project, ...updatedProject, recordingFps: confirmedFps });
      setRecordingFps(confirmedFps);
      const currentSelectedProject = selectedProject?.id === project.id ? selectedProject : null;
      if (currentSelectedProject) {
        setSelectedProject({
          ...currentSelectedProject,
          ...(updatedProject as any),
          recordingFps: confirmedFps,
          platforms: currentSelectedProject.platforms,
          bundleId: updatedProject.bundleId || currentSelectedProject.bundleId,
          createdAt: updatedProject.createdAt || currentSelectedProject.createdAt,
          sessionsLast7Days: currentSelectedProject.sessionsLast7Days,
          errorsLast7Days: currentSelectedProject.errorsLast7Days,
        });
      }
      await refreshSessions();
      return true;
    } catch (err) {
      pendingRecordingFpsRef.current = null;
      setRecordingFpsSaveError(err instanceof Error ? err.message : 'Failed to update recording FPS');
      setRecordingFps(previous);
      return false;
    } finally {
      setIsSavingRecordingFps(false);
    }
  };

  const handleRecordingFpsDraftChange = (fps: RecordingFps) => {
    setRecordingFpsSaveError(null);
    setRecordingFpsDraftValue(fps);
  };

  const commitRecordingFpsDraft = async () => {
    const nextFps = recordingFpsDraftRef.current;
    if (isSavingRecordingFps || recordingFpsConfirmation) {
      return;
    }
    if (!nextFps || nextFps === recordingFps) {
      setRecordingFpsDraftValue(null);
      return;
    }
    if (nextFps > recordingFps) {
      setRecordingFpsConfirmation(nextFps);
      return;
    }
    setRecordingFpsDraftValue(null);
    await handleRecordingFpsChange(nextFps);
  };

  const handleConfirmRecordingFpsChange = async () => {
    if (!recordingFpsConfirmation) return;
    const saved = await handleRecordingFpsChange(recordingFpsConfirmation);
    if (saved) {
      setRecordingFpsDraftValue(null);
      setRecordingFpsConfirmation(null);
    }
  };

  const handleCancelRecordingFpsChange = () => {
    if (isSavingRecordingFps) return;
    setRecordingFpsDraftValue(null);
    setRecordingFpsConfirmation(null);
  };

  const handleToggleRecording = async (enabled: boolean) => {
    if (!project) {
      setRecordingSaveError('Project not loaded');
      return;
    }
    try {
      setIsSavingRecording(true);
      setRecordingSaveError(null);
      await updateProject(project.id, { recordingEnabled: enabled });
      await refreshSessions();
      setProject({ ...project, recordingEnabled: enabled });
      setRecordingEnabled(enabled);
    } catch (err) {
      setRecordingSaveError(err instanceof Error ? err.message : 'Failed to update recording status');
      // Revert the toggle on error
      setRecordingEnabled(!enabled);
    } finally {
      setIsSavingRecording(false);
    }
  };

  const handleToggleRejourney = async (enabled: boolean) => {
    if (!project) {
      setRejourneySaveError('Project not loaded');
      return;
    }
    try {
      setIsSavingRejourney(true);
      setRejourneySaveError(null);
      await updateProject(project.id, { rejourneyEnabled: enabled });
      await refreshSessions();
      setProject({ ...project, rejourneyEnabled: enabled });
      setRejourneyEnabled(enabled);
    } catch (err) {
      setRejourneySaveError(err instanceof Error ? err.message : 'Failed to update Rejourney status');
      // Revert the toggle on error
      setRejourneyEnabled(!enabled);
    } finally {
      setIsSavingRejourney(false);
    }
  };

  const handleTextInputMaskingChange = async (mode: TextInputMasking) => {
    if (!project || mode === textInputMasking) {
      return;
    }
    const previous = textInputMasking;
    try {
      setIsSavingMasking(true);
      setMaskingSaveError(null);
      pendingTextInputMaskingRef.current = mode;
      setTextInputMasking(mode);
      const updatedProject = await updateProject(project.id, { textInputMasking: mode });
      const confirmedMode = normalizeTextInputMasking(updatedProject.textInputMasking ?? mode);
      pendingTextInputMaskingRef.current = confirmedMode;
      setProject({ ...project, ...updatedProject, textInputMasking: confirmedMode });
      setTextInputMasking(confirmedMode);
      await refreshSessions();
    } catch (err) {
      pendingTextInputMaskingRef.current = null;
      setMaskingSaveError(err instanceof Error ? err.message : 'Failed to update text input masking');
      setTextInputMasking(previous);
    } finally {
      setIsSavingMasking(false);
    }
  };

  const handleCreateApiKey = async () => {
    if (!isSelfHosted) return;
    if (!project) return;
    setIsCreatingKey(true);
    try {
      setKeyError(null);
      const result = await createApiKey(project.id);
      setCreatedApiKey(result);
      // Refresh list
      const keys = await getApiKeys(project.id);
      setApiKeys(keys);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    if (!isSelfHosted) return;
    if (!window.confirm('Are you sure you want to revoke this API key? It will stop working immediately.')) return;
    try {
      await revokeApiKey(id);
      // Refresh list
      if (project) {
        const keys = await getApiKeys(project.id);
        setApiKeys(keys);
      }
    } catch (err) {
      setKeyError('Failed to revoke key');
    }
  };

  const handleSendDeleteOtp = async () => {
    if (!project) return;

    if (deleteConfirmText !== project.name) {
      setDeleteError('Project name does not match');
      return;
    }

    try {
      setIsSendingDeleteOtp(true);
      setDeleteError(null);
      setDeleteOtpMessage(null);

      const result = await requestProjectDeletionOtp(project.id, {
        confirmText: deleteConfirmText,
      });

      setDeleteOtpSent(true);
      setDeleteOtpMessage(result.devCode
        ? `OTP sent. Dev code: ${result.devCode}`
        : 'OTP sent to your email.');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setIsSendingDeleteOtp(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmText !== project?.name) {
      setDeleteError('Project name does not match');
      return;
    }

    if (!deleteOtpCode.trim()) {
      setDeleteError('OTP code is required');
      return;
    }

    try {
      setIsDeleting(true);
      setDeleteError(null);

      await deleteProject(project.id, {
        confirmText: deleteConfirmText,
        otpCode: deleteOtpCode.trim().toUpperCase(),
      });

      await refreshSessions();

      navigate(`${pathPrefix}/general`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return <DashboardGhostLoader variant="settings" />;
  }

  if (error || !project) {
    return (
      <SettingsLayout
        className="rejourney-settings-page rejourney-project-settings-page"
        title="Project Settings"
        description="Configure project"
        icon={<Settings className="w-6 h-6" />}
        iconColor="bg-[#f4f4f5]"
      >
        <NeoCard className="p-6 border-rose-600 bg-rose-50">
          <div className="flex gap-4 items-center">
            <AlertTriangle className="text-rose-600 w-6 h-6" />
            <div>
              <h3 className="text-rose-900 font-semibold uppercase tracking-tight">Error Loading Project</h3>
              <p className="text-rose-700 text-sm font-bold mt-1">{error || 'Project not found'}</p>
            </div>
          </div>
        </NeoCard>
      </SettingsLayout>
    );
  }

  const displayedMaxRecordingMinutes = maxRecordingMinutesDraft ?? maxRecordingMinutes;
  const displayedWebMaxObservabilityMinutes = webMaxObservabilityMinutesDraft ?? webMaxObservabilityMinutes;
  const displayedSampleRate = sampleRateDraft ?? sampleRate;
  const displayedRecordingFps = recordingFpsDraft ?? recordingFpsConfirmation ?? recordingFps;
  const savedWebAllowedDomains = parseWebAllowedDomainsInput(
    formatWebAllowedDomainsInput(project.webAllowedDomains?.length ? project.webAllowedDomains : project.webDomain ? [project.webDomain] : []),
  );
  const parsedWebAllowedDomains = parseWebAllowedDomainsInput(webAllowedDomainsText);
  const webAllowedDomainsValidationError = getWebAllowedDomainsError(webAllowedDomainsText, project.platforms?.includes('web'));
  const hasWebAllowedDomainsChanges = formatWebAllowedDomainsInput(savedWebAllowedDomains) !== formatWebAllowedDomainsInput(parsedWebAllowedDomains);
  const iosBundleDraft = (project as any)._newBundleId ?? project.bundleId ?? '';
  const androidPackageDraft = (project as any)._newPackageName ?? project.packageName ?? '';
  const iosBundleError = (project as any)._newBundleId !== undefined
    ? getIosBundleIdError((project as any)._newBundleId || '')
    : null;
  const androidPackageError = (project as any)._newPackageName !== undefined
    ? getAndroidPackageError((project as any)._newPackageName || '')
    : null;
  const observabilityLabel = !rejourneyEnabled
    ? 'Paused'
    : recordingEnabled
      ? 'Recording'
      : 'Observe Only';
  const observabilityTone: ProjectSettingsTone = !rejourneyEnabled
    ? 'slate'
    : recordingEnabled
      ? 'emerald'
      : 'blue';
  const copyIcon = (field: string) => copiedField === field
    ? <Check className="h-4 w-4 text-emerald-600" />
    : <Copy className="h-4 w-4" />;
  const platformLabels: string[] = Array.isArray(project.platforms) && project.platforms.length > 0
    ? project.platforms.map((platform: string) => String(platform))
    : [];
  const platformCountLabel = platformLabels.length === 1 ? '1 platform' : `${platformLabels.length} platforms`;
  const privacyTone: ProjectSettingsTone = textInputMasking === 'all' ? 'emerald' : 'amber';
  const navItems = [
    { href: '#project-profile', label: 'Project Profile', detail: platformCountLabel, tone: 'blue' as ProjectSettingsTone, icon: <Settings className="h-4 w-4" /> },
    { href: '#sdk-intake', label: 'SDK Intake', detail: observabilityLabel, tone: observabilityTone, icon: <Shield className="h-4 w-4" /> },
    { href: '#capture-budget', label: 'Replay Quality', detail: `${displayedSampleRate}% sample`, tone: 'emerald' as ProjectSettingsTone, icon: <Percent className="h-4 w-4" /> },
    { href: '#privacy', label: 'Privacy', detail: textInputMasking === 'all' ? 'Mask all inputs' : 'Secure only', tone: privacyTone, icon: <CheckCircle className="h-4 w-4" /> },
    { href: '#developer-setup', label: 'Developer Setup', detail: isSelfHosted ? `${apiKeys.length} API keys` : 'Client keys', tone: 'slate' as ProjectSettingsTone, icon: <Key className="h-4 w-4" /> },
    ...(canEdit ? [{ href: '#danger-zone', label: 'Danger Zone', detail: 'Protected action', tone: 'rose' as ProjectSettingsTone, icon: <AlertOctagon className="h-4 w-4" /> }] : []),
  ];

  return (
    <SettingsLayout
      className="rejourney-settings-page rejourney-project-settings-page"
      title="Project Settings"
      description={`Configure ${project.name}`}
      icon={<Settings className="w-6 h-6" />}
      iconColor="bg-[#f4f4f5]"
      headerAction={!canEdit ? <NeoBadge variant="warning">View Only</NeoBadge> : undefined}
    >
      <div className="project-settings-console grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="project-settings-rail dashboard-surface p-4">
          <div className="border-b border-slate-100 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Project Map</p>
            <h2 className="mt-2 truncate text-lg font-semibold text-slate-950">{project.name}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill label={observabilityLabel} tone={observabilityTone} />
              <StatusPill label={platformCountLabel} tone="slate" />
            </div>
          </div>

          <nav className="mt-3 space-y-1" aria-label="Project settings sections">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="project-settings-rail-item">
                <span className={`project-settings-rail-icon ${PROJECT_SETTINGS_TONES[item.tone].icon}`}>{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{item.label}</span>
                  <span className="block truncate text-xs font-medium text-slate-500">{item.detail}</span>
                </span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          <SettingsSection
            id="project-profile"
            title="Project Profile"
            description="The human name and client app identifiers Rejourney uses to accept sessions."
            icon={<Settings className="h-5 w-5" />}
            tone="blue"
            action={<StatusPill label={platformCountLabel} tone="slate" />}
          >
            <SettingRow
              title="Project name"
              description="Shown throughout the dashboard, alerts, and project switcher."
              icon={<Settings className="h-4 w-4" />}
            >
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <Input
                  label="Name"
                  value={appName}
                  onChange={(e) => {
                    setAppName(e.target.value);
                    setSaveError(null);
                  }}
                  disabled={!canEdit}
                  className="font-mono font-semibold"
                />
                <NeoButton
                  variant="primary"
                  onClick={handleSaveName}
                  disabled={!canEdit || isSaving || !appName || appName === project.name}
                  leftIcon={<Save className="h-4 w-4" />}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </NeoButton>
              </div>
              {saveError && (
                <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600">
                  <AlertTriangle className="h-4 w-4" /> {saveError}
                </p>
              )}
            </SettingRow>

            <SettingRow
              title="App identifiers"
              description="Keep these aligned with the apps that send sessions to this project."
              icon={<Smartphone className="h-4 w-4" />}
            >
              <div className="mb-3 flex flex-wrap gap-2">
                {platformLabels.length > 0 ? platformLabels.map((platform) => (
                  <span key={platform} className="project-settings-platform-pill">
                    {platform === 'web' ? <Globe className="h-3.5 w-3.5" /> : platform === 'ios' ? <Smartphone className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                    {platform}
                  </span>
                )) : <span className="text-xs font-semibold text-slate-400">No platforms configured</span>}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="project-settings-field-card dashboard-inner-surface bg-white p-4">
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Smartphone className="h-4 w-4" />
                    iOS Bundle ID
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      placeholder="com.example.app"
                      value={iosBundleDraft}
                      onChange={(e) => setProject({ ...project, _newBundleId: e.target.value })}
                      disabled={!canEdit}
                      className="flex-1 font-mono text-sm font-semibold"
                    />
                    <NeoButton
                      variant="primary"
                      size="sm"
                      disabled={
                        !canEdit ||
                        !iosBundleDraft ||
                        (project as any)._newBundleId === undefined ||
                        iosBundleDraft === project.bundleId ||
                        !!iosBundleError
                      }
                      onClick={async () => {
                        try {
                          const value = iosBundleDraft;
                          await updateProject(project.id, { bundleId: value });
                          await refreshSessions();
                          setProject({ ...project, bundleId: value, _newBundleId: undefined });
                        } catch (err) {
                          alert(err instanceof Error ? err.message : 'Failed to save');
                        }
                      }}
                    >
                      <Save className="h-4 w-4" /> Save
                    </NeoButton>
                  </div>
                  {iosBundleError && (
                    <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600">
                      <AlertTriangle className="h-3 w-3" /> {iosBundleError}
                    </p>
                  )}
                </div>

                <div className="project-settings-field-card dashboard-inner-surface bg-white p-4">
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Shield className="h-4 w-4" />
                    Android Package Name
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      placeholder="com.example.app"
                      value={androidPackageDraft}
                      onChange={(e) => setProject({ ...project, _newPackageName: e.target.value })}
                      disabled={!canEdit}
                      className="flex-1 font-mono text-sm font-semibold"
                    />
                    <NeoButton
                      variant="primary"
                      size="sm"
                      disabled={
                        !canEdit ||
                        !androidPackageDraft ||
                        (project as any)._newPackageName === undefined ||
                        androidPackageDraft === project.packageName ||
                        !!androidPackageError
                      }
                      onClick={async () => {
                        try {
                          const value = androidPackageDraft;
                          await updateProject(project.id, { packageName: value });
                          await refreshSessions();
                          setProject({ ...project, packageName: value, _newPackageName: undefined });
                        } catch (err) {
                          alert(err instanceof Error ? err.message : 'Failed to save');
                        }
                      }}
                    >
                      <Save className="h-4 w-4" /> Save
                    </NeoButton>
                  </div>
                  {androidPackageError && (
                    <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600">
                      <AlertTriangle className="h-3 w-3" /> {androidPackageError}
                    </p>
                  )}
                </div>
              </div>
            </SettingRow>

            <SettingRow
              title="Web allowed domains"
              description="Browser origins that can authenticate with the shared project key."
              icon={<Globe className="h-4 w-4" />}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <StatusPill label={`${parsedWebAllowedDomains.length} domains`} tone="slate" />
                  <InfoTooltip
                    label="i"
                    align="left"
                    content="Web SDK only. Browser origins must match this list before a web session can authenticate."
                  />
                </div>
                <NeoButton
                  variant="primary"
                  size="sm"
                  disabled={!canEdit || isSavingWebDomains || !hasWebAllowedDomainsChanges || !!webAllowedDomainsValidationError}
                  onClick={handleSaveWebAllowedDomains}
                  leftIcon={<Save className="h-4 w-4" />}
                >
                  {isSavingWebDomains ? 'Saving...' : 'Save'}
                </NeoButton>
              </div>
              <textarea
                placeholder="app.example.com, www.example.com, *.example.com"
                value={webAllowedDomainsText}
                onChange={(e) => {
                  setWebAllowedDomainsText(e.target.value);
                  setWebDomainsSaveError(null);
                }}
                rows={3}
                disabled={!canEdit}
                className="min-h-[88px] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
              />
              {(webDomainsSaveError || webAllowedDomainsValidationError) && (
                <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600">
                  <AlertTriangle className="h-3 w-3" /> {webDomainsSaveError || webAllowedDomainsValidationError}
                </p>
              )}
            </SettingRow>
          </SettingsSection>

          <SettingsSection
            id="sdk-intake"
            title="SDK Intake"
            description="Gate incoming data before it becomes replay, analytics, and diagnostics."
            icon={<Shield className="h-5 w-5" />}
            tone={observabilityTone}
            action={<StatusPill label={observabilityLabel} tone={observabilityTone} />}
          >
            <SettingRow
              title="SDK collection"
              description="Master project switch for new events and diagnostics."
              icon={<Shield className="h-4 w-4" />}
            >
              <div className="project-settings-toggle-card dashboard-inner-surface flex items-center justify-between gap-4 bg-white p-4">
                <div className="min-w-0">
                  <StatusPill label={isSavingRejourney ? 'Saving' : rejourneyEnabled ? 'Active' : 'Disabled'} tone={rejourneyEnabled ? 'emerald' : 'slate'} />
                  {rejourneySaveError && <p className="mt-2 text-xs font-semibold text-red-600">{rejourneySaveError}</p>}
                </div>
                <SwitchControl
                  checked={rejourneyEnabled}
                  onChange={handleToggleRejourney}
                  disabled={!canEdit || isSavingRejourney}
                  label="Toggle SDK collection"
                />
              </div>
            </SettingRow>

            <SettingRow
              title="Session replay"
              description="Controls whether captured sessions include replay media."
              icon={<MonitorSmartphone className="h-4 w-4" />}
            >
              <div className="project-settings-toggle-card dashboard-inner-surface flex items-center justify-between gap-4 bg-white p-4">
                <div className="min-w-0">
                  <StatusPill
                    label={isSavingRecording ? 'Saving' : recordingEnabled && rejourneyEnabled ? 'Capturing' : 'Observe only'}
                    tone={recordingEnabled && rejourneyEnabled ? 'emerald' : 'slate'}
                  />
                  {!rejourneyEnabled && <p className="mt-2 text-xs font-semibold text-slate-400">Requires SDK collection.</p>}
                  {recordingSaveError && <p className="mt-2 text-xs font-semibold text-red-600">{recordingSaveError}</p>}
                </div>
                <SwitchControl
                  checked={recordingEnabled}
                  onChange={handleToggleRecording}
                  disabled={!canEdit || isSavingRecording || !rejourneyEnabled}
                  label="Toggle session replay"
                />
              </div>
            </SettingRow>
          </SettingsSection>

          <SettingsSection
            id="capture-budget"
            title="Replay Quality"
            description="Set capture length, sample volume, and mobile frame rate without hunting through separate panels."
            icon={<Percent className="h-5 w-5" />}
            tone="emerald"
          >
            <SettingRow
              title="Capture budgets"
              description="Balanced defaults keep replays useful while limiting device and storage cost."
              icon={<MonitorSmartphone className="h-4 w-4" />}
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <RangeSetting
                  label="Mobile replay length"
                  value={displayedMaxRecordingMinutes}
                  unit=" min"
                  min={1}
                  max={10}
                  disabled={!canEdit || isSavingDuration}
                  saveState={isSavingDuration ? 'Saving...' : null}
                  error={durationSaveError}
                  tooltip={<InfoTooltip label="i" align="left" content="Mobile SDKs only. Caps iOS and Android screenshot replay capture." />}
                  onDraftChange={handleMaxRecordingMinutesDraftChange}
                  onCommit={() => void commitMaxRecordingMinutesDraft()}
                />
                <RangeSetting
                  label="Web observability length"
                  value={displayedWebMaxObservabilityMinutes}
                  unit=" min"
                  min={1}
                  max={30}
                  disabled={!canEdit || isSavingWebDuration}
                  saveState={isSavingWebDuration ? 'Saving...' : null}
                  error={webDurationSaveError}
                  tooltip={<InfoTooltip label="i" align="left" content="Web SDK only. Caps browser DOM/event replay and web session observability." />}
                  onDraftChange={handleWebMaxObservabilityMinutesDraftChange}
                  onCommit={() => void commitWebMaxObservabilityMinutesDraft()}
                />
                <RangeSetting
                  label="Session sample rate"
                  value={displayedSampleRate}
                  unit="%"
                  min={0}
                  max={100}
                  disabled={!canEdit || isSavingSampleRate}
                  saveState={isSavingSampleRate ? 'Saving...' : null}
                  error={sampleRateSaveError}
                  tooltip={<InfoTooltip label="i" align="left" content="Applies to both web and mobile SDK sessions." />}
                  onDraftChange={handleSampleRateDraftChange}
                  onCommit={() => void commitSampleRateDraft()}
                />
                <RangeSetting
                  label="Mobile recording FPS"
                  value={displayedRecordingFps}
                  unit=" fps"
                  min={1}
                  max={3}
                  disabled={!canEdit || isSavingRecordingFps || Boolean(recordingFpsConfirmation)}
                  saveState={isSavingRecordingFps ? 'Saving...' : null}
                  error={recordingFpsSaveError}
                  tooltip={<InfoTooltip label="i" align="left" content="Mobile SDKs only. Controls screenshot capture frequency for iOS and Android replay." />}
                  onDraftChange={(value) => handleRecordingFpsDraftChange(normalizeRecordingFps(value))}
                  onCommit={() => void commitRecordingFpsDraft()}
                />
              </div>
            </SettingRow>
          </SettingsSection>

          <SettingsSection
            id="privacy"
            title="Privacy"
            description="Choose the default masking posture for text fields in replay."
            icon={<CheckCircle className="h-5 w-5" />}
            tone={privacyTone}
            action={<StatusPill label={isSavingMasking ? 'Saving' : textInputMasking === 'all' ? 'Privacy first' : 'Debug detail'} tone={privacyTone} />}
          >
            <SettingRow
              title="Text input masking"
              description="Use stricter masking for sensitive projects, or expose non-secure fields when debugging needs it."
              icon={<Shield className="h-4 w-4" />}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={textInputMasking === 'all'}
                  onClick={() => handleTextInputMaskingChange('all')}
                  disabled={!canEdit || isSavingMasking}
                  className={`settings-option-card text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${textInputMasking === 'all' ? 'dashboard-inner-surface border-emerald-300 bg-emerald-50 p-4' : 'dashboard-inner-surface bg-white p-4 hover:border-slate-300'}`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">Mask All Inputs</span>
                    {textInputMasking === 'all' && <CheckCircle className="h-4 w-4 text-emerald-700" />}
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-24 max-w-full rounded bg-slate-900" />
                    <div className="h-3 w-36 max-w-full rounded bg-slate-900" />
                  </div>
                </button>
                <button
                  type="button"
                  aria-pressed={textInputMasking === 'secure_only'}
                  onClick={() => handleTextInputMaskingChange('secure_only')}
                  disabled={!canEdit || isSavingMasking}
                  className={`settings-option-card text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${textInputMasking === 'secure_only' ? 'dashboard-inner-surface border-amber-300 bg-amber-50 p-4' : 'dashboard-inner-surface bg-white p-4 hover:border-slate-300'}`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">Secure Fields Only</span>
                    {textInputMasking === 'secure_only' && <CheckCircle className="h-4 w-4 text-amber-700" />}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded border border-slate-200 bg-white p-2">
                      <div className="mb-1 text-xs font-medium text-slate-400">Name</div>
                      <div className="truncate font-mono text-xs font-bold text-slate-800">Alex Morgan</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-white p-2">
                      <div className="mb-1 text-xs font-medium text-slate-400">Password</div>
                      <div className="h-3 w-24 max-w-full rounded bg-slate-900" />
                    </div>
                  </div>
                </button>
              </div>
              {maskingSaveError && (
                <p className="mt-3 flex items-center gap-1 text-xs font-semibold text-red-600">
                  <AlertTriangle className="h-3 w-3" /> {maskingSaveError}
                </p>
              )}
            </SettingRow>
          </SettingsSection>

          <SettingsSection
            id="developer-setup"
            title="Developer Setup"
            description="The stable identifiers needed by SDK setup, support, and backend integrations."
            icon={<Key className="h-5 w-5" />}
            tone="slate"
          >
            <SettingRow
              title="Client identifiers"
              description="Project ID and public key are safe to use in client SDK configuration."
              icon={<Key className="h-4 w-4" />}
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Key className="h-3 w-3" /> Project ID
                  </div>
                  <div className="project-settings-code-row dashboard-inner-surface flex items-center gap-2 bg-white px-3 py-2">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs font-semibold text-slate-900">{project.id}</code>
                    <button
                      type="button"
                      onClick={() => handleCopy(project.id, 'projectId')}
                      className="project-settings-copy-button"
                      title="Copy Project ID"
                      aria-label="Copy Project ID"
                    >
                      {copyIcon('projectId')}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Shield className="h-3 w-3" /> Public Key
                  </div>
                  <div className="project-settings-code-row dashboard-inner-surface flex items-center gap-2 bg-white px-3 py-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-slate-900">{project.publicKey}</code>
                    <button
                      type="button"
                      onClick={() => handleCopy(project.publicKey, 'publicKey')}
                      className="project-settings-copy-button"
                      title="Copy Public Key"
                      aria-label="Copy Public Key"
                    >
                      {copyIcon('publicKey')}
                    </button>
                  </div>
                </div>
              </div>
            </SettingRow>

            {isSelfHosted && (
              <SettingRow
                title="API keys"
                description="Secret keys for backend administrative access in self-hosted deployments."
                icon={<Shield className="h-4 w-4" />}
              >
                <div className="project-settings-api-keys">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <StatusPill label={`${apiKeys.length} active`} tone={apiKeys.length > 0 ? 'emerald' : 'slate'} />
                    <NeoButton
                      size="sm"
                      variant="secondary"
                      disabled={!canEdit}
                      onClick={() => { setShowCreateKeyModal(true); setCreatedApiKey(null); }}
                      leftIcon={<Plus className="h-4 w-4" />}
                    >
                      Create
                    </NeoButton>
                  </div>
                  {keyError && (
                    <p className="mb-3 flex items-center gap-1 text-xs font-semibold text-red-600">
                      <AlertTriangle className="h-3 w-3" /> {keyError}
                    </p>
                  )}
                  {isLoadingKeys ? (
                    <div className="dashboard-inner-surface py-6 text-center text-sm font-semibold text-slate-500 animate-pulse">Loading keys...</div>
                  ) : apiKeys.length === 0 ? (
                    <div className="dashboard-inner-surface border-dashed py-8 text-center">
                      <Key className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                      <p className="text-xs font-semibold text-slate-500">No API keys created yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {apiKeys.map((key) => (
                        <div key={key.id} className="dashboard-inner-surface flex items-center justify-between gap-3 p-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-mono text-sm font-semibold text-slate-900">{key.truncatedKey}</span>
                              <NeoBadge variant="success" size="sm">Active</NeoBadge>
                            </div>
                            <div className="mt-1 text-xs font-medium text-slate-400">
                              Created {new Date(key.createdAt).toLocaleDateString()}
                              {key.lastUsedAt && ` / Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                            </div>
                          </div>
                          <NeoButton
                            variant="ghost"
                            size="sm"
                            disabled={!canEdit}
                            className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => handleRevokeApiKey(key.id)}
                          >
                            Revoke
                          </NeoButton>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </SettingRow>
            )}
          </SettingsSection>

          {canEdit && (
            <SettingsSection
              id="danger-zone"
              title="Danger Zone"
              description="Permanent project deletion lives alone so it is visible but never mixed with routine setup."
              icon={<AlertOctagon className="h-5 w-5" />}
              tone="rose"
              action={<StatusPill label="Irreversible" tone="rose" />}
            >
              <SettingRow
                title="Delete project"
                description="All recordings, analytics, and project data will be permanently removed."
                icon={<Trash2 className="h-4 w-4" />}
              >
                <div className="dashboard-inner-surface flex flex-col justify-between gap-4 border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center">
                  <p className="text-sm font-medium text-rose-700">Requires the project name and email verification code.</p>
                  <NeoButton
                    variant="danger"
                    onClick={() => setShowDeleteModal(true)}
                    leftIcon={<Trash2 className="h-4 w-4" />}
                    className="shrink-0"
                  >
                    Delete Project
                  </NeoButton>
                </div>
              </SettingRow>
            </SettingsSection>
          )}
        </div>
      </div>

      {/* Recording FPS Confirmation Modal */}
        <Modal
          isOpen={recordingFpsConfirmation !== null}
          onClose={handleCancelRecordingFpsChange}
          title="Confirm Recording FPS"
          footer={
            <div className="flex gap-2">
              <NeoButton
                variant="secondary"
                onClick={handleCancelRecordingFpsChange}
                disabled={isSavingRecordingFps}
              >
                Cancel
              </NeoButton>
              <NeoButton
                variant="primary"
                onClick={handleConfirmRecordingFpsChange}
                disabled={isSavingRecordingFps}
              >
                {isSavingRecordingFps ? 'Saving...' : 'OK'}
              </NeoButton>
            </div>
          }
        >
          <div className="space-y-4 py-2">
            <div className="flex gap-3 border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-2 text-sm font-bold">
                <p>
                  Increasing capture FPS may result in performance issues and higher battery usage.
                </p>
                <p>
                  The safest and most tested setting is 1 FPS. If 1 FPS looks good, it is highly recommended to not change it.
                </p>
              </div>
            </div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Change recording from {recordingFps} FPS to {recordingFpsConfirmation ?? recordingFps} FPS?
            </p>
          </div>
        </Modal>

        {/* Create Key Modal */}
        <Modal
          isOpen={showCreateKeyModal}
          onClose={() => {
            setShowCreateKeyModal(false);
            setCreatedApiKey(null);
          }}
          title="Create API Key"
          footer={
            createdApiKey ? (
              <NeoButton onClick={() => setShowCreateKeyModal(false)}>Done</NeoButton>
            ) : (
              <div className="flex gap-2">
                <NeoButton variant="secondary" onClick={() => setShowCreateKeyModal(false)}>Cancel</NeoButton>
                <NeoButton onClick={handleCreateApiKey} disabled={isCreatingKey} variant="primary">
                  {isCreatingKey ? 'Creating...' : 'Create Key'}
                </NeoButton>
              </div>
            )
          }
        >
          {createdApiKey ? (
            <div className="space-y-4">
              <div className="bg-green-50 text-green-700 p-3 rounded-md border border-green-200 flex items-start gap-2 text-sm font-bold">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <strong>KEY CREATED!</strong> Securely store this key now. It will not be shown again.
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 uppercase">API Key</label>
                <div className="flex gap-2">
                  <code className="flex-1 p-3 bg-slate-900 text-white rounded font-mono break-all text-xs">
                    {createdApiKey.key}
                  </code>
                  <NeoButton
                    variant="secondary"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(createdApiKey.key)}
                  >
                    <Copy className="w-4 h-4" />
                  </NeoButton>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <p className="text-slate-600 text-sm font-medium">
                This will create a new API key with full access scopes for the <strong>{project.name}</strong> project.
              </p>
              <div className="bg-rose-50 text-rose-800 p-3 rounded-md border border-rose-200 text-xs flex gap-2 font-bold">
                <Shield className="w-4 h-4 shrink-0" />
                Usually you only need the Public Key for client-side recording. Secret API keys are for backend administrative access.
              </div>
            </div>
          )}
        </Modal>

        {/* Delete Modal */}
        <Modal
          isOpen={showDeleteModal}
          onClose={() => {
            setShowDeleteModal(false);
            setDeleteConfirmText('');
            setDeleteOtpCode('');
            setDeleteOtpSent(false);
            setDeleteOtpMessage(null);
            setDeleteError(null);
          }}
          title="Delete Project"
          footer={
            <div className="flex gap-2">
              <NeoButton variant="secondary" onClick={() => {
                setShowDeleteModal(false);
                setDeleteConfirmText('');
                setDeleteOtpCode('');
                setDeleteOtpSent(false);
                setDeleteOtpMessage(null);
                setDeleteError(null);
              }}>Cancel</NeoButton>
              <NeoButton
                variant="danger"
                onClick={handleDelete}
                disabled={isDeleting || deleteConfirmText !== project.name || !deleteOtpCode.trim()}
              >
                {isDeleting ? 'Deleting...' : 'Permanently Delete'}
              </NeoButton>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex gap-2 text-red-800 font-semibold mb-2 items-center">
                <AlertTriangle className="w-5 h-5" /> Warning: Final Confirmation
              </div>
              <p className="text-red-700 text-sm">
                This action will permanently purge <strong>{project.name}</strong> from the database. All recordings, analytics, funnel data, and user sessions will be immediately destroyed. This action <strong>cannot</strong> be undone.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Type <strong className="font-mono">{project.name}</strong> to confirm:
              </label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => {
                  setDeleteConfirmText(e.target.value);
                  setDeleteError(null);
                }}
                placeholder={project.name}
                className="border-red-200 focus:ring-red-500 focus:border-red-500"
              />
            </div>

            <div className="space-y-2">
              <NeoButton
                variant="secondary"
                onClick={handleSendDeleteOtp}
                disabled={isSendingDeleteOtp || deleteConfirmText !== project.name}
                className="w-full"
              >
                {isSendingDeleteOtp ? 'Sending OTP...' : deleteOtpSent ? 'Resend OTP' : 'Send OTP to Email'}
              </NeoButton>
              {deleteOtpMessage && (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 p-2 rounded">{deleteOtpMessage}</p>
              )}
            </div>

            {deleteOtpSent && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Enter OTP code:</label>
                <Input
                  value={deleteOtpCode}
                  onChange={(e) => {
                    setDeleteOtpCode(e.target.value);
                    setDeleteError(null);
                  }}
                  placeholder="XXXXXXXXXX"
                  maxLength={10}
                  className="border-red-200 focus:ring-red-500 focus:border-red-500 font-mono tracking-widest"
                />
              </div>
            )}

            {deleteError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-2 rounded">{deleteError}</div>
            )}
          </div>
        </Modal>
    </SettingsLayout>
  );
};

export default ProjectSettings;
