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
}

interface TabContextType {
    tabs: Tab[];
    activeTabId: string;
    recentlyClosed: Tab[];
    isSplitView: boolean;
    secondaryTabId: string | null;
    splitRatio: number;
    openTab: (tab: Omit<Tab, 'isClosable'> & { isClosable?: boolean }) => void;
    closeTab: (id: string, event?: React.MouseEvent) => void;
    closeAllTabs: () => void;
    closeOtherTabs: (id: string) => void;
    closeStaleTabs: () => void;
    openTabInSplit: (id: string) => void;
    closeSplitView: () => void;
    setSplitRatio: (ratio: number) => void;
    setActiveTabId: (id: string) => void;
    reorderTabs: (startIndex: number, endIndex: number) => void;
    reopenTab: () => void;
    maxTabs: number;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

const MAX_OPEN_TABS = 14;
const MAX_DETAIL_TABS = 6;
const STALE_TAB_KEEP_COUNT = 6;
const RECENTLY_CLOSED_LIMIT = 10;

function isDetailTab(tabId: string): boolean {
    return tabId.startsWith('session-') || tabId.startsWith('crash-') || tabId.startsWith('error-');
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
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isSavingRef = useRef(false);

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
    }), [selectedProject?.id, selectedProject?.name, selectedProject?.teamId, currentTeam?.id, currentTeam?.name]);

    // Save workspace state to backend (debounced using refs to avoid stale closures)
    const saveToBackend = useCallback(() => {
        if (!selectedProject?.teamId || !selectedProject?.id) return;

        // Clear any pending save
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Debounce: wait 1 second before saving
        saveTimeoutRef.current = setTimeout(async () => {
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
        if (hasLoaded && selectedProject) {
            saveToBackend();
        }
    }, [tabs, activeTabId, recentlyClosed, hasLoaded, selectedProject, saveToBackend]);

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

        loadedProjectIdRef.current = null;
        tabsRef.current = [];
        recentlyClosedRef.current = [];
        activeTabIdRef.current = '';

        setTabs([]);
        setRecentlyClosed([]);
        setActiveTabId('');
        setSecondaryTabId(null);
        setIsSplitView(false);
        setHasLoaded(false);
    }, [workspaceScopeKey, setActiveTabId]);

    // Load workspace from backend on initial mount - wait for project to be ready
    useEffect(() => {
        // Don't load until project loading is complete
        if (isProjectLoading) return;

        // Skip if no project
        if (!selectedProject?.teamId || !selectedProject?.id) {
            setHasLoaded(true);
            return;
        }

        // Skip if we already loaded for this project
        if (loadedProjectIdRef.current === selectedProject.id) {
            return;
        }

        async function loadWorkspace() {
            try {
                loadedProjectIdRef.current = selectedProject!.id;
                const workspace = await getWorkspace(selectedProject!.teamId || '', selectedProject!.id || '');
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
                }
            } catch (err) {
                console.warn('Failed to load workspace:', err);
            } finally {
                setHasLoaded(true);
            }
        }
        loadWorkspace();
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
        })];
        const trimmed = trimTabsForLimits(merged, recentlyClosedRef.current, new Set([info.id]));
        setTabs(trimmed.tabs);
        setRecentlyClosed(trimmed.recentlyClosed);
        setActiveTabId(info.id);
    }, [location.pathname, hasLoaded, setActiveTabId, annotateTabWithScope]);


    const openTab = useCallback((newTab: Omit<Tab, 'isClosable'> & { isClosable?: boolean }) => {
        const currentTabs = tabsRef.current;
        const normalizedNewTab = annotateTabWithScope({ ...newTab, isClosable: newTab.isClosable ?? true });
        const existingTab = currentTabs.find((t) => t.id === newTab.id);
        if (existingTab) {
            if (existingTab.path !== newTab.path || existingTab.title !== newTab.title) {
                setTabs(currentTabs.map(t => t.id === newTab.id ? normalizedNewTab : t));
            }
            setActiveTabId(newTab.id);
            return;
        }
        const merged = [...currentTabs, normalizedNewTab];
        const trimmed = trimTabsForLimits(merged, recentlyClosedRef.current, new Set([newTab.id]));
        setTabs(trimmed.tabs);
        setRecentlyClosed(trimmed.recentlyClosed);
        setActiveTabId(newTab.id);
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
        const newTabs = currentTabs.filter((t) => t.id !== id);
        const currentActiveId = activeTabIdRef.current;

        // Update tabs first
        setTabs(newTabs);

        // Then add to recently closed (keep last 10)
        setRecentlyClosed(prev => appendRecentlyClosed(prev, [closedTab]));

        // Close split pane if its tab is closed.
        if (secondaryTabId === id) {
            setSecondaryTabId(null);
            setIsSplitView(false);
        }

        // If closing active tab, switch to adjacent tab
        if (id === currentActiveId && newTabs.length > 0) {
            const nextTab = newTabs[Math.min(tabIndex, newTabs.length - 1)];
            if (nextTab) {
                setActiveTabId(nextTab.id);
                navigate(nextTab.path, { replace: true });
            }
        } else if (newTabs.length === 0) {
            // No tabs left - navigate to issues (default page)
            setActiveTabId('');
            const prefix = getPathPrefix();
            navigate(`${prefix}/issues`, { replace: true });
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
        const closedTabs = currentTabs.filter((t) => t.id !== id && t.isClosable);
        const remainingTabs = currentTabs.filter((t) => t.id === id || !t.isClosable);
        setRecentlyClosed(prev => appendRecentlyClosed(prev, closedTabs));
        setTabs(remainingTabs);
        setActiveTabId(id);
        if (secondaryTabId && secondaryTabId !== id && !remainingTabs.some(t => t.id === secondaryTabId)) {
            setSecondaryTabId(null);
            setIsSplitView(false);
        }
    }, [setActiveTabId, secondaryTabId]);

    const closeStaleTabs = useCallback(() => {
        const currentTabs = tabsRef.current;
        const currentActiveId = activeTabIdRef.current;
        if (currentTabs.length <= STALE_TAB_KEEP_COUNT) return;

        const closable = currentTabs.filter(t => t.isClosable);
        if (closable.length <= STALE_TAB_KEEP_COUNT) return;

        // Keep the newest tabs plus current active tab.
        const keepIds = new Set<string>([currentActiveId]);
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

    const reorderTabs = useCallback((startIndex: number, endIndex: number) => {
        setTabs((prev) => {
            const result = Array.from(prev);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            return result;
        });
    }, []);

    const reopenTab = useCallback(() => {
        const currentClosed = recentlyClosedRef.current;
        if (currentClosed.length === 0) return;
        const tabToReopen = annotateTabWithScope(currentClosed[currentClosed.length - 1]);
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
        if (!currentTabs.some(t => t.id === id)) return;

        let nextSecondaryId = id;
        const currentActiveId = activeTabIdRef.current;
        if (id === currentActiveId) {
            const alternative = [...currentTabs].reverse().find(t => t.id !== currentActiveId);
            if (!alternative) return;
            nextSecondaryId = alternative.id;
        }

        setSecondaryTabId(nextSecondaryId);
        setIsSplitView(true);
    }, []);

    const closeSplitView = useCallback(() => {
        setSecondaryTabId(null);
        setIsSplitView(false);
    }, []);

    // Ensure split view stays valid when tabs change.
    useEffect(() => {
        if (!secondaryTabId) return;
        const exists = tabs.some(t => t.id === secondaryTabId);
        if (!exists) {
            setSecondaryTabId(null);
            setIsSplitView(false);
        }
    }, [tabs, secondaryTabId]);

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
