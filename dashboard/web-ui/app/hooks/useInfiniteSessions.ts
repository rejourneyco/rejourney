/**
 * useInfiniteSessions Hook
 * 
 * Provides infinite scroll / virtual scrolling support for sessions.
 * Uses cursor-based pagination to efficiently handle 500k+ sessions.
 */

import { useState, useCallback, useRef } from 'react';
import { getSessionsPaginated, PaginatedSessionsResponse } from '../services/api';

export interface UseInfiniteSessionsOptions {
    limit?: number;
    timeRange?: string;
    projectId?: string;
    platform?: string;
}

export interface UseInfiniteSessionsResult {
    sessions: any[];
    isLoading: boolean;
    isLoadingMore: boolean;
    error: string | null;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;
    isItemLoaded: (index: number) => boolean;
}

export function useInfiniteSessions(
    options: UseInfiniteSessionsOptions = {}
): UseInfiniteSessionsResult {
    const { limit = 50, timeRange, projectId, platform } = options;

    const [sessions, setSessions] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);

    const cursorRef = useRef<string | null>(null);
    const isLoadingRef = useRef(false);

    const loadMore = useCallback(async () => {
        // Prevent duplicate requests
        if (isLoadingRef.current || !hasMore) return;

        isLoadingRef.current = true;
        setIsLoadingMore(sessions.length > 0);

        if (sessions.length === 0) {
            setIsLoading(true);
        }

        try {
            const response: PaginatedSessionsResponse = await getSessionsPaginated({
                cursor: cursorRef.current,
                limit,
                timeRange,
                projectId,
                platform,
            });

            setSessions(prev => [...prev, ...response.sessions]);
            cursorRef.current = response.nextCursor;
            setHasMore(response.hasMore);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load sessions');
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
            isLoadingRef.current = false;
        }
    }, [hasMore, limit, timeRange, projectId, platform, sessions.length]);

    const refresh = useCallback(async () => {
        // Reset and reload from beginning
        setSessions([]);
        cursorRef.current = null;
        setHasMore(true);
        setError(null);

        isLoadingRef.current = true;
        setIsLoading(true);

        try {
            const response: PaginatedSessionsResponse = await getSessionsPaginated({
                cursor: null,
                limit,
                timeRange,
                projectId,
                platform,
            });

            setSessions(response.sessions);
            cursorRef.current = response.nextCursor;
            setHasMore(response.hasMore);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load sessions');
        } finally {
            setIsLoading(false);
            isLoadingRef.current = false;
        }
    }, [limit, timeRange, projectId, platform]);

    const isItemLoaded = useCallback((index: number) => {
        return index < sessions.length;
    }, [sessions.length]);

    return {
        sessions,
        isLoading,
        isLoadingMore,
        error,
        hasMore,
        loadMore,
        refresh,
        isItemLoaded,
    };
}
