import debounce from "lodash/debounce"
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  SafeAreaView,
  Alert,
  Animated,
  Easing,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from 'expo-linear-gradient'; // <-- Import LinearGradient

import { useLocalSearchParams, router, Stack } from "expo-router"
import * as Haptics from "expo-haptics"
import { supabase } from "../../supabase" // Import Supabase client
import { Toast } from "../../components/ui/toast"

// --- Interfaces & Types (Keep as they define the structure for Gemini request/response) ---
interface GeminiPart {
  text?: string
}
interface GeminiContent {
  parts: GeminiPart[]
  role?: string
}
interface GeminiRequest {
  contents: GeminiContent[]
  generationConfig?: { responseMimeType?: string }
}
interface GeminiResponse {
  candidates?: { content: GeminiContent; finishReason?: string }[]
  // Add promptFeedback for potential blocking info
  promptFeedback?: { blockReason?: string; safetyRatings?: unknown[] }
  error?: { code: number; message: string; status: string }
}

interface CompatibleOptions {
  temperature: string[]
  strength: string[]
  sweetness: string[]
  milk: string[]
  flavor: string[]
  enhancements: string[]
  infusions: string[]
  toppings: string[]
  texture: string[]
  cupSize: string[]
  machine: string[]
}

const DEFAULT_OPTIONS: CompatibleOptions = {
  temperature: ["hot", "iced", "cold-brew"],
  strength: ["light", "medium", "dark"],
  sweetness: ["none", "slight", "sweet"],
  milk: ["none", "regular", "oat", "almond", "soy"],
  flavor: ["none", "vanilla", "caramel", "cinnamon", "chocolate", "hazelnut", "cardamom", "lemon"], // Moved from Sec 3
  enhancements: [
    "none",
    "cinnamon-stick",
    "cardamom-pod",
    "orange-zest",
    "chili-flakes",
    "cocoa-powder",
    "mint-leaf",
    "sparkling-water",
    "salt",
  ],
  infusions: ["none", "olive-oil", "honey", "butter", "coconut-oil"],
  toppings: ["none", "whipped-cream", "ice-cream", "cocoa-powder", "cinnamon-dust"],
  texture: ["regular", "watery", "smooth", "thick"],
  cupSize: ["small", "medium", "large"],
  machine: ["manual", "drip", "pod", "espresso", "french-press", "aeropress"],
}

type OptionKey = keyof CompatibleOptions
type SelectionValue = string | boolean
type LabSelections = { [K in OptionKey]?: string } & { extraShot: boolean; saltPinch: boolean }
type OptionsLoadingState = "idle" | "loading" | "done" | "error"

// --- MODIFIED Helper for API Calls (Uses Edge Function Proxy) ---
const callGeminiGenerateViaEdgeProxy = async (requestBody: GeminiRequest): Promise<GeminiResponse> => {
  // No client-side API key check needed
  console.log(
    "(NOBRIDGE) LOG CoffeeLab: Sending request via Edge Function 'gemini-recipe-proxy':",
    JSON.stringify(requestBody).substring(0, 200) + "...",
  )
  try {
    // Use supabase.functions.invoke
    const { data, error: invokeError } = await supabase.functions.invoke(
      "gemini-recipe-proxy", // Your proxy function name
      { body: requestBody }, // Pass the Gemini request structure
    )

    if (invokeError) {
      console.error("(NOBRIDGE) ERROR CoffeeLab: Supabase Function invocation error:", invokeError)
      let reason = "Failed to get suggestions from the service."
      if (invokeError.message) {
        try {
          const errorJson = JSON.parse(invokeError.message)
          reason = errorJson.error || errorJson.message || reason
        } catch {
          reason = invokeError.message
        }
      }
      if (invokeError.message.includes("authorization") || invokeError.message.includes("JWT")) {
        reason = "Authentication failed. Please log in again."
      }
      throw new Error(reason)
    }

    // 'data' is the raw response from Gemini, forwarded by the proxy
    const geminiData: GeminiResponse = data
    console.log("(NOBRIDGE) LOG CoffeeLab: Received response via Edge Function:", JSON.stringify(geminiData))

    // --- Handle errors *returned by Gemini* (forwarded by proxy) ---
    if (geminiData.error) {
      const errorMsg = `API Error (${geminiData.error.status || geminiData.error.code}): ${geminiData.error.message}`
      console.error("(NOBRIDGE) ERROR CoffeeLab: Gemini API Error (via Proxy):", errorMsg, geminiData)
      if (geminiData.error.status === "RESOURCE_EXHAUSTED" || geminiData.error.message.includes("quota")) {
        Alert.alert(
          "Suggestions Busy",
          "The suggestion service is currently busy. Using default options for now. Please try again later.",
        )
      }
      throw new Error(errorMsg)
    }

    // --- Handle potential blocking or invalid response structure *from Gemini* ---
    if (!geminiData.candidates || geminiData.candidates.length === 0) {
      // Check for promptFeedback which indicates blocking
      if (geminiData.promptFeedback?.blockReason) {
        console.warn(
          "(NOBRIDGE) WARN CoffeeLab: Gemini request blocked (via Proxy):",
          geminiData.promptFeedback.blockReason,
        )
        throw new Error(`Suggestions blocked due to safety policy: ${geminiData.promptFeedback.blockReason}`)
      }
      console.error(
        "(NOBRIDGE) ERROR CoffeeLab: Gemini API Invalid Response Structure (via Proxy): No candidates.",
        geminiData,
      )
      throw new Error("Invalid response structure from suggestions service (no candidates).")
    }

    const candidate = geminiData.candidates[0]
    if (!candidate.content?.parts) {
      const reason = candidate.finishReason
      const errorMsg = `Invalid response structure from Gemini API (missing content parts). ${reason ? `Reason: ${reason}` : ""}`
      console.error("(NOBRIDGE) ERROR CoffeeLab: Gemini API Invalid Response (via Proxy):", errorMsg, geminiData)
      throw new Error(errorMsg)
    }

    // If checks pass, return the Gemini data
    return geminiData
  } catch (error: any) {
    console.error("(NOBRIDGE) ERROR CoffeeLab: Error calling/processing Edge Function 'gemini-recipe-proxy':", error)
    throw new Error(error.message || "Failed to get suggestions.")
  }
}

