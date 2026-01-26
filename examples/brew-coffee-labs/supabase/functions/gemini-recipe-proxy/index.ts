// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

console.log('Function "gemini-recipe-proxy" up and running!')
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Or specify your app's origin for better security
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', // Allow POST and OPTIONS
}
// Define the expected structure of the request body from the client
interface GeminiRequestBody {
  contents: unknown // Keep it flexible, client sends the exact Gemini structure
  generationConfig?: unknown
}

serve(async (req: Request) => {
  // 1. Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Verify Authorization Header (Ensure user is logged in)
    // Supabase automatically verifies the JWT and makes user data available
    // if the function is called with the user's auth token.
    // If you need manual verification (e.g., different auth), you'd add it here.
    // For standard Supabase client.invoke, the Authorization header is handled.

    // 3. Retrieve the secret API key
    const apiKey = Deno.env.get('GEMINI_RECIPE_API_KEY')
    if (!apiKey) {
      console.error('GEMINI_RECIPE_API_KEY secret not set in Supabase secrets.')
      return new Response(JSON.stringify({ error: 'API key configuration error on server.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    // 4. Get the request body from the client
    const clientRequestBody: GeminiRequestBody = await req.json()
    if (!clientRequestBody || !clientRequestBody.contents) {
       return new Response(JSON.stringify({ error: 'Invalid request body. Missing "contents".' }), {
         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         status: 400,
       })
    }


    // 5. Construct the actual Gemini API URL
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

    // 6. Forward the request to Gemini API
    console.log('Proxying request to Gemini Recipe API...');
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(clientRequestBody), // Send the client's exact payload
    })

    // 7. Process the Gemini response
    const geminiData = await geminiResponse.json()

     console.log('Received response from Gemini Recipe API Status:', geminiResponse.status);
     // Log potentially sensitive data carefully in production
     // console.log('Gemini Response Body:', JSON.stringify(geminiData).substring(0, 300) + '...');


    // 8. Return the Gemini response (or error) back to the client
     if (!geminiResponse.ok) {
       console.error('Error from Gemini API:', geminiData);
       // Forward the error structure if possible
       return new Response(JSON.stringify(geminiData), {
         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         status: geminiResponse.status, // Use Gemini's status code
       });
     }

    return new Response(JSON.stringify(geminiData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Error in Edge Function:', error)
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})