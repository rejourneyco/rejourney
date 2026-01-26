"use client"

import type React from "react"
import { useEffect, useState, useRef } from "react"
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Linking,
  Alert,
  StatusBar,
  Dimensions,
  Platform,
  AppState,
  Animated,
} from "react-native"
import { Camera, useCameraDevice } from "react-native-vision-camera"
import { Ionicons } from "@expo/vector-icons"
import { router, Stack, useNavigation } from "expo-router"
import * as ImagePicker from "expo-image-picker"
import * as Haptics from "expo-haptics"
import * as FileSystem from "expo-file-system"
import { supabase } from "../../supabase" // Adjust to match your supabase client import

const { width: windowWidth, height: windowHeight } = Dimensions.get("window")

// --- Theme / Colors ---
const COFFEE_BROWN = "#6F4E37"
const COFFEE_CREAM = "#FFF8E7"
const OVERLAY_BG = "rgba(0, 0, 0, 0.6)"
const CORNER_SIZE = 36
const CORNER_THICKNESS = 5
const TOUCH_TARGET_SIZE = 60
const MIN_SCAN_BOX_SIZE = 200
const MAX_SCAN_BOX_SIZE_FACTOR = 0.9 // Max size relative to window width
const MAX_SCAN_BOX_SIZE = Math.min(windowWidth * MAX_SCAN_BOX_SIZE_FACTOR, 400)

