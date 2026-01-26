import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  Platform,
  Animated,
  Alert,
  Linking
} from 'react-native';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useRouter, Stack } from 'expo-router';
import * as StoreReview from 'expo-store-review';

const COLORS = {
  white: '#FFFFFF',
  black: '#000000',
  coffee: '#6F4E37',
  mediumGray: '#DDDDDD',
  darkGray: '#666666',
  lightGray: '#EEEEEE',
  offWhite: '#F5F5F5',
};

export default function RateUsPage() {
  const router = useRouter();
  
  // Show native rate prompt after 1 second
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (Platform.OS === 'ios') {
        // Check if the device supports StoreReview
        if (await StoreReview.hasAction()) {
          try {
            // Use the native iOS StoreReview API
            await StoreReview.requestReview();
          } catch (error) {
            console.log('Error requesting review:', error);
          }
        } else {
          // Fallback to opening the App Store directly if StoreReview isn't available
          const appStoreUrl = 'https://apps.apple.com/us/app/brew-coffee-labs/id6742522474';
          Linking.openURL(appStoreUrl);
        }
      } else if (Platform.OS === 'android') {
        // For Android, you would use the appropriate approach here
        // This is just a placeholder for Android implementation
        Alert.alert(
          'Rate Us',
          'Would you mind taking a moment to rate our app?',
          [
            { text: 'Not Now', style: 'cancel' },
            { text: 'Rate Now', onPress: () => console.log('Android rating would open here') }
          ]
        );
      }
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  const handleContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace('/(tabs)/home');
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>BREW</Text>
          <View style={styles.logoAccent} />
        </View>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Support Our Mission</Text>
        <Text style={styles.subtitle}>
          Help us make coffee experimentation accessible to everyone
        </Text>

        <View style={styles.imageWrapper}>
          <Image 
            source={require('../../assets/images/rateus.png')} 
            style={styles.image}
            resizeMode="contain"
          />
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.continueButtonContainer} 
          onPress={handleContinue}
        >
          <LinearGradient 
            colors={['#000000', '#212121']} 
            style={styles.continueButton}
          >
            <Text style={styles.continueButtonText}>Let's Go</Text>
            <FontAwesome5 name="arrow-right" size={16} color="#FFFFFF" style={styles.buttonIcon} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 40,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#000000',
  },
  logoAccent: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#A8866E',
    marginLeft: 4,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 30,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333333',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: '#666666',
    marginBottom: 20,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  imageWrapper: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
    paddingBottom: 20,
  },
  image: {
    width: '90%',
    height: '90%',
    aspectRatio: 1,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 10,
  },
  continueButtonContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: Platform.OS === 'ios' ? 10 : 20,
    width: '100%',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  continueButton: {
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  buttonIcon: {
    marginLeft: 10,
  },
});