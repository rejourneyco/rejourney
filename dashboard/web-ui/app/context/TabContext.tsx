import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { TabRegistry } from '../config/TabRegistry';
import { useSessionData } from './SessionContext';
import { useSafeTeam } from './TeamContext';
import { getWorkspace, saveWorkspace, WorkspaceTab } from '../services/api';

export interface Tab {
    id: string;
    type: string;
    title: string;
    path: string;
    component?: React.ReactNode;
    isClosable: boolean;
    scrollPosition?: number;
    projectId?: string;
    projectName?: string;
    teamId?: string;
    teamName?: string;
    group: 'primary' | 'secondary';
    icon?: React.ElementType;
}

interface TabContextType {
    tabs: Tab[];
    activeTabId: string;
    recentlyClosed: Tab[];
    isSplitView: boolean;
    secondaryTabId: string | null;
    splitRatio: number;
    openTab: (tab: Omit<Tab, 'isClosable' | 'group'> & { isClosable?: boolean; group?: 'primary' | 'secondary' }) => void;
    closeTab: (id: string, event?: React.MouseEvent) => void;
    closeAllTabs: () => void;
    closeOtherTabs: (id: string) => void;
    closeStaleTabs: () => void;
    openTabInSplit: (id: string) => void;
    moveTabToGroup: (id: string, group: 'primary' | 'secondary') => void;
    closeSplitView: () => void;
    setSplitRatio: (ratio: number) => void;
    setActiveTabId: (id: string) => void;
    reorderTabs: (startIndex: number, endIndex: number, group: 'primary' | 'secondary') => void;
    reopenTab: () => void;
    maxTabs: number;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

const MAX_OPEN_TABS = 14;
const MAX_DETAIL_TABS = 6;
const STALE_TAB_KEEP_COUNT = 6;
const RECENTLY_CLOSED_LIMIT = 10;

function isDetailTab(tabId: string): boolean {
    return tabId.startsWith('session-')
        || tabId.startsWith('crash-')
        || tabId.startsWith('error-')
        || tabId.startsWith('anr-')
        || tabId.startsWith('issue-');
}

function stripPathPrefix(pathname: string): string {
    return pathname.replace(/^\/(dashboard|demo)/, '') || '/issues';
}

function isWarehousePath(pathname: string): boolean {
    return stripPathPrefix(pathname).startsWith('/warehouse');
}

function trimTabsForLimits(
    candidateTabs: Tab[],
    recentlyClosed: Tab[],
    keepIds: Set<string>
): { tabs: Tab[]; recentlyClosed: Tab[] } {
    let tabs = [...candidateTabs];
    let closed = [...recentlyClosed];

    const pushClosed = (tab: Tab) => {
        closed = [...closed.slice(-9), tab];
    };

    // Keep detail tabs bounded first, since they are the main accumulation source.
    while (tabs.filter(t => isDetailTab(t.id)).length > MAX_DETAIL_TABS) {
        const victimIndex = tabs.findIndex(t => isDetailTab(t.id) && t.isClosable && !keepIds.has(t.id));
        if (victimIndex === -1) break;
        const [victim] = tabs.splice(victimIndex, 1);
        pushClosed(victim);
    }

    // Then keep overall tab count bounded.
    while (tabs.length > MAX_OPEN_TABS) {
        const victimIndex = tabs.findIndex(t => t.isClosable && !keepIds.has(t.id));
        if (victimIndex === -1) break;
        const [victim] = tabs.splice(victimIndex, 1);
        pushClosed(victim);
    }

    return { tabs, recentlyClosed: closed };
}

function appendRecentlyClosed(existing: Tab[], additions: Tab[]): Tab[] {
    if (additions.length === 0) return existing.slice(-RECENTLY_CLOSED_LIMIT);
    return [...existing, ...additions].slice(-RECENTLY_CLOSED_LIMIT);
}

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabIdState] = useState<string>('');
    const [recentlyClosed, setRecentlyClosed] = useState<Tab[]>([]);
    const [isSplitView, setIsSplitView] = useState(false);
    const [secondaryTabId, setSecondaryTabId] = useState<string | null>(null);
    const [splitRatioState, setSplitRatioState] = useState(0.5);
    const [hasLoaded, setHasLoaded] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const { selectedProject, isLoading: isProjectLoading } = useSessionData();
    const { currentTeam } = useSafeTeam();

    // Derive path prefix from current location
    const getPathPrefix = useCallback(() => {
        if (location.pathname.startsWith('/dashboard')) return '/dashboard';
        if (location.pathname.startsWith('/demo')) return '/demo';
        return '';
    }, [location.pathname]);

    // Use refs to track latest state for callbacks to avoid stale closures
    const activeTabIdRef = useRef(activeTabId);
    const tabsRef = useRef(tabs);
    const recentlyClosedRef = useRef(recentlyClosed);
    const hasLoadedRef = useRef(hasLoaded);
    const locationPathRef = useRef(location.pathname);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isSavingRef = useRef(false);
    const isScopeTransitionRef = useRef(false);
    const skipRestoreForNextScopeRef = useRef(false);

    // Keep refs in sync with state
    useEffect(() => {
        activeTabIdRef.current = activeTabId;
    }, [activeTabId]);

    useEffect(() => {
        tabsRef.current = tabs;
    }, [tabs]);

    useEffect(() => {
        recentlyClosedRef.current = recentlyClosed;
    }, [recentlyClosed]);

    useEffect(() => {
        hasLoadedRef.current = hasLoaded;
    }, [hasLoaded]);

    useEffect(() => {
        locationPathRef.current = location.pathname;
    }, [location.pathname]);

    const setActiveTabId = useCallback((id: string) => {
        activeTabIdRef.current = id;
        setActiveTabIdState(id);
    }, []);

    const setSplitRatio = useCallback((ratio: number) => {
        const clamped = Math.max(0.25, Math.min(0.75, ratio));
        setSplitRatioState(clamped);
    }, []);

    const annotateTabWithScope = useCallback((tab: Tab): Tab => ({
        ...tab,
        projectId: tab.projectId ?? selectedProject?.id,
        projectName: tab.projectName ?? selectedProject?.name,
        teamId: tab.teamId ?? selectedProject?.teamId ?? currentTeam?.id,
        teamName: tab.teamName ?? currentTeam?.name,
        group: tab.group ?? 'primary',
        icon: tab.icon ?? TabRegistry.getTabInfo(stripPathPrefix(tab.path))?.icon,
    }), [selectedProject?.id, selectedProject?.name, selectedProject?.teamId, currentTeam?.id, currentTeam?.name]);

    // Save workspace state to backend (debounced using refs to avoid stale closures)
    const saveToBackend = useCallback(() => {
        if (!selectedProject?.teamId || !selectedProject?.id) return;
        if (isScopeTransitionRef.current || !hasLoadedRef.current || isWarehousePath(locationPathRef.current)) return;

        // Clear any pending save
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Debounce: wait 1 second before saving
        saveTimeoutRef.current = setTimeout(async () => {
            if (isScopeTransitionRef.current || !hasLoadedRef.current || isWarehousePath(locationPathRef.current)) return;
            if (isSavingRef.current) return;
            isSavingRef.current = true;

            try {
                // Read current state from refs (not stale closures)
                const currentTabs = tabsRef.current;
                const currentActiveId = activeTabIdRef.current;
                const currentClosed = recentlyClosedRef.current;

                const workspaceTabs: WorkspaceTab[] = currentTabs.map(t => ({
                    id: t.id,
                    title: t.title,
                    path: t.path,
                }));
                const closedTabs: WorkspaceTab[] = currentClosed.map(t => ({
                    id: t.id,
                    title: t.title,
                    path: t.path,
                }));
                await saveWorkspace(
                    selectedProject?.teamId || '',
                    selectedProject?.id || '',
                    workspaceTabs,
                    currentActiveId || 'issues', // Fallback to 'issues' if undefined/empty
                    closedTabs
                );
            } catch (err) {
                console.warn('Failed to save workspace:', err);
            } finally {
                isSavingRef.current = false;
            }
        }, 1000);
    }, [selectedProject?.teamId, selectedProject?.id]);

    // Persist whenever tabs change (but only after initial load completes)
    useEffect(() => {
        if (hasLoaded && selectedProject && !isWarehousePath(location.pathname)) {
            saveToBackend();
        }
    }, [tabs, activeTabId, recentlyClosed, hasLoaded, selectedProject, location.pathname, saveToBackend]);

    // Cleanup save timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    // Normalize old paths to new SSR paths
    const normalizePath = useCallback((path: string, prefix: string): string => {
        // If path already has the correct prefix, return as-is
        if (path.startsWith(prefix)) {
            return path;
        }

        // If path has wrong prefix (e.g., /demo/sessions when we're in /dashboard), fix it
        if (path.startsWith('/dashboard/') && prefix === '/demo') {
            return path.replace('/dashboard/', '/demo/');
        }
        if (path.startsWith('/demo/') && prefix === '/dashboard') {
            return path.replace('/demo/', '/dashboard/');
        }

        // If path starts with old root-level routes (no prefix), add prefix
        const oldRoutes = [
            '/sessions', '/issues', '/stability', '/monitor',
            '/growth', '/breakdowns', '/billing',
            '/alerts', '/team', '/account', '/settings',
            '/search'
        ];

        for (const oldRoute of oldRoutes) {
            if (path === oldRoute || path.startsWith(oldRoute + '/')) {
                return path.replace(oldRoute, `${prefix}${oldRoute}`);
            }
        }

        // If path doesn't match any known pattern, try to get tab info
        // Strip any existing prefix to check against TabRegistry patterns
        const pathWithoutPrefix = path.replace(/^\/(dashboard|demo)/, '');
        const tabInfo = TabRegistry.getTabInfo(pathWithoutPrefix);
        if (tabInfo) {
            // Path is valid - ensure it has the correct prefix
            if (path.startsWith('/dashboard/') || path.startsWith('/demo/')) {
                // Has prefix but might be wrong one - fix it
                if (path.startsWith('/dashboard/') && prefix === '/demo') {
                    return path.replace('/dashboard/', '/demo/');
                }
                if (path.startsWith('/demo/') && prefix === '/dashboard') {
                    return path.replace('/demo/', '/dashboard/');
                }
                return path; // Already has correct prefix
            }
            // No prefix - add it
            return `${prefix}${pathWithoutPrefix}`;
        }

        // If we can't normalize and it looks like a dashboard route, add prefix
        if (path.startsWith('/') && !path.startsWith('/dashboard') && !path.startsWith('/demo') &&
            !path.startsWith('/login') && !path.startsWith('/docs') &&
            !path.startsWith('/pricing') && !path.startsWith('/terms') &&
            !path.startsWith('/privacy') && !path.startsWith('/engineering') &&
            !path.startsWith('/invite') && path !== '/') {
            return `${prefix}${path}`;
        }

        return path;
    }, []);

    // Track which project we've loaded workspace for
    const loadedProjectIdRef = useRef<string | null>(null);
    const workspaceScopeKey = `${currentTeam?.id ?? 'no-team'}:${selectedProject?.id ?? 'no-project'}`;
    const previousScopeKeyRef = useRef(workspaceScopeKey);

    // Clear tab UI immediately when switching team/project so users do not see stale tabs.
    useEffect(() => {
        if (previousScopeKeyRef.current === workspaceScopeKey) return;
        previousScopeKeyRef.current = workspaceScopeKey;
        isScopeTransitionRef.current = true;
        skipRestoreForNextScopeRef.current = true;

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        loadedProjectIdRef.current = null;
        tabsRef.current = [];
        recentlyClosedRef.current = [];
        activeTabIdRef.current = '';

        const currentRouteInfo = isWarehousePath(location.pathname) ? null : TabRegistry.getTabInfo(location.pathname);
        const seededTab = currentRouteInfo ? annotateTabWithScope({
            id: currentRouteInfo.id,
            type: 'page',
            title: currentRouteInfo.title,
            path: location.pathname,
            isClosable: true,
            group: 'primary',
            icon: currentRouteInfo.icon,
        }) : null;

        setTabs(seededTab ? [seededTab] : []);
        setRecentlyClosed([]);
        setActiveTabId(seededTab ? seededTab.id : '');
        setSecondaryTabId(null);
        setIsSplitView(false);
        setHasLoaded(false);
    }, [workspaceScopeKey, location.pathname, annotateTabWithScope, setActiveTabId]);

    // Load workspace from backend on initial mount - wait for project to be ready
    useEffect(() => {
        // Don't load until project loading is complete
        if (isProjectLoading) return;

        // Skip if no project
        if (!selectedProject?.teamId || !selectedProject?.id) {
            isScopeTransitionRef.current = false;
            skipRestoreForNextScopeRef.current = false;
            setHasLoaded(true);
            return;
        }

        // Skip if we already loaded for this project
        if (loadedProjectIdRef.current === selectedProject.id) {
            return;
        }

        if (skipRestoreForNextScopeRef.current || isWarehousePath(location.pathname)) {
            loadedProjectIdRef.current = selectedProject.id;
            skipRestoreForNextScopeRef.current = false;
            isScopeTransitionRef.current = false;
            setHasLoaded(true);
            return;
        }

        let isCancelled = false;

        async function loadWorkspace() {
            try {
                loadedProjectIdRef.current = selectedProject!.id;
                const workspace = await getWorkspace(selectedProject!.teamId || '', selectedProject!.id || '');
                if (isCancelled) return;
                const prefix = getPathPrefix();

                if (workspace.tabs && workspace.tabs.length > 0) {
                    // Normalize all saved paths to ensure they have the correct prefix
                    const loadedTabs: Tab[] = workspace.tabs.map(t => {
                        const normalizedPath = normalizePath(t.path, prefix);
                        const canonicalTabInfo = TabRegistry.getTabInfo(normalizedPath);
                        return annotateTabWithScope({
                            id: canonicalTabInfo?.id || t.id,
                            type: 'page',
                            title: canonicalTabInfo?.title || t.title,
                            path: normalizedPath,
                            isClosable: true,
                            group: 'primary',
                        });
                    });
                    const loadedClosed: Tab[] = (workspace.recentlyClosed || []).map(t => {
                        const normalizedPath = normalizePath(t.path, prefix);
                        const canonicalTabInfo = TabRegistry.getTabInfo(normalizedPath);
                        return annotateTabWithScope({
                            id: canonicalTabInfo?.id || t.id,
                            type: 'page',
                            title: canonicalTabInfo?.title || t.title,
                            path: normalizedPath,
                            isClosable: true,
                            group: 'primary',
                        });
                    });
                    const resolveSavedActiveTabId = (): string | null => {
                        const savedId = workspace.activeTabId || null;
                        if (!savedId) return null;
                        if (loadedTabs.some(tab => tab.id === savedId)) return savedId;

                        const original = workspace.tabs.find(tab => tab.id === savedId);
                        if (original) {
                            const normalizedPath = normalizePath(original.path, prefix);
                            const canonicalInfo = TabRegistry.getTabInfo(normalizedPath);
                            if (canonicalInfo && loadedTabs.some(tab => tab.id === canonicalInfo.id)) {
                                return canonicalInfo.id;
                            }
                        }

                        // Legacy migration: older builds used duplicate "Replays" naming for /analytics/api.
                        const legacyReplayApiTab = workspace.tabs.find((tab) =>
                            tab.id === savedId && (tab.path.includes('/analytics/api') || tab.title.toLowerCase() === 'replays'),
                        );
                        if (legacyReplayApiTab && loadedTabs.some((tab) => tab.id === 'analytics-api')) {
                            return 'analytics-api';
                        }

                        return null;
                    };
                    const resolvedActiveTabId = resolveSavedActiveTabId();
                    const trimmed = trimTabsForLimits(
                        loadedTabs,
                        loadedClosed,
                        new Set([resolvedActiveTabId || ''])
                    );
                    setTabs(trimmed.tabs);
                    setRecentlyClosed(trimmed.recentlyClosed);

                    // Check if current URL is a valid registered route
                    const currentRouteInfo = TabRegistry.getTabInfo(location.pathname);

                    if (currentRouteInfo) {
                        // Current URL is valid - respect it (user refreshed or navigated directly)
                        // Make sure we have a tab for this route
                        const hasCurrentTab = trimmed.tabs.some(t => t.id === currentRouteInfo.id);
                        if (!hasCurrentTab) {
                            // Add current route as a new tab
                            const currentTabs = tabsRef.current;
                            const merged = [...currentTabs, annotateTabWithScope({
                                id: currentRouteInfo.id,
                                type: 'page' as const,
                                title: currentRouteInfo.title,
                                path: location.pathname,
                                isClosable: true,
                                group: 'primary',
                                icon: currentRouteInfo.icon,
                            })];
                            const mergedTrimmed = trimTabsForLimits(merged, recentlyClosedRef.current, new Set([currentRouteInfo.id]));
                            setTabs(mergedTrimmed.tabs);
                            setRecentlyClosed(mergedTrimmed.recentlyClosed);
                        }
                        setActiveTabId(currentRouteInfo.id);
                    } else if (resolvedActiveTabId) {
                        // Current URL is not a known route - fall back to saved active tab
                        const activeTab = trimmed.tabs.find(t => t.id === resolvedActiveTabId);

                        if (activeTab) {
                            // Don't restore sessions tab - always default to issues
                            if (activeTab.id === 'sessions' || activeTab.path.includes('/sessions')) {
                                navigate(`${prefix}/issues`, { replace: true });
                                setActiveTabId('issues');
                                return;
                            }

                            setActiveTabId(resolvedActiveTabId);

                            // Only navigate if we're not on a public page
                            const isPublicPage = location.pathname === '/' ||
                                location.pathname.startsWith('/docs') ||
                                location.pathname === '/terms-of-service' ||
                                location.pathname === '/privacy-policy';

                            // Verify the normalized path is valid before navigating
                            const tabInfo = TabRegistry.getTabInfo(activeTab.path);

                            if (tabInfo && location.pathname !== activeTab.path && !isPublicPage) {
                                navigate(activeTab.path, { replace: true });
                            } else if (!tabInfo) {
                                // Invalid path - redirect to issues instead
                                navigate(`${prefix}/issues`, { replace: true });
                            }
                        } else {
                            // Active tab not found - redirect to issues
                            navigate(`${prefix}/issues`, { replace: true });
                        }
                    } else {
                        // No saved active tab - redirect to issues if we're on a dashboard route
                        if (location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/demo')) {
                            const tabInfo = TabRegistry.getTabInfo(location.pathname);
                            if (!tabInfo) {
                                navigate(`${prefix}/issues`, { replace: true });
                            }
                        }
                    }
                } else {
                    // No persisted workspace yet for this project; seed from current route.
                    const currentRouteInfo = TabRegistry.getTabInfo(location.pathname);
                    if (currentRouteInfo) {
                        setTabs([annotateTabWithScope({
                            id: currentRouteInfo.id,
                            type: 'page',
                            title: currentRouteInfo.title,
                            path: location.pathname,
                            isClosable: true,
                            group: 'primary',
                            icon: currentRouteInfo.icon,
                        })]);
                        setRecentlyClosed([]);
                        setActiveTabId(currentRouteInfo.id);
                    }
                }
            } catch (err) {
                console.warn('Failed to load workspace:', err);
            } finally {
                if (!isCancelled) {
                    isScopeTransitionRef.current = false;
                    setHasLoaded(true);
                }
            }
        }
        loadWorkspace();
        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, isProjectLoading, getPathPrefix, normalizePath, location.pathname, navigate, setActiveTabId, annotateTabWithScope]); // Wait for project loading AND id

    // Auto-open tabs when URL changes based on TabRegistry
    // Skip the initial auto-open if we just loaded tabs from backend (to avoid overriding)
    useEffect(() => {
        if (!hasLoaded) return;

        const info = TabRegistry.getTabInfo(location.pathname);
        if (!info) return;
        const currentTabs = tabsRef.current;
        const existingTab = currentTabs.find((t) => t.id === info.id);
        if (existingTab) {
            if (existingTab.path !== location.pathname) {
                const updatedTabs = currentTabs.map(t => t.id === info.id ? annotateTabWithScope({ ...t, path: location.pathname }) : t);
                setTabs(updatedTabs);
            }
            setActiveTabId(info.id);
            return;
        }
        const merged = [...currentTabs, annotateTabWithScope({
            id: info.id,
            type: 'page',
            title: info.title,
            path: location.pathname,
            isClosable: true,
            group: 'primary',
            icon: info.icon,
        })];
        const trimmed = trimTabsForLimits(merged, recentlyClosedRef.current, new Set([info.id]));
        setTabs(trimmed.tabs);
        setRecentlyClosed(trimmed.recentlyClosed);
        setActiveTabId(info.id);
    }, [location.pathname, hasLoaded, setActiveTabId, annotateTabWithScope]);


    const openTab = useCallback((newTab: Omit<Tab, 'isClosable' | 'group'> & { isClosable?: boolean; group?: 'primary' | 'secondary' }) => {
        const currentTabs = tabsRef.current;
        const normalizedNewTab = annotateTabWithScope({
            ...newTab,
            isClosable: newTab.isClosable ?? true,
            group: newTab.group ?? 'primary',
        });
        const existingTab = currentTabs.find((t) => t.id === newTab.id);
        if (existingTab) {
            // Update path/title/group if needed
            let updatedTabs = currentTabs;
            if (existingTab.path !== newTab.path || existingTab.title !== newTab.title || (newTab.group && existingTab.group !== newTab.group)) {
                updatedTabs = currentTabs.map(t => t.id === newTab.id ? { ...normalizedNewTab, group: newTab.group || existingTab.group } : t);
                setTabs(updatedTabs);
            }

            if (normalizedNewTab.group === 'secondary') {
                setSecondaryTabId(newTab.id);
                setIsSplitView(true);
            } else {
                setActiveTabId(newTab.id);
            }
            return;
        }
        const merged = [...currentTabs, normalizedNewTab];
        const trimmed = trimTabsForLimits(merged, recentlyClosedRef.current, new Set([newTab.id]));
        setTabs(trimmed.tabs);
        setRecentlyClosed(trimmed.recentlyClosed);

        if (normalizedNewTab.group === 'secondary') {
            setSecondaryTabId(newTab.id);
            setIsSplitView(true);
        } else {
            setActiveTabId(newTab.id);
        }
    }, [setActiveTabId, annotateTabWithScope]);

    const closeTab = useCallback((id: string, event?: React.MouseEvent) => {
        if (event) {
            event.stopPropagation();
        }

        // Get current state from refs to avoid stale closure
        const currentTabs = tabsRef.current;
        const tabIndex = currentTabs.findIndex((t) => t.id === id);
        if (tabIndex === -1) return;

        const closedTab = currentTabs[tabIndex];
        const sameGroupTabs = currentTabs.filter(t => t.group === closedTab.group && t.id !== id);
        const newTabs = currentTabs.filter((t) => t.id !== id);

        // Update tabs first
        setTabs(newTabs);

        // Then add to recently closed (keep last 10)
        setRecentlyClosed(prev => appendRecentlyClosed(prev, [closedTab]));

        // Handle focus changes
        if (closedTab.group === 'primary') {
            if (activeTabIdRef.current === id) {
                const nextTab = sameGroupTabs[Math.min(tabIndex, sameGroupTabs.length - 1)] || sameGroupTabs[sameGroupTabs.length - 1];
                if (nextTab) {
                    setActiveTabId(nextTab.id);
                    navigate(nextTab.path, { replace: true });
                } else {
                    setActiveTabId('');
                    const prefix = getPathPrefix();
                    navigate(`${prefix}/issues`, { replace: true });
                }
            }
        } else {
            // Secondary group
            if (secondaryTabId === id) {
                const nextTab = sameGroupTabs[Math.min(tabIndex, sameGroupTabs.length - 1)] || sameGroupTabs[sameGroupTabs.length - 1];
                if (nextTab) {
                    setSecondaryTabId(nextTab.id);
                } else {
                    setSecondaryTabId(null);
                    setIsSplitView(false);
                }
            }
        }

    }, [navigate, setActiveTabId, getPathPrefix, secondaryTabId]);

    const closeAllTabs = useCallback(() => {
        const currentTabs = tabsRef.current;
        setRecentlyClosed(prev => appendRecentlyClosed(prev, currentTabs));
        setTabs([]);
        setActiveTabId('');
        setSecondaryTabId(null);
        setIsSplitView(false);
        navigate(`${getPathPrefix()}/issues`, { replace: true });
    }, [navigate, setActiveTabId, getPathPrefix]);

    const closeOtherTabs = useCallback((id: string) => {
        const currentTabs = tabsRef.current;
        const keepTab = currentTabs.find(t => t.id === id);
        if (!keepTab) return;

        const closedTabs = currentTabs.filter((t) => t.id !== id && t.isClosable);
        const remainingTabs = currentTabs.filter((t) => t.id === id || !t.isClosable);

        setRecentlyClosed(prev => appendRecentlyClosed(prev, closedTabs));
        setTabs(remainingTabs);

        if (secondaryTabId && secondaryTabId !== id && !remainingTabs.some(t => t.id === secondaryTabId)) {
            setSecondaryTabId(null);
            setIsSplitView(false);
        }

        if (keepTab.group === 'secondary') {
            if (remainingTabs.length === 1) {
                const updatedParams = { ...keepTab, group: 'primary' as const };
                setTabs([updatedParams]);
                setSecondaryTabId(null);
                setIsSplitView(false);
                setActiveTabId(updatedParams.id);
                navigate(updatedParams.path, { replace: true });
                return;
            }
        } else {
            setActiveTabId(id);
        }

    }, [setActiveTabId, secondaryTabId, navigate]);

    const closeStaleTabs = useCallback(() => {
        const currentTabs = tabsRef.current;
        const currentActiveId = activeTabIdRef.current;
        if (currentTabs.length <= STALE_TAB_KEEP_COUNT) return;

        const closable = currentTabs.filter(t => t.isClosable);
        if (closable.length <= STALE_TAB_KEEP_COUNT) return;

        const keepIds = new Set<string>([currentActiveId]);
        if (secondaryTabId) keepIds.add(secondaryTabId);

        for (let i = currentTabs.length - 1; i >= 0 && keepIds.size < STALE_TAB_KEEP_COUNT; i--) {
            keepIds.add(currentTabs[i].id);
        }

        const remainingTabs = currentTabs.filter(t => !t.isClosable || keepIds.has(t.id));
        const closedTabs = currentTabs.filter(t => t.isClosable && !keepIds.has(t.id));
        if (closedTabs.length === 0) return;

        setTabs(remainingTabs);
        setRecentlyClosed(prev => appendRecentlyClosed(prev, closedTabs));

        if (secondaryTabId && !remainingTabs.some(t => t.id === secondaryTabId)) {
            setSecondaryTabId(null);
            setIsSplitView(false);
        }
    }, [secondaryTabId]);

    const reorderTabs = useCallback((startIndex: number, endIndex: number, group: 'primary' | 'secondary') => {
        setTabs((prev) => {
            const groupTabs = prev.filter(t => t.group === group);
            const otherTabs = prev.filter(t => t.group !== group);

            if (startIndex < 0 || startIndex >= groupTabs.length || endIndex < 0 || endIndex >= groupTabs.length) {
                return prev;
            }

            const newGroupOrder = [...groupTabs];
            const [removed] = newGroupOrder.splice(startIndex, 1);
            newGroupOrder.splice(endIndex, 0, removed);

            if (group === 'primary') {
                return [...newGroupOrder, ...otherTabs];
            } else {
                return [...otherTabs, ...newGroupOrder];
            }
        });
    }, []);

    const reopenTab = useCallback(() => {
        const currentClosed = recentlyClosedRef.current;
        if (currentClosed.length === 0) return;

        const tabToReopen = annotateTabWithScope({
            ...currentClosed[currentClosed.length - 1],
            group: 'primary'
        });

        const remainingClosed = currentClosed.slice(0, -1);
        const reopened = [...tabsRef.current, tabToReopen];
        const trimmed = trimTabsForLimits(reopened, remainingClosed, new Set([tabToReopen.id]));
        setRecentlyClosed(trimmed.recentlyClosed);
        setTabs(trimmed.tabs);
        setActiveTabId(tabToReopen.id);
        navigate(tabToReopen.path, { replace: true });
    }, [navigate, setActiveTabId, annotateTabWithScope]);

    const openTabInSplit = useCallback((id: string) => {
        const currentTabs = tabsRef.current;
        const tab = currentTabs.find(t => t.id === id);
        if (!tab) return;

        const updatedTabs = currentTabs.map(t => t.id === id ? { ...t, group: 'secondary' as const } : t);
        setTabs(updatedTabs);

        setSecondaryTabId(id);
        setIsSplitView(true);

        if (activeTabIdRef.current === id) {
            const primaryTabs = updatedTabs.filter(t => t.group === 'primary');
            if (primaryTabs.length > 0) {
                const nextPrimary = primaryTabs[primaryTabs.length - 1];
                setActiveTabId(nextPrimary.id);
                navigate(nextPrimary.path, { replace: true });
            }
        }
    }, [navigate, setActiveTabId]);

    const moveTabToGroup = useCallback((id: string, group: 'primary' | 'secondary') => {
        const currentTabs = tabsRef.current;
        const tab = currentTabs.find(t => t.id === id);
        if (!tab || tab.group === group) return;

        const updatedTabs = currentTabs.map(t => t.id === id ? { ...t, group } : t);
        setTabs(updatedTabs);

        if (group === 'secondary') {
            setSecondaryTabId(id);
            setIsSplitView(true);
            if (activeTabIdRef.current === id) {
                const primaryTabs = updatedTabs.filter(t => t.group === 'primary');
                if (primaryTabs.length > 0) {
                    const nextPrimary = primaryTabs[primaryTabs.length - 1];
                    setActiveTabId(nextPrimary.id);
                    navigate(nextPrimary.path, { replace: true });
                }
            }
        } else {
            setActiveTabId(id);
            navigate(tab.path, { replace: true });

            if (secondaryTabId === id) {
                const secondaryTabs = updatedTabs.filter(t => t.group === 'secondary');
                if (secondaryTabs.length > 0) {
                    setSecondaryTabId(secondaryTabs[secondaryTabs.length - 1].id);
                } else {
                    setSecondaryTabId(null);
                    setIsSplitView(false);
                }
            }
        }
    }, [navigate, setActiveTabId, secondaryTabId]);

    const closeSplitView = useCallback(() => {
        const currentTabs = tabsRef.current;
        const updatedTabs = currentTabs.map(t => t.group === 'secondary' ? { ...t, group: 'primary' as const } : t);
        setTabs(updatedTabs);

        setSecondaryTabId(null);
        setIsSplitView(false);
    }, []);

    // Ensure split view stays valid when tabs change.
    useEffect(() => {
        if (isSplitView) {
            const hasSecondary = tabs.some(t => t.group === 'secondary');
            if (!hasSecondary) {
                setSecondaryTabId(null);
                setIsSplitView(false);
            }
        }
    }, [tabs, isSplitView]);

    return (
        <TabContext.Provider value={{
            tabs,
            activeTabId,
            recentlyClosed,
            isSplitView,
            secondaryTabId,
            splitRatio: splitRatioState,
            openTab,
            closeTab,
            closeAllTabs,
            closeOtherTabs,
            closeStaleTabs,
            openTabInSplit,
            moveTabToGroup,
            closeSplitView,
            setSplitRatio,
            setActiveTabId,
            reorderTabs,
            reopenTab,
            maxTabs: MAX_OPEN_TABS,
        }}>
            {children}
        </TabContext.Provider>
    );
};

export const useTabs = () => {
    const context = useContext(TabContext);
    if (context === undefined) {
        throw new Error('useTabs must be used within a TabProvider');
    }
    return context;
};