// --- Component ---
const CoffeeLab: React.FC = () => {
  const params = useLocalSearchParams<{ imagePath?: string; identifiedIngredients?: string }>()
  const imagePath = params.imagePath
  const identifiedIngredientsJson = params.identifiedIngredients

  // Animation values (Unchanged)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0.95)).current
  const spinValue = useRef(new Animated.Value(0)).current

  // Toast state
  const [toastVisible, setToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState("")

  // Memoized Ingredients (Unchanged)
  const identifiedIngredients: string[] = useMemo(() => {
    console.log("(NOBRIDGE) LOG CoffeeLab Memo: Parsing ingredients...")
    if (!identifiedIngredientsJson) return []
    try {
      const parsed = JSON.parse(identifiedIngredientsJson)
      return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : []
    } catch (e) {
      console.error("(NOBRIDGE) ERROR CoffeeLab Memo: Failed to parse ingredients JSON:", e)
      Alert.alert("Data Error", "Could not read identified ingredients data.")
      return []
    }
  }, [identifiedIngredientsJson])

  // State Variables (Modified to include compatible and all options)
  const [optionsLoadingState, setOptionsLoadingState] = useState<OptionsLoadingState>("idle")
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [availableOptions, setAvailableOptions] = useState<CompatibleOptions>(DEFAULT_OPTIONS)
  const [allOptions, setAllOptions] = useState<CompatibleOptions>(DEFAULT_OPTIONS) // All possible options
  const [selections, setSelections] = useState<LabSelections>(() => {
    const initial: Partial<LabSelections> = {}
    ;(Object.keys(DEFAULT_OPTIONS) as OptionKey[]).forEach((key) => {
      initial[key] = DEFAULT_OPTIONS[key]?.[0] ?? "none"
    })
    if (initial.strength && DEFAULT_OPTIONS.strength.includes("medium")) initial.strength = "medium"
    if (initial.cupSize && DEFAULT_OPTIONS.cupSize.includes("medium")) initial.cupSize = "medium"
    if (initial.machine && DEFAULT_OPTIONS.machine.includes("manual")) initial.machine = "manual"
    if (initial.sweetness && DEFAULT_OPTIONS.sweetness.includes("slight")) initial.sweetness = "slight"
    if (initial.texture && DEFAULT_OPTIONS.texture.includes("regular")) initial.texture = "regular"
    initial.flavor = "none" // Ensure flavor starts at none
    initial.enhancements = "none"
    initial.infusions = "none"
    initial.toppings = "none"
    return { ...initial, extraShot: false, saltPinch: false } as LabSelections
  })
  // Add state for Flavor Mode visibility
  const [isFlavorModeVisible, setIsFlavorModeVisible] = useState(false)

  // Refs for scroll view positions
  const scrollOffsetsRef = useRef<Record<OptionKey, number>>({} as Record<OptionKey, number>)
  const scrollViewRefs = useRef<Record<OptionKey, ScrollView | null>>({} as Record<OptionKey, ScrollView | null>)

  // Add these state variables for sparkle effect
  const [showSparkle, setShowSparkle] = useState(false)
  const sparkleAnim = useRef(new Animated.Value(0)).current
  const flavorButtonScale = useRef(new Animated.Value(1)).current

  // Animation Effects (Unchanged)
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
    ]).start()
    Animated.loop(
      Animated.timing(spinValue, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true }),
    ).start()
  }, [fadeAnim, scaleAnim, spinValue])
  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] })

  // Reset Selections when Options Change (Unchanged)
  const resetSelections = useCallback((options: CompatibleOptions, keepExistingPrefs: boolean) => {
    console.log("(NOBRIDGE) LOG CoffeeLab: Resetting selections. Keep Existing:", keepExistingPrefs)
    setSelections((prev) => {
      const newSelections: Partial<LabSelections> = {}
      ;(Object.keys(options) as OptionKey[]).forEach((optKey) => {
        const currentSelection = prev[optKey]
        if (keepExistingPrefs && typeof currentSelection === "string" && options[optKey]?.includes(currentSelection)) {
          newSelections[optKey] = currentSelection
        } else {
          newSelections[optKey] = options[optKey]?.[0] ?? DEFAULT_OPTIONS[optKey]?.[0] ?? "none"
        }
      })
      if (newSelections.strength === options.strength?.[0] && options.strength?.includes("medium"))
        newSelections.strength = "medium"
      if (newSelections.cupSize === options.cupSize?.[0] && options.cupSize?.includes("medium"))
        newSelections.cupSize = "medium"
      if (newSelections.machine === options.machine?.[0] && options.machine?.includes("manual"))
        newSelections.machine = "manual"
      if (newSelections.texture === options.texture?.[0] && options.texture?.includes("regular"))
        newSelections.texture = "regular"
      if (!keepExistingPrefs || newSelections.flavor === undefined)
        newSelections.flavor = options.flavor?.includes("none") ? "none" : options.flavor?.[0]
      if (!keepExistingPrefs || newSelections.enhancements === undefined)
        newSelections.enhancements = options.enhancements?.includes("none") ? "none" : options.enhancements?.[0]
      if (!keepExistingPrefs || newSelections.infusions === undefined)
        newSelections.infusions = options.infusions?.includes("none") ? "none" : options.infusions?.[0] // Corrected key
      if (!keepExistingPrefs || newSelections.toppings === undefined)
        newSelections.toppings = options.toppings?.includes("none") ? "none" : options.toppings?.[0] // Corrected key
      return {
        ...newSelections,
        extraShot: keepExistingPrefs ? prev.extraShot : false,
        saltPinch: keepExistingPrefs ? prev.saltPinch : false,
      } as LabSelections
    })
  }, [])

  // Show toast notification
  const showToast = useCallback((message: string) => {
    setToastMessage(message)
    setToastVisible(true)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  }, [])

  // --- Debounced API Fetch Function using useRef (Modified to keep all options) ---
  const debouncedFetchOptionsRef = useRef(
    debounce(async (ingredients: string[]) => {
      console.log("(NOBRIDGE) LOG CoffeeLab Debounced fetch executing with ingredients:", ingredients)

      if (!ingredients || ingredients.length === 0) {
        console.log("(NOBRIDGE) LOG CoffeeLab Debounced: No ingredients. Using default options.")
        setAvailableOptions((currentOpts) => {
          if (JSON.stringify(currentOpts) !== JSON.stringify(DEFAULT_OPTIONS)) {
            resetSelections(DEFAULT_OPTIONS, false)
            return DEFAULT_OPTIONS
          }
          return currentOpts
        })
        setAllOptions(DEFAULT_OPTIONS)
        setOptionsLoadingState("done")
        setOptionsError(null)
        return
      }

      setOptionsLoadingState("loading")
      setOptionsError(null)

      const prompt = `
You are assisting a user in a 'Coffee Lab' app who has identified these items:
${ingredients.map((i) => `- ${i}`).join("\n")}
Suggest compatible and CREATIVE coffee customization options based *primarily* on these items.
Prioritize options directly related to the identified items (e.g., if 'Espresso Machine' is listed, 'espresso' MUST be an option; if 'Oat Milk' listed, include 'oat', if you see a pod/keriug cup, the pod option must be there). Note that manual should always be an option for prep method.
For the 'flavor' category, include options like vanilla, caramel, cinnamon, chocolate, hazelnut, cardamom, lemon if relevant or common pairings.
For the 'enhancements' category, suggest specific, potentially fun items implied by the ingredients (e.g., 'Orange Zest' if 'Orange' is listed, 'Cinnamon Stick' if 'Cinnamon' listed) OR common creative pairings if nothing specific is obvious.
For the 'infusions' category, include options like olive oil, honey, butter, coconut oil if relevant.
For the 'toppings' category, include options like whipped cream, ice cream, cocoa powder, cinnamon dust if relevant.
For the 'texture' category, include options like regular, watery, smooth, thick.
Fill other categories with sensible options compatible with the identified items and general coffee making. Always include 'none' where applicable (milk, flavor, enhancements, infusions, toppings, sweetness). Ensure all arrays have at least one common default option if no specific items guide the category. Never suggest alcohol or anything dangerous.
Output ONLY a valid JSON object matching this exact structure (do not add comments or markdown):
{
"temperature": ["hot", "iced", ...], "strength": ["light", "medium", "dark"], "sweetness": ["none", "slight", "sweet", ...], "milk": ["none", "regular", "oat", ...], "flavor": ["none", "vanilla", ...], "enhancements": ["none", "cinnamon-stick", "orange-zest", ...], "infusions": ["none", "olive-oil", "honey", ...], "toppings": ["none", "whipped-cream", "ice-cream", ...], "texture": ["regular", "watery", "smooth", "thick"], "cupSize": ["small", "medium", "large"], "machine": ["manual", "drip", "espresso", ...]
}
Ensure arrays are not empty. Be practical but inspiring for a home coffee lab experience.
`
      const request: GeminiRequest = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }

      try {
        // *** USE THE EDGE FUNCTION PROXY ***
        const response = await callGeminiGenerateViaEdgeProxy(request)
        // The rest of the processing expects the standard GeminiResponse structure
        const jsonText = response.candidates?.[0]?.content?.parts?.[0]?.text

        if (!jsonText) throw new Error("Suggestions service did not return options content.")

        console.log("(NOBRIDGE) LOG CoffeeLab Debounced: Attempting to parse options JSON:", jsonText)
        const cleanedJsonText = jsonText.replace(/^```json\s*|```$/g, "").trim()
        const parsedOptions: Partial<CompatibleOptions> = JSON.parse(cleanedJsonText)

        // Merge/Validate with Defaults (Modified to keep all options)
        const finalOptions: CompatibleOptions = { ...DEFAULT_OPTIONS }
        let optionsChanged = false

        // Store all options (both compatible and incompatible)
        const allPossibleOptions: CompatibleOptions = { ...DEFAULT_OPTIONS }
        ;(Object.keys(DEFAULT_OPTIONS) as (keyof CompatibleOptions)[]).forEach((key) => {
          const geminiOpts = parsedOptions[key]
          let categoryChanged = false

          if (
            Array.isArray(geminiOpts) &&
            geminiOpts.length > 0 &&
            geminiOpts.every((item) => typeof item === "string")
          ) {
            let newOpts = [...new Set(geminiOpts as string[])]

            // Make sure "none" is included where applicable
            if (
              ["milk", "flavor", "enhancements", "infusions", "toppings", "sweetness"].includes(key) &&
              DEFAULT_OPTIONS[key]?.includes("none") &&
              !newOpts.includes("none")
            ) {
              newOpts.unshift("none")
              newOpts = [...new Set(newOpts)]
            }

            // Store all options for this category in allPossibleOptions
            allPossibleOptions[key] = [...new Set([...DEFAULT_OPTIONS[key], ...newOpts])]

            if (JSON.stringify(newOpts) !== JSON.stringify(availableOptions[key] || DEFAULT_OPTIONS[key])) {
              finalOptions[key] = newOpts
              categoryChanged = true
            } else {
              finalOptions[key] = availableOptions[key] || DEFAULT_OPTIONS[key]
            }
          } else {
            console.warn(
              `(NOBRIDGE) WARN CoffeeLab Debounced: Gemini returned invalid options for ${key}. Using default/current.`,
            )
            finalOptions[key] = availableOptions[key] || [...DEFAULT_OPTIONS[key]]
            if (JSON.stringify(finalOptions[key]) !== JSON.stringify(availableOptions[key] || DEFAULT_OPTIONS[key])) {
              categoryChanged = true
            }
          }

          if (categoryChanged) optionsChanged = true
        })

        if (optionsChanged) {
          console.log("(NOBRIDGE) LOG CoffeeLab Debounced: Options changed, updating state:", finalOptions)
          setAvailableOptions(finalOptions)
          setAllOptions(allPossibleOptions)
          resetSelections(finalOptions, true)
        } else {
          console.log("(NOBRIDGE) LOG CoffeeLab Debounced: No significant option changes from Gemini.")
        }

        setOptionsLoadingState("done")
      } catch (error: any) {
        console.error("(NOBRIDGE) ERROR CoffeeLab Debounced: Failed to fetch/parse options:", error)
        setOptionsError(`Suggestions failed: ${error.message}. Using defaults.`)
        setOptionsLoadingState("error")
        setAvailableOptions((currentOpts) => {
          if (JSON.stringify(currentOpts) !== JSON.stringify(DEFAULT_OPTIONS)) {
            resetSelections(DEFAULT_OPTIONS, false)
            return DEFAULT_OPTIONS
          }
          return currentOpts
        })
        setAllOptions(DEFAULT_OPTIONS)
      }
    }, 750),
  )

  // --- useEffect to Trigger Debounced Fetch (Unchanged) ---
  // Add a new state to track which ingredients were identified
  const [identifiedOptionValues, setIdentifiedOptionValues] = useState<Set<string>>(new Set())

  // Modify the useEffect that processes identified ingredients to populate this set
  useEffect(() => {
    console.log("(NOBRIDGE) LOG CoffeeLab useEffect triggered.")
    if (optionsLoadingState === "idle") {
      setAvailableOptions(DEFAULT_OPTIONS)
      setAllOptions(DEFAULT_OPTIONS)

      // Create a set of identified option values from the ingredients
      const identifiedValues = new Set<string>()

      // Always consider these options as "identified" since they're basic options
      const alwaysIdentified = ["none", "manual", "small", "medium", "large", "regular", "hot", "iced", "light", "medium", "dark"] // Added more common defaults
      alwaysIdentified.forEach((option) => identifiedValues.add(option))

      // Process the identified ingredients
      identifiedIngredients.forEach((ingredient) => {
        const lowerIngredient = ingredient.toLowerCase().trim() // Trim whitespace

        // Map ingredients to option values using a more structured approach
        // Ensure keys are consistent (e.g., "french press", not "french-press")
        const ingredientMappings: Record<string, string[]> = {
          espresso: ["espresso"],
          "drip": ["drip"],
          "pod": ["pod"],
          "french press": ["french-press"],
          "aeropress": ["rocket"],
          "cold brew": ["cold-brew"], // Added mapping
          oat: ["oat"],
          almond: ["almond"],
          soy: ["flower"],
          milk: ["regular"], // Added general milk mapping
          vanilla: ["vanilla"],
          caramel: ["color-fill"],
          cinnamon: ["egg", "cinnamon-stick", "cinnamon-dust"],
          chocolate: ["apps"],
          hazelnut: ["apps-outline"], // Keep as outline for distinction
          cardamom: ["flower-outline", "cardamom-pod"], // Keep as outline for distinction from pod
          lemon: ["sunny-outline"],
          orange: ["orange-zest"],
          mint: ["mint-leaf"],
          honey: ["honey"],
          butter: ["square"],
          "olive oil": ["olive-oil"], // Added mapping
          coconut: ["coconut-oil", "coconut"], // Include coconut itself
          cream: ["whipped-cream", "regular"], // Whipped cream or regular milk
          "ice cream": ["ice-cream"],
          sweet: ["sweet", "slight"],
          salt: ["salt", "saltPinch"], // Include salt pinch toggle
          water: ["watery", "sparkling-water"], // Include texture and enhancement
          // Add other potential mappings if needed
        }

        // Check if the ingredient *is* or *contains* any of our mappings keys
         Object.entries(ingredientMappings).forEach(([key, values]) => {
           // Check for exact match or if the ingredient string includes the key word
           // (e.g., "oat milk" should trigger "oat")
           if (lowerIngredient === key || lowerIngredient.includes(key)) {
             values.forEach((value) => identifiedValues.add(value));
           }
         });

          // Special check for temperature based on words like "hot" or "iced"
         if (/\bhot\b/i.test(lowerIngredient)) identifiedValues.add("hot");
         if (/\biced?\b/i.test(lowerIngredient)) identifiedValues.add("iced"); // Match "ice" or "iced"
      })

      console.log("(NOBRIDGE) LOG CoffeeLab: Identified option values:", Array.from(identifiedValues)); // Log the set
      setIdentifiedOptionValues(identifiedValues)

      if (identifiedIngredients.length > 0) {
        console.log("(NOBRIDGE) LOG CoffeeLab useEffect: Calling debounced fetch...")
        debouncedFetchOptionsRef.current(identifiedIngredients)
      } else {
        console.log("(NOBRIDGE) LOG CoffeeLab useEffect: No ingredients, skipping API call.")
        setOptionsLoadingState("done")
      }
    }
    return () => {
      console.log("(NOBRIDGE) LOG CoffeeLab useEffect cleanup: Cancelling pending debounced fetch.")
      debouncedFetchOptionsRef.current.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifiedIngredientsJson, optionsLoadingState, resetSelections]) // Keep dependencies minimal


  // --- Event Handlers (Modified for incompatible options and conditional toast) ---
  const handleBackPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (router.canGoBack()) router.back()
    else router.replace("/(tabs)/home")
  }, [])

  const handleGenerateRecipe = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    console.log("(NOBRIDGE) LOG CoffeeLab: Generating recipe with selections:", selections)
    const finalSelections = { ...selections }
    ;(Object.keys(DEFAULT_OPTIONS) as OptionKey[]).forEach((key) => {
      if (!finalSelections[key])
        finalSelections[key] = availableOptions[key]?.[0] ?? DEFAULT_OPTIONS[key]?.[0] ?? "none"
    })
    finalSelections.extraShot = finalSelections.extraShot ?? false
    finalSelections.saltPinch = finalSelections.saltPinch ?? false
    router.push({
      pathname: "/other-pages/generate-recipe",
      params: {
        imagePath: imagePath ?? "",
        identifiedIngredients: identifiedIngredientsJson ?? "[]",
        temperature: finalSelections.temperature,
        strength: finalSelections.strength,
        sweetness: finalSelections.sweetness,
        milk: finalSelections.milk,
        flavor: finalSelections.flavor,
        enhancements: finalSelections.enhancements,
        infusions: finalSelections.infusions,
        toppings: finalSelections.toppings,
        texture: finalSelections.texture,
        cupSize: finalSelections.cupSize,
        machine: finalSelections.machine,
        extraShot: String(finalSelections.extraShot),
        saltPinch: String(finalSelections.saltPinch),
      },
    })
  }, [selections, availableOptions, imagePath, identifiedIngredientsJson])

  // --- Option Selector Component (Modified for scroll persistence and incompatible options) ---
  const optionIcons: { [key: string]: keyof typeof Ionicons.glyphMap } = {
    hot: "flame",
    iced: "snow",
    "cold-brew": "flask",
    small: "remove-circle-outline",
    medium: "ellipse-outline",
    large: "add-circle-outline",
    manual: "hand-left",
    drip: "water",
    pod: "cafe",
    espresso: "flash",
    "french-press": "filter",
    aeropress: "rocket",
    light: "sunny",
    //medium: "contrast", // Use default ellipse if no specific icon
    dark: "moon",
    none: "remove-circle",
    slight: "add-circle-outline",
    sweet: "heart",
    regular: "pint",
    oat: "leaf",
    almond: "nutrition",
    soy: "flower",
    vanilla: "ice-cream",
    caramel: "color-fill",
    cinnamon: "egg", // Keep as egg for distinction from stick/dust
    chocolate: "apps",
    hazelnut: "apps-outline", // Keep as outline for distinction
    cardamom: "flower-outline", // Keep as outline for distinction from pod
    lemon: "sunny-outline",
    "cinnamon-stick": "analytics",
    "cardamom-pod": "ellipse",
    "orange-zest": "aperture",
    "chili-flakes": "flame-outline",
    "cocoa-powder": "nutrition-outline",
    "mint-leaf": "leaf-outline",
    "sparkling-water": "water-outline",
    salt: "restaurant-outline",
    "olive-oil": "water", // Keep simple water icon
    honey: "color-palette",
    butter: "square",
    "coconut-oil": "ellipse-outline",
    "whipped-cream": "cloud",
    "ice-cream": "ice-cream", // Same as vanilla, acceptable
    "cinnamon-dust": "analytics-outline",
    watery: "water-outline", // Same as sparkling, acceptable
    smooth: "layers-outline",
    thick: "layers",
  }

  // Modified handleOptionPress for conditional toasts
  const handleOptionPress = useCallback(
    (key: OptionKey | "extraShot" | "saltPinch", value: SelectionValue) => {
      // For boolean toggles (extraShot, saltPinch), always allow toggling
      if (key === "extraShot" || key === "saltPinch") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        // Simple feedback, no complex animation needed here
        setSelections((prev) => ({ ...prev, [key]: value }))
        return
      }

      // For option keys, check if the option is compatible
      if (typeof value === "string" && key in availableOptions) {
        const isCompatible = availableOptions[key].includes(value)

        if (isCompatible) {
          // Option is compatible, allow selection
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          // Simple feedback, no complex animation needed here
          setSelections((prev) => ({ ...prev, [key]: value }))

          // *** MODIFIED TOAST LOGIC ***
          // Only show toast for section 4 options that were *not* identified
          const section4Keys: OptionKey[] = ["flavor", "enhancements", "infusions", "toppings"]
          const isSection4 = section4Keys.includes(key as OptionKey)
          const isIdentified = identifiedOptionValues.has(value as string)

          if (isSection4 && !isIdentified) {
             showToast(
               `Make sure you have ${(value as string).replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} available`,
             )
          }
        } else {
          // Option is incompatible, show toast
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          showToast(
            `${(value as string).replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} is incompatible with your scanned ingredients`,
          )
        }
      }
    },
    [availableOptions, showToast, identifiedOptionValues], // Added identifiedOptionValues dependency
  )

  // --- Scroll Handling ---
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>, optionKey: OptionKey) => {
    scrollOffsetsRef.current[optionKey] = event.nativeEvent.contentOffset.x
  }, [])

  // Debounced scroll handler if needed (optional, direct update might be fine)
  // const debouncedHandleScroll = useMemo(
  //   () => debounce((event: NativeSyntheticEvent<NativeScrollEvent>, optionKey: OptionKey) => {
  //     scrollOffsetsRef.current[optionKey] = event.nativeEvent.contentOffset.x;
  //   }, 100), // Adjust debounce time as needed
  //   []
  // );


  // Modify the OptionSelector component for scroll persistence
  const OptionSelector = React.memo(
    ({ title, optionKey }: { title: string; optionKey: OptionKey }) => {
      // Get all possible options for this category
      const allPossibleOptions = allOptions[optionKey] || []
      // Get compatible options for this category
      const compatibleOptions = availableOptions[optionKey] || []
      const currentValue = selections[optionKey]

      const initialScrollOffset = useMemo(() => ({ x: scrollOffsetsRef.current[optionKey] ?? 0, y: 0 }), [optionKey]);


      if (allPossibleOptions.length === 0) return null

      const formatOptionText = (value: string) => value.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())

      return (
        <View style={styles.optionGroup}>
          <View style={styles.optionTitleContainer}>
            <Text style={styles.optionTitle}>{title}</Text>
            <View style={styles.optionTitleLine} />
          </View>
          <ScrollView
            ref={(ref) => (scrollViewRefs.current[optionKey] = ref)} // Store ref
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.optionsScroll}
            onScroll={(e) => handleScroll(e, optionKey)} // Use direct handler
            // onScroll={(e) => debouncedHandleScroll(e, optionKey)} // Use debounced handler if preferred
            scrollEventThrottle={16} // Adjust frequency of scroll events (iOS only)
            contentOffset={initialScrollOffset} // Set initial offset
          >
            {allPossibleOptions.map((value) => {
              const isSelected = currentValue === value
              const isCompatible = compatibleOptions.includes(value)
              const iconName = optionIcons[value] || "ellipse-outline" // Provide a default icon

              // Animate scale on selection
              const scaleAnim = useRef(new Animated.Value(isSelected ? 1.05 : 1)).current;
              useEffect(() => {
                Animated.timing(scaleAnim, {
                  toValue: isSelected ? 1.05 : 1,
                  duration: 150,
                  useNativeDriver: true,
                  easing: Easing.inOut(Easing.ease)
                }).start();
              }, [isSelected, scaleAnim]);


              return (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.optionButton,
                    isSelected && styles.optionButtonSelected,
                    !isCompatible && styles.optionButtonIncompatible,
                    // { transform: [{ scale: isSelected ? 1.05 : 1 }] }, // Use Animated value
                  ]}
                  onPress={() => handleOptionPress(optionKey, value)}
                >
                 <Animated.View style={[styles.optionContentContainer, { transform: [{ scale: scaleAnim }]}]}>
                    <Ionicons
                      name={iconName}
                      size={22}
                      color={isSelected ? primaryWhite : !isCompatible ? disabledGray : primaryBlack}
                      style={styles.optionIcon}
                    />
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                        !isCompatible && styles.optionTextIncompatible,
                      ]}
                    >
                      {formatOptionText(value)}
                    </Text>
                  </Animated.View>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      )
    },
  )
  OptionSelector.displayName = "OptionSelector"


  // --- Render Logic (Modified for Section Reorganization and Flavor Mode) ---
  const getOptionTitle = (key: OptionKey): string => {
    const titles: Record<OptionKey, string> = {
      temperature: "Base Temperature",
      cupSize: "Cup Size",
      machine: "Preparation Method",
      strength: "Roast Strength",
      sweetness: "Sweetness Level",
      texture: "Texture",
      milk: "Milk / Alt-Milk",
      flavor: "Flavor Syrup", // Title remains the same
      enhancements: "Enhancements",
      infusions: "Infusions",
      toppings: "Toppings",
    }
    return titles[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase())
  }

  // Updated Section 4 Keys
  const section4OptionKeys: OptionKey[] = ["flavor", "enhancements", "infusions", "toppings"]

  const renderSection = (
    sectionNumber: string,
    sectionTitle: string,
    optionKeys: OptionKey[],
    hasAdditionalInfo = false,
    isFlavorSection = false // Add flag for flavor section
  ) => (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.sectionTitleContainer}>
          <Text style={styles.sectionNumber}>{sectionNumber}</Text>
          <Text style={styles.sectionTitle}>{sectionTitle}</Text>
        </View>
        {/* Tooltip only needed for flavor section now */}
        {hasAdditionalInfo && isFlavorSection && (
          <TouchableOpacity
            style={styles.sectionInfoContainer}
            onPress={() => showToast("Some options may require additional ingredients")}
          >
            <Ionicons name="information-circle-outline" size={18} color={grayText} />
          </TouchableOpacity>
        )}
      </View>
      {optionKeys.map((key) => (
        <OptionSelector key={key} title={getOptionTitle(key)} optionKey={key} />
      ))}
      {sectionNumber === "2" && ( // Keep toggles in Section 2
        <View style={styles.togglesContainer}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              selections.extraShot && styles.toggleButtonSelected,
              { transform: [{ scale: selections.extraShot ? 1.05 : 1 }] },
            ]}
            onPress={() => handleOptionPress("extraShot", !selections.extraShot)}
          >
            <Ionicons
              name={selections.extraShot ? "flash" : "flash-off-outline"}
              size={22}
              color={selections.extraShot ? primaryWhite : primaryBlack}
              style={styles.optionIcon}
            />
            <Text style={[styles.optionText, selections.extraShot && styles.optionTextSelected]}>Extra Shot</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              selections.saltPinch && styles.toggleButtonSelected,
              { transform: [{ scale: selections.saltPinch ? 1.05 : 1 }] },
            ]}
            onPress={() => handleOptionPress("saltPinch", !selections.saltPinch)}
          >
            <Ionicons
              name={selections.saltPinch ? "restaurant" : "restaurant-outline"} // Changed icon slightly for selected state
              size={22}
              color={selections.saltPinch ? primaryWhite : primaryBlack}
              style={styles.optionIcon}
            />
            <Text style={[styles.optionText, selections.saltPinch && styles.optionTextSelected]}>Pinch of Salt</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )

  // No longer needed
  // const legend = (
  //   <View style={styles.legendContainer}>
  //     <Ionicons name="information-circle-outline" size={16} color={warningAmber} />
  //     <Text style={styles.legendText}>
  //       Some options may require additional ingredients - you'll be notified when selecting them
  //     </Text>
  //   </View>
  // )

  // --- Render Logic (Modified for Section Reorganization, Flavor Mode, and Toast) ---
  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor={primaryWhite} />
      <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
          {" "}
          <Ionicons name="chevron-back" size={26} color={primaryBlack} />{" "}
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          {" "}
          <Ionicons name="cafe" size={24} color={coffeeBrown} style={styles.headerIcon} />{" "}
          <Text style={styles.headerTitle}>Coffee Lab</Text>{" "}
        </View>
        <View style={{ width: 40 }} />{/* Spacer */}
      </Animated.View>
      {identifiedIngredients.length > 0 && (
        <Animated.View
          style={[
            styles.ingredientsHint,
            {
              opacity: fadeAnim,
              transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          <Ionicons name="flask-outline" size={20} color={coffeeBrown} />
          <Text style={styles.ingredientsHintText} numberOfLines={1} ellipsizeMode="tail">
            {" "}
            Lab Input: {identifiedIngredients.join(", ")}{" "}
          </Text>
        </Animated.View>
      )}
      {optionsLoadingState === "loading" && (
        <View style={styles.centeredStatus}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name="flask" size={32} color={coffeeBrown} />
          </Animated.View>
          <Text style={styles.statusText}>Finding Compatible Options...</Text>
        </View>
      )}
      {optionsLoadingState === "error" && optionsError && (
        <View style={[styles.centeredStatus, styles.errorHint]}>
          <Ionicons name="warning-outline" size={24} color="#D9534F" />
          <Text style={[styles.statusText, { color: "#D9534F", marginLeft: 10 }]}>{optionsError}</Text>
        </View>
      )}

      <Animated.ScrollView
        style={[styles.content, { opacity: fadeAnim }]}
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1: Foundation */}
        {renderSection("1", "Foundation", ["temperature", "cupSize", "machine"])}

        {/* Section 2: Coffee Profile */}
        {renderSection("2", "Coffee Profile", ["strength", "sweetness", "texture"])}

        {/* Section 3: Milk */}
        {renderSection("3", "Milk", ["milk"])}

        {/* Flavor Mode Button */}
        <View style={styles.flavorModeContainer}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              // Haptic feedback
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              
              // Animate the button press
              Animated.sequence([
                Animated.timing(flavorButtonScale, {
                  toValue: 0.95,
                  duration: 100,
                  useNativeDriver: true,
                }),
                Animated.spring(flavorButtonScale, {
                  toValue: 1.05,
                  friction: 3,
                  tension: 40,
                  useNativeDriver: true,
                }),
                Animated.spring(flavorButtonScale, {
                  toValue: 1,
                  friction: 5,
                  tension: 40,
                  useNativeDriver: true,
                })
              ]).start();
              
              // Show sparkle effect when enabling flavor mode
              if (!isFlavorModeVisible) {
                setShowSparkle(true);
                sparkleAnim.setValue(0);
                Animated.timing(sparkleAnim, {
                  toValue: 1,
                  duration: 1000,
                  useNativeDriver: true,
                }).start(() => setShowSparkle(false));
              }
              
              setIsFlavorModeVisible(!isFlavorModeVisible);
            }}
          >
            <Animated.View style={{
              transform: [{ scale: flavorButtonScale }],
              borderRadius: 30,
              overflow: 'hidden',
              elevation: 5,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.3,
              shadowRadius: 4,
            }}>
              <LinearGradient
                colors={isFlavorModeVisible 
                  ? ['#8B5A2B', '#6F4E37', '#513A26'] 
                  : ['#FF9500', '#FF7100', '#FF4D00']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.flavorModeButton}
              >
                <View style={{ flexDirection: "row", alignItems: "center", width: '100%' }}>
                  <Ionicons
                    name={isFlavorModeVisible ? "flask" : "color-palette"}
                    size={24} 
                    color={"#FFFFFF"}
                    style={{ marginRight: 12 }}
                  />
                  <Text style={styles.flavorModeButtonText}>
                    {isFlavorModeVisible ? "Hide Flavor Options" : "Supercharge Flavor"}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Animated.View style={{
                    transform: [{ 
                      rotate: isFlavorModeVisible 
                        ? '180deg' 
                        : '0deg' 
                    }]
                  }}>
                    <Ionicons
                      name="chevron-down"
                      size={20} 
                      color="#FFFFFF" 
                    />
                  </Animated.View>
                </View>
              </LinearGradient>
            </Animated.View>
          </TouchableOpacity>
          
          {/* Sparkle effect overlay */}
          {showSparkle && (
            <Animated.View style={{
              position: 'absolute',
              top: -10,
              right: 20,
              opacity: sparkleAnim.interpolate({
                inputRange: [0, 0.2, 0.8, 1],
                outputRange: [0, 1, 1, 0]
              }),
              transform: [{
                scale: sparkleAnim.interpolate({
                  inputRange: [0, 0.2, 0.8, 1],
                  outputRange: [0.5, 1.2, 1.5, 2]
                })
              }]
            }}>
              <Ionicons name="sparkles" size={36} color="#FFD700" />
            </Animated.View>
          )}
        </View>

        {/* Section 4: Additions & Flair (Conditional) */}
        {isFlavorModeVisible &&
           renderSection("4", "Additions & Flair", section4OptionKeys, true, true) // Pass true for hasAdditionalInfo and isFlavorSection
        }

      </Animated.ScrollView>

      <Animated.View
        style={[
          styles.footer,
          {
            opacity: fadeAnim,
            transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [50, 0] }) }],
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.generateButton, optionsLoadingState === "loading" && styles.generateButtonDisabled]}
          onPress={handleGenerateRecipe}
          disabled={
            optionsLoadingState === "loading" || (optionsLoadingState === "error" && !optionsError?.includes("busy"))
          }
        >
          <Ionicons name="beaker" size={24} color={primaryWhite} style={{ marginRight: 10 }} />
          <Text style={styles.generateButtonText}>Create My Recipe</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Toast notification */}
      <Toast message={toastMessage} isVisible={toastVisible} onHide={() => setToastVisible(false)} />
    </SafeAreaView>
  )
}

