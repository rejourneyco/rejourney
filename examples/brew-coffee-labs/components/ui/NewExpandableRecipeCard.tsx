"use client"

import type React from "react"
import { useState, useRef, memo, useCallback } from "react"
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
  LayoutAnimation,
  UIManager,
  TouchableWithoutFeedback,
  Dimensions,
} from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { Heart, ChevronDown, Link } from "lucide-react-native"
import * as Haptics from "expo-haptics"
import * as Clipboard from "expo-clipboard"
import { Toast } from "./toast"

// Enable LayoutAnimation for Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

const COLORS = {
  primary: "#1A1A1A",
  accent: "#FF6B6B",
  background: "#FFFFFF",
  surface: "#F9F9F9",
  border: "#EEEEEE",
  text: {
    primary: "#11A1A",
    secondary: "#666666",
    tertiary: "#999999",
  },
}

const { width: SCREEN_WIDTH } = Dimensions.get("window")
// Adjusted max height based on a portrait aspect ratio (e.g., 4:3 of the screen width)
const MAX_IMAGE_HEIGHT = SCREEN_WIDTH * (4 / 3) // Max height is 4/3 times the width

type Props = {
  recipe: {
    id: string
    name: string
    nickname?: string
    date?: string
    likes?: number
    isLiked?: boolean
    profileImage?: any
    image?: any
    image_url?: string
    imageWidth?: number
    imageHeight?: number
    ingredients?: string[]
    instructions?: string[]
  }
  onLikePress: (recipeId: string | number) => void
}

