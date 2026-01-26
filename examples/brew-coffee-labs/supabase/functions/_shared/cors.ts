// supabase/functions/_shared/cors.ts
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Or specify your app's origin for better security
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', // Allow POST and OPTIONS
  }