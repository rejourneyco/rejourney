import React from 'react';
import { matchPath } from 'react-router';
import { IssuesFeed } from '../pages/IssuesFeed';
import { Growth } from '../pages/analytics/Growth';
import { RecordingsList } from '../pages/recordings/RecordingsList';
import { RecordingDetail } from '../pages/recordings/RecordingDetail';
import { CrashDetail } from '../pages/crashes/CrashDetail';
import { CrashesList } from '../pages/crashes/CrashesList';

import { ANRsList } from '../pages/anrs/ANRsList';
import { ErrorsList } from '../pages/errors/ErrorsList';
import { ErrorDetail } from '../pages/errors/ErrorDetail';

import { Geo } from '../pages/analytics/Geo';
import { ProjectSettings } from '../pages/projects/ProjectSettings';
import { TeamSettings } from '../pages/settings/TeamSettings';
import { AccountSettings } from '../pages/settings/AccountSettings';
import { BillingSettings } from '../pages/settings/BillingSettings';
import { ApiAnalytics } from '../pages/analytics/ApiAnalytics';
import { Devices } from '../pages/analytics/Devices';
import { Search } from '../pages/Search';
import { Journeys } from '../pages/analytics/Journeys';
import { AlertEmails } from '../pages/analytics/AlertEmails';

export interface TabInfo {
    id: string;
    title: string;
}

export interface TabDefinition extends TabInfo {
    Component: React.ComponentType<any>;
    props?: Record<string, any>;
}

// Route definitions for tab creation and component rendering
const routes: Array<{
    pattern: string;
    getInfo: (params: Record<string, string>) => TabInfo;
    Component: React.ComponentType<any>;
    getProps?: (params: Record<string, string>) => Record<string, any>;
}> = [
        { pattern: '/issues', getInfo: () => ({ id: 'issues', title: 'Issues' }), Component: IssuesFeed },
        // Analytics routes
        { pattern: '/analytics/api', getInfo: () => ({ id: 'analytics-api', title: 'API Insights' }), Component: ApiAnalytics },
        { pattern: '/analytics/growth', getInfo: () => ({ id: 'analytics-growth', title: 'Growth' }), Component: Growth },
        { pattern: '/analytics/journeys', getInfo: () => ({ id: 'analytics-journeys', title: 'User Journeys' }), Component: Journeys },
        { pattern: '/analytics/devices', getInfo: () => ({ id: 'analytics-devices', title: 'Devices' }), Component: Devices },
        { pattern: '/analytics/geo', getInfo: () => ({ id: 'analytics-geo', title: 'Geographic' }), Component: Geo },
        // Stability routes
        { pattern: '/stability/crashes', getInfo: () => ({ id: 'stability-crashes', title: 'Crashes' }), Component: CrashesList },
        { pattern: '/stability/anrs', getInfo: () => ({ id: 'stability-anrs', title: 'ANRs' }), Component: ANRsList },
        { pattern: '/stability/errors', getInfo: () => ({ id: 'stability-errors', title: 'Errors' }), Component: ErrorsList },
        // Sessions routes
        { pattern: '/sessions', getInfo: () => ({ id: 'sessions', title: 'Replays' }), Component: RecordingsList },
        // Alerts
        { pattern: '/alerts/emails', getInfo: () => ({ id: 'alerts-emails', title: 'Email Alerts' }), Component: AlertEmails },
        {
            pattern: '/sessions/:sessionId',
            getInfo: (p) => ({ id: `session-${p.sessionId}`, title: `Replay ${(p.sessionId || '').replace('session_', '').substring(0, 8)}...` }),
            Component: RecordingDetail,
            getProps: (p) => ({ sessionId: p.sessionId })
        },
        {
            pattern: '/stability/crashes/:projectId/:crashId',
            getInfo: (p) => ({ id: `crash-${p.crashId}`, title: `Crash ${(p.crashId || '').substring(0, 8)}...` }),
            Component: CrashDetail,
            getProps: (p) => ({ crashId: p.crashId, projectId: p.projectId })
        },
        {
            pattern: '/stability/errors/:projectId/:errorId',
            getInfo: (p) => ({ id: `error-${p.errorId}`, title: `Error ${(p.errorId || '').substring(0, 8)}...` }),
            Component: ErrorDetail,
            getProps: (p) => ({ errorId: p.errorId, projectId: p.projectId })
        },

        { pattern: '/team', getInfo: () => ({ id: 'team', title: 'Team' }), Component: TeamSettings },
        { pattern: '/billing', getInfo: () => ({ id: 'billing', title: 'Billing' }), Component: BillingSettings },
        { pattern: '/account', getInfo: () => ({ id: 'account', title: 'Account' }), Component: AccountSettings },
        // Settings with projectId
        {
            pattern: '/settings/:projectId',
            getInfo: (p) => ({ id: `settings-${p.projectId}`, title: 'Project Settings' }),
            Component: ProjectSettings,
            getProps: (p) => ({ projectId: p.projectId })
        },
        { pattern: '/search', getInfo: () => ({ id: 'search', title: 'New Tab' }), Component: Search },
    ];

export const TabRegistry = {
    // Get just the tab info (id, title) for a path - used by TabContext
    getTabInfo: (pathname: string): TabInfo | null => {
        // Strip /dashboard/ or /demo/ prefix before matching
        const pathWithoutPrefix = pathname.replace(/^\/(dashboard|demo)/, '');

        for (const route of routes) {
            const match = matchPath(route.pattern, pathWithoutPrefix);
            if (match) {
                return route.getInfo(match.params as Record<string, string>);
            }
        }
        return null;
    },

    // Get full definition including component - used for rendering
    resolve: (pathname: string): TabDefinition | null => {
        for (const route of routes) {
            const match = matchPath(route.pattern, pathname);
            if (match) {
                const params = match.params as Record<string, string>;
                const info = route.getInfo(params);
                return {
                    ...info,
                    Component: route.Component,
                    props: route.getProps?.(params)
                };
            }
        }
        return null;
    }
};
