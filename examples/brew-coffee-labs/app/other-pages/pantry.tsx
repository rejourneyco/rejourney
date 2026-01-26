import React, { useState, useEffect } from "react";
import { 
  View, Text, StyleSheet, TextInput, 
  TouchableOpacity, FlatList, Alert, 
  KeyboardAvoidingView, Platform, StatusBar 
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { supabase } from "../../supabase"; // your Supabase client

type PantryItem = {
  id: string; // local ID or any unique ID
  name: string;
  type: "ingredient" | "equipment";
  brand?: string;
};

const Pantry = () => {
  const router = useRouter();

  // Local state
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const [newItem, setNewItem] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [itemType, setItemType] = useState<"ingredient" | "equipment">("ingredient");
  const [userUUID, setUserUUID] = useState<string | null>(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false); // Track unsaved changes

  useEffect(() => {
    fetchSessionAndPantry();
  }, []);

  useEffect(() => {
    setUnsavedChanges(true); // Mark as unsaved when pantryItems change
  }, [pantryItems]);

  /**
   * Fetch the current user from Supabase Auth
   * Then fetch the SINGLE row from `user_pantry` that holds their items.
   */
  const fetchSessionAndPantry = async () => {
    // 1) Get current user
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      Alert.alert("Error fetching user session");
      return;
    }
    const user = userData.user;
    setUserUUID(user.id);

    // 2) Fetch the single row from `user_pantry`
    //    This row contains a JSON array in the `items` column
    const { data, error } = await supabase
      .from("user_pantry")
      .select("items")
      .eq("user_uuid", user.id)
      .single(); // force a single-row result

    if (error) {
      // If no row found, you might get an error with code 406 or 400
      // That’s okay— it means we have to create one on save, or we’ll just treat it as empty.
      console.log("No existing pantry row found or other error:", error);
      setPantryItems([]);
      return;
    }

    if (data && data.items) {
      // data.items should be a JSON array. Convert or cast to PantryItem[]
      setPantryItems(data.items);
    } else {
      setPantryItems([]);
    }
  };

  /**
   * Handle adding a single item locally (no DB write yet).
   */
  const handleAddItem = () => {
    if (!newItem.trim()) {
      Alert.alert("Error", "Please enter a valid item.");
      return;
    }
    const newName = newItem.trim().toLowerCase();

    // Check if item with same name already exists
    const itemExists = pantryItems.some(
      (item) => item.name.toLowerCase() === newName
    );
    if (itemExists) {
      Alert.alert("Error", "This item is already in your pantry.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const newPantryItem: PantryItem = {
      id: Date.now().toString(),
      name: newItem.trim(),
      type: itemType,
      brand: newBrand.trim() || undefined,
    };

    setPantryItems((prev) => [...prev, newPantryItem]);
    setNewItem("");
    setNewBrand("");
  };

  /**
   * Remove from local state only.
   */
  const handleRemoveItem = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPantryItems((prev) => prev.filter((item) => item.id !== id));
  };

  /**
   * Helper to remove duplicates by item name (case-insensitive).
   * You can tweak this logic as needed.
   */
  const mergeAndRemoveDuplicates = (arrayA: PantryItem[], arrayB: PantryItem[]): PantryItem[] => {
    const merged = [...arrayA, ...arrayB];
    const uniqueMap = new Map<string, PantryItem>();

    for (const item of merged) {
      const key = item.name.trim().toLowerCase();
      // If you prefer to keep the brand from whichever is non-empty, you can
      // merge brand fields here. For simplicity, we just keep the first found.
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, item);
      }
    }
    return Array.from(uniqueMap.values());
  };

  /**
   * Save to DB:
   * - fetch existing items (so we can combine them with local items),
   * - remove duplicates,
   * - then upsert the single row with the final array.
   */
  const handleSave = async () => {
    if (!userUUID) {
      Alert.alert("Cannot save. User not logged in yet.");
      return;
    }

    const { data, error } = await supabase
      .from("user_pantry")
      .upsert(
        {
          user_uuid: userUUID,
          items: pantryItems,
        },
        { onConflict: "user_uuid" }
      )
      .single();

    if (error) {
      console.log("Error saving pantry:", error);
      Alert.alert("Error saving pantry", error.message);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Success", "Your pantry has been saved!");
    setUnsavedChanges(false); // Reset unsaved changes after saving
  };

  const handleBack = () => {
    if (unsavedChanges) {
      Alert.alert(
        "Unsaved Changes",
        "You have unsaved changes. Are you sure you want to exit?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Exit", onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  };

  const renderPantryItem = ({ item }: { item: PantryItem }) => (
    <View style={styles.pantryItem}>
      <View style={styles.itemInfo}>
        <Text style={styles.pantryItemText}>{item.name}</Text>
        {item.brand && <Text style={styles.brandText}>{item.brand}</Text>}
        <View
          style={[
            styles.typeTag,
            item.type === "ingredient" ? styles.ingredientTag : styles.equipmentTag,
          ]}
        >
          <Text style={styles.typeTagText}>
            {item.type === "ingredient" ? "Ingredient" : "Equipment"}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => handleRemoveItem(item.id)}
        style={styles.removeButton}
      >
        <Feather name="trash-2" size={18} color="#FF5A5F" />
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar barStyle="dark-content" />
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Pantry</Text>
      </View>
      
      <Text style={styles.headerSubtitle}>
        Setup to quickly load into the Coffee Labs.
      </Text>

      {/* Toggle between Ingredient & Equipment */}
      <View style={styles.typeSelector}>
        <TouchableOpacity 
          style={[
            styles.typeButton, 
            itemType === "ingredient" && styles.selectedTypeButton
          ]}
          onPress={() => setItemType("ingredient")}
        >
          <Text
            style={[
              styles.typeButtonText,
              itemType === "ingredient" && styles.selectedTypeButtonText
            ]}
          >
            Ingredient
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[
            styles.typeButton, 
            itemType === "equipment" && styles.selectedTypeButton
          ]}
          onPress={() => setItemType("equipment")}
        >
          <Text
            style={[
              styles.typeButtonText,
              itemType === "equipment" && styles.selectedTypeButtonText
            ]}
          >
            Equipment
          </Text>
        </TouchableOpacity>
      </View>

      {/* Input for Name */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={
            itemType === "ingredient" 
              ? "Add ingredient (e.g., Milk)" 
              : "Add equipment (e.g., Espresso Machine)"
          }
          placeholderTextColor="#888"
          value={newItem}
          onChangeText={setNewItem}
        />
      </View>

      {/* Input for Brand */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Brand name (optional)"
          placeholderTextColor="#888"
          value={newBrand}
          onChangeText={setNewBrand}
        />
        <TouchableOpacity
          style={styles.addButton}
          onPress={handleAddItem}
          activeOpacity={0.8}
        >
          <Feather name="check" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* List of pantry items */}
      <FlatList
        data={pantryItems}
        keyExtractor={(item) => item.id}
        renderItem={renderPantryItem}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="coffee" size={50} color="#CCCCCC" />
            <Text style={styles.emptyStateText}>Your pantry is empty</Text>
            <Text style={styles.emptyStateSubtext}>
              Add ingredients or equipment to get started!
            </Text>
          </View>
        }
      />

      {/* Save Button */}
      <TouchableOpacity
        style={styles.saveButton}
        onPress={handleSave}
        activeOpacity={0.8}
      >
        <Feather name="save" size={20} color="#FFFFFF" style={styles.saveIcon} />
        <Text style={styles.saveButtonText}>Save Pantry</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
};

export default Pantry;

/** Styles **/
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  backButton: {
    padding: 8,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333333",
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#666666",
    marginBottom: 20,
  },
  typeSelector: {
    flexDirection: "row",
    marginBottom: 16,
    borderRadius: 12,
    backgroundColor: "#F5F5F5",
    padding: 4,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  selectedTypeButton: {
    backgroundColor: "#6F4E37",
  },
  typeButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#666",
  },
  selectedTypeButtonText: {
    color: "#FFFFFF",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#333333",
  },
  addButton: {
    backgroundColor: "#6F4E37",
    marginLeft: 10,
    padding: 14,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  listContainer: {
    paddingBottom: 100,
  },
  pantryItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F9F9F9",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#6F4E37",
  },
  itemInfo: {
    flex: 1,
  },
  pantryItemText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#333333",
  },
  brandText: {
    fontSize: 14,
    color: "#666666",
    marginTop: 2,
  },
  typeTag: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
  },
  ingredientTag: {
    backgroundColor: "#E6F2FF",
  },
  equipmentTag: {
    backgroundColor: "#FFF0E6",
  },
  typeTagText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#555",
  },
  removeButton: {
    padding: 8,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 60,
    padding: 20,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#666666",
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 15,
    color: "#999999",
    marginTop: 8,
    textAlign: "center",
  },
  saveButton: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: "#6F4E37",
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  saveIcon: {
    marginRight: 8,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
});
