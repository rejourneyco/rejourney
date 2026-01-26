import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Animated,
  Image,
  ScrollView,
  Modal,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter, Stack } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../supabase.js'; // Your Supabase client
import { getCurrentSupabaseToken } from '../../authUtils'; // Keep for upload token

// Configuration for the API (Keep for upload worker)
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://your-worker-name.your-subdomain.workers.dev';

const coffeeIcons = [
  { id: 1, name: 'coffee', icon: 'coffee' },
  { id: 2, name: 'mug-hot', icon: 'mug-hot' },
  { id: 3, name: 'cookie', icon: 'cookie' },
  { id: 4, name: 'moon', icon: 'moon' },
  { id: 5, name: 'car', icon: 'car' },
  { id: 6, name: 'blender', icon: 'blender' },
  { id: 7, name: 'mortar-pestle', icon: 'mortar-pestle' },
];

const COLORS = {
    white: '#FFFFFF',
    black: '#000000',
    coffee: '#6F4E37',
    mediumGray: '#DDDDDD',
    darkGray: '#666666',
    lightGray: '#EEEEEE',
    offWhite: '#F5F5F5',
};

// --- Define the Request Body Type for Edge Function (Profile) ---
// Matches the interface defined in the Edge Function
interface ProfileValidationClientRequest {
  type: "profile";
  userName: string;
  imageBase64?: string;
  mimeType?: string;
}

