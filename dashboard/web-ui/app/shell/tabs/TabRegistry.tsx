import React from 'react';
import { matchPath } from 'react-router';
import {
    Github,
    MessageSquareWarning,
    Play,
    Search as SearchIcon,
} from 'lucide-react';
import {
    getDashboardOverview,
    getApiOverview,
    getDevicesOverview,
    getGeoOverview,
    getJourneysOverview,
    getHeatmapsOverview,
    getErrorsOverview,
    getCrashesOverview,
    getANRsOverview,
    getSessionsPaginated,
} from '~/shared/api/client';
import { stripDashboardPathPrefix } from '~/shell/routing/dashboardRouteAliases';
import { DASHBOARD_PAGE_META } from '~/shell/navigation/dashboardPageMeta';

export interface TabInfo {
    id: string;
    title: string;
    icon?: React.ElementType;
}

export interface TabDefinition extends TabInfo {
    Component: React.ComponentType<any>;
    props?: Record<string, any>;
}

type TabPrefetchContext = {
    projectId?: string | null;
    timeRange?: string;
};

type RouteDefinition = {
    pattern: string;
    getInfo: (params: Record<string, string>) => TabInfo;
    Component: React.ComponentType<any>;
    loadComponent?: () => Promise<unknown>;
    getProps?: (params: Record<string, string>) => Record<string, any>;
    prefetchData?: (context: TabPrefetchContext) => Promise<unknown>;
};

const DEFAULT_PREFETCH_TIME_RANGE = '30d';

const loadGeneralOverview = () => import('~/features/app/general/index/route').then((module) => ({ default: module.GeneralOverview }));
const loadIssueDetail = () => import('~/features/app/general/detail/route').then((module) => ({ default: module.IssueDetail }));
const loadRecordingsList = () => import('~/features/app/sessions/index/route').then((module) => ({ default: module.RecordingsList }));
const loadRecordingDetail = () => import('~/features/app/sessions/detail/route').then((module) => ({ default: module.RecordingDetail }));
const loadApiAnalytics = () => import('~/features/app/analytics/api/route').then((module) => ({ default: module.ApiAnalytics }));
const loadDevices = () => import('~/features/app/analytics/devices/route').then((module) => ({ default: module.Devices }));
const loadGeo = () => import('~/features/app/analytics/geo/route').then((module) => ({ default: module.Geo }));
const loadJourneys = () => import('~/features/app/analytics/journeys/route').then((module) => ({ default: module.Journeys }));
const loadHeatmaps = () => import('~/features/app/analytics/heatmaps/route').then((module) => ({ default: module.Heatmaps }));
const loadLeaks = () => import('~/features/app/automations/leaks/route').then((module) => ({ default: module.Leaks }));
const loadAlertEmails = () => import('~/features/app/alerts/email/route').then((module) => ({ default: module.AlertEmails }));
const loadSetup = () => import('~/features/app/setup/route').then((module) => ({ default: module.SetupRoute }));
const loadStability = () => import('~/features/app/stability/index/route').then((module) => ({ default: module.Stability }));
const loadTeamSettings = () => import('~/features/app/team/route').then((module) => ({ default: module.TeamSettings }));
const loadBillingSettings = () => import('~/features/app/billing/route').then((module) => ({ default: module.BillingSettings }));
const loadAccountSettings = () => import('~/features/app/account/route').then((module) => ({ default: module.AccountSettings }));
const loadProjectSettings = () => import('~/features/app/settings/project/route').then((module) => ({ default: module.ProjectSettings }));
const loadGithubSetup = () => import('~/features/app/settings/github/route').then((module) => ({ default: module.GithubSetup }));
const loadSearch = () => import('~/features/app/search/route').then((module) => ({ default: module.Search }));

