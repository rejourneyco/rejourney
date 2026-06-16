import React, { useEffect, useMemo, useState } from 'react';
import { Github, Loader2 } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import {
    bindGithubLink,
    getGithubInstallationRepos,
    getGithubLinkStatus,
    unlinkGithub,
    updateGithubGlobs,
    type GithubFolderNode,
    type GithubInstallationRepos,
    type GithubLinkRepo,
    type GithubLinkStatus,
} from '~/shared/api/client';
import { isIssueDetectionUiEnabled } from '~/shared/config/runtimeEnv';
import { useSessionData } from '~/shared/providers/SessionContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { deriveSourceGlobs } from './sourceGlobs';

export function loader(_args: LoaderFunctionArgs) {
    if (!isIssueDetectionUiEnabled()) {
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

export const GithubSetup: React.FC = () => {
    const { projectId: paramProjectId } = useParams<{ projectId: string }>();
    const { selectedProject } = useSessionData();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const [searchParams] = useSearchParams();

    const projectId = paramProjectId || selectedProject?.id || '';
    const installationIdParam = searchParams.get('installation_id');

    const [status, setStatus] = useState<GithubLinkStatus | null>(null);
    const [reposData, setReposData] = useState<GithubInstallationRepos | null>(null);
    const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
    const [folderTree, setFolderTree] = useState<GithubFolderNode[] | null>(null);
    const [deselected, setDeselected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [foldersLoading, setFoldersLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const installationId = useMemo(() => {
        const fromParam = installationIdParam ? Number(installationIdParam) : NaN;
        if (Number.isInteger(fromParam) && fromParam > 0) return fromParam;
        return status?.installationId ?? null;
    }, [installationIdParam, status]);

    // 1. Load link status, then the installation's repos.
    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        getGithubLinkStatus(projectId)
            .then((linkStatus) => {
                if (cancelled) return;
                setStatus(linkStatus);
                const instId =
                    (installationIdParam && Number(installationIdParam)) || linkStatus.installationId;
                if (!instId) {
                    setError('No GitHub installation found. Install the app first.');
                    setLoading(false);
                    return;
                }
                return getGithubInstallationRepos(projectId, { installationId: Number(instId) }).then(
                    (repos) => {
                        if (cancelled) return;
                        setReposData(repos);
                        const preferred =
                            linkStatus.repo?.repoId ??
                            (repos.repos.length === 1 ? repos.repos[0]!.repoId : null);
                        setSelectedRepoId(preferred);
                        setLoading(false);
                    },
                );
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Could not load GitHub setup');
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, installationIdParam]);

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
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                        <Github className="h-5 w-5 text-[#3c4043]" />
                    </span>
                    <div>
                        <h1 className="text-lg font-semibold text-[#202124]">Connect GitHub</h1>
                        <p className="text-sm font-medium text-[#5f6368]">
                            Pick the repo and the folders Rejourney may read to locate issues.
                        </p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex h-40 items-center justify-center rounded-lg border border-[#dadce0] bg-white text-sm font-semibold text-[#5f6368]">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading GitHub setup
                    </div>
                ) : (
                    <div className="space-y-5 rounded-lg border border-[#dadce0] bg-white p-5 shadow-sm">
                        {error && (
                            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                                {error}
                            </div>
                        )}

                        <label className="block">
                            <span className="mb-1 block text-xs font-semibold uppercase text-[#6f7785]">
                                Repository
                            </span>
                            <select
                                value={selectedRepoId ?? ''}
                                onChange={(event) =>
                                    setSelectedRepoId(event.target.value ? Number(event.target.value) : null)
                                }
                                disabled={repos.length === 0}
                                className="h-10 w-full rounded-md border border-[#dadce0] bg-white px-3 text-sm font-semibold text-[#202124] outline-none transition focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                            >
                                {repos.length === 0 && <option value="">No repositories available</option>}
                                {repos.map((repo) => (
                                    <option key={repo.repoId} value={repo.repoId}>
                                        {repo.owner}/{repo.repo}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div>
                            <div className="mb-1 flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase text-[#6f7785]">
                                    Folders Rejourney can read
                                </span>
                                <span className="text-[11px] font-medium text-[#8a9288]">
                                    All allowed by default — uncheck to restrict
                                </span>
                            </div>
                            <div className="max-h-72 overflow-y-auto rounded-md border border-[#dadce0] bg-[#f8fafd] p-3">
                                {foldersLoading ? (
                                    <div className="flex h-24 items-center justify-center text-sm font-semibold text-[#5f6368]">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading folders
                                    </div>
                                ) : !folderTree || folderTree.length === 0 ? (
                                    <p className="px-1 py-2 text-sm font-medium text-[#5f6368]">
                                        No subfolders detected — the whole repo will be readable.
                                    </p>
                                ) : (
                                    <ul className="space-y-1">
                                        {folderTree.map((node) => {
                                            const folderChecked = !deselected.has(node.name);
                                            return (
                                                <li key={node.name}>
                                                    <label className="flex items-center gap-2 rounded px-1 py-1 text-sm font-semibold text-[#3c4043] hover:bg-white">
                                                        <input
                                                            type="checkbox"
                                                            checked={folderChecked}
                                                            onChange={() => toggleFolder(node.name)}
                                                            className="h-4 w-4 rounded border-[#bfc5bd]"
                                                        />
                                                        <span className="font-mono">{node.name}/</span>
                                                    </label>
                                                    {folderChecked && node.children.length > 0 && (
                                                        <ul className="ml-6 space-y-1 border-l border-[#e0e2dc] pl-3">
                                                            {node.children.map((child) => (
                                                                <li key={child}>
                                                                    <label className="flex items-center gap-2 rounded px-1 py-0.5 text-xs font-medium text-[#5f6368] hover:bg-white">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={!deselected.has(childKey(node.name, child))}
                                                                            onChange={() => toggleChild(node.name, child)}
                                                                            className="h-3.5 w-3.5 rounded border-[#bfc5bd]"
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
                                    className="text-sm font-semibold text-rose-600 transition-colors hover:text-rose-700 disabled:opacity-60"
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
                                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#1a73e8] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#2563eb] focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving ? 'Saving…' : status?.linked ? 'Save folders' : 'Connect repository'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GithubSetup;
