import React, { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, Apple, Blocks, Check, Globe, MonitorSmartphone } from 'lucide-react';
import { createProject, updateProject, type ApiTeam } from '~/shared/api/client';
import { getAndroidPackageError, getIosBundleIdError, getWebAllowedDomainsError, parseWebAllowedDomainsInput } from '~/shared/lib/validation';
import type { Project } from '~/shared/types';
import { Button } from '~/shared/ui/core/Button';
import { Input } from '~/shared/ui/core/Input';
import { cn } from '~/shared/lib/cn';
import {
  hasUnsupportedNativeAndroid,
  normalizeSetupIntegrations,
  SETUP_PLATFORM_OPTIONS,
  type SetupIntegration,
} from './setupUtils';

const platformIcons: Record<SetupIntegration, React.ElementType> = {
  web: Globe,
  'react-native': MonitorSmartphone,
  flutter: Blocks,
  ios: Apple,
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

function togglePlatform(platforms: SetupIntegration[], platform: SetupIntegration): SetupIntegration[] {
  if (platforms.includes(platform)) {
    return platforms.filter((current) => current !== platform);
  }

  if (platform === 'react-native' || platform === 'flutter' || platform === 'ios') {
    return [...platforms.filter((current) => !['react-native', 'flutter', 'ios'].includes(current)), platform];
  }
  return [...platforms, platform];
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
  const [selectedPlatforms, setSelectedPlatforms] = useState<SetupIntegration[]>(
    normalizeSetupIntegrations(projectToEdit?.platforms)
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
      setSelectedPlatforms(normalizeSetupIntegrations(projectToEdit.platforms));
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
  const includesFlutter = selectedPlatforms.includes('flutter');
  const includesIos = selectedPlatforms.includes('ios');
  const includesCrossPlatformMobile = includesReactNative || includesFlutter;
  const hasLegacyNativeAndroid = hasUnsupportedNativeAndroid(projectToEdit?.platforms) && !includesCrossPlatformMobile;
  const showIosIdentifier = includesIos || includesCrossPlatformMobile;
  const showAndroidIdentifier = includesCrossPlatformMobile;
  const webAllowedDomainsError = includesWeb ? getWebAllowedDomainsError(webAllowedDomains, true) : null;
  const iosBundleIdError = showIosIdentifier && bundleId.trim() ? getIosBundleIdError(bundleId.trim()) : null;
  const androidPackageError = showAndroidIdentifier && packageName.trim() ? getAndroidPackageError(packageName.trim()) : null;
  const missingRequiredIosId = includesIos && !bundleId.trim();
  const missingReactNativeIdentifiers = includesReactNative && !bundleId.trim() && !packageName.trim();
  const missingFlutterIdentifiers = includesFlutter && !bundleId.trim() && !packageName.trim();
  const missingCrossPlatformIdentifiers = missingReactNativeIdentifiers || missingFlutterIdentifiers;

  const projectNameIsEmpty = !projectName.trim();
  const webIsEmpty = !webAllowedDomains.trim();
  const bundleIdIsEmpty = !bundleId.trim();
  const packageNameIsEmpty = !packageName.trim();

  const isIosRequired = includesIos || (includesCrossPlatformMobile && packageNameIsEmpty);
  const isAndroidRequired = includesCrossPlatformMobile && bundleIdIsEmpty;
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
    : missingCrossPlatformIdentifiers && submitAttempted
      ? 'iOS Bundle ID or Android Package Name is required'
      : touchedFields.bundleId || submitAttempted
        ? iosBundleIdError
        : null;
  const visibleAndroidPackageError = missingCrossPlatformIdentifiers && submitAttempted
    ? 'iOS Bundle ID or Android Package Name is required'
    : touchedFields.packageName || submitAttempted
      ? androidPackageError
      : null;

  const canSubmit = Boolean(projectName.trim())
    && selectedPlatforms.length > 0
    && !missingRequiredIosId
    && !missingCrossPlatformIdentifiers
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
        : missingCrossPlatformIdentifiers
          ? `Add an iOS bundle ID or Android package name for ${includesFlutter ? 'Flutter' : 'React Native'}.`
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
          bundleId: (includesIos || includesCrossPlatformMobile) ? (bundleId.trim() || null) : null,
          packageName: includesCrossPlatformMobile ? (packageName.trim() || null) : null,
          webDomain: includesWeb ? (parsedWebAllowedDomains[0] ?? null) : null,
          webAllowedDomains: includesWeb ? (parsedWebAllowedDomains ?? null) : null,
        });
        if (onUpdated) {
          await onUpdated({ ...updated } as Project);
        }
      } else {
        const created = await createProject({
          name: projectName.trim(),
          bundleId: (includesIos || includesCrossPlatformMobile) ? (bundleId.trim() || undefined) : undefined,
          packageName: includesCrossPlatformMobile ? (packageName.trim() || undefined) : undefined,
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
    <form id={formId} className="space-y-6" onSubmit={handleSubmit}>
      {createError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {createError}
        </div>
      )}

      <div className={cn(
        "space-y-3 rounded-lg border p-4 transition-[background-color,border-color,box-shadow]",
        projectNameIsEmpty
          ? "border-slate-900 bg-white shadow-[2px_2px_0_#0f172a] dark:border-slate-500 dark:bg-slate-900/40 dark:shadow-none"
          : "border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/40"
      )}>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="setup-project-name" className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <span className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md text-xs font-black",
              projectNameIsEmpty ? "bg-indigo-600 text-white" : "bg-emerald-500 text-white"
            )}>
              {projectNameIsEmpty ? '1' : <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </span>
            Name your project
          </label>
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            projectNameIsEmpty ? "text-amber-750" : "text-emerald-650 dark:text-emerald-400"
          )}>
            {projectNameIsEmpty ? 'Required to continue' : 'Ready'}
          </span>
        </div>
        <Input
          id="setup-project-name"
          placeholder="e.g. ShopFlow checkout"
          value={projectName}
          onChange={(event) => {
            setProjectName(event.target.value);
            setCreateError(null);
          }}
          aria-required="true"
          autoFocus={!projectToEdit}
          className={cn(
            "h-12 rounded-lg bg-white text-base font-semibold shadow-sm transition-colors focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/20 dark:bg-slate-900",
            projectNameIsEmpty
              ? "border-indigo-400 placeholder:text-slate-500 dark:border-indigo-600"
              : "border-slate-300 hover:border-slate-400 dark:border-slate-700"
          )}
        />
        <p className="text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
          Start here. This is the name your team will see in dashboards and alerts.
        </p>
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-850 dark:text-slate-200">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-xs font-black text-slate-650 dark:bg-slate-800 dark:text-slate-300">2</span>
            Choose platforms
          </div>
          <p className="mt-1 text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
            Choose every app surface you want to connect now.
          </p>
        </div>
        {hasLegacyNativeAndroid && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-850 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Native Android is not supported. Android apps are supported through the React Native or Flutter SDK; choose the matching framework to keep the Android package name.
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                  'flex min-h-[118px] cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
                  selected
                    ? 'border-slate-900 bg-indigo-50/70 shadow-[2px_2px_0_#0f172a] dark:border-indigo-500 dark:bg-indigo-950/30 dark:shadow-none'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-850'
                )}
              >
                <span className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors',
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
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-900/30 sm:p-5">
          <div>
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-200 text-xs font-black text-slate-700 dark:bg-slate-800 dark:text-slate-300">3</span>
              App identifiers
            </h4>
            <p className="mt-1 text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">Only the identifiers required for your selected platforms are shown.</p>
          </div>
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
                      {includesCrossPlatformMobile ? 'At least one required' : 'Required'}
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
                  {includesCrossPlatformMobile && !includesIos ? 'Confirm the iOS bundle identifier.' : 'Use the bundle identifier from Xcode.'}
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
                      At least one required
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
            className="!rounded-lg border border-slate-300 !bg-white !font-bold !text-slate-700 shadow-sm transition-colors hover:!bg-slate-50 dark:border-slate-700 dark:!bg-slate-900 dark:!text-slate-300"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!canSubmit}
          className="!rounded-lg border border-indigo-700 !bg-indigo-600 px-6 py-2.5 font-bold tracking-wide !text-white shadow-[2px_2px_0_#312e81] transition-[background-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:!bg-indigo-700 active:translate-y-0 active:shadow-none"
        >
          {isCreating ? (projectToEdit ? 'Saving...' : 'Creating...') : (projectToEdit ? 'Save Changes' : submitLabel)}
        </Button>
      </div>
    </form>
  );
};
