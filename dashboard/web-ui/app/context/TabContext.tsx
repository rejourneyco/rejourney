import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { TabRegistry } from '../config/TabRegistry';
import { useSessionData } from './SessionContext';
import { getWorkspace, saveWorkspace, WorkspaceTab } from '../services/api';

export interface Tab {
    id: string;
    type: string;
    title: string;
    path: string;
    component?: React.ReactNode;
    isClosable: boolean;
    scrollPosition?: number;
}

interface TabContextType {
    tabs: Tab[];
    activeTabId: string;
    recentlyClosed: Tab[];
    openTab: (tab: Omit<Tab, 'isClosable'> & { isClosable?: boolean }) => void;
    closeTab: (id: string, event?: React.MouseEvent) => void;
    closeAllTabs: () => void;
    closeOtherTabs: (id: string) => void;
    setActiveTabId: (id: string) => void;
    reorderTabs: (startIndex: number, endIndex: number) => void;
    reopenTab: () => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabIdState] = useState<string>('');
    const [recentlyClosed, setRecentlyClosed] = useState<Tab[]>([]);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [loadedFromBackend, setLoadedFromBackend] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const { selectedProject, isLoading: isProjectLoading } = useSessionData();

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
                        return {
                            id: t.id,
                            type: 'page',
                            title: t.title,
                            path: normalizedPath,
                            isClosable: true,
                        };
                    });
                    const loadedClosed: Tab[] = (workspace.recentlyClosed || []).map(t => {
                        const normalizedPath = normalizePath(t.path, prefix);
                        return {
                            id: t.id,
                            type: 'page',
                            title: t.title,
                            path: normalizedPath,
                            isClosable: true,
                        };
                    });
                    setTabs(loadedTabs);
                    setRecentlyClosed(loadedClosed);
                    setLoadedFromBackend(true);

                    // Check if current URL is a valid registered route
                    const currentRouteInfo = TabRegistry.getTabInfo(location.pathname);

                    if (currentRouteInfo) {
                        // Current URL is valid - respect it (user refreshed or navigated directly)
                        // Make sure we have a tab for this route
                        const hasCurrentTab = loadedTabs.some(t => t.id === currentRouteInfo.id);
                        if (!hasCurrentTab) {
                            // Add current route as a new tab
                            setTabs(prev => [...prev, {
                                id: currentRouteInfo.id,
                                type: 'page',
                                title: currentRouteInfo.title,
                                path: location.pathname,
                                isClosable: true,
                            }]);
                        }
                        setActiveTabId(currentRouteInfo.id);
                    } else if (workspace.activeTabId) {
                        // Current URL is not a known route - fall back to saved active tab
                        const activeTab = loadedTabs.find(t => t.id === workspace.activeTabId);

                        if (activeTab) {
                            // Don't restore sessions tab - always default to issues
                            if (activeTab.id === 'sessions' || activeTab.path.includes('/sessions')) {
                                navigate(`${prefix}/issues`, { replace: true });
                                setActiveTabId('issues');
                                return;
                            }

                            setActiveTabId(workspace.activeTabId);

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
    }, [selectedProject?.id, isProjectLoading, getPathPrefix, normalizePath, location.pathname, navigate, setActiveTabId]); // Wait for project loading AND id

    // Auto-open tabs when URL changes based on TabRegistry
    // Skip the initial auto-open if we just loaded tabs from backend (to avoid overriding)
    useEffect(() => {
        if (!hasLoaded) return;

        const info = TabRegistry.getTabInfo(location.pathname);
        if (!info) return;

        setTabs((prevTabs) => {
            const existingTab = prevTabs.find((t) => t.id === info.id);
            if (existingTab) {
                // Tab exists - update path if needed
                if (existingTab.path !== location.pathname) {
                    return prevTabs.map(t => t.id === info.id ? { ...t, path: location.pathname } : t);
                }
                return prevTabs;
            }
            // New tab - add it
            return [...prevTabs, { id: info.id, type: 'page', title: info.title, path: location.pathname, isClosable: true }];
        });
        setActiveTabId(info.id);
    }, [location.pathname, hasLoaded, setActiveTabId]);


    const openTab = useCallback((newTab: Omit<Tab, 'isClosable'> & { isClosable?: boolean }) => {
        setTabs((prevTabs) => {
            const existingTab = prevTabs.find((t) => t.id === newTab.id);
            if (existingTab) {
                // Tab already exists - update path if changed
                if (existingTab.path !== newTab.path) {
                    return prevTabs.map(t => t.id === newTab.id ? { ...t, ...newTab, isClosable: newTab.isClosable ?? true } : t);
                }
                return prevTabs;
            }
            return [...prevTabs, { ...newTab, isClosable: newTab.isClosable ?? true }];
        });
        setActiveTabId(newTab.id);
    }, [setActiveTabId]);

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
        setRecentlyClosed(prev => [...prev.slice(-9), closedTab]);

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
    }, [navigate, setActiveTabId, getPathPrefix]);

    const closeAllTabs = useCallback(() => {
        const currentTabs = tabsRef.current;
        setRecentlyClosed(prev => [...prev.slice(-10 + currentTabs.length), ...currentTabs]);
        setTabs([]);
        setActiveTabId('');
        navigate(`${getPathPrefix()}/issues`, { replace: true });
    }, [navigate, setActiveTabId, getPathPrefix]);

    const closeOtherTabs = useCallback((id: string) => {
        const currentTabs = tabsRef.current;
        const closedTabs = currentTabs.filter((t) => t.id !== id && t.isClosable);
        const remainingTabs = currentTabs.filter((t) => t.id === id || !t.isClosable);
        setRecentlyClosed(prev => [...prev.slice(-10 + closedTabs.length), ...closedTabs]);
        setTabs(remainingTabs);
        setActiveTabId(id);
    }, [setActiveTabId]);

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
        const tabToReopen = currentClosed[currentClosed.length - 1];
        setRecentlyClosed(prev => prev.slice(0, -1));
        setTabs(prev => [...prev, tabToReopen]);
        setActiveTabId(tabToReopen.id);
        navigate(tabToReopen.path, { replace: true });
    }, [navigate, setActiveTabId]);

    return (
        <TabContext.Provider value={{
            tabs,
            activeTabId,
            recentlyClosed,
            openTab,
            closeTab,
            closeAllTabs,
            closeOtherTabs,
            setActiveTabId,
            reorderTabs,
            reopenTab
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
