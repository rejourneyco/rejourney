// src/config.ts
import Constants from 'expo-constants';

// --- MASTER SWITCH ---
// Set to true to use Supabase Edge Functions for Gemini API calls (requires deployed functions & secrets)
// Set to false to use local .env variables via react-native-config (for local development)
export const USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI = 
  process.env.USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI === 'true' || true; // <-- CHANGE THIS TOGGLE

// Optional: Define function names centrally
export const GEMINI_RECIPE_FUNCTION_NAME = 'gemini-recipe-proxy';
export const GEMINI_VALIDATION_FUNCTION_NAME = 'gemini-validation-proxy';

// Get API URL from environment variables with fallback
export const API_URL = 
  Constants.expoConfig?.extra?.apiUrl || 
  process.env.EXPO_PUBLIC_API_URL || 
  "https://your-worker-name.your-subdomain.workers.dev"; // Replace with your worker URL

// Validate API URL is configured
if (API_URL === "https://your-worker-name.your-subdomain.workers.dev") {
  console.warn(
    "⚠️ API_URL is not configured. Please set EXPO_PUBLIC_API_URL in your .env file or app.config.js"
  );
}

console.log(`(NOBRIDGE) LOG App Config: Using Supabase Edge Functions for Gemini? ${USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI}`);