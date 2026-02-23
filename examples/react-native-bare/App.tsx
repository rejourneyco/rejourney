/**
 * React Native Bare Example with Navigation
 * Tests Rejourney SDK screen tracking
 *
 * Copyright (c) 2026 Rejourney
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * See LICENSE-APACHE for full terms.
 *
 * @format
 */

import React, { useEffect } from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  useColorScheme,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { initRejourney, startRejourney, useNavigationTracking, Mask } from 'rejourney';

const Stack = createNativeStackNavigator();

// Home Screen
function HomeScreen({ navigation }: any) {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaView style={[styles.container, isDarkMode && styles.darkContainer]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, isDarkMode && styles.darkText]}>
          🏠 Home Screen
        </Text>
        <Text style={[styles.subtitle, isDarkMode && styles.darkText]}>
          Rejourney SDK is tracking this screen
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('Details')}
        >
          <Text style={styles.buttonText}>Go to Details →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.buttonText}>Go to Settings ⚙️</Text>
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Navigate between screens to test screen tracking.
            {'\n\n'}
            Check your Rejourney dashboard to see the tracked screens!
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Details Screen
function DetailsScreen({ navigation }: any) {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaView style={[styles.container, isDarkMode && styles.darkContainer]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, isDarkMode && styles.darkText]}>
          📄 Details Screen
        </Text>
        <Text style={[styles.subtitle, isDarkMode && styles.darkText]}>
          You navigated here from Home
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.buttonText}>← Go Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.buttonText}>Go to Settings ⚙️</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// Settings Screen
function SettingsScreen({ navigation }: any) {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaView style={[styles.container, isDarkMode && styles.darkContainer]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, isDarkMode && styles.darkText]}>
          ⚙️ Settings Screen
        </Text>
        <Text style={[styles.subtitle, isDarkMode && styles.darkText]}>
          Another screen to test tracking
        </Text>

        {/* Privacy Masking Test */}
        <View style={styles.privacySection}>
          <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>Privacy Masking Test</Text>
          <Mask>
            <View style={styles.sensitiveBox}>
              <Text style={styles.sensitiveText}>Sensitive Data: 1234-5678</Text>
              <Text style={styles.sensitiveText}>This text should be masked</Text>
            </View>
          </Mask>
          <Text style={[styles.caption, isDarkMode && styles.darkText]}>
            The box above should be blurred/masked in replays
          </Text>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.buttonText}>🏠 Go Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.buttonText}>← Go Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const navigationTracking = useNavigationTracking();

  // Initialize Rejourney SDK
  useEffect(() => {
    try {
      console.log('[App] Initializing Rejourney SDK...');
      initRejourney('rj_054c62bfc50b9e1afd18bfdf8c389dc2', {
        apiUrl: 'http://10.146.214.243:3000',
        debug: true,
      });

      // Enable debug logging to see all SDK logs
      const { NativeModules } = require('react-native');
      if (NativeModules.Rejourney) {
        NativeModules.Rejourney.setLogLevel('DEBUG', (success: boolean) => {
          if (success) {
            console.log('[App] Rejourney debug logging enabled');
          } else {
            console.warn('[App] Failed to enable debug logging');
          }
        });
      } else {
        console.warn('[App] Rejourney module not found');
      }

      startRejourney();
      console.log('[App] Rejourney SDK started');
    } catch (error) {
      console.error('[App] Failed to initialize Rejourney:', error);
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <NavigationContainer {...navigationTracking}>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: {
              backgroundColor: '#007AFF',
            },
            headerTintColor: '#fff',
            headerTitleStyle: {
              fontWeight: 'bold',
            },
          }}
        >
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'Home' }}
          />
          <Stack.Screen
            name="Details"
            component={DetailsScreen}
            options={{ title: 'Details' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  darkText: {
    color: '#fff',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 30,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    marginVertical: 10,
    minWidth: 200,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#5856D6',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  infoBox: {
    marginTop: 40,
    padding: 20,
    backgroundColor: '#e8f4fd',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  infoText: {
    fontSize: 14,
    color: '#333',
    textAlign: 'center',
    lineHeight: 22,
  },
  privacySection: {
    marginVertical: 20,
    width: '100%',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  sensitiveBox: {
    backgroundColor: '#ffeba1',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffcc00',
    minWidth: 200,
    alignItems: 'center',
  },
  sensitiveText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  caption: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
    fontStyle: 'italic',
  },
});

export default App;
