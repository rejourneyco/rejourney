import React, { useEffect, useRef } from "react"
import { Animated, StyleSheet, Text, View } from "react-native"

interface ToastProps {
  message: string
  isVisible: boolean
  onHide: () => void
  duration?: number
}

export const Toast: React.FC<ToastProps> = ({ 
  message, 
  isVisible, 
  onHide, 
  duration = 1000 
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current
  const translateYAnim = useRef(new Animated.Value(20)).current

  useEffect(() => {
    if (isVisible) {
      // Show toast
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start()

      // Hide toast after duration
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(translateYAnim, {
            toValue: 20,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onHide()
        })
      }, duration)

      return () => clearTimeout(timer)
    }
  }, [isVisible, fadeAnim, translateYAnim, onHide, duration])

  if (!isVisible) return null

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: translateYAnim }],
        },
      ]}
    >
      <View style={styles.toastContent}>
        <Text style={styles.message}>{message}</Text>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  toastContent: {
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    maxWidth: "80%",
  },
  message: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
})
