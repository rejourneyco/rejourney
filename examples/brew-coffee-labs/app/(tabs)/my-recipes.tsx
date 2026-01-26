import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  StatusBar,
  Platform,
  Animated,
  Easing,
  RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../../supabase.js";

// --- Skeleton Loader Component ---
const RecipeItemSkeleton = () => {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: 1300,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [animatedValue]);

  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-350, 350],
  });

  const backgroundColor = "#E1E9EE";
  const highlightColor = "#F2F8FC";

  return (
    <View style={[styles.cardContainer, { backgroundColor: backgroundColor, shadowColor: "#000", shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.91, shadowRadius: 4, elevation: 3 }]}>
      <MaskedView
      style={skeletonStyles.maskWrapper}
      maskElement={
        <View style={skeletonStyles.maskContainer}>
        <View style={skeletonStyles.imagePlaceholder} />
        <View style={skeletonStyles.contentPlaceholder}>
          <View style={skeletonStyles.titlePlaceholder} />
          <View style={skeletonStyles.metaPlaceholder} />
        </View>
        <View style={skeletonStyles.iconPlaceholder} />
        </View>
      }
      >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: backgroundColor }]} />
      <Animated.View
        style={[
        StyleSheet.absoluteFill,
        { transform: [{ translateX: translateX }] },
        ]}
      >
        <LinearGradient
        colors={[backgroundColor, highlightColor, highlightColor, backgroundColor]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        locations={[0, 0.3, 0.7, 1]}
        />
      </Animated.View>
      </MaskedView>
    </View>
  );
};

// --- Skeleton Styles ---
const skeletonStyles = StyleSheet.create({
  maskWrapper: { height: 160, width: '100%' },
  maskContainer: { backgroundColor: "transparent", height: '100%', width: '100%' },
  imagePlaceholder: { width: 120, height: 120, borderRadius: 12, backgroundColor: "#000", margin: 16 },
  contentPlaceholder: { position: 'absolute', top: 24, left: 152, right: 50 },
  titlePlaceholder: { height: 22, width: "80%", backgroundColor: "#000", borderRadius: 4, marginBottom: 12 },
  metaPlaceholder: { height: 14, width: "50%", backgroundColor: "#000", borderRadius: 4 },
  iconPlaceholder: { position: 'absolute', top: 16, right: 16, width: 24, height: 24, borderRadius: 12, backgroundColor: '#000' }
});

// --- Redesigned RecipeItem Component ---
const RecipeItem = ({ title, author, likes, date, image, authorPic, ingredients, instructions }) => {
  const [expanded, setExpanded] = useState(false);
  const [animation] = useState(new Animated.Value(0));

  const toggleExpand = () => {
    setExpanded((prev) => !prev);
    Animated.timing(animation, {
      toValue: expanded ? 0 : 1,
      duration: 300,
      easing: Easing.ease,
      useNativeDriver: false,
    }).start();
  };

  const animatedHeight = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 400],
  });

  const formatDate = (dateString) => {
    if (!dateString) return "Unknown";
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffTime = Math.abs(now - date);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
      const diffWeeks = Math.floor(diffDays / 7);
      const diffMonths = Math.floor(diffDays / 30);
      if (diffMonths > 0) return `${diffMonths}mo ago`;
      if (diffWeeks > 0) return `${diffWeeks}w ago`;
      if (diffDays > 0) return `${diffDays}d ago`;
      if (diffHours > 0) return `${diffHours}h ago`;
      return "Just now";
    } catch (e) {
      console.error("Date parsing error:", e);
      return "Unknown";
    }
  };

  const parsedIngredients = ingredients ? (typeof ingredients === "string" ? JSON.parse(ingredients) : ingredients) : [];
  const parsedInstructions = instructions ? (typeof instructions === "string" ? JSON.parse(instructions) : instructions) : [];

  return (
    <View style={styles.cardContainer}>
      <TouchableOpacity onPress={toggleExpand} activeOpacity={0.85}>
        <View style={styles.cardContent}>
          <Image
            source={{ uri: image || "https://via.placeholder.com/400x400.png?text=No+Image" }}
            style={styles.recipeImage}
            onError={(e) => console.log("Image load error:", e.nativeEvent.error)}
          />
          <View style={styles.recipeInfo}>
            <Text style={styles.recipeTitle} numberOfLines={2}>{title || "Untitled Recipe"}</Text>
            <View style={styles.recipeMetaRow}>
              <Image
                source={{ uri: authorPic || "https://randomuser.me/api/portraits/lego/1.jpg" }}
                style={styles.miniAuthorAvatar}
              />
              <Text style={styles.authorNameSmall} numberOfLines={1}>{author || "Unknown"}</Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.likeContainer}>
                <Feather name="heart" size={12} color="#FF6B6B" />
                <Text style={styles.statsText}>{likes || "0"}</Text>
              </View>
              <View style={styles.dateContainer}>
                <Feather name="clock" size={12} color="#888" />
                <Text style={styles.statsText}>{formatDate(date)}</Text>
              </View>
            </View>
          </View>
          <View style={styles.expandIconContainer}>
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#A0522D" />
          </View>
        </View>
      </TouchableOpacity>
      
      <Animated.View style={[styles.expandedSectionWrapper, { height: animatedHeight }]}>
        <ScrollView nestedScrollEnabled={true} style={{ flex: 1 }} contentContainerStyle={styles.expandedSection}>
          <View style={styles.sectionDivider} />
          
          <Text style={styles.sectionTitle}>Ingredients</Text>
          <View style={styles.ingredientsList}>
            {parsedIngredients.length > 0 ? (
              parsedIngredients.map((ingredient, index) => (
                <View key={`ing-${index}`} style={styles.ingredientItem}>
                  <View style={styles.bulletPoint} />
                  <Text style={styles.ingredientText}>{ingredient}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyDetailText}>No ingredients listed</Text>
            )}
          </View>
          
          <Text style={styles.sectionTitle}>Instructions</Text>
          <View style={styles.instructionsList}>
            {parsedInstructions.length > 0 ? (
              parsedInstructions.map((instruction, index) => (
                <View key={`ins-${index}`} style={styles.instructionItem}>
                  <Text style={styles.stepNumber}>{index + 1}.</Text>
                  <Text style={styles.instructionText}>{instruction}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyDetailText}>No instructions listed</Text>
            )}
          </View>
          
          <View style={{ height: 16 }} />
        </ScrollView>
      </Animated.View>
    </View>
  );
};

