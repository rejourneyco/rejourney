// /other-pages/generate-recipe.tsx
"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
  Alert,
  SafeAreaView,
  Dimensions,
  Platform,
  Modal,
  KeyboardAvoidingView,
  Animated,
  Easing,
  ScrollView, // Ensure ScrollView is imported if used (it is)
} from "react-native"
import { Stack, useLocalSearchParams, router, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import * as Haptics from "expo-haptics"
import * as ImagePicker from "expo-image-picker"
import * as FileSystem from "expo-file-system"
import { supabase } from "../../supabase" // Adjust path to your supabase client init
import { getCurrentSupabaseToken } from "../../authUtils" // Adjust path to your auth utils
import uuid from "react-native-uuid"
// Import GoogleGenerativeAI only if needed for local mode
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import Config from "react-native-config" // Keep for local .env access

// --- Central Configuration Import ---
import {
  USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI,
  GEMINI_RECIPE_FUNCTION_NAME,
  GEMINI_VALIDATION_FUNCTION_NAME,
  API_URL, // Use the config variable for Cloudflare Worker
} from "../../config" // Adjust path to your config file

// --- Gemini API Configuration (Conditional) ---
let GEMINI_RECIPE_API_KEY: string | undefined | null = null
let GEMINI_VALIDATION_API_KEY: string | undefined | null = null
let GEMINI_RECIPE_URL: string | null = null

let genAIValidation: GoogleGenerativeAI | null = null
let validationModel: any = null // Keep type 'any' or define a proper GenerativeModel type

if (!USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI) {
  // --- LOCAL DEVELOPMENT (.env) MODE ---
  console.log("(NOBRIDGE) LOG GenerateRecipe: Using LOCAL .env for Gemini Keys.")
  try {
    GEMINI_RECIPE_API_KEY = Config.GEMINI_API_KEY
    GEMINI_VALIDATION_API_KEY = Config.GEMINI_API_KEY // Assuming same key for local, adjust if needed

    if (GEMINI_RECIPE_API_KEY && GEMINI_RECIPE_API_KEY !== "YOUR_GEMINI_API_KEY") {
      GEMINI_RECIPE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_RECIPE_API_KEY}`
      console.log("(NOBRIDGE) LOG GenerateRecipe: Local Recipe Generation URL configured.")
    } else {
      console.warn(
        "(NOBRIDGE) WARN GenerateRecipe: Local GEMINI_API_KEY missing in .env or is placeholder. Recipe generation will fail.",
      )
    }

    // Initialize VALIDATION client only if using local keys AND key is valid
    if (
      GEMINI_VALIDATION_API_KEY &&
      GEMINI_VALIDATION_API_KEY !== "YOUR_GEMINI_API_KEY_FOR_VALIDATION_PLACEHOLDER" && // Use a distinct placeholder if needed
      GEMINI_VALIDATION_API_KEY !== "YOUR_GEMINI_API_KEY" // Also check the main placeholder
    ) {
      try {
        genAIValidation = new GoogleGenerativeAI(GEMINI_VALIDATION_API_KEY)
        validationModel = genAIValidation.getGenerativeModel({
          model: "gemini-2.0-flash-lite", // Or your preferred validation model
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        })
        console.log("(NOBRIDGE) LOG GenerateRecipe: LOCAL Gemini Validation Model Initialized.")
      } catch (error) {
        console.error("(NOBRIDGE) ERROR GenerateRecipe: Failed to initialize LOCAL Gemini Validation Model:", error)
        validationModel = null // Prevent validation if init fails
      }
    } else {
      console.warn(
        "(NOBRIDGE) WARN GenerateRecipe: Local Gemini Validation API Key missing/placeholder in .env. LOCAL Validation will be skipped or fail.",
      )
      validationModel = null // Ensure it's null if key is missing/invalid
    }
  } catch (error) {
    console.error("(NOBRIDGE) ERROR GenerateRecipe: Failed to access local config (react-native-config). Ensure it's set up correctly.", error)
    // Set keys/models to null to prevent errors later
    GEMINI_RECIPE_API_KEY = null
    GEMINI_VALIDATION_API_KEY = null
    GEMINI_RECIPE_URL = null
    validationModel = null
  }
} else {
  // --- EDGE FUNCTION MODE ---
  console.log("(NOBRIDGE) LOG GenerateRecipe: Using Supabase Edge Functions for Gemini Keys.")
  // No need to initialize client-side Gemini SDKs or store keys here.
}

// --- Interfaces ---
interface Recipe {
  title: string
  description: string
  uniqueness_factor?: string
  ingredients: string[]
  instructions: string[]
  brewingTime: string
  strengthLevel: number
}

interface GeminiPart {
  text?: string
  // Include inlineData structure if needed, though handled by SDK/fetch
  inlineData?: {
    data: string
    mimeType: string
  }
}
interface GeminiContent {
  parts: GeminiPart[]
  role?: string
}
interface GeminiRequest {
  contents: GeminiContent[]
  generationConfig?: { responseMimeType?: string }
}
// Interface for the expected SUCCESSFUL Gemini API response structure
interface GeminiResponse {
  candidates?: { content: GeminiContent; finishReason?: string }[]
  error?: { code: number; message: string; status: string } // Gemini's error structure
  promptFeedback?: { blockReason: string }
}

// Interface specifically for the parsed JSON from the VALIDATION model's text response
interface ValidationResult {
  is_coffee_image: boolean | null
  is_coffee_recipe: boolean
  is_safe: boolean
  reason: string | null
}

// Interface for the expected response from our Supabase VALIDATION Edge Function
interface EdgeFunctionValidationResponse {
  isValid: boolean
  reason: string | null
}

type LoadingState = "idle" | "generating" | "done" | "error"

const { width: SCREEN_WIDTH } = Dimensions.get("window")

// --- Component ---
const GenerateRecipe = () => {
  // Params (keep as is)
  const params = useLocalSearchParams<{
    imagePath?: string
    identifiedIngredients?: string
    temperature?: string
    strength?: string
    sweetness?: string
    milk?: string
    flavor?: string
    enhancements?: string
    infusions?: string
    toppings?: string
    texture?: string
    cupSize?: string
    machine?: string
    extraShot?: string
    saltPinch?: string
  }>()

  const inputImagePath = params.imagePath
  const identifiedIngredients: string[] = params.identifiedIngredients ? JSON.parse(params.identifiedIngredients) : []
  const extraShot = params.extraShot === "true"
  const saltPinch = params.saltPinch === "true"

  // State Variables (keep as is)
  const [loadingState, setLoadingState] = useState<LoadingState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [isPosting, setIsPosting] = useState(false)
  const [postingMessage, setPostingMessage] = useState("Starting...");

  // Animation values (keep as is)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0.95)).current
  const spinValue = useRef(new Animated.Value(0)).current

  // Animation Effects (keep as is)
  useEffect(() => {
    if (loadingState === "done") {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
      ]).start()
    }

    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start()
  }, [loadingState, fadeAnim, scaleAnim, spinValue]) // Added missing deps

  // Interpolate spin value (keep as is)
  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  })

  // Focus Effect (keep as is)
  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle("dark-content")
    }, []),
  )

  // --- REVISED API Call Function (Recipe Generation) ---
  const callGeminiRecipeApi = useCallback(async (requestBody: GeminiRequest): Promise<GeminiResponse> => {
    console.log(
      "(NOBRIDGE) LOG GenerateRecipe: Preparing Recipe Generation Request. Mode:",
      USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI ? "Edge Function" : "Local Fetch",
    )

    if (USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI) {
      // --- EDGE FUNCTION LOGIC ---
      try {
        console.log(`(NOBRIDGE) LOG GenerateRecipe: Invoking Supabase function '${GEMINI_RECIPE_FUNCTION_NAME}'...`)

        // Ensure user is authenticated before calling protected function
        const token = await getCurrentSupabaseToken()
        if (!token) {
          // Throw an error that the main generation logic can catch
          throw new Error("Authentication required to generate recipes. Please log in.")
        }

        const { data, error } = await supabase.functions.invoke<GeminiResponse>(GEMINI_RECIPE_FUNCTION_NAME, {
          body: requestBody, // Send the Gemini payload
        })

        // Handle Function Invocation Errors (Network, Auth, Function Crash)
        if (error) {
          console.error(
            `(NOBRIDGE) ERROR GenerateRecipe: Supabase function invoke error (${GEMINI_RECIPE_FUNCTION_NAME}):`,
            error,
          )
          let message = error.message
          // Try to extract more specific messages if available
          if (error instanceof Error && (error as any).context?.errorMessage) {
            message = (error as any).context.errorMessage
          } else if (typeof error === "object" && error !== null && "error_description" in error) {
            message = (error as any).error_description // Common pattern for Supabase errors
          } else if (typeof error === "object" && error !== null && "error" in error) {
             message = (error as any).error // If function returned { error: "..." } explicitly
          }

          // Make common errors more user-friendly
          if (message.toLowerCase().includes("function execution timed out")) {
            throw new Error("The recipe generator took too long. Please try again.")
          } else if (message.toLowerCase().includes("api key configuration error")) {
             throw new Error("Recipe service configuration error. Please contact support.")
          } else if (message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("jwt")) {
             throw new Error("Authentication session issue. Please log out and log back in.")
          }
          throw new Error(`Recipe generation service failed: ${message}`)
        }

        // Handle case where function executed but returned no data (unexpected)
        if (!data) {
          console.error("(NOBRIDGE) ERROR GenerateRecipe: Supabase function returned no data.", { requestBody })
          throw new Error("Received an empty response from the recipe generation service.")
        }

        // --- Process the Gemini Response returned *by the Edge Function* ---
        // The Edge function should ideally forward the Gemini response structure on success.
        console.log(
          "(NOBRIDGE) LOG GenerateRecipe: Received response via Edge Function:",
          JSON.stringify(data).substring(0, 300) + "...",
        )

        // Check for prompt blocks within the Gemini response data
        if (data.promptFeedback?.blockReason) {
          const reason = data.promptFeedback.blockReason
          console.error(`(NOBRIDGE) ERROR GenerateRecipe (Edge): Gemini API Prompt Blocked: ${reason}`)
          throw new Error(`Content generation blocked by safety filter: ${reason}. Adjust selections or ingredients.`)
        }

        // Check for errors *within* the Gemini response structure passed through the function
        if (data.error) {
          const errorMsg = `Recipe API Error via Edge (${data.error.status}): ${data.error.message}`
          console.error("(NOBRIDGE) ERROR GenerateRecipe (Edge): Gemini API Error:", errorMsg, data)
          if (data.error?.status === "RESOURCE_EXHAUSTED" || data.error?.message.includes("quota")) {
            throw new Error("Recipe service is busy. Please try again soon.")
          }
          throw new Error(errorMsg) // Pass specific Gemini error
        }

        // Validate the structure of the successful Gemini response
        if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content?.parts) {
          const finishReason = data.candidates?.[0]?.finishReason
          if (finishReason && finishReason !== "STOP") {
            console.error(`(NOBRIDGE) ERROR GenerateRecipe (Edge): Gemini API finished unexpectedly: ${finishReason}`, data)
            // Keep existing finish reason handling
            if (finishReason === "SAFETY") throw new Error("Generation stopped due to safety concerns with the input.")
            if (finishReason === "RECITATION") throw new Error("Generation stopped to prevent recitation issues.")
            if (finishReason === "MAX_TOKENS") throw new Error("The generated recipe became too long.")
            throw new Error(`Content generation failed: ${finishReason}.`)
          }
          console.error("(NOBRIDGE) ERROR GenerateRecipe (Edge): Gemini API Invalid Response Structure:", data)
          throw new Error("Invalid response structure from the recipe generator (via Edge).")
        }

        // Success: Return the Gemini response data passed through the Edge Function
        return data

      } catch (error: any) {
        // Catch errors from invoke OR from processing the response
        console.error("(NOBRIDGE) ERROR GenerateRecipe: Error invoking/processing Edge Function:", error)
        // Rethrow the specific error message caught
        throw new Error(error.message || "Failed to contact the recipe generation service.")
      }
    } else {
      // --- LOCAL .ENV FETCH LOGIC (Original Code slightly adapted) ---
      if (!GEMINI_RECIPE_API_KEY || !GEMINI_RECIPE_URL) {
        console.error("(NOBRIDGE) ERROR GenerateRecipe: Local API Key/URL not configured.")
        throw new Error("Local Recipe Generation API Key/URL is not configured in .env.")
      }
      console.log("(NOBRIDGE) LOG GenerateRecipe: Sending Recipe Generation request via LOCAL fetch...")

      try {
        const response = await fetch(GEMINI_RECIPE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        })

        const data: GeminiResponse = await response.json()
        console.log("(NOBRIDGE) LOG GenerateRecipe: Received LOCAL Recipe Generation response:", JSON.stringify(data))

        // --- Process the response (Original Local Logic) ---
        if (data.promptFeedback?.blockReason) {
          const reason = data.promptFeedback.blockReason
          console.error(`(NOBRIDGE) ERROR GenerateRecipe (Local): Gemini API Prompt Blocked: ${reason}`)
          throw new Error(`Content generation blocked by safety filter: ${reason}. Adjust selections or ingredients.`)
        }

        if (!response.ok || data.error) {
          const errorMsg = data.error
            ? `Recipe API Error (Local) (${data.error.status}): ${data.error.message}`
            : `Recipe HTTP Error (Local): ${response.status}`
          console.error("(NOBRIDGE) ERROR GenerateRecipe (Local): Gemini API Error:", errorMsg, data)
          if (data.error?.status === "RESOURCE_EXHAUSTED" || data.error?.message.includes("quota")) {
            throw new Error("Recipe service is busy. Please try again soon.")
          }
          throw new Error(errorMsg)
        }

        if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content?.parts) {
          const finishReason = data.candidates?.[0]?.finishReason
          if (finishReason && finishReason !== "STOP") {
             console.error(`(NOBRIDGE) ERROR GenerateRecipe (Local): Gemini API finished unexpectedly: ${finishReason}`, data)
             if (finishReason === "SAFETY") throw new Error("Generation stopped due to safety concerns with the input.")
             if (finishReason === "RECITATION") throw new Error("Generation stopped to prevent recitation issues.")
             if (finishReason === "MAX_TOKENS") throw new Error("The generated recipe became too long.")
             throw new Error(`Content generation failed: ${finishReason}.`)
          }
          console.error("(NOBRIDGE) ERROR GenerateRecipe (Local): Gemini API Invalid Response Structure:", data)
          throw new Error("Invalid response from the local recipe generator.")
        }

        // Success: Return the Gemini response data from local fetch
        return data

      } catch (error: any) {
        console.error("(NOBRIDGE) ERROR GenerateRecipe: Error calling LOCAL Gemini Recipe API:", error)
        // Use existing logic to make errors user-friendly
        const userFriendlyError = error.message?.includes("API key not valid")
          ? "Configuration error with the recipe service (Local Key Invalid)."
          : error.message?.includes("blocked") || error.message?.includes("safety") || error.message?.includes("filter")
            ? error.message // Show specific block reason
            : error.message?.includes("busy")
              ? error.message // Show busy message
              : error.message || "Failed to contact the local recipe generator."
        throw new Error(userFriendlyError)
      }
    }
  }, []) // useCallback dependencies are empty as config flag and supabase client are stable during component life

  // --- Fetch Generation Prompt ---
  const fetchGenerationPrompt = useCallback(async () => {
    console.log("(NOBRIDGE) LOG GenerateRecipe: Attempting to fetch gen_prompt..."); // <-- Add log
    try {
      const { data, error } = await supabase
        .from("app_config")
        .select("gen_prompt") // Ensure this column name matches EXACTLY in Supabase
        .single(); // Assuming only one row in app_config

      // Log the raw response
      console.log("(NOBRIDGE) LOG GenerateRecipe: Raw fetch response:", { data, error }); // <-- Add log

      if (error) {
        console.error("(NOBRIDGE) ERROR GenerateRecipe: Error fetching gen_prompt:", error);
        // Will use default hardcoded prompt as fallback
        return; // Indicate failure or fallback needed
      }
      
      // Check specifically if the prompt field exists and is non-empty
      if (data?.gen_prompt && typeof data.gen_prompt === 'string' && data.gen_prompt.trim() !== '') {
        console.log("(NOBRIDGE) LOG GenerateRecipe: Using gen_prompt from app_config");
        return data.gen_prompt; // Return the fetched prompt on success
      } else {
        console.warn("(NOBRIDGE) WARN GenerateRecipe: gen_prompt not found or empty in fetched data. Using default."); // <-- Add log
        return; // Indicate fallback needed
      }
    } catch (error) {
      console.error("(NOBRIDGE) ERROR GenerateRecipe: Unexpected error fetching gen_prompt:", error);
      return; // Indicate failure
    }
  }, []);

  // --- Main Logic Effect (Recipe Generation) ---
  useEffect(() => {
    const initializeAndGenerate = async () => { // Rename the async function
      if (loadingState !== "idle") return // Prevent re-triggering if already running/done/error

      setLoadingState("generating"); // Set loading state early
      setErrorMessage(null);
      setRecipe(null);
      console.log("(NOBRIDGE) LOG GenerateRecipe: Starting recipe generation process...");

      // --- Step 1: Fetch the prompt ---
      const fetchedPrompt = await fetchGenerationPrompt(); // Await the fetch result

      // --- Step 2: Proceed with generation ---
      // Initial check only needed for local mode (keep as is)
      if (
        !USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI &&
        (!GEMINI_RECIPE_API_KEY || GEMINI_RECIPE_API_KEY === "YOUR_GEMINI_API_KEY" || !GEMINI_RECIPE_URL)
      ) {
        setErrorMessage("Local Recipe Generation API Key/URL is not configured correctly in .env.")
        setLoadingState("error")
        Alert.alert("Local Config Error", "Set GEMINI_API_KEY in your .env file for local development.")
        return
      }

      console.log("(NOBRIDGE) LOG GenerateRecipe: Using generation parameters:", params)

      try {
        // Build User Preferences String (keep as is)
        const userPreferences = `
          Temperature: ${params.temperature || "Any"}
          Strength: ${params.strength || "Medium"}
          Sweetness: ${params.sweetness || "None"}
          Milk: ${params.milk || "None"}
          Flavor: ${params.flavor || "None"}
          Creative Enhancement: ${params.enhancements || "None"}
          Infusions: ${params.infusions || "None"}
          Toppings: ${params.toppings || "None"}
          Texture: ${params.texture || "Regular"}
          Cup Size: ${params.cupSize || "Medium"}
          Method: ${params.machine || "Any appropriate"}
          Extra Shot: ${extraShot ? "Yes" : "No"}
          Salt Pinch: ${saltPinch ? "Yes" : "No"}
        `
        // Default prompt (keep your actual default prompt here)
        const defaultPrompt = `You are BaristaAI, a highly creative and award-winning coffee innovator running a fun, experimental Coffee Lab.
Your task is to invent a UNIQUE, EXCITING, and MEMORABLE coffee recipe based primarily on these specific ingredients the user has, make sure it also tastes good:
\${identifiedIngredients.length > 0 ? identifiedIngredients.map((i) => \`- \${i}\`).join("\\n") : "- No specific items identified (base recipe purely on preferences below)."}

Consider the user's desired preferences for this creation:
\${userPreferences}

Recipe Requirements (Critical):

1.  **WOW Factor:** This is NOT a standard recipe. Combine the identified ingredients and preferences in an UNEXPECTED but DELIGHTFUL way. Think globally inspired drinks, unusual pairings (sweet & savory?), interesting textures, surprising temperatures. GET CREATIVE!
2.  **Ingredient Focus:** If ingredients are provided, make them the STAR. How can you use '\${identifiedIngredients[0] || "the main ingredient"}' and the user's preferences? CRITICAL: DO NOT ADD ANY EXTRA INGREDIENTS OR SUBSTITUTIONS. Only use the provided items and common basics like water if necessary.
3.  **Simulated Inspiration:** Act as if you've searched for niche global coffee trends & innovative cafe specials featuring these ingredients/preferences. Synthesize these ideas into something NEW.
4.  **Home Possible:** While creative, the recipe MUST be reasonably achievable in a home kitchen with standard tools, plus the specific 'Method' (machine) chosen by the user. Explain any slightly unusual steps clearly.
5.  **Clarity:** Provide clear, numbered, step-by-step instructions.
6.  **Time & Units:** Prep and brew time MUST be under 5 minutes total. Use simple home units like TBSP, TSP, CUPS, ML. AVOID grams (g) or ounces (oz) unless absolutely necessary for precision (like coffee grounds weight).
7.  **Tone:** Make it sound fun and adventurous! This is a Coffee Lab experiment!

**Output Format (ABSOLUTELY CRITICAL):**

*   **ONLY JSON:** Your entire response MUST be **ONLY** the valid JSON object specified below.
*   **NO EXTRA TEXT:** Do NOT include *any* introductory text, concluding remarks, explanations, apologies, or markdown formatting like \\\`\\\`\\\`json before or after the JSON object.
*   **START/END:** Your response must start *exactly* with \`{\` and end *exactly* with \`}\`.
*   **VALIDATION:** Ensure the JSON is perfectly valid and adheres strictly to this structure:

{
"title": "string (Catchy, unique, slightly intriguing title including coffee type like 'Iced Coffee', max 3-4 words)",
"description": "string (Short, 1-2 sentence description hyping up the unique aspect)",
"uniqueness_factor": "string (Briefly explain WHAT makes this recipe special/unique - e.g., 'Infuses cold brew with rosemary and orange zest' or 'Creates a layered effect with spiced foam')",
"ingredients": ["string (Quantity Unit Ingredient - e.g., '18g Espresso Grind Coffee', '1 Thin Orange Slice', '2 Cardamom Pods, lightly crushed', '1 tbsp Honey', '1/2 cup Oat Milk')"],
"instructions": ["string (Numbered steps, clear and concise - e.g., '1. Prepare 40ml espresso using your machine.')"],
"brewingTime": "string (Approximate total time - e.g., 'Approx. 4 minutes')",
"strengthLevel": number (Integer 1-5, perceived strength)
}`;

        // Use the fetched prompt if available, otherwise use default
        // Note: fetchedPrompt might be undefined if fetch failed or returned empty
        const generationPrompt = fetchedPrompt
          ? fetchedPrompt // Use the directly returned prompt from the awaited fetch
            .replace("${identifiedIngredients.length > 0 ? identifiedIngredients.map((i) => `- ${i}`).join(\"\\n\") : \"- No specific items identified (base recipe purely on preferences below).\"}",
              identifiedIngredients.length > 0 ? identifiedIngredients.map((i) => `- ${i}`).join("\n") : "- No specific items identified (base recipe purely on preferences below).")
            .replace("${userPreferences}", userPreferences)
            .replace("${identifiedIngredients[0] || \"the main ingredient\"}", identifiedIngredients[0] || "the main ingredient")
          : defaultPrompt; // Fallback to default if fetch returned nothing useful

        // Log which prompt is actually being used
        console.log(`(NOBRIDGE) LOG GenerateRecipe: Using ${fetchedPrompt ? 'Supabase' : 'Default'} prompt for generation.`);

        const generationRequest: GeminiRequest = {
          contents: [{ parts: [{ text: generationPrompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }

        // Call the appropriate API method (Edge or Local)
        const generationResponse = await callGeminiRecipeApi(generationRequest);

        // --- Process the SUCCESSFUL response ---
        const recipeJsonText = generationResponse.candidates?.[0]?.content?.parts?.[0]?.text;
      
        // --- ROBUST JSON EXTRACTION ---
        try {
            console.log("(NOBRIDGE) LOG GenerateRecipe: Raw text received for parsing:", recipeJsonText);

            if (!recipeJsonText || typeof recipeJsonText !== 'string' || recipeJsonText.trim() === "[]") {
                throw new Error("Failed to extract recipe data structure from the generator's response.");
            }

            // Attempt to find the first '{' and the last '}'
            const startIndex = recipeJsonText.indexOf('{');
            const endIndex = recipeJsonText.lastIndexOf('}');

            if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
                throw new Error("Failed to extract recipe data structure from the generator's response.");
            }

            // Extract the substring that looks like JSON
            const extractedJsonText = recipeJsonText.substring(startIndex, endIndex + 1);
            console.log("(NOBRIDGE) LOG GenerateRecipe: Attempting to parse extracted JSON:", extractedJsonText);

            // Now, try parsing the extracted block
            const parsedJson: any = JSON.parse(extractedJsonText);
            console.log("(NOBRIDGE) LOG GenerateRecipe: JSON Parsed Successfully.");

            // Check for the explicit error object from the prompt's failure case
            if (parsedJson.error && typeof parsedJson.error === 'string') {
                console.error("(NOBRIDGE) ERROR GenerateRecipe: AI reported failure to generate:", parsedJson.error);
                throw new Error(`Recipe generation failed: ${parsedJson.error}`);
            }

            // Cast to Partial<Recipe> for structure validation
            const parsedRecipe: Partial<Recipe> = parsedJson;
            console.log("(NOBRIDGE) LOG GenerateRecipe: Starting validation of parsed recipe structure...");

            // ** Stricter Validation of Parsed Recipe **
            if (
               !parsedRecipe.title || typeof parsedRecipe.title !== "string" ||
               !parsedRecipe.description || typeof parsedRecipe.description !== "string" ||
               !parsedRecipe.ingredients || !Array.isArray(parsedRecipe.ingredients) || parsedRecipe.ingredients.some(i => typeof i !== 'string') ||
               !parsedRecipe.instructions || !Array.isArray(parsedRecipe.instructions) || parsedRecipe.instructions.some(i => typeof i !== 'string') ||
               !parsedRecipe.brewingTime || typeof parsedRecipe.brewingTime !== "string" ||
               parsedRecipe.strengthLevel === undefined || typeof parsedRecipe.strengthLevel !== 'number' || !Number.isInteger(parsedRecipe.strengthLevel)
            ) {
               console.error("(NOBRIDGE) ERROR GenerateRecipe: Parsed JSON has incorrect structure or invalid values:", parsedRecipe);
               throw new Error("Received recipe data is incomplete or malformed after extraction.");
            }
            console.log("(NOBRIDGE) LOG GenerateRecipe: Recipe structure validation passed.");

            // --- Number Instructions (Optional but good practice) ---
            const numberedInstructions = parsedRecipe.instructions.map((instr, index) => {
                const textOnly = instr.replace(/^\d+\.?\s*/, '').trim();
                return `${index + 1}. ${textOnly}`;
            });
            parsedRecipe.instructions = numberedInstructions;
            console.log("(NOBRIDGE) LOG GenerateRecipe: Instructions numbered.");

            // --- Set State ---
            console.log("(NOBRIDGE) LOG GenerateRecipe: Calling setRecipe...");
            setRecipe(parsedRecipe as Recipe);

            console.log("(NOBRIDGE) LOG GenerateRecipe: Calling setLoadingState('done')...");
            setLoadingState("done");

            console.log("(NOBRIDGE) LOG GenerateRecipe: Recipe generated and state updated successfully:", parsedRecipe);

        } catch (parseError: any) {
             console.error("(NOBRIDGE) ERROR GenerateRecipe: Failed during JSON extraction or parsing/validation:", parseError);
             console.error("(NOBRIDGE) ERROR GenerateRecipe: Original raw text received was:", recipeJsonText);
             setErrorMessage(parseError.message || "Failed to process the generated recipe data.");
             setLoadingState("error");
        }
        // --- END ROBUST JSON EXTRACTION ---
      
      } catch (error: any) {
          console.error("(NOBRIDGE) ERROR GenerateRecipe: Error in generation process:", error);
          setErrorMessage(error.message || "An unknown error occurred during recipe creation.");
          setLoadingState("error");
      }
    }
      
    initializeAndGenerate(); // Call the async function

  }, [params]);

  // --- Navigation and Retry --- (keep as is)
  const handleBack = useCallback(() => {
    if (isPosting) return // Prevent back navigation during post
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace("/(tabs)/home") // Adjust fallback
    }
  }, [isPosting])

  const handleRetryGeneration = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setLoadingState("idle") // Reset to trigger useEffect again
    // Reset other relevant states if needed
    setRecipe(null)
    setErrorMessage(null)
  }, [])

  // --- Posting Feature Functions ---

  // --- REVISED Image Selection Function ---
  const selectImage = useCallback(async (): Promise<string | null> => {
    // Request both permissions upfront for simplicity, or request individually later
    const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
    const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (cameraStatus !== 'granted' && libraryStatus !== 'granted') {
      Alert.alert('Permission Required', 'We need access to your camera or photo library to add a photo.');
      return null;
    }

    return new Promise((resolve) => {
      Alert.alert(
        "Add Photo",
        "Choose an option:",
        [
          {
            text: "Take Photo",
            onPress: async () => {
              if (cameraStatus !== 'granted') {
                Alert.alert('Permission Denied', 'Camera access is required to take a photo.');
                resolve(null);
                return;
              }
              try {
                const result = await ImagePicker.launchCameraAsync({
                  quality: 0.6,
                  allowsEditing: Platform.OS === "android", // Editing after capture
                  aspect: Platform.OS === "android" ? [3, 4] : undefined,
                  base64: false, // Don't need base64 for upload URI
                });
                if (!result.canceled && result.assets && result.assets.length > 0) {
                  console.log("(NOBRIDGE) LOG GenerateRecipe: Photo taken:", result.assets[0].uri);
                  resolve(result.assets[0].uri);
                } else {
                  console.log("(NOBRIDGE) LOG GenerateRecipe: Camera cancelled.");
                  resolve(null);
                }
              } catch (error) {
                console.error("(NOBRIDGE) ERROR GenerateRecipe: Error launching camera:", error);
                Alert.alert("Camera Error", "Could not take photo.");
                resolve(null);
              }
            },
          },
          {
            text: "Choose from Library",
            onPress: async () => {
              if (libraryStatus !== 'granted') {
                Alert.alert('Permission Denied', 'Photo library access is required to choose a photo.');
                resolve(null);
                return;
              }
              try {
                const pickerOptions: ImagePicker.ImagePickerOptions = {
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  quality: 0.6,
                  base64: false,
                  allowsEditing: Platform.OS === "android",
                  aspect: Platform.OS === "android" ? [3, 4] : undefined,
                };
                const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
                if (!result.canceled && result.assets && result.assets.length > 0) {
                  console.log("(NOBRIDGE) LOG GenerateRecipe: Result image selected:", result.assets[0].uri);
                  resolve(result.assets[0].uri);
                } else {
                  console.log("(NOBRIDGE) LOG GenerateRecipe: Image picking cancelled.");
                  resolve(null);
                }
              } catch (error) {
                console.error("(NOBRIDGE) ERROR GenerateRecipe: Error picking image:", error);
                Alert.alert("Image Picker Error", "Could not select image.");
                resolve(null);
              }
            },
          },
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => resolve(null),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(null) } // Resolve null if dismissed
      );
    });
  }, []); // Keep dependencies empty

  // --- REVISED Gemini Validation Function ---
   const validateContentWithGemini = async (
    recipeToValidate: Recipe,
    imageUri: string,
  ): Promise<{ isValid: boolean; reason: string | null }> => {
    // Initial checks (keep as is)
    if (!imageUri) {
      return { isValid: false, reason: "A result photo is required to post." }
    }

    setPostingMessage("Validating post...")

    // --- Prepare data needed for BOTH modes ---
    // Recipe text content is needed for both modes
    const textContent = `
       Recipe Title: ${recipeToValidate.title}
       Description: ${recipeToValidate.description}
       Uniqueness: ${recipeToValidate.uniqueness_factor || "N/A"}
       Ingredients: ${recipeToValidate.ingredients.filter((i) => i.trim()).join("; ")}
       Instructions Summary: ${recipeToValidate.instructions.filter((s) => s.trim()).slice(0, 3).join(" ")}...
     `

    // --- Image Data Preparation (needed for BOTH modes, but used differently) ---
    let imageBase64: string | null = null
    let imageMimeType: string | null = null
    let imagePartsForLocalSdk: { inlineData: { data: string; mimeType: string } }[] = [] // Only for local SDK

    try {
      const fileInfo = await FileSystem.getInfoAsync(imageUri)
      if (!fileInfo.exists) throw new Error("Selected image file not found.")

      // Get Base64 for both Edge Function and Local SDK
      imageBase64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 })

      // Determine MIME Type for both Edge Function and Local SDK
      const fileExtension = imageUri.split(".").pop()?.toLowerCase()
      let determinedMimeType = "image/jpeg" // Default
      if (fileExtension === "png") determinedMimeType = "image/png"
      else if (fileExtension === "webp") determinedMimeType = "image/webp"
      else if (["heic", "heif"].includes(fileExtension || "")) determinedMimeType = "image/" + fileExtension // Basic HEIC/HEIF support
      imageMimeType = determinedMimeType

      // *Only* prepare the imageParts structure if NOT using edge functions
      if (!USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI && imageBase64 && imageMimeType) {
        imagePartsForLocalSdk = [{ inlineData: { data: imageBase64, mimeType: imageMimeType } }]
      }

    } catch (error: any) {
      console.error("(NOBRIDGE) ERROR GenerateRecipe: Error processing image for validation:", error)
      return { isValid: false, reason: `Could not process the image: ${error.message}` }
    }
    // --- End of Image Data Preparation ---


    if (USE_SUPABASE_EDGE_FUNCTIONS_FOR_GEMINI) {
      // --- EDGE FUNCTION VALIDATION ---
      console.log(`(NOBRIDGE) LOG GenerateRecipe: Invoking Supabase function '${GEMINI_VALIDATION_FUNCTION_NAME}' for validation...`)

      try {
        // Ensure user is authenticated
        const token = await getCurrentSupabaseToken()
        if (!token) {
          throw new Error("Authentication required for content validation.")
        }

        // --- Prepare payload matching the Edge Function's ClientRequestBody ---
        // Note: We send raw base64 and mimeType, not imageParts or the prompt
        const edgeFunctionPayload = {
          type: "recipe", // Tell the edge function what kind of validation
          recipeText: textContent, // Send the raw recipe text
          imageBase64: imageBase64, // Send the raw base64 string (or null if processing failed)
          mimeType: imageMimeType, // Send the mime type string (or null)
        }

        console.log("(NOBRIDGE) LOG GenerateRecipe: Sending payload to Edge Function:", {
           type: edgeFunctionPayload.type,
           recipeTextLength: edgeFunctionPayload.recipeText.length,
           imageBase64Present: !!edgeFunctionPayload.imageBase64,
           mimeType: edgeFunctionPayload.mimeType
        }); // Log sanitized payload

        const { data, error } = await supabase.functions.invoke<EdgeFunctionValidationResponse>(
          GEMINI_VALIDATION_FUNCTION_NAME,
          { body: edgeFunctionPayload }, // Send the CORRECT payload structure
        )

        // Handle Function Invocation Errors (keep existing logic)
        if (error) {
          console.error(
            `(NOBRIDGE) ERROR GenerateRecipe: Supabase function invoke error (${GEMINI_VALIDATION_FUNCTION_NAME}):`,
            error,
          )
          let message = error.message
          // Extract nested error messages if possible (similar to recipe function)
          if (error instanceof Error && (error as any).context?.errorMessage) {
            message = (error as any).context.errorMessage
          } else if (typeof error === 'object' && error !== null && 'reason' in error && typeof (error as any).isValid === 'boolean') {
             // If the function itself threw an error matching our expected return structure
             message = `Validation check failed: ${(error as any).reason}`
             return { isValid: false, reason: message }; // Return structured error immediately
          }
          // Check for common Supabase error patterns
          else if (typeof error === "object" && error !== null && "error_description" in error) {
              message = (error as any).error_description // Common pattern for Supabase errors
          } else if (typeof error === "object" && error !== null && "error" in error) {
              message = (error as any).error // If function returned { error: "..." } explicitly
          }
          // Fallback generic message
          throw new Error(`Validation service failed: ${message}`)
        }

        // Handle case where function executed but returned invalid data structure (keep existing logic)
        if (!data || typeof data.isValid !== "boolean") {
          console.error("(NOBRIDGE) ERROR GenerateRecipe: Invalid response structure from validation Edge Function:", data)
          throw new Error("Received an invalid response structure from the validation service.")
        }

        console.log("(NOBRIDGE) LOG GenerateRecipe: Received validation result via Edge Function:", data)

        // The edge function returns the final { isValid, reason } structure directly
        return data // e.g., { isValid: true, reason: null } or { isValid: false, reason: "..." }

      } catch (error: any) {
        // Catch errors from invoke OR from processing the response (keep existing logic)
        console.error("(NOBRIDGE) ERROR GenerateRecipe: Error invoking/processing validation Edge Function:", error)
        // Return a consistent failure format
        return { isValid: false, reason: `Validation service error: ${error.message || "Please try again."}` }
      }
    } else {
      // --- LOCAL .ENV VALIDATION ---
      console.log("(NOBRIDGE) LOG GenerateRecipe: Performing validation using LOCAL Gemini SDK...")

      // Check if the local validation model was initialized successfully earlier (keep existing logic)
      if (!validationModel) {
        console.warn(
          "(NOBRIDGE) WARN GenerateRecipe: Skipping LOCAL Gemini validation: Model not initialized (check API key in .env).",
        )
        return { isValid: false, reason: "Local validation setup error (check .env API key)." }
      }

       // Validation Prompt (only needed for LOCAL mode now)
      const validationPrompt = `
       Analyze the user's coffee post (recipe text + photo of their drink).
       Check 3 things:
       1. Does the PHOTO clearly show a coffee drink or coffee preparation?
       2. Does the TEXT describe a coffee-based recipe?
       3. Are BOTH the photo and text safe for a general audience (SFW, no hate/harassment/dangerous acts)?
       Respond ONLY with a VALID JSON object adhering strictly to this structure:
       {
         "is_coffee_image": boolean | null,
         "is_coffee_recipe": boolean,
         "is_safe": boolean,
         "reason": string | null
       }
       Set booleans accurately (true/false). 'is_coffee_image' can be null if no image provided, but should be boolean otherwise.
       Provide a brief 'reason' string ONLY if any boolean is false (e.g., "Image does not show coffee", "Text isn't a coffee recipe", "Content potentially unsafe"). If all true, 'reason' MUST be null.
       Recipe Text Context:
       ${textContent}
     ` // Note: textContent is already defined above

      try {
        console.log("(NOBRIDGE) LOG GenerateRecipe: Sending content to LOCAL Gemini for validation...")
        // Use the locally initialized model and the prepared imagePartsForLocalSdk
        const result = await validationModel.generateContent([validationPrompt, ...imagePartsForLocalSdk]) // Pass prompt and CORRECT image parts structure
        const response = await result.response

        // --- Process the response (Original Local Logic - remains the same) ---
        // ... (keep the existing local response processing, parsing, and evaluation logic here) ...
         if (response.promptFeedback?.blockReason) {
          const reason = response.promptFeedback.blockReason
          console.error(`(NOBRIDGE) ERROR GenerateRecipe (Local): Validation blocked by Gemini safety settings: ${reason}`)
          return { isValid: false, reason: `Post blocked by content filter: ${reason}.` }
        }

        const responseText = response.text()
        console.log("(NOBRIDGE) LOG GenerateRecipe: Raw LOCAL Gemini Validation Response:", responseText)

        let validationResult: ValidationResult // Use existing interface
        let cleanedJsonText = ""

        try {
          // Keep your original robust cleaning logic
          cleanedJsonText = responseText.trim()
          if (cleanedJsonText.startsWith("```json")) cleanedJsonText = cleanedJsonText.substring(7)
          if (cleanedJsonText.startsWith("```")) cleanedJsonText = cleanedJsonText.substring(3)
          if (cleanedJsonText.endsWith("```")) cleanedJsonText = cleanedJsonText.substring(0, cleanedJsonText.length - 3)
          cleanedJsonText = cleanedJsonText.trim()

          if (!cleanedJsonText) throw new Error("Validation response was empty after cleaning.")
          if (!cleanedJsonText.startsWith("{") || !cleanedJsonText.endsWith("}")) {
            throw new Error("Validation response does not appear to be JSON.")
          }

          console.log("(NOBRIDGE) LOG GenerateRecipe: Attempting to parse cleaned LOCAL validation JSON:", cleanedJsonText)
          validationResult = JSON.parse(cleanedJsonText)

          // ** Crucial Check ** Validate the structure of the PARSED object
          if (
            validationResult.is_coffee_image === undefined || // Check presence, allow null
            typeof validationResult.is_coffee_recipe !== "boolean" ||
            typeof validationResult.is_safe !== "boolean" ||
            (validationResult.reason !== null && typeof validationResult.reason !== "string")
          ) {
            console.error(
              "(NOBRIDGE) ERROR GenerateRecipe (Local): Parsed validation JSON has incorrect structure:",
              validationResult,
            )
            throw new Error("Validation response format is incorrect.")
          }
        } catch (parseError: any) {
          console.error("(NOBRIDGE) ERROR GenerateRecipe (Local): Failed to parse Gemini validation JSON:", parseError)
          console.error("(NOBRIDGE) ERROR GenerateRecipe (Local): Raw response was:", responseText)
          console.error("(NOBRIDGE) ERROR GenerateRecipe (Local): Cleaned text was:", cleanedJsonText)
          // Handle specific safety blocks if parsing fails but text indicates it
          if (responseText.toLowerCase().includes("safety") || responseText.toLowerCase().includes("block")) {
             return { isValid: false, reason: "Post blocked by content filter during analysis." }
          }
          // General parsing failure
          return { isValid: false, reason: `Validation failed: Could not understand response (${parseError.message})` }
        }

        // Evaluate the PARSED validation result (Original Logic)
        if (!validationResult.is_safe) {
          return { isValid: false, reason: validationResult.reason || "Content was deemed potentially unsafe." }
        }
        // Image is required for posting, so treat null/false is_coffee_image as invalid
        if (!validationResult.is_coffee_image) {
          return { isValid: false, reason: validationResult.reason || "The photo doesn't appear to show coffee." }
        }
        if (!validationResult.is_coffee_recipe) {
          return { isValid: false, reason: validationResult.reason || "The text doesn't seem to be a coffee recipe." }
        }

        console.log("(NOBRIDGE) LOG GenerateRecipe: LOCAL Gemini content validation successful.")
        return { isValid: true, reason: null } // Success


      } catch (error: any) {
        // ... (keep existing local error handling logic) ...
         console.error("(NOBRIDGE) ERROR GenerateRecipe: LOCAL Gemini Validation API call error:", error)
        // Check structured feedback again if available on error object
        if (error.response?.promptFeedback) {
            const blockReason = error.response.promptFeedback.blockReason
            return { isValid: false, reason: `Post blocked by content filter (${blockReason}).` }
        }
        // General API call failure
        return { isValid: false, reason: `Local validation service error: ${error.message || "Please try again."}` }
      }
    }
  }


  // Post Result Function (Logic using validation result remains the same)
  const handlePostResult = async (resultImageUri: string) => {
    if (!recipe) {
      Alert.alert("Error", "No recipe available to post.")
      return
    }
    if (!resultImageUri) {
      Alert.alert("Error", "Result image is missing.")
      return
    }

    setIsPosting(true)
    setPostingMessage("Checking post...") // Initial message

    try {
      // --- CONTENT VALIDATION (Calls the revised function) ---
      const validation = await validateContentWithGemini(recipe, resultImageUri)
      if (!validation.isValid) {
        // Use the reason provided by the validation function
        Alert.alert("Post Rejected", validation.reason || "Content does not meet posting guidelines.")
        setIsPosting(false)
        return
      }
      // --- END VALIDATION ---

      // --- REST OF POSTING LOGIC (Authentication, Image Upload, Supabase Insert) ---
      // This part remains unchanged as it depends on the *result* of validation,
      // not how validation was performed.

      setPostingMessage("Authenticating...")
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()
      if (authError || !user) {
        throw new Error("Authentication failed. Please log in again.")
      }

      setPostingMessage("Preparing image...")
      const token = await getCurrentSupabaseToken() // Use your existing util
      if (!token) {
        throw new Error("Session invalid. Please log in again.")
      }

      const postId = uuid.v4() as string // Use UUID for unique ID
      const filename = resultImageUri.split("/").pop() || `${postId}.jpg`
      const fileTypeMatch = filename.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)
      const fileExtension = fileTypeMatch ? fileTypeMatch[1].toLowerCase() : "jpeg"
      const mimeType = `image/${fileExtension === "jpg" ? "jpeg" : fileExtension}`

      const formData = new FormData()
      formData.append("image", {
        uri: resultImageUri,
        name: filename,
        type: mimeType,
      } as any)

      setPostingMessage("Uploading image...")
      console.log("(NOBRIDGE) LOG GenerateRecipe: Uploading result image to worker...")
      // Use API_URL from config
      const uploadResponse = await fetch(`${API_URL}/api/upload-post-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }, // Worker needs the token
        body: formData,
      })

      if (!uploadResponse.ok) {
        let errorData
        try {
          errorData = await uploadResponse.json()
        } catch (e) {
          errorData = { error: `Image upload failed: Status ${uploadResponse.status}` }
        }
        console.error("(NOBRIDGE) ERROR GenerateRecipe: Image upload error:", errorData)
        throw new Error(errorData.error || "Image upload failed.")
      }

      const uploadData = await uploadResponse.json()
      const imageUrl = uploadData.url // Expecting { url: "..." } from worker
      if (!imageUrl) throw new Error("Image URL not received after upload.")
      console.log("(NOBRIDGE) LOG GenerateRecipe: Result image uploaded:", imageUrl)

      setPostingMessage("Saving post...")
      console.log("(NOBRIDGE) LOG GenerateRecipe: Inserting recipe post into Supabase...")
      const { error: insertError } = await supabase.from("recipes").insert([
        {
          creator_uuid: user.id,
          title: recipe.title,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          image_url: imageUrl, // URL of the uploaded RESULT photo
          is_published: true,
          like_count: 0,
          // Add optional fields if columns exist in your 'recipes' table
          // brewing_time: recipe.brewingTime,
          // strength_level: recipe.strengthLevel,
          // uniqueness_factor: recipe.uniqueness_factor,
        },
      ])

      if (insertError) {
        console.error("(NOBRIDGE) ERROR GenerateRecipe: Supabase insert error:", insertError)
        throw new Error(`Database error: ${insertError.message}`)
      }

      console.log("(NOBRIDGE) LOG GenerateRecipe: Recipe post published successfully!")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert("Posted!", "Your unique coffee creation is now shared!")

      // Navigate away after success
      router.replace("/(tabs)/community") // Go to community feed

    } catch (error: any) {
      console.error("(NOBRIDGE) ERROR GenerateRecipe: Post result error:", error)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert("Posting Failed", error.message || "An unexpected error occurred.")
    } finally {
      setIsPosting(false)
      setPostingMessage("Starting...") // Reset status
    }
  }

  // Orchestrator function (MODIFIED TO USE selectImage)
  const startPostingProcess = async () => {
    if (!recipe) {
      Alert.alert("Wait!", "The recipe needs to finish generating first.")
      return
    }
    if (isPosting) return

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    // Use the new function that presents the choice
    const selectedImageUri = await selectImage()

    if (selectedImageUri) {
      setResultImage(selectedImageUri) // Store in state
      await handlePostResult(selectedImageUri) // Start the posting logic with the URI
    } else {
      console.log("(NOBRIDGE) LOG GenerateRecipe: Image selection cancelled or failed by user.")
      // Optionally reset isPosting if it was set prematurely, though it shouldn't be here
    }
  }

  // --- RENDER STATES --- (No changes needed to JSX structure or styles)

  // Generating State
  if (loadingState === "generating") {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="dark-content" />
        <View style={styles.loadingContent}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name="flask" size={70} color={coffeeBrown} />
          </Animated.View>
          <Text style={styles.loadingTitle}>Creating Your Recipe</Text>
          <View style={styles.loadingProgressContainer}>
            <View style={styles.loadingProgressBar}>
              <Animated.View
                style={[
                  styles.loadingProgressFill,
                  {
                    width: spinValue.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["10%", "90%"], // Visual progress simulation
                    }),
                  },
                ]}
              />
            </View>
            <Text style={styles.loadingText}>BREWING MAGIC...</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // Error State
  if (loadingState === "error") {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="dark-content" />
        <View style={styles.errorContent}>
          <View style={styles.errorIconContainer}>
            <Ionicons name="alert-circle" size={70} color="#D9534F" />
          </View>
          <Text style={styles.errorTitle}>Experiment Failed</Text>
          <Text style={styles.errorText}>{errorMessage || "Could not create the recipe. The lab might be unstable!"}</Text>

          <TouchableOpacity onPress={handleBack} style={styles.backButton} activeOpacity={0.8}>
            <Ionicons name="chevron-back" size={22} color={coffeeBrown} style={{ marginRight: 10 }} />
            <Text style={styles.backButtonText}>Back to Lab Setup</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // Success State - Recipe Display
  if (loadingState === "done" && recipe) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen
          options={{
            headerShown: true,
            title: recipe.title, // Dynamic title
            headerStyle: { backgroundColor: "#FFFFFF" },
            headerTintColor: "#333333",
            headerTitleStyle: { fontWeight: "bold", fontSize: 18 },
            headerShadowVisible: false,
            headerLeft: () => (
              <TouchableOpacity onPress={handleBack} style={styles.headerBackButton} disabled={isPosting}>
                <Ionicons name="arrow-back" size={24} color={isPosting ? "#BDBDBD" : coffeeBrown} />
              </TouchableOpacity>
            ),
            headerTitleAlign: "center",
            headerBackTitleVisible: false,
          }}
        />
        <StatusBar barStyle="dark-content" />

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          {/* Use Animated.ScrollView here */}
          <Animated.ScrollView
            style={[styles.scrollView, { opacity: fadeAnim }]}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero Image (Original input image) */}
            {inputImagePath ? (
              <Animated.View style={[styles.heroImageContainer, { transform: [{ scale: scaleAnim }] }]}>
                <Image source={{ uri: inputImagePath }} style={styles.heroImage} resizeMode="cover" />
                <View style={styles.imageOverlayDark}>
                  <View style={styles.recipeMetaContainer}></View>
                </View>
              </Animated.View>
            ) : (
              <View style={styles.noImagePlaceholder}>
                <Ionicons name="beaker" size={60} color={coffeeLight} />
                <Text style={styles.noImageText}>Your Unique Creation</Text>
              </View>
            )}

            {/* Description & Uniqueness */}
            <View style={styles.descriptionContainer}>
              <Text style={styles.recipeTitleHype}>{recipe.title}</Text>
              {recipe.uniqueness_factor && (
                <View style={styles.uniquenessContainer}>
                  <Ionicons name="sparkles" size={20} color={coffeeBrown} style={{ marginRight: 10 }} />
                  <View style={styles.uniquenessTextContainer}>
                    <Text style={styles.uniquenessLabel}>The Twist:</Text>
                    <Text style={styles.uniquenessText}>{recipe.uniqueness_factor}</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Details Section (Time & Strength) */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeader}>
                <Ionicons name="stats-chart" size={22} color={coffeeBrown} />
                <Text style={styles.sectionTitle}>Recipe Stats</Text>
              </View>
              <View style={styles.detailsCard}>
                <View style={styles.detailItemWide}>
                  <Ionicons name="stopwatch" size={24} color={coffeeBrown} />
                  <View style={styles.detailTextContainer}>
                    <Text style={styles.detailLabel}>Prep & Brew Time</Text>
                    <Text style={styles.detailValue}>{recipe.brewingTime}</Text>
                  </View>
                </View>
                <View style={[styles.detailItemWide, { borderBottomWidth: 0 }]}>
                  <Ionicons name="flame" size={24} color={coffeeBrown} />
                  <View style={styles.detailTextContainer}>
                    <Text style={styles.detailLabel}>Perceived Strength</Text>
                    <View style={styles.strengthRowDark}>
                      {[1, 2, 3, 4, 5].map((level) => (
                        <View
                          key={level}
                          style={[
                            styles.strengthIndicatorDark,
                            level <= recipe.strengthLevel ? styles.strengthIndicatorActiveDark : null,
                          ]}
                        />
                      ))}
                      <Text style={styles.detailValueStrength}> ({recipe.strengthLevel}/5)</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {/* Ingredients Section */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeader}>
                <Ionicons name="flask" size={22} color={coffeeBrown} />
                <Text style={styles.sectionTitle}>Lab Ingredients</Text>
              </View>
              <View style={styles.ingredientsContainer}>
                {recipe.ingredients.map((ingredient, index) => (
                  <View key={index} style={styles.ingredientItem}>
                    <View style={styles.ingredientBullet}>
                      <Ionicons name="checkmark-circle" size={20} color={coffeeBrown} />
                    </View>
                    <Text style={styles.ingredientText}>{ingredient}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Instructions Section */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeader}>
                <Ionicons name="construct" size={22} color={coffeeBrown} />
                <Text style={styles.sectionTitle}>Experiment Procedure</Text>
              </View>
              <View style={styles.instructionsContainer}>
                {recipe.instructions.map((instruction, index) => {
                  const match = instruction.match(/^(\d+)\.?\s*(.*)$/)
                  const stepNumber = match ? match[1] : (index + 1).toString()
                  const stepText = match ? match[2].trim() : instruction.trim()
                  return (
                    <View key={index} style={styles.instructionItem}>
                      <View style={styles.instructionNumberContainer}>
                        <Text style={styles.instructionNumber}>{stepNumber}</Text>
                      </View>
                      <View style={styles.instructionTextContainer}>
                        <Text style={styles.instructionText}>{stepText}</Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>

            {/* Based On Your Setup Section */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeader}>
                <Ionicons name="options" size={22} color={coffeeBrown} />
                <Text style={styles.sectionTitle}>Your Lab Configuration</Text>
              </View>
              <View style={styles.settingsGrid}>
                {Object.entries(params)
                  .filter(
                    ([key, value]) =>
                      !["imagePath", "identifiedIngredients"].includes(key) &&
                      value &&
                      value.toLowerCase() !== "none" &&
                      value.toLowerCase() !== "false" && // Keep filtering falsey strings
                      value.toLowerCase() !== "",
                  )
                  .map(([key, value]) => {
                    const settingMap: { [k: string]: { label: string; icon: keyof typeof Ionicons.glyphMap } } = {
                      temperature: { label: "Temp", icon: "thermometer" },
                      strength: { label: "Profile", icon: "speedometer" },
                      sweetness: { label: "Sweetness", icon: "ice-cream" },
                      milk: { label: "Milk", icon: "water" },
                      flavor: { label: "Flavor", icon: "color-palette" },
                      enhancements: { label: "Enhancement", icon: "sparkles" },
                      infusions: { label: "Infusion", icon: "flask" },
                      toppings: { label: "Topping", icon: "cloud" },
                      texture: { label: "Texture", icon: "layers" },
                      cupSize: { label: "Size", icon: "resize" },
                      machine: { label: "Method", icon: "hardware-chip" },
                      extraShot: { label: "Intensity", icon: "add-circle" },
                      saltPinch: { label: "Salt", icon: "restaurant" }, // Assuming 'salt' icon exists or use a similar one like 'nutrition'
                    }
                    const displayKey = key as keyof typeof settingMap
                    const displayValue =
                      key === "extraShot" || key === "saltPinch" ? (value === "true" ? "Yes" : "No") : String(value)

                    if (!displayValue || !settingMap[displayKey]) return null
                    const { label, icon } = settingMap[displayKey]

                    return (
                      <View style={styles.settingItem} key={key}>
                        <Ionicons name={icon} size={22} color={coffeeBrown} />
                        <View style={styles.settingTextContainer}>
                          <Text style={styles.settingLabel}>{label}</Text>
                          <Text style={styles.settingValue}>
                            {displayValue.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                          </Text>
                        </View>
                      </View>
                    )
                  })}

                {identifiedIngredients.length > 0 && (
                  <View style={styles.identifiedIngredientsContainerWide}>
                    <Ionicons name="list" size={22} color={coffeeBrown} />
                    <View style={styles.settingTextContainer}>
                      <Text style={styles.settingLabel}>Key Identified Ingredients</Text>
                      <Text style={styles.settingValue}>{identifiedIngredients.join(", ")}</Text>
                    </View>
                  </View>
                )}

                {Object.entries(params).filter(
                  ([key, value]) =>
                    !["imagePath", "identifiedIngredients"].includes(key) &&
                    value &&
                    value.toLowerCase() !== "none" &&
                    value.toLowerCase() !== "false",
                ).length === 0 &&
                  identifiedIngredients.length === 0 && (
                    <Text style={styles.noSettingsText}>Recipe based on standard Coffee Lab preferences.</Text>
                  )}
              </View>
            </View>
          </Animated.ScrollView>

          {/* Footer Button Area for Posting */}
          <Animated.View
            style={[
              styles.footer,
              {
                opacity: fadeAnim,
                transform: [
                  {
                    translateY: fadeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [50, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <TouchableOpacity
              style={[styles.footerButton, isPosting && styles.footerButtonDisabled]}
              onPress={startPostingProcess}
              disabled={isPosting}
              activeOpacity={0.8}
            >
              {isPosting ? (
                <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 10 }} />
              ) : (
                <Ionicons name="camera" size={24} color="#FFFFFF" style={{ marginRight: 10 }} />
              )}
              <Text style={styles.footerButtonText}>
                {isPosting ? postingMessage.split("...")[0] + "..." : "Save & Post Drink Photo!"}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>

        {/* Posting Overlay Modal */}
        <Modal
          transparent={true}
          animationType="fade"
          visible={isPosting}
          onRequestClose={() => {}} // Prevent accidental close
        >
          <View style={styles.postingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.postingOverlayText}>{postingMessage}</Text>
          </View>
        </Modal>
      </SafeAreaView>
    )
  }

  // Fallback / Initial loading state before generation starts
  return (
    <SafeAreaView style={styles.loadingContainer}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" />
      <ActivityIndicator size="large" color={coffeeBrown} />
      <Text style={styles.loadingText}>Preparing Lab Results...</Text>
    </SafeAreaView>
  )
}

// --- Styles --- (Keep original styles unchanged)
const primaryBlack = "#1A1A1A"
const primaryWhite = "#FFFFFF"
const coffeeBrown = "#6F4E37"
const coffeeLight = "#C8A27D"
const lightGray = "#F5F5F5"
const midGray = "#E0E0E0"
const grayText = "#666666"
const softBackground = "#F8F5F2"
const errorRed = "#D9534F"

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: primaryWhite,
  },
  scrollView: {
    flex: 1,
    backgroundColor: primaryWhite,
  },
  scrollContent: {
    paddingBottom: 120, // Ensure enough space for footer button
  },
  headerBackButton: {
    padding: 10,
    marginLeft: Platform.OS === 'ios' ? 10 : 0, // iOS needs slight margin
    // Removed background color for cleaner look
  },

  // Loading / Error States
  loadingContainer: {
    flex: 1,
    backgroundColor: primaryWhite,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContent: {
    alignItems: "center",
    padding: 30,
  },
  loadingTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: coffeeBrown,
    marginTop: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  loadingProgressContainer: {
    width: "80%",
    alignItems: "center",
  },
  loadingProgressBar: {
    width: "100%",
    height: 8,
    backgroundColor: lightGray,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 15,
  },
  loadingProgressFill: {
    height: "100%",
    backgroundColor: coffeeBrown,
    borderRadius: 4,
  },
  loadingText: {
    fontSize: 16,
    color: grayText,
    textAlign: "center",
    fontWeight: "600",
    letterSpacing: 1,
    marginTop: 10, // Added margin top for initial loading text
  },
  errorContainer: {
    flex: 1,
    backgroundColor: primaryWhite,
    justifyContent: "center",
    alignItems: "center",
  },
  errorContent: {
    alignItems: "center",
    padding: 30,
  },
  errorIconContainer: {
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: errorRed,
    marginBottom: 15,
    textAlign: "center",
  },
  errorText: {
    fontSize: 16,
    color: grayText,
    textAlign: "center",
    marginBottom: 30,
    maxWidth: 320,
    lineHeight: 24,
  },
  retryButton: {
    flexDirection: "row",
    backgroundColor: coffeeBrown,
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 30,
    marginBottom: 15,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  retryButtonText: {
    color: primaryWhite,
    fontSize: 17,
    fontWeight: "600",
  },
  backButton: {
    flexDirection: "row",
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: midGray,
    alignItems: "center",
  },
  backButtonText: {
    color: coffeeBrown,
    fontSize: 17,
    fontWeight: "600",
  },

  // Hero Image Styles
  heroImageContainer: {
    width: "100%",
    height: SCREEN_WIDTH * 0.7, // Adjust ratio as needed
    backgroundColor: lightGray,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 0, // Remove potential bottom margin if added before
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  imageOverlayDark: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "flex-end",
    padding: 15,
  },
  recipeMetaContainer: {
    // Can hold metadata if needed later
  },
  noImagePlaceholder: {
    width: "100%",
    height: 180,
    backgroundColor: softBackground,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: midGray,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    marginBottom: 0,
  },
  noImageText: {
    marginTop: 10,
    color: coffeeLight,
    fontSize: 18,
    fontWeight: "bold",
  },

  // Description & Uniqueness Section Styles
  descriptionContainer: {
    paddingHorizontal: 25,
    paddingVertical: 25,
    backgroundColor: primaryWhite, // Ensure background matches
    // borderTopWidth: 1, // Optional separator if needed
    // borderTopColor: lightGray,
  },
  recipeTitleHype: {
    fontSize: 26,
    fontWeight: "bold",
    color: primaryBlack,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 34,
  },
  descriptionText: { // Not currently used, but kept for potential future use
    fontSize: 17,
    lineHeight: 26,
    color: "#444",
    textAlign: "center",
    marginBottom: 25,
  },
  uniquenessContainer: {
    flexDirection: "row",
    alignItems: "flex-start", // Align items to the top for potentially long text
    backgroundColor: softBackground,
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: coffeeLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, // Slightly softer shadow
    shadowRadius: 3,
    elevation: 2,
  },
  uniquenessTextContainer: {
    flex: 1, // Allow text to wrap
  },
  uniquenessLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: coffeeBrown,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  uniquenessText: {
    fontSize: 16,
    color: "#333",
    lineHeight: 24,
  },

  // General Section Styling
  sectionContainer: {
    paddingHorizontal: 20,
    paddingTop: 25,
    paddingBottom: 15,
    borderTopWidth: 1,
    borderTopColor: lightGray, // Use light gray for separators
    backgroundColor: primaryWhite, // Ensure consistent background
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: primaryBlack,
    marginLeft: 10,
  },

  // Details Card (Time/Strength)
  detailsCard: {
    backgroundColor: softBackground,
    borderRadius: 16,
    paddingVertical: 5, // Reduced vertical padding inside card
    paddingHorizontal: 15,
    marginTop: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  detailItemWide: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)", // Faint separator
  },
  detailTextContainer: {
    marginLeft: 15,
    flex: 1,
  },
  detailLabel: {
    fontSize: 13,
    color: grayText,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: "600",
  },
  detailValue: {
    fontSize: 17,
    fontWeight: "600",
    color: "#333",
  },
  detailValueStrength: {
    fontSize: 16, // Slightly smaller to fit better
    fontWeight: "600",
    color: "#333",
    marginLeft: 6,
  },
  strengthRowDark: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  strengthIndicatorDark: {
    width: SCREEN_WIDTH * 0.06, // Relative width
    height: 10,
    backgroundColor: midGray, // Inactive color
    marginRight: 5,
    borderRadius: 5,
  },
  strengthIndicatorActiveDark: {
    backgroundColor: coffeeBrown, // Active color
  },

  // Ingredients Section Styles
  ingredientsContainer: {
    backgroundColor: softBackground, // Consistent card background
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  ingredientItem: {
    flexDirection: "row",
    alignItems: "center", // Center items vertically
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
    // Remove last border bottom via pseudo-selector if needed (complex in RN)
  },
  ingredientBullet: {
    width: 28, // Fixed width for alignment
    alignItems: "center", // Center icon in bullet area
    marginRight: 10, // Increased spacing
  },
  ingredientText: {
    flex: 1,
    fontSize: 16,
    color: "#333",
    lineHeight: 24,
  },

  // Instructions Section Styles
  instructionsContainer: {
    // Removed background and shadow - steps look cleaner directly on page
    borderRadius: 16,
    marginTop: 5, // Add some space from header
  },
  instructionItem: {
    flexDirection: "row",
    alignItems: "flex-start", // Align number to top of text
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: lightGray, // Lighter separator for steps
    // Remove last border bottom via pseudo-selector if needed
  },
  instructionNumberContainer: {
    width: 32,
    height: 32,
    borderRadius: 16, // Circular background
    backgroundColor: coffeeBrown,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
    marginTop: 2, // Align slightly better with text line
  },
  instructionNumber: {
    color: primaryWhite,
    fontSize: 16,
    fontWeight: "bold",
  },
  instructionTextContainer: {
    flex: 1, // Allow text to take remaining space
  },
  instructionText: {
    fontSize: 16,
    color: "#333",
    lineHeight: 25, // Good readability
  },

  // Your Setup/Config Section Styles
  settingsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between", // Distribute items evenly
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    width: "48%", // Two columns layout
    backgroundColor: softBackground,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, // Very subtle shadow
    shadowRadius: 2,
    elevation: 1,
  },
  identifiedIngredientsContainerWide: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%", // Full width for ingredients list
    backgroundColor: softBackground,
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  settingTextContainer: {
    marginLeft: 12,
    flex: 1, // Allow text to wrap if needed
  },
  settingLabel: {
    fontSize: 12,
    color: grayText,
    marginBottom: 3,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  settingValue: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  noSettingsText: {
    fontSize: 14,
    color: grayText,
    fontStyle: "italic",
    textAlign: "center",
    width: "100%",
    padding: 10,
  },

  // Footer (Post Button Area)
  footer: {
    position: "absolute", // Keep it sticky at the bottom
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: primaryWhite, // Match page background
    borderTopWidth: 1,
    borderTopColor: midGray, // Separator line
    padding: 16,
    paddingBottom: Platform.OS === "ios" ? 34 : 24, // Account for safe area / notch
    elevation: 8, // Android shadow
    shadowColor: "#000", // iOS shadow
    shadowOffset: { width: 0, height: -2 }, // Shadow points upwards
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  footerButton: {
    backgroundColor: coffeeBrown,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 30, // Pill shape
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5, // Button shadow
  },
  footerButtonDisabled: {
    backgroundColor: "#A0A0A0", // Gray out when disabled
  },
  footerButtonText: {
    color: primaryWhite,
    fontSize: 18,
    fontWeight: "bold",
  },

  // Posting Overlay Styles
  postingOverlay: {
    ...StyleSheet.absoluteFillObject, // Cover the whole screen
    backgroundColor: "rgba(0, 0, 0, 0.75)", // Darker overlay
    alignItems: "center",
    justifyContent: "center",
  },
  postingOverlayText: {
    marginTop: 20,
    color: primaryWhite,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 30,
  },
})

export default GenerateRecipe