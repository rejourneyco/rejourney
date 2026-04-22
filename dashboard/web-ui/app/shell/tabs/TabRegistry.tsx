import React from 'react';
import { matchPath } from 'react-router';
import {
    MessageSquareWarning,
    Database,
    Activity,
    Map,
    Smartphone,
    Globe,
    Flame,
    AlertOctagon,
    Clock,
    Terminal,
    Mail,
    Play,
    Settings,
    Users,
    CreditCard,
    User,
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
const loadAlertEmails = () => import('~/features/app/alerts/email/route').then((module) => ({ default: module.AlertEmails }));
const loadCrashesList = () => import('~/features/app/stability/crashes/index/route').then((module) => ({ default: module.CrashesList }));
const loadCrashDetail = () => import('~/features/app/stability/crashes/detail/route').then((module) => ({ default: module.CrashDetail }));
const loadANRsList = () => import('~/features/app/stability/anrs/index/route').then((module) => ({ default: module.ANRsList }));
const loadANRDetail = () => import('~/features/app/stability/anrs/detail/route').then((module) => ({ default: module.ANRDetail }));
const loadErrorsList = () => import('~/features/app/stability/errors/index/route').then((module) => ({ default: module.ErrorsList }));
const loadErrorDetail = () => import('~/features/app/stability/errors/detail/route').then((module) => ({ default: module.ErrorDetail }));
const loadTeamSettings = () => import('~/features/app/team/route').then((module) => ({ default: module.TeamSettings }));
const loadBillingSettings = () => import('~/features/app/billing/route').then((module) => ({ default: module.BillingSettings }));
const loadAccountSettings = () => import('~/features/app/account/route').then((module) => ({ default: module.AccountSettings }));
const loadProjectSettings = () => import('~/features/app/settings/project/route').then((module) => ({ default: module.ProjectSettings }));
const loadSearch = () => import('~/features/app/search/route').then((module) => ({ default: module.Search }));

const routes: RouteDefinition[] = [
    {
        pattern: '/general',
        getInfo: () => ({ id: 'general', title: 'General', icon: MessageSquareWarning }),
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
    { pattern: '/issues', getInfo: () => ({ id: 'general', title: 'General', icon: MessageSquareWarning }), Component: React.lazy(loadGeneralOverview), loadComponent: loadGeneralOverview },
    {
        pattern: '/issues/:issueId',
        getInfo: (p) => ({ id: `issue-${p.issueId}`, title: `Issue ${(p.issueId || '').substring(0, 8)}...`, icon: MessageSquareWarning }),
        Component: React.lazy(loadIssueDetail),
        loadComponent: loadIssueDetail,
        getProps: (p) => ({ issueId: p.issueId }),
    },
    {
        pattern: '/analytics/api',
        getInfo: () => ({ id: 'analytics-api', title: 'API Insights', icon: Activity }),
        Component: React.lazy(loadApiAnalytics),
        loadComponent: loadApiAnalytics,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getApiOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/analytics/journeys',
        getInfo: () => ({ id: 'analytics-journeys', title: 'User Journeys', icon: Map }),
        Component: React.lazy(loadJourneys),
        loadComponent: loadJourneys,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getJourneysOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/analytics/heatmaps',
        getInfo: () => ({ id: 'analytics-heatmaps', title: 'Heatmaps', icon: Flame }),
        Component: React.lazy(loadHeatmaps),
        loadComponent: loadHeatmaps,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getHeatmapsOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/analytics/devices',
        getInfo: () => ({ id: 'analytics-devices', title: 'Devices', icon: Smartphone }),
        Component: React.lazy(loadDevices),
        loadComponent: loadDevices,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getDevicesOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/analytics/geo',
        getInfo: () => ({ id: 'analytics-geo', title: 'Geographic', icon: Globe }),
        Component: React.lazy(loadGeo),
        loadComponent: loadGeo,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getGeoOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/stability/crashes',
        getInfo: () => ({ id: 'stability-crashes', title: 'Crashes', icon: AlertOctagon }),
        Component: React.lazy(loadCrashesList),
        loadComponent: loadCrashesList,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getCrashesOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/stability/anrs',
        getInfo: () => ({ id: 'stability-anrs', title: 'ANRs', icon: Clock }),
        Component: React.lazy(loadANRsList),
        loadComponent: loadANRsList,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getANRsOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/stability/errors',
        getInfo: () => ({ id: 'stability-errors', title: 'Errors', icon: Terminal }),
        Component: React.lazy(loadErrorsList),
        loadComponent: loadErrorsList,
        prefetchData: async ({ projectId, timeRange }) => {
            if (!projectId) return;
            await getErrorsOverview(projectId, timeRange || DEFAULT_PREFETCH_TIME_RANGE);
        },
    },
    {
        pattern: '/sessions',
        getInfo: () => ({ id: 'sessions', title: 'Replays', icon: Database }),
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
        getInfo: () => ({ id: 'alerts-emails', title: 'Email Alerts', icon: Mail }),
        Component: React.lazy(loadAlertEmails),
        loadComponent: loadAlertEmails,
    },
    {
        pattern: '/sessions/:sessionId',
        getInfo: (p) => ({ id: `session-${p.sessionId}`, title: `Replay ${(p.sessionId || '').replace('session_', '').substring(0, 8)}...`, icon: Play }),
        Component: React.lazy(loadRecordingDetail),
        loadComponent: loadRecordingDetail,
        getProps: (p) => ({ sessionId: p.sessionId }),
    },
    {
        pattern: '/stability/crashes/:projectId/:crashId',
        getInfo: (p) => ({ id: `crash-${p.crashId}`, title: `Crash ${(p.crashId || '').substring(0, 8)}...`, icon: AlertOctagon }),
        Component: React.lazy(loadCrashDetail),
        loadComponent: loadCrashDetail,
        getProps: (p) => ({ crashId: p.crashId, projectId: p.projectId }),
    },
    {
        pattern: '/stability/anrs/:projectId/:anrId',
        getInfo: (p) => ({ id: `anr-${p.anrId}`, title: `ANR ${(p.anrId || '').substring(0, 8)}...`, icon: Clock }),
        Component: React.lazy(loadANRDetail),
        loadComponent: loadANRDetail,
        getProps: (p) => ({ anrId: p.anrId, projectId: p.projectId }),
    },
    {
        pattern: '/stability/errors/:projectId/:errorId',
        getInfo: (p) => ({ id: `error-${p.errorId}`, title: `Error ${(p.errorId || '').substring(0, 8)}...`, icon: Terminal }),
        Component: React.lazy(loadErrorDetail),
        loadComponent: loadErrorDetail,
        getProps: (p) => ({ errorId: p.errorId, projectId: p.projectId }),
    },
    { pattern: '/team', getInfo: () => ({ id: 'team', title: 'Team', icon: Users }), Component: React.lazy(loadTeamSettings), loadComponent: loadTeamSettings },
    { pattern: '/billing', getInfo: () => ({ id: 'billing', title: 'Billing', icon: CreditCard }), Component: React.lazy(loadBillingSettings), loadComponent: loadBillingSettings },
    { pattern: '/account', getInfo: () => ({ id: 'account', title: 'Account', icon: User }), Component: React.lazy(loadAccountSettings), loadComponent: loadAccountSettings },
    {
        pattern: '/settings/:projectId',
        getInfo: (p) => ({ id: `settings-${p.projectId}`, title: 'Project Settings', icon: Settings }),
        Component: React.lazy(loadProjectSettings),
        loadComponent: loadProjectSettings,
        getProps: (p) => ({ projectId: p.projectId }),
    },
    { pattern: '/search', getInfo: () => ({ id: 'search', title: 'New Tab', icon: SearchIcon }), Component: React.lazy(loadSearch), loadComponent: loadSearch },
];

function stripRoutePrefix(pathname: string): string {
    return pathname.replace(/^\/(dashboard|demo)/, '');
}

function findRoute(pathname: string): RouteDefinition | null {
    const pathWithoutPrefix = stripRoutePrefix(pathname);
    for (const route of routes) {
        if (matchPath(route.pattern, pathWithoutPrefix)) {
            return route;
        }
    }
    return null;
}

export const TabRegistry = {
    getTabInfo: (pathname: string): TabInfo | null => {
        const pathWithoutPrefix = stripRoutePrefix(pathname);

        for (const route of routes) {
            const match = matchPath(route.pattern, pathWithoutPrefix);
            if (match) {
                return route.getInfo(match.params as Record<string, string>);
            }
        }
        return null;
    },

    resolve: (pathname: string): TabDefinition | null => {
        for (const route of routes) {
            const match = matchPath(route.pattern, pathname);
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
