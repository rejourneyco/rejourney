import React, { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, Apple, Check, Globe, MonitorSmartphone, Smartphone } from 'lucide-react';
import { createProject, updateProject, type ApiTeam } from '~/shared/api/client';
import { getAndroidPackageError, getIosBundleIdError, getWebAllowedDomainsError, parseWebAllowedDomainsInput } from '~/shared/lib/validation';
import type { Project } from '~/shared/types';
import { Button } from '~/shared/ui/core/Button';
import { Input } from '~/shared/ui/core/Input';
import { cn } from '~/shared/lib/cn';
import { SETUP_PLATFORM_OPTIONS, type SetupPlatform } from './setupUtils';

const platformIcons: Record<SetupPlatform, React.ElementType> = {
  web: Globe,
  'react-native': MonitorSmartphone,
  ios: Apple,
  android: Smartphone,
};

interface CreateProjectFormProps {
  currentTeam?: ApiTeam | null;
  formId?: string;
  submitLabel?: string;
  onCancel?: () => void;
  onCreated: (project: Project) => void | Promise<void>;
  projectToEdit?: Project | null;
  onUpdated?: (project: Project) => void | Promise<void>;
}

function togglePlatform(platforms: SetupPlatform[], platform: SetupPlatform): SetupPlatform[] {
  return platforms.includes(platform)
    ? platforms.filter((current) => current !== platform)
    : [...platforms, platform];
}

