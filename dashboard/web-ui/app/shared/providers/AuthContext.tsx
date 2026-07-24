/**
 * Auth Context
 * 
 * Manages user authentication state across the app.
 * Uses Better Auth for passwordless email OTP authentication.
 */

import React, { createContext, startTransition, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getFingerprint } from '~/shared/lib/fingerprint';
import { appendGoogleAdsAttributionToUrl, getGoogleAdsAttribution } from '~/shared/lib/googleAdsAttribution';
import { hasGoogleAdsConsent } from '~/shared/lib/googleAdsConsent';
import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';

// Network timeout in milliseconds (10 seconds)
const NETWORK_TIMEOUT = 10000;

function shouldBootstrapAuth(pathname: string): boolean {
  return pathname === '/login'
    || pathname.startsWith('/invite/')
    || pathname === '/dashboard'
    || pathname.startsWith('/dashboard/');
}

// Helper to create a fetch with timeout
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = NETWORK_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const requestInit: RequestInit = {
    ...options,
    signal: controller.signal,
  };
  const method = (requestInit.method ?? 'GET').toUpperCase();
  if ((method === 'GET' || method === 'HEAD') && !requestInit.cache) {
    requestInit.cache = 'no-store';
  }

  try {
    const response = await fetch(url, requestInit);
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Network request timed out. Please check your connection and try again.');
    }
    // Check if it's a network error (no response from server)
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error('Network error: Unable to connect to server. Please check your internet connection.');
    }
    throw err;
  }
}

// Helper to check if error is a network error vs API error
function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes('Network') ||
      err.message.includes('timeout') ||
      err.message.includes('fetch') ||
      err.message.includes('Failed to fetch')
    );
  }
  return false;
}

function withDefaultHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  // Add CSRF token for POST requests
  const csrf = getCsrfToken();
  if (csrf) {
    headers.set('X-CSRF-Token', csrf);
  }
  return headers;
}

async function fetchFreshCurrentUser(): Promise<Response> {
  const headers = new Headers({
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  });
  const response = await fetchWithTimeout(`/api/auth/session?_=${Date.now()}`, {
    credentials: 'include',
    headers,
  });

  if (response.status !== 304) {
    return response;
  }

  return fetchWithTimeout(`/api/auth/session?_=${Date.now()}&retry=1`, {
    credentials: 'include',
    headers,
    cache: 'reload',
  });
}

function isAuthServiceUnavailableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425;
}

function isTransientAuthError(err: unknown): boolean {
  if (err instanceof AuthRequestError) {
    return err.transient;
  }

  return isNetworkError(err);
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text().catch(() => '');
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new AuthRequestError(
        isAuthServiceUnavailableStatus(response.status)
          ? 'Authentication service returned an invalid response. Please try again shortly.'
          : 'Invalid response from server. Please try again.',
        { status: response.status, transient: isAuthServiceUnavailableStatus(response.status) },
      );
    }
    throw new AuthRequestError('Invalid response from server. Please try again.', {
      status: response.status,
      transient: false,
    });
  }
}

function messageFromAuthFailure(response: Response, data: any, fallback: string): string {
  if (data && typeof data === 'object') {
    if (typeof data.message === 'string' && data.message) return data.message;
    if (typeof data.error === 'string' && data.error) return data.error;
  }

  if (isAuthServiceUnavailableStatus(response.status)) {
    return 'Authentication service is temporarily unavailable. Please try again shortly.';
  }

  return fallback || `Server error: ${response.status} ${response.statusText}`;
}

async function fetchAuthJson<T>(
  url: string,
  options: RequestInit,
  fallbackError: string,
): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    throw new AuthRequestError(messageFromAuthFailure(response, data, fallbackError), {
      status: response.status,
      transient: isAuthServiceUnavailableStatus(response.status),
    });
  }

  return data as T;
}

function authActionFailure(err: unknown, fallback: string): AuthActionResult {
  if (err instanceof AuthRequestError) {
    return {
      ok: false,
      message: err.message,
      transient: err.transient,
      status: err.status,
    };
  }

  if (isNetworkError(err)) {
    return {
      ok: false,
      message: 'Authentication service is temporarily unavailable. Please check your connection and try again.',
      transient: true,
    };
  }

  return {
    ok: false,
    message: err instanceof Error ? err.message : fallback,
    transient: false,
  };
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  timezone: string | null;
  emailVerified: boolean;
  sessionsUsedThisMonth: number;
  totalSessionsUsed: number;
  storageBytesUsed: number;
  storageLimitBytes: number;
  isSelfHosted: boolean;
  billingPeriodStart: string | null;
  createdAt: string;
}

