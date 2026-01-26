import React, { useState, useEffect, useCallback } from "react"
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Alert,
  SafeAreaView,
  Animated,
  Easing,
} from "react-native"
import { Stack, useLocalSearchParams, router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import * as Haptics from "expo-haptics"
import * as FileSystem from "expo-file-system"
import { supabase } from "../../supabase" // Adjust to match your supabase client import

// --- Interfaces ---
interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}
interface GeminiContent {
  parts: GeminiPart[]
  role?: string
}
interface GeminiRequest {
  contents: GeminiContent[]
}
interface GeminiResponse {
  candidates?: { content: GeminiContent; finishReason?: string }[]
  error?: { code: number; message: string; status: string }
}

type LoadingState = "idle" | "reading_image" | "identifying" | "done" | "error"

const IdentifyIngredients: React.FC = () => {
  // Router params
  const params = useLocalSearchParams<{ imagePath?: string; usePantry?: string }>()

  const [loadingState, setLoadingState] = useState<LoadingState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [identifiedIngredients, setIdentifiedIngredients] = useState<string[]>([])
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [identificationPrompt, setIdentificationPrompt] = useState<string>("");

  // Animations
  const fadeAnim = useState(new Animated.Value(0))[0]
  const scaleAnim = useState(new Animated.Value(0.95))[0]
  const spinValue = useState(new Animated.Value(0))[0]

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
      Animated.timing(spinValue, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true })
    ).start()
  }, [fadeAnim, scaleAnim, spinValue])

  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] })

  // Fetch prompt from app_config
  const fetchPrompt = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("app_config")
        .select("id_prompt")
        .single();

      if (error) {
        console.error("Error fetching prompt:", error);
        // Use default prompt as fallback
        return;
      }
      
      if (data?.id_prompt) {
        console.log("Using prompt from app_config");
        setIdentificationPrompt(data.id_prompt);
      }
    } catch (error) {
      console.error("Unexpected error fetching prompt:", error);
    }
  }, []);

  // Call fetchPrompt on component mount
  useEffect(() => {
    fetchPrompt();
  }, [fetchPrompt]);

  // Edge function call
  const callGeminiViaEdgeFunction = useCallback(async (requestBody: GeminiRequest): Promise<GeminiResponse> => {
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("gemini-recipe-proxy", {
        body: requestBody,
      })
      if (invokeError) {
        let reason = "Failed to communicate with the identification service."
        if (
          invokeError.message?.includes("authorization") ||
          invokeError.message?.includes("JWT")
        ) {
          reason = "Authentication failed. Please log in again."
        }
        throw new Error(reason)
      }

      const geminiData: GeminiResponse = data
      if (geminiData.error) {
        const errorMsg = `API Error (${geminiData.error.status || geminiData.error.code}): ${
          geminiData.error.message
        }`
        throw new Error(errorMsg)
      }
      if (!geminiData.candidates || geminiData.candidates.length === 0) {
        throw new Error("No valid response from identification service.")
      }
      return geminiData
    } catch (error: any) {
      console.error("Error calling gemini-recipe-proxy:", error)
      throw new Error(error.message || "Failed to communicate with identification service.")
    }
  }, [])

  // Main effect
  useEffect(() => {
    const identify = async () => {
      // --- Wait for prompt if not in pantry mode and prompt isn't loaded ---
      if (params.usePantry !== "true" && !identificationPrompt) {
        console.log("Waiting for identification prompt...");
        // Keep showing the initial loading state or set a specific one
        // If loadingState is 'idle', maybe set it to 'waiting_for_prompt' or keep as is.
        // For simplicity, we just return and let the effect re-run when the prompt arrives.
        return;
      }

      // --- If in Pantry Mode ---
      if (params.usePantry === "true") {
        setLoadingState("done")
        setErrorMessage(null)

        try {
          const { data: authData } = await supabase.auth.getUser()
          const userId = authData?.user?.id
          if (!userId) {
            setErrorMessage("Not logged in. Cannot load pantry.")
            setLoadingState("error")
            return
          }

          // Single row with JSON items
          const { data: userPantry, error } = await supabase
            .from("user_pantry")
            .select("*")
            .eq("user_uuid", userId)
            .single()

          if (error || !userPantry) {
            throw new Error(error?.message || "Could not fetch pantry items.")
          }
          if (!userPantry.items || userPantry.items.length === 0) {
            setErrorMessage("No items found in your pantry.")
            setLoadingState("error")
            return
          }

          // userPantry.items is presumably an array of objects:
          // e.g. [{ id: "...", name: "Milk", brand: "HEB" }, { name: "Sugar", brand: "C&H" }, ...]
          // Convert them to display strings
          const itemNames = userPantry.items.map((itm: any) => {
            // If your JSON objects are structured differently, adjust accordingly
            const name = itm.name || "(Unnamed)"
            if (itm.brand) {
              return `${name} (${itm.brand})`
            }
            return name
          })

          setIdentifiedIngredients(itemNames)
        } catch (e: any) {
          console.error("Error loading pantry inside Identify:", e)
          setErrorMessage(e.message || "Unknown error loading pantry.")
          setLoadingState("error")
        }
        return
      }

      // --- Otherwise, normal image-based identification ---
      if (!params.imagePath) {
        setErrorMessage("No image path provided.")
        setLoadingState("error")
        return
      }

      setLoadingState("reading_image")
      setErrorMessage(null)
      setIdentifiedIngredients([])
      setImageBase64(null)

      try {
        // 1. Read image file
        const base64 = await FileSystem.readAsStringAsync(params.imagePath, {
          encoding: FileSystem.EncodingType.Base64,
        })
        setImageBase64(base64)

        // 2. Identify
        setLoadingState("identifying")
        const identificationRequest: GeminiRequest = {
          contents: [
            {
              parts: [
                {
                  text: identificationPrompt || "respond with just 'None'.",
                },
                { inlineData: { mimeType: "image/jpeg", data: base64 } },
              ],
            },
          ],
        };

        const identificationResponse = await callGeminiViaEdgeFunction(identificationRequest)
        const identifiedText =
          identificationResponse.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "None"

        const ingredients = identifiedText
          .split("\n")
          .map((item) => item.trim().replace(/^- /, ""))
          .filter((item) => item && item.toLowerCase() !== "none")

        setIdentifiedIngredients(ingredients)
        setLoadingState("done")
      } catch (error: any) {
        setErrorMessage(error.message || "An unknown error occurred during identification.")
        setLoadingState("error")
      }
    }

    identify();
  }, [params.imagePath, params.usePantry, callGeminiViaEdgeFunction, identificationPrompt]);

  // Navigation
  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (router.canGoBack()) router.back()
    else router.replace("/other-pages/coffee-scanner")
  }

  const handleProceedToLab = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    router.push({
      pathname: "/other-pages/lab",
      params: {
        // Pass array as JSON if your Lab page needs it
        identifiedIngredients: JSON.stringify(identifiedIngredients),
      },
    })
  }

  const handleRetry = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setLoadingState("idle")
  }

  const handleScanAgain = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    router.replace("/other-pages/coffee-scanner")
  }

  // Render
  const renderContent = () => {
    if (loadingState !== "done" && loadingState !== "error") {
      let loadingText = "Initializing..."
      if (loadingState === "reading_image") loadingText = "Reading image file..."
      if (loadingState === "identifying") loadingText = "Analyzing coffee elements..."

      return (
        <View style={styles.centered}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name="flask" size={60} color={COFFEE_BROWN} />
          </Animated.View>
          <Text style={styles.statusText}>{loadingText}</Text>
        </View>
      )
    }

    if (loadingState === "error") {
      return (
        <Animated.View
          style={[
            styles.centered,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={60} color="#D9534F" />
          <Text style={styles.errorTitle}>Identification Failed</Text>
          <Text style={styles.errorMessage}>{errorMessage || "Could not identify ingredients."}</Text>
          <TouchableOpacity onPress={handleRetry} style={[styles.button, styles.retryButton]}>
            <Ionicons name="refresh" size={20} color="white" style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleBack} style={[styles.button, styles.backButton]}>
            <Ionicons name="arrow-back" size={20} color="#333" style={{ marginRight: 8 }} />
            <Text style={[styles.buttonText, { color: "#333" }]}>Go Back</Text>
          </TouchableOpacity>
        </Animated.View>
      )
    }

    // SUCCESS
    return (
      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        style={{ opacity: fadeAnim }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>
          {params.usePantry === "true" ? "Pantry Items" : "Identified Items"}
        </Text>

        {/* Show an image preview only if not in pantry mode */}
        {params.usePantry !== "true" && params.imagePath && (
          <View style={styles.imageContainer}>
            <Image source={{ uri: params.imagePath }} style={styles.imagePreview} resizeMode="cover" />
          </View>
        )}

        {identifiedIngredients.length > 0 ? (
          <>
            <View style={styles.ingredientsCard}>
              <View style={styles.cardHeader}>
                <Ionicons name="cafe" size={22} color={COFFEE_BROWN} />
                <Text style={styles.listHeader}>
                  {params.usePantry === "true" ? "Your Pantry Items:" : "Detected Coffee Items:"}
                </Text>
              </View>
              <View style={styles.ingredientsList}>
                {identifiedIngredients.map((item, index) => (
                  <View key={index} style={styles.ingredientItem}>
                    <View style={styles.ingredientBullet}>
                      <Ionicons name="checkmark-circle" size={20} color={COFFEE_BROWN} />
                    </View>
                    <Text style={styles.ingredientText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
            {/* Proceed */}
            <TouchableOpacity onPress={handleProceedToLab} style={[styles.button, styles.proceedButton]}>
              <Ionicons name="flask" size={22} color="white" style={{ marginRight: 10 }} />
              <Text style={styles.buttonText}>Proceed to Coffee Lab</Text>
            </TouchableOpacity>
            {/* Scan again */}
            <TouchableOpacity
              onPress={handleScanAgain}
              style={[styles.button, styles.backButton, { marginTop: 15, marginBottom: 30 }]}
            >
              <Ionicons name="camera" size={20} color="#333" style={{ marginRight: 8 }} />
              <Text style={[styles.buttonText, { color: "#333" }]}>Scan Again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.noItemsContainer}>
              <Ionicons name="alert-circle" size={40} color="#FF6B6B" />
              <Text style={styles.noItemsText}>No coffee items identified.</Text>
              <Text style={styles.noItemsSubtext}>
                Please scan an image (or load your pantry) with coffee beans, equipment,
                or coffee-related ingredients to proceed.
              </Text>
            </View>
            <TouchableOpacity style={[styles.button, styles.disabledButton]} disabled={true}>
              <Ionicons name="flask" size={22} color="#CCC" style={{ marginRight: 10 }} />
              <Text style={styles.disabledButtonText}>Proceed to Coffee Lab</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleScanAgain}
              style={[styles.button, styles.scanAgainButton, { marginTop: 15, marginBottom: 30 }]}
            >
              <Ionicons name="camera" size={20} color="white" style={{ marginRight: 8 }} />
              <Text style={styles.buttonText}>Scan New Image</Text>
            </TouchableOpacity>
          </>
        )}
      </Animated.ScrollView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <Stack.Screen options={{ headerShown: false }} />
      <Animated.View
        style={[styles.header, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}
      >
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={26} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Ionicons name="search" size={24} color={COFFEE_BROWN} style={styles.headerIcon} />
          <Text style={styles.headerTitle}>Ingredient Check</Text>
        </View>
        <View style={{ width: 40 }} />
      </Animated.View>
      {renderContent()}
    </SafeAreaView>
  )
}

// --- Styles ---
const COFFEE_BROWN = "#6F4E37"
const LIGHT_GRAY = "#F5F5F5"
const MID_GRAY = "#E0E0E0"
const SOFT_BG = "#F8F5F2"

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: MID_GRAY,
    backgroundColor: "#FFFFFF",
    elevation: 2,
  },
  headerTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIcon: {
    marginRight: 8,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: LIGHT_GRAY,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  statusText: {
    marginTop: 20,
    color: COFFEE_BROWN,
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#D9534F",
    marginTop: 15,
    marginBottom: 10,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 30,
    lineHeight: 22,
    maxWidth: 300,
  },
  scrollContent: {
    padding: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 20,
    textAlign: "center",
  },
  imageContainer: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    marginBottom: 25,
  },
  imagePreview: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "#E0E0E0",
  },
  ingredientsCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    marginBottom: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SOFT_BG,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: MID_GRAY,
  },
  listHeader: {
    fontSize: 17,
    fontWeight: "600",
    color: "#333",
    marginLeft: 10,
  },
  ingredientsList: {
    padding: 5,
  },
  ingredientItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
  },
  ingredientBullet: {
    marginRight: 12,
  },
  ingredientText: {
    fontSize: 16,
    color: "#333",
    flex: 1,
  },
  noItemsContainer: {
    alignItems: "center",
    padding: 25,
    backgroundColor: "#FFF8F8",
    borderRadius: 16,
    marginBottom: 30,
    width: "100%",
    borderWidth: 1,
    borderColor: "#FFCDD2",
  },
  noItemsText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#D32F2F",
    textAlign: "center",
    marginTop: 15,
  },
  noItemsSubtext: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 22,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 30,
    width: "100%",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  proceedButton: {
    backgroundColor: COFFEE_BROWN,
  },
  retryButton: {
    backgroundColor: "#FFA726",
    marginBottom: 15,
  },
  disabledButton: {
    backgroundColor: "#F5F5F5",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledButtonText: {
    color: "#ABABAB",
    fontSize: 17,
    fontWeight: "bold",
    textAlign: "center",
  },
  scanAgainButton: {
    backgroundColor: "#4CAF50",
  },
  buttonText: {
    color: "white",
    fontSize: 17,
    fontWeight: "bold",
    textAlign: "center",
  },
})

export default IdentifyIngredients
