import React, { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, Check, Globe } from 'lucide-react';
import { AppleBrandIcon, FlutterBrandIcon, ReactBrandIcon, UnityBrandIcon } from '~/shared/ui/core/PlatformBrandIcon';
import { createProject, updateProject, type ApiTeam } from '~/shared/api/client';
import { getAndroidPackageError, getIosBundleIdError, getWebAllowedDomainsError, parseWebAllowedDomainsInput } from '~/shared/lib/validation';
import type { Project } from '~/shared/types';
import { dashboardButtonClass, dashboardChipClass } from '~/shared/ui/core/dashboardStyles';
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
  'react-native': ReactBrandIcon,
  flutter: FlutterBrandIcon,
  unity: UnityBrandIcon,
  ios: AppleBrandIcon,
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

  if (platform === 'react-native' || platform === 'flutter' || platform === 'unity' || platform === 'ios') {
    return [...platforms.filter((current) => !['react-native', 'flutter', 'unity', 'ios'].includes(current)), platform];
  }
  return [...platforms, platform];
}

export const CreateProjectForm: React.FC<CreateProjectFormProps> = ({
  currentTeam,
  formId,
  submitLabel = 'Create project',
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
  const includesCrossPlatformMobile = includesReactNative || includesFlutter || selectedPlatforms.includes('unity');
  const hasLegacyNativeAndroid = hasUnsupportedNativeAndroid(projectToEdit?.platforms) && !includesCrossPlatformMobile;
  const showIosIdentifier = includesIos || includesCrossPlatformMobile;
  const showAndroidIdentifier = includesCrossPlatformMobile;
  const webAllowedDomainsError = includesWeb ? getWebAllowedDomainsError(webAllowedDomains, true) : null;
  const iosBundleIdError = showIosIdentifier && bundleId.trim() ? getIosBundleIdError(bundleId.trim()) : null;
  const androidPackageError = showAndroidIdentifier && packageName.trim() ? getAndroidPackageError(packageName.trim()) : null;
  const missingRequiredIosId = includesIos && !bundleId.trim();
  const missingCrossPlatformIdentifiers = includesCrossPlatformMobile && !bundleId.trim() && !packageName.trim();

  const projectNameIsEmpty = !projectName.trim();
  const webIsEmpty = !webAllowedDomains.trim();
  const bundleIdIsEmpty = !bundleId.trim();
  const packageNameIsEmpty = !packageName.trim();

  const isIosRequired = includesIos || (includesCrossPlatformMobile && packageNameIsEmpty);
  const isAndroidRequired = includesCrossPlatformMobile && bundleIdIsEmpty;
  const isIosFilled = !bundleIdIsEmpty;
  const isAndroidFilled = !packageNameIsEmpty;

  const visibleWebAllowedDomainsError = webAllowedDomains.trim() && (touchedFields.webAllowedDomains || submitAttempted)
    ? webAllowedDomainsError
    : null;
  const visibleIosBundleIdError = missingRequiredIosId && (touchedFields.bundleId || submitAttempted)
    ? 'Required for native iOS projects'
    : missingCrossPlatformIdentifiers && submitAttempted
      ? 'Add an iOS bundle ID or Android package name'
      : touchedFields.bundleId || submitAttempted
        ? iosBundleIdError
        : null;
  const visibleAndroidPackageError = missingCrossPlatformIdentifiers && submitAttempted
    ? 'Add an iOS bundle ID or Android package name'
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
          ? `Add an iOS bundle ID or Android package name for ${selectedPlatforms.includes('unity') ? 'Unity' : includesFlutter ? 'Flutter' : 'React Native'}.`
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
        <div className="rounded-none border border-[#f6aea9] bg-[#fce8e6] p-3 text-sm text-[#c5221f]">
          {createError}
        </div>
      )}

      <div className={cn(
        "space-y-3 rounded-none border p-4 transition-colors",
        projectNameIsEmpty
          ? "border-[#1a73e8] bg-[#e8f0fe]"
          : "border-[#dadce0] bg-white"
      )}>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="setup-project-name" className="flex items-center gap-2 text-sm font-medium text-[#202124]">
            <span className={cn(
              "flex h-6 w-6 items-center justify-center rounded-none text-xs font-medium",
              projectNameIsEmpty ? "bg-[#1a73e8] text-white" : "bg-[#e6f4ea] text-[#137333]"
            )}>
              {projectNameIsEmpty ? '1' : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
            </span>
            Name your project
          </label>
          <span className={dashboardChipClass(projectNameIsEmpty ? 'warning' : 'success')}>
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
          className="h-10"
        />
        <p className="text-xs leading-5 text-[#5f6368]">
          Start here. This is the name your team will see in dashboards and alerts.
        </p>
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[#202124]">
            <span className="flex h-6 w-6 items-center justify-center rounded-none bg-[#f1f3f4] text-xs font-medium text-[#5f6368]">2</span>
            Choose platforms
          </div>
          <p className="mt-1 text-xs leading-5 text-[#5f6368]">
            Choose every app surface you want to connect now.
          </p>
        </div>
        {hasLegacyNativeAndroid && (
          <div className="flex items-start gap-2 rounded-none border border-[#fde293] bg-[#fef7e0] p-3 text-sm text-[#b06000]" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Native Android is not supported. Android apps are supported through the React Native, Flutter, or Unity SDK; choose the matching framework to keep the Android package name.
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
                  'flex min-h-[118px] cursor-pointer items-start gap-3 rounded-none border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 focus-visible:ring-offset-1',
                  selected
                    ? 'border-[#1a73e8] bg-[#e8f0fe]'
                    : 'border-[#dadce0] bg-white hover:border-[#bdc1c6] hover:bg-[#f8fafd]'
                )}
              >
                <span className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-none border transition-colors',
                  selected
                    ? 'border-[#d2e3fc] bg-white text-[#1967d2]'
                    : 'border-[#dadce0] bg-[#f8fafd] text-[#5f6368]'
                )}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn(
                    'flex items-center gap-2 text-sm font-medium',
                    selected ? 'text-[#1967d2]' : 'text-[#202124]'
                  )}>
                    {platform.label}
                    {selected && (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-none bg-[#1a73e8] text-white">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-[#5f6368]">
                    {platform.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedPlatforms.length > 0 && (
        <div className="space-y-4 rounded-none border border-[#dadce0] bg-[#f8fafd] p-4 sm:p-5">
          <div>
            <h4 className="flex items-center gap-2 text-sm font-medium text-[#202124]">
              <span className="flex h-6 w-6 items-center justify-center rounded-none bg-[#e8eaed] text-xs font-medium text-[#5f6368]">3</span>
              App identifiers
            </h4>
            <p className="mt-1 text-xs leading-5 text-[#5f6368]">Only the identifiers required for your selected platforms are shown.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {includesWeb && (
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-[#202124]">
                    Web allowed domains <span className="font-medium text-[#c5221f]">*</span>
                  </label>
                  {webIsEmpty ? (
                    <span className={dashboardChipClass('warning')}>
                      Required
                    </span>
                  ) : (
                    <span className={dashboardChipClass('success')}>
                      <Check className="h-3 w-3" /> Filled
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
                  className="w-full resize-y rounded-none border border-[#dadce0] bg-white px-3 py-2 font-mono text-sm text-[#202124] transition-colors placeholder:text-[#80868b] hover:border-[#bdc1c6] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/20"
                />
                <p className="text-xs text-[#5f6368]">
                  Paste production domains only. Full URLs are okay; Rejourney will keep the domain.
                </p>
                {parsedWebAllowedDomains.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-xs font-medium text-[#5f6368]">
                      Recognized domains ({parsedWebAllowedDomains.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {parsedWebAllowedDomains.map((domain) => (
                        <span
                          key={domain}
                          className={cn(dashboardChipClass('info'), 'font-mono')}
                        >
                          {domain}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {visibleWebAllowedDomainsError && (
                  <p className="flex items-center gap-1 text-xs font-medium text-[#c5221f]">
                    <AlertTriangle className="h-3.5 w-3.5" /> {visibleWebAllowedDomainsError}
                  </p>
                )}
              </div>
            )}

            {showIosIdentifier && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-[#202124]">
                    iOS bundle ID {isIosRequired && <span className="font-medium text-[#c5221f]">*</span>}
                  </label>
                  {isIosFilled ? (
                    <span className={dashboardChipClass('success')}>
                      <Check className="h-3 w-3" /> Filled
                    </span>
                  ) : isIosRequired ? (
                    <span className={dashboardChipClass('warning')}>
                      {includesCrossPlatformMobile ? 'At least one required' : 'Required'}
                    </span>
                  ) : (
                    <span className={dashboardChipClass('neutral')}>
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
                  className="font-mono"
                />
                <p className="text-xs text-[#5f6368]">
                  {includesCrossPlatformMobile && !includesIos ? 'Confirm the iOS bundle identifier.' : 'Use the bundle identifier from Xcode.'}
                </p>
              </div>
            )}

            {showAndroidIdentifier && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-[#202124]">
                    Android package name {isAndroidRequired && <span className="font-medium text-[#c5221f]">*</span>}
                  </label>
                  {isAndroidFilled ? (
                    <span className={dashboardChipClass('success')}>
                      <Check className="h-3 w-3" /> Filled
                    </span>
                  ) : isAndroidRequired ? (
                    <span className={dashboardChipClass('warning')}>
                      At least one required
                    </span>
                  ) : (
                    <span className={dashboardChipClass('neutral')}>
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
                  className="font-mono"
                />
                <p className="text-xs text-[#5f6368]">
                  Use the package name from your Android app manifest.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-[#e8eaed] pt-4 sm:flex-row sm:justify-end">
        {submitHint && (
          <p className="self-center text-xs text-[#5f6368] sm:mr-auto">
            {submitHint}
          </p>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={dashboardButtonClass('secondary', 'md')}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className={dashboardButtonClass('primary', 'md')}
        >
          {isCreating ? (projectToEdit ? 'Saving...' : 'Creating...') : (projectToEdit ? 'Save changes' : submitLabel)}
        </button>
      </div>
    </form>
  );
};