const routes: RouteDefinition[] = [
    {
        pattern: '/general',
        getInfo: () => ({ id: 'general', title: DASHBOARD_PAGE_META.general.tabTitle, icon: DASHBOARD_PAGE_META.general.icon }),
        Component: React.lazy(loadGeneralOverview),
        loadComponent: loadGeneralOverview,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getDashboardOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/general/:issueId',
        getInfo: (p) => ({ id: `issue-${p.issueId}`, title: `Issue ${(p.issueId || '').substring(0, 8)}...`, icon: MessageSquareWarning }),
        Component: React.lazy(loadIssueDetail),
        loadComponent: loadIssueDetail,
        getProps: (p) => ({ issueId: p.issueId }),
    },
    { pattern: '/issues', getInfo: () => ({ id: 'general', title: DASHBOARD_PAGE_META.general.tabTitle, icon: DASHBOARD_PAGE_META.general.icon }), Component: React.lazy(loadGeneralOverview), loadComponent: loadGeneralOverview },
    {
        pattern: '/issues/:issueId',
        getInfo: (p) => ({ id: `issue-${p.issueId}`, title: `Issue ${(p.issueId || '').substring(0, 8)}...`, icon: MessageSquareWarning }),
        Component: React.lazy(loadIssueDetail),
        loadComponent: loadIssueDetail,
        getProps: (p) => ({ issueId: p.issueId }),
    },
    {
        pattern: '/api',
        getInfo: () => ({ id: 'analytics-api', title: DASHBOARD_PAGE_META.api.tabTitle, icon: DASHBOARD_PAGE_META.api.icon }),
        Component: React.lazy(loadApiAnalytics),
        loadComponent: loadApiAnalytics,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getApiOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/journeys',
        getInfo: () => ({ id: 'analytics-journeys', title: DASHBOARD_PAGE_META.journeys.tabTitle, icon: DASHBOARD_PAGE_META.journeys.icon }),
        Component: React.lazy(loadJourneys),
        loadComponent: loadJourneys,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getJourneysOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/heatmaps',
        getInfo: () => ({ id: 'analytics-heatmaps', title: DASHBOARD_PAGE_META.heatmaps.tabTitle, icon: DASHBOARD_PAGE_META.heatmaps.icon }),
        Component: React.lazy(loadHeatmaps),
        loadComponent: loadHeatmaps,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getHeatmapsOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/devices',
        getInfo: () => ({ id: 'analytics-devices', title: DASHBOARD_PAGE_META.devices.tabTitle, icon: DASHBOARD_PAGE_META.devices.icon }),
        Component: React.lazy(loadDevices),
        loadComponent: loadDevices,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getDevicesOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/geo',
        getInfo: () => ({ id: 'analytics-geo', title: DASHBOARD_PAGE_META.geo.tabTitle, icon: DASHBOARD_PAGE_META.geo.icon }),
        Component: React.lazy(loadGeo),
        loadComponent: loadGeo,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getGeoOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/stability',
        getInfo: () => ({ id: 'stability', title: DASHBOARD_PAGE_META.stability.tabTitle, icon: DASHBOARD_PAGE_META.stability.icon }),
        Component: React.lazy(loadStability),
        loadComponent: loadStability,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            const range = timeRange || DEFAULT_PREFETCH_TIME_RANGE;
            await Promise.allSettled([
                getCrashesOverview(projectId, range),
                getANRsOverview(projectId, range),
                getErrorsOverview(projectId, range),
            ]);
        },
    },
    {
        pattern: '/leaks',
        getInfo: () => ({ id: 'leaks', title: DASHBOARD_PAGE_META.leaks.tabTitle, icon: DASHBOARD_PAGE_META.leaks.icon }),
        Component: React.lazy(loadLeaks),
        loadComponent: loadLeaks,
    },
    {
        pattern: '/sessions',
        getInfo: () => ({ id: 'sessions', title: DASHBOARD_PAGE_META.sessions.tabTitle, icon: DASHBOARD_PAGE_META.sessions.icon }),
        Component: React.lazy(loadRecordingsList),
        loadComponent: loadRecordingsList,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getSessionsPaginated({
                projectId,
                timeRange: timeRange || DEFAULT_PREFETCH_TIME_RANGE,
                limit: 50,
                includeTotal: false,
                hasRecording: true,
            });
        },
    },
    {
        pattern: '/alerts/emails',
        getInfo: () => ({ id: 'alerts-emails', title: DASHBOARD_PAGE_META.emails.tabTitle, icon: DASHBOARD_PAGE_META.emails.icon }),
        Component: React.lazy(loadAlertEmails),
        loadComponent: loadAlertEmails,
    },
    {
        pattern: '/setup',
        getInfo: () => ({ id: 'setup', title: DASHBOARD_PAGE_META.setup.tabTitle, icon: DASHBOARD_PAGE_META.setup.icon }),
        Component: React.lazy(loadSetup),
        loadComponent: loadSetup,
    },
    {
        pattern: '/sessions/:sessionId',
        getInfo: (p) => ({ id: `session-${p.sessionId}`, title: `Replay ${(p.sessionId || '').replace('session_', '').substring(0, 8)}...`, icon: Play }),
        Component: React.lazy(loadRecordingDetail),
        loadComponent: loadRecordingDetail,
        getProps: (p) => ({ sessionId: p.sessionId }),
    },
    { pattern: '/team', getInfo: () => ({ id: 'team', title: DASHBOARD_PAGE_META.team.tabTitle, icon: DASHBOARD_PAGE_META.team.icon }), Component: React.lazy(loadTeamSettings), loadComponent: loadTeamSettings },
    { pattern: '/billing', getInfo: () => ({ id: 'billing', title: DASHBOARD_PAGE_META.billing.tabTitle, icon: DASHBOARD_PAGE_META.billing.icon }), Component: React.lazy(loadBillingSettings), loadComponent: loadBillingSettings },
    { pattern: '/account', getInfo: () => ({ id: 'account', title: DASHBOARD_PAGE_META.account.tabTitle, icon: DASHBOARD_PAGE_META.account.icon }), Component: React.lazy(loadAccountSettings), loadComponent: loadAccountSettings },
    {
        pattern: '/settings/:projectId/github',
        getInfo: (p) => ({ id: `github-settings-${p.projectId}`, title: 'GitHub Setup', icon: Github }),
        Component: React.lazy(loadGithubSetup),
        loadComponent: loadGithubSetup,
        getProps: (p) => ({ projectId: p.projectId }),
    },
    {
        pattern: '/settings/:projectId',
        getInfo: (p) => ({ id: `settings-${p.projectId}`, title: DASHBOARD_PAGE_META.project.tabTitle, icon: DASHBOARD_PAGE_META.project.icon }),
        Component: React.lazy(loadProjectSettings),
        loadComponent: loadProjectSettings,
        getProps: (p) => ({ projectId: p.projectId }),
    },
    { pattern: '/search', getInfo: () => ({ id: 'search', title: 'New Tab', icon: SearchIcon }), Component: React.lazy(loadSearch), loadComponent: loadSearch },
];

