"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  StatusBar,
  Platform,
  RefreshControl,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Search, Plus } from "lucide-react-native";
import NewExpandableRecipeCard from "@/components/ui/NewExpandableRecipeCard";
import RecipeSkeleton from "@/components/ui/recipe-skeleton";
import { supabase } from "@/supabase";
import { formatDistanceToNow } from "date-fns";
import { Recipe } from "@/types";
import * as Haptics from "expo-haptics";
import appsFlyer from 'react-native-appsflyer';

// -----------------------------------------------------------------------------
// CONSTANTS
// -----------------------------------------------------------------------------
const COLORS = {
  primary: "#1A1A1A",
  accent: "#FF6B6B",
  background: "#FFFFFF",
  surface: "#F9F9F9",
  border: "#EEEEEE",
  text: {
    primary: "#1A1A1A",
    secondary: "#666666",
    tertiary: "#999999",
  },
};

const LIMIT = 15;
const FILTERS = [
  "trending",
  "latest",
  "popular",
  "Iced",
  "Latte",
  "Mocha",
  "Espresso",
  "Cappuccino",
  "Links", // new filter always last
];

// -----------------------------------------------------------------------------
// COMPONENT
// -----------------------------------------------------------------------------
export default function CommunityPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ recipeId?: string; deep_link_value?: string }>();

  // ----- refs -----
  const flatListRef = useRef<FlatList<Recipe>>(null);
  const filterScrollViewRef = useRef<ScrollView>(null);
  const [targetRecipeId, setTargetRecipeId] = useState<string | null>(
    params.recipeId ?? null
  );
  
  // ----- state -----
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(
    params.recipeId ? 'Links' : 'trending'
  );  
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchDebounce, setSearchDebounce] = useState<NodeJS.Timeout | null>(
    null
  );
  // id of recipe that arrived from a deep‑link (persist for this session)
  const [linkRecipeId, setLinkRecipeId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // HANDLE DEEP‑LINK PARAM CHANGES
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Use deep_link_value consistent with AppsFlyer and link generation
    const linkValue = params.deep_link_value ?? params.recipeId; // Keep recipeId as fallback? Or remove entirely if deep_link_value is always used.
    if (linkValue) {
      setLinkRecipeId(linkValue);
      setActiveFilter("Links");
      // Ensure targetRecipeId is also set here if needed immediately
      setTargetRecipeId(linkValue);
    }
  }, [params.deep_link_value, params.recipeId]); // Watch both potential params


  // ---------------------------------------------------------------------------
  // MAIN FETCH FUNCTION
  // ---------------------------------------------------------------------------
  // --- FETCH RECIPES ----------------------------------------------------------
  const fetchRecipes = useCallback(
    async (
      reset: boolean = false,
      // Use targetRecipeId state which should be set by either useEffect hook
      searchTargetId: string | null = targetRecipeId
    ) => {
      /* ----------------------------------------------------------------------
         0.  Guard – don’t start a second fetch unless we’re doing a hard reset
      ---------------------------------------------------------------------- */
      if (loading && !reset) {
        console.log('Fetch skipped, already loading.');
        return;
      }

      /* ----------------------------------------------------------------------
         1.  Handle the “Links” filter FIRST so deep‑linked posts show instantly
      ---------------------------------------------------------------------- */
      if (activeFilter === 'Links') {
        setLoading(true);

        // No recipeId?  Nothing to display – clear list and stop.
        if (!searchTargetId) {
          setRecipes([]);
          setHasMore(false);
          setLoading(false);
          if (reset) setRefreshing(false);
          return;
        }

        try {
          // Get current user (for like‑state)
          const {
            data: { user },
          } = await supabase.auth.getUser();

          let liked = false;
          if (user) {
            const { data: likesData } = await supabase
              .from('recipe_likes')
              .select('recipe_uuid')
              .eq('user_uuid', user.id)
              .eq('recipe_uuid', searchTargetId)
              .single();
            liked = !!likesData;
          }

          // Fetch that one recipe
          const { data: r, error } = await supabase
            .from('recipes')
            .select(
              `
                uuid, title, ingredients, instructions, image_url,
                created_at, like_count, users (name, profile_icon)
              `
            )
            .eq('uuid', searchTargetId)
            .eq('is_published', true)
            .single();

          if (error) throw error;
          if (!r) throw new Error('Recipe not found');

          setRecipes([
            {
              id: r.uuid,
              name: r.title,
              nickname: r.users?.name || 'Anonymous',
              date: formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
              likes: r.like_count || 0,
              isLiked: liked,
              profileImage: { uri: r.users?.profile_icon || 'https://via.placeholder.com/150' },
              image: { uri: r.image_url || 'https://via.placeholder.com/300' },
              ingredients: r.ingredients,
              instructions: r.instructions,
            },
          ]);

          setHasMore(false);     // Links page never paginates
          setTargetRecipeId(null); // Clear after showing
        } catch (err: any) {
          console.error('Links fetch error:', err);
          setError(`Failed to load linked recipe: ${err.message || 'Unknown error'}`);
          setRecipes([]);
          setHasMore(false);
        }

        setLoading(false);
        if (reset) setRefreshing(false);
        return; // ← finished “Links” branch
      }

      /* ----------------------------------------------------------------------
         2.  Normal feeds (trending / latest / popular / tag‑filters)
      ---------------------------------------------------------------------- */
      try {
        if (reset) {
          setPage(0);
          setHasMore(true);
        }
        setLoading(true);
        setError(null);

        const currentPage = reset ? 0 : page;
        const offset = currentPage * LIMIT;

        // Current user – needed for like‑state later
        const {
          data: { user },
        } = await supabase.auth.getUser();

        /* --- Build the base query shared by all non‑Links filters --------- */
        let finalData: any[] = [];
        let query = supabase
          .from('recipes')
          .select(
            `
              uuid, title, ingredients, instructions, image_url,
              created_at, like_count, users (name, profile_icon)
            `
          )
          .eq('is_published', true);

        if (activeFilter.toLowerCase() === 'trending') {
          /* ---------- TRENDING (same logic you already had) -------------- */
          query = query.ilike('title', `%${searchQuery}%`);
          const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

          // Count recent
          const { count: recentTotal = 0 } = await supabase
            .from('recipes')
            .select('uuid', { count: 'exact', head: true })
            .eq('is_published', true)
            .gte('created_at', twelveHoursAgo)
            .ilike('title', `%${searchQuery}%`);

          if (offset < recentTotal) {
            // Pull from recent
            const limit = Math.min(LIMIT, recentTotal - offset);
            const { data: recentData, error: recentErr } = await supabase
              .from('recipes')
              .select(
                `
                  uuid, title, ingredients, instructions, image_url,
                  created_at, like_count, users (name, profile_icon)
                `
              )
              .eq('is_published', true)
              .gte('created_at', twelveHoursAgo)
              .ilike('title', `%${searchQuery}%`)
              .order('like_count', { ascending: false })
              .range(offset, offset + limit - 1);

            if (recentErr) throw recentErr;
            finalData = recentData || [];

            if (finalData.length < LIMIT) {
              // top‑up with older
              const olderNeed = LIMIT - finalData.length;
              const { data: olderData, error: olderErr } = await supabase
                .from('recipes')
                .select(
                  `
                    uuid, title, ingredients, instructions, image_url,
                    created_at, like_count, users (name, profile_icon)
                  `
                )
                .eq('is_published', true)
                .lt('created_at', twelveHoursAgo)
                .ilike('title', `%${searchQuery}%`)
                .order('like_count', { ascending: false })
                .range(0, olderNeed - 1);

              if (olderErr) throw olderErr;
              finalData = [...finalData, ...(olderData || [])];
            }
          } else {
            // Only older items
            const olderOffset = offset - recentTotal;
            const { data: olderData, error: olderErr } = await supabase
              .from('recipes')
              .select(
                `
                  uuid, title, ingredients, instructions, image_url,
                  created_at, like_count, users (name, profile_icon)
                `
              )
              .eq('is_published', true)
              .lt('created_at', twelveHoursAgo)
              .ilike('title', `%${searchQuery}%`)
              .order('like_count', { ascending: false })
              .range(olderOffset, olderOffset + LIMIT - 1);

            if (olderErr) throw olderErr;
            finalData = olderData || [];
          }
        } else if (activeFilter.toLowerCase() === 'latest') {
          const { data, error } = await query
            .ilike('title', `%${searchQuery}%`)
            .order('created_at', { ascending: false })
            .range(offset, offset + LIMIT - 1);
          if (error) throw error;
          finalData = data;
        } else if (activeFilter.toLowerCase() === 'popular') {
          const { data, error } = await query
            .ilike('title', `%${searchQuery}%`)
            .order('like_count', { ascending: false })
            .range(offset, offset + LIMIT - 1);
          if (error) throw error;
          finalData = data;
        } else {
          // tag filter (Iced, Latte, etc.)
          const { data, error } = await query
            .ilike('title', `%${activeFilter}%`)
            .order('created_at', { ascending: false })
            .range(offset, offset + LIMIT - 1);
          if (error) throw error;
          finalData = data;
        }

        /* --- Build like‑state map ---------------------------------------- */
        let likedUuids = new Set<string>();
        if (user) {
          const { data: likesData } = await supabase
            .from('recipe_likes')
            .select('recipe_uuid')
            .eq('user_uuid', user.id);
          likedUuids = new Set(likesData?.map((l) => l.recipe_uuid) || []);
        }

        /* --- Transform ---------------------------------------------------- */
        const newlyFetched: Recipe[] = (finalData || []).map((r) => ({
          id: r.uuid,
          name: r.title,
          nickname: r.users?.name || 'Anonymous',
          date: formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
          likes: r.like_count || 0,
          isLiked: likedUuids.has(r.uuid),
          profileImage: { uri: r.users?.profile_icon || 'https://via.placeholder.com/150' },
          image: { uri: r.image_url || 'https://via.placeholder.com/300' },
          ingredients: r.ingredients,
          instructions: r.instructions,
        }));

        /* --- Merge / replace into state ---------------------------------- */
        if (reset) {
          setRecipes(newlyFetched);
        } else {
          const unique = newlyFetched.filter(
            (n) => !recipes.some((e) => e.id === n.id)
          );
          if (unique.length) setRecipes((prev) => [...prev, ...unique]);
        }

        setHasMore(newlyFetched.length >= LIMIT);
        if (reset) setPage(1);
        else if (newlyFetched.length >= LIMIT) setPage((p) => p + 1);
      } catch (err: any) {
        console.error('Fetch error:', err);
        setError(`Failed to fetch recipes: ${err.message || 'Unknown error'}`);
        setHasMore(false);
      } finally {
        setLoading(false);
        if (reset) setRefreshing(false);
      }
    },
    // dependencies
    [activeFilter, searchQuery, targetRecipeId, page, loading]
  );

  // ---------------------------------------------------------------------------
  // LIKE TOGGLE HANDLER
  // ---------------------------------------------------------------------------
  const handleLikePress = async (recipeId: string) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/(tabs)/");
        return;
      }

      setRecipes((prev) =>
        prev.map((recipe) => {
          if (recipe.id === recipeId) {
            const newIsLiked = !recipe.isLiked;
            return {
              ...recipe,
              isLiked: newIsLiked,
              likes: newIsLiked
                ? recipe.likes + 1
                : Math.max(0, recipe.likes - 1),
            };
          }
          return recipe;
        })
      );

      const { error: rpcErr } = await supabase.rpc("toggle_recipe_like", {
        user_uuid_arg: user.id,
        recipe_uuid_arg: recipeId,
      });
      if (rpcErr) throw rpcErr;
    } catch (err) {
      console.error(err);
    }
  };

  // ---------------------------------------------------------------------------
  // ADD POST NAVIGATION
  // ---------------------------------------------------------------------------
  const handleAddButtonPress = () => {
    router.push("/other-pages/add-post");
  };

  // ---------------------------------------------------------------------------
  // FILTER CHANGE
  // ---------------------------------------------------------------------------
  const handleFilterChange = useCallback((filter: string) => {
    setPage(0);
    setActiveFilter(filter);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // ---------------------------------------------------------------------------
  // LOAD/REFRESH EFFECTS
  // ---------------------------------------------------------------------------
  useFocusEffect(
    React.useCallback(() => {
      fetchRecipes(true);
    }, [activeFilter])
  );

  useEffect(() => {
    if (searchDebounce) clearTimeout(searchDebounce);
    const timeout = setTimeout(() => fetchRecipes(true), 500);
    setSearchDebounce(timeout);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  // ---------------------------------------------------------------------------
  // REFRESH & PAGINATION
  // ---------------------------------------------------------------------------
  const onRefresh = () => {
    setRefreshing(true);
    fetchRecipes(true);
  };

  const loadMore = () => {
    if (!loading && hasMore && activeFilter.toLowerCase() !== "links") {
      fetchRecipes();
    }
  };

  // ---------------------------------------------------------------------------
  // RENDERERS
  // ---------------------------------------------------------------------------
  const renderRecipe = ({ item }: { item: Recipe }) => (
    <NewExpandableRecipeCard
      recipe={item}
      onLikePress={() => handleLikePress(item.id)}
    />
  );

  const renderSkeletons = (count = 3) =>
    Array(count)
      .fill(0)
      .map((_, idx) => <RecipeSkeleton key={`skeleton-${idx}`} />);

  const FilterHeaderComponent = useMemo(() => (
    <ScrollView
      ref={filterScrollViewRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filtersContainer}
    >
      {FILTERS.map((filter) => (
        <TouchableOpacity
          key={filter}
          style={[
            styles.filterButton,
            activeFilter.toLowerCase() === filter.toLowerCase() &&
              styles.filterButtonActive,
          ]}
          onPress={() => handleFilterChange(filter)}
        >
          <Text
            style={[
              styles.filterText,
              activeFilter.toLowerCase() === filter.toLowerCase() &&
                styles.filterTextActive,
            ]}
          >
            {filter.charAt(0).toUpperCase() + filter.slice(1)}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  ), [activeFilter]);

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>
        {searchQuery
          ? `No recipes found for "${searchQuery}"`
          : `No ${activeFilter} recipes found.`}
      </Text>
      {error && <Text style={styles.errorTextSmall}>{error}</Text>}
      <TouchableOpacity onPress={onRefresh} style={styles.retryButton}>
        <Text style={styles.retryText}>Try refreshing</Text>
      </TouchableOpacity>
    </View>
  );

  const renderLoadingFooter = () => {
    if (!loading || !hasMore) return null;
    return <View style={{ paddingVertical: 10 }}>{renderSkeletons(2)}</View>;
  };

  // ---------------------------------------------------------------------------
  // MAIN RETURN
  // ---------------------------------------------------------------------------
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <TouchableOpacity style={styles.addButton} onPress={handleAddButtonPress}>
          <Plus size={22} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={18} color={COLORS.text.tertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search recipes..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={COLORS.text.tertiary}
            returnKeyType="search"
          />
        </View>
      </View>

      {/* Feed */}
      <FlatList
        ref={flatListRef}
        data={recipes}
        renderItem={renderRecipe}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={FilterHeaderComponent}
        ListEmptyComponent={!loading ? renderEmptyState : null}
        ListFooterComponent={renderLoadingFooter}
        onEndReached={loadMore}
        onEndReachedThreshold={0.7}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

// -----------------------------------------------------------------------------
// STYLES
// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F0F0F0",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 15,
    backgroundColor: "#F0F0F0",
    zIndex: 10,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: "700",
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "#F0F0F0",
    zIndex: 5,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: COLORS.text.primary,
  },
  filtersContainer: {
    paddingHorizontal: 5,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F0F0",
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterButtonActive: {
    backgroundColor: "#000",
    borderColor: "#222831",
  },
  filterText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text.secondary,
  },
  filterTextActive: {
    color: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 15,
    paddingBottom: 40,
  },
  emptyState: {
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 50,
    paddingHorizontal: 20,
  },
  emptyStateText: {
    color: COLORS.text.secondary,
    fontSize: 16,
    textAlign: "center",
  },
  errorTextSmall: {
    color: COLORS.text.secondary,
    fontSize: 14,
    textAlign: "center",
    marginVertical: 10,
  },
  retryButton: {
    marginTop: 15,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
  },
  retryText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: "600",
  },
});
