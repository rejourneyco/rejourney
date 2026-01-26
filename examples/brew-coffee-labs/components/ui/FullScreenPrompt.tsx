// src/components/ui/FullScreenPrompt.tsx
import React, { type FC } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";

interface FullScreenPromptProps {
  visible: boolean;
  type: "update" | "maintenance";
  title: string;
  message: string;
  iconName: keyof typeof Feather.glyphMap; // Feather icon name
  buttonText?: string; // Optional: Only for update
  storeUrl?: string;   // Optional: Only for update
}

const FullScreenPrompt: FC<FullScreenPromptProps> = ({
  visible,
  type,
  title,
  message,
  iconName,
  buttonText,
  storeUrl,
}) => {

  const handleButtonPress = () => {
    if (type === "update" && storeUrl) {
      Linking.openURL(storeUrl).catch(err => console.error("Failed to open store URL:", err));
    }
  };

  // Prevent closing via back button on Android (Modal's default behavior)
  const handleRequestClose = () => {
    // Do nothing to prevent closure
    console.log("Attempted to close non-cancelable modal.");
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      hardwareAccelerated // Good practice for performance
      onRequestClose={handleRequestClose} // Prevent Android back button close
    >
      <BlurView intensity={80} tint="light" style={styles.absolute}>
        <View style={styles.container}>
          <View style={styles.promptBox}>
            <Feather name={iconName} size={50} color="#6F4E37" style={styles.icon} />
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>

            {type === "maintenance" && (
               <ActivityIndicator size="small" color="#6F4E37" style={styles.spinner} />
            )}

            {type === "update" && buttonText && storeUrl && (
              <TouchableOpacity style={styles.button} onPress={handleButtonPress}>
                <Text style={styles.buttonText}>{buttonText}</Text>
                <Feather name="arrow-right" size={16} color="#FFFFFF" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </BlurView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  absolute: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  promptBox: {
    backgroundColor: "rgba(255, 255, 255, 0.95)", // Slightly more opaque white
    borderRadius: 24,
    padding: 30,
    alignItems: "center",
    width: "100%",
    maxWidth: 350,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 15,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  icon: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#222222",
    marginBottom: 15,
    textAlign: "center",
  },
  message: {
    fontSize: 16,
    color: "#555555",
    textAlign: "center",
    marginBottom: 30,
    lineHeight: 24,
  },
   spinner: {
    marginTop: -10, // Adjust spacing if needed when no button is present
    marginBottom: 10,
  },
  button: {
    flexDirection: 'row',
    backgroundColor: "#6F4E37", // App's primary brown color
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: 'center',
    width: '80%',
    shadowColor: "#6F4E37",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});

export default FullScreenPrompt;