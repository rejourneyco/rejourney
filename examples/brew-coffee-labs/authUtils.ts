import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

interface AuthTokenData {
  token: string;
  expiration: number;
}

const AUTH_TOKEN_KEY = 'supabaseAuthTokenData';

export async function saveAuthToken(token: string, expiresIn: number): Promise<void> {
  try {
    const expirationTime = Date.now() + expiresIn * 1000;
    const tokenData: AuthTokenData = {
      token,
      expiration: expirationTime
    };

    await SecureStore.setItemAsync(AUTH_TOKEN_KEY, JSON.stringify(tokenData));
    console.log('Auth token data saved successfully');
  } catch (error) {
    console.error('Error saving auth token data:', error);
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

    if (Date.now() >= tokenData.expiration) {
      console.log('Stored auth token data indicates expiration, clearing it');
      await clearAuthToken();
      return null;
    }

    return tokenData;
  } catch (error) {
    console.error('Error retrieving auth token data:', error);
    return null;
  }
}

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

export function isTokenExpired(expiration: number): boolean {
  return Date.now() >= expiration;
}

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

    if (session.expires_at && session.expires_at * 1000 <= Date.now()) {
       console.warn("Supabase session token is expired even after getSession(). Might indicate refresh issue.");
       return null;
    }

    console.log("Retrieved current access token from Supabase session.");
    return session.access_token;

  } catch (err) {
      console.error("Unexpected error in getCurrentSupabaseToken:", err);
      return null;
  }
}
