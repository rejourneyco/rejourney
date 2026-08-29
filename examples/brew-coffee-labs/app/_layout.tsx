import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Slot, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useCallback } from 'react';
import 'react-native-reanimated';
import { useURL } from 'expo-linking';
import { URLSearchParams } from 'react-native-url-polyfill';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/useColorScheme';
import { REJOURNEY_API_URL, REJOURNEY_PUBLIC_KEY } from '@/config';
import React from 'react';

// Toggle Rejourney SDK on/off across the app
const REJOURNEY_ENABLED = REJOURNEY_PUBLIC_KEY.length > 0;

// Conditionally initialize Rejourney without statically importing the package
if (REJOURNEY_ENABLED) {
  const { Rejourney, initRejourney, startRejourney } = require('@rejourneyco/react-native');
  initRejourney(REJOURNEY_PUBLIC_KEY, {
    apiUrl: REJOURNEY_API_URL,
    debug: true,
  });
  Rejourney.setMetadata('plan', 'premium');
  Rejourney.setMetadata({
    role: 'tester',
    segment: 'beta',
    last_login: Date.now()
  });
  Rejourney.logEvent('app_initialized', {
    hasAuth: false,
    theme: 'dark'
  });
  startRejourney();
} else {
  console.warn('[Rejourney] Recording disabled: REJOURNEY_PUBLIC_KEY is not configured.');
}

// Prevent the splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  const router = useRouter();
  const url = useURL();
  const [isAppReady, setAppReady] = useState(false);
  const [initialUrlProcessed, setInitialUrlProcessed] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);

  useEffect(() => {
    if (url && !initialUrlProcessed) {
      console.log('Deep Link URL received (processing):', url);
      try {
        const parsedUrl = new URL(url);
        const params = new URLSearchParams(parsedUrl.search);
        const pid = params.get('pid');
        const deepLinkValue = params.get('deep_link_value');
        console.log('Parsed Params (processing):', { pid, deepLinkValue });
      } catch (e) {
        console.error("Failed to parse deep link URL during initial check:", e);
      } finally {
        setInitialUrlProcessed(true);
      }
    } else if (!url && !initialUrlProcessed) {
      console.log("No initial deep link URL detected.");
      setInitialUrlProcessed(true);
    }
  }, [url, initialUrlProcessed]);

  useEffect(() => {
    async function prepareAppLogic() {
      if ((fontsLoaded || fontError) && initialUrlProcessed) {
        console.log("App logic dependencies ready. Fonts loaded:", !!fontsLoaded, "Initial URL processed:", initialUrlProcessed);
        setAppReady(true);
      } else {
        console.log("Waiting for app logic dependencies. Fonts loaded:", !!fontsLoaded, "Initial URL processed:", initialUrlProcessed);
      }
    }
    prepareAppLogic();
  }, [fontsLoaded, fontError, initialUrlProcessed]);

  useEffect(() => {
    async function handleNavigationAndSplash() {
      if (isAppReady && layoutReady) {
        console.log("App and Layout are ready. Handling navigation and splash screen.");
        if (url) {
          try {
            console.log('Performing navigation for URL:', url);
            const parsedUrl = new URL(url);
            const params = new URLSearchParams(parsedUrl.search);
            const pid = params.get('pid');
            const deepLinkValue = params.get('deep_link_value');

            if (pid === 'share_recipe' && deepLinkValue) {
              const recipeId = deepLinkValue.replace('recipe_id', '');
              if (recipeId) {
                console.log(`Navigating to community tab with recipeId: ${recipeId} (App & Layout Ready)`);
                router.replace({
                  pathname: '/(tabs)/community',
                  params: { recipeId: recipeId },
                });
              }
            }
          } catch (e) {
            console.error("Failed to parse or navigate deep link URL:", e);
          }
        }
        await SplashScreen.hideAsync();
        console.log("Splash screen hidden.");
      } else {
        console.log("Waiting for App/Layout readiness before navigation/splash hide. AppReady:", isAppReady, "LayoutReady:", layoutReady);
      }
    }
    handleNavigationAndSplash();
  }, [isAppReady, layoutReady, url, router]);

  const onLayoutRootView = useCallback(async () => {
    if (!layoutReady) {
      console.log("Root view layout complete.");
      setLayoutReady(true);
    }
  }, [layoutReady]);

  if (!isAppReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
          <Slot />
          <StatusBar style="auto" />
        </View>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