// --- Styles (Modified for scroll persistence, flavor mode, etc.) ---
const primaryBlack = "#1A1A1A"
const primaryWhite = "#FFFFFF"
const coffeeBrown = "#6F4E37"
const coffeeLight = "#C8A27D" // Slightly lighter brown
const lightGray = "#F5F5F5"
const midGray = "#E0E0E0"
const grayText = "#666666"
const disabledGray = "#BDBDBD"
const warningAmber = "#FFA000" // Slightly darker amber for better contrast
// const warningLight = "#FFF3E0"; // Not used currently

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: primaryWhite },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: midGray,
    backgroundColor: primaryWhite,
    elevation: 2, // Android shadow
    shadowColor: "#000", // iOS shadow
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  headerTitleContainer: { flexDirection: "row", alignItems: "center" },
  headerIcon: { marginRight: 8 },
  backButton: { padding: 8, marginLeft: -8 }, // Adjust padding for touch area
  headerTitle: { fontSize: 22, fontWeight: "700", color: primaryBlack },
  ingredientsHint: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "#FFF8E1", // Light yellow background
    borderBottomWidth: 1,
    borderBottomColor: "#FFE0B2", // Lighter border
  },
  ingredientsHintText: { marginLeft: 10, fontSize: 14, color: coffeeBrown, flex: 1 },
  centeredStatus: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  errorHint: {
    backgroundColor: "#FFEBEE", // Light red background
    borderBottomWidth: 1,
    borderBottomColor: "#FFCDD2", // Lighter border
    justifyContent: "flex-start",
  },
  statusText: { marginLeft: 15, fontSize: 16, fontWeight: "500", color: coffeeBrown, textAlign: "center" },
  content: { flex: 1 },
  scrollContainer: { paddingBottom: 120 }, // Ensure space for footer
  section: {
    marginHorizontal: 20,
    marginTop: 25,
    borderBottomWidth: 1,
    borderBottomColor: lightGray,
    paddingBottom: 20,
  },
  sectionHeaderRow: { // Used for title and optional icon
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15, // Reduced margin below header row
  },
  sectionTitleContainer: { flexDirection: "row", alignItems: "center", marginBottom: 5 }, // Reduced margin below title itself
  sectionNumber: {
    fontSize: 22,
    fontWeight: "800",
    color: coffeeBrown,
    backgroundColor: "#FFF8E1", // Light yellow background for number
    width: 36,
    height: 36,
    textAlign: "center",
    lineHeight: 36, // Vertically center text
    borderRadius: 18, // Make it circular
    marginRight: 12,
    overflow: "hidden", // Ensure background respects border radius
  },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: primaryBlack, letterSpacing: 0.5 },
  sectionInfoContainer: { // For the optional info icon
    padding: 5, // Increase touch area
  },
  // sectionInfoIcon: { // Not needed if using container padding
  //   marginLeft: 8,
  // },
  // sectionInfoText: { // Not currently used
  //   fontSize: 12,
  //   color: grayText,
  //   fontStyle: "italic",
  //   marginTop: 4,
  // },
  optionGroup: { marginBottom: 22 },
  optionTitleContainer: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  optionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: grayText,
    marginRight: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  optionTitleLine: { flex: 1, height: 1, backgroundColor: midGray },
  optionsScroll: { paddingVertical: 5, paddingLeft: 2, paddingRight: 20 }, // Added vertical padding
  optionButton: {
    // Container for animation and base styles
    borderRadius: 25,
    marginRight: 12,
    borderWidth: 1,
    borderColor: midGray,
    backgroundColor: lightGray,
    overflow: 'hidden', // Keep animation contained
  },
  optionContentContainer: { // Inner container for content alignment and scaling
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    minHeight: 46, // Ensure consistent height
  },
  optionButtonSelected: {
    // Applied to the outer TouchableOpacity
    backgroundColor: coffeeBrown,
    borderColor: coffeeBrown,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  optionButtonIncompatible: {
    // Applied to the outer TouchableOpacity
    backgroundColor: "#F5F5F5",
    borderColor: "#E5E5E5",
    opacity: 0.7,
    elevation: 0, // Remove shadow for incompatible
    shadowOpacity: 0,
  },
  optionIcon: { marginRight: 8 },
  optionText: { color: primaryBlack, fontSize: 15, fontWeight: "500" },
  optionTextSelected: { color: primaryWhite, fontWeight: "600" },
  optionTextIncompatible: { color: disabledGray, fontWeight: "400" },
  togglesContainer: { flexDirection: "row", flexWrap: "wrap", marginTop: 15, gap: 12 },
  toggleButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: lightGray,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: midGray,
    minHeight: 46,
  },
  toggleButtonSelected: {
    backgroundColor: coffeeBrown,
    borderColor: coffeeBrown,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  flavorModeContainer: {
    marginHorizontal: 20,
    marginTop: 25, // Spacing consistent with sections
    marginBottom: 5, // Less margin before next section if visible
  },
  flavorModeButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingVertical: 14,
    borderRadius: 30, // More rounded like the generate button
    borderWidth: 0,
    overflow: 'hidden', // Needed for the gradient background
    elevation: 3, // Android shadow 
    shadowColor: "#000", // iOS shadow
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  flavorModeButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingTop: 15,
    // paddingBottom depends on safe area, handled by SafeAreaView edge="bottom" typically
    backgroundColor: primaryWhite,
    borderTopWidth: 1,
    borderTopColor: midGray,
    elevation: 8, // Increased elevation for footer
    shadowColor: "#000", // iOS shadow
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  generateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: coffeeBrown,
    paddingVertical: 16,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 5, // Android shadow
  },
  generateButtonDisabled: { backgroundColor: disabledGray, elevation: 0, shadowOpacity: 0 },
  generateButtonText: { color: primaryWhite, fontSize: 18, fontWeight: "700" },
  // Removed unused styles like legend
})

export default CoffeeLab