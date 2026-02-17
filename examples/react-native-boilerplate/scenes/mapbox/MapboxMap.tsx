import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { useEffect, useRef, useState, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import useColorScheme from '@/hooks/useColorScheme';
import { colors } from '@/theme';
import config from '@/utils/config';

const DEFAULT_MAP_STYLE = 'mapbox://styles/mapbox/standard';

const SF_CENTER = {
  latitude: 37.7882,
  longitude: -122.4074,
};

const SAMPLE_MARKERS = [
  { id: '1', latitude: 37.7950, longitude: -122.4000, title: 'Ferry Building' },
  { id: '2', latitude: 37.7855, longitude: -122.4090, title: 'Union Square' },
  { id: '3', latitude: 37.7694, longitude: -122.4862, title: 'Golden Gate Park' },
  { id: '4', latitude: 37.8080, longitude: -122.4177, title: 'Fisherman\'s Wharf' },
  { id: '5', latitude: 37.7749, longitude: -122.4194, title: 'City Hall' },
  { id: '6', latitude: 37.7599, longitude: -122.4148, title: 'Mission District' },
  { id: '7', latitude: 37.8024, longitude: -122.4058, title: 'North Beach' },
  { id: '8', latitude: 37.7879, longitude: -122.3964, title: 'Embarcadero' },
];

function getLightPreset(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: 'center',
  },
  markerDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E74C3C',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  markerLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 20,
    right: 16,
    gap: 8,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  controlText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  infoBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  infoText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
  },
});

export default function MapboxMap() {
  const { isDark } = useColorScheme();
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [mapStyle, setMapStyle] = useState(DEFAULT_MAP_STYLE);
  const [pitch, setPitch] = useState(60);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const lightPreset = getLightPreset();

  useEffect(() => {
    if (config.mapboxAccessToken) {
      MapboxGL.setAccessToken(config.mapboxAccessToken);
    }
    setTokenReady(true);
  }, []);

  const toggleStyle = useCallback(() => {
    setMapStyle((prev) =>
      prev === DEFAULT_MAP_STYLE
        ? MapboxGL.StyleURL.SatelliteStreet
        : DEFAULT_MAP_STYLE,
    );
  }, []);

  const togglePitch = useCallback(() => {
    setPitch((prev) => (prev === 60 ? 0 : 60));
  }, []);

  const flyToRandom = useCallback(() => {
    const marker = SAMPLE_MARKERS[Math.floor(Math.random() * SAMPLE_MARKERS.length)];
    cameraRef.current?.setCamera({
      centerCoordinate: [marker.longitude, marker.latitude],
      zoomLevel: 15,
      pitch: 60,
      animationDuration: 2000,
      animationMode: 'flyTo',
    });
    setSelectedMarker(marker.id);
  }, []);

  const resetView = useCallback(() => {
    cameraRef.current?.setCamera({
      centerCoordinate: [SF_CENTER.longitude, SF_CENTER.latitude],
      zoomLevel: 13,
      pitch: 60,
      animationDuration: 1500,
      animationMode: 'flyTo',
    });
    setSelectedMarker(null);
  }, []);

  if (!tokenReady) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.lightPurple} />
        <Text style={{ color: '#999', marginTop: 12 }}>Loading Mapbox...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MapboxGL.MapView
        style={styles.map}
        styleURL={mapStyle}
        projection="globe"
        compassEnabled
        scaleBarEnabled={false}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [SF_CENTER.longitude, SF_CENTER.latitude],
            zoomLevel: 13,
            pitch,
          }}
          pitch={pitch}
          animationDuration={1000}
        />

        {mapStyle === DEFAULT_MAP_STYLE && (
          <MapboxGL.StyleImport
            id="basemap"
            existing
            config={{ lightPreset }}
          />
        )}

        <MapboxGL.UserLocation visible animated />

        {SAMPLE_MARKERS.map((marker) => (
          <MapboxGL.MarkerView
            key={marker.id}
            coordinate={[marker.longitude, marker.latitude]}
            anchor={{ x: 0.5, y: 1 }}
          >
            <TouchableOpacity
              style={styles.markerContainer}
              onPress={() => {
                setSelectedMarker(marker.id);
                cameraRef.current?.setCamera({
                  centerCoordinate: [marker.longitude, marker.latitude],
                  zoomLevel: 15,
                  pitch: 60,
                  animationDuration: 1000,
                  animationMode: 'flyTo',
                });
              }}
            >
              <View
                style={[
                  styles.markerDot,
                  selectedMarker === marker.id && {
                    backgroundColor: '#3498DB',
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                  },
                ]}
              />
              <Text style={styles.markerLabel}>{marker.title}</Text>
            </TouchableOpacity>
          </MapboxGL.MarkerView>
        ))}
      </MapboxGL.MapView>

      <View style={styles.infoBar}>
        <SafeAreaView edges={['top']}>
          <Text style={styles.infoText}>
            Mapbox v11 · {mapStyle === DEFAULT_MAP_STYLE ? 'Standard' : 'Satellite'} · Pitch {pitch}° · {lightPreset}
          </Text>
        </SafeAreaView>
      </View>

      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.controlButton} onPress={toggleStyle}>
          <Text style={styles.controlText}>🛰️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={togglePitch}>
          <Text style={styles.controlText}>{pitch === 60 ? '2D' : '3D'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={flyToRandom}>
          <Text style={styles.controlText}>✈️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={resetView}>
          <Text style={styles.controlText}>🏠</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
