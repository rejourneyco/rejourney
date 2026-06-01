import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    Image,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Alert,
    ScrollView,
    StatusBar,
    ActivityIndicator,
    Platform,
    KeyboardAvoidingView,
    Modal,
    ActionSheetIOS,
    Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabase.js'; // Your Supabase client instance
import { getCurrentSupabaseToken } from '../../authUtils';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import Rejourney, { Mask } from '@rejourneyco/react-native';

// Assume Cloudflare Worker URL is still used for *uploading*, not validation
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://your-worker-name.your-subdomain.workers.dev';
const BREW_NESTED_VIDEO_SOURCE = require('../../assets/media/brew-nested-video-demo.mp4');
const BREW_NESTED_VIDEO_POSTER = require('../../assets/media/brew-video-poster.png');

const COLORS = {
    white: '#FFFFFF',
    offWhite: '#F5F5F5',
    lightGray: '#EEEEEE',
    mediumGray: '#DDDDDD',
    darkGray: '#666666',
    black: '#000000',
    coffee: '#6F4E37',
    coffeeDark: '#4A3524',
    ghostBackground: '#E0E0E0', // Background for ghost elements
};

// Define the expected request structure for the Edge Function
interface ProfileValidationClientRequest {
    type: "profile"; // Explicitly define type for profile validation
    userName: string;
    imageBase64?: string; // Optional image data
    mimeType?: string;    // Optional image mime type
}

type NativeSheetDemo = 'payment' | 'brew';

