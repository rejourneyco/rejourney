
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

import { Link, Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import React, { useEffect } from "react"; // Import useEffect

export default function NotFoundScreen() {
  const params = useLocalSearchParams(); // Get any parameters passed

  useEffect(() => {
    // Log when the Not Found screen is mounted
    console.log(
      `[Not Found Screen] Accessed at ${new Date().toISOString()}`
    );
    console.log(
      `[Not Found Screen] Parameters received: ${JSON.stringify(params)}`
    );
    // You might want to log the full router state if needed, requires useRouter
    // import { useRouter } from 'expo-router';
    // const router = useRouter();
    // console.log('[Not Found Screen] Router state:', JSON.stringify(router.stack));
  }, [params]); // Re-run if params change (though unlikely for this screen)

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen doesn't exist.</Text>
        <Text style={styles.params}>
          Params: {JSON.stringify(params)} {/* Display params */}
        </Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to home screen!</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  params: { // Added style for params
    marginTop: 10,
    fontSize: 14,
    color: 'grey',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
    color: "#2e78b7",
  },
});