export function normalizeAuthUser(userData: Record<string, any>): User {
  return {
    id: userData.id,
    email: userData.email,
    name: userData.name || userData.displayName || null,
    avatarUrl: userData.avatarUrl || null,
    timezone: userData.timezone || userData.registrationTimezone || null,
    emailVerified: userData.emailVerified ?? true,
    sessionsUsedThisMonth: userData.sessionsUsedThisMonth ?? 0,
    totalSessionsUsed: userData.totalSessionsUsed ?? 0,
    storageBytesUsed: userData.storageBytesUsed ?? 0,
    storageLimitBytes: userData.storageLimitBytes ?? 10 * 1024 * 1024 * 1024,
    isSelfHosted: userData.isSelfHosted ?? false,
    billingPeriodStart: userData.billingPeriodStart || null,
    createdAt: userData.createdAt || new Date().toISOString(),
  };
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authServiceUnavailable: boolean;
  error: string | null;
  login: (email: string, otp: string) => Promise<AuthActionResult>;
  loginWithGitHub: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
  sendOtp: (email: string) => Promise<AuthActionResult>;
}

export interface AuthActionResult {
  ok: boolean;
  message?: string;
  transient?: boolean;
  status?: number;
  accountActivated?: boolean;
  userId?: string;
  email?: string;
}

class AuthRequestError extends Error {
  readonly status?: number;
  readonly transient: boolean;