export default function ProfileScreen() {
    const [name, setName] = useState<string | null>(null); // Initialize as null for loading state
    const [profileIcon, setProfileIcon] = useState<string | null>(null); // Initialize as null
    const [userId, setUserId] = useState<string | null>(null); // Initialize as null
    const [isEditingName, setIsEditingName] = useState(false);
    const [tempName, setTempName] = useState('');
    const [profileImageUri, setProfileImageUri] = useState<string | null>(null);
    const [imageVersion, setImageVersion] = useState(0);
    const [totalLikes, setTotalLikes] = useState<number | null>(null); // Initialize as null
    const [totalBrews, setTotalBrews] = useState<number | null>(null); // Initialize as null
    const [totalPostsLiked, setTotalPostsLiked] = useState<number | null>(null); // Initialize as null
    const [isLoading, setIsLoading] = useState(true); // Start loading initially
    const [isSubmitting, setIsSubmitting] = useState(false); // Separate state for actions like save/upload/logout
    const [loadingMessage, setLoadingMessage] = useState('Loading profile...'); // Keep for logging/debug
    const [activeNativeSheet, setActiveNativeSheet] = useState<NativeSheetDemo | null>(null);
    const [isNestedVideoPlaying, setIsNestedVideoPlaying] = useState(false);
    const [showNestedVideoPoster, setShowNestedVideoPoster] = useState(true);
    const nestedVideoPlayer = useVideoPlayer(BREW_NESTED_VIDEO_SOURCE, (player) => {
        player.loop = true;
        player.muted = true;
        player.volume = 0;
    });

    // --- Refactored Validation Function to use Supabase Edge Function ---
    const validateProfileContentWithEdgeFunction = async (
        userName: string,
        imageUri: string | null
    ): Promise<{ isValid: boolean; reason: string | null }> => {
        console.log('Starting profile content validation via Edge Function...');

        let imageBase64: string | undefined = undefined;
        let mimeType: string | undefined = undefined;

        if (imageUri) {
            try {
                const fileInfo = await FileSystem.getInfoAsync(imageUri);
                if (!fileInfo.exists) {
                    console.error('Validation Error: Image file not found at URI:', imageUri);
                    return { isValid: false, reason: 'Image file not found.' };
                }
                imageBase64 = await FileSystem.readAsStringAsync(imageUri, {
                    encoding: FileSystem.EncodingType.Base64,
                });
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

        const payload: ProfileValidationClientRequest = {
            type: "profile",
            userName: userName,
            ...(imageBase64 && { imageBase64: imageBase64 }),
            ...(mimeType && { mimeType: mimeType }),
        };

        try {
            console.log("Invoking Supabase Edge Function 'gemini-validation-proxy' for profile...");
            const { data, error } = await supabase.functions.invoke(
                'gemini-validation-proxy',
                { body: payload }
            );

            if (error) {
                console.error('Supabase Edge Function Error:', error);
                const reason = error.context?.errorMessage || 'Content validation service failed.';
                return { isValid: false, reason: `Validation Error: ${reason}` };
            }

            if (typeof data?.isValid !== 'boolean') {
                console.error('Invalid response structure from Edge Function:', data);
                return { isValid: false, reason: 'Received an invalid validation response. Please try again.' };
            }

            console.log('Edge Function profile validation result:', data);
            return { isValid: data.isValid, reason: data.reason || null };

        } catch (error: any) {
            console.error('Unexpected error calling Edge Function:', error);
            return { isValid: false, reason: 'Content validation failed due to a network or unexpected error. Please try again.' };
        }
    };
    // --- End Refactored Validation Function ---


    // --- Fetch user data effect ---
    useEffect(() => {
        let isMounted = true;
        const fetchUserData = async () => {
            console.log("Fetching user data...");
            try {
                const { data: authData, error: authError } = await supabase.auth.getUser();
                if (!isMounted) return;
                if (authError) throw authError;

                if (authData?.user) {
                    const currentUserId = authData.user.id;
                    console.log("User ID:", currentUserId);
                    if (isMounted) {
                        setUserId(currentUserId);
                        // Rejourney: Set user identity for session correlation
                        Rejourney.setUserIdentity(currentUserId);
                        // Note: Sensitive userId is masked using the <Mask> component in JSX
                        console.log("Rejourney: User identity set to", currentUserId);
                    }

                    const { data: userRow, error: userError } = await supabase
                        .from('users')
                        .select('name, profile_icon')
                        .eq('uuid', currentUserId)
                        .single();

                    if (!isMounted) return;
                    if (userError && userError.code !== 'PGRST116') {
                        console.error('Error fetching user row:', userError);
                        throw userError;
                    }

                    if (userRow) {
                        console.log("User profile found:", userRow.name);
                        if (isMounted) {
                            setName(userRow.name || 'New User');
                            setProfileIcon(userRow.profile_icon || '');
                            setImageVersion(prev => prev + 1);
                        }
                    } else {
                        console.log("No user profile row found, setting defaults.");
                        if (isMounted) {
                            setName('New User');
                            setProfileIcon('');
                        }
                    }
                } else {
                    console.warn("No authenticated user found.");
                    if (isMounted) router.replace('/login');
                }
            } catch (err: any) {
                console.error('Error fetching user profile:', err);
                if (isMounted) Alert.alert('Error', 'Could not load your profile data. ' + err.message);
            } finally {
                if (isMounted) {
                    console.log("Finished fetchUserData attempt.");
                    // isLoading will be set to false in fetchStats finally block
                }
            }
        };
        fetchUserData();
        return () => {
            isMounted = false;
            console.log("Profile screen unmounted.");
        };
    }, []);


    // --- Fetch stats effect ---
    useEffect(() => {
        let isMounted = true;
        const fetchStats = async () => {
            if (!userId) {
                console.log("Skipping stats fetch: No userId yet.");
                // Ensure loading is eventually false even if userId never arrives
                if (!isLoading) setIsLoading(true); // Set loading true if it became false prematurely
                // Setup a timeout to prevent indefinite loading if userId remains null
                const timer = setTimeout(() => {
                    if (isMounted && !userId) {
                        console.warn("UserID not found after timeout, stopping loading.");
                        setIsLoading(false);
                        // Optionally set default stats or show error message
                        setTotalLikes(0);
                        setTotalBrews(0);
                        setTotalPostsLiked(0);
                    }
                }, 5000); // 5 second timeout

                return () => clearTimeout(timer); // Cleanup timer on unmount or if userId arrives
            }

            console.log("Fetching stats for user:", userId);
            try {
                const [recipesResult, likedPostsResult] = await Promise.all([
                    supabase
                        .from('recipes')
                        .select('like_count', { count: 'exact' })
                        .eq('creator_uuid', userId),
                    supabase
                        .from('recipe_likes')
                        .select('*', { count: 'exact', head: true })
                        .eq('user_uuid', userId)
                ]);

                if (!isMounted) return;

                const { data: userRecipes, count: brewCount, error: userRecipesError } = recipesResult;
                if (userRecipesError) throw userRecipesError;
                if (isMounted) {
                    console.log(`Fetched ${brewCount ?? 0} brews.`);
                    setTotalBrews(brewCount ?? 0);
                    const totalLikesReceived = userRecipes?.reduce((acc, recipe) => acc + (recipe.like_count || 0), 0) ?? 0;
                    console.log(`Total likes received: ${totalLikesReceived}`);
                    setTotalLikes(totalLikesReceived);
                }

                const { count: likedPostsCount, error: likedPostsError } = likedPostsResult;
                if (likedPostsError) throw likedPostsError;
                if (isMounted) {
                    console.log(`User liked ${likedPostsCount ?? 0} posts.`);
                    setTotalPostsLiked(likedPostsCount ?? 0);
                }

            } catch (error: any) {
                if (isMounted) {
                    console.error('Error fetching stats:', error);
                    setTotalLikes(0);
                    setTotalBrews(0);
                    setTotalPostsLiked(0);
                    Alert.alert("Stats Error", "Could not load your statistics.");
                }
            } finally {
                if (isMounted) {
                    console.log("Finished fetchStats attempt.");
                    setIsLoading(false); // Set loading false after stats attempt completes (success or fail)
                    setLoadingMessage("Loading...");
                }
            }
        };

        fetchStats(); // Fetch starts when userId becomes available

        return () => { isMounted = false; };
    }, [userId]); // Re-run ONLY when userId changes


    // --- handlePickAndUploadImage ---
    const handlePickAndUploadImage = async () => {
        if (isSubmitting || isLoading) return; // Prevent action during submission or initial load
        let selectedUri: string | null = null;

        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Required', 'Please allow access to your photo gallery.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                quality: 0.8,
                aspect: [1, 1],
            });

            if (result.canceled || !result.assets || result.assets.length === 0) {
                console.log('Image selection cancelled.');
                return;
            }

            selectedUri = result.assets[0].uri;
            setProfileImageUri(selectedUri);

            setIsSubmitting(true);
            setLoadingMessage('Validating image...');

            const validation = await validateProfileContentWithEdgeFunction(name ?? 'User', selectedUri);

            if (!validation.isValid) {
                Alert.alert('Image Issue', validation.reason || 'Selected image is not suitable.');
                setProfileImageUri(null);
                setIsSubmitting(false);
                setLoadingMessage("Loading...");
                return;
            }

            setLoadingMessage('Uploading image...');
            const token = await getCurrentSupabaseToken();
            if (!token) {
                throw new Error('Authentication session expired. Please log in again.');
            }

            const formData = new FormData();
            const filename = selectedUri.split('/').pop() || 'profile.jpg';
            const match = /\.(\w+)$/.exec(filename);
            let type = 'image/jpeg';
            if (match) {
                const ext = match[1].toLowerCase();
                const mimeMap: { [key: string]: string } = {
                    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
                    heif: 'image/heif', avif: 'image/avif',
                };
                type = mimeMap[ext] || 'image/jpeg';
            }

            formData.append('image', {
                uri: Platform.OS === 'android' ? selectedUri : selectedUri.replace('file://', ''),
                name: filename,
                type,
            } as any);


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
            const newProfileUrl = data.url;

            setLoadingMessage('Saving profile...');
            // Ensure userId is valid before proceeding
            if (!userId) throw new Error("User ID not available to save profile.");

            const { error: updateError } = await supabase
                .from('users')
                .update({ profile_icon: newProfileUrl })
                .eq('uuid', userId);

            if (updateError) {
                console.error("Supabase profile update error:", updateError);
                throw new Error('Could not save profile picture.');
            }

            setProfileIcon(newProfileUrl);
            setImageVersion(prev => prev + 1);
            setProfileImageUri(null);
            Alert.alert('Success', 'Profile picture updated!');

        } catch (error: any) {
            console.error('Error updating profile picture:', error);
            Alert.alert('Error', error.message || 'Failed to update profile picture.');
            if (selectedUri && profileImageUri === selectedUri) {
                setProfileImageUri(null);
            }
        } finally {
            setIsSubmitting(false);
            setLoadingMessage('Loading...');
        }
    };

    // --- Name Editing Handlers ---
    const handleEditName = () => {
        if (name === null || isSubmitting || isLoading) return;
        setTempName(name || '');
        setIsEditingName(true);
    };

    const handleCancelEditName = () => {
        setIsEditingName(false);
        setTempName('');
    };

    const handleSaveName = async () => {
        if (isSubmitting || !userId || isLoading) return;

        const newName = tempName.trim();
        if (!newName) {
            Alert.alert('Error', 'Name cannot be empty.');
            return;
        }
        if (newName === name) {
            setIsEditingName(false);
            return;
        }

        setIsSubmitting(true);

        try {
            setLoadingMessage('Validating name...');
            const validation = await validateProfileContentWithEdgeFunction(newName, null);

            if (!validation.isValid) {
                Alert.alert('Name Issue', validation.reason || 'The chosen name is not suitable.');
                setIsSubmitting(false);
                setLoadingMessage("Loading...");
                return;
            }

            setLoadingMessage('Saving name...');
            const { error: updateError } = await supabase
                .from('users')
                .update({ name: newName })
                .eq('uuid', userId);

            if (updateError) {
                console.error('Error updating name in Supabase:', updateError);
                throw new Error('Could not save the new name.');
            }

            setName(newName);
            setIsEditingName(false);
            setTempName('');
            Alert.alert('Success', 'Name updated successfully!');

        } catch (error: any) {
            console.error('Error saving name:', error);
            Alert.alert('Error', error.message || 'Failed to save the name.');
        } finally {
            setIsSubmitting(false);
            setLoadingMessage('Loading...');
        }
    };

    // --- Ghost Loader Components ---
    const GhostPlaceholder = ({ style }: { style: any }) => (
        <View style={[styles.ghostPlaceholderBase, style]} />
    );

    const renderProfilePictureGhost = () => (
        // The container already provides the shape and background
        <GhostPlaceholder style={styles.profileImageContainer} />
    );

    const renderNameGhost = () => (
        <View style={styles.nameContainer}>
            <GhostPlaceholder style={styles.ghostName} />
        </View>
    );

    const renderUserIdGhost = () => (
        <GhostPlaceholder style={styles.ghostUserId} />
    );

    const renderStatsGhost = () => (
        <View style={styles.statsCard}>
            {[1, 2, 3].map((_, index) => (
                <React.Fragment key={index}>
                    {index > 0 && <View style={styles.ghostStatDivider} />}
                    <View style={styles.stat}>
                        <GhostPlaceholder style={styles.ghostIcon} />
                        <GhostPlaceholder style={styles.ghostStatNumber} />
                        <GhostPlaceholder style={styles.ghostStatLabel} />
                    </View>
                </React.Fragment>
            ))}
        </View>
    );

    // --- renderProfilePicture (Handles preview, actual image, and placeholder) ---
    const renderProfilePicture = () => {
        if (profileImageUri) {
            return (
                <Image
                    source={{ uri: profileImageUri }}
                    style={styles.profileImage}
                    key={`temp-${profileImageUri}`}
                />
            );
        }
        if (profileIcon?.startsWith('http')) {
            return (
                <Image
                    source={{ uri: `${profileIcon}?v=${imageVersion}` }}
                    style={styles.profileImage}
                    key={`${profileIcon}-${imageVersion}`}
                    onError={(e) => {
                        console.warn("Failed to load profile image:", e.nativeEvent.error);
                    }}
                />
            );
        }
        return (
            <View style={styles.placeholderIcon}>
                <Feather name="user" size={40} color={COLORS.darkGray} />
            </View>
        );
    };


    // --- handleLogout ---
    const handleLogout = () => {
        if (isSubmitting || isLoading) return;

        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
                        setIsSubmitting(true);
                        setLoadingMessage('Signing out...');
                        console.log("Signing out...");
                        try {
                            const { error } = await supabase.auth.signOut();
                            if (error) throw error;
                            // Rejourney: Clear user identity on logout
                            Rejourney.clearUserIdentity();
                            console.log("Rejourney: User identity cleared");
                            router.replace('/(tabs)/');
                        } catch (error: any) {
                            console.error("Sign out error:", error);
                            Alert.alert("Error", "Could not sign out: " + error.message);
                            setIsSubmitting(false);
                            setLoadingMessage('Loading...');
                        }
                        // No finally needed if unmount occurs
                    }
                }
            ],
            { cancelable: !(isSubmitting || isLoading) }
        );
    };

    const logNativeSheetTest = (sheetType: string) => {
        Rejourney.logEvent('native_sheet_test_opened', {
            sheetType,
            screen: 'profile',
        });
    };

    const openNativeSheetDemo = (sheet: NativeSheetDemo) => {
        logNativeSheetTest(sheet);
        setActiveNativeSheet(sheet);
    };

    const closeNativeSheetDemo = () => {
        setActiveNativeSheet(null);
    };

    const handleNestedVideoTap = useCallback(() => {
        if (isSubmitting || isLoading) return;

        const nextPlaying = !isNestedVideoPlaying;
        setShowNestedVideoPoster(false);
        if (nextPlaying) {
            nestedVideoPlayer.play();
        } else {
            nestedVideoPlayer.pause();
        }
        setIsNestedVideoPlaying(nextPlaying);
        Rejourney.logEvent('native_sheet_nested_video_toggled', {
            playing: nextPlaying,
            screen: 'profile',
        });
    }, [isLoading, isNestedVideoPlaying, isSubmitting, nestedVideoPlayer]);

    const handleNestedVideoLongPress = useCallback(() => {
        if (isSubmitting || isLoading) return;

        nestedVideoPlayer.pause();
        nestedVideoPlayer.currentTime = 0;
        setIsNestedVideoPlaying(false);
        setShowNestedVideoPoster(true);
        Rejourney.logEvent('native_sheet_nested_video_reset', {
            screen: 'profile',
        });
    }, [isLoading, isSubmitting, nestedVideoPlayer]);

    const nestedVideoTapGesture = useMemo(
        () => Gesture.Tap().runOnJS(true).onEnd((_event, success) => {
            if (success) handleNestedVideoTap();
        }),
        [handleNestedVideoTap]
    );

    const nestedVideoLongPressGesture = useMemo(
        () => Gesture.LongPress().minDuration(450).runOnJS(true).onEnd((_event, success) => {
            if (success) handleNestedVideoLongPress();
        }),
        [handleNestedVideoLongPress]
    );

    const nestedVideoGesture = useMemo(
        () => Gesture.Exclusive(nestedVideoLongPressGesture, nestedVideoTapGesture),
        [nestedVideoLongPressGesture, nestedVideoTapGesture]
    );

    const completePaymentDemo = () => {
        closeNativeSheetDemo();
        setTimeout(() => {
            Alert.alert('Payment Authorized', 'Sandbox payment completed.');
        }, 300);
    };

    const showNativeAlertDemo = () => {
        logNativeSheetTest('alert');
        Alert.alert(
            'Brew Ready?',
            'Your tasting room order is ready to confirm.',
            [
                { text: 'Later', style: 'cancel' },
                { text: 'Confirm', onPress: () => Rejourney.logEvent('native_sheet_test_confirmed', { sheetType: 'alert' }) },
            ]
        );
    };

    const showNativeActionSheetDemo = () => {
        logNativeSheetTest('action_sheet');

        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: 'Choose Brew Action',
                    message: 'Choose how to handle this sandbox order.',
                    options: ['Mark as Paid', 'Apply Discount', 'Cancel'],
                    cancelButtonIndex: 2,
                    userInterfaceStyle: 'light',
                },
                (buttonIndex) => {
                    if (buttonIndex === 0) {
                        Alert.alert('Marked Paid', 'The sandbox order was marked as paid.');
                    } else if (buttonIndex === 1) {
                        Alert.alert('Discount Applied', 'A sandbox discount was applied.');
                    }
                }
            );
            return;
        }

        Alert.alert(
            'Choose Brew Action',
            'Choose how to handle this sandbox order.',
            [
                { text: 'Mark as Paid' },
                { text: 'Apply Discount' },
                { text: 'Cancel', style: 'cancel' },
            ]
        );
    };

    const showNativeShareDemo = async () => {
        logNativeSheetTest('share_sheet');

        try {
            await Share.share({
                title: 'BREW receipt',
                message: 'BREW Coffee Labs sandbox receipt: Cold Foam Latte, $4.80.',
            });
        } catch (error: any) {
            Alert.alert('Share Error', error.message || 'Could not open the native share sheet.');
        }
    };

    const renderNativeSheetModal = () => {
        const sheet = activeNativeSheet ?? 'payment';
        const isPaymentSheet = sheet === 'payment';

        return (
            <Modal
                visible={activeNativeSheet !== null}
                animationType="slide"
                presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
                onRequestClose={closeNativeSheetDemo}
            >
                <SafeAreaView style={styles.nativeSheetContainer} edges={['top', 'bottom']}>
                    <ScrollView
                        contentContainerStyle={styles.nativeSheetContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.nativeSheetHandle} />
                        <View style={[styles.nativeSheetIcon, isPaymentSheet ? styles.paymentSheetIcon : styles.brewSheetIcon]}>
                            <Feather
                                name={isPaymentSheet ? 'credit-card' : 'coffee'}
                                size={26}
                                color={isPaymentSheet ? '#1565C0' : COLORS.coffee}
                            />
                        </View>
                        <Text style={styles.nativeSheetEyebrow}>
                            {isPaymentSheet ? 'Sandbox Payment' : 'Brew Preferences'}
                        </Text>
                        <Text style={styles.nativeSheetTitle}>
                            {isPaymentSheet ? 'Confirm Latte Pass' : 'Tune Test Brew'}
                        </Text>
                        <Text style={styles.nativeSheetBody}>
                            {isPaymentSheet
                                ? 'Review the latte pass before authorizing this sandbox order.'
                                : 'Dial in this saved brew before closing the sheet.'}
                        </Text>

                        {isPaymentSheet ? (
                            <>
                                <View style={styles.paymentSummaryCard}>
                                    <View>
                                        <Text style={styles.paymentItemTitle}>Latte Pass</Text>
                                        <Text style={styles.paymentItemSubtitle}>Monthly sandbox plan</Text>
                                    </View>
                                    <Text style={styles.paymentAmount}>$4.80</Text>
                                </View>

                                <Mask style={styles.paymentFieldGroup}>
                                    <Text style={styles.paymentLabel}>Card number</Text>
                                    <TextInput
                                        style={styles.paymentInput}
                                        defaultValue="4242 4242 4242 4242"
                                        keyboardType="number-pad"
                                        placeholderTextColor={COLORS.darkGray}
                                    />
                                    <View style={styles.paymentFieldRow}>
                                        <View style={styles.paymentHalfField}>
                                            <Text style={styles.paymentLabel}>Expiry</Text>
                                            <TextInput style={styles.paymentInput} defaultValue="12/34" keyboardType="number-pad" />
                                        </View>
                                        <View style={styles.paymentHalfField}>
                                            <Text style={styles.paymentLabel}>CVC</Text>
                                            <TextInput style={styles.paymentInput} defaultValue="123" keyboardType="number-pad" secureTextEntry />
                                        </View>
                                    </View>
                                </Mask>

                                <TouchableOpacity style={styles.nativeSheetPrimaryButton} onPress={completePaymentDemo}>
                                    <Feather name="lock" size={18} color={COLORS.white} />
                                    <Text style={styles.nativeSheetPrimaryText}>Authorize Sandbox Payment</Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <View style={styles.brewOptionGrid}>
                                    <View style={styles.brewOptionTile}>
                                        <Text style={styles.brewOptionValue}>12 oz</Text>
                                        <Text style={styles.brewOptionLabel}>Cup</Text>
                                    </View>
                                    <View style={styles.brewOptionTile}>
                                        <Text style={styles.brewOptionValue}>Oat</Text>
                                        <Text style={styles.brewOptionLabel}>Milk</Text>
                                    </View>
                                    <View style={styles.brewOptionTile}>
                                        <Text style={styles.brewOptionValue}>2x</Text>
                                        <Text style={styles.brewOptionLabel}>Shot</Text>
                                    </View>
                                    <View style={styles.brewOptionTile}>
                                        <Text style={styles.brewOptionValue}>Iced</Text>
                                        <Text style={styles.brewOptionLabel}>Temp</Text>
                                    </View>
                                </View>

                                <TouchableOpacity style={styles.nativeSheetPrimaryButton} onPress={closeNativeSheetDemo}>
                                    <Feather name="check" size={18} color={COLORS.white} />
                                    <Text style={styles.nativeSheetPrimaryText}>Save Test Brew</Text>
                                </TouchableOpacity>
                            </>
                        )}

                        <TouchableOpacity style={styles.nativeSheetSecondaryButton} onPress={closeNativeSheetDemo}>
                            <Text style={styles.nativeSheetSecondaryText}>Close Sheet</Text>
                        </TouchableOpacity>
                    </ScrollView>
                </SafeAreaView>
            </Modal>
        );
    };

    // Determine if showing initial loading skeletons
    // Show ghosts if `isLoading` is true (meaning initial data fetch isn't complete)
    const showInitialLoadGhosts = isLoading;

    return (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
        >
            <View style={styles.container}>
                <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

                {/* Header */}
                <SafeAreaView style={styles.header} edges={['top']}>
                    <View style={styles.logoContainer}>
                        <Text style={styles.logoText}>BREW</Text>
                        <View style={styles.logoAccent} />
                    </View>
                    <View style={{ width: 80 }} />
                </SafeAreaView>

                <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {/* Profile Info Card */}
                    <View style={styles.profileCard}>
                        {/* Profile Picture Area */}
                        <TouchableOpacity
                            style={styles.profileImageTouchable} // Use a dedicated style for the touchable area itself
                            onPress={handlePickAndUploadImage}
                            disabled={isSubmitting || showInitialLoadGhosts}
                        >
                            {/* Container for the visual elements (image/ghost/placeholder) */}
                            <View style={[
                                styles.profileImageContainer, // Base styles for size, shape, bg etc.
                                (isSubmitting || showInitialLoadGhosts) && styles.disabledOverlayVisualOnly,
                            ]}>
                                {showInitialLoadGhosts ? renderProfilePictureGhost() : renderProfilePicture()}

                                {/* Activity Indicator during image validation/upload */}
                                {isSubmitting && (loadingMessage.includes('Validating') || loadingMessage.includes('Uploading')) && (
                                    <ActivityIndicator size="small" color={COLORS.coffee} style={styles.activityIndicatorSmall} />
                                )}
                            </View>

                            {/* Plus Icon - Rendered outside the visual container but within the touchable */}
                            {/* Render plus icon only when NOT initially loading AND NOT submitting */}
                            {!showInitialLoadGhosts && !isSubmitting && (
                                <View style={styles.plusIconContainer}>
                                    <Feather name="plus" size={16} color={COLORS.white} />
                                </View>
                            )}
                        </TouchableOpacity>


                        {/* Profile Info (Name + ID) */}
                        <View style={styles.profileInfo}>
                            {showInitialLoadGhosts ? (
                                <>
                                    {renderNameGhost()}
                                    {renderUserIdGhost()}
                                </>
                            ) : isEditingName ? (
                                <View style={styles.nameEditContainer}>
                                    <TextInput
                                        style={[styles.nameInput, isSubmitting && styles.inputDisabled]}
                                        value={tempName}
                                        onChangeText={setTempName}
                                        placeholder="Enter name"
                                        placeholderTextColor={COLORS.mediumGray}
                                        autoFocus
                                        maxLength={50}
                                        editable={!isSubmitting}
                                    />
                                    <View style={styles.editActions}>
                                        <TouchableOpacity onPress={handleSaveName} disabled={isSubmitting || !tempName.trim()} style={styles.editButton}>
                                            <Feather name="check" size={20} color={isSubmitting || !tempName.trim() ? COLORS.mediumGray : COLORS.coffee} />
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={handleCancelEditName} disabled={isSubmitting} style={styles.editButton}>
                                            <Feather name="x" size={20} color={isSubmitting ? COLORS.mediumGray : COLORS.darkGray} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.nameContainer}>
                                    <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">{name ?? '...'}</Text>
                                    {name !== null && !isSubmitting && (
                                        <TouchableOpacity onPress={handleEditName} disabled={isSubmitting} style={styles.editButton}>
                                            <Feather name="edit-2" size={20} color={isSubmitting ? COLORS.mediumGray : COLORS.darkGray} />
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}
                            {/* Rejourney: Privacy masking - wrap sensitive content in Mask component */}
                            {!showInitialLoadGhosts && userId && (
                                <Mask>
                                    <Text style={styles.userId}>
                                        ID: {userId}
                                    </Text>
                                </Mask>
                            )}
                        </View>
                    </View>

                    {/* Stats Card */}
                    {showInitialLoadGhosts ? (
                        renderStatsGhost()
                    ) : (
                        <View style={styles.statsCard}>
                            <View style={styles.stat}>
                                <Feather name="heart" size={24} color={COLORS.coffee} />
                                <Text style={styles.statNumber}>{totalLikes ?? '-'}</Text>
                                <Text style={styles.statLabel}>Likes</Text>
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.stat}>
                                <Feather name="coffee" size={24} color={COLORS.coffee} />
                                <Text style={styles.statNumber}>{totalBrews ?? '-'}</Text>
                                <Text style={styles.statLabel}>Brews</Text>
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.stat}>
                                <Feather name="thumbs-up" size={24} color={COLORS.coffee} />
                                <Text style={styles.statNumber}>{totalPostsLiked ?? '-'}</Text>
                                <Text style={styles.statLabel}>Posts Liked</Text>
                            </View>
                        </View>
                    )}


                    {/* Native Sheet Tests */}
                    <View style={styles.settingsSection}>
                        <Text style={styles.sectionTitle}>Native Sheet Tests</Text>
                        <TouchableOpacity
                            style={[styles.settingButton, (isSubmitting || isLoading) && styles.disabledItem]}
                            onPress={() => openNativeSheetDemo('payment')}
                            disabled={isSubmitting || isLoading}
                        >
                            <View style={[styles.settingIconContainer, styles.paymentTestIcon, (isSubmitting || isLoading) && styles.disabledItemVisual]}>
                                <Feather name="credit-card" size={20} color={(isSubmitting || isLoading) ? COLORS.mediumGray : '#1565C0'} />
                            </View>
                            <Text style={[styles.settingText, (isSubmitting || isLoading) && styles.textDisabled]}>Payment Sheet</Text>
                            <Feather name="chevron-right" size={18} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.darkGray} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.settingButton, (isSubmitting || isLoading) && styles.disabledItem]}
                            onPress={() => openNativeSheetDemo('brew')}
                            disabled={isSubmitting || isLoading}
                        >
                            <View style={[styles.settingIconContainer, styles.brewTestIcon, (isSubmitting || isLoading) && styles.disabledItemVisual]}>
                                <Feather name="coffee" size={20} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.coffee} />
                            </View>
                            <Text style={[styles.settingText, (isSubmitting || isLoading) && styles.textDisabled]}>Brew Sheet</Text>
                            <Feather name="chevron-right" size={18} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.darkGray} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.settingButton, (isSubmitting || isLoading) && styles.disabledItem]}
                            onPress={showNativeActionSheetDemo}
                            disabled={isSubmitting || isLoading}
                        >
                            <View style={[styles.settingIconContainer, (isSubmitting || isLoading) && styles.disabledItemVisual]}>
                                <Feather name="list" size={20} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.black} />
                            </View>
                            <Text style={[styles.settingText, (isSubmitting || isLoading) && styles.textDisabled]}>Action Sheet</Text>
                            <Feather name="chevron-right" size={18} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.darkGray} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.settingButton, (isSubmitting || isLoading) && styles.disabledItem]}
                            onPress={showNativeShareDemo}
                            disabled={isSubmitting || isLoading}
                        >
                            <View style={[styles.settingIconContainer, (isSubmitting || isLoading) && styles.disabledItemVisual]}>
                                <Feather name="share-2" size={20} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.black} />
                            </View>
                            <Text style={[styles.settingText, (isSubmitting || isLoading) && styles.textDisabled]}>Share Sheet</Text>
                            <Feather name="chevron-right" size={18} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.darkGray} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.settingButton, (isSubmitting || isLoading) && styles.disabledItem]}
                            onPress={showNativeAlertDemo}
                            disabled={isSubmitting || isLoading}
                        >
                            <View style={[styles.settingIconContainer, (isSubmitting || isLoading) && styles.disabledItemVisual]}>
                                <Feather name="message-square" size={20} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.black} />
                            </View>
                            <Text style={[styles.settingText, (isSubmitting || isLoading) && styles.textDisabled]}>Alert Dialog</Text>
                            <Feather name="chevron-right" size={18} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.darkGray} />
                        </TouchableOpacity>

                        <View style={styles.nestedVideoTestCard}>
                            <View style={styles.nestedVideoHeader}>
                                <View style={[styles.settingIconContainer, styles.mediaTestIcon, (isSubmitting || isLoading) && styles.disabledItemVisual]}>
                                    <Feather name="film" size={20} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.coffee} />
                                </View>
                                <View style={styles.nestedVideoTitleGroup}>
                                    <Text style={[styles.nestedVideoTitle, (isSubmitting || isLoading) && styles.textDisabled]}>Nested Video Button</Text>
                                    <Text style={[styles.nestedVideoSubtitle, (isSubmitting || isLoading) && styles.textDisabled]}>expo-video with expo-image poster</Text>
                                </View>
                            </View>

                            <GestureDetector gesture={nestedVideoGesture}>
                                <View
                                    collapsable={false}
                                    style={[styles.nestedVideoOuterShell, (isSubmitting || isLoading) && styles.disabledItem]}
                                >
                                    <View collapsable={false} style={styles.nestedVideoMiddleShell}>
                                        <View collapsable={false} style={styles.nestedVideoInnerShell}>
                                            <VideoView
                                                player={nestedVideoPlayer}
                                                style={styles.nestedVideo}
                                                nativeControls={false}
                                                contentFit="cover"
                                                allowsFullscreen={false}
                                                allowsPictureInPicture={false}
                                                pointerEvents="none"
                                            />
                                            {showNestedVideoPoster && (
                                                <ExpoImage
                                                    source={BREW_NESTED_VIDEO_POSTER}
                                                    style={styles.nestedVideoPoster}
                                                    contentFit="cover"
                                                    transition={160}
                                                    pointerEvents="none"
                                                />
                                            )}
                                            <View style={styles.nestedVideoScrim} pointerEvents="none" />
                                            <View style={styles.nestedVideoButtonOverlay} pointerEvents="none">
                                                <Feather name={isNestedVideoPlaying ? 'pause' : 'play'} size={18} color={COLORS.white} />
                                                <Text style={styles.nestedVideoButtonText}>
                                                    {isNestedVideoPlaying ? 'Pause Video' : 'Play Video'}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                </View>
                            </GestureDetector>
                        </View>
                    </View>

                    {/* Account Settings */}
                    <View style={styles.settingsSection}>
                        <Text style={styles.sectionTitle}>Account</Text>
                        <TouchableOpacity
                            style={[styles.settingButton, (isSubmitting || isLoading) && styles.disabledItem]}
                            onPress={handleLogout}
                            disabled={isSubmitting || isLoading}
                        >
                            <View style={[styles.settingIconContainer, (isSubmitting || isLoading) && styles.disabledItemVisual]}>
                                <Feather name="log-out" size={20} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.black} />
                            </View>
                            <Text style={[styles.settingText, (isSubmitting || isLoading) && styles.textDisabled]}>Sign Out</Text>
                            <Feather name="chevron-right" size={18} color={(isSubmitting || isLoading) ? COLORS.mediumGray : COLORS.darkGray} />
                        </TouchableOpacity>

                        {/* Crash Test Button */}
                        <TouchableOpacity
                            style={[styles.settingButton, { marginTop: 20, backgroundColor: '#FFEBEE' }]}
                            onPress={() => {
                                Alert.alert(
                                    'Crash App?',
                                    'This will crash the native app immediately.',
                                    [
                                        { text: 'Cancel', style: 'cancel' },
                                        {
                                            text: 'CRASH', style: 'destructive', onPress: () => {
                                                const { TurboModuleRegistry, NativeModules } = require('react-native');
                                                const mod = TurboModuleRegistry?.get?.('Rejourney') ?? NativeModules?.Rejourney;
                                                mod?.debugCrash();
                                            }
                                        }
                                    ]
                                );
                            }}
                        >
                            <View style={styles.settingIconContainer}>
                                <Feather name="alert-triangle" size={20} color="#D32F2F" />
                            </View>
                            <Text style={[styles.settingText, { color: '#D32F2F' }]}>Test Native Crash</Text>
                        </TouchableOpacity>

                        {/* ANR Test Button */}
                        <TouchableOpacity
                            style={[styles.settingButton, { marginTop: 10, backgroundColor: '#F3E5F5' }]}
                            onPress={() => {
                                Alert.alert(
                                    'Trigger ANR?',
                                    'This will freeze the app for ~6.5 seconds.',
                                    [
                                        { text: 'Cancel', style: 'cancel' },
                                        {
                                            text: 'FREEZE', style: 'destructive', onPress: () => {
                                                const { TurboModuleRegistry, NativeModules } = require('react-native');
                                                const mod = TurboModuleRegistry?.get?.('Rejourney') ?? NativeModules?.Rejourney;
                                                mod?.debugTriggerANR(6500);
                                            }
                                        }
                                    ]
                                );
                            }}
                        >
                            <View style={styles.settingIconContainer}>
                                <Feather name="clock" size={20} color="#7B1FA2" />
                            </View>
                            <Text style={[styles.settingText, { color: '#7B1FA2' }]}>Test Native ANR</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.bottomPadding} />
                </ScrollView>
                {renderNativeSheetModal()}
            </View>
        </KeyboardAvoidingView>
    );
}