const NewExpandableRecipeCard: React.FC<Props> = memo(({ recipe, onLikePress }) => {
  const [expanded, setExpanded] = useState(false)
  const rotateAnim = useRef(new Animated.Value(0)).current
  const heartScale = useRef(new Animated.Value(1)).current
  const heartBounce = useRef(new Animated.Value(0)).current
  const [toastVisible, setToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState("")

  // --- ASPECT RATIO LOGIC ---
  // Calculate aspect ratio (width / height)
  const aspectRatio =
    recipe.imageWidth && recipe.imageHeight && recipe.imageHeight > 0
      ? recipe.imageWidth / recipe.imageHeight // Use actual dimensions if available
      : 3 / 4 // Fallback to portrait (3 units wide, 4 units tall)

  // --- TOGGLE EXPAND ---
  const toggleExpand = () => {
    const animationConfig = {
      duration: 300,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: {
        duration: 200,
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      create: {
        duration: 300,
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    }
    LayoutAnimation.configureNext(animationConfig)

    Animated.timing(rotateAnim, {
      toValue: expanded ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start()

    setExpanded(!expanded)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  // --- HANDLE LIKE ---
  const handleLike = (event: any) => {
    event.stopPropagation()

    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } else {
      Haptics.selectionAsync()
    }

    const isLiked = recipe.isLiked

    if (!isLiked) {
      Animated.sequence([
        Animated.timing(heartScale, { toValue: 1.4, duration: 150, useNativeDriver: true }),
        Animated.spring(heartBounce, { toValue: 1, friction: 3, tension: 60, useNativeDriver: true }),
        Animated.timing(heartScale, { toValue: 1, duration: 100, useNativeDriver: true }),
      ]).start(() => heartBounce.setValue(0))
    } else {
      Animated.timing(heartScale, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        heartScale.setValue(1)
      })
    }

    onLikePress(recipe.id)
  }

  // --- HANDLE COPY LINK ---
  const handleCopyLink = useCallback(async (event: any) => {
    event.stopPropagation() // Prevent card expansion
    
    const oneLinkURL = `https://brew.onelink.me/hxaQ?af_xp=custom&pid=share_recipe&deep_link_value=${recipe.id}`;
    
    try {
      await Clipboard.setStringAsync(oneLinkURL)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setToastMessage("Link Copied!")
      setToastVisible(true)
    } catch (e) {
      console.error("Failed to copy link:", e)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setToastMessage("Error copying link.")
      setToastVisible(true)
    }
  }, [recipe.id])

  // --- HIDE TOAST ---
  const handleHideToast = useCallback(() => {
    setToastVisible(false)
  }, [])

  // Interpolated rotation for chevron
  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  })

  // Heart animation style
  const heartAnimatedStyle = {
    transform: [
      { scale: heartScale },
      {
        translateY: heartBounce.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, -6, 0],
        }),
      },
    ],
  }

  // Determine image source
  const imageSource = recipe.image_url ? { uri: recipe.image_url } : recipe.image

  // --- RENDER ---
  return (
    <>
      <TouchableWithoutFeedback onPress={toggleExpand}>
        <View style={styles.card}>
          {/* --- Image Section --- */}
          <View style={styles.imageContainer}>
            <Image source={imageSource} style={[styles.cardImage, { aspectRatio }]} resizeMode="cover" />
            {/* Reverted Gradient: Transparent top, dark bottom */}
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.8)"]}
              style={styles.gradient}
            />

            {/* --- Copy Link Button (Top Right) --- */}
            <TouchableOpacity style={styles.copyButton} onPress={handleCopyLink} activeOpacity={0.7}>
              <Link size={20} color="#FFF" strokeWidth={2.5} />
            </TouchableOpacity>

            {/* --- Header Overlaid on Image --- */}
            <View style={styles.cardHeaderContent}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {recipe.name}
              </Text>
              <View style={styles.headerRight}>
                <TouchableOpacity
                  style={[styles.likeButton, recipe.isLiked && styles.likeButtonActive]}
                  onPress={handleLike}
                  activeOpacity={0.7}
                >
                  <Animated.View style={heartAnimatedStyle} key={`heart-${recipe.isLiked ? "liked" : "unliked"}`}>
                    <Heart
                      size={18}
                      color={recipe.isLiked ? COLORS.accent : "#FFF"}
                      fill={recipe.isLiked ? COLORS.accent : "transparent"}
                      strokeWidth={2.5}
                    />
                  </Animated.View>
                  {recipe.likes !== undefined && (
                    <Text style={[styles.likeCount, recipe.isLiked && styles.likeCountActive]}>{recipe.likes}</Text>
                  )}
                </TouchableOpacity>
                <Animated.View style={{ transform: [{ rotate }] }}>
                  <ChevronDown size={24} color="#FFF" />
                </Animated.View>
              </View>
            </View>
          </View>

          {/* --- Expanded Content --- */}
          {expanded && (
            <View style={styles.expandedContent}>
              {/* Author Info */}
              {recipe.profileImage && recipe.nickname && (
                <View style={styles.authorSection}>
                  <Image source={recipe.profileImage} style={styles.authorImage} />
                  <View style={styles.authorInfo}>
                    <Text style={styles.authorName}>{recipe.nickname}</Text>
                    {recipe.date && <Text style={styles.postDate}>{recipe.date}</Text>}
                  </View>
                </View>
              )}

              {/* Ingredients */}
              {recipe.ingredients && recipe.ingredients.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Ingredients</Text>
                  {recipe.ingredients.map((ingredient, index) => (
                    <Text key={`ingredient-${index}`} style={styles.ingredient}>
                      • {ingredient}
                    </Text>
                  ))}
                </View>
              )}

              {/* Instructions */}
              {recipe.instructions && recipe.instructions.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Instructions</Text>
                  {recipe.instructions.map((instruction, index) => {
                    const cleanedInstruction = instruction.replace(/^\d+\.\s*/, "")
                    return (
                      <View key={`instruction-${index}`} style={styles.instruction}>
                        <Text style={styles.instructionNumber}>{index + 1}</Text>
                        <Text style={styles.instructionText}>{cleanedInstruction}</Text>
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>

      {/* Render your custom Toast */}
      <Toast
        message={toastMessage}
        isVisible={toastVisible}
        onHide={handleHideToast}
      />
    </>
  )
})

export default NewExpandableRecipeCard

// --- STYLES ---
const styles = StyleSheet.create({
  card: {
    borderRadius: 26,
    overflow: "hidden",
    backgroundColor: COLORS.background,
    marginBottom: 24,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.12, shadowRadius: 10 },
      android: { elevation: 6 },
    }),
  },
  imageContainer: {
    width: "100%",
    position: "relative",
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    maxHeight: MAX_IMAGE_HEIGHT,
  },
  cardImage: {
    width: "100%",
    height: undefined,
    backgroundColor: COLORS.surface,
  },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "50%", // Or "40%", adjust as visually appropriate
    justifyContent: "flex-end", // Align content (like header) to the bottom
  },
  copyButton: {
    position: "absolute",
    top: 12,
    right: 16,
    zIndex: 2,
    padding: 8,
    backgroundColor: "rgba(0, 0, 0, 0.3)", // Keep the background for the icon
    borderRadius: 20,
  },
  cardHeaderContent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 12,
  },
  cardTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: "bold",
    color: "#FFF",
    marginRight: 12,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  likeButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    minWidth: 60,
    justifyContent: "center",
  },
  likeButtonActive: {
    backgroundColor: "rgba(255,107,107,0.3)",
  },
  likeCount: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: "600",
    color: "#FFF",
  },
  likeCountActive: {
    color: COLORS.accent,
  },
  expandedContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
    backgroundColor: COLORS.background,
  },
  authorSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  authorImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
    backgroundColor: COLORS.surface,
  },
  authorInfo: {
    flex: 1,
  },
  authorName: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text.primary,
    marginBottom: 3,
  },
  postDate: {
    fontSize: 13,
    color: COLORS.text.secondary,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text.primary,
    marginBottom: 14,
  },
  ingredient: {
    fontSize: 15,
    color: COLORS.text.primary,
    marginBottom: 10,
    lineHeight: 22,
    paddingLeft: 4,
  },
  instruction: {
    flexDirection: "row",
    marginBottom: 16,
    alignItems: "flex-start",
  },
  instructionNumber: {
    width: 24,
    fontSize: 15,
    fontWeight: "bold",
    color: COLORS.accent,
    marginRight: 10,
    textAlign: "right",
    lineHeight: 22,
  },
  instructionText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text.primary,
    lineHeight: 22,
  },
})