  constructor(message: string, options: { status?: number; transient?: boolean } = {}) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = options.status;
    this.transient = Boolean(options.transient);
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface Props {
  children: React.ReactNode;
  initialAuthServiceUnavailable?: boolean;
  initialError?: string | null;
  initialHydrated?: boolean;
  initialUser?: User | null;
}

export function AuthProvider({
  children,
  initialAuthServiceUnavailable = false,
  initialError = null,
  initialHydrated = false,
  initialUser = null,
}: Props) {
  const [user, setUser] = useState<User | null>(initialHydrated ? initialUser : null);
  const [isLoading, setIsLoading] = useState(!initialHydrated);
  const [error, setError] = useState<string | null>(initialHydrated ? initialError : null);
  const [authServiceUnavailable, setAuthServiceUnavailable] = useState(
    initialHydrated && initialAuthServiceUnavailable,
  );
  
  // Track if refreshUser is currently running to prevent race conditions
  const refreshUserPromiseRef = useRef<Promise<User | null> | null>(null);
  const userRef = useRef<User | null>(initialHydrated ? initialUser : null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Fetch current user
  const refreshUser = useCallback(async () => {
    // Skip during SSR - cookies are not available server-side
    if (typeof window === 'undefined') {
      return userRef.current;
    }

    // Skip user fetching in demo mode to avoid unnecessary console errors
    if (window.location.pathname.startsWith('/demo')) {
      setIsLoading(false);
      return userRef.current;
    }

    // If a refresh is already in progress, return the existing promise
    if (refreshUserPromiseRef.current) {
      return refreshUserPromiseRef.current;
    }

    // Create the refresh promise
    const refreshPromise = (async () => {
      try {
        const response = await fetchFreshCurrentUser();

        if (response.ok) {
          const data = await parseJsonResponse(response);

          if (data && typeof data === 'object' && 'user' in data && data.user === null) {
            setUser(null);
            userRef.current = null;
            setError(null);
            setAuthServiceUnavailable(false);
            return null;
          }

          // Backend returns { user: {...} }, extract the user object
          const userData = data?.user || data;
          if (!userData) {
            throw new AuthRequestError('Invalid auth response from server. Please try again.', {
              status: response.status,
              transient: true,
            });
          }
          // Ensure all required fields have default values
          const normalizedUser = normalizeAuthUser(userData);
          setUser(normalizedUser);
          userRef.current = normalizedUser;
          setError(null);
          setAuthServiceUnavailable(false);
          return normalizedUser;
        } else if (response.status === 401) {
          // Unauthorized - user is not authenticated
          setUser(null);
          userRef.current = null;
          setError(null); // Clear error for 401 as it's expected when not logged in
          setAuthServiceUnavailable(false);
          return null;
        } else if (response.status === 403) {
          setUser(null);
          userRef.current = null;
          setError(null);
          setAuthServiceUnavailable(false);
          return null;
        } else {
          // Other HTTP errors
          const errorText = await response.text().catch(() => '');
          throw new AuthRequestError(
            `Authentication service error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
            {
              status: response.status,
              transient: isAuthServiceUnavailableStatus(response.status),
            },
          );
        }
      } catch (err) {
        // Only set error for network errors, not for 401 (unauthorized)
        if (isTransientAuthError(err)) {
          const errorMessage = err instanceof Error ? err.message : 'Network error: Unable to connect to server.';
          console.error('Network error fetching user:', errorMessage);
          // Don't clear user on network errors - keep existing state
          setError(errorMessage);
          setAuthServiceUnavailable(true);
        } else {
          console.error('Failed to fetch user:', err);
          // For non-network errors, only clear user if it's a 401 or similar
          // Otherwise keep existing user state
          const errorMessage = err instanceof Error ? err.message : 'Failed to fetch user';
          setError(errorMessage);
          setAuthServiceUnavailable(false);
        }
        return userRef.current;
      } finally {
        // Clear the promise ref when done
        refreshUserPromiseRef.current = null;
      }
    })();

    refreshUserPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, []);

  useEffect(() => {
    if (!initialHydrated) return;
    startTransition(() => {
      setUser(initialUser);
      userRef.current = initialUser;
      setError(initialError);
      setAuthServiceUnavailable(initialAuthServiceUnavailable);
      setIsLoading(false);
    });
  }, [initialAuthServiceUnavailable, initialError, initialHydrated, initialUser]);

  // Check auth status on mount
  useEffect(() => {
    if (initialHydrated) return;
    if (!shouldBootstrapAuth(window.location.pathname)) {
      setIsLoading(false);
      return;
    }
    const checkAuth = async () => {
      setIsLoading(true);
      try {
        await refreshUser();
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, [initialHydrated, refreshUser]);

  // Send OTP to email
  const sendOtp = useCallback(async (email: string): Promise<AuthActionResult> => {
    try {
      setError(null);
      const headers = withDefaultHeaders({ 'Content-Type': 'application/json' });

      // Collect fingerprint data for duplicate account detection
      const fingerprint = await getFingerprint();
      const attribution = getGoogleAdsAttribution();

      // Use relative URL to go through the proxy with timeout
      await fetchAuthJson('/api/auth/otp/send', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          email,
          fingerprint,
          ...(attribution ? { attribution } : {}),
          ...(hasGoogleAdsConsent() ? { googleAdsConsent: 'accepted' } : {}),
        }),
      }, 'Failed to send verification code');

      setAuthServiceUnavailable(false);
      return { ok: true };
    } catch (err) {
      const failure = authActionFailure(err, 'Failed to send verification code');
      setAuthServiceUnavailable(Boolean(failure.transient));
      setError(failure.message || 'Failed to send verification code');
      return failure;
    }
  }, []);

  // Login with email and OTP
  const login = useCallback(async (email: string, otp: string): Promise<AuthActionResult> => {
    try {
      setError(null);
      const headers = withDefaultHeaders({ 'Content-Type': 'application/json' });

      // Collect fingerprint data for duplicate account detection / backfill
      const fingerprint = await getFingerprint();

      // Use relative URL to go through the proxy with timeout
      const verifyData = await fetchAuthJson<{ user?: Record<string, any>; accountActivated?: boolean }>('/api/auth/otp/verify', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ email, code: otp, fingerprint }),
      }, 'Login failed');

      if (verifyData?.user) {
        const verifiedUser = normalizeAuthUser(verifyData.user);
        setUser(verifiedUser);
        userRef.current = verifiedUser;
        setAuthServiceUnavailable(false);

        // The OTP verification response proves the session cookie was issued.
        // The dashboard loader hydrates the complete user and workspace state.
        return {
          ok: true,
          accountActivated: Boolean(verifyData.accountActivated),
          userId: verifiedUser.id,
          email: verifiedUser.email,
        };
      }

      // Older auth responses may omit user data; keep the previous validation
      // path for that compatibility case.
      const refreshedUser = await refreshUser();
      setAuthServiceUnavailable(false);
      return refreshedUser
        ? {
            ok: true,
            accountActivated: Boolean(verifyData?.accountActivated),
            userId: refreshedUser.id,
            email: refreshedUser.email,
          }
        : {
            ok: false,
            message: 'We verified the code, but could not load your dashboard session. Please retry.',
            transient: true,
          };
    } catch (err) {
      const failure = authActionFailure(err, 'Login failed');
      setAuthServiceUnavailable(Boolean(failure.transient));
      setError(failure.message || 'Login failed');
      return failure;
    }
  }, [refreshUser]);

  // Logout
  const logout = useCallback(async () => {
    try {
      const headers = withDefaultHeaders();
      // Use relative URL to go through the proxy with timeout
      await fetchWithTimeout('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
    } catch (err) {
      // Log but don't show error to user - logout should always succeed locally
      console.error('Logout error:', err);
    } finally {
      // Always clear user state, even if network request fails
      setUser(null);
      userRef.current = null;
      setError(null);
      setAuthServiceUnavailable(false);
    }
  }, []);

  // Login with GitHub OAuth
  const loginWithGitHub = useCallback(() => {
    if (typeof window === 'undefined') return;
    // Redirect to GitHub OAuth endpoint (use relative URL)
    window.location.href = appendGoogleAdsAttributionToUrl('/api/auth/github');
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    authServiceUnavailable,
    error,
    login,
    loginWithGitHub,
    logout,
    refreshUser,
    sendOtp,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