// --- STYLES ---
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F0F0',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingTop: Platform.OS === 'ios' ? 10 : 15,
        paddingBottom: 10,
        backgroundColor: '#F0F0F0',
    },
    logoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    logoText: {
        fontSize: 24,
        fontWeight: '800',
        letterSpacing: 1,
        color: COLORS.black,
    },
    logoAccent: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: COLORS.coffee,
        marginLeft: 4,
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },
    profileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 20,
    },
    // Style for the TouchableOpacity wrapper around the image/icon area
    profileImageTouchable: {
        width: 80, // Match container size
        height: 80, // Match container size
        position: 'relative', // Needed for absolute positioning of the plus icon
    },
    // Style for the visual container (image, placeholder, ghost)
    profileImageContainer: {
        width: '100%', // Fill the touchable area
        height: '100%', // Fill the touchable area
        borderRadius: 40,
        backgroundColor: COLORS.offWhite, // Background for placeholder/ghost
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: COLORS.lightGray,
        shadowColor: COLORS.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
        // Removed overflow: 'hidden' to prevent clipping plus icon border
    },
    profileImage: {
        width: '100%',
        height: '100%',
        borderRadius: 40, // Match container
    },
    placeholderIcon: {
        width: '100%',
        height: '100%',
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: COLORS.lightGray, // Use distinct placeholder color if needed
    },
    // Plus Icon - Positioned absolutely relative to profileImageTouchable
    plusIconContainer: {
        position: 'absolute',
        bottom: -2, // Adjust position slightly if needed due to border
        right: -2, // Adjust position slightly if needed due to border
        backgroundColor: COLORS.coffee,
        width: 26,
        height: 26,
        borderRadius: 13,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: COLORS.white,
        shadowColor: COLORS.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 4, // Ensure elevation is higher than container
        zIndex: 10, // Explicitly set zIndex high to ensure it's on top
    },
    activityIndicatorSmall: {
        position: 'absolute', // Position over the image container
        top: 0, left: 0, right: 0, bottom: 0, // Center it
        justifyContent: 'center',
        alignItems: 'center',
        // Add a subtle background to make it visible over dark images maybe?
        // backgroundColor: 'rgba(255, 255, 255, 0.5)',
        // borderRadius: 40, // Match image container
    },
    profileInfo: {
        marginLeft: 16,
        flex: 1,
        justifyContent: 'center',
    },
    nameContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
        minHeight: 28,
    },
    nameEditContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
        minHeight: 38,
    },
    editActions: {
        flexDirection: 'row',
        marginLeft: 8,
    },
    editButton: {
        padding: 6, // Hit area for edit/save/cancel icons
        marginLeft: 4,
    },
    name: {
        fontSize: 20,
        fontWeight: '700',
        color: COLORS.black,
        marginRight: 8,
        flexShrink: 1,
    },
    nameInput: {
        flex: 1,
        fontSize: 18,
        fontWeight: '600',
        borderBottomWidth: 1,
        borderBottomColor: COLORS.coffee,
        paddingBottom: 4,
        paddingTop: 4,
        color: COLORS.black,
        marginRight: 8,
    },
    inputDisabled: {
        backgroundColor: COLORS.lightGray,
        color: COLORS.darkGray,
        borderBottomColor: COLORS.mediumGray,
        opacity: 0.7,
    },
    userId: {
        fontSize: 12,
        color: COLORS.darkGray,
        minHeight: 15,
    },
    statsCard: {
        flexDirection: 'row',
        backgroundColor: COLORS.white,
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 12,
        shadowColor: COLORS.black,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
        elevation: 3,
        justifyContent: 'space-around',
        marginBottom: 24,
        minHeight: 90,
    },
    stat: {
        alignItems: 'center',
        flex: 1,
        paddingHorizontal: 5,
    },
    statDivider: {
        width: 1,
        height: '70%',
        backgroundColor: COLORS.lightGray,
        alignSelf: 'center',
    },
    statNumber: {
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 6,
        color: COLORS.black,
        minHeight: 22,
    },
    statLabel: {
        fontSize: 11,
        color: COLORS.darkGray,
        marginTop: 2,
        fontWeight: '500',
        textAlign: 'center',
        minHeight: 14,
    },
    settingsSection: {
        backgroundColor: COLORS.white,
        borderRadius: 16,
        paddingTop: 16,
        paddingBottom: 8,
        paddingHorizontal: 16,
        shadowColor: COLORS.black,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
        elevation: 3,
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 12,
        color: COLORS.black,
        paddingHorizontal: 4,
    },
    settingButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 4,
        borderTopWidth: 1,
        borderTopColor: COLORS.lightGray,
    },
    settingIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: COLORS.offWhite,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    settingText: {
        fontSize: 15,
        color: COLORS.black,
        flex: 1,
        fontWeight: '500',
    },
    textDisabled: {
        color: COLORS.mediumGray,
        opacity: 0.7,
    },
    disabledOverlayVisualOnly: {
        opacity: 0.7,
    },
    disabledItem: {
        opacity: 0.6,
    },
    disabledItemVisual: {
        // backgroundColor: COLORS.lightGray, // Example: Change background of icon container when disabled
    },
    paymentTestIcon: {
        backgroundColor: '#E3F2FD',
    },
    brewTestIcon: {
        backgroundColor: '#F3ECE6',
    },
    mediaTestIcon: {
        backgroundColor: '#F3ECE6',
    },
    nestedVideoTestCard: {
        borderTopWidth: 1,
        borderTopColor: COLORS.lightGray,
        paddingTop: 16,
        paddingBottom: 12,
    },
    nestedVideoHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    nestedVideoTitleGroup: {
        flex: 1,
    },
    nestedVideoTitle: {
        fontSize: 15,
        color: COLORS.black,
        fontWeight: '600',
    },
    nestedVideoSubtitle: {
        fontSize: 12,
        color: COLORS.darkGray,
        marginTop: 2,
        fontWeight: '500',
    },
    nestedVideoOuterShell: {
        marginTop: 14,
        padding: 10,
        borderRadius: 24,
        backgroundColor: '#F3ECE6',
        borderWidth: 1,
        borderColor: '#E4D3C4',
    },
    nestedVideoMiddleShell: {
        padding: 8,
        borderRadius: 20,
        backgroundColor: '#FFF8F0',
    },
    nestedVideoInnerShell: {
        height: 240,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: COLORS.black,
    },
    nestedVideo: {
        ...StyleSheet.absoluteFillObject,
    },
    nestedVideoPoster: {
        ...StyleSheet.absoluteFillObject,
    },
    nestedVideoScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.16)',
    },
    nestedVideoButtonOverlay: {
        position: 'absolute',
        left: 18,
        right: 18,
        bottom: 18,
        minHeight: 46,
        borderRadius: 23,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 18,
    },
    nestedVideoButtonText: {
        color: COLORS.white,
        fontSize: 14,
        fontWeight: '700',
    },
    nativeSheetContainer: {
        flex: 1,
        backgroundColor: COLORS.white,
    },
    nativeSheetContent: {
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 28,
    },
    nativeSheetHandle: {
        width: 44,
        height: 5,
        borderRadius: 3,
        backgroundColor: COLORS.mediumGray,
        alignSelf: 'center',
        marginBottom: 24,
    },
    nativeSheetIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 18,
    },
    paymentSheetIcon: {
        backgroundColor: '#E3F2FD',
    },
    brewSheetIcon: {
        backgroundColor: '#F3ECE6',
    },
    nativeSheetEyebrow: {
        fontSize: 12,
        fontWeight: '700',
        color: COLORS.darkGray,
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    nativeSheetTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: COLORS.black,
        marginBottom: 8,
    },
    nativeSheetBody: {
        fontSize: 15,
        lineHeight: 21,
        color: COLORS.darkGray,
        marginBottom: 22,
    },
    paymentSummaryCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: COLORS.offWhite,
        borderRadius: 12,
        padding: 16,
        marginBottom: 18,
    },
    paymentItemTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.black,
    },
    paymentItemSubtitle: {
        fontSize: 13,
        color: COLORS.darkGray,
        marginTop: 4,
    },
    paymentAmount: {
        fontSize: 22,
        fontWeight: '800',
        color: COLORS.black,
    },
    paymentFieldGroup: {
        marginBottom: 20,
    },
    paymentLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: COLORS.darkGray,
        marginBottom: 6,
        textTransform: 'uppercase',
    },
    paymentInput: {
        backgroundColor: COLORS.offWhite,
        borderWidth: 1,
        borderColor: COLORS.lightGray,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: Platform.OS === 'ios' ? 13 : 10,
        fontSize: 16,
        color: COLORS.black,
        marginBottom: 14,
    },
    paymentFieldRow: {
        flexDirection: 'row',
        gap: 12,
    },
    paymentHalfField: {
        flex: 1,
    },
    nativeSheetPrimaryButton: {
        minHeight: 52,
        borderRadius: 10,
        backgroundColor: COLORS.black,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 18,
        marginBottom: 12,
    },
    nativeSheetPrimaryText: {
        color: COLORS.white,
        fontSize: 15,
        fontWeight: '700',
    },
    brewOptionGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 22,
    },
    brewOptionTile: {
        width: '47%',
        backgroundColor: COLORS.offWhite,
        borderRadius: 12,
        paddingVertical: 18,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: COLORS.lightGray,
    },
    brewOptionValue: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.black,
        marginBottom: 4,
    },
    brewOptionLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: COLORS.darkGray,
        textTransform: 'uppercase',
    },
    nativeSheetSecondaryButton: {
        minHeight: 48,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: COLORS.mediumGray,
        backgroundColor: COLORS.white,
    },
    nativeSheetSecondaryText: {
        color: COLORS.black,
        fontSize: 15,
        fontWeight: '700',
    },
    bottomPadding: {
        height: 40,
    },

    // --- Ghost Loader Styles ---
    ghostPlaceholderBase: {
        backgroundColor: COLORS.ghostBackground,
        borderRadius: 4,
    },
    // Make ghost image container fill the space but be transparent
    profileImageGhostContainer: {
        width: '100%',
        height: '100%',
        borderRadius: 40,
        backgroundColor: COLORS.ghostBackground, // Use ghost color for background
    },
    ghostName: {
        width: '70%',
        height: 20,
        borderRadius: 4,
    },
    ghostUserId: {
        width: '40%',
        height: 12,
        borderRadius: 3,
        marginTop: 6,
    },
    ghostIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: COLORS.ghostBackground, // Ensure ghost elements have bg color
    },
    ghostStatNumber: {
        width: '50%',
        height: 18,
        marginTop: 8,
        borderRadius: 4,
        backgroundColor: COLORS.ghostBackground, // Ensure ghost elements have bg color
    },
    ghostStatLabel: {
        width: '70%',
        height: 11,
        marginTop: 6,
        borderRadius: 3,
        backgroundColor: COLORS.ghostBackground, // Ensure ghost elements have bg color
    },
    ghostStatDivider: {
        width: 1,
        height: '60%',
        backgroundColor: COLORS.ghostBackground,
        alignSelf: 'center',
        opacity: 0.6,
    },
});
