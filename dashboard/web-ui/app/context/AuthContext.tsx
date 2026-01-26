/**
 * Auth Context
 * 
 * Manages user authentication state across the app.
 * Uses Better Auth for passwordless email OTP authentication.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getFingerprint } from '../utils/fingerprint';
import { API_BASE_URL, getCsrfToken } from '../config';

// Network timeout in milliseconds (10 seconds)
const NETWORK_TIMEOUT = 10000;

// Helper to create a fetch with timeout
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = NETWORK_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
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

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  sessionsUsedThisMonth: number;
  totalSessionsUsed: number;
  storageBytesUsed: number;
  storageLimitBytes: number;
  isSelfHosted: boolean;
  billingPeriodStart: string | null;
  createdAt: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  login: (email: string, otp: string) => Promise<boolean>;
  loginWithGitHub: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  sendOtp: (email: string, turnstileToken: string) => Promise<boolean>;
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
}

export function AuthProvider({ children }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Track if refreshUser is currently running to prevent race conditions
  const refreshUserPromiseRef = useRef<Promise<void> | null>(null);

  // Fetch current user
  const refreshUser = useCallback(async () => {
    // Skip during SSR - cookies are not available server-side
    if (typeof window === 'undefined') {
      return;
    }

    // Skip user fetching in demo mode to avoid unnecessary console errors
    if (window.location.pathname.startsWith('/demo')) {
      setIsLoading(false);
      return;
    }

    // If a refresh is already in progress, return the existing promise
    if (refreshUserPromiseRef.current) {
      return refreshUserPromiseRef.current;
    }

    // Create the refresh promise
    const refreshPromise = (async () => {
      try {
        // Use relative URL to go through the proxy with timeout
        const response = await fetchWithTimeout('/api/auth/me', {
          credentials: 'include',
        });

        if (response.ok) {
          let data;
          try {
            data = await response.json();
          } catch (jsonErr) {
            // Handle JSON parsing errors
            console.error('Failed to parse user data:', jsonErr);
            throw new Error('Invalid response from server. Please try again.');
          }
          
          // Backend returns { user: {...} }, extract the user object
          const userData = data.user || data;
          // Ensure all required fields have default values
          setUser({
            id: userData.id,
            email: userData.email,
            name: userData.name || userData.displayName || null,
            avatarUrl: userData.avatarUrl || null,
            createdAt: userData.createdAt || new Date().toISOString(),
            billingPeriodStart: userData.billingPeriodStart || null,
            sessionsUsedThisMonth: userData.sessionsUsedThisMonth ?? 0,
            totalSessionsUsed: userData.totalSessionsUsed ?? 0,
            storageBytesUsed: userData.storageBytesUsed ?? 0,
            storageLimitBytes: userData.storageLimitBytes ?? 10 * 1024 * 1024 * 1024,
            isSelfHosted: userData.isSelfHosted ?? true,
            emailVerified: userData.emailVerified ?? true,
          });
          setError(null);
        } else if (response.status === 401) {
          // Unauthorized - user is not authenticated
          setUser(null);
          setError(null); // Clear error for 401 as it's expected when not logged in
        } else {
          // Other HTTP errors
          const errorText = await response.text().catch(() => '');
          throw new Error(`Server error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
        }
      } catch (err) {
        // Only set error for network errors, not for 401 (unauthorized)
        if (isNetworkError(err)) {
          const errorMessage = err instanceof Error ? err.message : 'Network error: Unable to connect to server.';
          console.error('Network error fetching user:', errorMessage);
          // Don't clear user on network errors - keep existing state
          setError(errorMessage);
        } else {
          console.error('Failed to fetch user:', err);
          // For non-network errors, only clear user if it's a 401 or similar
          // Otherwise keep existing user state
          const errorMessage = err instanceof Error ? err.message : 'Failed to fetch user';
          setError(errorMessage);
        }
      } finally {
        // Clear the promise ref when done
        refreshUserPromiseRef.current = null;
      }
    })();

    refreshUserPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, []);

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      try {
        await refreshUser();
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount, refreshUser is stable

  // Send OTP to email
  const sendOtp = useCallback(async (email: string, turnstileToken: string): Promise<boolean> => {
    try {
      setError(null);
      const headers = withDefaultHeaders({ 'Content-Type': 'application/json' });

      // Collect fingerprint data for duplicate account detection
      const fingerprint = await getFingerprint();

      // Use relative URL to go through the proxy with timeout
      const response = await fetchWithTimeout('/api/auth/otp/send', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ email, fingerprint, turnstileToken }),
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error('Invalid response from server. Please try again.');
      }

      if (!response.ok) {
        const errorMessage = data.message || data.error || `Server error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      return true;
    } catch (err) {
      let errorMessage: string;
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (isNetworkError(err)) {
        errorMessage = 'Network error: Unable to connect to server. Please check your internet connection.';
      } else {
        errorMessage = 'Failed to send verification code';
      }
      setError(errorMessage);
      return false;
    }
  }, []);

  // Login with email and OTP
  const login = useCallback(async (email: string, otp: string): Promise<boolean> => {
    try {
      setError(null);
      const headers = withDefaultHeaders({ 'Content-Type': 'application/json' });

      // Collect fingerprint data for duplicate account detection / backfill
      const fingerprint = await getFingerprint();

      // Use relative URL to go through the proxy with timeout
      const response = await fetchWithTimeout('/api/auth/otp/verify', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ email, code: otp, fingerprint }),
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error('Invalid response from server. Please try again.');
      }

      if (!response.ok) {
        const errorMessage = data.message || data.error || `Server error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      // Fetch user data after successful login
      await refreshUser();
      return true;
    } catch (err) {
      let errorMessage: string;
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (isNetworkError(err)) {
        errorMessage = 'Network error: Unable to connect to server. Please check your internet connection.';
      } else {
        errorMessage = 'Login failed';
      }
      setError(errorMessage);
      return false;
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
      setError(null);
    }
  }, []);

  // Login with GitHub OAuth
  const loginWithGitHub = useCallback(() => {
    if (typeof window === 'undefined') return;
    // Redirect to GitHub OAuth endpoint (use relative URL)
    window.location.href = '/api/auth/github';
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
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