const CoffeeScanner: React.FC = () => {
  // --- State ---
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null)
  const device = useCameraDevice("back")
  const [torch, setTorch] = useState(false)
  const [scanBoxSize, setScanBoxSize] = useState(Math.min(windowWidth * 0.7, 300))
  const [isScreenFocused, setIsScreenFocused] = useState(true)
  const [showResizeTooltip, setShowResizeTooltip] = useState(true)
  const [isCapturing, setIsCapturing] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const ZOOM_LEVELS = [1,2,3]

  // --- Refs ---
  const camera = useRef<Camera>(null)
  const appState = useRef(AppState.currentState)
  const lastGestureDistance = useRef(0)
  const captureOpacity = useRef(new Animated.Value(0)).current

  // --- Navigation ---
  const navigation = useNavigation()

  // --- Permission Handling ---
  const requestCameraPermissionOnMount = async () => {
    const cameraStatus = await Camera.requestCameraPermission()
    const granted = cameraStatus === "granted"
    setHasCameraPermission(granted)

    if (!granted) {
      Alert.alert("Camera Permission Required", "Please enable camera access in your settings to scan ingredients.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ])
    }
  }

  const requestGalleryPermissionOnClick = async (): Promise<boolean> => {
    const { status: currentStatus } = await ImagePicker.getMediaLibraryPermissionsAsync()
    if (currentStatus === "granted") return true

    const { status: newStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (newStatus !== "granted") {
      Alert.alert("Gallery Permission Required", "Please enable gallery access in your settings to select images.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ])
      return false
    }
    return true
  }

  // --- Effects ---
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        setIsScreenFocused(true)
      } else if (nextAppState.match(/inactive|background/)) {
        setIsScreenFocused(false)
      }
      appState.current = nextAppState
    })

    const unsubscribeFocus = navigation.addListener("focus", () => setIsScreenFocused(true))
    const unsubscribeBlur = navigation.addListener("blur", () => setIsScreenFocused(false))

    return () => {
      subscription.remove()
      unsubscribeFocus()
      unsubscribeBlur()
    }
  }, [navigation])

  useEffect(() => {
    requestCameraPermissionOnMount()
    StatusBar.setBarStyle("light-content")
    return () => {
      StatusBar.setBarStyle(Platform.OS === "ios" ? "dark-content" : "default")
    }
  }, [])

  useEffect(() => {
    if (showResizeTooltip) {
      const timer = setTimeout(() => setShowResizeTooltip(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [showResizeTooltip])

  // --- Handlers ---
  const handleBackPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (router.canGoBack()) {
      router.replace("/(tabs)/home")
    } else {
      router.replace("/(tabs)/home")
    }
  }

  /**
   *  NEW: Load Pantry handler
   *  1. Fetch current user's pantry from Supabase (`user_pantry` table).
   *  2. If none, alert. If some, navigate to the Identify screen in "pantry mode."
   */
  const handleLoadPantryPress = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      // ** Replace with your user retrieval logic **
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData?.user?.id
      if (!userId) {
        Alert.alert("Not Logged In", "You must be logged in to load pantry items.", [{ text: "OK" }])
        return
      }

      // We expect a single row from user_pantry, containing a JSON array of items
      const { data: userPantry, error } = await supabase
        .from("user_pantry")
        .select("*")
        .eq("user_uuid", userId)
        .single()

      if (error) {
        console.error("Error fetching pantry JSON:", error)
        Alert.alert("Pantry not setup", "Just snap a photo your items instead.")
        return
      }

      // If no row or the items array is empty
      if (!userPantry || !userPantry.items || userPantry.items.length === 0) {
        Alert.alert("No Pantry Items", "You have no items in your pantry. Add items before trying again.")
        return
      }

      // If we have items, just navigate to Identify with the "usePantry" param
      router.push({
        pathname: "/other-pages/id-ingridents",
        params: { usePantry: "true" },
      })
    } catch (err) {
      console.error("Error loading pantry:", err)
      Alert.alert("Error", "Could not load pantry items.")
    }
  }

  const navigateToIdentifyScreen = async (uri: string) => {
    try {
      const tempDir = FileSystem.cacheDirectory + "coffee_scan_cache/"
      const dirInfo = await FileSystem.getInfoAsync(tempDir)
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true })
      }
      const filename = `scan_${new Date().getTime()}.jpg`
      const destUri = tempDir + filename

      const sourceInfo = await FileSystem.getInfoAsync(uri)
      if (!sourceInfo.exists) {
        console.error(`Source file does not exist: ${uri}`)
        Alert.alert("Error", "Selected image file could not be found.")
        return
      }

      await FileSystem.copyAsync({ from: uri, to: destUri })
      router.push({
        pathname: "/other-pages/id-ingridents",
        params: { imagePath: destUri },
      })
    } catch (error) {
      console.error("Error processing image:", error)
      Alert.alert("Error", "Could not process the image. Please try again.")
    }
  }

  const handleGalleryPress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const galleryPermissionGranted = await requestGalleryPermissionOnClick()
    if (!galleryPermissionGranted) return

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      })

      if (!result.canceled && result.assets && result.assets.length > 0) {
        await navigateToIdentifyScreen(result.assets[0].uri)
      }
    } catch (error) {
      console.error("Error picking image from gallery:", error)
      Alert.alert("Gallery Error", "Could not select image from gallery.")
    }
  }

  const takePicture = async () => {
    if (isCapturing) return

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (!camera.current) {
      Alert.alert("Camera Error", "Camera is not ready. Please wait a moment.")
      return
    }
    if (!isScreenFocused) return

    setIsCapturing(true)

    // Flash animation
    Animated.sequence([
      Animated.timing(captureOpacity, {
        toValue: 0.8,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(captureOpacity, {
        toValue: 0,
        duration: 250,
        delay: 50,
        useNativeDriver: true,
      }),
    ]).start()

    try {
      const photo = await camera.current.takePhoto({
        flash: torch ? "on" : "off",
        qualityPrioritization: "balanced",
        enableShutterSound: Platform.OS === "android",
      })

      const fileUri = Platform.OS === "android" ? "file://" + photo.path : photo.path
      await navigateToIdentifyScreen(fileUri)
    } catch (error: any) {
      console.error("Error processing photo:", error)
      let userMessage = "Could not process the photo. Please try again."
      if (error.message?.includes("busy")) {
        userMessage = "The camera is busy. Please try again in a moment."
      } else if (error.message?.includes("permission")) {
        userMessage = "Camera permission might have been revoked. Please check settings."
      }
      Alert.alert("Capture Error", userMessage)
    } finally {
      setIsCapturing(false)
    }
  }

  const handleRecipesPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    router.push("/(tabs)/my-recipes")
  }

  // --- Pan Responder for Resizing ---

  // --- Render ---
  if (hasCameraPermission === null) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="cafe" size={40} color={COFFEE_BROWN} />
        <Text style={styles.loadingText}>Checking Camera Access...</Text>
      </View>
    )
  }

  if (hasCameraPermission === false || !device) {
    return (
      <View style={styles.permissionContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="light-content" />
        <Ionicons name="camera-outline" size={60} color={COFFEE_BROWN} />
        <Text style={styles.permissionTitle}>{device ? "Camera Access Needed" : "Camera Not Found"}</Text>
        <Text style={styles.permissionText}>
          {device
            ? "Coffee Labs needs camera permission to scan ingredients. Please grant access in your device settings."
            : "Could not find a suitable camera device on this phone."}
        </Text>
        {device && hasCameraPermission === false && (
          <TouchableOpacity style={styles.permissionButton} onPress={() => Linking.openSettings()}>
            <Text style={styles.permissionButtonText}>Open Settings</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.permissionButton, { marginTop: 15, backgroundColor: "#555" }]}
          onPress={handleBackPress}
        >
          <Text style={styles.permissionButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" translucent={true} backgroundColor="transparent" />
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isScreenFocused && hasCameraPermission}
        torch={torch ? "on" : "off"}
        photo={true}
        zoom={zoomLevel}
        onError={(error) => console.error("Camera Runtime Error:", error)}
      />
      {/* Dark overlay behind the UI elements */}
      <View style={styles.darkOverlay} />

      {/* Top Header Row */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBackPress} style={styles.iconButton}>
          <Ionicons name="arrow-back" size={28} color="white" />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Snap a Picture</Text>
          <TouchableOpacity style={styles.pantryButton} onPress={handleLoadPantryPress}>
            <Text style={styles.pantryButtonText}>OR Load Pantry</Text>
          </TouchableOpacity>
        </View>
        
        <TouchableOpacity
          onPress={() => {
            setTorch(!torch)
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          }}
          style={styles.iconButton}
        >
          <Ionicons name={torch ? "flash" : "flash-outline"} size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* SCAN FRAME + "Load Pantry" button */}

      {/* Full screen capture area with minimal indicators */}
      <View style={styles.scanFrameContainer}>
        <Text style={styles.scanInstructions}>Snap a picture of the items you want to mix</Text>

        {/* Zoom controls */}
        <View style={styles.zoomControls}>
          {ZOOM_LEVELS.map((zoom) => (
            <TouchableOpacity
              key={zoom}
              style={[styles.zoomButton, zoomLevel === zoom && styles.activeZoomButton]}
              onPress={() => {
                setZoomLevel(zoom)
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              }}
            >
              <Text style={[styles.zoomButtonText, zoomLevel === zoom && styles.activeZoomButtonText]}>{zoom}x</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Footer with camera, gallery, recipes */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.footerButton} onPress={handleGalleryPress}>
          <Ionicons name="images-outline" size={30} color="white" />
          <Text style={styles.buttonLabel}>Gallery</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.captureButton} onPress={takePicture} disabled={isCapturing}>
          <Ionicons name="camera" size={38} color={isCapturing ? "#aaa" : COFFEE_BROWN} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.footerButton} onPress={handleRecipesPress}>
          <Ionicons name="book-outline" size={30} color="white" />
          <Text style={styles.buttonLabel}>Recipes</Text>
        </TouchableOpacity>
      </View>

      {/* Flash animation */}
      <Animated.View style={[styles.captureOverlay, { opacity: captureOpacity }]} pointerEvents="none" />
    </View>
  )
}

