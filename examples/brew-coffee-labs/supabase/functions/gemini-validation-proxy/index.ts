// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Be more specific in production
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

console.log('Function "gemini-validation-proxy" (v2 - Multi-purpose) up and running!')

// --- Define Input Structures from Client ---

// Common part for image data
interface BaseValidationRequest {
  imageBase64?: string; // Optional Base64 image data
  mimeType?: string; // Mime type if imageBase64 is present
}

// Input for Recipe Validation
interface RecipeValidationClientRequest extends BaseValidationRequest {
  type: "recipe";
  recipeText: string; // Text content of the recipe/post
}

// Input for Profile Validation
interface ProfileValidationClientRequest extends BaseValidationRequest {
  type: "profile";
  userName: string; // Username to validate
}

// Union type for the request body
type ClientRequestBody = RecipeValidationClientRequest | ProfileValidationClientRequest;

// --- Define Expected Gemini Response Structures ---

// Structure expected from Gemini for RECIPE validation
interface RecipeValidationResult {
  is_coffee_image: boolean // Changed from boolean | null for stricter checking
  is_coffee_recipe: boolean
  is_safe: boolean
  reason: string | null
}

// Structure expected from Gemini for PROFILE validation
interface ProfileValidationResult {
  is_name_safe: boolean
  is_image_safe: boolean | null // Can be null if no image provided
  reason: string | null
}


// --- Helper Function to Prepare Image Parts for Gemini ---
function prepareImageParts(imageBase64?: string, mimeType?: string): { inlineData: { data: string; mimeType: string } }[] {
    if (imageBase64 && mimeType) {
        // Basic validation (optional but good practice)
        if (!mimeType.startsWith('image/')) {
             console.warn(`Invalid mimeType provided: ${mimeType}. Skipping image.`);
             return [];
        }
        if (imageBase64.length < 10) { // Arbitrary small length check
             console.warn(`Potentially invalid base64 data provided (too short). Skipping image.`);
             return [];
        }
        return [{ inlineData: { data: imageBase64, mimeType: mimeType } }];
    }
    return [];
}

// --- Helper Function to Generate Gemini Prompts ---
function generatePrompt(requestData: ClientRequestBody): string {
    if (requestData.type === 'recipe') {
        // --- PROMPT FOR RECIPE VALIDATION ---
        // Use the existing prompt structure you had previously defined for recipes
        return `
            Analyze the following coffee recipe submission (text and optional image).
            Respond ONLY with a JSON object matching this structure:
            {
              "is_coffee_image": boolean, // true if the image clearly shows coffee, brewing, beans, or related equipment. false otherwise. If no image, should be false.
              "is_coffee_recipe": boolean, // true if the text describes a coffee recipe or brewing method. false otherwise.
              "is_safe": boolean, // true if BOTH text and image (if provided) are safe for work (SFW) and don't violate content policies (no hate speech, violence, explicit content, etc.). false otherwise.
              "reason": string | null // Provide a brief reason ONLY if any of the above are false (e.g., "Image not related to coffee.", "Text is not a recipe.", "Content is unsafe."). Otherwise, null.
            }

            Recipe Text:
            ---
            ${requestData.recipeText}
            ---
        `;
    } else if (requestData.type === 'profile') {
         // --- PROMPT FOR PROFILE VALIDATION ---
        return `
            Analyze the following profile content (username and optional image).
            The username should be generally appropriate and not contain hate speech, harassment, or overtly sexual content.
            The profile image (if provided) should be safe for work (SFW) and not depict violence, hate symbols, or explicit content.

            Respond ONLY with a JSON object with the following structure:
            {
              "is_name_safe": boolean, // true if username is appropriate, false otherwise
              "is_image_safe": boolean | null, // true if image is appropriate, false otherwise, null if no image was provided
              "reason": string | null // Provide a brief reason ONLY if is_name_safe is false OR (is_image_safe is false and an image was provided). Examples: "Username is inappropriate.", "Image is inappropriate.", "Username and image are inappropriate.". Otherwise, null.
            }

            Username:
            ---
            ${requestData.userName}
            ---
        `;
    } else {
        // Should not happen if initial check passes, but good for safety
        throw new Error("Invalid validation type specified.");
    }
}

