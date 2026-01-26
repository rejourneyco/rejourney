// authUtils.ts
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

interface AuthTokenData {
  token: string;
  expiration: number; // Store expiration time in milliseconds
}

// Key to store token data
const AUTH_TOKEN_KEY = 'supabaseAuthTokenData';

export async function saveAuthToken(token: string, expiresIn: number): Promise<void> {
  try {
    // Calculate expiration time in milliseconds
    const expirationTime = Date.now() + expiresIn * 1000; // Corrected: Multiply by 1000
    const tokenData: AuthTokenData = {
      token,
      expiration: expirationTime
    };

    await SecureStore.setItemAsync(AUTH_TOKEN_KEY, JSON.stringify(tokenData));
    console.log('Auth token data saved successfully');
  } catch (error) {
    console.error('Error saving auth token data:', error);
    // Decide if you want to re-throw or handle differently
    // throw error;
  }
}

export async function getAuthTokenData(): Promise<AuthTokenData | null> {
  try {
    const tokenDataString = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);

    if (!tokenDataString) {
      console.log('No auth token data found');
      return null;
    }

    const tokenData: AuthTokenData = JSON.parse(tokenDataString);

    // Check if token is expired based on stored expiration
    if (Date.now() >= tokenData.expiration) {
      console.log('Stored auth token data indicates expiration, clearing it');
      await clearAuthToken(); // Clear the expired data
      return null; // Return null as it's expired
    }

    return tokenData;
  } catch (error) {
    console.error('Error retrieving auth token data:', error);
    // Consider clearing token data on parse error?
    // await clearAuthToken();
    return null;
  }
}

// You might still want a way to get just the token string if needed elsewhere,
// but be aware of its potential staleness if not checked against getSession().
export async function getStoredAuthTokenString(): Promise<string | null> {
   const data = await getAuthTokenData();
   return data?.token ?? null;
}


export async function clearAuthToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
    console.log('Auth token data cleared');
  } catch (error) {
    console.error('Error clearing auth token data:', error);
  }
}

// Helper function remains useful
export function isTokenExpired(expiration: number): boolean {
  return Date.now() >= expiration;
}

// --- NEW ---
// Function to get the CURRENT access token from Supabase session
// This leverages the SDK's refresh logic.
export async function getCurrentSupabaseToken(): Promise<string | null> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error("Error getting Supabase session:", error.message);
      return null;
    }

    if (!session) {
      console.log("No active Supabase session found.");
      return null;
    }

    // Check if the session's token is expired *according to Supabase*
    // Note: getSession() often handles refresh internally, so this check
    // might be redundant but provides an extra layer.
    if (session.expires_at && session.expires_at * 1000 <= Date.now()) {
       console.warn("Supabase session token is expired even after getSession(). Might indicate refresh issue.");
       // Optionally try forcing a refresh, but often indicates a deeper problem
       // const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
       // if (refreshError || !refreshedSession) return null;
       // return refreshedSession.access_token;
       return null;
    }

    console.log("Retrieved current access token from Supabase session.");
    return session.access_token;

  } catch (err) {
      console.error("Unexpected error in getCurrentSupabaseToken:", err);
      return null;
  }
}