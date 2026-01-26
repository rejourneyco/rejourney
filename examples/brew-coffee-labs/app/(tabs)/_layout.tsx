import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { BlurView } from 'expo-blur';

// Single color palette (light mode only)
const COLORS = {
  primary: '#6F4E37',     // Deep coffee brown
  accent: '#C8A27D',      // Caramel
  background: 'rgba(111, 78, 55, 0.75)', // Blurish brown that's semi-transparent
  text: '#1A1A1A',
  inactive: '#FFFFFF',
  icon: '#6F4E37',
  buttonGradient: ['#90EE90', '#008000', '#008000'] // More subtle gradient matching accent color
};

export default function TabLayout() {
  // Custom Tab Bar Background component
  const TabBackground = () => {
    return Platform.OS === 'ios' ? (
      <BlurView 
        intensity={30} 
        tint="dark"
        style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.background }]} 
      />
    ) : (
      <View style={[
        StyleSheet.absoluteFill, 
        { backgroundColor: COLORS.background }
      ]} />
    );
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.inactive,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBackground,
        tabBarStyle: {
          position: 'absolute',
          height: 80,
          paddingBottom: Platform.OS === 'ios' ? 28 : 15,
          paddingTop: 10,
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowOffset: { width: 0, height: -3 },
          shadowRadius: 8,
          backgroundColor: 'transparent',
        },
        tabBarItemStyle: {
          paddingVertical: 5,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 0.2,
          color: '#FFFFFF', // Always white text for better contrast on brown background
        },
      }}>
      
      {/* Login screen - hidden from tab bar */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Login',
          tabBarStyle: { display: 'none' },
          href: null,
        }}
      />

      {/* Main navigation tabs with refined icons */}
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol 
              size={24} 
              name="house" 
              color={color}
              style={focused ? styles.activeIcon : null}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol 
              size={24} 
              name="mug" 
              color={color}
              style={focused ? styles.activeIcon : null} 
            />
          ),
        }}
      />

      {/* Enhanced floating action button */}
      <Tabs.Screen
        name="add-post"
        options={{
          title: '',
          tabBarIcon: ({ focused }) => (
            <View style={styles.addButtonContainer}>
              <LinearGradient
                colors={COLORS.buttonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.addPostButton}
              >
                <IconSymbol 
                  size={22} 
                  name="plus" 
                  color="#FFFFFF"
                />
              </LinearGradient>
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="my-recipes"
        options={{
          title: 'Recipes',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol 
              size={24} 
              name="book" 
              color={color}
              style={focused ? styles.activeIcon : null}  
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol 
              size={24} 
              name="person" 
              color={color} 
              style={focused ? styles.activeIcon : null}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addButtonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Platform.OS === 'ios' ? 25 : 20,
  },
  addPostButton: {
    width: 56,
    height: 56,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 8,
    opacity: 0.89 // Adjust this value for desired transparency
  },
  activeIcon: {
    transform: [{ scale: 1.1 }],
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  }
});