export const CreateProjectForm: React.FC<CreateProjectFormProps> = ({
  currentTeam,
  formId,
  submitLabel = 'Create Project',
  onCancel,
  onCreated,
  projectToEdit = null,
  onUpdated,
}) => {
  const [projectName, setProjectName] = useState(projectToEdit?.name ?? '');
  const [selectedPlatforms, setSelectedPlatforms] = useState<SetupPlatform[]>(
    (projectToEdit?.platforms as SetupPlatform[]) ?? []
  );
  const [bundleId, setBundleId] = useState(projectToEdit?.bundleId ?? '');
  const [packageName, setPackageName] = useState(projectToEdit?.packageName ?? '');
  const [webAllowedDomains, setWebAllowedDomains] = useState(
    projectToEdit?.webAllowedDomains?.join(', ') ?? projectToEdit?.webDomain ?? ''
  );
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touchedFields, setTouchedFields] = useState({
    webAllowedDomains: false,
    bundleId: false,
    packageName: false,
  });

  useEffect(() => {
    if (projectToEdit) {
      setProjectName(projectToEdit.name ?? '');
      setSelectedPlatforms((projectToEdit.platforms as SetupPlatform[]) ?? []);
      setBundleId(projectToEdit.bundleId ?? '');
      setPackageName(projectToEdit.packageName ?? '');
      setWebAllowedDomains(projectToEdit.webAllowedDomains?.join(', ') ?? projectToEdit.webDomain ?? '');
    } else {
      setProjectName('');
      setSelectedPlatforms([]);
      setBundleId('');
      setPackageName('');
      setWebAllowedDomains('');
    }
    setSubmitAttempted(false);
    setCreateError(null);
  }, [projectToEdit]);

  const parsedWebAllowedDomains = useMemo(
    () => parseWebAllowedDomainsInput(webAllowedDomains),
    [webAllowedDomains],
  );
  const includesWeb = selectedPlatforms.includes('web');
  const includesReactNative = selectedPlatforms.includes('react-native');
  const includesIos = selectedPlatforms.includes('ios');
  const includesAndroid = selectedPlatforms.includes('android');
  const showIosIdentifier = includesIos || includesReactNative;
  const showAndroidIdentifier = includesAndroid || includesReactNative;
  const webAllowedDomainsError = includesWeb ? getWebAllowedDomainsError(webAllowedDomains, true) : null;
  const iosBundleIdError = bundleId.trim() ? getIosBundleIdError(bundleId.trim()) : null;
  const androidPackageError = packageName.trim() ? getAndroidPackageError(packageName.trim()) : null;
  const missingRequiredIosId = includesIos && !bundleId.trim();
  const missingRequiredAndroidPackage = includesAndroid && !packageName.trim();
  const missingReactNativeIdentifiers = includesReactNative && !bundleId.trim() && !packageName.trim();

  const projectNameIsEmpty = !projectName.trim();
  const webIsEmpty = !webAllowedDomains.trim();
  const bundleIdIsEmpty = !bundleId.trim();
  const packageNameIsEmpty = !packageName.trim();

  const isIosRequired = includesIos || (includesReactNative && packageNameIsEmpty);
  const isAndroidRequired = includesAndroid || (includesReactNative && bundleIdIsEmpty);
  const isIosFilled = !bundleIdIsEmpty;
  const isAndroidFilled = !packageNameIsEmpty;

  const iosAccentClass = !showIosIdentifier
    ? ""
    : isIosFilled
      ? "border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20"
      : isIosRequired
        ? "border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/20"
        : "border-l-slate-300 dark:border-l-slate-700 bg-slate-50/50 dark:bg-slate-900/20";

  const androidAccentClass = !showAndroidIdentifier
    ? ""
    : isAndroidFilled
      ? "border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20"
      : isAndroidRequired
        ? "border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/20"
        : "border-l-slate-300 dark:border-l-slate-700 bg-slate-50/50 dark:bg-slate-900/20";

  const visibleWebAllowedDomainsError = webAllowedDomains.trim() && (touchedFields.webAllowedDomains || submitAttempted)
    ? webAllowedDomainsError
    : null;
  const visibleIosBundleIdError = missingRequiredIosId && (touchedFields.bundleId || submitAttempted)
    ? 'Required for native iOS projects'
    : missingReactNativeIdentifiers && submitAttempted
      ? 'iOS Bundle ID or Android Package Name is required'
      : touchedFields.bundleId || submitAttempted
        ? iosBundleIdError
        : null;
  const visibleAndroidPackageError = missingReactNativeIdentifiers && submitAttempted
    ? 'iOS Bundle ID or Android Package Name is required'
    : missingRequiredAndroidPackage && (touchedFields.packageName || submitAttempted)
      ? 'Required for native Android projects'
    : touchedFields.packageName || submitAttempted
      ? androidPackageError
      : null;

  const canSubmit = Boolean(projectName.trim())
    && selectedPlatforms.length > 0
    && !missingRequiredIosId
    && !missingRequiredAndroidPackage
    && !missingReactNativeIdentifiers
    && !webAllowedDomainsError
    && !iosBundleIdError
    && !androidPackageError
    && !isCreating;

  const submitHint = !projectName.trim()
    ? 'Add a project name to continue.'
    : selectedPlatforms.length === 0
      ? 'Choose at least one platform.'
      : missingRequiredIosId
        ? 'Add the iOS bundle ID, or deselect native iOS.'
        : missingRequiredAndroidPackage
          ? 'Add the Android package name, or deselect native Android.'
        : missingReactNativeIdentifiers
          ? 'Add an iOS bundle ID or Android package name for React Native.'
          : webAllowedDomainsError || iosBundleIdError || androidPackageError;

  const handleSubmit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setSubmitAttempted(true);
    if (!canSubmit) return;
    try {
      setIsCreating(true);
      setCreateError(null);
      if (projectToEdit) {
        const updated = await updateProject(projectToEdit.id, {
          name: projectName.trim(),
          platforms: selectedPlatforms,
          bundleId: (includesIos || includesReactNative) ? (bundleId.trim() || null) : null,
          packageName: (includesAndroid || includesReactNative) ? (packageName.trim() || null) : null,
          webDomain: includesWeb ? (parsedWebAllowedDomains[0] ?? null) : null,
          webAllowedDomains: includesWeb ? (parsedWebAllowedDomains ?? null) : null,
        });
        if (onUpdated) {
          await onUpdated({ ...updated } as Project);
        }
      } else {
        const created = await createProject({
          name: projectName.trim(),
          bundleId: bundleId.trim() || undefined,
          packageName: packageName.trim() || undefined,
          webDomain: includesWeb ? parsedWebAllowedDomains[0] : undefined,
          webAllowedDomains: includesWeb ? parsedWebAllowedDomains : undefined,
          teamId: currentTeam?.id,
          platforms: selectedPlatforms,
        });
        await onCreated({ ...created } as Project);
        setProjectName('');
        setSelectedPlatforms([]);
        setBundleId('');
        setPackageName('');
        setWebAllowedDomains('');
        setSubmitAttempted(false);
        setTouchedFields({
          webAllowedDomains: false,
          bundleId: false,
          packageName: false,
        });
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to save project');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <form id={formId} className="space-y-5" onSubmit={handleSubmit}>
      {createError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {createError}
        </div>
      )}

      <div className="space-y-2">
        <div>
          <label className="text-sm font-semibold text-slate-850 dark:text-slate-200">What are you adding?</label>
          <p className="mt-1 text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
            Choose every app surface you want to connect now.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {SETUP_PLATFORM_OPTIONS.map((platform) => {
            const Icon = platformIcons[platform.id];
            const selected = selectedPlatforms.includes(platform.id);
            return (
              <button
                key={platform.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setSelectedPlatforms((current) => togglePlatform(current, platform.id));
                  setCreateError(null);
                }}
                className={cn(
                  'flex min-h-[108px] items-start gap-3.5 rounded-xl border p-4 text-left transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-lg',
                  selected
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20 shadow-md shadow-indigo-500/5 scale-[1.01]'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md'
                )}
              >
                <span className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                  selected
                    ? 'border-indigo-500/25 bg-indigo-100/40 text-indigo-650 dark:bg-indigo-950/80 dark:text-indigo-350'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-500'
                )}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    {platform.label}
                    {selected && (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block text-xs font-semibold leading-relaxed text-slate-500 dark:text-slate-400">
                    {platform.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedPlatforms.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5 space-y-4 shadow-md">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-450 dark:text-slate-550">Configure Identifiers</h4>
          <div className="grid gap-4 md:grid-cols-2">
            {includesWeb && (
              <div className={cn(
                "pl-4 border-l-2 py-1 space-y-2 transition-all duration-200 rounded-r-lg md:col-span-2",
                webIsEmpty
                  ? "border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/20"
                  : "border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20"
              )}>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-355">
                    Web Allowed Domains <span className="text-red-500 font-bold">*</span>
                  </label>
                  {webIsEmpty ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                      Required
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3 inline" /> Filled
                    </span>
                  )}
                </div>
                <textarea
                  value={webAllowedDomains}
                  onChange={(event) => {
                    setWebAllowedDomains(event.target.value);
                    setCreateError(null);
                  }}
                  onBlur={() => setTouchedFields((current) => ({ ...current, webAllowedDomains: true }))}
                  placeholder="app.example.com, www.example.com, *.example.com"
                  rows={2}
                  className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 font-mono text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                />
                <p className="text-[11px] font-medium text-slate-550 dark:text-slate-450">
                  Paste production domains only. Full URLs are okay; Rejourney will keep the domain.
                </p>
                {parsedWebAllowedDomains.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-[10px] font-extrabold text-slate-450 dark:text-slate-500 uppercase tracking-wider">
                      Recognized Domains ({parsedWebAllowedDomains.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {parsedWebAllowedDomains.map((domain) => (
                        <span
                          key={domain}
                          className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-100/30"
                        >
                          {domain}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {visibleWebAllowedDomainsError && (
                  <p className="flex items-center gap-1 text-xs font-semibold text-red-500">
                    <AlertTriangle className="h-3.5 w-3.5" /> {visibleWebAllowedDomainsError}
                  </p>
                )}
              </div>
            )}

            {showIosIdentifier && (
              <div className={cn(
                "pl-4 border-l-2 py-1 space-y-2 transition-all duration-200 rounded-r-lg",
                iosAccentClass
              )}>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-355">
                    iOS Bundle ID {isIosRequired && <span className="text-red-500 font-bold">*</span>}
                  </label>
                  {isIosFilled ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3 inline" /> Filled
                    </span>
                  ) : isIosRequired ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                      {includesReactNative ? 'At least one required' : 'Required'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-655 dark:text-slate-400">
                      Optional
                    </span>
                  )}
                </div>
                <Input
                  placeholder="com.example.app"
                  value={bundleId}
                  onChange={(event) => {
                    setBundleId(event.target.value);
                    setCreateError(null);
                  }}
                  onBlur={() => setTouchedFields((current) => ({ ...current, bundleId: true }))}
                  error={visibleIosBundleIdError ?? undefined}
                  className="h-11 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm font-mono rounded-xl hover:border-slate-355 dark:hover:border-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 transition-all"
                />
                <p className="text-[11px] font-medium text-slate-555 dark:text-slate-455">
                  {includesReactNative && !includesIos ? 'Confirm bundle identifier.' : 'Use the bundle identifier from Xcode.'}
                </p>
              </div>
            )}

            {showAndroidIdentifier && (
              <div className={cn(
                "pl-4 border-l-2 py-1 space-y-2 transition-all duration-200 rounded-r-lg",
                androidAccentClass
              )}>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-355">
                    Android Package Name {isAndroidRequired && <span className="text-red-500 font-bold">*</span>}
                  </label>
                  {isAndroidFilled ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3 inline" /> Filled
                    </span>
                  ) : isAndroidRequired ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                      {includesAndroid ? 'Required' : 'At least one required'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-655 dark:text-slate-400">
                      Optional
                    </span>
                  )}
                </div>
                <Input
                  placeholder="com.example.app"
                  value={packageName}
                  onChange={(event) => {
                    setPackageName(event.target.value);
                    setCreateError(null);
                  }}
                  onBlur={() => setTouchedFields((current) => ({ ...current, packageName: true }))}
                  error={visibleAndroidPackageError ?? undefined}
                  className="h-11 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm font-mono rounded-xl hover:border-slate-355 dark:hover:border-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 transition-all"
                />
                <p className="text-[11px] font-medium text-slate-555 dark:text-slate-455">
                  Use the package name from your Android app manifest.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={cn(
        "pl-4 border-l-2 py-2 space-y-2 transition-all duration-200 rounded-r-lg",
        projectNameIsEmpty
          ? "border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/20"
          : "border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20"
      )}>
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-355">
            Project name <span className="text-red-500 font-bold">*</span>
          </label>
          {projectNameIsEmpty ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
              Required
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
              <Check className="h-3 w-3 inline" /> Filled
            </span>
          )}
        </div>
        <Input
          placeholder="Consumer app, marketing site, checkout app"
          value={projectName}
          onChange={(event) => {
            setProjectName(event.target.value);
            setCreateError(null);
          }}
          className="h-11 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm font-medium rounded-xl hover:border-slate-300 dark:hover:border-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 transition-all"
        />
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 dark:border-slate-800 pt-4 sm:flex-row sm:justify-end">
        {submitHint && (
          <p className="self-center text-xs font-semibold text-slate-500 dark:text-slate-400 sm:mr-auto">
            {submitHint}
          </p>
        )}
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            className="!rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!canSubmit}
          className="!rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-lg shadow-indigo-500/15 hover:shadow-indigo-500/25 font-bold tracking-wide hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 px-6 py-2.5"
        >
          {isCreating ? (projectToEdit ? 'Saving...' : 'Creating...') : (projectToEdit ? 'Save Changes' : submitLabel)}
        </Button>
      </div>
    </form>
  );
};
