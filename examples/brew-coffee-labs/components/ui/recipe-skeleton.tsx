import React from 'react';
import { View, StyleSheet, Animated, Easing, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const COLORS = {
  primary: '#1A1A1A',
  background: '#FFFFFF',
  surface: '#F9F9F9',
  border: '#EEEEEE',
};

const RecipeSkeleton = () => {
  // Create animated value for the shimmer effect
  const shimmerAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Create looping animation for the shimmer effect
    const startShimmerAnimation = () => {
      Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    };

    startShimmerAnimation();
    
    return () => {
      shimmerAnim.stopAnimation();
    };
  }, [shimmerAnim]);

  // Interpolate the animated value for the shimmer effect
  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-350, 350],
  });

  return (
    <View style={styles.card}>
      <View style={styles.imageContainer}>
        <View style={styles.cardImage} />
        <Animated.View 
          style={[
            StyleSheet.absoluteFill, 
            styles.shimmer, 
            { transform: [{ translateX }] }
          ]}
        >
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.3)', 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        
        <View style={styles.cardHeaderContent}>
          <View style={styles.titleSkeleton} />
          <View style={styles.headerRight}>
            <View style={styles.likeSkeleton} />
            <View style={styles.chevronSkeleton} />
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.background,
    marginBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  imageContainer: {
    width: '100%',
    height: 280,
    position: 'relative',
    backgroundColor: COLORS.border,
  },
  cardImage: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.border,
  },
  shimmer: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  cardHeaderContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  titleSkeleton: {
    flex: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  likeSkeleton: {
    width: 70,
    height: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
  },
  chevronSkeleton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});

export default RecipeSkeleton;
