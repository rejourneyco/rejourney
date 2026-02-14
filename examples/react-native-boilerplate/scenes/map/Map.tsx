import { View, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useEffect, useRef, useState } from 'react';
import useColorScheme from '@/hooks/useColorScheme';
import { colors } from '@/theme';

// A looping route around downtown San Francisco
const ROUTE_COORDS = [
  { latitude: 37.7950, longitude: -122.4000 },
  { latitude: 37.7935, longitude: -122.3960 },
  { latitude: 37.7910, longitude: -122.3935 },
  { latitude: 37.7880, longitude: -122.3950 },
  { latitude: 37.7855, longitude: -122.3990 },
  { latitude: 37.7840, longitude: -122.4040 },
  { latitude: 37.7830, longitude: -122.4100 },
  { latitude: 37.7850, longitude: -122.4150 },
  { latitude: 37.7870, longitude: -122.4180 },
  { latitude: 37.7900, longitude: -122.4170 },
  { latitude: 37.7930, longitude: -122.4130 },
  { latitude: 37.7950, longitude: -122.4080 },
  { latitude: 37.7960, longitude: -122.4040 },
  { latitude: 37.7950, longitude: -122.4000 }, // back to start
];

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function getBearing(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const dLon = (to.longitude - from.longitude) * Math.PI / 180;
  const lat1 = from.latitude * Math.PI / 180;
  const lat2 = to.latitude * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export default function Map() {
  const { isDark } = useColorScheme();
  const [arrowPos, setArrowPos] = useState(ROUTE_COORDS[0]);
  const [rotation, setRotation] = useState(0);
  const progressRef = useRef(0);

  useEffect(() => {
    const totalSegments = ROUTE_COORDS.length - 1;
    const speed = 0.003; // controls how fast the arrow moves

    const interval = setInterval(() => {
      progressRef.current += speed;
      if (progressRef.current >= totalSegments) {
        progressRef.current = 0;
      }

      const segIndex = Math.floor(progressRef.current);
      const t = progressRef.current - segIndex;
      const from = ROUTE_COORDS[segIndex];
      const to = ROUTE_COORDS[Math.min(segIndex + 1, totalSegments)];

      setArrowPos({
        latitude: lerp(from.latitude, to.latitude, t),
        longitude: lerp(from.longitude, to.longitude, t),
      });
      setRotation(getBearing(from, to));
    }, 16); // ~60fps updates

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 37.7882,
          longitude: -122.4074,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        }}
        mapType={Platform.OS === 'ios' ? 'standard' : 'standard'}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {/* Route polyline */}
        <Polyline
          coordinates={ROUTE_COORDS}
          strokeColor="#4A90D9"
          strokeWidth={3}
          lineDashPattern={[10, 5]}
        />

        {/* Animated arrow marker */}
        <Marker
          coordinate={arrowPos}
          rotation={rotation}
          anchor={{ x: 0.5, y: 0.5 }}
          flat={true}
          tracksViewChanges={true}
        >
          <View style={{
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <View style={{
              width: 0,
              height: 0,
              borderLeftWidth: 8,
              borderRightWidth: 8,
              borderBottomWidth: 20,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: '#E74C3C',
            }} />
          </View>
        </Marker>
      </MapView>
    </View>
  );
}
