import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { useSessionData } from '../../context/SessionContext';
import { useTeam } from '../../context/TeamContext';
import { useAuth } from '../../context/AuthContext';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Copy, Plus, Trash2, Key, AlertTriangle, CheckCircle, Shield, Info, Check, Settings, Save, AlertOctagon, Smartphone, Clock } from 'lucide-react';
import { getAndroidPackageError, getIosBundleIdError } from '../../utils/validation';
import {
  getProject,
  updateProject,
  deleteProject,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  ApiKey,
  CreatedApiKey
} from '../../services/api';

const isSelfHosted = import.meta.env.VITE_SELF_HOSTED === 'true';

interface SettingsProps {
  projectId?: string;
}

export const ProjectSettings: React.FC<SettingsProps> = ({ projectId: propProjectId }) => {
  const { projects, refreshSessions, selectedProject } = useSessionData();
  const { currentTeam, teamMembers } = useTeam();
  const { user } = useAuth();
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
  const [rejourneyEnabled, setRejourneyEnabled] = useState<boolean>(true);
  const [recordingEnabled, setRecordingEnabled] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingDuration, setIsSavingDuration] = useState(false);
  const [isSavingRejourney, setIsSavingRejourney] = useState(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [durationSaveError, setDurationSaveError] = useState<string | null>(null);
  const [rejourneySaveError, setRejourneySaveError] = useState<string | null>(null);
  const [recordingSaveError, setRecordingSaveError] = useState<string | null>(null);

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
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Copy state
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
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

        // Try to find in context first
        const contextProject = projects.find(a => a.id === projectId);
        if (contextProject) {
          setProject(contextProject);
          setAppName(contextProject.name);
          setMaxRecordingMinutes(contextProject.maxRecordingMinutes ?? 10);
          setRejourneyEnabled((contextProject as any).rejourneyEnabled ?? true);
          setRecordingEnabled(contextProject.recordingEnabled ?? true);
          setLoading(false);
          return;
        }

        // Only fetch from API if projects are loaded but project not found in context
        // This prevents fetching while context is still loading
        if (projects.length > 0 || projectId) {
          const fetchedProject = await getProject(projectId);
          setProject(fetchedProject);
          setAppName(fetchedProject.name);
          setMaxRecordingMinutes(fetchedProject.maxRecordingMinutes ?? 10);
          setRejourneyEnabled((fetchedProject as any).rejourneyEnabled ?? true);
          setRecordingEnabled(fetchedProject.recordingEnabled ?? true);
        }
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

  const handleSaveDuration = async () => {
    if (!project) {
      setDurationSaveError('Project not loaded');
      return;
    }
    const clamped = Math.min(10, Math.max(1, maxRecordingMinutes || 0));
    if (clamped !== maxRecordingMinutes) {
      setMaxRecordingMinutes(clamped);
    }
    if (clamped === project.maxRecordingMinutes) {
      return;
    }
    try {
      setIsSavingDuration(true);
      setDurationSaveError(null);
      await updateProject(project.id, { maxRecordingMinutes: clamped });
      await refreshSessions();
      setProject({ ...project, maxRecordingMinutes: clamped });
    } catch (err) {
      setDurationSaveError(err instanceof Error ? err.message : 'Failed to update max recording duration');
    } finally {
      setIsSavingDuration(false);
    }
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

  const handleDelete = async () => {
    if (deleteConfirmText !== project?.name) {
      setDeleteError('Project name does not match');
      return;
    }

    try {
      setIsDeleting(true);
      setDeleteError(null);

      await deleteProject(project.id, { confirmText: deleteConfirmText, otpCode: '' });

      // Refresh projects list
      await refreshSessions();

      // Navigate to general page (default dashboard view)
      navigate(`${pathPrefix}/general`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-slate-200 border-t-slate-800 rounded-full"></div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <NeoCard className="p-6 border-rose-600 bg-rose-50">
          <div className="flex gap-4 items-center">
            <AlertTriangle className="text-rose-600 w-6 h-6" />
            <div>
              <h3 className="text-rose-900 font-semibold uppercase tracking-tight">Error Loading Project</h3>
              <p className="text-rose-700 text-sm font-bold mt-1">{error || 'Project not found'}</p>
            </div>
          </div>
        </NeoCard>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans text-slate-900 bg-transparent">
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-6 flex-1">
            <h1 className="text-3xl font-semibold uppercase tracking-tighter flex items-center gap-3">
              <Settings className="w-8 h-8" /> Project Settings
            </h1>
            <div className="h-8 w-[2px] bg-slate-900 hidden md:block"></div>
            <div className="hidden md:block">
              <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest">
                Configure {project.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {!canEdit && (
              <NeoBadge variant="warning">View Only</NeoBadge>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 md:p-8 space-y-12 max-w-[1600px] mx-auto w-full">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Main Settings */}
          <div className="lg:col-span-2 space-y-6">

            {/* General Section */}
            <section className="space-y-4">
              <h2 className="text-xl font-semibold uppercase tracking-tight">General Information</h2>
              <NeoCard className="p-6">
                <div className="space-y-4">
                  <div className="flex gap-4 items-end">
                    <div className="flex-1">
                      <Input
                        label="Project Name"
                        value={appName}
                        onChange={(e) => {
                          setAppName(e.target.value);
                          setSaveError(null);
                        }}
                        disabled={!canEdit}
                        className="font-mono font-bold"
                      />
                    </div>
                    {canEdit && (
                      <NeoButton
                        variant="primary"
                        onClick={handleSaveName}
                        disabled={isSaving || !appName || appName === project.name}
                        leftIcon={<Save className="w-4 h-4" />}
                      >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                      </NeoButton>
                    )}
                  </div>
                  {saveError && (
                    <p className="text-xs font-bold text-red-600 flex items-center gap-1 uppercase tracking-wide">
                      <AlertTriangle className="w-4 h-4" /> {saveError}
                    </p>
                  )}
                </div>
              </NeoCard>
            </section>

            {/* App Identifiers - MOVED TO TOP */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold uppercase tracking-tight">App Identifiers</h2>
                {(!project.bundleId || !project.packageName) && canEdit && (
                  <NeoBadge variant="warning" size="md">
                    Action Required
                  </NeoBadge>
                )}
              </div>
              <NeoCard className="p-6">
                <div className="space-y-6">
                  {/* iOS Bundle ID */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                        <Smartphone className="w-4 h-4" />
                        iOS Bundle ID
                      </label>
                      {project.bundleId && (
                        <NeoBadge variant="success" size="sm">
                          <Check className="w-3 h-3 mr-1" /> Configured
                        </NeoBadge>
                      )}
                    </div>
                    {project.bundleId ? (
                      <div className="bg-slate-50 border-2 border-slate-900 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono text-sm font-bold text-slate-900 break-all flex-1">
                            {project.bundleId}
                          </div>
                          <NeoBadge variant="neutral" size="sm">LOCKED</NeoBadge>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-2">
                          Bundle ID is locked and cannot be changed
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-amber-50 border-2 border-amber-600 p-4">
                          <div className="flex items-start gap-2 mb-3">
                            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                            <p className="text-xs font-bold text-amber-900 uppercase tracking-wide flex-1">
                              Bundle ID Required: Add your iOS bundle identifier to enable SDK integration
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Input
                              placeholder="com.example.app"
                              value={(project as any)._newBundleId || ''}
                              onChange={(e) => setProject({ ...project, _newBundleId: e.target.value })}
                              disabled={!canEdit}
                              className="font-mono text-sm font-bold flex-1 border border-slate-100/80"
                            />
                            <NeoButton
                              variant="primary"
                              size="md"
                              disabled={!canEdit || !(project as any)._newBundleId || !!getIosBundleIdError((project as any)._newBundleId || '')}
                              onClick={async () => {
                                try {
                                  await updateProject(project.id, { bundleId: (project as any)._newBundleId });
                                  await refreshSessions();
                                  setProject({ ...project, bundleId: (project as any)._newBundleId, _newBundleId: undefined });
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : 'Failed to save');
                                }
                              }}
                            >
                              <Save className="w-4 h-4 mr-1" /> Save Bundle ID
                            </NeoButton>
                          </div>
                          {getIosBundleIdError((project as any)._newBundleId || '') && (
                            <p className="text-xs font-bold text-red-600 flex items-center gap-1 mt-2 uppercase">
                              <AlertTriangle className="w-3 h-3" /> {getIosBundleIdError((project as any)._newBundleId || '')}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="h-[2px] bg-slate-200"></div>

                  {/* Android Package Name */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        Android Package Name
                      </label>
                      {project.packageName && (
                        <NeoBadge variant="success" size="sm">
                          <Check className="w-3 h-3 mr-1" /> Configured
                        </NeoBadge>
                      )}
                    </div>
                    {project.packageName ? (
                      <div className="bg-slate-50 border-2 border-slate-900 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono text-sm font-bold text-slate-900 break-all flex-1">
                            {project.packageName}
                          </div>
                          <NeoBadge variant="neutral" size="sm">LOCKED</NeoBadge>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-2">
                          Package name is locked and cannot be changed
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-amber-50 border-2 border-amber-600 p-4">
                          <div className="flex items-start gap-2 mb-3">
                            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                            <p className="text-xs font-bold text-amber-900 uppercase tracking-wide flex-1">
                              Package Name Required: Add your Android package name to enable SDK integration
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Input
                              placeholder="com.example.android"
                              value={(project as any)._newPackageName || ''}
                              onChange={(e) => setProject({ ...project, _newPackageName: e.target.value })}
                              disabled={!canEdit}
                              className="font-mono text-sm font-bold flex-1 border border-slate-100/80"
                            />
                            <NeoButton
                              variant="primary"
                              size="md"
                              disabled={!canEdit || !(project as any)._newPackageName || !!getAndroidPackageError((project as any)._newPackageName || '')}
                              onClick={async () => {
                                try {
                                  await updateProject(project.id, { packageName: (project as any)._newPackageName });
                                  await refreshSessions();
                                  setProject({ ...project, packageName: (project as any)._newPackageName, _newPackageName: undefined });
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : 'Failed to save');
                                }
                              }}
                            >
                              <Save className="w-4 h-4 mr-1" /> Save Package Name
                            </NeoButton>
                          </div>
                          {getAndroidPackageError((project as any)._newPackageName || '') && (
                            <p className="text-xs font-bold text-red-600 flex items-center gap-1 mt-2 uppercase">
                              <AlertTriangle className="w-3 h-3" /> {getAndroidPackageError((project as any)._newPackageName || '')}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </NeoCard>
            </section>

            {/* Recording Status */}
            <section className="space-y-4">
              <h2 className="text-xl font-semibold uppercase tracking-tight">Observability</h2>

              <NeoCard className="p-6">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold uppercase">Rejourney Status</h3>
                      <NeoBadge variant={rejourneyEnabled ? 'success' : 'neutral'}>
                        {rejourneyEnabled ? 'Active' : 'Disabled'}
                      </NeoBadge>
                    </div>
                    <p className="text-sm text-slate-600 mb-4 font-medium">
                      {rejourneyEnabled
                        ? 'Rejourney is enabled. The SDK will collect observability analytics for this project.'
                        : 'Rejourney is disabled. The SDK will not initialize or send any data for this project.'}
                    </p>
                    {!rejourneyEnabled && (
                      <div className="bg-amber-50 text-amber-800 text-[10px] font-bold uppercase p-2 border border-amber-200 inline-flex items-center gap-1 tracking-wide">
                        <Info className="w-3 h-3" /> Observability minutes will not be counted.
                      </div>
                    )}
                    {rejourneySaveError && (
                      <p className="text-xs text-red-600 mt-2 font-bold uppercase">{rejourneySaveError}</p>
                    )}
                  </div>
                  {canEdit && (
                    <NeoButton
                      variant={rejourneyEnabled ? 'danger' : 'primary'}
                      onClick={() => handleToggleRejourney(!rejourneyEnabled)}
                      disabled={isSavingRejourney}
                      size="sm"
                    >
                      {rejourneyEnabled ? 'Disable Rejourney' : 'Enable Rejourney'}
                    </NeoButton>
                  )}
                </div>
              </NeoCard>

              <NeoCard className="p-6 mt-4">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold uppercase">Session Replay Recording</h3>
                      <NeoBadge variant={recordingEnabled ? 'success' : 'neutral'}>
                        {recordingEnabled ? 'Active' : 'Disabled'}
                      </NeoBadge>
                    </div>
                    <p className="text-sm text-slate-600 mb-4 font-medium">
                      {recordingEnabled
                        ? 'Session replays will be captured and uploaded for this project.'
                        : 'Recording is disabled. Replays will not be captured.'}
                    </p>
                    {!recordingEnabled && (
                      <div className="bg-amber-50 text-amber-800 text-[10px] font-bold uppercase p-2 border border-amber-200 inline-flex items-center gap-1 tracking-wide">
                        <Info className="w-3 h-3" /> Replays unavailable.
                      </div>
                    )}
                    {!rejourneyEnabled && (
                      <div className="bg-slate-50 text-slate-700 text-[10px] font-bold uppercase p-2 border border-slate-200 inline-flex items-center gap-1 mt-2 tracking-wide ml-2">
                        <Info className="w-3 h-3" /> Disabled via Rejourney.
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <NeoButton
                      variant={recordingEnabled ? "danger" : "primary"}
                      onClick={() => handleToggleRecording(!recordingEnabled)}
                      disabled={isSavingRecording || !rejourneyEnabled}
                      size="sm"
                    >
                      {recordingEnabled ? 'Disable Recording' : 'Enable Recording'}
                    </NeoButton>
                  )}
                </div>
              </NeoCard>
            </section>

            {/* API Keys Section (Self Hosted Only) */}
            {isSelfHosted && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold uppercase tracking-tight">API Keys</h2>
                  {canEdit && (
                    <NeoButton size="sm" variant="secondary" onClick={() => { setShowCreateKeyModal(true); setCreatedApiKey(null); }}>
                      <Plus className="w-4 h-4" /> Create Key
                    </NeoButton>
                  )}
                </div>
                <NeoCard className="p-6">
                  <div className="space-y-4">
                    {isLoadingKeys ? (
                      <div className="text-center py-4 text-slate-500 text-sm font-bold uppercase animate-pulse">Loading keys...</div>
                    ) : apiKeys.length === 0 ? (
                      <div className="text-center py-8 bg-slate-50 border-2 border-dashed border-slate-900">
                        <Key className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">No API keys created yet</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {apiKeys.map((key) => (
                          <div key={key.id} className="flex items-center justify-between p-4 bg-slate-50 border-2 border-slate-900 hover:border-slate-700 transition-colors">
                            <div>
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-bold text-slate-900">{key.truncatedKey}</span>
                                <NeoBadge variant="success" size="sm">Active</NeoBadge>
                              </div>
                              <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wide">
                                Created {new Date(key.createdAt).toLocaleDateString()}
                                {key.lastUsedAt && ` • Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                              </div>
                            </div>
                            {canEdit && (
                              <NeoButton
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={() => handleRevokeApiKey(key.id)}
                              >
                                Revoke
                              </NeoButton>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </NeoCard>
              </section>
            )}

            {/* Danger Zone */}
            {canEdit && (
              <section className="space-y-4 pt-8">
                <h2 className="text-xl font-semibold uppercase tracking-tight text-red-600 flex items-center gap-2">
                  <AlertOctagon className="w-6 h-6" /> Danger Zone
                </h2>
                <NeoCard className="p-6 border-rose-600 bg-rose-50">
                  <div>
                    <h3 className="text-lg font-semibold text-rose-900 uppercase tracking-tight">Delete Project</h3>
                    <p className="text-rose-700 text-sm font-bold mt-1 max-w-xl">
                      Deleting a project is irreversible. All recordings, analytics, and data will be permanently removed.
                    </p>
                  </div>
                  <NeoButton
                    variant="danger"
                    onClick={() => setShowDeleteModal(true)}
                    leftIcon={<Trash2 className="w-4 h-4" />}
                    className="mt-4"
                  >
                    Delete Project Permanently
                  </NeoButton>
                </NeoCard>
              </section>
            )}
          </div>

          {/* Right Column: Configuration & Info */}
          <div className="space-y-8">
            {/* Recording Configuration */}
            <section className="space-y-4">
              <h2 className="text-xl font-semibold uppercase tracking-tight">Configuration</h2>
              <NeoCard className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-semibold uppercase text-slate-900 block mb-3 tracking-wide flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Max Observeability Duration
                    </label>
                    <div className="bg-slate-50 border-2 border-slate-900 p-4">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={maxRecordingMinutes.toString()}
                            onChange={(e) => {
                              setMaxRecordingMinutes(Number(e.target.value));
                              setDurationSaveError(null);
                            }}
                            disabled={!canEdit}
                            className="font-mono font-bold text-base border border-slate-100/80"
                          />
                        </div>
                        <span className="text-sm font-semibold uppercase text-slate-700 mb-1">MIN</span>
                        {canEdit && (
                          <NeoButton
                            variant="primary"
                            size="sm"
                            onClick={handleSaveDuration}
                            disabled={isSavingDuration || maxRecordingMinutes === (project?.maxRecordingMinutes || 10)}
                            leftIcon={<Save className="w-3 h-3" />}
                          >
                            Save
                          </NeoButton>
                        )}
                      </div>
                      <p className="text-[10px] uppercase font-bold text-slate-500 mt-3 tracking-wide">
                        Maximum length per session observability. Range: 1-10 minutes.
                      </p>
                      {durationSaveError && (
                        <p className="text-xs font-bold text-red-600 mt-2 uppercase flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {durationSaveError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </NeoCard>
            </section>

            {/* Technical Info */}
            <section className="space-y-4">
              <h2 className="text-xl font-semibold uppercase tracking-tight">Technical Details</h2>
              <NeoCard className="p-0 overflow-hidden">
                <div className="divide-y-2 divide-slate-200">
                  <div className="p-5 group hover:bg-slate-50 transition-colors">
                    <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
                      <Key className="w-3 h-3" /> Project ID
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm font-bold text-slate-900 break-all flex-1 bg-slate-50 px-3 py-2 border-2 border-slate-900">
                        {project.id}
                      </div>
                      <button
                        onClick={() => handleCopy(project.id, 'projectId')}
                        className="flex-shrink-0 p-2 hover:bg-slate-900 hover:text-white border border-slate-100/80 rounded transition-all active:scale-95"
                        title="Copy Project ID"
                      >
                        {copiedField === 'projectId' ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="p-5 group hover:bg-slate-50 transition-colors">
                    <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
                      <Shield className="w-3 h-3" /> Public Key
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm font-bold text-slate-900 truncate flex-1 bg-slate-50 px-3 py-2 border-2 border-slate-900">
                        {project.publicKey}
                      </div>
                      <button
                        onClick={() => handleCopy(project.publicKey, 'publicKey')}
                        className="flex-shrink-0 p-2 hover:bg-slate-900 hover:text-white border border-slate-100/80 rounded transition-all active:scale-95"
                        title="Copy Public Key"
                      >
                        {copiedField === 'publicKey' ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <Smartphone className="w-3 h-3" /> Platforms
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {project.platforms?.map((p: any) => (
                        <NeoBadge key={p} variant="info" size="md">{p}</NeoBadge>
                      )) || <span className="text-xs font-bold text-slate-400 uppercase">None configured</span>}
                    </div>
                  </div>
                </div>
              </NeoCard>
            </section>

          </div>
        </div>

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
              <div className="bg-amber-50 text-amber-800 p-3 rounded-md border border-amber-200 text-xs flex gap-2 font-bold">
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
            setDeleteError(null);
          }}
          title="Delete Project"
          footer={
            <div className="flex gap-2">
              <NeoButton variant="secondary" onClick={() => setShowDeleteModal(false)}>Cancel</NeoButton>
              <NeoButton
                variant="danger"
                onClick={handleDelete}
                disabled={isDeleting || deleteConfirmText !== project.name}
              >
                {isDeleting ? 'Deleting...' : 'Permanently Delete'}
              </NeoButton>
            </div>
          }
        >
          <div className="space-y-6">
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

            {deleteError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-2 rounded">{deleteError}</div>
            )}
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default ProjectSettings;
