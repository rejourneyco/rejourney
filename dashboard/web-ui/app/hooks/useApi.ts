/**
 * Demo-aware API hooks
 * 
 * These hooks wrap the API service and automatically return demo data
 * when in demo mode, avoiding the window.location checks scattered
 * throughout the codebase.
 */

import { useCallback } from 'react';
import { useDemoMode } from '../context/DemoModeContext';
import * as api from '../services/api';
import * as demoApiData from '../data/demoApiData';

/**
 * Hook for fetching sessions with demo mode support
 */
export function useSessionsApi() {
    const { isDemoMode, demoSessions } = useDemoMode();

    const getSessionsPaginated = useCallback(async (params: Parameters<typeof api.getSessionsPaginated>[0]) => {
        if (isDemoMode) {
            return {
                sessions: demoSessions,
                nextCursor: null,
                hasMore: false
            };
        }
        return api.getSessionsPaginated(params);
    }, [isDemoMode, demoSessions]);

    const getSession = useCallback(async (sessionId: string) => {
        if (isDemoMode) {
            return demoApiData.demoFullSession as unknown as Awaited<ReturnType<typeof api.getSession>>;
        }
        return api.getSession(sessionId);
    }, [isDemoMode]);

    return {
        getSessionsPaginated,
        getSession,
    };
}

/**
 * Hook for fetching dashboard stats with demo mode support
 */
export function useDashboardApi() {
    const { isDemoMode } = useDemoMode();

    const getDashboardStats = useCallback(async (projectId?: string, timeRange?: string) => {
        if (isDemoMode) {
            return demoApiData.demoDashboardStatsApi;
        }
        return api.getDashboardStats(projectId, timeRange);
    }, [isDemoMode]);

    return {
        getDashboardStats,
    };
}

/**
 * Hook for fetching issues with demo mode support
 */
export function useIssuesApi() {
    const { isDemoMode } = useDemoMode();

    const getIssues = useCallback(async (projectId: string, timeRange?: string, searchQuery?: string, issueType?: string) => {
        if (isDemoMode) {
            return demoApiData.demoIssuesResponse;
        }
        return api.getIssues(projectId, timeRange, searchQuery, issueType);
    }, [isDemoMode]);

    const getIssue = useCallback(async (issueId: string) => {
        if (isDemoMode) {
            const issue = demoApiData.demoIssuesResponse.issues.find(i => i.id === issueId);
            return issue || demoApiData.demoIssuesResponse.issues[0];
        }
        return api.getIssue(issueId);
    }, [isDemoMode]);

    return {
        getIssues,
        getIssue,
    };
}

/**
 * Hook for fetching crashes with demo mode support
 */
export function useCrashesApi() {
    const { isDemoMode } = useDemoMode();

    const getCrashes = useCallback(async (projectId: string, page?: number, limit?: number) => {
        if (isDemoMode) {
            const crashes = demoApiData.demoIssuesResponse.issues.filter(i => i.issueType === 'crash');
            return { crashes, totalPages: 1 };
        }
        return api.getCrashes(projectId, page, limit);
    }, [isDemoMode]);

    const getCrash = useCallback(async (projectId: string, crashId: string) => {
        if (isDemoMode) {
            const crash = demoApiData.demoIssuesResponse.issues.find(i => i.id === crashId);
            return crash || demoApiData.demoIssuesResponse.issues[0];
        }
        return api.getCrash(projectId, crashId);
    }, [isDemoMode]);

    return {
        getCrashes,
        getCrash,
    };
}

/**
 * Hook for fetching ANRs with demo mode support
 */
export function useAnrsApi() {
    const { isDemoMode } = useDemoMode();

    const getANRs = useCallback(async (projectId: string, options?: { limit?: number; offset?: number; timeRange?: string }) => {
        if (isDemoMode) {
            return demoApiData.demoANRsResponse;
        }
        return api.getANRs(projectId, options);
    }, [isDemoMode]);

    const getANR = useCallback(async (projectId: string, anrId: string) => {
        if (isDemoMode) {
            return demoApiData.demoANRsResponse.anrs[0];
        }
        return api.getANR(projectId, anrId);
    }, [isDemoMode]);

    return {
        getANRs,
        getANR,
    };
}

/**
 * Hook for fetching errors with demo mode support
 */
export function useErrorsApi() {
    const { isDemoMode } = useDemoMode();

    const getErrors = useCallback(async (projectId: string, options?: Parameters<typeof api.getErrors>[1]) => {
        if (isDemoMode) {
            return demoApiData.demoErrorsResponse;
        }
        return api.getErrors(projectId, options);
    }, [isDemoMode]);

    return {
        getErrors,
    };
}

/**
 * Hook for analytics APIs with demo mode support
 * Note: These analytics functions use the demo data that exists in demoApiData
 */
export function useAnalyticsApi() {
    const { isDemoMode } = useDemoMode();

    const getGrowthObservability = useCallback(async (_projectId: string, _timeRange?: string) => {
        if (isDemoMode) {
            return demoApiData.demoGrowthObservability;
        }
        // Real API call would go here
        return demoApiData.demoGrowthObservability;
    }, [isDemoMode]);

    const getRegionPerformance = useCallback(async (_projectId: string, _timeRange?: string) => {
        if (isDemoMode) {
            return demoApiData.demoRegionPerformance;
        }
        // Real API call would go here
        return demoApiData.demoRegionPerformance;
    }, [isDemoMode]);

    const getDeviceSummary = useCallback(async (_projectId: string, _timeRange?: string) => {
        if (isDemoMode) {
            return demoApiData.demoDeviceSummary;
        }
        // Real API call would go here
        return demoApiData.demoDeviceSummary;
    }, [isDemoMode]);

    const getGeoSummary = useCallback(async (_projectId: string, _timeRange?: string) => {
        if (isDemoMode) {
            return demoApiData.demoGeoSummary;
        }
        // Real API call would go here
        return demoApiData.demoGeoSummary;
    }, [isDemoMode]);

    const getJourneySummary = useCallback(async (_projectId: string, _timeRange?: string) => {
        if (isDemoMode) {
            return demoApiData.demoJourneySummary;
        }
        // Real API call would go here
        return demoApiData.demoJourneySummary;
    }, [isDemoMode]);

    return {
        getGrowthObservability,
        getRegionPerformance,
        getDeviceSummary,
        getGeoSummary,
        getJourneySummary,
    };
}
