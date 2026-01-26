import { View, StyleSheet, Platform } from 'react-native';
import MapView from 'react-native-maps';
import useColorScheme from '@/hooks/useColorScheme';
import { colors } from '@/theme';

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});

export default function Map() {
  const { isDark } = useColorScheme();
  
  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 37.78825,
          longitude: -122.4324,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
        mapType={Platform.OS === 'ios' ? 'standard' : 'standard'}
        showsUserLocation={true}
        showsMyLocationButton={true}
      />
    </View>
  );
}
