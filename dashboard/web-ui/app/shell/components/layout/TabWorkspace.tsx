import React, { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { ErrorBoundary as ClientErrorBoundary } from '~/shared/ui/core/ErrorBoundary';

interface TabWorkspaceProps {
    children: React.ReactNode;
}

const PANE_ERROR_FALLBACK_CLASS = 'flex h-full min-h-[360px] items-center justify-center bg-background p-8';

function stripPathPrefix(pathname: string): string {
    return pathname.replace(/^\/(dashboard|demo)/, '') || '/general';
}

function getPaneBodyClass(routeWithoutPrefix: string): string {
    const usesViewportFit = routeWithoutPrefix.startsWith('/analytics/heatmaps');
    const usesReplayWorkbench = /^\/sessions\/[^/]+/.test(routeWithoutPrefix);

    if (usesReplayWorkbench) {
        return 'relative flex-1 min-h-0 overflow-x-hidden overflow-y-auto pb-0 pt-0 xl:overflow-hidden xl:pb-0';
    }

    const desktopOverflow = usesViewportFit
        ? 'overflow-y-auto pb-10 xl:overflow-hidden xl:pb-0'
        : 'overflow-y-auto pb-10';

    return `relative flex-1 min-h-0 overflow-x-hidden pt-0 ${desktopOverflow}`;
}

export const TabWorkspace: React.FC<TabWorkspaceProps> = ({ children }) => {
    const location = useLocation();
    const routeWithoutPrefix = useMemo(() => stripPathPrefix(location.pathname), [location.pathname]);
    const hideTabChrome = routeWithoutPrefix.startsWith('/warehouse');
    const primaryScrollRef = useRef<HTMLDivElement | null>(null);
    const primaryPaneBodyClass = getPaneBodyClass(routeWithoutPrefix);
    const primaryPaneKey = `${location.pathname}${location.search}`;
    const primaryPaneContent = (
        <ClientErrorBoundary key={`primary:${primaryPaneKey}`} fallbackClassName={PANE_ERROR_FALLBACK_CLASS}>
            {children}
        </ClientErrorBoundary>
    );

    // Each dashboard page should open from the top when route changes.
    useEffect(() => {
        const container = primaryScrollRef.current;
        if (!container) return;
        container.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, [location.pathname]);

    if (hideTabChrome) {
        return (
            <div className="flex h-full min-h-0 flex-col bg-transparent">
                <div className="min-h-0 flex-1 overflow-hidden">{primaryPaneContent}</div>
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-transparent">
            <div className={primaryPaneBodyClass} ref={primaryScrollRef}>
                {primaryPaneContent}
            </div>
        </div>
    );
};
