"use client"

import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  StatusBar,
  RefreshControl,
  FlatList,
  Animated,
  Dimensions,
  ImageBackground,
  Easing,
  Linking,
  Alert,
  Button,
} from "react-native"
import Modal from "react-native-modal"
import * as Updates from "expo-updates"
import { Feather } from "@expo/vector-icons"
import FontAwesome5 from "react-native-vector-icons/FontAwesome5"
import { supabase } from "../../supabase.js"
import NewExpandableRecipeCard from "../../components/ui/NewExpandableRecipeCard"
import { router, useFocusEffect } from "expo-router"
import * as Haptics from "expo-haptics"
import { Camera } from "expo-camera"
import { formatDistanceToNow } from "date-fns"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { BlurView } from "expo-blur"

const { width } = Dimensions.get("window")

interface Recipe {
  id: string
  name: string
  nickname: string
  date: string
  likes: number
  isLiked: boolean
  profileImage: { uri: string }
  image: { uri: string }
  ingredients: string[]
  instructions: string[]
}

const Home = () => {
  // Animation values
  const scrollY = useRef(new Animated.Value(0)).current
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 50],
    outputRange: [1, 0.9],
    extrapolate: "clamp",
  })
  const headerTranslate = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [0, -10],
    extrapolate: "clamp",
  })
  const coffeeBtnScale = useRef(new Animated.Value(1)).current

  // Coffee Labs button animations
  const coffeeLabsOpacity = useRef(new Animated.Value(0)).current
  const coffeeIconRotate = useRef(new Animated.Value(0)).current
  const coffeeIconRotateInterpolate = coffeeIconRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  })
  const aiIconTranslateY = useRef(new Animated.Value(0)).current
  const scanIconTranslateX = useRef(new Animated.Value(0)).current

  // New animations
  const fadeAnim = useRef(new Animated.Value(1)).current
  const slideAnim = useRef(new Animated.Value(0)).current
  const categorySlideAnim = useRef(new Animated.Value(0)).current
  const logoRotate = useRef(new Animated.Value(0)).current
  const logoRotateInterpolate = logoRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  })

  // State management
  const [imageVersion, setImageVersion] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const [profileIcon, setProfileIcon] = useState<string>("")
  const [hasNotifications, setHasNotifications] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [trendingRecipes, setTrendingRecipes] = useState<Recipe[]>([])
  const [communityPicks, setCommunityPicks] = useState<Recipe[]>([])
  const [filteredRecipes, setFilteredRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [cameraPermission, setCameraPermission] = useState<boolean>(false)
  const [appConfig, setAppConfig] = useState<{
    maintenance_mode: boolean
    maintenance_message?: string
    required_version: string
  } | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false)

  // Safe area insets
  const insets = useSafeAreaInsets()

  // Staggered animations for recipe cards
  const recipeAnimations = useRef({
    trending: [new Animated.Value(1)],
    community: [new Animated.Value(1)],
  }).current

  // Animation functions
  const startEntryAnimations = () => {
    // Reset animations
    fadeAnim.setValue(0)
    slideAnim.setValue(20)
    categorySlideAnim.setValue(-20)

    // Start animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(categorySlideAnim, {
        toValue: 0,
        duration: 600,
        delay: 200,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start()

    // Start Coffee Labs button animations
    animateCoffeeLabsButton()
  }

  // New Coffee Labs button animations
  const animateCoffeeLabsButton = () => {
    // Reset animations
    coffeeLabsOpacity.setValue(0)
    coffeeIconRotate.setValue(0)
    aiIconTranslateY.setValue(10)
    scanIconTranslateX.setValue(-10)

    // Sequence of animations
    Animated.sequence([
      // Fade in and slide up the main button
      Animated.timing(coffeeLabsOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),

      // Animate the icons
      Animated.parallel([
        Animated.timing(coffeeIconRotate, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }),

        Animated.timing(aiIconTranslateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
          easing: Easing.out(Easing.back(1.7)),
        }),

        Animated.timing(scanIconTranslateX, {
          toValue: 0,
          duration: 400,
          delay: 100,
          useNativeDriver: true,
          easing: Easing.out(Easing.back(1.7)),
        }),
      ]),
    ]).start()
  }

  const animateLogoRotation = () => {
    Animated.timing(logoRotate, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
      easing: Easing.inOut(Easing.cubic),
    }).start(() => {
      logoRotate.setValue(0)
    })
  }

  const animateRecipeEntrance = (recipes: any[], animArray: Animated.Value[]) => {
    // Reset animation values first
    recipes.forEach((_, i) => {
      if (!animArray[i]) {
        animArray[i] = new Animated.Value(0)
      } else {
        animArray[i].setValue(0)
      }
    })

    const animations = recipes.map((_, i) => {
      return Animated.timing(animArray[i], {
        toValue: 1,
        duration: 400,
        delay: i * 150,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      })
    })

    Animated.stagger(100, animations).start()
  }

  // Data fetching functions
  const fetchTrendingRecipes = async () => {
    try {
      // Get date from 24 hours ago instead of start of today
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      const twentyFourHoursAgoISO = twentyFourHoursAgo.toISOString();

      // Fetch the most liked recipes created in the past 24 hours
      const { data: recentData } = await supabase
        .from("recipes")
        .select(
          "uuid, title, ingredients, instructions, image_url, created_at, like_count, creator_uuid, users (name, profile_icon)"
        )
        .eq("is_published", true)
        .gte("created_at", twentyFourHoursAgoISO)
        .order("like_count", { ascending: false })
        .limit(2);

      let combinedResults = recentData || [];

      // If no recipes are found in the past 24 hours, fetch the most recent recipes
      if (combinedResults.length < 2) {
        const { data: latestData } = await supabase
          .from("recipes")
          .select(
            "uuid, title, ingredients, instructions, image_url, created_at, like_count, creator_uuid, users (name, profile_icon)"
          )
          .eq("is_published", true)
          .order("created_at", { ascending: false })
          .limit(2 - combinedResults.length);

        combinedResults = [...combinedResults, ...(latestData || [])];
      }

      const formatted = await formatRecipes(combinedResults);
      setTrendingRecipes(formatted);
      animateRecipeEntrance(formatted, recipeAnimations.trending);
    } catch (error) {
      console.error("Error fetching trending recipes:", error);
    }
  }

  const fetchCommunityPicks = async () => {
    try {
      const { data } = await supabase
        .from("recipes")
        .select(
          "uuid, title, ingredients, instructions, image_url, created_at, like_count, creator_uuid, users (name, profile_icon)",
        )
        .eq("is_published", true)
        .order("like_count", { ascending: false })
        .limit(2)

      const formatted = await formatRecipes(data || [])
      setCommunityPicks(formatted);
      animateRecipeEntrance(formatted, recipeAnimations.community);
    } catch (error) {
      console.error("Error fetching community picks:", error);
    }
  }

  const fetchFilteredRecipes = async (category: string) => {
    try {
      setLoading(true)
      let query = supabase
        .from("recipes")
        .select(
          "uuid, title, ingredients, instructions, image_url, created_at, like_count, creator_uuid, users (name, profile_icon)",
        )
        .eq("is_published", true)

      if (category !== "all") {
        const searchTerm = `%${category}%`
        query = query.ilike("title", searchTerm)
      }

      const { data, error } = await query.order("like_count", { ascending: false }).limit(10)

      if (error) {
        console.error("Supabase query error:", error)
      }

      const formatted = await formatRecipes(data || [])
      setFilteredRecipes(formatted)
    } catch (error) {
      console.error("Error fetching filtered recipes:", error)
    } finally {
      setLoading(false)
    }
  }

  const formatRecipes = async (data: any[]) => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    let likedRecipeUuids = new Set<string>()
    if (user) {
      const { data: likesData } = await supabase.from("recipe_likes").select("recipe_uuid").eq("user_uuid", user.id)
      likedRecipeUuids = new Set(likesData?.map((l) => l.recipe_uuid) || [])
    }

    return data.map((recipe: any) => ({
      id: recipe.uuid,
      name: recipe.title,
      nickname: recipe.users?.name || "Anonymous",
      date: formatDistanceToNow(new Date(recipe.created_at), { addSuffix: true }),
      likes: recipe.like_count || 0,
      isLiked: likedRecipeUuids.has(recipe.uuid),
      profileImage: { uri: recipe.users?.profile_icon || "https://via.placeholder.com/150" },
      image: { uri: recipe.image_url || "https://via.placeholder.com/300" },
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
    }))
  }

  // UI interaction handlers
  const handleCategoryPress = useCallback(async (category: string) => {
    // Add haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    setActiveCategory(category)
    if (category === "all") {
      await fetchData()
    } else {
      await fetchFilteredRecipes(category)
    }
  }, [])

  const fetchData = async () => {
    setLoading(true)
    await Promise.all([fetchTrendingRecipes(), fetchCommunityPicks()])
    setLoading(false)

    // Only animate recipe cards after data is loaded
    if (!loading) {
      animateRecipeEntrance(trendingRecipes, recipeAnimations.trending)
      setTimeout(() => {
        animateRecipeEntrance(communityPicks, recipeAnimations.community)
      }, 300)
    }

    // Set initial loading to false after first data fetch
    if (initialLoading) {
      setInitialLoading(false)
    }
  }

  // FIXED: This is the key function that needs to be optimized
  const handleLikePress = async (recipeId: string) => {
    try {
      // Add haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/(tabs)/")
        return
      }

      // Find the recipe in all lists to determine current like state
      const findRecipe = (recipes: Recipe[]) => recipes.find((r) => r.id === recipeId)
      const trendingRecipe = findRecipe(trendingRecipes)
      const communityRecipe = findRecipe(communityPicks)
      const filteredRecipe = findRecipe(filteredRecipes)

      // Use the first found recipe to determine current like state
      const recipe = trendingRecipe || communityRecipe || filteredRecipe
      if (!recipe) return

      const currentlyLiked = recipe.isLiked
      const newLikeCount = currentlyLiked ? recipe.likes - 1 : recipe.likes + 1

      // Create a stable update function that we can reuse
      const updateRecipeInList = (list: Recipe[]) => {
        return list.map((r) => {
          if (r.id !== recipeId) return r

          // Create a new object reference for the updated recipe
          return {
            ...r,
            isLiked: !currentlyLiked,
            likes: newLikeCount,
          }
        })
      }

      // Update each list separately only if it contains the recipe
      if (trendingRecipe) {
        setTrendingRecipes((prev) => updateRecipeInList(prev))
      }

      if (communityRecipe) {
        setCommunityPicks((prev) => updateRecipeInList(prev))
      }

      if (filteredRecipe) {
        setFilteredRecipes((prev) => updateRecipeInList(prev))
      }

      // Make the API call to update the like status
      const { error } = await supabase.rpc("toggle_recipe_like", {
        user_uuid_arg: user.id,
        recipe_uuid_arg: recipeId,
      })

      if (error) {
        console.error("Error toggling like:", error)
        // If there's an error, revert the optimistic update
        const revertUpdate = (list: Recipe[]) => {
          return list.map((r) => {
            if (r.id !== recipeId) return r
            return {
              ...r,
              isLiked: currentlyLiked,
              likes: recipe.likes,
            }
          })
        }

        if (trendingRecipe) setTrendingRecipes((prev) => revertUpdate(prev))
        if (communityRecipe) setCommunityPicks((prev) => revertUpdate(prev))
        if (filteredRecipe) setFilteredRecipes((prev) => revertUpdate(prev))
      }
    } catch (err) {
      console.error("Like error:", err)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchData()
    setImageVersion((prev) => prev + 1)
    setRefreshing(false)

    // Animate logo rotation on refresh
    animateLogoRotation()

    // Restart entry animations
    startEntryAnimations()
  }

  const handleCoffeeLabsPress = async () => {
    // Scale animation
    Animated.sequence([
      Animated.timing(coffeeBtnScale, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(coffeeBtnScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start()

    // Trigger Coffee Labs scan
    // For testing ANRs in development
    if (__DEV__) {
      // Long press on Coffee Labs could be a secret trigger, but let's add a visible one for now or just use secret gesture?
      // Let's add a small button below.
    }

    // Rotate coffee icon
    Animated.timing(coffeeIconRotate, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
      easing: Easing.inOut(Easing.cubic),
    }).start(() => {
      coffeeIconRotate.setValue(0)
    })

    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

    if (!cameraPermission) {
      const { status } = await Camera.requestCameraPermissionsAsync()
      if (status !== "granted") {
        alert("Camera permission is required to use Coffee Labs")
        return
      }
      setCameraPermission(true)
    }

    router.push("/other-pages/coffee-scanner")
  }

  useFocusEffect(
    useCallback(() => {
      const checkAppStatus = async () => {
        console.log("Home Screen Focused: Checking app status...");
        try {
          const { data, error } = await supabase
            .from("app_config")
            .select("maintenance_mode, maintenance_message, required_version")
            .single()

          if (error) {
            console.error("Error fetching app config:", error)
            setAppConfig(null)
            setShowMaintenanceModal(false)
            setShowUpdateModal(false)
            return
          }

          if (data) {
            console.log("Fetched app config:", data)
            setAppConfig(data)

            if (data.maintenance_mode) {
              console.log("Maintenance mode is ON")
              setShowMaintenanceModal(true)
              setShowUpdateModal(false)
              return
            } else {
              setShowMaintenanceModal(false)
            }

            const currentVersion = "2.1.1"
            console.log(`Current version: ${currentVersion}, Required version: ${data.required_version}`)
            if (data.required_version > currentVersion) {
              console.log("Update required")
              setShowUpdateModal(true)
            } else {
              console.log("App is up to date")
              setShowUpdateModal(false)
            }
          } else {
            console.log("No app config data found")
            setAppConfig(null)
            setShowMaintenanceModal(false)
            setShowUpdateModal(false)
          }
        } catch (err) {
          console.error("Unexpected error in checkAppStatus:", err)
          setShowMaintenanceModal(false)
          setShowUpdateModal(false)
        }
      }

      checkAppStatus()

      return () => {
        console.log("Home Screen Unfocused")
      }
    }, [])
  )

  useEffect(() => {
    ; (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: userProfile } = await supabase.from("users").select("profile_icon").eq("uuid", user.id).single()

        if (userProfile?.profile_icon) {
          setProfileIcon(userProfile.profile_icon)
        }
      }
    })()
  }, [])

  useEffect(() => {
    animateCoffeeLabsButton()

    fetchData().then(() => {
      startEntryAnimations()
    })
  }, [])

  const renderProfilePicture = () => {
    if (profileIcon?.startsWith("http")) {
      return (
        <Image
          source={{ uri: `${profileIcon}?v=${imageVersion}` }}
          style={styles.profileImage}
          key={`profile-${imageVersion}`}
        />
      )
    } else if (profileIcon) {
      return <FontAwesome5 name={profileIcon} size={38} color="#444" />
    }
    return <Image source={{ uri: "https://via.placeholder.com/80" }} style={styles.profileImage} />
  }

  const categories = [
    { id: "all", name: "All" },
    { id: "Ice", name: "Iced Coffee" },
    { id: "latte", name: "Latte" },
    { id: "cold brew", name: "Cold Brew" },
    { id: "Espresso", name: "Espresso" },
  ]

  const renderSectionHeader = (title: string) => (
    <Animated.View
      style={[
        styles.sectionHeader,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <Text style={styles.sectionTitle}>{title}</Text>
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          router.push("/community")
        }}
        style={styles.seeAllButton}
      >
        <Text style={styles.seeAllText}>See all</Text>
      </TouchableOpacity>
    </Animated.View>
  )

  const renderModernSkeleton = () => (
    <View style={styles.modernSkeletonContainer}>
      <View style={styles.modernSkeletonHeader}>
        <View style={styles.modernSkeletonAvatar} />
        <View style={styles.modernSkeletonTextContainer}>
          <View style={styles.modernSkeletonTitle} />
          <View style={styles.modernSkeletonSubtitle} />
        </View>
      </View>
      <View style={styles.modernSkeletonImage} />
      <View style={styles.modernSkeletonFooter}>
        <View style={styles.modernSkeletonAction} />
        <View style={styles.modernSkeletonAction} />
      </View>
    </View>
  )

  const renderTrendingRecipes = useMemo(() => {
    return trendingRecipes.map((recipe, index) => (
      <Animated.View
        key={`trending-${recipe.id}`}
        style={{
          opacity: recipeAnimations.trending[index] || new Animated.Value(1),
          transform: [
            {
              translateY: (recipeAnimations.trending[index] || new Animated.Value(1)).interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0],
              }),
            },
          ],
        }}
      >
        <NewExpandableRecipeCard recipe={recipe} onLikePress={handleLikePress} />
      </Animated.View>
    ))
  }, [trendingRecipes, recipeAnimations.trending])

  const renderCommunityPicks = useMemo(() => {
    return communityPicks.map((recipe, index) => (
      <Animated.View
        key={`community-${recipe.id}`}
        style={{
          opacity: recipeAnimations.community[index] || new Animated.Value(1),
          transform: [
            {
              translateY: (recipeAnimations.community[index] || new Animated.Value(1)).interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0],
              }),
            },
          ],
        }}
      >
        <NewExpandableRecipeCard recipe={recipe} onLikePress={handleLikePress} />
      </Animated.View>
    ))
  }, [communityPicks, recipeAnimations.community])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Maintenance Modal */}
      <Modal
        isVisible={showMaintenanceModal}
        backdropOpacity={0.5}
        animationIn="zoomIn"
        animationOut="zoomOut"
        style={styles.modal}
        backdropTransitionOutTiming={0}
        onBackButtonPress={() => true}
      >
        <BlurView intensity={70} tint="dark" style={styles.blurModal}>
          <View style={styles.modalContent}>
            <Feather name="tool" size={40} color="#6F4E37" style={styles.modalIcon} />
            <Text style={styles.modalTitle}>Maintenance in Progress</Text>
            <Text style={styles.modalText}>
              {appConfig?.maintenance_message || "We're performing scheduled maintenance. Please check back soon."}
            </Text>
          </View>
        </BlurView>
      </Modal>

      {/* Update Modal */}
      <Modal
        isVisible={showUpdateModal}
        backdropOpacity={0.5}
        animationIn="zoomIn"
        animationOut="zoomOut"
        style={styles.modal}
        backdropTransitionOutTiming={0}
        onBackButtonPress={() => true}
      >
        <BlurView intensity={70} tint="dark" style={styles.blurModal}>
          <View style={styles.modalContent}>
            <Feather name="download" size={40} color="#6F4E37" style={styles.modalIcon} />
            <Text style={styles.modalTitle}>Update Available</Text>
            <Text style={styles.modalText}>
              A new version of BREW is available. Please update to continue using the app.
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                try {
                  await Linking.openURL("https://apps.apple.com/us/app/brew-coffee-labs/id6742522474")
                } catch (error) {
                  Alert.alert("Error", "Failed to open app store")
                }
              }}
            >
              <Text style={styles.modalButtonText}>Update Now</Text>
            </TouchableOpacity>
          </View>
        </BlurView>
      </Modal>

      {/* Animated Header */}
      <Animated.View
        style={[
          styles.header,
          {
            opacity: headerOpacity,
            transform: [{ translateY: headerTranslate }],
            paddingTop: insets.top > 0 ? 10 : 60,
          },
        ]}
      >
        <View style={styles.logoContainer}>
          <Animated.Text style={[styles.logoText, { transform: [{ rotate: logoRotateInterpolate }] }]}>
            BREW
          </Animated.Text>
          <Animated.View style={styles.logoAccent} />
        </View>
        <TouchableOpacity
          style={styles.profileButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            router.push("/(tabs)/profile")
          }}
        >
          {renderProfilePicture()}
        </TouchableOpacity>
      </Animated.View>

      <Animated.ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6F4E37" />}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
      >
        {/* Modernized Coffee Labs Button with home.jpg background - Original Size */}
        <Animated.View
          style={[
            {
              opacity: coffeeLabsOpacity,
              marginTop: 20,
              marginBottom: 14,
            },
          ]}
        >
          <TouchableOpacity activeOpacity={0.95} onPress={handleCoffeeLabsPress} style={styles.coffeeLabs}>
            <ImageBackground
              source={require("../../assets/images/home.jpg")}
              resizeMode="cover"
              style={styles.coffeeLabsImageBackground}
            >
              <BlurView intensity={5} tint="light" style={styles.blurContainer}>
                <View style={styles.coffeeLabsContent}>
                  <View style={styles.coffeeLabsTextContainer}>
                    <Text style={styles.coffeeLabsTitle}>Coffee Labs</Text>
                    <TouchableOpacity style={styles.tryNowButton} onPress={handleCoffeeLabsPress}>
                      <Text style={styles.tryNowText}>Let's Go</Text>
                      <Feather name="arrow-right" size={16} color="#6F4E37" style={styles.tryNowIcon} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.coffeeLabsIconsContainer}>
                    <Animated.View
                      style={[styles.coffeeIconCircle, { transform: [{ rotate: coffeeIconRotateInterpolate }] }]}
                    >
                      <Feather name="coffee" size={28} color="#6F4E37" />
                    </Animated.View>

                    <Animated.View style={[styles.aiIconCircle, { transform: [{ translateY: aiIconTranslateY }] }]}>
                      <Feather name="zap" size={24} color="#FFFFFF" />
                    </Animated.View>
                  </View>
                </View>
              </BlurView>
            </ImageBackground>
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.actionButtonsContainer}>
          <TouchableOpacity
            style={[styles.actionButton, styles.pantryButton]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/other-pages/pantry")
            }}
          >
            <Feather name="package" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Pantry</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.followButton]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              Linking.openURL('https://www.instagram.com/brewcoffeelabs/').catch(err => {
                console.error("Failed to open Instagram:", err);
                Alert.alert("Error", "Could not open Instagram. Please try again.");
              });
            }}
          >
            <Feather name="heart" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Social</Text>
          </TouchableOpacity>
        </View>

        {/* Recipe Content */}
        {loading ? (
          <>
            {renderSectionHeader("Today's Best")}
            {renderModernSkeleton()}
            {renderModernSkeleton()}
          </>
        ) : activeCategory === "all" ? (
          <>
            {renderSectionHeader("Today's Best")}
            {renderTrendingRecipes}

            {renderSectionHeader("Community Picks")}
            {renderCommunityPicks}
          </>
        ) : (
          <FlatList
            data={filteredRecipes}
            renderItem={({ item, index }) => (
              <Animated.View
                style={{
                  opacity: fadeAnim,
                  transform: [
                    {
                      translateY: slideAnim.interpolate({
                        inputRange: [0, 20],
                        outputRange: [0, 20 + index * 10],
                      }),
                    },
                  ],
                }}
              >
                <NewExpandableRecipeCard recipe={item} onLikePress={handleLikePress} />
              </Animated.View>
            )}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            style={styles.filteredList}
            ListEmptyComponent={
              <Animated.View
                style={[
                  styles.emptyState,
                  {
                    opacity: fadeAnim,
                  },
                ]}
              >
                <Feather name="coffee" size={50} color="#CCCCCC" />
                <Text style={styles.emptyStateText}>No recipes found</Text>
              </Animated.View>
            }
          />
        )}

        <View style={styles.bottomSpacing} />
      </Animated.ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F8F8",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 5,
    backgroundColor: "#F8F8F8",
    zIndex: 10,
  },
  logoContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  modal: {
    margin: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  blurModal: {
    width: "80%",
    borderRadius: 20,
    overflow: "hidden",
  },
  modalContent: {
    padding: 30,
    alignItems: "center",
  },
  modalIcon: {
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 15,
    textAlign: "center",
  },
  modalText: {
    fontSize: 16,
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 25,
    lineHeight: 22,
  },
  modalButton: {
    backgroundColor: "#6F4E37",
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 25,
    marginTop: 10,
  },
  modalButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },
  logoText: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "#222222",
  },
  logoAccent: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#6F4E37",
    marginLeft: 4,
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
  },

  coffeeLabs: {
    borderRadius: 34,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  coffeeLabsImageBackground: {
    borderRadius: 30,
    overflow: "hidden",
  },
  blurContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  coffeeLabsContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 24,
    paddingVertical: 26,
  },
  coffeeLabsTextContainer: {
    flex: 1,
  },
  coffeeLabsTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 14,
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  tryNowButton: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 3,
  },
  tryNowText: {
    color: "#6F4E37",
    fontWeight: "700",
    fontSize: 15,
  },
  tryNowIcon: {
    marginLeft: 8,
  },
  coffeeLabsIconsContainer: {
    alignItems: "center",
    marginRight: 5,
  },
  coffeeIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: -15,
    zIndex: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 4,
  },
  aiIconCircle: {
    width: 45,
    height: 45,
    borderRadius: 25,
    backgroundColor: "#D4A574",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 25,
    zIndex: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  scanIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#8C6D4F",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 25,
    marginTop: -15,
    zIndex: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },

  actionButtonsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
    marginBottom: 14,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    flex: 1,
    marginHorizontal: 5,
  },
  pantryButton: {
    backgroundColor: "#6F4E37",
  },
  followButton: {
    backgroundColor: "#D4A574",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
    marginLeft: 8,
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 19,
    marginTop: 10,
    shadowColor: "#000",
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.01,
    paddingHorizontal: 5,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#222222",
  },
  seeAllButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  seeAllText: {
    fontSize: 14,
    color: "#6F4E37",
    fontWeight: "600",
  },

  filteredList: {
    marginTop: 16,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    marginTop: 20,
  },
  emptyStateText: {
    marginTop: 12,
    fontSize: 16,
    color: "#999999",
    textAlign: "center",
  },
  bottomSpacing: {
    height: 100,
  },

  modernSkeletonContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  modernSkeletonHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  modernSkeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F0F0F0",
    marginRight: 12,
  },
  modernSkeletonTextContainer: {
    flex: 1,
  },
  modernSkeletonTitle: {
    height: 18,
    width: "70%",
    backgroundColor: "#F0F0F0",
    borderRadius: 4,
    marginBottom: 8,
  },
  modernSkeletonSubtitle: {
    height: 14,
    width: "40%",
    backgroundColor: "#F0F0F0",
    borderRadius: 4,
  },
  modernSkeletonImage: {
    height: 200,
    width: "100%",
    backgroundColor: "#F0F0F0",
    borderRadius: 8,
    marginBottom: 16,
  },
  modernSkeletonFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  modernSkeletonAction: {
    height: 32,
    width: "30%",
    backgroundColor: "#F0F0F0",
    borderRadius: 16,
  },
})

export default Home

