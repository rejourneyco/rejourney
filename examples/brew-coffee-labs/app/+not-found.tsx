
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

import { Link, Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import React, { useEffect } from "react";

export default function NotFoundScreen() {
  const params = useLocalSearchParams();

  useEffect(() => {
    console.log(
      `[Not Found Screen] Accessed at ${new Date().toISOString()}`
    );
    console.log(
      `[Not Found Screen] Parameters received: ${JSON.stringify(params)}`
    );
  }, [params]);

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen doesn't exist.</Text>
        <Text style={styles.params}>
          Params: {JSON.stringify(params)}
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
  params: {
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