// --- Styles ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#211A16",
  },
  loadingText: {
    color: COFFEE_CREAM,
    fontSize: 18,
    marginTop: 15,
    fontWeight: "500",
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#211A16",
    paddingHorizontal: 30,
    paddingBottom: 50,
  },
  permissionTitle: {
    color: COFFEE_CREAM,
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 25,
    marginBottom: 15,
    textAlign: "center",
  },
  permissionText: {
    color: COFFEE_CREAM,
    fontSize: 16,
    textAlign: "center",
    marginBottom: 35,
    lineHeight: 24,
  },
  permissionButton: {
    backgroundColor: COFFEE_BROWN,
    paddingVertical: 14,
    paddingHorizontal: 35,
    borderRadius: 30,
    minWidth: 180,
    alignItems: "center",
  },
  permissionButtonText: {
    color: COFFEE_CREAM,
    fontSize: 16,
    fontWeight: "600",
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: (StatusBar.currentHeight || 40) + 15,
    paddingHorizontal: 15,
    paddingBottom: 15,
    backgroundColor: OVERLAY_BG,
    width: "100%",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 10,
  },
  headerTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  pantryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(111, 78, 55, 0.8)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginTop: 18,
  },
  pantryButtonText: {
    color: "white",
    fontSize: 13,
    fontWeight: "500",
    marginLeft: 4,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: (Platform.OS === "ios" ? 30 : 20) + 15,
    paddingHorizontal: 20,
    backgroundColor: OVERLAY_BG,
    width: "100%",
  },
  footerButton: {
    alignItems: "center",
    padding: 10,
    flex: 1,
  },
  buttonLabel: {
    color: "white",
    fontSize: 13,
    marginTop: 6,
    fontWeight: "600",
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COFFEE_CREAM,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 5,
    borderColor: "rgba(255, 255, 255, 0.6)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
    marginHorizontal: 10,
  },
  captureOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "white",
    zIndex: 999,
  },
  // New styles for zoom controls
  zoomControls: {
    position: "absolute",
    bottom: 60,
    flexDirection: "row",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 20,
    padding: 5,
  },
  zoomButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginHorizontal: 2,
  },
  activeZoomButton: {
    backgroundColor: "rgba(255, 248, 231, 0.2)",
  },
  zoomButtonText: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
  activeZoomButtonText: {
    color: "white",
  },
  // Minimal pantry button
  minimalPantryButton: {
    position: "absolute",
    top: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 231, 0.2)",
  },
  minimalPantryText: {
    color: "rgba(255, 248, 231, 0.8)",
    fontSize: 12,
    fontWeight: "500",
    marginLeft: 4,
  },
  // Updated scan frame container
  scanFrameContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scanInstructions: {
    position: "absolute",
    bottom: 20,
    color: "white",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    maxWidth: "85%",
    fontWeight: "500",
  },
})

export default CoffeeScanner