export default function CreateProfilePage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('');
  const [profileImageUri, setProfileImageUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Loading...');
  const [bounceAnim] = useState(new Animated.Value(1));
  const [currentStep, setCurrentStep] = useState(1);

  // Fetch user data effect (Unchanged)
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (sessionData?.session?.user) {
          const user = sessionData.session.user;
          setUserId(user.id);
          setEmail(user.email || '');
        } else {
          throw new Error('No active session found');
        }
      } catch (error: any) {
        console.error('Error fetching user data:', error);
        Alert.alert('Error', 'Could not retrieve user session: ' + error.message + '. Please sign in again.');
        router.replace('/');
      }
    };
    fetchUserData();
  }, [router]);

  // --- NEW: Validation Function using Supabase Edge Function ---
  const validateProfileContentWithEdgeFunction = async (
    userName: string,
    imageUri: string | null
  ): Promise<{ isValid: boolean; reason: string | null }> => {
    console.log('Starting profile content validation via Edge Function...');
    // setLoadingMessage('Validating content...'); // Message set by handleSaveProfile

    // 1. Basic Client-side Name Check
    if (!userName || userName.trim().length === 0) {
        return { isValid: false, reason: 'Display name cannot be empty.' };
    }
    if (userName.length > 50) {
        return { isValid: false, reason: 'Display name is too long (max 50 characters).' };
    }

    // 2. Prepare Image Data (if URI provided)
    let imageBase64: string | undefined = undefined;
    let mimeType: string | undefined = undefined;

    if (imageUri) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(imageUri);
        if (!fileInfo.exists) {
          console.error('Validation Error: Image file not found at URI:', imageUri);
          return { isValid: false, reason: 'Image file not found.' };
        }
        imageBase64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
        const fileExtension = imageUri.split('.').pop()?.toLowerCase();
        mimeType = 'image/jpeg'; // Default
        if (fileExtension === 'png') mimeType = 'image/png';
        else if (fileExtension === 'webp') mimeType = 'image/webp';
        else if (fileExtension === 'heic') mimeType = 'image/heic';
        else if (fileExtension === 'heif') mimeType = 'image/heif';
        console.log(`Prepared image for validation (MIME type: ${mimeType})`);
      } catch (error) {
        console.error('Error processing image for validation:', error);
        return { isValid: false, reason: 'Could not process image file.' };
      }
    } else {
      console.log('No image provided for validation.');
    }

    // 3. Prepare Payload for Edge Function
    const payload: ProfileValidationClientRequest = {
      type: "profile", // Set the type
      userName: userName,
      ...(imageBase64 && { imageBase64 }),
      ...(mimeType && { mimeType }),
    };

    // 4. Call Supabase Edge Function
    try {
      console.log("Invoking Supabase Edge Function 'gemini-validation-proxy' for profile...");

      const { data, error } = await supabase.functions.invoke(
        'gemini-validation-proxy', // Ensure this matches your function name
        { body: payload }
      );

      // 5. Handle Response (Consistent with other screens)
      if (error) {
        console.error('Supabase Function invocation error:', error);
        let reason = 'Validation check failed (Function error).';
        if (error.message) {
          try { const errorJson = JSON.parse(error.message); reason = errorJson.error || errorJson.message || reason; }
          catch { reason = error.message; }
        }
        if (error.message.includes('authorization')) { reason = 'Authentication failed. Please log in again.'; }
        else if (error.message.toLowerCase().includes('blocked') || error.message.includes('400')) {
            reason = data?.reason || reason || "Content blocked by policy.";
        }
        return { isValid: false, reason: reason };
      }

      if (typeof data?.isValid !== 'boolean') {
        console.error('Invalid response format from Edge Function:', data);
        return { isValid: false, reason: 'Validation check failed (Invalid response format).' };
      }

      console.log('Edge Function profile validation result:', data);
      return { isValid: data.isValid, reason: data.reason || null };

    } catch (error: any) {
      console.error('Unexpected error calling Edge Function:', error);
      return { isValid: false, reason: 'Content validation failed due to a network or unexpected error.' };
    } finally {
        console.log("CreateProfilePage: Finished Edge Function validation attempt.");
        // Loading state managed by handleSaveProfile
    }
  };
  // --- End NEW Validation Function ---


  // Animation when selecting an icon (Unchanged)
  const animateSelection = () => {
    Animated.sequence([
      Animated.timing(bounceAnim, { toValue: 1.2, duration: 100, useNativeDriver: true }),
      Animated.timing(bounceAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
  };

  // Let user pick an image from device (Unchanged)
  const pickImage = async () => {
    if (isLoading) return;
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.status !== 'granted') {
        Alert.alert('Permission required', 'We need camera roll permissions to upload your profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        aspect: [1, 1],
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setProfileImageUri(result.assets[0].uri);
        setSelectedIcon('');
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Something went wrong when picking the image.');
    }
  };

  // Upload profile picture (Unchanged - uses Cloudflare Worker)
  const uploadProfilePicture = async (uri: string) => {
      console.log("Attempting to upload image:", uri);
      setLoadingMessage('Uploading image...');
    try {
      const token = await getCurrentSupabaseToken();
      if (!token) throw new Error('Authentication token not found');
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'profile.jpg';
      const match = /\.(\w+)$/.exec(filename);
      let type = 'image/jpeg';
      if (match) {
          const ext = match[1].toLowerCase();
          if (['png', 'gif', 'webp', 'heic', 'heif', 'avif'].includes(ext)) type = `image/${ext}`;
          else if (ext === 'jpg' || ext === 'jpeg') type = 'image/jpeg';
      }
       console.log(`Uploading ${filename} as type ${type}`);
      formData.append('image', { uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''), name: filename, type } as any);
      const response = await fetch(`${API_URL}/api/upload-profile-picture`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        let errorData;
        try { errorData = await response.json(); } catch { /* Ignore json parse error */ }
        console.error("Image upload failed:", response.status, errorData);
        throw new Error(errorData?.error || `Failed to upload image (Status: ${response.status})`);
      }
      const data = await response.json();
       console.log("Image upload successful, URL:", data.url);
      if (!data.url || typeof data.url !== 'string' || !data.url.startsWith('http')) {
          console.error("Invalid URL received from upload server:", data.url);
          throw new Error('Invalid URL received after upload.');
      }
      return data.url;
    } catch (error) {
      console.error('Error uploading profile picture:', error);
      throw error;
    }
  };

  // Save user profile to your database (Updated to use Edge Function validation)
  const handleSaveProfile = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const trimmedName = name.trim();

    // Basic client-side checks first (Unchanged)
    if (!trimmedName) { Alert.alert('Hello there!', 'What should we call you?'); setCurrentStep(1); return; }
    if (!selectedIcon && !profileImageUri) { Alert.alert('One more thing!', 'Choose an icon or upload your profile photo.'); return; }

    setIsLoading(true); // Start loading

    try {
      // *** START EDGE FUNCTION VALIDATION ***
      setLoadingMessage('Validating profile...');
      const validation = await validateProfileContentWithEdgeFunction(trimmedName, profileImageUri);

      if (!validation.isValid) {
        Alert.alert('Content Issue', validation.reason || 'The name or image provided is not suitable. Please revise.');
        setIsLoading(false); // Stop loading
        if (validation.reason?.toLowerCase().includes('username') || validation.reason?.toLowerCase().includes('name')) {
            setCurrentStep(1); // Go back to name step if name is the issue
        }
        return; // Stop the process
      }
      // *** END EDGE FUNCTION VALIDATION ***

      // --- Proceed with Upload and Save if Valid ---
      let iconOrUrl = selectedIcon;

      if (profileImageUri) {
          // Message updated inside uploadProfilePicture
          iconOrUrl = await uploadProfilePicture(profileImageUri);
      }

      const token = await getCurrentSupabaseToken();
      if (!token) throw new Error('Authentication session expired. Please sign in again.');

      setLoadingMessage('Saving profile...');

      const { data, error } = await supabase
        .from('users')
        .insert([{ uuid: userId, email: email, name: trimmedName, profile_icon: iconOrUrl }])
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
            console.error("Insert failed, user likely already exists:", error);
            // Optional: Try updating instead if that's desired behavior for this screen
            // const { data: updateData, error: updateError } = await supabase
            //    .from('users')
            //    .update({ name: trimmedName, profile_icon: iconOrUrl })
            //    .eq('uuid', userId)
            //    .select()
            //    .single();
            // if(updateError) throw new Error("Failed to create or update profile.");
            // data = updateData; // Use updateData if update logic is added
            throw new Error("Failed to create profile. An account might already exist.");
        }
        console.error("Supabase insert error:", error);
        throw new Error('Could not save your profile: ' + error.message);
      }

      if (!data) throw new Error("Profile creation successful, but no data returned.");

      await AsyncStorage.setItem('userData', JSON.stringify({
        id: data.uuid, email: data.email, name: data.name, profile_icon: data.profile_icon,
      }));

      console.log('Profile saved successfully:', data);
      
      // CHANGED: Navigate to rate-us page instead of home
      router.replace('/other-pages/rate-us');

    } catch (err: any) {
      console.error('Error during profile creation process:', err);
      Alert.alert('Error', err.message || 'Something went wrong while creating your profile. Please try again.');
      setIsLoading(false); // Stop loading on error
      setLoadingMessage('Loading...'); // Reset message
    }
    // No finally needed for setIsLoading(false) here
  };


  // Other handlers (Unchanged)
    const handleBackPress = () => {
        if (isLoading) return;
        if (currentStep === 2) setCurrentStep(1);
        else router.back();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    const handleIconPress = (iconName) => {
        if (isLoading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSelectedIcon(iconName);
        setProfileImageUri(null);
        animateSelection();
    };
    const handleNextStep = () => {
        if (isLoading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const trimmedName = name.trim();
        if (!trimmedName) { Alert.alert('Hello there!', 'What should we call you?'); return; }
        if (trimmedName.length > 50) { Alert.alert('Name Too Long', 'Please use a shorter display name (max 50 characters).'); return; }
        setCurrentStep(2);
    };
    const renderProgressIndicator = () => (
        <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: currentStep === 1 ? '50%' : '100%' }]} />
        </View>
        <View style={styles.stepsTextContainer}>
            <Text style={[styles.stepText, currentStep === 1 && styles.activeStepText]}>1. Name</Text>
            <Text style={[styles.stepText, currentStep === 2 && styles.activeStepText]}>2. Profile Picture</Text>
        </View>
        </View>
    );


  // --- RENDER (Unchanged from your previous version) ---
  return (
    <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress} disabled={isLoading}>
            <FontAwesome5 name="arrow-left" size={18} color={isLoading ? COLORS.mediumGray : "#222222"} />
          </TouchableOpacity>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>BREW</Text>
            <View style={styles.logoAccent} />
          </View>
          <View style={styles.placeholderView} />
        </View>
        {renderProgressIndicator()}
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {currentStep === 1 ? (
            <View style={styles.stepContainer}>
              <View>
                 <Text style={styles.welcomeTitle}>Welcome!</Text>
                 <Text style={styles.sectionSubtitle}>Let's get your profile started.</Text>
                 <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.input, isLoading && styles.inputDisabled]}
                        onChangeText={setName}
                        value={name}
                        placeholder="Your display name"
                        placeholderTextColor="#BBBBBB"
                        autoFocus
                        maxLength={50}
                        editable={!isLoading}
                        onSubmitEditing={handleNextStep}
                        returnKeyType="next"
                    />
                 </View>
              </View>
              <TouchableOpacity
                 style={[styles.nextButtonContainer, isLoading && styles.buttonDisabled]}
                 onPress={handleNextStep}
                 disabled={isLoading}
               >
                <LinearGradient colors={isLoading ? ['#AAAAAA', '#CCCCCC'] : ['#000000', '#212121']} style={styles.nextButton}>
                  <Text style={styles.nextButtonText}>Continue</Text>
                  <FontAwesome5 name="chevron-right" size={16} color="#FFFFFF" style={styles.buttonIcon} />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.stepContainer}>
               <View>
                 <Text style={styles.sectionTitle}>Choose Your Profile</Text>
                 <Text style={styles.sectionSubtitle}>Select an image or pick an icon.</Text>
                 <View style={styles.profileImageContainer}>
                   <TouchableOpacity style={[styles.imageUploadButton, isLoading && styles.buttonDisabled]} onPress={pickImage} disabled={isLoading}>
                     {profileImageUri ? ( <Image source={{ uri: profileImageUri }} style={styles.profileImage} /> )
                     : ( <View style={styles.uploadPlaceholder}> <FontAwesome5 name="camera" size={28} color={isLoading ? COLORS.mediumGray : "#9A7B68"} /> <Text style={[styles.uploadText, isLoading && styles.textDisabled]}>Upload Photo</Text> </View> )}
                   </TouchableOpacity>
                 </View>
                 <View style={styles.iconSection}>
                   <Text style={[styles.iconSectionTitle, isLoading && styles.textDisabled]}>Or select an icon</Text>
                   <View style={styles.iconList}>
                     {coffeeIcons.map((item) => (
                       <TouchableOpacity key={item.id} onPress={() => handleIconPress(item.icon)} style={[ styles.iconButton, selectedIcon === item.icon && styles.selectedIconButton, isLoading && styles.buttonDisabled ]} disabled={isLoading} >
                         <FontAwesome5 name={item.icon} size={30} color={selectedIcon === item.icon ? '#FFFFFF' : (isLoading ? COLORS.mediumGray : '#444444')} />
                       </TouchableOpacity>
                     ))}
                   </View>
                 </View>
               </View>
              <TouchableOpacity style={[styles.saveButtonContainer, isLoading && styles.buttonDisabled]} onPress={handleSaveProfile} disabled={isLoading} >
                <LinearGradient colors={isLoading ? ['#AAAAAA', '#CCCCCC'] : ['#000000', '#212121']} style={styles.saveButton} >
                  {isLoading ? ( <ActivityIndicator size="small" color={COLORS.white} /> )
                  : ( <> <Text style={styles.saveButtonText}>Complete Setup</Text> <FontAwesome5 name="check" size={16} color="#FFFFFF" style={styles.buttonIcon} /> </> )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
          <Modal transparent={true} animationType="fade" visible={isLoading} onRequestClose={() => {}} >
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={COLORS.white} />
              <Text style={styles.loadingText}>{loadingMessage}</Text>
            </View>
          </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

// --- STYLES (Unchanged) ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 40, paddingBottom: 15, paddingHorizontal: 20, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', },
  logoContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1, },
  logoText: { fontSize: 24, fontWeight: '800', letterSpacing: 1, color: '#000000', },
  logoAccent: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#A8866E', marginLeft: 4, },
  backButton: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18, backgroundColor: '#F7F7F7', },
  placeholderView: { width: 36, },
  progressContainer: { paddingHorizontal: 24, paddingVertical: 15, backgroundColor: '#FAFAFA', },
  progressBar: { height: 5, backgroundColor: '#EAEAEA', borderRadius: 2.5, marginBottom: 8, overflow: 'hidden', },
  progressFill: { height: '100%', backgroundColor: '#9A7B68', borderRadius: 2.5, },
  stepsTextContainer: { flexDirection: 'row', justifyContent: 'space-between', },
  stepText: { fontSize: 11, color: '#888888', fontWeight: '500', },
  activeStepText: { color: '#9A7B68', fontWeight: '700', },
  content: { flex: 1, backgroundColor: '#FFFFFF', },
  contentContainer: { paddingHorizontal: 24, paddingBottom: 40, flexGrow: 1, },
  stepContainer: { flex: 1, paddingTop: 25, flexDirection: 'column', justifyContent: 'space-between', },
  welcomeTitle: { fontSize: 22, fontWeight: '700', color: '#333333', marginBottom: 5, textAlign: 'center', },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: '#333333', marginBottom: 5, textAlign: 'center', },
  sectionSubtitle: { fontSize: 15, color: '#666666', marginBottom: 35, textAlign: 'center', paddingHorizontal: 10, },
  inputContainer: { marginBottom: 30, },
  input: { borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, fontSize: 16, backgroundColor: '#FFFFFF', color: '#333333', },
  inputDisabled: { backgroundColor: '#F5F5F5', borderColor: '#E0E0E0', color: '#AAAAAA', },
  profileImageContainer: { alignItems: 'center', marginBottom: 30, },
  imageUploadButton: { width: 110, height: 110, borderRadius: 55, overflow: 'hidden', backgroundColor: '#F9F9F9', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#EEEEEE', },
  profileImage: { width: '100%', height: '100%', borderRadius: 55, },
  uploadPlaceholder: { alignItems: 'center', justifyContent: 'center', },
  uploadText: { marginTop: 8, fontSize: 13, color: '#9A7B68', fontWeight: '500', },
  iconSection: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F0F0F0', marginTop: 10, marginBottom: 20, },
  iconSectionTitle: { fontSize: 16, fontWeight: '600', color: '#444444', marginBottom: 16, textAlign: 'center', },
  iconList: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginHorizontal: -4, },
  iconButton: { margin: 6, width: 65, height: 65, justifyContent: 'center', alignItems: 'center', borderRadius: 18, backgroundColor: '#F7F7F7', borderWidth: 1, borderColor: '#EEEEEE', },
  selectedIconButton: { backgroundColor: '#9A7B68', borderColor: '#8a6f5e', },
  nextButtonContainer: { marginTop: 'auto', borderRadius: 14, overflow: 'hidden', marginBottom: 10, width: '100%', },
  nextButton: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', },
  nextButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', },
  saveButtonContainer: { borderRadius: 14, overflow: 'hidden', marginBottom: 10, width: '100%', },
  saveButton: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', minHeight: 50, },
  saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', },
  buttonIcon: { marginLeft: 10, },
  buttonDisabled: { opacity: 0.6, },
  textDisabled: { color: COLORS.mediumGray, },
  loadingOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.65)', alignItems: 'center', justifyContent: 'center', zIndex: 10, },
  loadingText: { marginTop: 15, color: COLORS.white, fontSize: 16, fontWeight: '600', textAlign: 'center', paddingHorizontal: 20, },
});