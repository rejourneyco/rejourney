import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  Animated,
  Pressable,
  Linking,
  Platform,
  StatusBar,
  Dimensions,
  Alert,
  ActivityIndicator, // <-- Import ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../supabase.js'; // Ensure this path is correct
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { saveAuthToken } from '../../authUtils'; // Ensure this path is correct
import * as AppleAuthentication from 'expo-apple-authentication';
import { FontAwesome } from '@expo/vector-icons';

// Constants (keep as before)
const words = [
    // ... (keep words array)
    { text: 'Hot', color: '#FF824C' },
    { text: 'Cold', color: '#4EE4FF' },
    { text: 'Sweet', color: '#FFF716' },
    { text: 'Instant', color: '#D566FF' },
    { text: 'Bold', color: '#C0764D' },
    { text: 'Creamy', color: '#FFE3C2' },
    { text: 'Rich', color: '#FF9B5E' },
    { text: 'Dark', color: '#000000' },
    { text: 'Smooth', color: '#FFA14B' },
    { text: 'Frothy', color: '#EBCBA6' },
    { text: 'Robust', color: '#A46C5D' },
    { text: 'Aromatic', color: '#E4B78A' },
    { text: 'Velvet', color: '#C78864' },
    { text: 'Caramel', color: '#E8AB78' },
    { text: 'Butter', color: '#EED7A5' },
    { text: 'Roasted', color: '#D27A50' },
    { text: 'Pumpkin', color: '#E58342' },
    { text: 'Smoky', color: '#A15D3E' },
    { text: 'Spiced', color: '#FF8E4A' },
    { text: 'Mellow', color: '#D8B6A1' },
    { text: 'Subtle', color: '#D0A78C' },
];
const { width, height } = Dimensions.get('window');

// Configure GoogleSignin
GoogleSignin.configure({
  scopes: ['profile', 'email'],
  webClientId: '176210667930-dpr87q1vmv7atom4fs67fcbehfls96og.apps.googleusercontent.com',
  iosClientId: '176210667930-dpr87q1vmv7atom4fs67fcbehfls96og.apps.googleusercontent.com',
  offlineAccess: true,
});

