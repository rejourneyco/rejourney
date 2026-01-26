import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  StatusBar,
  KeyboardAvoidingView,
  Modal,
  ActivityIndicator,
  Dimensions,
  Image, // Keep for Image.getSize
} from 'react-native';

import { Plus, X, ArrowLeft, Camera } from 'lucide-react-native';
import { Stack, useRouter } from 'expo-router';
import { supabase } from '../../supabase.js'; // Your Supabase client
import * as ImagePicker from 'expo-image-picker';
import { getCurrentSupabaseToken } from '../../authUtils'; // Still needed for upload
import uuid from 'react-native-uuid';
// --- Remove direct Gemini imports ---
// import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import * as FileSystem from 'expo-file-system'; // Keep for image processing
// import Config from 'react-native-config'; // Remove if GEMINI_API_KEY was the only thing used

// --- Keep ExpoImage and ImageManipulator imports ---
import { Image as ExpoImage } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';

// --- Constants (Unchanged) ---
const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_PREVIEW_HEIGHT = SCREEN_HEIGHT * 0.6;
const PREVIEW_RESIZE_WIDTH = Math.min(SCREEN_WIDTH * 1.5, 1024);
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://your-worker-name.your-subdomain.workers.dev'; // Upload worker URL

// --- Remove direct Gemini Configuration ---
// let model: any = null;
// try { ... } catch { ... }

// --- Define the Request Body Type for Edge Function (Recipe) ---
// Matches the interface defined in the Edge Function
interface RecipeValidationClientRequest {
  type: "recipe";
  recipeText: string;
  imageBase64?: string;
  mimeType?: string;
}