// --- Main Server Logic ---
serve(async (req: Request) => {
  // 1. Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Ensure it's a POST request for actual processing
  if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 405,
      });
  }

  let requestData: ClientRequestBody;
  let validationType: "recipe" | "profile";

  try {
      // 2. Parse Request Body and Validate Type
      try {
          requestData = await req.json();
          if (!requestData || !requestData.type || (requestData.type !== 'recipe' && requestData.type !== 'profile')) {
              throw new Error('Invalid request body: Missing or invalid "type" field.');
          }
          validationType = requestData.type; // Store the type

          // Validate specific fields based on type
          if (validationType === 'recipe' && typeof (requestData as RecipeValidationClientRequest).recipeText !== 'string') {
              throw new Error('Invalid request body: Missing "recipeText" for type "recipe".');
          }
          if (validationType === 'profile' && typeof (requestData as ProfileValidationClientRequest).userName !== 'string') {
              throw new Error('Invalid request body: Missing "userName" for type "profile".');
          }

      } catch (parseError) {
          console.error("Failed to parse request body:", parseError.message);
          return new Response(JSON.stringify({ error: `Bad Request: ${parseError.message}` }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
          });
      }

      console.log(`Received validation request of type: ${validationType}`);

      // 3. Retrieve API Key
      const apiKey = Deno.env.get('GEMINI_VALIDATION_API_KEY'); // Ensure this secret name is correct
      if (!apiKey) {
          console.error('GEMINI_VALIDATION_API_KEY secret not set in Supabase secrets.');
          return new Response(JSON.stringify({ error: 'API key configuration error on server.' }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 500,
          });
      }

      // 4. Initialize Gemini SDK
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
          model: 'gemini-2.0-flash-lite', // Use the latest flash model
          safetySettings: [ // Consistent safety settings
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          ],
          generationConfig: { responseMimeType: 'application/json' }, // Expect JSON
      });

      // 5. Prepare Image Parts and Generate Prompt
      const imageParts = prepareImageParts(requestData.imageBase64, requestData.mimeType);
      const prompt = generatePrompt(requestData);

      console.log(`Sending ${validationType} validation request to Gemini...`);
      if(imageParts.length > 0) console.log("Image data included.");

      // 6. Call Gemini API
      const result = await model.generateContent([prompt, ...imageParts]);
      const response = result.response;

      // 7. Handle Gemini Blocking/Errors
      if (response.promptFeedback?.blockReason) {
          const reason = response.promptFeedback.blockReason;
          console.error(`Gemini validation blocked (${validationType}): ${reason}`);
          return new Response(JSON.stringify({
              isValid: false, // Blocked content is invalid
              reason: `Content blocked by safety filter: ${reason}.`
          }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400, // Bad Request due to content policy violation
          });
      }
       if (!response || typeof response.text !== 'function') {
            console.error('Invalid response object structure from Gemini SDK.');
            throw new Error('Received invalid response structure from Gemini.');
        }

      // 8. Extract and Parse Gemini Response Text based on Type
      const responseText = response.text();
      console.log(`Raw Gemini Response Text (${validationType}):`, responseText);

      let finalIsValid = false;
      let finalReason: string | null = null;

      try {
          let cleanedJsonText = responseText.trim();
          if (cleanedJsonText.startsWith("```json")) cleanedJsonText = cleanedJsonText.substring(7);
          if (cleanedJsonText.startsWith("```")) cleanedJsonText = cleanedJsonText.substring(3);
          if (cleanedJsonText.endsWith("```")) cleanedJsonText = cleanedJsonText.substring(0, cleanedJsonText.length - 3);
          cleanedJsonText = cleanedJsonText.trim();

          if (!cleanedJsonText) throw new Error("Gemini response was empty after cleaning.");

          // Parse and evaluate based on the validation type requested
          if (validationType === 'recipe') {
              const parsedResult: RecipeValidationResult = JSON.parse(cleanedJsonText);
              // ** Validate structure **
              if (typeof parsedResult.is_coffee_image !== 'boolean' || typeof parsedResult.is_coffee_recipe !== 'boolean' || typeof parsedResult.is_safe !== 'boolean' || (parsedResult.reason !== null && typeof parsedResult.reason !== 'string')) {
                  throw new Error("Parsed recipe validation JSON has incorrect structure.");
              }
              console.log('Parsed Recipe Validation Result:', parsedResult);
              finalIsValid = parsedResult.is_coffee_image && parsedResult.is_coffee_recipe && parsedResult.is_safe;
              finalReason = finalIsValid ? null : (parsedResult.reason || "Content does not meet recipe requirements."); // Provide a default reason if null
          }
          else if (validationType === 'profile') {
              const parsedResult: ProfileValidationResult = JSON.parse(cleanedJsonText);
               // ** Validate structure **
              if (typeof parsedResult.is_name_safe !== 'boolean' || (parsedResult.is_image_safe !== null && typeof parsedResult.is_image_safe !== 'boolean') || (parsedResult.reason !== null && typeof parsedResult.reason !== 'string')) {
                  throw new Error("Parsed profile validation JSON has incorrect structure.");
              }
              console.log('Parsed Profile Validation Result:', parsedResult);
              // Image safety only matters if an image was provided and checked
              const imageCheckPassed = requestData.imageBase64 ? parsedResult.is_image_safe === true : true; // If no image sent, it passes the image check
              finalIsValid = parsedResult.is_name_safe && imageCheckPassed;
              finalReason = finalIsValid ? null : (parsedResult.reason || "Profile content is not appropriate."); // Provide a default reason
          }

      } catch (parseError) {
          console.error(`Failed to parse Gemini JSON (${validationType}):`, parseError);
          console.error("Raw response was:", responseText);
          // Return structured error indicating parsing failure
          return new Response(JSON.stringify({
              isValid: false, // Assume invalid if we can't parse
              reason: `Validation service error: Could not understand response (${parseError.message})`
          }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 500,
          });
      }

      // 9. Return the final validation result to the client
      console.log(`Final Validation Decision (${validationType}): isValid=${finalIsValid}, Reason=${finalReason}`);
      return new Response(JSON.stringify({
          isValid: finalIsValid,
          reason: finalReason
      }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
      });

  } catch (error) {
      // General catch block for unexpected errors
      console.error(`Error in Edge Function (${validationType || 'unknown type'}):`, error);
      const errorMessage = error.message || 'Internal Server Error during validation';
      return new Response(JSON.stringify({
          isValid: false, // Assume invalid on general error
          reason: `Validation service error: ${errorMessage}`
      }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
      });
  }
});