const LoginPage = () => {
  // State variables
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isChecked, setIsChecked] = useState(false);
  const [showError, setShowError] = useState(false);
  const [loading, setLoading] = useState(false); // For sign-in process
  const [checkingAuth, setCheckingAuth] = useState(true); // <-- New state for initial auth check
  const [signInError, setSignInError] = useState('');
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);

  // Refs (keep as before)
  const slideAnim = useRef(new Animated.Value(-50)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Navigation
  const router = useRouter();

  // --- Effect for checking existing session on mount ---
// --- Effect for checking existing session on mount ---
useEffect(() => {
  const checkSession = async () => {
    setCheckingAuth(true); // Show loading indicator
    try {
      console.log("Checking for existing session...");
      // THIS IS THE KEY CHECK:
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error("Error fetching session:", error.message);
        // Handle error - maybe show login page anyway
      } else if (session) {
        // SESSION FOUND! (Either valid or auto-refreshed by Supabase)
        console.log("Active session found. Redirecting to home...");
        // Navigate to home and REMOVE LoginPage from history
        router.replace('/(tabs)/home');
        return; // Stop further execution here
      } else {
        // NO SESSION found in AsyncStorage or it's invalid/unrefreshable
        console.log("No active session found. Showing login page.");
      }
    } catch (e) {
       console.error("Unexpected error during session check:", e);
    } finally {
       // Only hide loading if we didn't redirect
       setCheckingAuth(false);
    }
  };

  checkSession();
}, [router]); // Dependency array
  // Effect for rotating words animation (keep as before)
  useEffect(() => {
    // Only start animation if not checking auth (optional optimization)
    if (!checkingAuth) {
      const interval = setInterval(() => {
        Animated.timing(slideAnim, {
          toValue: 50,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          setCurrentIndex((prevIndex) => (prevIndex + 1) % words.length);
          slideAnim.setValue(-50);
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start();
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [slideAnim, checkingAuth]); // Add checkingAuth dependency

  // Effect to check Apple Sign In availability (keep as before)
  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleSignInAvailable);
    }
  }, []);

  // Handlers (keep handleCheck, triggerShake, handleSuccessfulSignIn, handleSignInWithGoogle, handleSignInWithApple as before)
   // Handler for checkbox toggle
  const handleCheck = () => setIsChecked(!isChecked);

  // Handler for shaking animation
  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();

    setShowError(true);
    setTimeout(() => setShowError(false), 2000);
  };

  // --- Shared Logic for Post-Authentication ---
  const handleSuccessfulSignIn = async (authData: { provider: any; user: any; session: any; }) => {
    // ... (keep implementation as before)
    console.log('Authentication successful:', authData.provider);
    if (!authData || !authData.session || !authData.user) {
      throw new Error('Invalid authentication data received.');
    }
    await saveAuthToken(
      authData.session.access_token,
      authData.session.expires_in
    );
    const userId = authData.user.id;
    try {
      const { data: userProfile, error: userProfileError } = await supabase
        .from('users')
        .select('uuid')
        .eq('uuid', userId)
        .maybeSingle();

      // Ignore 'PGRST116' which means "relation does not exist or range is invalid" (user not found)
      if (userProfileError && userProfileError.code !== 'PGRST116') {
        console.error('Error checking user profile:', userProfileError);
        throw new Error('Failed to check user profile.');
      }

      if (userProfile) {
        console.log('User profile found, navigating to home.');
        router.replace('/(tabs)/home');
      } else {
        console.log('User profile not found, navigating to create profile.');
        router.replace('/other-pages/create-profile');
      }
    } catch (checkError) {
      console.error('Error during profile check/routing:', checkError);
      setSignInError('Signed in, but failed to load profile. Please try again.');
      Alert.alert('Profile Error', 'Could not load your profile information. Please try logging in again.');
    }
  };

  // --- Sign in with Google ---
  const handleSignInWithGoogle = async () => {
    // ... (keep implementation as before)
        setSignInError('');
    if (!isChecked) {
      triggerShake();
      return;
    }
    setLoading(true);
    try {
      // await GoogleSignin.hasPlayServices(); // Uncomment if supporting Android
      await GoogleSignin.signIn();
      const { idToken } = await GoogleSignin.getTokens();
      if (!idToken) throw new Error('Failed to get ID token from Google.');

      const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (authError) throw authError;
      await handleSuccessfulSignIn({ ...authData, provider: 'google' });

    } catch (error: any) { // Added : any to handle potential error structure variations
      console.error('Google Sign-In Error:', error);
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        console.log('Google Sign in cancelled by user.');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        Alert.alert('Sign In In Progress', 'A sign-in operation is already in progress.');
      } else if (error.message?.includes('Network Error')) { // Added optional chaining
         setSignInError('Network Error. Please check your connection.');
         Alert.alert('Network Error', 'Could not connect to Google services.');
      } else {
        const message = error.message || 'An unknown error occurred during Google Sign-In.';
        setSignInError(`Google Sign-In Failed: ${message}`);
        Alert.alert('Google Sign-In Failed', message);
      }
    } finally {
      setLoading(false);
    }
  };

  // --- Sign in with Apple ---
  const handleSignInWithApple = async () => {
    // ... (keep implementation as before)
    setSignInError('');
    if (!isChecked) {
      triggerShake();
      return;
    }
    if (!appleSignInAvailable) {
      Alert.alert('Not Supported', 'Sign in with Apple is not available on this device.');
      return;
    }
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const { identityToken } = credential;
      if (!identityToken) throw new Error('Failed to get identity token from Apple.');

      const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: identityToken,
      });
      if (authError) throw authError;
      await handleSuccessfulSignIn({ ...authData, provider: 'apple' });

    } catch (error: any) { // Added : any
      console.error('Apple Sign-In Error:', error);
       // Check for Expo's specific cancellation code
      if (error.code === 'ERR_REQUEST_CANCELED') {
        console.log('Apple Sign in cancelled by user.');
      } else {
        const message = error.message || 'An unknown error occurred during Apple Sign-In.';
        setSignInError(`Apple Sign-In Failed: ${message}`);
        Alert.alert('Apple Sign-In Failed', message);
      }
    } finally {
      setLoading(false);
    }
  };

  // --- Render Component ---

  // Show loading indicator while checking auth status
  if (checkingAuth) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#5D4037" />
      </View>
    );
  }

  // Render the main login page UI if not checking auth and no session found
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Hero Section */}
      <View style={styles.heroSection}>
        <Image
          source={require('../../assets/images/index.jpg')}
          style={styles.heroImage}
          resizeMode="cover"
        />
        <View style={styles.overlay} />
        <View style={styles.heroContent}>
          <View style={styles.headingContainer}>
            <Text style={styles.heading}>BREW </Text>
            <Animated.Text
              style={[
                styles.animatedText,
                {
                  color: words[currentIndex].color,
                  transform: [{ translateY: slideAnim }]
                }
              ]}
            >
              {words[currentIndex].text}
            </Animated.Text>
            <Text style={styles.heading}>Coffee Recipes</Text>
          </View>
        </View>
      </View>

      {/* Login Section */}
      <View style={styles.loginSection}>
        {/* Display Sign-In Errors */}
        {signInError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.signInErrorText}>{signInError}</Text>
          </View>
        ) : null}

        {/* Google Sign-In Button */}
        <TouchableOpacity
          style={[styles.socialButton, styles.googleButton, loading && styles.disabledButton]}
          onPress={handleSignInWithGoogle}
          disabled={loading || checkingAuth} // Also disable while checking auth initially
          activeOpacity={0.7}
        >
          <View style={styles.socialButtonContent}>
            <Image
               source={require('../../assets/images/ios.png')}
               style={styles.googleIconStyle}
            />
            <Text style={styles.socialButtonText}>
              {loading ? 'Signing in...' : 'Continue with Google'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Apple Sign-In Button */}
        {Platform.OS === 'ios' && appleSignInAvailable && (
          <TouchableOpacity
            style={[styles.socialButton, styles.appleDarkButton, loading && styles.disabledButton]}
            onPress={handleSignInWithApple}
            disabled={loading || checkingAuth} // Also disable while checking auth initially
            activeOpacity={0.7}
          >
            <View style={styles.socialButtonContent}>
              <FontAwesome name="apple" size={22} color="#FFFFFF" style={styles.appleIconStyle} />
              <Text style={[styles.socialButtonText, styles.appleButtonText]}>
                {loading ? 'Signing in...' : 'Sign in with Apple'}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Terms & Conditions Checkbox */}
        <Animated.View
          style={[styles.termsContainer, { transform: [{ translateX: shakeAnim }] }]}
        >
          <Pressable
             style={styles.checkboxContainer}
             onPress={handleCheck}
             hitSlop={10}
             disabled={checkingAuth} // Disable interaction while checking
          >
            <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
              {isChecked && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={[styles.termsText, showError && styles.errorText]}>
              I accept the{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://docs.google.com/document/d/19lKke1MTCgh6v-G0F7Mdo9x8fWk2cz8uvo815Siwe_s/edit?usp=sharing')} // Replace with your actual Terms URL
              >
                terms and conditions
              </Text>
            </Text>
          </Pressable>
          {showError && (
            <Text style={styles.errorMessage}>
              Please accept the terms to continue
            </Text>
          )}
        </Animated.View>
      </View>
    </View>
  );
};

// Styles (Add loadingContainer style)
const styles = StyleSheet.create({
  // ... (keep all existing styles)
  container: {
    flex: 1,
    backgroundColor: '#F0F0F0',
  },
  heroSection: {
    height: height * 0.6,
    position: 'relative',
    backgroundColor: '#333',
  },
  heroImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  heroContent: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
  },
  headingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap', // Allow text to wrap if needed
    marginBottom: 8,
  },
  heading: {
    fontSize: 42,
    fontWeight: '700',
    color: '#F0F0F0', // Light color for contrast
    textShadowColor: 'rgba(0, 0, 0, 0.4)', // Subtle shadow
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  animatedText: {
    fontSize: 42,
    fontWeight: '700',
    marginHorizontal: 5, // Add a little space around the animated word
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  loginSection: {
    flex: 1,
    backgroundColor: '#F0F0F0',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    marginTop: -30, // Pulls the section up over the hero image edge
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 30,
  },
  socialButton: {
    width: '100%',
    height: 56,
    borderRadius: 16, // Slightly rounder corners
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleButton: {
     backgroundColor: '#f2f2f2',
      // Standard Google white
  },
  appleDarkButton: {
    backgroundColor: '#000000', // Standard Apple black
  },
  disabledButton: {
    opacity: 0.6, // Visually indicate disabled state
  },
  socialButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconStyle: {
    width: 50, // Adjust size as needed
    height: 50, // Adjust size as needed
    resizeMode: 'contain', // Ensure the image fits well
    marginRight: 1, // Spacing between icon and text

  },
  appleIconStyle: {
    marginRight: 12, // Spacing between icon and text
  },
  socialButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333', // Dark text for Google button
  },
  appleButtonText: {
    color: '#FFFFFF', // White text for Apple button
  },
  termsContainer: {
    marginTop: 24, // Space above terms
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    paddingVertical: 10, // Increase touch area vertically
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#5D4037',
    borderRadius: 6,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxChecked: {
    backgroundColor: '#5D4037',
    borderColor: '#5D4037',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  termsText: {
    flex: 1, // Allow text to wrap
    fontSize: 14,
    color: '#555555',
    lineHeight: 20,
  },
  termsLink: {
    color: '#3498DB',
    textDecorationLine: 'underline',
  },
  errorText: {
    color: '#E74C3C',
  },
  errorMessage: {
    color: '#E74C3C',
    fontSize: 12,
    marginLeft: 34,
  },
   errorContainer: {
    backgroundColor: '#FFEBEB',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFCDCD',
  },
  signInErrorText: {
    color: '#C0392B',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '500',
  },
  // --- New Style for Loading Container ---
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#333', // Match hero background or choose another suitable color
  }
});

export default LoginPage;