function findRoute(pathname: string): RouteDefinition | null {
    const pathWithoutPrefix = stripDashboardPathPrefix(pathname);
    for (const route of routes) {
        if (matchPath(route.pattern, pathWithoutPrefix)) {
            return route;
        }
    }
    return null;
}

export const TabRegistry = {
    getTabInfo: (pathname: string): TabInfo | null => {
        const pathWithoutPrefix = stripDashboardPathPrefix(pathname);

        for (const route of routes) {
            const match = matchPath(route.pattern, pathWithoutPrefix);
            if (match) {
                return route.getInfo(match.params as Record<string, string>);
            }
        }
        return null;
    },

    resolve: (pathname: string): TabDefinition | null => {
        const pathWithoutPrefix = stripDashboardPathPrefix(pathname);
        for (const route of routes) {
            const match = matchPath(route.pattern, pathWithoutPrefix);
            if (match) {
                const params = match.params as Record<string, string>;
                const info = route.getInfo(params);
                return {
                    ...info,
                    Component: route.Component,
                    props: route.getProps?.(params),
                };
            }
        }
        return null;
    },

    prefetch: (pathname: string, context: TabPrefetchContext = {}): void => {
        const route = findRoute(pathname);
        if (!route) return;

        if (route.loadComponent) {
            void route.loadComponent();
        }
        if (route.prefetchData) {
            void route.prefetchData(context);
        }
    },
};
