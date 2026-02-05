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

import { useColorScheme } from '@/hooks/useColorScheme';
import React from 'react';

// Toggle Rejourney SDK on/off across the app
const REJOURNEY_ENABLED = true;

// Conditionally initialize Rejourney without statically importing the package
if (REJOURNEY_ENABLED) {
  const { initRejourney, startRejourney } = require('rejourney');
  initRejourney('rj_9cdda278b8bfae7ab6d3d9d340e29882', {
    apiUrl: 'http://10.42.64.230:3000',
    debug: true,
  });
  startRejourney();
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
    // This effect now focuses only on preparing app logic readiness
    async function prepareAppLogic() {
      if ((fontsLoaded || fontError) && initialUrlProcessed) {
        console.log("App logic dependencies ready. Fonts loaded:", !!fontsLoaded, "Initial URL processed:", initialUrlProcessed);
        setAppReady(true); // Signal that fonts and URL processing are done
        // Do NOT hide splash screen or navigate here yet
      } else {
        console.log("Waiting for app logic dependencies. Fonts loaded:", !!fontsLoaded, "Initial URL processed:", initialUrlProcessed);
      }
    }
    prepareAppLogic();
  }, [fontsLoaded, fontError, initialUrlProcessed]); // Dependencies for app logic readiness

  useEffect(() => {
    // This effect handles navigation and splash screen hiding AFTER both app logic and layout are ready
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
        // Hide splash screen only when everything is ready and navigation attempt (if any) is done
        await SplashScreen.hideAsync();
        console.log("Splash screen hidden.");
      } else {
        console.log("Waiting for App/Layout readiness before navigation/splash hide. AppReady:", isAppReady, "LayoutReady:", layoutReady);
      }
    }
    handleNavigationAndSplash();
    // Depend on app logic readiness and layout readiness
  }, [isAppReady, layoutReady, url, router]);

  const onLayoutRootView = useCallback(async () => {
    // This function now only signals that the layout has been rendered
    if (!layoutReady) { // Prevent setting state multiple times if layout changes
      console.log("Root view layout complete.");
      setLayoutReady(true); // Signal layout readiness
    }
  }, [layoutReady]); // Depend on layoutReady state

  if (!isAppReady) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <Slot />
        <StatusBar style="auto" />
      </View>
    </ThemeProvider>
  );
}
