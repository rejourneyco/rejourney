import React, { useEffect, useMemo, useState } from 'react';
import { Github, Loader2, Settings } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import {
    bindGithubLink,
    getGithubInstallations,
    getGithubInstallUrl,
    getGithubInstallationRepos,
    getGithubLinkStatus,
    unlinkGithub,
    updateGithubGlobs,
    type GithubFolderNode,
    type GithubInstallationCandidate,
    type GithubInstallationRepos,
    type GithubLinkRepo,
    type GithubLinkStatus,
} from '~/shared/api/client';
import { isIssueDetectionUiEnabled } from '~/shared/config/runtimeEnv';
import { useSessionData } from '~/shared/providers/SessionContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import {
    dashboardButtonClass,
    dashboardCardClass,
    dashboardFieldClass,
    dashboardLabelClass,
} from '~/shared/ui/core/dashboardStyles';
import { deriveSourceGlobs } from './sourceGlobs';

export function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    if (!isIssueDetectionUiEnabled(url.pathname)) {
        throw new Response('Not found', { status: 404 });
    }
    return null;
}

export const meta = () => [
    { title: 'GitHub setup - Rejourney' },
    { name: 'robots', content: 'noindex' },
];

function childKey(folder: string, child: string): string {
    return `${folder}/${child}`;
}

function candidateToReposData(candidate: GithubInstallationCandidate): GithubInstallationRepos {
    return {
        installationId: candidate.installationId,
        repositorySelection: candidate.repositorySelection,
        repos: candidate.repos,
    };
}