// --- Main Screen Component ---
const MyRecipesScreen = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [likedRecipes, setLikedRecipes] = useState([]);
  const [brewHistory, setBrewHistory] = useState<Array<{
    id: string;
    title: string;
    author: string | null;
    likes: string | null;
    date: string;
    image: string | null;
    authorPic: string | null;
    ingredients: any;
    instructions: any;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  // --- Core Fetching Logic (wrapped in useCallback) ---
  const fetchRecipes = useCallback(async (isRefresh = false) => {
    // Don't show initial skeleton on refresh, but clear previous errors
    if (!isRefresh) {
      setLoading(true);
    }
    setError(null);

    if (!currentUser) {
      console.log("fetchRecipes called without user.");
      setError("You need to be logged in to fetch recipes.");
      if (!isRefresh) setLoading(false);
      return;
    }

    try {
      // Fetch Liked Recipes
      const { data: likedData, error: likedError } = await supabase
        .from("recipe_likes")
        .select(`recipe_uuid, created_at, recipes!inner(
          uuid, title, ingredients, instructions, image_url, like_count, created_at, creator_uuid, 
          users:creator_uuid(name, profile_icon)
        )`)
        .eq("user_uuid", currentUser.id)
        .order('created_at', { ascending: false });

      if (likedError) throw likedError;

      const formattedLikedRecipes = likedData.map((item) => ({
        id: item.recipes.uuid,
        title: item.recipes.title,
        author: item.recipes.users?.name,
        likes: item.recipes.like_count?.toString(),
        date: item.created_at,
        image: item.recipes.image_url,
        authorPic: item.recipes.users?.profile_icon,
        ingredients: item.recipes.ingredients,
        instructions: item.recipes.instructions,
      }));
      setLikedRecipes(formattedLikedRecipes);

      // Fetch User's Own Recipes (Brew History)
      const { data: userRecipes, error: userRecipesError } = await supabase
        .from("recipes")
        .select(`uuid, title, ingredients, instructions, image_url, like_count, created_at, creator_uuid, 
          users:creator_uuid(name, profile_icon)`)
        .eq("creator_uuid", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (userRecipesError) throw userRecipesError;

      const formattedBrewHistory = userRecipes.map((recipe) => ({
        id: recipe.uuid,
        title: recipe.title,
        author: recipe.users?.name,
        likes: recipe.like_count?.toString(),
        date: recipe.created_at,
        image: recipe.image_url,
        authorPic: recipe.users?.profile_icon,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
      }));
      setBrewHistory(formattedBrewHistory);

    } catch (fetchError) {
      console.error("Error fetching recipes:", fetchError);
      setError(`Failed to fetch recipes. ${fetchError.message || 'Please check connection.'}`);
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, [currentUser]);

  // Fetch current user
  useEffect(() => {
    const fetchCurrentUser = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError && authError.message !== 'Auth session missing!') { throw authError; }
        if (user) {
          setCurrentUser(user);
        } else {
          console.log("User not authenticated");
          setError("You need to be logged in to see your recipes.");
          setCurrentUser(null);
          setLoading(false);
        }
      } catch (error) {
        console.error("Error fetching user:", error);
        setError("Failed to fetch user data");
        setCurrentUser(null);
        setLoading(false);
      }
    };
    fetchCurrentUser();
  }, []);

  // Effect to fetch recipes when user is available
  useEffect(() => {
    if (currentUser) {
      fetchRecipes(false);
    } else {
      setLikedRecipes([]);
      setBrewHistory([]);
      if (!loading && !error) {
        setError("You need to be logged in to see your recipes.");
      }
    }
  }, [currentUser, fetchRecipes]);

  // --- Refresh Handler ---
  const onRefresh = useCallback(async () => {
    if (!currentUser) {
      console.log("Refresh triggered without user.");
      setError("Please log in to refresh recipes.");
      setIsRefreshing(false);
      return;
    }
    console.log("Refreshing recipes...");
    setIsRefreshing(true);
    try {
      await fetchRecipes(true);
    } catch(e) {
      console.error("Error during refresh:", e);
    } finally {
      setIsRefreshing(false);
    }
  }, [currentUser, fetchRecipes]);

  const filterRecipes = (data) => {
    if (!data) return [];
    return data.filter(
      (recipe) =>
        recipe.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        recipe.author?.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  };

  // Retry Handler
  const handleRetry = () => {
    setError(null);
    setIsRefreshing(false);
    if (currentUser) {
      fetchRecipes(false);
    } else {
      const fetchCurrentUser = async () => {
        setLoading(true);
        setError(null);
        try {
          const { data: { user }, error: authError } = await supabase.auth.getUser();
          if (authError && authError.message !== 'Auth session missing!') throw authError;
          if (user) {
            setCurrentUser(user);
          } else {
            setError("You need to be logged in to see your recipes.");
            setLoading(false);
          }
        } catch (error) {
          console.error("Error fetching user on retry:", error);
          setError("Failed to fetch user data");
          setLoading(false);
        }
      };
      fetchCurrentUser();
    }
  };

  // --- Loading State ---
  if (loading && !isRefreshing) {
    return (
      <View style={screenStyles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <View style={screenStyles.header}>
          <Text style={screenStyles.headerTitle}>Recipes</Text>
        </View>
        <View style={screenStyles.searchContainer}>
          <View style={screenStyles.searchBar}>
            <Feather name="search" size={20} color="#AAA" style={screenStyles.searchIcon} />
            <TextInput
              style={[screenStyles.searchInput, { color: '#AAA' }]}
              placeholder="Loading recipes..."
              value={searchQuery}
              editable={false}
              placeholderTextColor="#AAA"
            />
          </View>
        </View>
        <ScrollView
          style={screenStyles.scrollContainer}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View style={screenStyles.section}>
            <View style={screenStyles.sectionHeader}>
              <View style={screenStyles.skeletonTitle} />
              <View style={screenStyles.skeletonSeeAll} />
            </View>
            {[1, 2].map((_, index) => (
              <RecipeItemSkeleton key={`liked-skeleton-${index}`} />
            ))}
          </View>
          <View style={screenStyles.section}>
            <View style={screenStyles.sectionHeader}>
              <View style={screenStyles.skeletonTitle} />
              <View style={screenStyles.skeletonSeeAll} />
            </View>
            {[1, 2].map((_, index) => (
              <RecipeItemSkeleton key={`history-skeleton-${index}`} />
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // --- Error State ---
  if (error && !isRefreshing) {
    return (
      <View style={[screenStyles.container, screenStyles.centered]}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <Feather name="alert-circle" size={48} color="#FF6B6B" />
        <Text style={screenStyles.errorText}>{error}</Text>
        <TouchableOpacity style={screenStyles.retryButton} onPress={handleRetry}>
          <Text style={screenStyles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Content State ---
  const filteredLiked = filterRecipes(likedRecipes);
  const filteredHistory = filterRecipes(brewHistory);

  return (
    <View style={screenStyles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={screenStyles.header}>
        <Text style={screenStyles.headerTitle}>Recipes</Text>
      </View>
      <View style={screenStyles.searchContainer}>
        <View style={screenStyles.searchBar}>
          <Feather name="search" size={20} color="#888" style={screenStyles.searchIcon} />
          <TextInput
            style={screenStyles.searchInput}
            placeholder="Find on page..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#888"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      <ScrollView
        style={screenStyles.scrollContainer}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#A0522D"
            colors={["#A0522D", "#C8A07F"]}
            progressBackgroundColor="#ffffff"
          />
        }
      >
        {error && isRefreshing && (
          <View style={screenStyles.inlineError}>
            <Text style={screenStyles.inlineErrorText}>Couldn't refresh: {error}</Text>
          </View>
        )}

        {/* Liked Recipes Section */}
        {filteredLiked.length > 0 || searchQuery === "" ? (
          <View style={screenStyles.section}>
            <View style={screenStyles.sectionHeader}>
              <Text style={screenStyles.sectionTitle}>Liked By Me</Text>
            </View>
            {filteredLiked.length > 0 ? (
              filteredLiked.map((recipe) => ( <RecipeItem key={`liked-${recipe.id}`} {...recipe} /> ))
            ) : ( searchQuery !== "" && <Text style={screenStyles.noResultsText}>No liked recipes match your search.</Text> )}
          </View>
        ) : null }
        {searchQuery === "" && likedRecipes.length === 0 && !loading && !error && (
          <View style={screenStyles.emptySection}>
            <Feather name="heart" size={48} color="#DDD" />
            <Text style={screenStyles.emptyText}>No liked recipes yet</Text>
            <Text style={screenStyles.emptySubtext}>Recipes you like will appear here</Text>
          </View>
        )}

        {/* Brew History Section */}
        {filteredHistory.length > 0 || searchQuery === "" ? (
          <View style={screenStyles.section}>
            <View style={screenStyles.sectionHeader}>
              <Text style={screenStyles.sectionTitle}>My Recipes / History</Text>
            </View>
            {filteredHistory.length > 0 ? (
              filteredHistory.map((recipe) => ( <RecipeItem key={`history-${recipe.id}`} {...recipe} /> ))
            ): ( searchQuery !== "" && <Text style={screenStyles.noResultsText}>No recipes in history match your search.</Text> )}
          </View>
        ) : null }
        {searchQuery === "" && brewHistory.length === 0 && !loading && !error && (
          <View style={screenStyles.emptySection}>
            <Feather name="coffee" size={48} color="#DDD" />
            <Text style={screenStyles.emptyText}>No recipe history yet</Text>
            <Text style={screenStyles.emptySubtext}>Recipes you create or brew will appear here</Text>
          </View>
        )}

        {/* General No Results */}
        {searchQuery !== "" && filteredLiked.length === 0 && filteredHistory.length === 0 && !loading && !error && (
          <View style={screenStyles.emptySection}>
            <Feather name="search" size={48} color="#DDD" />
            <Text style={screenStyles.emptyText}>No Recipes Found</Text>
            <Text style={screenStyles.emptySubtext}>Try adjusting your search query.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};


// --- Redesigned Styles ---
const styles = StyleSheet.create({
  // Card Container
  cardContainer: {
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: "#fff",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  
  // Card Content - Horizontal Layout
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  
  // Recipe Image
  recipeImage: {
    width: 90,
    height: 90,
    borderRadius: 12,
    backgroundColor: "#F0F0F0",
  },
  
  // Recipe Info
  recipeInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: "center",
  },
  
  recipeTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#333",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  
  recipeMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  
  miniAuthorAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginRight: 8,
    backgroundColor: "#E0E0E0",
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  
  authorNameSmall: {
    fontSize: 14,
    color: "#555",
    fontWeight: "500",
  },
  
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  
  likeContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 16,
    backgroundColor: '#FFF0F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  
  dateContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  
  statsText: {
    fontSize: 12,
    color: "#666",
    marginLeft: 4,
    fontWeight: "500",
  },
  
  expandIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F8F3EF",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  
  // Expanded Section
  expandedSectionWrapper: {
    backgroundColor: "#FCFCFC",
    overflow: "hidden",
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  
  expandedSection: {
    padding: 16,
  },
  
  sectionDivider: {
    height: 1,
    backgroundColor: "#EEEEEE",
    marginBottom: 16,
  },
  
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#A0522D",
    marginBottom: 12,
  },
  
  // Ingredients List
  ingredientsList: {
    marginBottom: 20,
  },
  
  ingredientItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  
  bulletPoint: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#C8A07F",
    marginTop: 6,
    marginRight: 10,
  },
  
  ingredientText: {
    flex: 1,
    fontSize: 15,
    color: "#444",
    lineHeight: 21,
  },
  
  // Instructions List
  instructionsList: {
    marginBottom: 8,
  },
  
  instructionItem: {
    flexDirection: "row",
    marginBottom: 14,
    paddingLeft: 4,
  },
  
  stepNumber: {
    fontSize: 15,
    fontWeight: "600",
    color: "#A0522D",
    width: 25,
    marginRight: 6,
  },
  
  instructionText: {
    flex: 1,
    fontSize: 15,
    color: "#444",
    lineHeight: 21,
  },
  
  emptyDetailText: {
    fontSize: 14,
    color: "#888",
    fontStyle: "italic",
    marginBottom: 12,
    textAlign: "center",
    paddingVertical: 8,
  },
});

// --- Screen Styles ---
const screenStyles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8F8F8' 
  },
  centered: { 
    justifyContent: "center", 
    alignItems: "center", 
    padding: 20 
  },
  header: { 
    paddingTop: Platform.OS === "ios" ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 15 : 40, 
    paddingBottom: 15, 
    paddingHorizontal: 20, 
    backgroundColor: '#F8F8F8' 
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: "#000",
    letterSpacing: -0.5,
  },
 searchContainer: {
     paddingHorizontal: 20,
     paddingBottom: 16, // Keep padding below search
     backgroundColor: '#F8F8F8', // Ensure search bg color
     zIndex: 5, // Keep search above content if needed
   },
   searchBar: {
     flexDirection: 'row',
     alignItems: 'center',
     backgroundColor: '#fff', // Keep white or use COLORS.surface
     borderRadius: 22,
     paddingHorizontal: 16,
     paddingVertical: Platform.OS === 'ios' ? 12 : 10, // Adjusted padding
     shadowColor: "#000",
     shadowOffset: { width: 0, height: 2 }, // Reduced shadow offset
     shadowOpacity: 0.08, // Reduced shadow opacity
     shadowRadius: 4, // Reduced shadow radius
     elevation: 2,
   },
   searchInput: {
     flex: 1,
     marginLeft: 12,
     fontSize: 16,
     color: '#1A1A1A', // Use primary text color
   },
  scrollContainer: { 
    flex: 1, 
    paddingHorizontal: 20 
  },
  section: { 
    marginBottom: 24 
  },
  sectionHeader: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center", 
    marginBottom: 12 
  },
  sectionTitle: { 
    fontSize: 18, 
    fontWeight: "700", 
    color: "#333" 
  },
  seeAllText: { 
    fontSize: 14, 
    color: "#A0522D", 
    fontWeight: "600" 
  },
  skeletonTitle: { 
    height: 18, 
    width: '45%', 
    backgroundColor: '#E1E9EE', 
    borderRadius: 4 
  },
  skeletonSeeAll: { 
    height: 14, 
    width: '18%', 
    backgroundColor: '#E1E9EE', 
    borderRadius: 4 
  },
  errorText: { 
    marginTop: 16, 
    fontSize: 16, 
    color: "#D32F2F", 
    textAlign: "center", 
    paddingHorizontal: 32, 
    lineHeight: 24 
  },
  retryButton: { 
    marginTop: 24, 
    paddingVertical: 12, 
    paddingHorizontal: 30, 
    backgroundColor: "#A0522D", 
    borderRadius: 25 
  },
  retryButtonText: { 
    color: "#FFF", 
    fontSize: 16, 
    fontWeight: "600" 
  },
  emptySection: { 
    alignItems: "center", 
    justifyContent: "center", 
    paddingVertical: 40, 
    paddingHorizontal: 20, 
    marginBottom: 24, 
    backgroundColor: "#FFF", 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#F0F0F0' 
  },
  emptyText: { 
    marginTop: 16, 
    fontSize: 17, 
    fontWeight: "600", 
    color: "#666", 
    textAlign: 'center' 
  },
  emptySubtext: { 
    marginTop: 6, 
    fontSize: 14, 
    color: "#999", 
    textAlign: 'center' 
  },
  noResultsText: { 
    fontSize: 15, 
    color: "#888", 
    textAlign: 'center', 
    marginTop: 10, 
    marginBottom: 10 
  },
  inlineError: {
    backgroundColor: '#FFF0F0',
    padding: 10,
    marginVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFC0C0',
  },
  inlineErrorText: {
    color: '#D8000C',
    textAlign: 'center',
    fontSize: 14,
  }
});

export default MyRecipesScreen;