const AddPostScreen = () => {
  console.log('AddPostScreen: Component rendering or re-rendering.');

  const router = useRouter();
  const [title, setTitle] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageWidth, setImageWidth] = useState<number | null>(null);
  const [imageHeight, setImageHeight] = useState<number | null>(null);
  const [originalImageUri, setOriginalImageUri] = useState<string | null>(null);
  const [originalImageWidth, setOriginalImageWidth] = useState<number | null>(null);
  const [originalImageHeight, setOriginalImageHeight] = useState<number | null>(null);
  const [ingredients, setIngredients] = useState<string[]>(['']);
  const [instructions, setInstructions] = useState<string[]>(['']);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Publishing...');

  // Debug Log state changes (Unchanged)
  useEffect(() => {
    console.log(`AddPostScreen State Update: isLoading: ${isLoading}, previewUri: ${imageUri ? 'Exists' : 'null'}, prevW: ${imageWidth}, prevH: ${imageHeight}, origUri: ${originalImageUri ? 'Exists' : 'null'}, origW: ${originalImageWidth}, origH: ${originalImageHeight}`);
  }, [isLoading, imageUri, imageWidth, imageHeight, originalImageUri, originalImageWidth, originalImageHeight]);


  // --- NEW: Validation Function using Supabase Edge Function ---
  const validateContentWithEdgeFunction = async (): Promise<{ isValid: boolean; reason: string | null }> => {
    console.log("AddPostScreen: Starting Edge Function validation for recipe.");
    // setLoadingMessage('Validating content...'); // Message set by handlePublish

    // 1. Prepare Text Content
    const recipeText = `Recipe Title: ${title}\nIngredients: ${ingredients.filter(i => i.trim()).join(', ')}\nInstructions: ${instructions.filter(s => s.trim()).map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

    // 2. Prepare Image Data (using originalImageUri)
    let imageBase64: string | undefined = undefined;
    let mimeType: string | undefined = undefined;

    if (originalImageUri) {
      console.log("AddPostScreen: Processing ORIGINAL image for Edge Function validation...");
      try {
        const fileInfo = await FileSystem.getInfoAsync(originalImageUri);
        if (!fileInfo.exists) {
          console.error("AddPostScreen: Original image file not found for validation:", originalImageUri);
          return { isValid: false, reason: 'Original image file not found.' };
        }
        imageBase64 = await FileSystem.readAsStringAsync(originalImageUri, { encoding: FileSystem.EncodingType.Base64 });
        const fileExtension = originalImageUri.split('.').pop()?.toLowerCase();
        mimeType = 'image/jpeg'; // Default
        if (fileExtension === 'png') mimeType = 'image/png';
        else if (fileExtension === 'webp') mimeType = 'image/webp';
        else if (fileExtension === 'heic') mimeType = 'image/heic';
        else if (fileExtension === 'heif') mimeType = 'image/heif';
        console.log(`AddPostScreen: Original Image MIME type determined as: ${mimeType}`);
        console.log("AddPostScreen: Original image processed successfully for validation.");
      } catch (error) {
        console.error('AddPostScreen: Error processing original image for validation:', error);
        return { isValid: false, reason: 'Could not process image for validation.' };
      }
    } else {
      console.log("AddPostScreen: No image provided for validation.");
    }

    // 3. Prepare Payload for Edge Function
    const payload: RecipeValidationClientRequest = {
      type: "recipe", // Set the type for the Edge Function router
      recipeText: recipeText,
      ...(imageBase64 && { imageBase64 }), // Conditionally add image data
      ...(mimeType && { mimeType }),
    };

    // 4. Call Supabase Edge Function
    try {
      console.log("Invoking Supabase Edge Function 'gemini-validation-proxy' for recipe...");

      // Use supabase.functions.invoke - automatically handles auth
      const { data, error } = await supabase.functions.invoke(
        'gemini-validation-proxy', // Ensure this matches your deployed function name
        { body: payload }
      );

      // 5. Handle Response (Consistent with ProfileScreen)
      if (error) {
        console.error('Supabase Function invocation error:', error);
        let reason = 'Validation check failed (Function error).';
        if (error.message) {
          try {
            const errorJson = JSON.parse(error.message);
            reason = errorJson.error || errorJson.message || reason;
          } catch {
            reason = error.message; // Use raw message if not JSON
          }
        }
        // Check for specific error types if needed
        if (error.message.includes('authorization')) {
            reason = 'Authentication failed. Please log in again.';
        } else if (error.message.toLowerCase().includes('blocked by policy') || error.message.includes('400')) {
             // Handle 400 errors from the function (e.g., Gemini blocking)
             reason = data?.reason || reason || "Content blocked by policy."; // Try to get reason from data if available
        }
        return { isValid: false, reason: reason };
      }

      // Check the structure of the data returned
      if (typeof data?.isValid !== 'boolean') {
        console.error('Invalid response format from Edge Function:', data);
        return { isValid: false, reason: 'Validation check failed (Invalid response format).' };
      }

      console.log('Edge Function recipe validation result:', data);
      // The Edge function now directly returns the final { isValid, reason }
      return { isValid: data.isValid, reason: data.reason || null };

    } catch (error: any) {
      console.error('Unexpected error calling Edge Function:', error);
      // Handle potential network errors etc.
      return { isValid: false, reason: 'Content validation failed due to a network or unexpected error.' };
    } finally {
         console.log("AddPostScreen: Finished Edge Function validation attempt.");
        // Loading state is managed by handlePublish
    }
  };
  // --- End NEW Validation Function ---

  // --- handlePublish Function (Calls the NEW validation function) ---
  const handlePublish = async () => {
    console.log("AddPostScreen: handlePublish triggered.");

    // Local validation (Unchanged)
    if (!title.trim()) { Alert.alert('Missing Info', 'Please provide a recipe title.'); return; }
    if (ingredients.every(i => !i.trim())) { Alert.alert('Missing Info', 'Please add at least one ingredient.'); return; }
    if (instructions.every(s => !s.trim())) { Alert.alert('Missing Info', 'Please add at least one instruction step.'); return; }
    if (originalImageUri && (!originalImageWidth || !originalImageHeight)) {
        console.error("AddPostScreen: Publish aborted - Original image selected but dimensions are missing.");
        Alert.alert('Image Error', 'Could not determine original image dimensions. Please try selecting the image again.');
        return;
    }
    console.log("AddPostScreen: Local validation passed.");

    setIsLoading(true); // Start loading indicator
    setLoadingMessage('Validating content...'); // Set initial message

    try {
      // *** USE THE NEW EDGE FUNCTION VALIDATOR ***
      const validation = await validateContentWithEdgeFunction();
      if (!validation.isValid) {
        // Throw error to be caught below, using the reason from the Edge Function
        throw new Error(validation.reason || 'Content does not meet requirements.');
      }
      console.log("AddPostScreen: Edge function content validation successful.");

      // --- Rest of the publish logic remains the same ---
      setLoadingMessage('Preparing post...');
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
          console.error("AddPostScreen: Authentication error.", authError);
          throw new Error(authError?.message || 'Authentication failed. Please log in again.');
      }
      console.log("AddPostScreen: User authenticated:", user.id);

      let uploadedImageUrl: string | null = null;
      const postId = uuid.v4(); // Keep using uuid for post ID if needed elsewhere, otherwise remove if not used
      console.log(`AddPostScreen: Generated Post ID: ${postId}`); // Post ID might not be needed if Supabase generates it

      // Image Upload (Use ORIGINAL image URI and dimensions) - Unchanged
      if (originalImageUri && originalImageWidth && originalImageHeight) {
        console.log("AddPostScreen: Starting ORIGINAL image upload process...");
        setLoadingMessage('Uploading image...');
        const token = await getCurrentSupabaseToken(); // Token for upload worker
        if (!token) {
            console.error("AddPostScreen: Failed to get Supabase token for upload.");
            throw new Error('Your session may have expired. Please log in again.');
        }
        console.log("AddPostScreen: Got Supabase token for upload.");

        const filename = originalImageUri.split('/').pop() || `${uuid.v4()}.jpg`; // Use UUID for filename uniqueness
        const fileTypeMatch = filename.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i);
        const fileExt = fileTypeMatch ? fileTypeMatch[1].toLowerCase() : 'jpeg';
        const mimeType = `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;
        console.log(`AddPostScreen: Preparing ORIGINAL image for upload: Name=${filename}, Type=${mimeType}, URI=${originalImageUri}`);

        const formData = new FormData();
        formData.append('image', {
            uri: originalImageUri, // Use ORIGINAL URI
            name: filename,
            type: mimeType,
         } as any);

        console.log("AddPostScreen: Sending image upload request to worker:", API_URL);
        const response = await fetch(`${API_URL}/api/upload-post-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
        });

        console.log(`AddPostScreen: Image upload response status: ${response.status}`);
        if (!response.ok) {
            let errorData;
            try { errorData = await response.json(); } catch (e) { errorData = { error: `Upload failed with status: ${response.status}` }; }
            console.error("AddPostScreen: Image upload failed.", errorData);
            throw new Error(errorData.error || 'Image upload failed.');
        }
        const data = await response.json();
        uploadedImageUrl = data.url;
        if (!uploadedImageUrl) {
             console.error("AddPostScreen: Image upload response missing URL.", data);
             throw new Error('Image uploaded, but failed to get the URL.');
        }
        console.log('AddPostScreen: Image uploaded successfully:', uploadedImageUrl);
      } else {
          console.log("AddPostScreen: No image to upload.");
      }

      // Insert into Supabase (Use ORIGINAL image dimensions) - Unchanged
      console.log("AddPostScreen: Inserting recipe data into Supabase...");
      setLoadingMessage('Saving recipe...');
      const recipeData = {
        // id: postId, // Let Supabase generate the ID unless you need client-generated UUIDs
        creator_uuid: user.id,
        title: title.trim(),
        ingredients: ingredients.filter(i => i.trim()),
        instructions: instructions.filter(s => s.trim()),
        image_url: uploadedImageUrl,
   
        is_published: true, // Assuming always published on creation
        like_count: 0,
      };
      console.log("AddPostScreen: Recipe data prepared:", JSON.stringify(recipeData, null, 2));

      const { error: insertError } = await supabase
        .from('recipes')
        .insert([recipeData])
        .select() // Optional: Select to confirm insertion or get generated ID

        if (insertError) {
          console.error("AddPostScreen: Supabase insert error:", insertError);
          // Attempt to provide a more user-friendly error
          if (insertError.message.includes('duplicate key value')) {
             throw new Error("Failed to save recipe due to a conflict. Please try again.");
          } else if (insertError.message.includes('constraint')) {
             throw new Error("Failed to save recipe due to invalid data. Please check your inputs.");
          }
          throw insertError; // Rethrow original error if not specifically handled
        }
      console.log("AddPostScreen: Recipe inserted successfully.");

      Alert.alert('Success', 'Recipe published!');
      setIsLoading(false); // Ensure loading state is reset before navigation
      router.push('/(tabs)/community'); // Navigate on success

    } catch (error: any) {
      console.error('AddPostScreen: Publish error caught in handlePublish:', error);
      // Use the error message thrown (could be from validation or other steps)
      const errorMessage = error.message || 'Failed to publish recipe. Please try again.';
      Alert.alert('Error', errorMessage);
      // Ensure loading is stopped on error
      setIsLoading(false);
      setLoadingMessage('Publishing...'); // Reset message
    } finally {
      // This runs even if navigation happens on success, ensure loading is off
      // It might run *after* navigation starts, so check isLoading state
      console.log("AddPostScreen: handlePublish finally block executed.");
      if (isLoading) { // Only update state if it was actually loading
          setIsLoading(false);
          setLoadingMessage('Publishing...');
      }
    }
  };

  // --- pickImage Function (Unchanged) ---
  // This function correctly handles setting originalImageUri, which is then used by the validation and upload functions.
  const pickImage = useCallback(async () => {
    console.log("AddPostScreen: pickImage triggered.");
    if (isLoading) {
        console.log("AddPostScreen: pickImage aborted, currently loading.");
        return;
    }
    console.log("AddPostScreen: Resetting ALL image states before picking.");
    setImageUri(null); setImageWidth(null); setImageHeight(null);
    setOriginalImageUri(null); setOriginalImageWidth(null); setOriginalImageHeight(null);
    if (Platform.OS !== 'web') {
        console.log("AddPostScreen: Requesting media library permissions...");
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            console.log(`AddPostScreen: Media library permission status: ${status}`);
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Access to your photo library is needed to add a recipe photo.');
                return;
            }
        } catch (permError) {
            console.error("AddPostScreen: Error requesting media permissions:", permError);
            Alert.alert('Permission Error', 'Could not request photo library permissions.');
            return;
        }
    }
    let pickerResult: ImagePicker.ImagePickerResult | null = null;
    try {
        console.log("AddPostScreen: Launching image library picker...");
        pickerResult = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.8,
            base64: false,
            allowsEditing: Platform.OS === 'android',
            aspect: Platform.OS === 'android' ? [3, 4] : undefined,
        });
        console.log("AddPostScreen: Image picker result received.");
        if (pickerResult.canceled) {
            console.log("AddPostScreen: Image picking was cancelled.");
            return;
        }
        if (!pickerResult.assets || pickerResult.assets.length === 0 || !pickerResult.assets[0].uri) {
            console.warn("AddPostScreen: Image picker result invalid.", pickerResult);
            Alert.alert("Image Error", "Could not get the selected image URI.");
            return;
        }
        const pickedAsset = pickerResult.assets[0];
        const tempOriginalUri = pickedAsset.uri;
        console.log(`AddPostScreen: Image picked successfully. Temp Original URI: ${tempOriginalUri}, Picker Dimensions: ${pickedAsset.width}x${pickedAsset.height}`);
        console.log("AddPostScreen: Setting isLoading = true (before image processing)");
        setIsLoading(true);
        setLoadingMessage("Processing image...");
        Image.getSize(
            tempOriginalUri,
            async (origWidth, origHeight) => {
                console.log(`AddPostScreen: Image.getSize SUCCESS. Original Dimensions: ${origWidth}x${origHeight}`);
                if (!(origWidth > 0 && origHeight > 0)) {
                    console.error(`AddPostScreen: Image.getSize returned invalid original dimensions: ${origWidth}x${origHeight}`);
                    Alert.alert("Image Error", "Could not get valid image dimensions after selection.");
                    setImageUri(null); setImageWidth(null); setImageHeight(null);
                    setOriginalImageUri(null); setOriginalImageWidth(null); setOriginalImageHeight(null);
                    setIsLoading(false); setLoadingMessage("Publishing...");
                    return;
                }
                setOriginalImageUri(tempOriginalUri);
                setOriginalImageWidth(origWidth);
                setOriginalImageHeight(origHeight);
                console.log("AddPostScreen: Original image details stored.");
                console.log(`AddPostScreen: Resizing image for preview (target width: ${PREVIEW_RESIZE_WIDTH})...`);
                try {
                    const manipResult = await ImageManipulator.manipulateAsync(
                        tempOriginalUri,
                        [{ resize: { width: PREVIEW_RESIZE_WIDTH } }],
                        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
                    );
                    console.log(`AddPostScreen: Preview image created: ${manipResult.uri}, Preview Dimensions: ${manipResult.width}x${manipResult.height}`);
                    setImageUri(manipResult.uri);
                    setImageWidth(manipResult.width);
                    setImageHeight(manipResult.height);
                    console.log("AddPostScreen: Preview Image state updated.");
                } catch (manipError) {
                    console.error("AddPostScreen: Failed to manipulate image for preview:", manipError);
                    Alert.alert("Preview Warning", "Could not create a smaller preview. Displaying original image.");
                    setImageUri(tempOriginalUri);
                    setImageWidth(origWidth);
                    setImageHeight(origHeight);
                    console.log("AddPostScreen: Falling back to original image for preview.");
                } finally {
                    console.log("AddPostScreen: Setting isLoading = false (Image processing finished)");
                    setIsLoading(false);
                    setLoadingMessage("Publishing...");
                }
            },
            (error) => {
                console.error("AddPostScreen: Failed to get image size via Image.getSize:", error);
                Alert.alert("Image Error", "Could not read image dimensions after selection. The file might be corrupted or unsupported.");
                setImageUri(null); setImageWidth(null); setImageHeight(null);
                setOriginalImageUri(null); setOriginalImageWidth(null); setOriginalImageHeight(null);
                console.log("AddPostScreen: Setting isLoading = false (Image.getSize error path)");
                setIsLoading(false);
                setLoadingMessage("Publishing...");
            }
        );
        console.log("AddPostScreen: Image.getSize call initiated (async).");
    } catch (error) {
        console.error("AddPostScreen: Error during image picking or processing:", error);
        Alert.alert("Image Picker Error", "An unexpected error occurred while selecting or processing the image.");
        setImageUri(null); setImageWidth(null); setImageHeight(null);
        setOriginalImageUri(null); setOriginalImageWidth(null); setOriginalImageHeight(null);
        if (isLoading) {
            console.log("AddPostScreen: Setting isLoading = false (catch block)");
            setIsLoading(false);
            setLoadingMessage("Publishing...");
        }
    }
    console.log("AddPostScreen: pickImage function finished.");
  }, [isLoading]); // Keep isLoading dependency

  // --- Ingredient/Instruction Handlers (Unchanged) ---
  const handleAddIngredient = () => setIngredients([...ingredients, '']);
  const handleRemoveIngredient = (index: number) => setIngredients(ingredients.filter((_, i) => i !== index));
  const handleChangeIngredient = (text: string, index: number) => setIngredients(ingredients.map((item, i) => (i === index ? text : item)));
  const handleAddInstruction = () => setInstructions([...instructions, '']);
  const handleRemoveInstruction = (index: number) => setInstructions(instructions.filter((_, i) => i !== index));
  const handleChangeInstruction = (text: string, index: number) => setInstructions(instructions.map((item, i) => (i === index ? text : item)));
  const handleBack = () => {
      if (!isLoading) router.back();
      else console.log("AddPostScreen: Back navigation blocked while loading.");
  };

  // Calculate aspect ratio for PREVIEW (Unchanged)
  const previewAspectRatio = (imageWidth && imageHeight && imageHeight > 0)
                             ? imageWidth / imageHeight
                             : 3 / 4;
  console.log(`AddPostScreen: Calculated previewAspectRatio: ${previewAspectRatio}`);

  // --- RENDER (Unchanged from your previous version) ---
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <StatusBar barStyle="dark-content" />
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
         <TouchableOpacity onPress={handleBack} style={styles.backButton} disabled={isLoading}>
           <ArrowLeft size={24} color={isLoading ? "#BDBDBD" : "#000000"} />
         </TouchableOpacity>
         <Text style={styles.headerTitle}>Create Post</Text>
         <View style={styles.headerRightPlaceholder} />
      </View>

      <ScrollView
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* Image Picker Area */}
        <TouchableOpacity
          style={[
            styles.imagePickerBase,
            imageUri && imageWidth && imageHeight
              ? { aspectRatio: previewAspectRatio, height: undefined }
              : styles.imagePickerPlaceholderSize,
            isLoading && styles.imagePickerLoading
          ]}
          onPress={pickImage}
          disabled={isLoading}
        >
          {imageUri && imageWidth && imageHeight ? (
            <>
              <ExpoImage
                source={{ uri: imageUri }}
                style={styles.selectedImage}
                contentFit="contain"
                transition={200}
                onError={(e) => { console.error("AddPostScreen: ExpoImage Component onError:", e?.error); Alert.alert("Image Load Error", "Failed to display image preview."); }}
                onLoad={(e) => { console.log(`AddPostScreen: ExpoImage Component onLoad event fired. Source: ${e?.source?.uri}`); }}
              />
              <View style={styles.imageOverlay}>
                <Camera size={20} color="#FFF" />
                <Text style={styles.changeImageText}>Change Photo</Text>
              </View>
            </>
          ) : (
            <View style={styles.imagePickerContent}>
              <View style={styles.cameraIconContainer}>
                <Camera size={24} color="#FFF" />
              </View>
              <Text style={styles.imagePickerText}>Add Drink Photo</Text>
            </View>
          )}
           {isLoading && loadingMessage === "Processing image..." && (
             <View style={styles.imageProcessingIndicator}>
                <ActivityIndicator size="small" color="#FFFFFF"/>
             </View>
           )}
        </TouchableOpacity>

        {/* Title Input */}
        <View style={styles.inputSection}>
           <Text style={styles.label}>Recipe Title</Text>
           <TextInput
             style={styles.textInput}
             placeholder="e.g., Creamy Vanilla Latte"
             placeholderTextColor="#A0A0A0"
             value={title}
             onChangeText={setTitle}
             editable={!isLoading}
             maxLength={100}
           />
        </View>

        {/* Ingredients Section */}
        <View style={styles.sectionContainer}>
           <Text style={styles.subHeader}>Ingredients</Text>
           {ingredients.map((item, index) => (
              <View key={`ing-${index}`} style={styles.dynamicRow}>
                 <View style={styles.ingredientNumberContainer}>
                     <Text style={styles.ingredientNumber}>{index + 1}</Text>
                 </View>
                 <TextInput
                    style={[styles.textInput, styles.flex]}
                    placeholder={`Ingredient ${index + 1}`}
                    placeholderTextColor="#A0A0A0"
                    value={item}
                    onChangeText={(text) => handleChangeIngredient(text, index)}
                    editable={!isLoading}
                    maxLength={150}
                 />
                 {ingredients.length > 1 && (
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => handleRemoveIngredient(index)}
                      disabled={isLoading}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <X size={18} color={isLoading ? "#BDBDBD" : "#6F4E37"} />
                    </TouchableOpacity>
                 )}
              </View>
           ))}
           <TouchableOpacity
              style={[styles.addRowButton, isLoading && styles.addRowButtonDisabled]}
              onPress={handleAddIngredient}
              disabled={isLoading}
           >
             <Plus size={18} color="#FFF" />
             <Text style={styles.addRowButtonText}>Add Ingredient</Text>
           </TouchableOpacity>
        </View>

        {/* Instructions Section */}
        <View style={styles.sectionContainer}>
           <Text style={styles.subHeader}>Instructions</Text>
           {instructions.map((step, index) => (
              <View key={`ins-${index}`} style={[styles.dynamicRow, styles.instructionRow]}>
                 <View style={styles.stepNumberContainer}>
                    <Text style={styles.stepNumber}>{index + 1}</Text>
                 </View>
                 <TextInput
                    style={[styles.textInput, styles.flex, styles.textAreaInput]}
                    placeholder={`Step ${index + 1}...`}
                    placeholderTextColor="#A0A0A0"
                    value={step}
                    multiline
                    onChangeText={(text) => handleChangeInstruction(text, index)}
                    editable={!isLoading}
                    maxLength={500}
                 />
                 {instructions.length > 1 && (
                    <TouchableOpacity
                       style={styles.removeButton}
                       onPress={() => handleRemoveInstruction(index)}
                       disabled={isLoading}
                       hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                       <X size={18} color={isLoading ? "#BDBDBD" : "#6F4E37"} />
                    </TouchableOpacity>
                 )}
              </View>
           ))}
           <TouchableOpacity
              style={[styles.addRowButton, isLoading && styles.addRowButtonDisabled]}
              onPress={handleAddInstruction}
              disabled={isLoading}
            >
              <Plus size={18} color="#FFF" />
              <Text style={styles.addRowButtonText}>Add Step</Text>
            </TouchableOpacity>
        </View>

        {/* Publish Button */}
        <TouchableOpacity
          style={[ styles.publishButton, isLoading && styles.publishButtonDisabled ]}
          onPress={handlePublish}
          disabled={isLoading}
        >
          {/* Only show spinner during actual publish steps, not image processing */}
          {isLoading && loadingMessage !== "Processing image..." ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.publishText}>Publish Recipe</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Loading Modal (Unchanged - already conditional) */}
      <Modal
          transparent={true}
          animationType="fade"
          visible={isLoading && loadingMessage !== "Processing image..."}
          onRequestClose={() => {}}
      >
          <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.loadingText}>{loadingMessage}</Text>
          </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

// --- STYLES (Unchanged) ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 20,
      paddingBottom: 16,
      backgroundColor: '#FFFFFF',
      borderBottomWidth: 1,
      borderBottomColor: '#EAEAEA',
  },
  backButton: { padding: 8, marginRight: 8 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#000000', textAlign: 'center', flex: 1 },
  headerRightPlaceholder: { width: 40 },
  contentContainer: { padding: 20, paddingBottom: 50 },
  imagePickerBase: {
    width: '100%',
    backgroundColor: '#F0F0F0',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    overflow: 'hidden',
    position: 'relative',
    maxHeight: MAX_PREVIEW_HEIGHT,
  },
  imagePickerPlaceholderSize: {
      height: 220,
  },
  imagePickerLoading: { opacity: 0.8, },
  imagePickerContent: { alignItems: 'center', justifyContent: 'center', padding: 20, },
  cameraIconContainer: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#6F4E37', alignItems: 'center', justifyContent: 'center', marginBottom: 12, },
  imagePickerText: { color: '#333333', fontSize: 16, fontWeight: '600' },
  selectedImage: { flex: 1, width: '100%', },
  imageOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', },
  changeImageText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', marginLeft: 8 },
  imageProcessingIndicator: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.3)', },
  inputSection: { marginBottom: 24 },
  sectionContainer: { marginBottom: 28, backgroundColor: '#FAFAFA', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#F0F0F0', },
  label: { fontSize: 16, fontWeight: '600', color: '#333333', marginBottom: 10 },
  subHeader: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', marginBottom: 16 },
  textInput: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D0D0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: 16, color: '#000000', },
  textAreaInput: { minHeight: 90, textAlignVertical: 'top', paddingTop: 12, },
  dynamicRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, },
  instructionRow: { alignItems: 'flex-start', },
  ingredientNumberContainer: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#6F4E37', alignItems: 'center', justifyContent: 'center', marginRight: 12, },
  stepNumberContainer: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#6F4E37', alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: Platform.OS === 'ios' ? 4 : 6, },
  ingredientNumber: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  stepNumber: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  flex: { flex: 1 },
  removeButton: { marginLeft: 10, padding: 8, borderRadius: 20, },
  addRowButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#6F4E37', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, alignSelf: 'flex-start', marginTop: 4, },
  addRowButtonDisabled: { backgroundColor: '#A0A0A0', opacity: 0.7 },
  addRowButtonText: { marginLeft: 8, fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  publishButton: { backgroundColor: '#000000', borderRadius: 10, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 20, },
  publishButtonDisabled: { backgroundColor: '#A0A0A0' },
  publishText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  loadingOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)', alignItems: 'center', justifyContent: 'center', },
  loadingText: { marginTop: 15, color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center', paddingHorizontal: 20 },
});

export default AddPostScreen;