export const GithubSetup: React.FC = () => {
    const { projectId: paramProjectId } = useParams<{ projectId: string }>();
    const { selectedProject } = useSessionData();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const [searchParams] = useSearchParams();

    const projectId = paramProjectId || selectedProject?.id || '';
    const installationIdParam = searchParams.get('installation_id');

    const [status, setStatus] = useState<GithubLinkStatus | null>(null);
    const [installations, setInstallations] = useState<GithubInstallationCandidate[]>([]);
    const [selectedInstallationId, setSelectedInstallationId] = useState<number | null>(null);
    const [reposData, setReposData] = useState<GithubInstallationRepos | null>(null);
    const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
    const [folderTree, setFolderTree] = useState<GithubFolderNode[] | null>(null);
    const [deselected, setDeselected] = useState<Set<string>>(new Set());
    const [reloadKey, setReloadKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [foldersLoading, setFoldersLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [installBusy, setInstallBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const installationId = useMemo(() => {
        const fromParam = installationIdParam ? Number(installationIdParam) : NaN;
        if (Number.isInteger(fromParam) && fromParam > 0) return fromParam;
        if (selectedInstallationId != null) return selectedInstallationId;
        return status?.installationId ?? null;
    }, [installationIdParam, selectedInstallationId, status]);

    // 1. Load link status, then either the known installation repos or the
    // candidate installations issue-detection can already see for this App.
    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setFolderTree(null);
        setDeselected(new Set());

        const explicitInstallationId = (() => {
            const fromParam = installationIdParam ? Number(installationIdParam) : NaN;
            return Number.isInteger(fromParam) && fromParam > 0 ? fromParam : null;
        })();

        (async () => {
            const linkStatus = await getGithubLinkStatus(projectId);
            if (cancelled) return;
            setStatus(linkStatus);

            const knownInstallationId = explicitInstallationId ?? linkStatus.installationId;
            if (knownInstallationId != null) {
                setInstallations([]);
                setSelectedInstallationId(null);
                const repos = await getGithubInstallationRepos(projectId, {
                    installationId: knownInstallationId,
                });
                if (cancelled) return;
                setReposData(repos);
                setSelectedRepoId(
                    linkStatus.repo?.repoId ??
                    (repos.repos.length === 1 ? repos.repos[0]!.repoId : null),
                );
                return;
            }

            const candidates = await getGithubInstallations(projectId);
            if (cancelled) return;
            const active = candidates.installations.filter(
                (candidate) => candidate.installationState === 'active',
            );
            const visibleCandidates = active.length > 0 ? active : candidates.installations;
            setInstallations(visibleCandidates);

            const preferred =
                visibleCandidates.find((candidate) => candidate.repos.length === 1) ??
                visibleCandidates.find((candidate) => candidate.repos.length > 0) ??
                visibleCandidates[0] ??
                null;
            setSelectedInstallationId(preferred?.installationId ?? null);
            if (!preferred) {
                setReposData(null);
                setSelectedRepoId(null);
            }
        })()
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Could not load GitHub setup');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, installationIdParam, reloadKey]);

    useEffect(() => {
        if (selectedInstallationId == null || installations.length === 0) return;
        const candidate = installations.find(
            (item) => item.installationId === selectedInstallationId,
        );
        if (!candidate) return;
        setReposData(candidateToReposData(candidate));
        setSelectedRepoId(candidate.repos.length === 1 ? candidate.repos[0]!.repoId : null);
        setFolderTree(null);
        setDeselected(new Set());
    }, [installations, selectedInstallationId]);

    // 2. Load the two-level folder tree whenever the chosen repo changes.
    useEffect(() => {
        if (!projectId || !installationId || selectedRepoId == null) {
            setFolderTree(null);
            return;
        }
        let cancelled = false;
        setFoldersLoading(true);
        setDeselected(new Set());
        getGithubInstallationRepos(projectId, {
            installationId,
            withFolders: true,
            repoId: selectedRepoId,
        })
            .then((repos) => {
                if (!cancelled) setFolderTree(repos.folderTree ?? []);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load folders');
            })
            .finally(() => {
                if (!cancelled) setFoldersLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, installationId, selectedRepoId]);

    const toggleFolder = (name: string) => {
        setDeselected((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const toggleChild = (folder: string, child: string) => {
        setDeselected((prev) => {
            const next = new Set(prev);
            const key = childKey(folder, child);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const onSave = async () => {
        if (!projectId || selectedRepoId == null || installationId == null) return;
        setSaving(true);
        setError(null);
        const sourceGlobs = deriveSourceGlobs(folderTree ?? [], deselected);
        try {
            if (status?.linked && status.repo?.repoId === selectedRepoId) {
                await updateGithubGlobs(projectId, sourceGlobs);
            } else {
                await bindGithubLink(projectId, {
                    installationId,
                    repoId: selectedRepoId,
                    sourceGlobs,
                });
            }
            navigate(`${pathPrefix}/leaks`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the GitHub link');
            setSaving(false);
        }
    };

    const onOpenInstall = async () => {
        if (!projectId) return;
        setInstallBusy(true);
        setError(null);
        try {
            const { installUrl } = await getGithubInstallUrl(projectId);
            window.location.href = installUrl;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not start the GitHub App install');
            setInstallBusy(false);
        }
    };

    const onDisconnect = async () => {
        if (!projectId) return;
        if (typeof window !== 'undefined' && !window.confirm('Disconnect GitHub from this project?')) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await unlinkGithub(projectId);
            navigate(`${pathPrefix}/leaks`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not disconnect GitHub');
            setSaving(false);
        }
    };

    const repos: GithubLinkRepo[] = reposData?.repos ?? [];

    return (
        <div className="min-h-screen bg-[#f8fafd] px-4 py-8 font-sans text-[#202124] sm:px-6">
            <div className="mx-auto w-full max-w-2xl">
                <div className="mb-6 flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#dadce0] bg-white">
                        <Github className="h-5 w-5 text-[#3c4043]" />
                    </span>
                    <div>
                        <h1 className="text-lg font-normal leading-6 text-[#202124] sm:text-xl">
                            Connect GitHub <span className="text-[#5f6368]">(optional)</span>
                        </h1>
                        <p className="mt-0.5 text-sm text-[#5f6368]">
                            Add exact source locations and code-specific fix plans. Leak detection and evidence context work without this connection.
                        </p>
                    </div>
                </div>

                {loading ? (
                    <div className={`flex h-40 items-center justify-center ${dashboardCardClass} text-sm text-[#5f6368]`}>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading GitHub setup
                    </div>
                ) : (
                    <div className={`space-y-5 ${dashboardCardClass} p-5`}>
                        {error && (
                            <div className="border border-[#f6aea9] bg-[#fce8e6] p-3 text-sm text-[#a50e0e]">
                                {error}
                            </div>
                        )}

                        {installationId == null ? (
                            <div className="space-y-4">
                                <div className="border border-[#e8eaed] bg-[#f8fafd] p-4">
                                    <h2 className="text-sm font-medium text-[#202124]">Install GitHub access</h2>
                                    <p className="mt-1 text-sm leading-6 text-[#5f6368]">
                                        No active GitHub App installation is available for this project yet. Install or update access, then return here to choose a repository.
                                    </p>
                                </div>
                                <div className="flex flex-col gap-3 sm:flex-row">
                                    <button
                                        type="button"
                                        onClick={() => void onOpenInstall()}
                                        disabled={installBusy}
                                        className={dashboardButtonClass('primary', 'lg')}
                                        style={{ color: '#ffffff' }}
                                    >
                                        <Github className="h-4 w-4 text-white" />
                                        <span className="text-white">{installBusy ? 'Opening…' : 'Install or update GitHub App'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setReloadKey((value) => value + 1)}
                                        className={dashboardButtonClass('secondary', 'lg')}
                                    >
                                        Refresh
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {installations.length > 1 && (
                                    <label className="block">
                                        <span className={`mb-1 block ${dashboardLabelClass}`}>
                                            GitHub account
                                        </span>
                                        <select
                                            value={selectedInstallationId ?? ''}
                                            onChange={(event) =>
                                                setSelectedInstallationId(
                                                    event.target.value ? Number(event.target.value) : null,
                                                )
                                            }
                                            className={dashboardFieldClass}
                                        >
                                            {installations.map((candidate) => (
                                                <option
                                                    key={candidate.installationId}
                                                    value={candidate.installationId}
                                                >
                                                    {candidate.accountLogin} ({candidate.repos.length} repos)
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}

                                <div className="flex flex-col gap-3 border border-[#e8eaed] bg-[#f8fafd] p-3 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-sm leading-5 text-[#5f6368]">
                                        Need another repo? Update GitHub permissions, then return here to choose from the refreshed list.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => void onOpenInstall()}
                                        disabled={installBusy}
                                        className={dashboardButtonClass('secondary', 'md')}
                                    >
                                        {installBusy ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Settings className="h-4 w-4" />
                                        )}
                                        Change GitHub permissions
                                    </button>
                                </div>

                                <label className="block">
                                    <span className={`mb-1 block ${dashboardLabelClass}`}>
                                        Repository
                                    </span>
                                    <select
                                        value={selectedRepoId ?? ''}
                                        onChange={(event) =>
                                            setSelectedRepoId(event.target.value ? Number(event.target.value) : null)
                                        }
                                        disabled={repos.length === 0}
                                        className={dashboardFieldClass}
                                    >
                                        {repos.length > 0 && <option value="">Choose a repository</option>}
                                        {repos.length === 0 && <option value="">No repositories available</option>}
                                        {repos.map((repo) => (
                                            <option key={repo.repoId} value={repo.repoId}>
                                                {repo.owner}/{repo.repo}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <div>
                                    <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                        <span className={dashboardLabelClass}>
                                            Folders Rejourney can read
                                        </span>
                                        <span className="text-[11px] text-[#5f6368]">
                                            All allowed by default — uncheck to restrict
                                        </span>
                                    </div>
                                    <div className="max-h-72 overflow-y-auto border border-[#dadce0] bg-[#f8fafd] p-3">
                                        {foldersLoading ? (
                                            <div className="flex h-24 items-center justify-center text-sm text-[#5f6368]">
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading folders
                                            </div>
                                        ) : !folderTree || folderTree.length === 0 ? (
                                            <p className="px-1 py-2 text-sm text-[#5f6368]">
                                                No subfolders detected — the whole repo will be readable.
                                            </p>
                                        ) : (
                                            <ul className="space-y-1">
                                                {folderTree.map((node) => {
                                                    const folderChecked = !deselected.has(node.name);
                                                    return (
                                                        <li key={node.name}>
                                                            <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm font-medium text-[#3c4043] hover:bg-white">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={folderChecked}
                                                                    onChange={() => toggleFolder(node.name)}
                                                                    className="h-4 w-4 accent-[#1a73e8]"
                                                                />
                                                                <span className="font-mono">{node.name}/</span>
                                                            </label>
                                                            {folderChecked && node.children.length > 0 && (
                                                                <ul className="ml-6 space-y-1 border-l border-[#e8eaed] pl-3">
                                                                    {node.children.map((child) => (
                                                                        <li key={child}>
                                                                            <label className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-xs text-[#5f6368] hover:bg-white">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={!deselected.has(childKey(node.name, child))}
                                                                                    onChange={() => toggleChild(node.name, child)}
                                                                                    className="h-3.5 w-3.5 accent-[#1a73e8]"
                                                                                />
                                                                                <span className="font-mono">
                                                                                    {node.name}/{child}/
                                                                                </span>
                                                                            </label>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            )}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-1">
                                    {status?.linked ? (
                                        <button
                                            type="button"
                                            onClick={() => void onDisconnect()}
                                            disabled={saving}
                                            className="inline-flex h-10 items-center rounded-none px-3 text-sm font-medium text-[#c5221f] transition-colors hover:bg-[#fce8e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Disconnect
                                        </button>
                                    ) : (
                                        <span />
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => void onSave()}
                                        disabled={saving || selectedRepoId == null || installationId == null}
                                        className={dashboardButtonClass('primary', 'lg')}
                                    >
                                        {saving ? 'Saving…' : status?.linked ? 'Save folders' : 'Connect repository'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default GithubSetup;
